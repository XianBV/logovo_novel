import crypto from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_EMAIL_ACTIONS = new Set(['requestPasswordReset', 'resendEmailConfirmation', 'confirmEmail', 'confirmEmailCode', 'resetPassword']);
const ITERATIONS = 600000;
const NEUTRAL_MESSAGE = 'Если для этого адреса доступно действие, мы отправим письмо. Проверьте почту и папку «Спам».';
const INVALID_LINK = { success: false, error: 'Ссылка недействительна или срок её действия истёк. Запросите новое письмо.' };

export function passwordValidationError(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов`;
  if (password.length > 128) return 'Пароль должен содержать не более 128 символов';
  if (!/^[\x21-\x7E]+$/.test(password)) return 'Используйте латинские буквы, цифры и стандартные знаки без пробелов';
  return null;
}

async function derivePassword(password, salt, iterations = ITERATIONS) {
  const key = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(salt, 'hex'), iterations, hash: 'SHA-256' }, key, 256)).toString('hex');
}

export async function hashAccountPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${await derivePassword(password, salt)}`;
}

export function isModernPasswordHash(stored) {
  return /^pbkdf2-sha256\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(String(stored));
}

export async function accountPasswordMatches(password, stored) {
  if (isModernPasswordHash(stored)) {
    const [, iterations, salt, expected] = stored.split('$');
    const actual = await derivePassword(password, salt, Number(iterations));
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  }
  const legacy = /^([^:]+):([a-f0-9]{64})$/.exec(String(stored));
  if (!legacy) return false;
  const actual = crypto.createHash('sha256').update(`${legacy[1]}${password}`, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(legacy[2], 'hex'));
}

export async function dummyPasswordCheck(password) {
  await derivePassword(password, '00000000000000000000000000000000');
}

export function getAccountEmailConfig(env = process.env) {
  const enabled = env.AUTH_EMAIL_ENABLED === 'true';
  let siteUrl = null;
  try {
    const url = new URL(env.AUTH_SITE_URL || '');
    if ((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash) siteUrl = url;
  } catch {}
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.AUTH_EMAIL_FROM || '').trim();
  const provider = String(env.AUTH_EMAIL_PROVIDER || (apiKey ? 'resend' : 'apps-script')).trim();
  const relaySecret = String(env.AUTH_MAIL_RELAY_SECRET || '').trim();
  let relayUrl = null;
  try {
    const url = new URL(env.AUTH_MAIL_RELAY_URL || '');
    if (url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) relayUrl = url.href;
  } catch {}
  const deliveryConfigured = provider === 'apps-script'
    ? !!relayUrl && relaySecret.length >= 32
    : provider === 'resend' && !!apiKey && !!from && !/[\r\n]/.test(from);
  const codeSecret = String(env.AUTH_CODE_SECRET || relaySecret || apiKey);
  return { enabled, siteUrl, provider, apiKey, from, relayUrl, relaySecret, codeSecret, configured: enabled && !!siteUrl && deliveryConfigured && codeSecret.length >= 32 };
}

export function accountTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function accountConfig(options) {
  return options.accountEmailConfig || getAccountEmailConfig(options.env || process.env);
}

const mailAvailabilityCache = new Map();
function mailAvailabilityKey(config) {
  return `${config.relayUrl}:${accountTokenHash(config.relaySecret || '')}`;
}

async function callAccountRelay(payload, config, options) {
  const text = JSON.stringify(payload), issuedAt = Date.now(), nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', config.relaySecret).update(`${issuedAt}\n${nonce}\n${text}`, 'utf8').digest('hex');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await (options.emailFetchImpl || fetch)(config.relayUrl, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issued_at: issuedAt, nonce, payload: text, signature }) });
    if (!response.ok) throw new Error('Почтовый отправитель недоступен');
    const result = await response.json();
    if (result?.success !== true) {
      const error = new Error('Почтовый отправитель не принял письмо');
      error.code = result?.code;
      throw error;
    }
    return result;
  } finally { clearTimeout(timer); }
}

