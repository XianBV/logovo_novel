import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// Позволяет проверить те же сценарии на сохранённой исходной версии.
const sourceRoot = process.env.NOVEL_LAIR_SOURCE_ROOT || new URL('.', import.meta.url);
const readSource = file => readFile(sourceRoot instanceof URL ? new URL(file, sourceRoot) : path.join(sourceRoot, file), 'utf8');
const [apiSource, navigationSource, notificationSource] = await Promise.all([
    readSource('js/api.js'), readSource('js/navigation.js'), readSource('js/notifications.js')
]);
const quietConsole = { log() {}, warn() {}, error() {} };
const startupSource = await readSource('script.js');

function startupHarness(results) {
    const calls = [], delays = [], container = { innerHTML: '' };
    const context = vm.createContext({ console: quietConsole,
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return container; } },
        showSection() {}, setTimeout(fn, ms) { delays.push(ms); fn(); },
        async apiRequest(...args) { calls.push(args); const result = results.shift(); if (result instanceof Error) throw result; return result; }
    });
    vm.runInContext(startupSource, context);
    return { context, calls, delays, container };
}

test('начальная загрузка повторяет временный сетевой сбой один раз и сохраняет scope', async () => {
    const h = startupHarness([Error('fetch failed'), { success: true, scope: 'session' }]);
    assert.equal((await h.context.requestInitialData('session')).success, true);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1][1].scope, 'session');
    assert.equal(h.calls[1][2], true);
    assert.deepEqual(h.delays, [400]);
});

test('постоянная ошибка загрузки не повторяется бесконечно и оставляет кнопку восстановления', async () => {
    const h = startupHarness([Error('fetch failed'), Error('fetch failed')]);
    await assert.rejects(h.context.requestInitialData('full'), /fetch failed/);
    assert.equal(h.calls.length, 2);
    h.context.renderInitialDataError();
    assert.match(h.container.innerHTML, /role="alert"/);
    assert.match(h.container.innerHTML, /Повторить загрузку/);
    assert.doesNotMatch(h.container.innerHTML, /page-loading-animation/);
    const permanent = startupHarness([{ success: false, error: 'Нет доступа' }]);
    await assert.rejects(permanent.context.requestInitialData('session'), /Нет доступа/);
    assert.equal(permanent.calls.length, 1);
});
const tick = () => new Promise(setImmediate);
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function apiHarness() {
    const requests = [], timers = new Map(), storage = new Map([['session_token', 'test-session']]);
    let timerId = 0;
    const state = { cache: { data: {}, ttl: 300000 } };
    const context = vm.createContext({
        console: quietConsole, STATE: state, URLSearchParams, AbortController,
        window: { LOVO_API_BASE: 'http://test.invalid/api', location: { hostname: 'localhost', port: '5501' } },
        localStorage: { getItem: key => storage.get(key) ?? null },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch(url, options = {}) {
            const pending = deferred();
            options.signal?.addEventListener('abort', () => pending.reject(options.signal.reason), { once: true });
            requests.push({ url, options, ...pending });
            return pending.promise;
        }
    });
    vm.runInContext(apiSource, context);
    const respond = (index, body, ok = true) => requests[index].resolve({ ok, status: ok ? 200 : 503, json: async () => body });
    return { context, requests, timers, storage, state, respond };
}

test('одинаковые чтения используют один сетевой запрос и затем кэш', async () => {
    const h = apiHarness();
    const parameters = { novelId: 7 };
    const first = h.context.apiRequest('getNovel', parameters);
    const second = h.context.apiRequest('getNovel', { novelId: 7 });
    await tick();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(parameters, { novelId: 7 });
    h.respond(0, { success: true, novel: { title: 'Тест' } });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(await h.context.apiRequest('getNovel', { novelId: 7 }), a);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
});

