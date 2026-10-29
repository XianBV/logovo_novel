import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./js/account-email.js', import.meta.url), 'utf8');
function harness(hash = '', session = new Map()) {
    let clock = Date.now(), intervalId = 0; const intervals = new Map();
    const elements = new Map(), requests = [], disabled = [], storage = new Map([['session_token', 'old']]);
    const element = id => {
        if (!elements.has(id)) elements.set(id, { style: {}, value: '', textContent: '', innerHTML: '', focus() {} });
        return elements.get(id);
    };
    const location = { hash, href: `https://example.test/library/?page=home${hash}` }, listeners = {};
    const context = vm.createContext({
        URL, URLSearchParams, Date: class extends Date { static now() { return clock; } },
        setInterval(callback) { const id = ++intervalId; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); },
        sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
        document: { getElementById: element }, STATE: { currentUser: { user_id: 1 } },
        window: { location, addEventListener(name, handler) { listeners[name] = handler; }, history: { state: {}, replaceState(_state, _unused, url) { location.hash = url.hash; location.href = url.href; } } },
        localStorage: { removeItem(key) { storage.delete(key); } },
        setAuthFormDisabled(form, value) { disabled.push([form, value]); },
        showModal() {}, showToast() {}, showLogin() { context.hideAccountHelp(); }, clearCache() {}, updateUserDisplay() {},
        async apiPostRequest(action, data) { requests.push({ action, data }); return { success: true, message: 'Готово' }; }
    });
    vm.runInContext(source, context);
    return { context, element, requests, storage, location, disabled, listeners, session, intervals, advance(ms) { clock += ms; [...intervals.values()].forEach(callback => callback()); } };
}

test('ссылка в уже открытой вкладке обрабатывается без перезагрузки', () => {
    const h = harness();
    const hash = `#account_action=confirm&token=${'f'.repeat(64)}`;
    h.location.hash = hash;
    h.location.href += hash;
    h.listeners.hashchange();
    assert.equal(h.location.hash, '');
    assert.equal(h.element('account-help-title').textContent, 'Подтверждение почты');
});

test('ссылка очищается из адреса сразу, подтверждение не отправляется автоматически', () => {
    const h = harness(`#account_action=confirm&token=${'a'.repeat(64)}`);
    h.context.captureAccountEmailLink();
    assert.equal(h.location.hash, '');
    assert.equal(h.requests.length, 0);
    assert.equal(h.element('account-help-title').textContent, 'Подтверждение почты');
    assert.equal(h.storage.has('token'), false);
});

test('подтверждение требует явного нажатия и передаёт токен только в POST', async () => {
    const token = 'b'.repeat(64);
    const h = harness(`#account_action=confirm&token=${token}`);
    h.context.captureAccountEmailLink();
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].action, 'confirmEmail');
    assert.equal(h.requests[0].data.token, token);
    assert.equal(h.location.hash, '');
});

test('повреждённый токен не вызывает серверный запрос', async () => {
    const h = harness('#account_action=reset&token=broken');
    h.context.captureAccountEmailLink();
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.location.hash, '');
    assert.equal(h.requests.length, 0);
});

test('форма восстановления проверяет повтор пароля до отправки', async () => {
    const h = harness(`#account_action=reset&token=${'c'.repeat(64)}`);
    h.context.captureAccountEmailLink();
    h.element('account-new-password').value = 'NewPassword2026!';
    h.element('account-repeat-password').value = 'DifferentPassword2026!';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 0);
    assert.match(h.element('account-help-status').textContent, /не совпадают/);
    h.element('account-repeat-password').value = 'NewPassword2026!';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests[0].action, 'resetPassword');
    assert.equal(h.storage.has('session_token'), false);
    assert.equal(h.context.STATE.currentUser, null);
    assert.equal(h.element('account-new-password').value, '');
    assert.equal(h.element('account-repeat-password').value, '');
});

test('несколько нажатий не отправляют несколько писем', async () => {
    const h = harness();
    let finish;
    h.context.apiPostRequest = (action, data) => { h.requests.push({ action, data }); return new Promise(resolve => { finish = resolve; }); };
    h.context.showAccountHelp('forgot');
    h.element('account-help-email').value = 'reader@example.test';
    const first = h.context.handleAccountEmailSubmit();
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 1);
    finish({ success: true, message: 'Проверьте почту' });
    await first;
});

