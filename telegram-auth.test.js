import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getTelegramLoginConfig, telegramProofHash, verifyTelegramIdToken, handleTelegramAuthAction } from './telegram-auth.js';
import { handleDirectMutation } from './server.js';

const config = getTelegramLoginConfig({ TELEGRAM_LOGIN_ENABLED: 'true', TELEGRAM_CLIENT_ID: '123456789' });
const now = 1793250000000;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'telegram-test', alg: 'RS256', use: 'sig' };
const claims = { iss: 'https://oauth.telegram.org', aud: config.clientId, sub: 'opaque-provider-subject',
    id: 99887766, name: 'Читатель Telegram', iat: now / 1000 - 5, exp: now / 1000 + 3600, nonce: 'a'.repeat(64) };
function sign(payload = claims, header = { alg: 'RS256', kid: jwk.kid }) {
    const encoded = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${encoded}.${crypto.sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url')}`;
}
const options = { telegramJwks: [jwk], telegramNow: now };

test('новый Telegram Login проверяет подпись и использует Telegram ID, а не OIDC sub', async () => {
    const identity = await verifyTelegramIdToken(sign(), config, options);
    assert.equal(identity.telegramId, '99887766');
    assert.equal(identity.nonce, claims.nonce);
    assert.equal(identity.username, claims.name);
});

test('Telegram JWT отклоняет неверный issuer, audience, срок и отсутствующую привязку', async () => {
    for (const changed of [ { iss: 'https://attacker.invalid' }, { aud: 'another-bot' },
        { exp: now / 1000 }, { iat: now / 1000 + 60 }, { iat: now / 1000 - 601 },
        { nbf: now / 1000 + 60 }, { nonce: undefined }, { sub: '' }, { id: undefined },
        { id: -1 }, { id: 1.5 }, { aud: [config.clientId, 'other'] } ]) {
        await assert.rejects(verifyTelegramIdToken(sign({ ...claims, ...changed }), config, options));
    }
    assert.equal((await verifyTelegramIdToken(sign({ ...claims, aud: [config.clientId, 'other'], azp: config.clientId }), config, options)).telegramId, '99887766');
});

test('Telegram JWT не принимает подменённую подпись, alg none, HS256 и произвольный kid', async () => {
    const parts = sign().split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...claims, id: 1 })).toString('base64url');
    await assert.rejects(verifyTelegramIdToken(parts.join('.'), config, options));
    for (const header of [{ alg: 'none', kid: jwk.kid }, { alg: 'HS256', kid: jwk.kid }, { alg: 'RS256', kid: 'other' }, { alg: 'RS256', kid: jwk.kid, crit: ['custom'] }]) {
        await assert.rejects(verifyTelegramIdToken(sign(claims, header), config, options));
    }
    await assert.rejects(verifyTelegramIdToken(sign(), config, { ...options, telegramJwks: [jwk, jwk] }));
});

function dbHarness() {
    const challenges = new Map(), calls = [];
    const user = { user_id: 12, telegram_id: '99887766', role: 'reader', username: 'Telegram reader' };
    const dbRequest = async (table, query, request = {}) => {
        calls.push({ table, body: request.body });
        const p = request.body;
        if (table === 'telegram_login_challenges') {
            const c = challenges.get(query.challenge_id.slice(3));
            return c ? [{ proof_hash: c.p_proof_hash, consumed_at: c.consumed ? new Date(now).toISOString() : null, expires_at: c.expires_at || new Date(now + 600000).toISOString() }] : [];
        }
        if (table === 'rpc/auth_take_login_attempt') return true;
        if (table === 'rpc/auth_begin_telegram_login') { challenges.set(p.p_challenge_id, p); return true; }
        if (table === 'rpc/auth_finish_telegram_login') {
            const c = challenges.get(p.p_challenge_id);
            if (!c || c.consumed || c.p_nonce_hash !== p.p_nonce_hash || c.p_proof_hash !== p.p_proof_hash || c.p_client_id !== p.p_client_id) return null;
            c.consumed = true;
            return { success: true, user };
        }
        throw new Error('Unexpected database call');
    };
    return { challenges, calls, user, options: { ...options, telegramLoginConfig: config, dbRequest, publicSessionUser: user => user } };
}

