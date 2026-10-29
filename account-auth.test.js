import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { accountPasswordMatches, accountTokenHash, confirmationCodeHash, getAccountEmailConfig, handleAccountEmailAction, hashAccountPassword, isModernPasswordHash, passwordValidationError, requestAccountEmail, sendAccountEmail } from './account-auth.js';
import { handleDirectMutation } from './server.js';

const password = 'LongSyntheticPassword2026!';
const modern = await hashAccountPassword(password);
const disabled = { enabled: false, configured: false };
const configured = { enabled: true, configured: true, siteUrl: new URL('https://example.test/library/'), apiKey: 'synthetic-key', codeSecret: 'synthetic-confirmation-pepper-'.repeat(2), from: 'Library <noreply@example.test>' };

function fixture({ user = {}, mail = true } = {}) {
  const state = { user: user === null ? null : { user_id: 1, username: 'Читатель', role: 'reader', email: 'reader@example.test', password_hash: modern, email_verification_required: false, email_verified_at: null, ...user }, tokens: new Map(), emails: [], calls: [], sessions: [], warnings: [], jobs: [], allowIssue: true, allowLogin: true, allowSession: true };
  const options = {
    env: {}, accountEmailConfig: mail ? configured : disabled,
    waitUntil(job) { state.jobs.push(job); },
    logger: { warn(message) { state.warnings.push(message); } },
    async sendAccountEmail(message) { state.emails.push(message); },
    async dbRequest(table, query = {}, request = {}) {
      state.calls.push({ table, query, method: request.method, body: request.body });
      if (table === 'users') {
        if (request.method === 'POST') { state.user = { user_id: 1, ...request.body }; return [{ ...state.user }]; }
        if (request.method === 'PATCH') {
          if (!state.user || query.password_hash !== `eq.${state.user.password_hash}`) return [];
          Object.assign(state.user, request.body); return [{ ...state.user }];
        }
        return state.user && query.email === `eq.${state.user.email}` ? [{ ...state.user }] : [];
      }
      if (table === 'sessions') { state.sessions.push(request.body); return [request.body]; }
      if (table === 'rpc/auth_take_login_attempt') return state.allowLogin;
      if (table === 'rpc/auth_create_email_session') {
        if (!state.allowSession || request.body.p_password_hash !== state.user.password_hash) return false;
        state.sessions.push({ token: request.body.p_token }); return true;
      }
      if (table === 'rpc/auth_issue_email_token' || table === 'rpc/auth_issue_confirmation_code') {
        const purpose = request.body.p_purpose || 'email_confirm';
        if (!state.allowIssue) return false;
        for (const token of state.tokens.values()) if (token.purpose === purpose) token.consumed = true;
        state.tokens.set(request.body.p_token_hash, { purpose, challenge: request.body.p_challenge_id, failures: 0, credential: state.user.password_hash, expires: Date.now() + 900000, consumed: false });
        return true;
      }
      if (table === 'rpc/auth_confirm_email_code') {
        const token = [...state.tokens.entries()].find(([, value]) => value.challenge === request.body.p_challenge_id);
        if (!token || token[1].consumed || token[1].expires <= Date.now() || token[1].credential !== state.user.password_hash || state.user.is_banned) return false;
        if (token[0] !== request.body.p_token_hash) { token[1].failures++; if (token[1].failures >= 5) token[1].consumed = true; return false; }
        token[1].consumed = true; state.user.email_verified_at = new Date().toISOString(); return true;
      }
      if (table === 'account_email_tokens') {
        const token = state.tokens.get(query.token_hash.slice(3));
        return token && !token.consumed && token.expires > Date.now() && query.purpose === `eq.${token.purpose}` ? [{ token_hash: query.token_hash.slice(3) }] : [];
      }
      if (table === 'rpc/auth_consume_email_token') {
        const token = state.tokens.get(request.body.p_token_hash);
        if (!token || token.consumed || token.expires <= Date.now() || token.purpose !== request.body.p_purpose || token.credential !== state.user.password_hash) return false;
        token.consumed = true;
        state.user.email_verified_at = new Date().toISOString();
        if (token.purpose === 'password_reset') {
          state.user.password_hash = request.body.p_password_hash;
          state.sessions = [];
          for (const item of state.tokens.values()) item.consumed = true;
        }
        return true;
      }
      throw new Error(`Unexpected fixture table: ${table}`);
    }
  };
  const sentToken = () => new URLSearchParams(new URL(state.emails.at(-1).link).hash.slice(1)).get('token');
  const drain = () => Promise.all(state.jobs.splice(0));
  const requestEmail = async (purpose, email) => { const response = await requestAccountEmail(purpose, email, options); await drain(); return response; };
  return { state, options, sentToken, drain, requestEmail };
}