test('принудительное обновление обходит ожидание и старый ответ не затирает новый кэш', async () => {
    const h = apiHarness();
    const old = h.context.apiRequest('getNovel', { id: 7 });
    const fresh = h.context.apiRequest('getNovel', { id: 7 }, true);
    await tick();
    assert.equal(h.requests.length, 2);
    h.respond(1, { success: true, revision: 'new' });
    await fresh;
    h.respond(0, { success: true, revision: 'old' });
    await old;
    assert.equal((await h.context.apiRequest('getNovel', { id: 7 })).revision, 'new');
    assert.equal(h.requests.length, 2);
});

test('очистка кэша отделяет новые запросы от ответов, начатых до очистки', async () => {
    const h = apiHarness();
    const old = h.context.apiRequest('getReadingLists');
    await tick();
    h.context.clearCache();
    const fresh = h.context.apiRequest('getReadingLists');
    await tick();
    assert.equal(h.requests.length, 2);
    h.respond(0, { success: true, revision: 'old' });
    await old;
    assert.equal(Object.keys(h.state.cache.data).length, 0);
    h.respond(1, { success: true, revision: 'new' });
    await fresh;
    assert.equal((await h.context.apiRequest('getReadingLists')).revision, 'new');
});

test('тайм-аут чтения освобождает запрос и позволяет повторить загрузку', async () => {
    const h = apiHarness();
    const request = h.context.apiRequest('getNovel');
    await tick();
    const rejection = assert.rejects(request, /вовремя/);
    const timeout = [...h.timers.values()][0];
    assert.equal(timeout.delay, 30000);
    timeout.callback();
    await rejection;
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.timers.size, 0);
    const retry = h.context.apiRequest('getNovel');
    await tick();
    h.respond(1, { success: true });
    await retry;
});

test('для загрузки главы в редакторе сохраняется более длинный срок ожидания', async () => {
    const h = apiHarness();
    const request = h.context.apiRequest('getChapterForEdit');
    await tick();
    assert.equal([...h.timers.values()][0].delay, 60000);
    h.respond(0, { success: true });
    await request;
    assert.equal(h.timers.size, 0);
});

test('ошибки API и HTTP не кэшируются и не блокируют повторную попытку', async () => {
    for (const httpError of [false, true]) {
        const h = apiHarness();
        const request = h.context.apiRequest('getNovel');
        await tick();
        const completion = httpError ? assert.rejects(request, /Недоступно/) : request;
        h.respond(0, { success: false, error: 'Недоступно' }, !httpError);
        await completion;
        const retry = h.context.apiRequest('getNovel');
        await tick();
        assert.equal(h.requests.length, 2);
        h.respond(1, { success: true });
        await retry;
        assert.equal(h.timers.size, 0);
    }
});

test('ответ прежней сессии не восстанавливает её кэш после выхода', async () => {
    const h = apiHarness();
    const request = h.context.apiRequest('getReadingLists');
    await tick();
    h.storage.delete('session_token');
    h.respond(0, { success: true, lists: { private: [] } });
    await request;
    assert.equal(Object.keys(h.state.cache.data).length, 0);
});

test('сетевые ошибки и повреждённый JSON не оставляют зависший запрос', async () => {
    for (const badJson of [false, true]) {
        const h = apiHarness();
        const request = h.context.apiRequest('getNovel');
        const rejection = assert.rejects(request, /Broken/);
        await tick();
        if (badJson) h.requests[0].resolve({ ok: true, json: async () => { throw new Error('Broken JSON'); } });
        else h.requests[0].reject(new Error('Broken connection'));
        await rejection;
        assert.equal(h.timers.size, 0);
        const retry = h.context.apiRequest('getNovel');
        await tick();
        assert.equal(h.requests.length, 2);
        h.respond(1, { success: true });
        await retry;
    }
});

test('просроченный кэш загружается заново', async () => {
    const h = apiHarness();
    const initial = h.context.apiRequest('getNovel');
    await tick();
    h.respond(0, { success: true, revision: 1 });
    await initial;
    Object.values(h.state.cache.data)[0].timestamp = Date.now() - h.state.cache.ttl - 1;
    const next = h.context.apiRequest('getNovel');
    await tick();
    assert.equal(h.requests.length, 2);
    h.respond(1, { success: true, revision: 2 });
    assert.equal((await next).revision, 2);
});

