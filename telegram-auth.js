import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

export const TELEGRAM_AUTH_ACTIONS = new Set(['beginTelegramLogin', 'authenticateTelegram']);
const ISSUER = 'https://oauth.telegram.org';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const INVALID = { success: false, error: 'Не удалось подтвердить вход через Telegram. Нажмите кнопку входа ещё раз.' };
let keyCache = null;
let keyRequest = null;

export function getTelegramLoginConfig(env = process.env) {
  const clientId = String(env.TELEGRAM_CLIENT_ID || '').trim();
  const mode = env.TELEGRAM_LOGIN_MODE === 'redirect' ? 'redirect' : 'popup';
  let clientSecret = String(env.TELEGRAM_CLIENT_SECRET || '').trim();
  if (!clientSecret && env.TELEGRAM_CLIENT_SECRET_FILE) {
    try { clientSecret = readFileSync(env.TELEGRAM_CLIENT_SECRET_FILE, 'utf8').trim(); } catch { /* Ключ не попадает в сообщения об ошибках. */ }
  }
  const secretConfigured = clientSecret.length >= 16 && clientSecret.length <= 4096 && !/[\r\n]/.test(clientSecret);
  const redirectUrls = String(env.TELEGRAM_REDIRECT_URLS || 'http://127.0.0.1:3000/,https://xianbv.github.io/logovo_novel/').split(',').map(s => s.trim());
  return { enabled: env.TELEGRAM_LOGIN_ENABLED === 'true', clientId, mode, clientSecret, redirectUrls,
    configured: env.TELEGRAM_LOGIN_ENABLED === 'true' && /^[1-9]\d{0,15}$/.test(clientId) && Number.isSafeInteger(Number(clientId)) && (mode === 'popup' || secretConfigured) };
}