test('подготовка Telegram сохраняет только хеши браузерного подтверждения', async () => {
    const h = dbHarness();
    const result = await handleTelegramAuthAction('beginTelegramLogin', {}, h.options);
    assert.equal(result.success, true);
    assert.equal(result.client_id, config.clientId);
    assert.equal(result.expires_in, 600);
    assert.equal(h.challenges.get(result.challenge_id).p_nonce_hash, telegramProofHash(result.nonce));
    assert.equal(h.challenges.get(result.challenge_id).p_proof_hash, telegramProofHash(result.proof));
    assert.ok(!JSON.stringify(h.calls).includes(result.proof));
});

const redirectConfig = getTelegramLoginConfig({ TELEGRAM_LOGIN_ENABLED: 'true', TELEGRAM_CLIENT_ID: config.clientId,
    TELEGRAM_LOGIN_MODE: 'redirect', TELEGRAM_CLIENT_SECRET: 'synthetic-client-secret-not-for-production' });
const redirectUri = 'http://127.0.0.1:3000/';
async function redirectHarness() {
    const h = dbHarness();
    h.options.telegramLoginConfig = redirectConfig;
    const begin = await handleTelegramAuthAction('beginTelegramLogin', { redirect_uri: redirectUri }, h.options);
    const exchanges = [];
    h.options.telegramTokenFetchImpl = async (url, request) => {
        exchanges.push({ url, request });
        return new Response(JSON.stringify({ id_token: sign({ ...claims, nonce: begin.nonce }), access_token: 'discard-this-access-token' }), { status: 200 });
    };
    return { ...h, begin, exchanges, data: { challenge_id: begin.challenge_id, proof: begin.proof, redirect_uri: redirectUri, code: 'synthetic-authorization-code' } };
}

test('переход в Telegram использует code, PKCE S256 и только заранее разрешённый адрес', async () => {
    const h = await redirectHarness();
    assert.equal(h.begin.success, true);
    assert.equal(h.begin.mode, 'redirect');
    const url = new URL(h.begin.authorization_url);
    assert.equal(url.origin, 'https://oauth.telegram.org');
    assert.equal(url.pathname, '/auth');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), h.begin.challenge_id);
    assert.equal(url.searchParams.get('nonce'), h.begin.nonce);
    assert.equal(url.searchParams.get('scope'), 'openid profile');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(h.begin.proof).digest('base64url'));
    assert.ok(!JSON.stringify(h.begin).includes(redirectConfig.clientSecret));
    assert.ok(!h.begin.authorization_url.includes(h.begin.proof));
    const count = h.challenges.size;
    assert.equal((await handleTelegramAuthAction('beginTelegramLogin', { redirect_uri: 'https://attacker.invalid/' }, h.options)).success, false);
    assert.equal(h.challenges.size, count);
});

test('код обменивается только сервером; повторный ответ не создаёт второй сеанс', async () => {
    const h = await redirectHarness();
    const result = await handleTelegramAuthAction('authenticateTelegram', h.data, h.options);
    assert.equal(result.success, true);
    assert.equal(result.user.role, 'reader');
    assert.equal(result.user.email, undefined);
    assert.equal(result.id_token, undefined);
    assert.equal(result.access_token, undefined);
    assert.equal(h.exchanges.length, 1);
    const exchange = h.exchanges[0];
    assert.equal(exchange.url, 'https://oauth.telegram.org/token');
    assert.equal(exchange.request.redirect, 'error');
    assert.equal(exchange.request.headers.Authorization, 'Basic ' + Buffer.from(config.clientId + ':' + redirectConfig.clientSecret).toString('base64'));
    const body = new URLSearchParams(exchange.request.body);
    assert.equal(body.get('code_verifier'), h.begin.proof);
    assert.equal(body.get('redirect_uri'), redirectUri);
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', h.data, h.options)).success, false);
    assert.equal(h.exchanges.length, 1);
});

