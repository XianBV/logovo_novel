import crypto from 'node:crypto';
import { getAccountEmailConfig, getAccountMailAvailability, hashAccountPassword, passwordValidationError, sendAccountEmail } from './account-auth.js';

export const ACCOUNT_LINK_ACTIONS = new Set(['getAccountConnections', 'beginEmailLink', 'confirmEmailLink']);
export const linkSessionHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');
export const accountLinkingEnabled = options => (options.env || process.env).ACCOUNT_LINKING_ENABLED === 'true';
export const linkCodeHash = (id, code, secret) => crypto.createHmac('sha256', secret).update(`account-link-email:${id}:${code}`).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REAUTH = { success: false, code: 'REAUTH_REQUIRED', error: 'Для подключения способа входа выйдите из аккаунта и войдите заново. Затем вернитесь в настройки.' };

export async function accountLinkSession(data, options, recent = true) {
  const token = data.session_token;
  if (typeof token !== 'string' || !token || token.length > 256) return null;
  const rows = await options.dbRequest('sessions', { token: `eq.${token}`,
    select: 'created_at,expires_at,users(user_id,username,email,telegram_id,role,avatar_url,bio,created_at,is_banned,email_verified_at,email_verification_required)', limit: 1 }, options);
  const s = rows[0], now = options.linkNow ?? Date.now();
  if (!s?.users || s.users.is_banned || !Number.isFinite(Date.parse(s.expires_at)) || Date.parse(s.expires_at) <= now) return null;
  if (recent && (!Number.isFinite(Date.parse(s.created_at)) || Date.parse(s.created_at) > now || Date.parse(s.created_at) < now - 900000)) return null;
  return s.users;
}

export async function handleAccountLinkAction(action, data, options = {}) {
  try { return await accountLinkAction(action, data, options); }
  catch { return { success: false, error: 'Не удалось обработать подключение. Повторите попытку позже.' }; }
}

async function accountLinkAction(action, data, options) {
  if (action !== 'getAccountConnections' && !accountLinkingEnabled(options)) return { success: false, code: 'LINKING_NOT_CONFIGURED', error: 'Подключение способов входа ещё настраивается.' };
  const user = await accountLinkSession(data, options, action !== 'getAccountConnections');
  if (!user) return { ...REAUTH };
  if (action === 'getAccountConnections') return { success: true, email: user.email || null,
    email_verified: !!user.email_verified_at, telegram_connected: !!user.telegram_id,
    linking_enabled: accountLinkingEnabled(options) };
  const sessionHash = linkSessionHash(data.session_token);
  const config = options.accountEmailConfig || getAccountEmailConfig(options.env || process.env);
  if (!config.configured || String(config.codeSecret || '').length < 32) return { success: false, code: 'EMAIL_NOT_CONFIGURED', error: 'Подтверждение почты ещё не подключено.' };
  if (action === 'beginEmailLink') {
    const email = String(data.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { success: false, error: 'Укажите корректный email' };
    const error = passwordValidationError(data.password);
    if (error) return { success: false, error };
    if (user.email || !user.telegram_id) return { success: false, error: 'Почту можно добавить к аккаунту Telegram без почты. Для смены уже указанного адреса нужен отдельный способ подтверждения.' };
    const allowed = await options.dbRequest('rpc/auth_take_login_attempt', {}, { ...options, method: 'POST', body: { p_key_hash: linkSessionHash(`account-link:${user.user_id}`) } });
    if (allowed !== true) return { success: false, retry_after: 60, error: 'Слишком много попыток. Подождите минуту.' };
    const availability = await getAccountMailAvailability(options);
    if (!availability.success) return availability;
    const id = crypto.randomUUID(), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const issued = await options.dbRequest('rpc/auth_begin_email_link', {}, { ...options, method: 'POST', body: {
      p_challenge_id: id, p_user_id: user.user_id, p_session_token: data.session_token, p_session_hash: sessionHash,
      p_email: email, p_password_hash: await hashAccountPassword(data.password), p_code_hash: linkCodeHash(id, code, config.codeSecret)
    } });
    if (issued?.success !== true) return linkFailure(issued);
    try { await sendAccountEmail({ to: email, purpose: 'email_link', code, confirmationId: id }, options); }
    catch {
      await options.dbRequest('account_email_links', { challenge_id: `eq.${id}`, user_id: `eq.${user.user_id}` }, { ...options, method: 'PATCH', body: { consumed_at: new Date().toISOString() } });
      return { success: false, retry_after: 60, error: 'Письмо не удалось отправить. Повторите через минуту; почта аккаунта пока не изменена.' };
    }
    return { success: true, confirmation_id: id, email, expires_in: 600, retry_after: 60, message: 'Код отправлен. Введите его, чтобы подключить почту и пароль к этому аккаунту.' };
  }
  if (action !== 'confirmEmailLink' || !UUID.test(String(data.confirmation_id || '')) || !/^\d{6}$/.test(String(data.code || ''))) return { success: false, error: 'Введите шестизначный код из письма' };
  const result = await options.dbRequest('rpc/auth_finish_email_link', {}, { ...options, method: 'POST', body: {
    p_challenge_id: data.confirmation_id, p_user_id: user.user_id, p_session_token: data.session_token,
    p_session_hash: sessionHash, p_code_hash: linkCodeHash(data.confirmation_id, data.code, config.codeSecret)
  } });
  if (result?.success !== true) return linkFailure(result);
  return { success: true, user: options.publicSessionUser(result.user), message: 'Почта подтверждена. Теперь в этот аккаунт можно входить через Telegram или по почте и паролю.' };
}

export function linkFailure(result) {
  if (result?.code === 'REAUTH_REQUIRED') return { ...REAUTH };
  if (result?.code === 'COOLDOWN') return { success: false, code: result.code, retry_after: Math.max(1, Number(result.retry_after) || 60), error: 'Письмо уже запрошено. Подождите перед повторной отправкой.' };
  if (result?.code === 'IDENTITY_IN_USE') return { success: false, code: result.code, error: 'Этот способ входа уже связан с другим аккаунтом. Войдите в него; автоматически объединять профили нельзя.' };
  return { success: false, error: 'Подтверждение неверное, использовано или истекло. После пяти ошибок запросите новый код.' };
}