test('форма нового пароля принимает восемь символов и отклоняет семь', async () => {
    const h = harness(`#account_action=reset&token=${'d'.repeat(64)}`);
    h.context.captureAccountEmailLink();
    for (const id of ['account-new-password', 'account-repeat-password']) h.element(id).value = '1234567';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 0);
    for (const id of ['account-new-password', 'account-repeat-password']) h.element(id).value = 'Test1234';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].data.password, 'Test1234');
});

test('поздний ответ не меняет другую открытую форму', async () => {
    const h = harness();
    let finish;
    h.context.apiPostRequest = () => new Promise(resolve => { finish = resolve; });
    h.context.showAccountHelp('forgot');
    h.element('account-help-email').value = 'reader@example.test';
    const first = h.context.handleAccountEmailSubmit();
    h.context.showAccountHelp('resend');
    finish({ success: true, message: 'Old response' });
    await first;
    assert.notEqual(h.element('account-help-status').textContent, 'Old response');
});

test('форма отклоняет кириллицу, пробелы и Unicode в новом пароле', async () => {
    const h = harness(`#account_action=reset&token=${'e'.repeat(64)}`);
    h.context.captureAccountEmailLink();
    for (const password of ['Password 8', 'Пароль123', 'Password🙂', 'Password\t']) {
        h.element('account-new-password').value = password;
        h.element('account-repeat-password').value = password;
        await h.context.handleAccountEmailSubmit();
    }
    assert.equal(h.requests.length, 0);
    h.element('account-new-password').value = 'AllASCII!?9';
    h.element('account-repeat-password').value = 'AllASCII!?9';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 1);
});

test('повторная отправка блокируется на 60 секунд и затем становится доступна', async () => {
    const h = harness();
    h.context.showAccountHelp('forgot');
    h.element('account-help-email').value = 'reader@example.test';
    await h.context.handleAccountEmailSubmit();
    assert.match(h.element('account-help-submit').textContent, /1:00/);
    assert.equal(h.element('account-help-submit').disabled, true);
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 1);
    h.advance(60001);
    assert.equal(h.element('account-help-submit').disabled, false);
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests.length, 2);
});

test('перезагрузка формы сохраняет cooldown и не сохраняет сам код', () => {
    const h = harness();
    h.context.rememberAccountEmailCooldown('reader@example.test', 'resend', 60);
    h.context.showAccountHelp('verify', 'reader@example.test', '', '12345678-1234-1234-1234-123456789abc');
    h.element('account-confirm-code').value = '654321';
    const reloaded = harness('', h.session);
    reloaded.context.captureAccountEmailLink();
    assert.equal(reloaded.element('account-help-title').textContent, 'Введите код из письма');
    assert.equal(reloaded.element('account-resend-code').disabled, true);
    assert.ok(![...h.session.values()].some(value => value.includes('654321')));
});

test('проверка кода доступна во время cooldown повторной отправки', async () => {
    const h = harness();
    h.context.rememberAccountEmailCooldown('reader@example.test', 'resend', 60);
    h.context.showAccountHelp('verify', 'reader@example.test', '', '12345678-1234-1234-1234-123456789abc');
    h.element('account-confirm-code').value = '654321';
    await h.context.handleAccountEmailSubmit();
    assert.equal(h.requests[0].action, 'confirmEmailCode');
});

test('дневной лимит показывается пользователю и блокирует частые проверки отправки', async () => {
    const h = harness();
    h.context.apiPostRequest = async () => ({ success: false, code: 'MAIL_DAILY_LIMIT', retry_after: 60, error: 'Дневной лимит писем закончился' });
    h.context.showAccountHelp('forgot');
    h.element('account-help-email').value = 'reader@example.test';
    await h.context.handleAccountEmailSubmit();
    assert.match(h.element('account-help-status').textContent, /Дневной лимит/);
    assert.equal(h.element('account-help-submit').disabled, true);
    h.context.hideAccountHelp();
    assert.equal(h.intervals.size, 0);
});