test('PBKDF2 использует случайную соль и проверяет пароль без сохранения его текста', async () => {
  const other = await hashAccountPassword(password);
  assert.ok(isModernPasswordHash(modern));
  assert.notEqual(modern, other);
  assert.ok(await accountPasswordMatches(password, modern));
  assert.equal(await accountPasswordMatches('неверный пароль', modern), false);
  assert.equal(await accountPasswordMatches(password, modern.replace('600000', '999999999')), false);
  assert.equal(await accountPasswordMatches(password, 'broken'), false);
});

test('старый SHA-256 читается, после входа хеш обновляется без смены пароля', async () => {
  const legacy = `salt:${crypto.createHash('sha256').update(`salt${password}`).digest('hex')}`;
  const f = fixture({ user: { password_hash: legacy }, mail: false });
  delete f.state.user.email_verification_required;
  const response = await handleDirectMutation('loginWithEmail', { email: f.state.user.email, password }, f.options);
  assert.equal(response.success, true);
  assert.ok(isModernPasswordHash(f.state.user.password_hash));
  assert.equal(f.state.sessions.length, 1);
  assert.equal(response.user.password_hash, undefined);
});

test('неверный пароль, неизвестная почта и блокировка дают одинаковую ошибку', async () => {
  const responses = [];
  for (const user of [null, {}, { is_banned: true }]) {
    const f = fixture({ user, mail: false });
    responses.push(await handleDirectMutation('loginWithEmail', { email: 'reader@example.test', password: user?.is_banned ? password : 'wrong' }, f.options));
    assert.equal(f.state.sessions.length, 0);
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[1], responses[2]);
});

test('новый пароль принимает фразу, ограничивает длину и не требует специальных знаков', () => {
  assert.ok(passwordValidationError('short'));
  assert.ok(passwordValidationError('1234567'));
  assert.equal(passwordValidationError('Test1234'), null);
  assert.ok(passwordValidationError('x'.repeat(129)));
  assert.ok(passwordValidationError('ordinary words make a long passphrase'));
  assert.ok(passwordValidationError('Пароль123'));
  assert.equal(passwordValidationError('SimplePassphrase2026!'), null);
});

test('регистрация принимает восемь символов и отклоняет семь до записи в базу', async () => {
  const f = fixture({ user: null, mail: false });
  const short = await handleDirectMutation('registerWithEmail', { username: 'Читатель', email: 'reader@example.test', password: '1234567' }, f.options);
  assert.equal(short.success, false);
  assert.equal(f.state.calls.length, 0);
  const accepted = await handleDirectMutation('registerWithEmail', { username: 'Читатель', email: 'reader@example.test', password: 'Test1234' }, f.options);
  assert.equal(accepted.success, true);
  assert.ok(await accountPasswordMatches('Test1234', f.state.user.password_hash));
});

test('регистрация с включённой почтой создаёт только неподтверждённого читателя', async () => {
  const f = fixture({ user: null });
  const result = await handleDirectMutation('registerWithEmail', { username: 'Читатель', email: 'reader@example.test', password, role: 'owner' }, f.options);
  await f.drain();
  assert.equal(result.success, true);
  assert.equal(result.verification_required, true);
  assert.equal(f.state.user.role, 'reader');
  assert.equal(f.state.user.email_verification_required, true);
  assert.equal(f.state.user.email_verified_at, null);
  assert.equal(f.state.sessions.length, 0);
  assert.equal(f.state.emails.length, 1);
  assert.equal(f.state.emails[0].purpose, 'email_confirm');
});

