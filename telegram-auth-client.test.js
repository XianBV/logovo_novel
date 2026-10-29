import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./js/auth.js', import.meta.url), 'utf8');
function telegramClient(response) {
    const requests = [], logs = [], stored = new Map(), timers = [], toasts = [];
    const context = vm.createContext({
        console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
        window: { location: { reload() {} } }, STATE: { currentUser: null },
        localStorage: { setItem: (key, value) => stored.set(key, value) },
        async apiPostRequest(action, data) { requests.push({ action, data }); return response; },
        apiRequest() { throw new Error('Telegram must not use the cached GET/JSONP transport'); },
        showLoading() {}, updateUserDisplay() {}, hideModal() {},
        showToast: (...args) => toasts.push(args), setTimeout: callback => timers.push(callback)
    });
    vm.runInContext(source, context);
    return { context, requests, logs, stored, timers, toasts };
}

test('Telegram передаёт подписанные данные через POST и допускает аккаунт без почты', async () => {
    const user = { user_id: 23, username: 'Telegram reader', role: 'reader', features: [] };
    const h = telegramClient({ success: true, user, session_token: 'synthetic-session' });
    const signed = { id_token: 'synthetic-signed-token', challenge_id: 'synthetic-challenge', proof: 'synthetic-proof' };
    assert.equal(await h.context.window.onTelegramAuth(signed), true);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].action, 'authenticateTelegram');
    assert.equal(h.requests[0].data, signed);
    assert.equal(h.context.STATE.currentUser, user);
    assert.equal(h.stored.get('session_token'), 'synthetic-session');
    assert.equal(h.timers.length, 1);
    assert.ok(!JSON.stringify(h.logs).includes(signed.id_token));
    assert.ok(!JSON.stringify(h.logs).includes(signed.proof));
});

test('отклонённый Telegram-вход не сохраняет сеанс и не журналирует подпись', async () => {
    const h = telegramClient({ success: false, error: 'Подпись неверна' });
    assert.equal(await h.context.window.onTelegramAuth({ id_token: 'private-synthetic-signature' }), false);
    assert.equal(h.stored.size, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(h.context.STATE.currentUser, null);
    assert.equal(h.toasts.at(-1)[1], 'error');
    assert.ok(!JSON.stringify(h.logs).includes('private-synthetic-signature'));
});

const sdkSource = await readFile(new URL('./js/telegram-login.js', import.meta.url), 'utf8');
function popupHarness({ response, post, sdkFailure } = {}) {
    const requests = [], popups = [], completed = [], timers = new Map();
    let timerId = 0, now = 100000, shown = true;
    const button = { disabled: false, textContent: '' }, status = { textContent: '' };
    const elements = {
        'auth-modal': { classList: { contains: () => shown } }, 'auth-container': { style: { display: 'flex' } },
        'telegram-widget-placeholder': { innerHTML: '' }, 'telegram-login-button': button, 'telegram-login-status': status
    };
    const context = vm.createContext({
        Date: { now: () => now },
        document: { getElementById: id => elements[id] },
        window: { Telegram: { Login: { init() {}, auth: (options, callback) => {
            if (sdkFailure) return Promise.reject(new Error('SDK failed'));
            popups.push({ options, callback });
        } } }, onTelegramAuth: async data => { completed.push(data); return true; } },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        async apiPostRequest(action, data) {
            requests.push({ action, data });
            if (post) return post();
            return response || { success: true, client_id: '123456789', challenge_id: 'challenge', nonce: 'n'.repeat(64), proof: 'p'.repeat(64), expires_in: 600 };
        },
        localStorage: { setItem() { throw new Error('Telegram proof must stay in memory'); } },
        sessionStorage: { setItem() { throw new Error('Telegram proof must stay in memory'); } }
    });
    vm.runInContext(sdkSource, context);
    return { context, requests, popups, completed, timers, button, status, elements, hide: () => { shown = false; context.cancelTelegramLogin(); }, advance: ms => { now += ms; } };
}

test('Telegram готовится заранее, а popup открывается только при нажатии без лишних разрешений', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].action, 'beginTelegramLogin');
    assert.equal(h.popups.length, 0);
    h.context.startTelegramLogin();
    h.context.startTelegramLogin();
    assert.equal(h.popups.length, 1);
    assert.equal(h.popups[0].options.client_id, 123456789);
    assert.deepEqual(Array.from(h.popups[0].options.scope), ['profile']);
    assert.equal(h.popups[0].options.nonce, 'n'.repeat(64));
    await h.popups[0].callback({ id_token: 'signed-token', user: { role: 'owner' } });
    await h.popups[0].callback({ id_token: 'signed-token' });
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].id_token, 'signed-token');
    assert.equal(h.completed[0].proof, 'p'.repeat(64));
    assert.equal(h.completed[0].user, undefined);
});

test('закрытие окна входа игнорирует запоздавший результат Telegram', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.context.startTelegramLogin();
    h.hide();
    await h.popups[0].callback({ id_token: 'late-token' });
    assert.equal(h.completed.length, 0);
    assert.equal(h.timers.size, 0);
});

test('запоздавшая подготовка после закрытия формы не возрождает подтверждение', async () => {
    let finish;
    const h = popupHarness({ post: () => new Promise(resolve => { finish = resolve; }) });
    const preparing = h.context.prepareTelegramLogin();
    h.hide();
    finish({ success: true, client_id: '123456789', challenge_id: 'late', nonce: 'n'.repeat(64), proof: 'p'.repeat(64) });
    await preparing;
    assert.equal(vm.runInContext('telegramLoginChallenge', h.context), null);
    assert.equal(h.popups.length, 0);
});

test('просроченное подтверждение сначала обновляется и не открывает старый popup', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.advance(600001);
    h.context.startTelegramLogin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.popups.length, 0);
    assert.equal(h.requests.length, 2);
    h.context.startTelegramLogin();
    assert.equal(h.popups.length, 1);
});

test('отмена или ошибка SDK позволяет повторить вход без сохранения токена', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.context.startTelegramLogin();
    await h.popups[0].callback({ error: 'popup_closed' });
    assert.equal(h.completed.length, 0);
    assert.equal(h.button.disabled, false);
    assert.match(h.status.textContent, /отменён/);
    const broken = popupHarness({ sdkFailure: true });
    await broken.context.prepareTelegramLogin();
    broken.context.startTelegramLogin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(broken.button.disabled, false);
    assert.match(broken.status.textContent, /Не удалось открыть/);
});

test('неподключённый Telegram оставляет доступным вход по почте и понятную повторную попытку', async () => {
    const h = popupHarness({ response: { success: false, code: 'TELEGRAM_NOT_CONFIGURED' } });
    await h.context.prepareTelegramLogin();
    assert.equal(h.popups.length, 0);
    assert.equal(h.button.disabled, false);
    assert.match(h.status.textContent, /войти по почте/);
});