test('запросы сохранения остаются независимыми и не повторяются при ошибке', async () => {
    const h = apiHarness();
    const first = h.context.apiPostRequest('updateProfile', { bio: 'Тест' });
    const second = h.context.apiPostRequest('updateProfile', { bio: 'Тест' });
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].options.method, 'POST');
    const rejection = assert.rejects(first, /Offline/);
    h.requests[0].reject(new Error('Offline'));
    h.respond(1, { success: true });
    await Promise.all([rejection, second]);
    assert.equal(h.requests.length, 2);
});

function navigationHarness() {
    const events = [], toasts = [], listeners = {};
    let view = null;
    const pageContainer = { style: {}, innerHTML: '' };
    const context = vm.createContext({
        console: quietConsole, URL, isRendering: false, currentScrollHandler: null,
        STATE: { currentUser: { user_id: 1, role: 'creator' }, currentPage: 1 },
        window: { location: { origin: 'http://test.invalid', pathname: '/', search: '' }, scrollTo() {}, history: { pushState() {} }, addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener() {} },
        document: { body: { style: {}, classList: { toggle() {} } }, documentElement: { style: {} }, querySelector() { return null; }, getElementById(id) { return id === 'page-content-container' ? pageContainer : null; } },
        hasLoadedInitialDataScope() { return true; }, loadInitialDataForPage: async () => {},
        updateUserDisplay() {}, showToast(message) { toasts.push(message); }, checkUserPermission() { return true; },
        showSection() {}, hideSection() {}
    });
    const render = name => async id => { events.push(name); view = { name, id }; };
    Object.assign(context, { renderCatalogPage: render('catalog'), renderProfilePage: render('profile'), renderCreatorPage: render('creator'), renderNovelDetailsPage: render('novel') });
    vm.runInContext(navigationSource, context);
    return { context, events, toasts, view: () => view };
}

test('быстрые переходы заканчиваются последней выбранной страницей', async () => {
    const h = navigationHarness(), gate = deferred();
    const normalRender = h.context.renderNovelDetailsPage;
    h.context.renderNovelDetailsPage = async id => { await gate.promise; await normalRender(id); };
    const first = h.context.renderPage('novel-details', { id: 'first' });
    await tick();
    await h.context.renderPage('profile');
    const parameters = { id: 'last' };
    await h.context.renderPage('creator', parameters);
    parameters.id = 'changed-after-click';
    gate.resolve();
    await first;
    assert.deepEqual(h.events, ['novel', 'creator']);
    assert.deepEqual(h.view(), { name: 'creator', id: 'last' });
    assert.equal(h.context.isRendering, false);
});

test('переход во время начальной загрузки не рисует устаревший маршрут', async () => {
    const h = navigationHarness(), gate = deferred();
    h.context.loadInitialDataForPage = async () => gate.promise;
    const first = h.context.renderPage('novel-details', { id: 'old' });
    await tick();
    await h.context.renderPage('profile');
    gate.resolve();
    await first;
    assert.deepEqual(h.events, ['profile']);
});

test('перенаправление гостя из профиля действительно открывает каталог', async () => {
    const h = navigationHarness();
    h.context.STATE.currentUser = null;
    await h.context.renderPage('profile');
    assert.deepEqual(h.events, ['catalog']);
    assert.equal(h.context.isRendering, false);
});

test('ошибка начальной загрузки не теряет ожидающий переход', async () => {
    const h = navigationHarness(), gate = deferred();
    let loads = 0;
    h.context.loadInitialDataForPage = async () => { if (++loads === 1) await gate.promise; };
    const first = h.context.renderPage('novel-details', { id: 'failed' });
    await tick();
    await h.context.renderPage('profile');
    gate.reject(new Error('Offline'));
    await first;
    assert.deepEqual(h.events, ['profile']);
    assert.equal(h.context.isRendering, false);
});