test('повторная регистрация не заменяет пароль существующего аккаунта', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  const result = await handleDirectMutation('registerWithEmail', { username: 'Чужое имя', email: f.state.user.email, password: 'AnotherLongPassphrase2026!' }, f.options);
  assert.equal(result.success, true);
  assert.equal(f.state.user.password_hash, modern);
  assert.equal(f.state.user.username, 'Читатель');
  assert.equal(f.state.calls.some(call => call.method === 'PATCH' || call.table === 'users' && call.method === 'POST'), false);
});

test('неподтверждённый новый аккаунт не входит даже при временно выключенной отправке', async () => {
  const f = fixture({ user: { email_verification_required: true }, mail: false });
  const result = await handleDirectMutation('loginWithEmail', { email: f.state.user.email, password }, f.options);
  assert.equal(result.code, 'EMAIL_CONFIRMATION_REQUIRED');
  assert.equal(f.state.sessions.length, 0);
});

test('код подтверждения одноразовый и хранится только как HMAC', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  const result = await f.requestEmail('email_confirm', f.state.user.email);
  const mail = f.state.emails.at(-1), id = result.confirmation_id;
  assert.match(mail.code, /^\d{6}$/);
  assert.equal(result.code, undefined);
  assert.equal(mail.link, undefined);
  assert.ok(f.state.tokens.has(confirmationCodeHash(id, mail.code, configured.codeSecret)));
  assert.equal(f.state.tokens.has(mail.code), false);
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: id, code: mail.code }, f.options)).success, true);
  assert.ok(f.state.user.email_verified_at);
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: id, code: mail.code }, f.options)).success, false);
});

test('просроченную ссылку и токен другого назначения использовать нельзя', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  await f.requestEmail('password_reset', f.state.user.email);
  const token = f.sentToken();
  assert.equal((await handleAccountEmailAction('confirmEmail', { token }, f.options)).success, false);
  f.state.tokens.get(accountTokenHash(token)).expires = Date.now() - 1;
  assert.equal((await handleAccountEmailAction('resetPassword', { token, password }, f.options)).success, false);
});

test('восстановление задаёт новый хеш и закрывает старые сессии без автоматического входа', async () => {
  const f = fixture();
  f.state.sessions.push({ token: 'old-session' });
  await f.requestEmail('password_reset', f.state.user.email);
  const token = f.sentToken(), nextPassword = 'NewSyntheticPassword2026!';
  const result = await handleAccountEmailAction('resetPassword', { token, password: nextPassword }, f.options);
  assert.equal(result.success, true);
  assert.equal(f.state.sessions.length, 0);
  assert.equal(result.session_token, undefined);
  assert.ok(await accountPasswordMatches(nextPassword, f.state.user.password_hash));
  assert.equal(await accountPasswordMatches(password, f.state.user.password_hash), false);
  assert.equal((await handleAccountEmailAction('resetPassword', { token, password: nextPassword }, f.options)).success, false);
});

test('новое письмо отменяет прежнюю ссылку того же назначения', async () => {
  const f = fixture();
  await f.requestEmail('password_reset', f.state.user.email);
  const old = f.sentToken();
  await f.requestEmail('password_reset', f.state.user.email);
  assert.notEqual(old, f.sentToken());
  assert.equal((await handleAccountEmailAction('resetPassword', { token: old, password }, f.options)).success, false);
});

test('ответ запроса восстановления не раскрывает существование email', async () => {
  const known = fixture(), unknown = fixture({ user: null });
  const a = await known.requestEmail('password_reset', 'reader@example.test');
  const b = await unknown.requestEmail('password_reset', 'reader@example.test');
  assert.deepEqual(a, b);
  assert.equal(unknown.state.emails.length, 0);
});