export async function getAccountMailAvailability(options = {}) {
  const config = accountConfig(options);
  if (!config.configured) return { success: false, code: 'EMAIL_NOT_CONFIGURED', error: 'Письма ещё не подключены.' };
  if (config.provider !== 'apps-script') return { success: true };
  if (options.mailAvailability) return options.mailAvailability;
  const key = mailAvailabilityKey(config), cached = mailAvailabilityCache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  let result;
  try {
    const status = await callAccountRelay({ action: 'status' }, config, options);
    if (!Number.isFinite(status.remaining)) throw new Error('Invalid quota response');
    result = status.remaining > 0 ? { success: true } : { success: false, code: 'MAIL_DAILY_LIMIT', retry_after: 60, error: 'Дневной лимит писем закончился. Попробуйте позже: квота обычно восстанавливается в течение 24 часов. Ранее полученные коды и ссылки действуют до своего срока.' };
  } catch {
    result = { success: false, code: 'MAIL_UNAVAILABLE', retry_after: 60, error: 'Отправка писем временно недоступна. Попробуйте позже.' };
  }
  mailAvailabilityCache.set(key, { until: Date.now() + 15000, result });
  return result;
}

export async function sendAccountEmail({ to, purpose, token, code, confirmationId }, options = {}) {
  const config = accountConfig(options);
  if (!config.configured) throw new Error('Отправка писем ещё не настроена');
  const link = new URL(config.siteUrl);
  link.search = '?page=home';
  // Фрагмент не отправляется серверу страницы и не попадает в Referer.
  link.hash = new URLSearchParams({ account_action: purpose === 'password_reset' ? 'reset' : 'confirm', token }).toString();
  const reset = purpose === 'password_reset';
  const subject = reset ? 'Восстановление пароля — Логово новелл' : 'Подтверждение почты — Логово новелл';
  const text = code ? `Код подтверждения почты: ${code}\n\nВведите его в открытой форме сайта. Код действует 10 минут и используется один раз. Никому не сообщайте код. Если вы не запрашивали письмо, проигнорируйте его.`
    : `${reset ? 'Чтобы задать новый пароль' : 'Чтобы подтвердить почту'}, откройте ссылку:\n${link.href}\n\nСсылка действует ${reset ? '15 минут' : '24 часа'} и используется один раз. Если вы не запрашивали это письмо, проигнорируйте его.`;
  if (options.sendAccountEmail) return options.sendAccountEmail({ to, subject, text, link: code ? undefined : link.href, code, confirmationId, purpose });
  if (config.provider === 'apps-script') {
    try { await callAccountRelay({ action: 'send', to, subject, text }, config, options); }
    catch (error) {
      if (error.code === 'quota') mailAvailabilityCache.set(mailAvailabilityKey(config), { until: Date.now() + 15000, result: { success: false, code: 'MAIL_DAILY_LIMIT', retry_after: 60, error: 'Дневной лимит писем закончился. Попробуйте позже.' } });
      throw error;
    }
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await (options.emailFetchImpl || fetch)('https://api.resend.com/emails', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `account-${accountTokenHash(token || confirmationId)}` },
      body: JSON.stringify({ from: config.from, to: [to], subject, text })
    });
    if (!response.ok) throw new Error('Сервис не принял письмо');
  } finally { clearTimeout(timer); }
}