test('ошибка очистки старого редактора не оставляет навигацию заблокированной', async () => {
    const h = navigationHarness();
    h.context.STATE.chapterEditorCleanup = () => { throw new Error('Cleanup failed'); };
    await h.context.renderPage('catalog');
    assert.equal(h.context.isRendering, false);
    delete h.context.STATE.chapterEditorCleanup;
    await h.context.renderPage('profile');
    assert.equal(h.view().name, 'profile');
});

function notificationHarness() {
    const requests = [], mutations = [], draws = [], badges = [], errors = [];
    let token = 'session-a';
    const center = { style: {} };
    const context = vm.createContext({
        console: quietConsole, STATE: { currentUser: { user_id: 7 } },
        localStorage: { getItem() { return token; } },
        document: { getElementById(id) { return id === 'notification-center' ? center : null; } },
        apiRequest() { const request = deferred(); requests.push(request); return request.promise; },
        apiPostRequest() { const request = deferred(); mutations.push(request); return request.promise; },
        showToast(message) { errors.push(message); }
    });
    vm.runInContext(notificationSource, context);
    context.renderNotificationList = items => draws.push(Array.from(items, item => item.notification_id));
    context.updateNotificationBadge = count => badges.push(count);
    context.renderNotificationError = error => errors.push(error.message);
    return { context, requests, mutations, draws, badges, errors, setToken(value) { token = value; } };
}
const notificationResult = id => ({ success: true, notifications: [{ notification_id: id, is_read: false }], unread_count: 1 });

test('запоздавшие уведомления не возвращаются после выхода из аккаунта', async () => {
    const h = notificationHarness();
    const loading = h.context.refreshNotificationSummary();
    h.context.STATE.currentUser = null;
    h.setToken(null);
    h.context.syncNotificationHeaderForUser();
    h.requests[0].resolve(notificationResult(7));
    await loading;
    assert.deepEqual(h.draws.at(-1), []);
    assert.equal(h.badges.at(-1), 0);
    assert.equal(h.errors.length, 0);
});

test('смена аккаунта немедленно обновляет уведомления, не ожидая минуту', async () => {
    const h = notificationHarness();
    const old = h.context.refreshNotificationSummary();
    h.requests[0].resolve(notificationResult(7));
    await old;
    h.context.STATE.currentUser = { user_id: 8 };
    h.setToken('session-b');
    const next = h.context.refreshNotificationSummary();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.draws.at(-1), []);
    h.requests[1].resolve(notificationResult(8));
    await next;
    assert.deepEqual(h.draws.at(-1), [8]);
});

test('старый ответ уведомлений не затирает результат более свежего запроса', async () => {
    const h = notificationHarness();
    const old = h.context.refreshNotificationSummary(true);
    const fresh = h.context.refreshNotificationSummary(true);
    h.requests[1].resolve(notificationResult(2));
    await fresh;
    h.requests[0].resolve(notificationResult(1));
    await old;
    assert.deepEqual(h.draws.at(-1), [2]);
});

test('ошибка устаревшего запроса не заменяет новые уведомления сообщением об ошибке', async () => {
    const h = notificationHarness();
    const old = h.context.refreshNotificationSummary(true);
    const fresh = h.context.refreshNotificationSummary(true);
    h.requests[1].resolve(notificationResult(2));
    await fresh;
    h.requests[0].reject(new Error('Late error'));
    await old;
    assert.equal(h.errors.length, 0);
    assert.equal(h.badges.at(-1), 1);
});

test('ошибка удаления или отметки старого уведомления не затрагивает другой аккаунт', async () => {
  for (const operation of ['deleteNotificationItem', 'markAllNotificationsRead']) {
    const h = notificationHarness();
    const initial = h.context.refreshNotificationSummary();
    h.requests[0].resolve(notificationResult(7));
    await initial;
    const deletion = h.context[operation](7);
    h.context.STATE.currentUser = { user_id: 8 };
    h.setToken('session-b');
    const next = h.context.refreshNotificationSummary();
    h.requests[1].resolve(notificationResult(8));
    await next;
    h.mutations[0].reject(new Error('Late failure'));
    await deletion;
    assert.deepEqual(h.draws.at(-1), [8]);
    assert.equal(h.errors.length, 0);
  }
});