test('чужое подтверждение, изменённый redirect URI и истёкший запрос не используют Client Secret', async () => {
    const h = await redirectHarness();
    for (const changed of [{ proof: 'a'.repeat(64) }, { redirect_uri: 'https://xianbv.github.io/logovo_novel/' }, { redirect_uri: 'https://attacker.invalid/' }]) {
        assert.equal((await handleTelegramAuthAction('authenticateTelegram', { ...h.data, ...changed }, h.options)).success, false);
    }
    h.challenges.get(h.begin.challenge_id).expires_at = new Date(now - 1000).toISOString();
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', h.data, h.options)).success, false);
    assert.equal(h.exchanges.length, 0);
});

test('неверная подпись или отказ обмена не создают аккаунт и не раскрывают секрет', async () => {
    for (const failure of ['provider', 'signature', 'nonce']) {
        const h = await redirectHarness();
        h.options.telegramTokenFetchImpl = async () => new Response(JSON.stringify(failure === 'provider' ? { error_description: redirectConfig.clientSecret }
            : { id_token: failure === 'signature' ? 'broken.token.signature' : sign({ ...claims, nonce: 'b'.repeat(64) }) }), { status: failure === 'provider' ? 400 : 200 });
        const result = await handleTelegramAuthAction('authenticateTelegram', h.data, h.options);
        assert.equal(result.success, false);
        assert.ok(!JSON.stringify(result).includes(redirectConfig.clientSecret));
        assert.equal(h.challenges.get(h.begin.challenge_id).consumed, undefined);
    }
});

test('redirect-вход без секрета отключён и не обращается к базе', async () => {
    const result = await handleTelegramAuthAction('beginTelegramLogin', { redirect_uri: redirectUri }, {
        env: { TELEGRAM_LOGIN_ENABLED: 'true', TELEGRAM_CLIENT_ID: config.clientId, TELEGRAM_LOGIN_MODE: 'redirect' },
        dbRequest() { throw new Error('Unexpected database call'); }
    });
    assert.equal(result.code, 'TELEGRAM_NOT_CONFIGURED');
});

test('Telegram входит без почты, повторное использование и чужой браузер отклоняются', async () => {
    const h = dbHarness();
    const begin = await handleTelegramAuthAction('beginTelegramLogin', {}, h.options);
    const data = { challenge_id: begin.challenge_id, proof: begin.proof, id_token: sign({ ...claims, nonce: begin.nonce, role: 'owner', email: 'untrusted@example.test' }) };
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', { ...data, proof: 'b'.repeat(64) }, h.options)).success, false);
    const result = await handleTelegramAuthAction('authenticateTelegram', data, h.options);
    assert.equal(result.success, true);
    assert.equal(result.user.role, 'reader');
    assert.equal(result.user.email, undefined);
    assert.match(result.session_token, /^[a-f0-9-]{36}$/);
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', data, h.options)).success, false);
    assert.ok(h.calls.filter(c => c.table.endsWith('finish_telegram_login')).every(c => !('p_role' in c.body) && !('p_email' in c.body)));
});

test('Telegram не передаёт неподписанные старые данные или неверный JWT в создание сессии', async () => {
    const h = dbHarness();
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', { id: 99887766, hash: 'fake' }, h.options)).success, false);
    const begin = await handleTelegramAuthAction('beginTelegramLogin', {}, h.options);
    assert.equal((await handleTelegramAuthAction('authenticateTelegram', { ...begin, id_token: 'broken' }, h.options)).success, false);
    assert.equal(h.calls.filter(c => c.table.endsWith('finish_telegram_login')).length, 0);
});

test('неподключённый Telegram даёт понятную ошибку и не обращается к базе', async () => {
    const result = await handleTelegramAuthAction('beginTelegramLogin', {}, { env: {}, dbRequest() { throw new Error('Unexpected database call'); } });
    assert.equal(result.code, 'TELEGRAM_NOT_CONFIGURED');
});

test('серверный маршрут Telegram не требует старого сеанса или email', async () => {
    const h = dbHarness();
    const begin = await handleDirectMutation('beginTelegramLogin', {}, h.options);
    const result = await handleDirectMutation('authenticateTelegram', { challenge_id: begin.challenge_id, proof: begin.proof, id_token: sign({ ...claims, nonce: begin.nonce }) }, h.options);
    assert.equal(result.success, true);
    assert.equal(result.user.auth_type, 'telegram');
    assert.equal(result.user.email, null);
    assert.deepEqual(result.user.features, ['personal_novels', 'community_novels']);
});