test('лимит выдачи писем не раскрывается и не отправляет дополнительное письмо', async () => {
  const f = fixture();
  f.state.allowIssue = false;
  const result = await f.requestEmail('password_reset', f.state.user.email);
  assert.equal(result.success, true);
  assert.equal(f.state.emails.length, 0);
});

test('ошибка почтового сервиса не раскрывает адрес, ссылку и токен в журнале', async () => {
  const f = fixture();
  f.options.sendAccountEmail = async () => { throw new Error('provider secret error'); };
  const result = await f.requestEmail('password_reset', f.state.user.email);
  assert.equal(result.success, true);
  assert.equal(f.state.warnings.length, 1);
  assert.doesNotMatch(f.state.warnings[0], /reader@|https:|provider secret|[a-f0-9]{64}/);
});

test('без настройки письма не отправляются и токены не создаются', async () => {
  const f = fixture({ mail: false });
  assert.equal((await handleAccountEmailAction('requestPasswordReset', { email: 'reader@example.test' }, f.options)).code, 'EMAIL_NOT_CONFIGURED');
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.emails.length, 0);
});

test('ответ восстановления не ждёт поиск email и работу почтового сервиса', async () => {
  const f = fixture();
  let finish;
  f.options.dbRequest = () => new Promise(resolve => { finish = resolve; });
  const result = await requestAccountEmail('password_reset', 'reader@example.test', f.options);
  assert.equal(result.success, true);
  assert.equal(f.state.jobs.length, 1);
  finish([]);
  await f.drain();
});

test('включённое, но ненастроенное подтверждение не создаёт аккаунт без проверки почты', async () => {
  const f = fixture({ user: null });
  f.options.accountEmailConfig = { enabled: true, configured: false };
  const result = await handleDirectMutation('registerWithEmail', { username: 'Читатель', email: 'reader@example.test', password }, f.options);
  assert.equal(result.success, false);
  assert.equal(f.state.calls.length, 0);
});

test('доверенный адрес сайта сохраняет путь GitHub Pages и токен находится только во фрагменте', async () => {
  const f = fixture();
  await f.requestEmail('password_reset', f.state.user.email);
  const link = new URL(f.state.emails[0].link);
  assert.equal(link.origin, 'https://example.test');
  assert.equal(link.pathname, '/library/');
  assert.equal(link.searchParams.has('token'), false);
  assert.ok(link.hash.includes('token='));
  assert.equal(getAccountEmailConfig({ AUTH_EMAIL_ENABLED: 'true', AUTH_SITE_URL: 'http://untrusted.test', RESEND_API_KEY: 'x', AUTH_EMAIL_FROM: 'a@b.test' }).configured, false);
});

test('почтовый HTTP-запрос получает ключ только на сервере и ограничение ожидания', async () => {
  let sent;
  await sendAccountEmail({ to: 'reader@example.test', purpose: 'email_confirm', token: 'a'.repeat(64) }, { accountEmailConfig: configured, emailFetchImpl: async (url, options) => { sent = { url, options }; return { ok: true }; } });
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.ok(sent.options.signal);
  assert.equal(sent.options.headers.Authorization, 'Bearer synthetic-key');
  assert.match(sent.options.headers['Idempotency-Key'], /^account-[a-f0-9]{64}$/);
});

test('после смены пароля между проверкой и созданием сессии вход отклоняется', async () => {
  const f = fixture();
  f.state.allowSession = false;
  const result = await handleDirectMutation('loginWithEmail', { email: f.state.user.email, password }, f.options);
  assert.equal(result.success, false);
  assert.equal(result.session_token, undefined);
});

test('превышение лимита входа отклоняется до поиска пользователя и проверки пароля', async () => {
  const f = fixture();
  f.state.allowLogin = false;
  const result = await handleDirectMutation('loginWithEmail', { email: f.state.user.email, password }, f.options);
  assert.equal(result.success, false);
  assert.deepEqual(f.state.calls.map(call => call.table), ['rpc/auth_take_login_attempt']);
});