export function telegramProofHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function redirectUriAllowed(value, config) {
  if (typeof value !== 'string' || !config.redirectUrls?.includes(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  } catch { return false; }
}

function redirectProofHash(proof, redirectUri) {
  return telegramProofHash(`telegram-code\n${redirectUri}\n${proof}`);
}

async function exchangeTelegramCode(data, config, options) {
  if (config.mode !== 'redirect' || !redirectUriAllowed(data.redirect_uri, config) || typeof data.code !== 'string' || !data.code || data.code.length > 4096 || /[\x00-\x20\x7f]/.test(data.code)) throw new Error('Invalid redirect response');
  const proofHash = redirectProofHash(data.proof, data.redirect_uri);
  const db = options.dbRequest;
  const rows = await db('telegram_login_challenges', {
    challenge_id: `eq.${data.challenge_id}`, client_id: `eq.${config.clientId}`,
    select: 'proof_hash,expires_at,consumed_at', limit: 1
  }, options);
  const row = rows[0];
  if (!row || row.consumed_at || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= (options.telegramNow ?? Date.now()) ||
      typeof row.proof_hash !== 'string' || row.proof_hash.length !== proofHash.length || !crypto.timingSafeEqual(Buffer.from(row.proof_hash), Buffer.from(proofHash))) throw new Error('Invalid redirect binding');
  const allowed = await db('rpc/auth_take_login_attempt', {}, { ...options, method: 'POST', body: { p_key_hash: telegramProofHash(`telegram-code:${data.challenge_id}`) } });
  if (allowed !== true) throw new Error('Too many exchanges');
  const response = await (options.telegramTokenFetchImpl || fetch)(`${ISSUER}/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: data.code, client_id: config.clientId,
      redirect_uri: data.redirect_uri, code_verifier: data.proof }).toString()
  });
  const body = await response.text();
  if (!response.ok || body.length > 65536) throw new Error('Telegram exchange failed');
  const result = JSON.parse(body);
  if (typeof result.id_token !== 'string') throw new Error('Missing ID token');
  return { token: result.id_token, proofHash };
}

async function telegramKeys(options) {
  if (options.telegramJwks) return options.telegramJwks;
  const now = Date.now();
  if (keyCache && keyCache.until > now) return keyCache.keys;
  if (!keyRequest) {
    keyRequest = (async () => {
      const response = await (options.telegramFetchImpl || fetch)(JWKS_URL, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('Telegram keys unavailable');
      const text = await response.text();
      if (text.length > 65536) throw new Error('Invalid Telegram keys');
      const result = JSON.parse(text);
      if (!Array.isArray(result.keys) || result.keys.length > 20) throw new Error('Invalid Telegram keys');
      keyCache = { keys: result.keys, until: Date.now() + 300000 };
      return result.keys;
    })().finally(() => { keyRequest = null; });
  }
  return keyRequest;
}

export async function verifyTelegramIdToken(token, config, options = {}) {
  if (typeof token !== 'string' || token.length > 16384) throw new Error('Invalid token');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 || header.crit || header.b64 === false) throw new Error('Invalid signing algorithm');
  const keys = await telegramKeys(options);
  const matches = keys.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig') && (!k.key_ops || k.key_ops.includes('verify')));
  if (matches.length !== 1) throw new Error('Unknown signing key');
  const key = await crypto.webcrypto.subtle.importKey('jwk', matches[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(parts[2], 'base64url'), Buffer.from(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid signature');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const now = Math.floor((options.telegramNow ?? Date.now()) / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audiences.includes(config.clientId) || (audiences.length > 1 && claims.azp !== config.clientId)) throw new Error('Invalid issuer or audience');
  if (!Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 30 || claims.iat < now - 600 || claims.exp <= claims.iat) throw new Error('Expired token');
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) throw new Error('Token not active');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200 || typeof claims.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(claims.nonce)) throw new Error('Missing login binding');
  const id = typeof claims.id === 'number' && Number.isSafeInteger(claims.id) ? String(claims.id) : claims.id;
  if (typeof id !== 'string' || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Missing Telegram user ID');
  const username = String(claims.name || claims.preferred_username || 'Читатель Telegram').trim().slice(0, 100) || 'Читатель Telegram';
  return { telegramId: id, username, nonce: claims.nonce };
}

export async function handleTelegramAuthAction(action, data, options = {}) {
  const config = options.telegramLoginConfig || getTelegramLoginConfig(options.env || process.env);
  if (!config.configured) return { success: false, code: 'TELEGRAM_NOT_CONFIGURED', error: 'Вход через Telegram ещё настраивается. Пока можно войти по почте.' };
  const db = options.dbRequest;
  if (action === 'beginTelegramLogin') {
    const redirect = config.mode === 'redirect';
    if (redirect && !redirectUriAllowed(data.redirect_uri, config)) return { ...INVALID };
    const challengeId = crypto.randomUUID(), nonce = crypto.randomBytes(32).toString('hex'), proof = crypto.randomBytes(32).toString('hex');
    try {
      const issued = await db('rpc/auth_begin_telegram_login', {}, { ...options, method: 'POST', body: {
        p_challenge_id: challengeId, p_client_id: config.clientId, p_nonce_hash: telegramProofHash(nonce), p_proof_hash: redirect ? redirectProofHash(proof, data.redirect_uri) : telegramProofHash(proof)
      } });
      if (issued !== true) return { ...INVALID };
      const result = { success: true, mode: redirect ? 'redirect' : 'popup', client_id: config.clientId, challenge_id: challengeId, nonce, proof, expires_in: 600 };
      if (redirect) {
        const url = new URL(`${ISSUER}/auth`);
        url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: data.redirect_uri, response_type: 'code',
          scope: 'openid profile', state: challengeId, nonce, code_challenge: crypto.createHash('sha256').update(proof).digest('base64url'), code_challenge_method: 'S256' }).toString();
        result.authorization_url = url.href;
        result.redirect_uri = data.redirect_uri;
      }
      return result;
    } catch { return { success: false, error: 'Не удалось подготовить вход через Telegram. Попробуйте позже.' }; }
  }
  if (action !== 'authenticateTelegram') return { ...INVALID };
  if (!/^[a-f0-9-]{36}$/i.test(data.challenge_id || '') || !/^[a-f0-9]{64}$/.test(data.proof || '')) return { ...INVALID };
  try {
    const exchanged = data.code !== undefined ? await exchangeTelegramCode(data, config, options) : { token: data.id_token, proofHash: telegramProofHash(data.proof) };
    const identity = await verifyTelegramIdToken(exchanged.token, config, options);
    const sessionToken = crypto.randomUUID();
    const result = await db('rpc/auth_finish_telegram_login', {}, { ...options, method: 'POST', body: {
      p_challenge_id: data.challenge_id, p_client_id: config.clientId, p_proof_hash: exchanged.proofHash,
      p_nonce_hash: telegramProofHash(identity.nonce), p_telegram_id: identity.telegramId, p_username: identity.username, p_session_token: sessionToken
    } });
    if (!result || result.success !== true || !result.user) return { ...INVALID };
    return { success: true, user: options.publicSessionUser(result.user), session_token: sessionToken };
  } catch { return { ...INVALID }; }
}
