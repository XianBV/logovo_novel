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
    const requests = [], popups = [], completed = [], timers = new Map(), listeners = new Map();
    let timerId = 0, now = 100000, shown = true;
    const button = { disabled: false, textContent: '' }, status = { textContent: '', dataset: {} };
    const widget = { innerHTML: '', parentElement: null };
    const slot = () => ({ appendChild(child) { child.parentElement = this; } });
    const elements = {
        'auth-modal': { classList: { contains: () => shown } }, 'auth-container': { style: { display: 'flex' } },
        'registration-container': { style: { display: 'none' } },
        'telegram-login-slot': slot(), 'telegram-register-slot': slot(),
        'telegram-widget-placeholder': widget, 'telegram-login-button': button, 'telegram-login-status': status
    };
    const context = vm.createContext({
        Date: { now: () => now }, URL, atob: text => Buffer.from(text, 'base64').toString('binary'),
        document: { getElementById: id => elements[id] },
        window: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); }, Telegram: { Login: { init() {}, auth: (options, callback) => {
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
    return { context, requests, popups, completed, timers, listeners, button, status, elements,
        hide: () => { shown = false; context.cancelTelegramLogin(); }, advance: ms => { now += ms; },
        message: (data, overrides = {}) => listeners.get('message')?.({ origin: 'https://oauth.telegram.org', source: {}, data, ...overrides }),
        fireDelay: delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay && timers.has(id)) { timers.delete(id); timer.callback(); } }
    };
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

const redirectChallenge = '11111111-1111-4111-8111-111111111111';
const redirectCallback = 'http://127.0.0.1:3000/';
const redirectResponse = { success: true, mode: 'redirect', client_id: '123456789', challenge_id: redirectChallenge,
    nonce: 'c'.repeat(64), proof: 'd'.repeat(64), redirect_uri: redirectCallback, expires_in: 600,
    authorization_url: 'https://oauth.telegram.org/auth?' + new URLSearchParams({ client_id: '123456789', response_type: 'code',
        state: redirectChallenge, redirect_uri: redirectCallback, scope: 'openid profile' }).toString() };
const pendingKey = 'logovo.telegram.redirect.v1';
function redirectClient({ url = redirectCallback + '?page=profile', storage = new Map(), response = redirectResponse } = {}) {
    const h = popupHarness({ response });
    const navigations = [], histories = [], toasts = [];
    const location = { href: url, assign(next) { navigations.push(next); location.href = next; } };
    h.context.window.location = location;
    h.context.window.history = { state: {}, replaceState(_state, _title, next) { location.href = new URL(next, location.href).href; histories.push(location.href); } };
    h.context.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    h.context.window.Telegram = undefined;
    h.context.document.createElement = () => { throw new Error('Redirect mode must not load the popup SDK'); };
    h.context.window.open = () => { throw new Error('Redirect mode must not open a popup'); };
    h.context.showToast = (...args) => toasts.push(args);
    return { ...h, navigations, histories, toasts, storage };
}

test('вход в той же вкладке не зависит от SDK и хранит только временное подтверждение', async () => {
    const h = redirectClient();
    await h.context.prepareTelegramLogin();
    assert.equal(h.requests[0].data.redirect_uri, redirectCallback);
    h.context.startTelegramLogin();
    assert.equal(h.popups.length, 0);
    assert.equal(h.navigations.length, 1);
    assert.equal(h.navigations[0], redirectResponse.authorization_url);
    const pending = JSON.parse(h.storage.get(pendingKey));
    assert.equal(pending.proof, redirectResponse.proof);
    assert.equal(pending.challenge_id, redirectChallenge);
    assert.equal(pending.return_url, redirectCallback + '?page=profile');
    assert.equal(pending.id_token, undefined);
    assert.equal(pending.client_secret, undefined);
});

test('возврат Telegram удаляет code из адреса и завершает вход один раз', async () => {
    const start = redirectClient();
    await start.context.prepareTelegramLogin(); start.context.startTelegramLogin();
    const h = redirectClient({ storage: start.storage, url: redirectCallback + '?code=synthetic-code&state=' + redirectChallenge });
    let calls = 0;
    h.context.window.onTelegramAuth = async data => {
        calls++;
        assert.equal(data.code, 'synthetic-code');
        assert.equal(data.proof, redirectResponse.proof);
        assert.equal(data.redirect_uri, redirectCallback);
        assert.equal(h.storage.has(pendingKey), false);
        assert.equal(h.context.window.location.href, redirectCallback + '?page=profile');
        return true;
    };
    const first = h.context.captureTelegramReturn(), second = h.context.captureTelegramReturn();
    assert.equal(first, second);
    assert.equal(await first, true);
    assert.equal(calls, 1);
    assert.ok(h.histories.every(url => !url.includes('code=')));
    const repeated = redirectClient({ storage: h.storage, url: redirectCallback + '?code=synthetic-code&state=' + redirectChallenge });
    assert.equal(await repeated.context.captureTelegramReturn(), false);
    assert.equal(repeated.completed.length, 0);
});

test('чужая вкладка, изменённый state, истечение срока и внешняя страница не завершают вход', async () => {
    for (const change of [null, { challenge_id: 'other' }, { until: 0 }, { return_url: 'https://attacker.invalid/' }, { redirect_uri: 'https://attacker.invalid/' }]) {
        const pending = change === null ? null : { challenge_id: redirectChallenge, proof: redirectResponse.proof, until: 695000,
            redirect_uri: redirectCallback, return_url: redirectCallback, ...change };
        const storage = new Map(pending ? [[pendingKey, JSON.stringify(pending)]] : []);
        const h = redirectClient({ storage, url: redirectCallback + '?code=synthetic-code&state=' + redirectChallenge });
        assert.equal(await h.context.captureTelegramReturn(), false);
        assert.equal(h.completed.length, 0);
        assert.ok(!h.context.window.location.href.includes('code='));
        assert.equal(h.navigations.length, 0);
    }
});

test('запрет временного хранения или посторонний адрес не уводит пользователя со страницы', async () => {
    const h = redirectClient();
    await h.context.prepareTelegramLogin();
    h.context.sessionStorage.setItem = () => { throw new Error('Storage blocked'); };
    h.context.startTelegramLogin();
    assert.equal(h.navigations.length, 0);
    assert.equal(h.button.disabled, false);
    const bad = redirectClient({ response: { ...redirectResponse, authorization_url: 'https://attacker.invalid/' } });
    await bad.context.prepareTelegramLogin(); bad.context.startTelegramLogin();
    assert.equal(bad.navigations.length, 0);
    assert.equal(bad.storage.size, 0);
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
    assert.equal(h.button.disabled, true);
    h.fireDelay(1500);
    assert.equal(h.completed.length, 0);
    assert.equal(h.button.disabled, false);
    assert.match(h.status.textContent, /Окно Telegram закрылось/);
    const broken = popupHarness({ sdkFailure: true });
    await broken.context.prepareTelegramLogin();
    broken.context.startTelegramLogin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(broken.button.disabled, false);
    assert.match(broken.status.textContent, /Не удалось открыть/);
});

function messageToken(nonce = 'n'.repeat(64)) {
    // Подпись проверяется отдельными серверными тестами; здесь проверяется транспорт.
    return ['header', Buffer.from(JSON.stringify({ nonce })).toString('base64url'), 'signature'].join('.');
}

test('закрытие popup перед доставкой подписанного ответа не отменяет вход', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.context.startTelegramLogin();
    await h.popups[0].callback({ error: 'popup_closed' });
    const token = messageToken();
    h.message(JSON.stringify({ event: 'auth_result', result: token }));
    await new Promise(resolve => setImmediate(resolve));
    h.fireDelay(1500);
    await h.popups[0].callback({ id_token: token });
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].id_token, token);
    assert.equal(h.completed[0].proof, 'p'.repeat(64));
    assert.equal(h.status.dataset.telegramError, undefined);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.timers.size, 0);
});