export async function requestAccountEmail(purpose, email, options = {}) {
  const db = options.dbRequest;
  const config = accountConfig(options);
  if (!config.configured) return { success: false, code: 'EMAIL_NOT_CONFIGURED', error: 'Письма ещё не подключены. Восстановление и подтверждение почты пока недоступны.' };
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return { success: false, error: 'Укажите корректный email' };
  const availability = await getAccountMailAvailability(options);
  if (!availability.success) return availability;
  if (purpose === 'email_confirm' && String(config.codeSecret || '').length < 32) return { success: false, code: 'EMAIL_NOT_CONFIGURED', error: 'Подтверждение почты ещё не настроено' };
  const confirmationId = purpose === 'email_confirm' ? crypto.randomUUID() : null;
  const confirmationCode = confirmationId ? String(crypto.randomInt(0, 1000000)).padStart(6, '0') : null;
  // Ответ не ждёт ни поиска аккаунта, ни отправки: существование почты нельзя
  // определить по задержке HTTP-ответа почтового сервиса.
  const delivery = (async () => {
    const users = await db('users', { email: `eq.${address}`, select: 'user_id,email,password_hash,is_banned,email_verification_required,email_verified_at', limit: 1 }, options);
    const user = users[0];
    if (!user || user.is_banned || !user.password_hash || (purpose === 'email_confirm' && (!user.email_verification_required || user.email_verified_at))) return;
    const token = confirmationId ? null : crypto.randomBytes(32).toString('hex');
    const tokenHash = confirmationId ? confirmationCodeHash(confirmationId, confirmationCode, config.codeSecret) : accountTokenHash(token);
    const issued = await db(confirmationId ? 'rpc/auth_issue_confirmation_code' : 'rpc/auth_issue_email_token', {}, { ...options, method: 'POST', body: confirmationId
      ? { p_user_id: user.user_id, p_token_hash: tokenHash, p_challenge_id: confirmationId }
      : { p_user_id: user.user_id, p_purpose: purpose, p_token_hash: tokenHash } });
    if (issued === true) await sendAccountEmail({ to: user.email, purpose, token, code: confirmationCode, confirmationId }, options);
  })().catch(() => (options.logger || console).warn('Письмо аккаунта не доставлено. Проверьте настройки почтового сервиса.'));
  if (options.waitUntil) options.waitUntil(delivery);
  else if (globalThis.EdgeRuntime?.waitUntil) globalThis.EdgeRuntime.waitUntil(delivery);
  return { success: true, message: NEUTRAL_MESSAGE, retry_after: 60, ...(confirmationId ? { confirmation_id: confirmationId } : {}) };
}

export function confirmationCodeHash(challengeId, code, secret) {
  return crypto.createHmac('sha256', secret).update(`account-confirm:${challengeId}:${code}`).digest('hex');
}

export async function handleAccountEmailAction(action, data, options = {}) {
  if (!accountConfig(options).configured) return { success: false, code: 'EMAIL_NOT_CONFIGURED', error: 'Подтверждение и восстановление почты ещё не подключены.' };
  if (action === 'requestPasswordReset') return requestAccountEmail('password_reset', data.email, options);
  if (action === 'resendEmailConfirmation') return requestAccountEmail('email_confirm', data.email, options);
  if (action === 'confirmEmailCode') {
    const config = accountConfig(options);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(data.confirmation_id || '')) || !/^\d{6}$/.test(String(data.code || '')) || String(config.codeSecret || '').length < 32) return { success: false, error: 'Введите шестизначный код из письма' };
    const ok = await options.dbRequest('rpc/auth_confirm_email_code', {}, { ...options, method: 'POST', body: { p_challenge_id: data.confirmation_id, p_token_hash: confirmationCodeHash(data.confirmation_id, String(data.code), config.codeSecret) } });
    return ok === true ? { success: true, message: 'Почта подтверждена. Теперь можно войти.' } : { success: false, error: 'Код неверный, использован или истёк. После пяти ошибок запросите новое письмо.' };
  }
  const token = String(data.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return { ...INVALID_LINK };
  const purpose = action === 'resetPassword' ? 'password_reset' : 'email_confirm';
  const tokenHash = accountTokenHash(token);
  let newHash = null;
  if (action === 'resetPassword') {
    const error = passwordValidationError(data.password);
    if (error) return { success: false, error };
    const candidates = await options.dbRequest('account_email_tokens', { token_hash: `eq.${tokenHash}`, purpose: 'eq.password_reset', consumed_at: 'is.null', expires_at: `gt.${new Date().toISOString()}`, select: 'token_hash', limit: 1 }, options);
    if (!candidates.length) return { ...INVALID_LINK };
    newHash = await hashAccountPassword(data.password);
  }
  const consumed = await options.dbRequest('rpc/auth_consume_email_token', {}, { ...options, method: 'POST', body: { p_token_hash: tokenHash, p_purpose: purpose, p_password_hash: newHash } });
  return consumed === true ? { success: true, message: action === 'resetPassword' ? 'Пароль изменён. Войдите с новым паролем.' : 'Почта подтверждена. Теперь можно войти.' } : { ...INVALID_LINK };
}
