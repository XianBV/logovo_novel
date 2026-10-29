import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getAccountEmailConfig, getAccountMailAvailability, sendAccountEmail } from './account-auth.js';

const source = await readFile(new URL('./email-relay/Code.gs', import.meta.url), 'utf8');
const secret = 'synthetic-mail-relay-secret-'.repeat(2);
function relayHarness() {
    const state = { sent: [], cache: new Map(), quota: 100, locked: false, busy: false, secret, failSend: false };
    const context = vm.createContext({
        PropertiesService: { getScriptProperties() { return { getProperty() { return state.secret; } }; } },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput(value) { return { value, setMimeType() { return this; } }; } },
        Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature(text, key) { return Array.from(crypto.createHmac('sha256', key).update(text).digest(), byte => byte > 127 ? byte - 256 : byte); } },
        LockService: { getScriptLock() { return { tryLock() { if (state.busy) return false; state.locked = true; return true; }, releaseLock() { state.locked = false; } }; } },
        CacheService: { getScriptCache() { return { get: key => state.cache.get(key), put(key, value) { state.cache.set(key, value); } }; } },
        MailApp: { getRemainingDailyQuota: () => state.quota, sendEmail(mail) { if (state.failSend) throw Error('Private provider detail'); state.sent.push(mail); } }
    });
    vm.runInContext(source, context);
    const run = envelope => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(envelope) } }).value);
    return { state, run };
}
function sign(mail = {}, timestamp = Date.now()) {
    const payload = JSON.stringify({ to: 'reader@example.test', subject: 'Подтверждение почты — Логово новелл', text: 'Синтетическое письмо', ...mail });
    const nonce = crypto.randomBytes(16).toString('hex');
    return { issued_at: timestamp, nonce, payload, signature: crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${payload}`).digest('hex') };
}

test('Google-отправитель принимает корректно подписанное письмо', () => {
    const h = relayHarness();
    assert.equal(h.run(sign()).code, 'sent');
    assert.equal(h.state.sent.length, 1);
    assert.equal(h.state.sent[0].to, 'reader@example.test');
    assert.equal(h.state.sent[0].name, 'Логово новелл');
    assert.equal(h.state.locked, false);
});

test('без правильной подписи письма не отправляются', () => {
    const h = relayHarness(), request = sign();
    request.signature = '0'.repeat(64);
    assert.equal(h.run(request).success, false);
    assert.equal(h.state.sent.length, 0);
});

test('подмена получателя после подписания отклоняется', () => {
    const h = relayHarness(), request = sign();
    request.payload = request.payload.replace('reader@', 'attacker@');
    assert.equal(h.run(request).success, false);
    assert.equal(h.state.sent.length, 0);
});

test('просроченный подписанный запрос отклоняется', () => {
    const h = relayHarness();
    assert.equal(h.run(sign({}, Date.now() - 301000)).success, false);
    assert.equal(h.state.sent.length, 0);
});

test('повтор одного запроса не создаёт дополнительное письмо', () => {
    const h = relayHarness(), request = sign();
    assert.equal(h.run(request).code, 'sent');
    assert.equal(h.run(request).code, 'duplicate');
    assert.equal(h.state.sent.length, 1);
});

test('при исчерпанной квоте отправка не вызывается', () => {
    const h = relayHarness();
    h.state.quota = 0;
    assert.equal(h.run(sign()).code, 'quota');
    assert.equal(h.state.sent.length, 0);
    assert.equal(h.state.locked, false);
});

test('занятый отправитель не обходит блокировку', () => {
    const h = relayHarness();
    h.state.busy = true;
    assert.equal(h.run(sign()).code, 'busy');
    assert.equal(h.state.sent.length, 0);
});

test('многоадресная отправка и переносы в теме запрещены', () => {
    const h = relayHarness();
    assert.equal(h.run(sign({ to: 'a@example.test,b@example.test' })).success, false);
    assert.equal(h.run(sign({ subject: 'Subject\r\nBcc: somebody@example.test' })).success, false);
    assert.equal(h.state.sent.length, 0);
});

test('без ключа в свойствах скрипта отправка выключена', () => {
    const h = relayHarness();
    h.state.secret = '';
    assert.equal(h.run(sign()).code, 'not_configured');
    assert.equal(h.state.sent.length, 0);
});

test('ошибка отправки не раскрывает детали и освобождает блокировку', () => {
    const h = relayHarness();
    h.state.failSend = true;
    const response = h.run(sign());
    assert.equal(response.code, 'failed');
    assert.doesNotMatch(JSON.stringify(response), /Private|secret|reader@/);
    assert.equal(h.state.locked, false);
});

test('подключение требует доверенный URL Google и достаточно длинный ключ', () => {
    const env = { AUTH_EMAIL_ENABLED: 'true', AUTH_EMAIL_PROVIDER: 'apps-script', AUTH_SITE_URL: 'https://example.test/', AUTH_MAIL_RELAY_URL: 'https://script.google.com/macros/s/synthetic-deployment/exec', AUTH_MAIL_RELAY_SECRET: secret };
    assert.equal(getAccountEmailConfig(env).configured, true);
    assert.equal(getAccountEmailConfig({ ...env, AUTH_MAIL_RELAY_URL: 'https://example.test/exec' }).configured, false);
    assert.equal(getAccountEmailConfig({ ...env, AUTH_MAIL_RELAY_SECRET: 'short' }).configured, false);
    assert.equal(getAccountEmailConfig({ ...env, AUTH_EMAIL_ENABLED: 'false' }).configured, false);
});

test('сервер и Google-отправитель согласуют подпись без передачи секретного ключа', async () => {
    const h = relayHarness();
    let outgoing;
    const config = getAccountEmailConfig({ AUTH_EMAIL_ENABLED: 'true', AUTH_EMAIL_PROVIDER: 'apps-script', AUTH_SITE_URL: 'https://example.test/library/', AUTH_MAIL_RELAY_URL: 'https://script.google.com/macros/s/synthetic-deployment/exec', AUTH_MAIL_RELAY_SECRET: secret });
    await sendAccountEmail({ to: 'reader@example.test', purpose: 'password_reset', token: 'a'.repeat(64) }, {
        accountEmailConfig: config,
        emailFetchImpl: async (_url, request) => {
            outgoing = request;
            return { ok: true, json: async () => h.run(JSON.parse(request.body)) };
        }
    });
    assert.equal(h.state.sent.length, 1);
    assert.match(h.state.sent[0].body, /account_action=reset/);
    assert.equal(outgoing.body.includes(secret), false);
    assert.ok(outgoing.signal);
});

test('отказ Google-отправителя не принимается за успешную доставку', async () => {
    const config = { enabled: true, configured: true, provider: 'apps-script', relayUrl: 'https://script.google.com/macros/s/test/exec', relaySecret: secret, siteUrl: new URL('https://example.test/') };
    await assert.rejects(sendAccountEmail({ to: 'reader@example.test', purpose: 'email_confirm', token: 'a'.repeat(64) }, { accountEmailConfig: config, emailFetchImpl: async () => ({ ok: true, json: async () => ({ success: false, code: 'quota' }) }) }), /не принял/);
});

test('проверка остатка квоты не отправляет письмо', () => {
    const h = relayHarness();
    const response = h.run(sign({ action: 'status' }));
    assert.equal(response.success, true);
    assert.equal(response.remaining, 100);
    assert.equal(h.state.sent.length, 0);
});

test('сервер заранее обнаруживает нулевую квоту и кеширует проверку', async () => {
    const h = relayHarness();
    h.state.quota = 0;
    const config = { provider: 'apps-script', configured: true, relayUrl: 'https://script.google.com/macros/s/status-zero/exec', relaySecret: secret, codeSecret: secret };
    let calls = 0;
    const options = { accountEmailConfig: config, emailFetchImpl: async (_url, request) => { calls++; return { ok: true, json: async () => h.run(JSON.parse(request.body)) }; } };
    assert.equal((await getAccountMailAvailability(options)).code, 'MAIL_DAILY_LIMIT');
    assert.equal((await getAccountMailAvailability(options)).code, 'MAIL_DAILY_LIMIT');
    assert.equal(calls, 1);
    assert.equal(h.state.sent.length, 0);
});

test('сбой проверки квоты даёт понятную временную недоступность', async () => {
    const config = { provider: 'apps-script', configured: true, relayUrl: 'https://script.google.com/macros/s/status-offline/exec', relaySecret: secret };
    const result = await getAccountMailAvailability({ accountEmailConfig: config, emailFetchImpl: async () => { throw Error('Network unavailable'); } });
    assert.equal(result.code, 'MAIL_UNAVAILABLE');
    assert.equal(result.retry_after, 60);
});