test('сообщение Telegram от чужого сайта, без источника или с другим nonce игнорируется', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.context.startTelegramLogin();
    const data = { event: 'auth_result', result: messageToken() };
    h.message(data, { origin: 'https://attacker.invalid' });
    h.message(data, { source: null });
    h.message(data, { source: h.context.window });
    h.message({ ...data, result: messageToken('other-attempt') });
    h.message({ ...data, event: 'unrelated' });
    h.message({ ...data, result: 'broken-token' });
    h.message('{invalid json');
    assert.equal(h.completed.length, 0);
    h.message(data);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.completed.length, 1);
});

test('отмена формы очищает слушатель и ожидание закрытия popup', async () => {
    const h = popupHarness();
    await h.context.prepareTelegramLogin();
    h.context.startTelegramLogin();
    await h.popups[0].callback({ error: 'popup_closed' });
    h.hide();
    h.message({ event: 'auth_result', result: messageToken() });
    h.fireDelay(1500);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.completed.length, 0);
});

test('неподключённый Telegram оставляет доступным вход по почте и понятную повторную попытку', async () => {
    const h = popupHarness({ response: { success: false, code: 'TELEGRAM_NOT_CONFIGURED' } });
    await h.context.prepareTelegramLogin();
    assert.equal(h.popups.length, 0);
    assert.equal(h.button.disabled, false);
    assert.match(h.status.textContent, /войти по почте/);
});

test('возвращение из почтовой формы готовит Telegram, сохраняя текущий аккаунт', async () => {
    const h = popupHarness();
    h.elements['auth-container'].style.display = 'none';
    h.elements['registration-container'] = { style: { display: 'none' } };
    const storedUser = { user_id: 1, username: 'Existing reader' };
    h.context.STATE = { currentUser: storedUser };
    vm.runInContext(source, h.context);
    h.context.showLogin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.elements['auth-container'].style.display, 'flex');
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].action, 'beginTelegramLogin');
    assert.equal(h.button.disabled, false);
    assert.equal(h.popups.length, 0);
    assert.equal(h.context.STATE.currentUser, storedUser);
});

test('Telegram доступен в регистрации без заполнения почтовых полей и использует один виджет', async () => {
    const h = popupHarness();
    vm.runInContext(source, h.context);
    h.context.showRegistration();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.elements['registration-container'].style.display, 'flex');
    assert.equal(h.elements['telegram-widget-placeholder'].parentElement, h.elements['telegram-register-slot']);
    h.context.startTelegramLogin();
    assert.equal(h.popups.length, 1);
    h.context.showLogin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.elements['telegram-widget-placeholder'].parentElement, h.elements['telegram-login-slot']);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.button.disabled, false);
});