test('новые пароли допускают все печатные ASCII-знаки и не требуют разных классов', () => {
  const all = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');
  for (const value of [all, 'abcdefgh', 'ABCDEFGH', '87654321', '--------']) assert.equal(passwordValidationError(value), null);
  for (const value of ['abcd efgh', ' abcdefgh', 'abcdefgh ', 'abcd\tefgh', 'abcd\nefgh', 'abcd\u00a0efgh', 'Пароль1234', 'Password🙂', 'Passwörd9']) assert.ok(passwordValidationError(value));
});

test('существующие пароли с кириллицей и пробелами продолжают работать', async () => {
  const legacyPassword = 'Старый пароль с пробелами';
  const legacy = `salt:${crypto.createHash('sha256').update(`salt${legacyPassword}`).digest('hex')}`;
  const f = fixture({ user: { password_hash: legacy }, mail: false });
  delete f.state.user.email_verification_required;
  const result = await handleDirectMutation('loginWithEmail', { email: f.state.user.email, password: legacyPassword }, f.options);
  assert.equal(result.success, true);
  assert.ok(await accountPasswordMatches(legacyPassword, f.state.user.password_hash));
});

test('после пяти неверных кодов правильный код тоже отклоняется', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  const response = await f.requestEmail('email_confirm', f.state.user.email);
  const code = f.state.emails.at(-1).code, wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: response.confirmation_id, code: wrong }, f.options)).success, false);
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: response.confirmation_id, code }, f.options)).success, false);
});

test('повторное письмо создаёт новый код и отменяет предыдущий', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  const first = await f.requestEmail('email_confirm', f.state.user.email), oldCode = f.state.emails.at(-1).code;
  const next = await f.requestEmail('email_confirm', f.state.user.email), newCode = f.state.emails.at(-1).code;
  assert.notEqual(first.confirmation_id, next.confirmation_id);
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: first.confirmation_id, code: oldCode }, f.options)).success, false);
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: next.confirmation_id, code: newCode }, f.options)).success, true);
});

test('неизвестный адрес получает такую же форму подтверждения без отправки письма', async () => {
  const f = fixture({ user: null });
  const result = await f.requestEmail('email_confirm', 'unknown@example.test');
  assert.equal(result.success, true);
  assert.match(result.confirmation_id, /^[a-f0-9-]{36}$/);
  assert.equal(result.retry_after, 60);
  assert.equal(f.state.emails.length, 0);
});

test('исчерпанная квота не создаёт неподтверждённый аккаунт и не заменяет старые токены', async () => {
  const f = fixture({ user: null });
  f.options.accountEmailConfig = { ...configured, provider: 'apps-script' };
  f.options.mailAvailability = { success: false, code: 'MAIL_DAILY_LIMIT', retry_after: 60, error: 'Лимит писем' };
  const registration = await handleDirectMutation('registerWithEmail', { username: 'Читатель', email: 'reader@example.test', password }, f.options);
  assert.equal(registration.code, 'MAIL_DAILY_LIMIT');
  assert.equal(f.state.calls.length, 0);
  const reset = await f.requestEmail('password_reset', 'reader@example.test');
  assert.equal(reset.code, 'MAIL_DAILY_LIMIT');
  assert.equal(f.state.tokens.size, 0);
  assert.equal(f.state.calls.length, 0);
});

test('подтверждение уже полученным кодом не зависит от доступности новой отправки', async () => {
  const f = fixture({ user: { email_verification_required: true } });
  const response = await f.requestEmail('email_confirm', f.state.user.email), code = f.state.emails.at(-1).code;
  f.options.accountEmailConfig = { ...configured, provider: 'apps-script' };
  f.options.mailAvailability = { success: false, code: 'MAIL_DAILY_LIMIT' };
  assert.equal((await handleAccountEmailAction('confirmEmailCode', { confirmation_id: response.confirmation_id, code }, f.options)).success, true);
});
