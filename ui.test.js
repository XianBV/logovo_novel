import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const layoutSource = await readFile(new URL('./js/layout.js', import.meta.url), 'utf8');
const gestureSource = await readFile(new URL('./js/gestures.js', import.meta.url), 'utf8');

test('сетка сохраняет комфортный диапазон и предсказуемое число колонок', () => {
    const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
    vm.runInContext(layoutSource, context);
    for (let width = 100; width <= 1600; width++) {
        const columns = context.getNovelGridColumnCount(width, 16);
        assert.ok(Number.isInteger(columns) && columns >= 2);
        const layout = context.getNovelGridLayout(width, 16);
        assert.ok(columns * layout.cardWidth + (columns - 1) * 16 <= width + .001);
        assert.ok(layout.cardWidth <= 200);
        if (width >= 316) assert.ok(layout.cardWidth >= 150);
        if (width > 100) {
            const previous = context.getNovelGridLayout(width - 1, 16);
            assert.ok(columns >= previous.columns);
            if (columns === previous.columns) assert.ok(layout.cardWidth >= previous.cardWidth);
        }
    }
    assert.equal(context.getNovelGridColumnCount(280, 16), 2);
    assert.equal(context.getNovelGridColumnCount(218, 16), 2);
    assert.equal(context.getNovelGridColumnCount(1000, 16), 6);
    assert.equal(context.getNovelGridColumnCount(80, 16), 2);
});

test('общая сетка обновляет колонки при изменении ширины, а список их не пересчитывает', () => {
    let resized;
    const classes = new Set(['novels-grid']);
    const values = new Map();
    const grid = {
        clientWidth: 1000, isConnected: true,
        style: { getPropertyValue: name => values.get(name), setProperty: (name, value) => values.set(name, value) },
        classList: { contains: name => classes.has(name) }
    };
    const context = vm.createContext({
        document: { readyState: 'complete', body: {}, querySelectorAll(selector) { assert.equal(selector, '.novels-grid'); return [grid]; } },
        ResizeObserver: class { constructor(callback) { resized = callback; } observe() {} unobserve() {} },
        MutationObserver: class { observe() {} },
        getComputedStyle() { return { columnGap: '16px' }; }, requestAnimationFrame() { return 1; }
    });
    vm.runInContext(layoutSource, context);
    assert.equal(values.get('--novel-grid-template'), 'repeat(6, minmax(0, 200px))');
    classes.add('list-view');
    grid.clientWidth = 280;
    resized([{ target: grid }]);
    assert.equal(values.get('--novel-grid-template'), 'repeat(6, minmax(0, 200px))');
    classes.delete('list-view');
    resized([{ target: grid }]);
    assert.equal(values.get('--novel-grid-template'), 'repeat(2, minmax(0, 200px))');
});

const catalogSource = await readFile(new URL('./js/catalog.js', import.meta.url), 'utf8');

function catalogRendererHarness(viewMode = 'grid') {
    const classes = new Set(['novels-grid']);
    const grid = { innerHTML: '', classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
    const context = vm.createContext({
        console: { log() {} },
        STATE: { viewMode, currentPage: 1, itemsPerPage: 12, totalPages: 3 },
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        document: { getElementById(id) { return id === 'novels-grid' ? grid : null; } }
    });
    vm.runInContext(catalogSource, context);
    return { context, grid, classes };
}

test('общая коллекция сохраняет режим списка и отдельные ссылки на книгу и автора', () => {
    const { context } = catalogRendererHarness('list');
    const html = context.renderNovelCollection([{ novel_id: 7, title: 'Книга "А"', author: 'Автор & соавтор', cover_url: 'cover".jpg' }], 'profile-created-novels');
    assert.match(html, /class="novels-grid profile-created-novels list-view"/);
    assert.match(html, /<article class="novel-card list-view-card">\s*<a href="\?page=novel-details&amp;id=7" class="novel-row-link"[^>]+aria-label="Книга &quot;А&quot;"><\/a>/);
    assert.match(html, /src="cover&quot;\.jpg"/);
    assert.match(html, /<a href="\?page=author&amp;name=[^"]+" class="author-link-inline"/);
    assert.equal((html.match(/<a\b/g) || []).length, 2);
    assert.equal(context.getNovelGridClassName('shelves-content', 'list'), 'novels-grid shelves-content list-view');
});

test('карточки сохраняют адрес по слагу, состояния и один обработчик на ссылку', () => {
    const { context } = catalogRendererHarness();
    const privateCard = context.renderNovelCard({ novel_id: 7, slug: 'book&name', access_type: 'private', title: 'Книга' });
    assert.match(privateCard, /href="\?page=novel-details&amp;id=book%26name"/);
    const deleted = context.renderNovelCard({ novel_id: 7, is_deleted: true, title: 'Книга' });
    assert.match(deleted, /handleRestoreNovel\(this\.dataset\.novelId, event\)/);
    assert.equal((deleted.match(/onclick=/g) || []).length, 1);
    const processing = context.renderNovelCard({ novel_id: 7, original_status: 'processing', title: 'Книга' });
    assert.match(processing, /aria-disabled="true" tabindex="-1"/);
});

test('пустой каталог сбрасывает пагинацию, сохраняя текущий режим', () => {
    const { context, grid, classes } = catalogRendererHarness('list');
    context.renderNovelsGrid([]);
    assert.equal(context.STATE.totalPages, 0);
    assert.ok(classes.has('list-view'));
    assert.match(grid.innerHTML, /Новеллы не найдены/);
});

test('каталог ищет по альтернативному названию и пропускает совпадение только в описании', () => {
    const { context } = catalogRendererHarness();
    const novel = { title: 'Лунный сад', alt_titles: 'Сад ночью | 月の庭', author: 'Ли', description: 'Герой путешествует' };
    assert.equal(context.getCatalogSearchMatch(novel, 'сад ночью').value, 'Сад ночью');
    assert.equal(context.getCatalogSearchMatch(novel, '月の庭').field, 'alternate');
    assert.equal(context.getCatalogSearchMatch(novel, 'ли').field, 'author');
    assert.equal(context.getCatalogSearchMatch(novel, 'геро'), null);
    assert.equal(context.getCatalogSearchMatch({ title: 'Лунный сад' }, 'геро'), null);
});

test('исключение тегов различает любой и все выбранные теги', () => {
    const { context } = catalogRendererHarness();
    const selected = ['Романтика', 'Фэнтези'];
    assert.equal(context.checkTaxonomyFilter(['романтика'], selected, 'any', true), false);
    assert.equal(context.checkTaxonomyFilter(['романтика'], selected, 'all', true), true);
    assert.equal(context.checkTaxonomyFilter(['РОМАНТИКА', 'фэнтези'], selected, 'all', true), false);
    assert.equal(context.checkTaxonomyFilter([], selected, 'any', true), true);
    assert.equal(context.checkTaxonomyFilter(['романтика'], [], 'all', true), true);
});

test('фильтры получают варианты из текущей конфигурации и данных каталога', () => {
    for (const config of [{ languages: ['Русский'] }, { LANGUAGES: ['Русский'] }]) {
        const { context } = catalogRendererHarness();
        context.STATE.config = config;
        context.STATE.novels = [{ language: 'Китайский', translation_status: 'Редкий статус' }];
        const populated = new Map();
        context.populateSelect = (id, values) => populated.set(id, Array.from(values));
        context.renderFilterTagMap = () => {};
        context.initTooltips = () => {};
        context.setupAdvancedFilters();
        assert.deepEqual(populated.get('language-filter'), ['Русский', 'Китайский']);
        assert.deepEqual(populated.get('translation-status-filter'), ['Редкий статус']);
    }
});

test('экран фильтров возвращает фокус и исходную прокрутку после закрытия', () => {
    const { context } = catalogRendererHarness();
    const root = { scrollTop: 24, scrollLeft: 0 };
    const body = { scrollTop: 180, scrollLeft: 0 };
    const states = [];
    let focusOptions;
    let closed;
    const panel = {
        open: false,
        addEventListener(name, callback) { assert.equal(name, 'close'); closed = callback; },
        showModal() { this.open = true; root.scrollTop = 0; body.scrollTop = 0; },
        close() { this.open = false; closed(); }
    };
    const toggle = { setAttribute(name, value) { states.push([name, value]); }, focus(options) { focusOptions = options; } };
    context.document = { documentElement: root, body, getElementById(id) { return id === 'filters-panel' ? panel : id === 'filter-toggle' ? toggle : null; } };
    context.toggleFilters();
    assert.equal(panel.open, true);
    context.toggleFilters();
    assert.equal(panel.open, false);
    assert.equal(body.scrollTop, 180);
    assert.equal(root.scrollTop, 24);
    assert.equal(focusOptions.preventScroll, true);
    assert.deepEqual(states, [['aria-expanded', 'true'], ['aria-expanded', 'false']]);
});

test('плашки выбранных тегов сохраняют кавычки без внедрения атрибутов', () => {
    const { context } = catalogRendererHarness();
    const container = { innerHTML: '' };
    context.document.getElementById = () => container;
    context.updateSelectedTagsDisplay('selected-include-tags', ['Тег \" onclick=\"не код'], 'include');
    assert.match(container.innerHTML, /data-value="Тег &quot; onclick=&quot;не код"/);
    const openingTag = container.innerHTML.slice(0, container.innerHTML.indexOf('>') + 1);
    assert.equal((openingTag.match(/onclick="/g) || []).length, 1);
});

test('карточки профиля заполняют узкую область без скачка в миниатюры на 360 px', () => {
    const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
    vm.runInContext(layoutSource, context);
    for (let width = 120; width <= 1600; width++) {
        const layout = context.getNovelGridLayout(width, 16);
        assert.ok(layout.cardWidth > 0 && layout.cardWidth <= 200);
        assert.ok(layout.columns * layout.cardWidth + (layout.columns - 1) * 16 <= width + .001);
    }
    assert.equal(context.getNovelGridLayout(315, 16).cardWidth, 149.5);
    assert.equal(context.getNovelGridLayout(480, 16).cardWidth, 200);
    assert.ok(context.getNovelGridLayout(359, 16).cardWidth > 170);
    assert.ok(context.getNovelGridLayout(360, 16).cardWidth > 170);
});

test('три книги помещаются в ряд без чрезмерного увеличения двух карточек', () => {
    const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
    vm.runInContext(layoutSource, context);
    const three = context.getNovelGridLayout(548, 16);
    assert.equal(three.columns, 3);
    assert.equal(three.cardWidth, 172);
    assert.equal(three.columns * three.cardWidth + (three.columns - 1) * 16, 548);
    const two = context.getNovelGridLayout(480, 16);
    assert.equal(two.columns, 2);
    assert.equal(two.cardWidth, 200);
    assert.ok(two.columns * two.cardWidth + (two.columns - 1) * 16 <= 480);
    assert.equal(context.getNovelGridLayout(900, 16).cardWidth, 167.2);
});

test('общая сетка сохраняет минимум две колонки и расширяется больше трёх', () => {
    const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
    vm.runInContext(layoutSource, context);
    for (const width of [120, 167, 205, 279, 320, 548, 900, 1600]) {
        for (const gap of [12, 16, 24]) {
            const layout = context.getNovelGridLayout(width, gap);
            assert.ok(layout.columns >= 2);
            assert.ok(layout.cardWidth > 0);
            assert.ok(layout.columns * layout.cardWidth + (layout.columns - 1) * gap <= width + .001);
            assert.ok(layout.cardWidth <= 200);
        }
    }
    assert.equal(context.getNovelGridLayout(205, 16).columns, 2);
    assert.equal(context.getNovelGridLayout(205, 16).cardWidth, 94.5);
    assert.ok(context.getNovelGridLayout(1600, 16).columns > 3);
    assert.equal(context.getNovelGridLayout(506, 16).cardWidth, 158);
});

test('третья книга занимает место в области 494 px без пустой полосы справа', () => {
    const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
    vm.runInContext(layoutSource, context);
    const layout = context.getNovelGridLayout(494, 16);
    assert.equal(layout.columns, 3);
    assert.equal(layout.cardWidth, 154);
    assert.equal(layout.columns * layout.cardWidth + (layout.columns - 1) * 16, 494);
});

function gestureHarness({ input = false, scroller = false, shelf = false, top = false, modal = null } = {}) {
    const handlers = {}, calls = [], timers = new Map();
    let clock = 10000, timerId = 0, insideShelf = shelf;
    const shelfNav = { isConnected: true, closest() { return { dataset: { placement: top ? 'top' : 'side' } }; } };
    const target = { closest(selector) { return selector === '.shelves-nav' ? (insideShelf ? shelfNav : null) : (input ? this : null); } };
    const context = vm.createContext({
        Date: class extends Date { static now() { return clock; } },
        innerWidth: 1000, innerHeight: 800,
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        getComputedStyle() { return { visibility: 'visible' }; },
        window: { history: { back() { calls.push('back'); }, forward() { calls.push('forward'); } }, getSelection() { return { toString() { return ''; } }; } },
        document: { addEventListener(type, handler) { handlers[type] = handler; }, querySelectorAll() { return modal ? [{ getClientRects() { return modal === 'visible' ? [{}] : []; } }] : []; } },
        setProfileShelfCollapsed(collapsed) { calls.push(collapsed ? 'collapse' : 'expand'); }
    });
    vm.runInContext(gestureSource, context);
    const advance = (ms = 1000) => {
        clock += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    };
    const event = extra => ({ target, cancelable: true, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
    const swipe = (dx, dy = 0) => {
        handlers.touchstart(event({ touches: [{ clientX: 100, clientY: 100 }] }));
        const move = event({ touches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
        handlers.touchmove(move);
        handlers.touchend(event({ touches: [], changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] }));
        advance();
        return move;
    };
    return { context, calls, swipe, handlers, event, advance, setShelf(value) { insideShelf = value; }, flush() { advance(1000); } };
}

test('свайпы и трекпад вне полок не переключают историю и не перехватывают прокрутку', () => {
    for (const scroller of [false, true]) {
        const h = gestureHarness({ scroller });
        h.swipe(300); h.swipe(-300); h.swipe(0, 300);
        for (const [deltaX, deltaY] of [[-500, 0], [500, 0], [0, 300]]) {
            const event = h.event({ deltaX, deltaY });
            h.handlers.wheel(event);
            assert.equal(event.defaultPrevented, false);
        }
        h.flush();
        assert.deepEqual(h.calls, []);
    }
});

test('боковые полки сворачиваются влево и раскрываются вправо, вертикаль не перехватывается', () => {
    const h = gestureHarness({ shelf: true });
    assert.equal(h.swipe(-90).defaultPrevented, true);
    h.swipe(90);
    assert.equal(h.swipe(5, 120).defaultPrevented, false);
    assert.deepEqual(h.calls, ['collapse', 'expand']);
});

test('верхние полки не сворачиваются жестами и не перехватывают прокрутку', () => {
    const h = gestureHarness({ shelf: true, top: true });
    for (const [dx, dy] of [[5, -90], [-5, 90], [220, 0], [-220, 0]]) {
        assert.equal(h.swipe(dx, dy).defaultPrevented, false);
    }
    for (const [deltaX, deltaY] of [[300, 0], [0, 300], [0, -300]]) {
        const wheel = h.event({ deltaX, deltaY });
        h.handlers.wheel(wheel);
        assert.equal(wheel.defaultPrevented, false);
    }
    assert.deepEqual(h.calls, []);
});

test('инерция жеста полок не прокручивает страницу после ухода полосы из-под указателя', () => {
    const h = gestureHarness({ shelf: true });
    h.handlers.wheel(h.event({ deltaX: 120, deltaY: 0 }));
    assert.deepEqual(h.calls, ['collapse']);
    h.setShelf(false);
    for (let i = 0; i < 5; i++) {
        h.advance(100);
        const tail = h.event({ deltaX: 0, deltaY: 15 });
        h.handlers.wheel(tail);
        assert.equal(tail.defaultPrevented, true);
        assert.equal(tail.stopped, true);
    }
    h.advance(250);
    const normal = h.event({ deltaX: 0, deltaY: 40 });
    h.handlers.wheel(normal);
    assert.equal(normal.defaultPrevented, false);
    assert.deepEqual(h.calls, ['collapse']);
});

test('прокрутка с Ctrl не поглощается блокировкой инерции', () => {
    const h = gestureHarness({ shelf: true, top: true });
    h.context.suppressProfileWheelTail();
    const zoom = h.event({ deltaX: 0, deltaY: 120, ctrlKey: true });
    h.handlers.wheel(zoom);
    assert.equal(zoom.defaultPrevented, false);
});

test('поля, модальные окна, отмена и несколько пальцев не переключают полки', () => {
    for (const options of [{ input: true }, { modal: 'visible' }]) {
        const h = gestureHarness({ shelf: true, ...options });
        h.swipe(-100); assert.deepEqual(h.calls, []);
    }
    const h = gestureHarness({ shelf: true });
    h.handlers.touchstart(h.event({ touches: [{ clientX: 100, clientY: 100 }] }));
    h.handlers.touchmove(h.event({ touches: [{ clientX: 0, clientY: 100 }] }));
    h.handlers.touchcancel();
    h.handlers.touchend(h.event({ touches: [], changedTouches: [{ clientX: 0, clientY: 100 }] }));
    h.handlers.touchstart(h.event({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 150, clientY: 150 }] }));
    h.handlers.touchend(h.event({ touches: [], changedTouches: [{ clientX: 0, clientY: 100 }] }));
    assert.deepEqual(h.calls, []);
});

const profileSource = await readFile(new URL('./js/profile.js', import.meta.url), 'utf8');

test('подсказки прокрутки полок показываются только у скрытого края', () => {
    const items = { scrollLeft: 0, clientWidth: 300, scrollWidth: 500 }, nav = { dataset: {} };
    const layout = { querySelector: selector => selector === '.shelf-nav-items' ? items : nav };
    const context = vm.createContext({ console: { log() {} } });
    vm.runInContext(profileSource, context);
    context.updateProfileShelfOverflow(layout);
    assert.equal(nav.dataset.overflowStart, 'false');
    assert.equal(nav.dataset.overflowEnd, 'true');
    items.scrollLeft = 200;
    context.updateProfileShelfOverflow(layout);
    assert.equal(nav.dataset.overflowStart, 'true');
    assert.equal(nav.dataset.overflowEnd, 'false');
    items.scrollLeft = 0; items.clientWidth = 600;
    context.updateProfileShelfOverflow(layout);
    assert.equal(nav.dataset.overflowStart, 'false');
    assert.equal(nav.dataset.overflowEnd, 'false');
});

test('жест карточки профиля поглощает колесо до конца серии после уменьшения карточки', () => {
    const h = gestureHarness();
    const heroHandlers = {}, changes = [], classes = new Set(['is-expanded']);
    const hero = { classList: { contains: name => classes.has(name) },
        addEventListener(name, fn) { heroHandlers[name] = fn; }, removeEventListener() {} };
    h.context.document.getElementById = () => hero;
    vm.runInContext(profileSource, h.context);
    h.context.getProfileScrollTop = () => 125;
    h.context.setProfileHeroExpanded = expanded => { changes.push(expanded); classes.delete('is-expanded'); };
    h.context.setupProfileHeroAutoCollapse();
    let pageScroll = 125;
    const deliver = (deltaY, overHero) => {
        const event = h.event({ deltaX: 0, deltaY });
        h.handlers.wheel(event);
        if (overHero && !event.stopped) heroHandlers.wheel(event);
        if (!event.defaultPrevented) pageScroll += deltaY;
    };
    deliver(60, true);
    for (const delta of [50, 30, 20, 10, 4]) { h.advance(80); deliver(delta, false); }
    assert.deepEqual(changes, [false]);
    assert.equal(pageScroll, 125);
    h.advance(250); deliver(20, false);
    assert.equal(pageScroll, 145);
});

function shelfPreferenceHarness() {
    const storage = new Map();
    let narrow = false, respond, reject;
    const user = { user_id: 901 };
    const context = vm.createContext({
        console: { log() {}, warn() {} }, STATE: { currentUser: user },
        window: { matchMedia() { return { matches: narrow }; } },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { querySelector() { return null; }, getElementById() { return null; } },
        apiRequest() { return new Promise((yes, no) => { respond = yes; reject = no; }); },
        apiPostRequest() { return Promise.resolve({ success: true }); }
    });
    vm.runInContext(profileSource, context);
    return { context, storage, user, narrow(value) { narrow = value; }, respond(value) { respond(value); }, reject() { reject(Error('Offline')); } };
}

test('явный выбор расположения полок сохраняется при смене ширины и разделён по аккаунтам', () => {
    const h = shelfPreferenceHarness();
    assert.equal(h.context.getProfileShelfPlacement(), 'side');
    h.narrow(true);
    assert.equal(h.context.getProfileShelfPlacement(), 'top');
    h.context.setProfileShelfPlacement('side');
    assert.equal(h.context.getProfileShelfPlacement(), 'side');
    h.context.setProfileShelfPlacement('invalid');
    assert.equal(h.context.getProfileShelfPlacement(), 'side');
    h.narrow(false);
    h.context.setProfileShelfPlacement('top');
    assert.equal(h.context.getProfileShelfPlacement(), 'top');
    h.user.user_id = 902;
    assert.equal(h.context.getProfileShelfPlacement(), 'side');
    h.user.user_id = 901;
    assert.equal(h.context.getProfileShelfPlacement(), 'top');
});

test('верхние полки всегда развёрнуты, а боковой режим сохраняет свою ширину', () => {
    const h = shelfPreferenceHarness();
    const classes = new Set(['is-compact']);
    const values = new Map([['--shelf-nav-width', '64px']]);
    const attributes = new Map();
    const toggle = { setAttribute: (k, v) => attributes.set(k, v), removeAttribute() {} };
    const nav = { removeAttribute() {}, setAttribute() {} };
    const resizer = { setAttribute() {} };
    const layout = { dataset: { placement: 'side' },
        style: { getPropertyValue: k => values.get(k), setProperty: (k, v) => values.set(k, v) },
        classList: { contains: k => classes.has(k), toggle(k, value) { value ? classes.add(k) : classes.delete(k); } },
        querySelector(selector) { return { '.shelf-nav-toggle': toggle, '.shelves-nav': nav, '.shelves-resizer': resizer }[selector] || null; }
    };
    h.context.document.querySelector = () => layout;
    let writes = 0;
    h.context.apiPostRequest = () => { writes++; return Promise.resolve({success:true}); };
    h.storage.set('profile_901_shelf_nav_width', '64');
    h.context.setProfileShelfPlacement('top');
    h.context.applyProfileShelfWidth(64);
    assert.equal(classes.has('is-compact'), false);
    assert.equal(toggle.hidden, true);
    assert.equal(toggle.disabled, true);
    assert.equal(attributes.get('aria-expanded'), 'true');
    h.context.setProfileShelfCollapsed(true);
    assert.equal(writes, 0);
    assert.equal(h.storage.get('profile_901_shelf_nav_width'), '64');
    h.context.setProfileShelfPlacement('side');
    assert.equal(classes.has('is-compact'), true);
    assert.equal(toggle.hidden, false);
    assert.equal(toggle.disabled, false);
    assert.equal(attributes.get('aria-expanded'), 'false');
    assert.equal(values.get('--shelf-nav-width'), '64px');
});

test('поздний ответ настроек или сетевая ошибка не отменяют сворачивание полок', async () => {
    for (const failed of [false, true]) {
        const h = shelfPreferenceHarness();
        const pending = h.context.getInitialProfileShelfWidth();
        await h.context.persistProfileShelfWidth(64);
        if (failed) h.reject();
        else h.respond({ success: true, synced: true, preferences: { shelf_nav_width: 240 } });
        assert.equal(await pending, 64);
        assert.equal(h.storage.get('profile_901_shelf_nav_width'), '64');
    }
});

test('ответ настроек прежнего аккаунта не записывается в новый', async () => {
    const h = shelfPreferenceHarness();
    const pending = h.context.getInitialProfileShelfWidth();
    h.user.user_id = 902;
    h.storage.set('profile_902_shelf_nav_width', '64');
    h.respond({ success: true, synced: true, preferences: { shelf_nav_width: 240 } });
    assert.equal(await pending, 64);
    assert.equal(h.storage.get('profile_902_shelf_nav_width'), '64');
});

test('сворачивание короткого профиля сохраняет прокрутку, запас высоты освобождается при движении вверх', () => {
    let naturalHeight = 900;
    const handlers = new Map();
    const page = { style: { minHeight: '' }, isConnected: true,
        getBoundingClientRect() { return { height: Math.max(naturalHeight, parseFloat(this.style.minHeight) || 0) }; }
    };
    const win = { scrollY: 180, innerHeight: 700,
        addEventListener(name, fn) { handlers.set(name, fn); },
        removeEventListener(name) { handlers.delete(name); }
    };
    const context = vm.createContext({ console: { log() {} }, window: win,
        document: { documentElement: { get scrollHeight() { return page.getBoundingClientRect().height + 100; } } }
    });
    vm.runInContext(profileSource, context);
    const finish = context.reserveProfileScrollSpace({ closest() { return page; } });
    naturalHeight = 600;
    assert.equal(page.getBoundingClientRect().height, 900);
    finish();
    assert.equal(win.scrollY, 180);
    assert.equal(page.style.minHeight, '780px');
    win.scrollY = 60; handlers.get('scroll')();
    assert.equal(page.style.minHeight, '660px');
    win.scrollY = 0; handlers.get('scroll')();
    assert.equal(page.style.minHeight, '');
    assert.equal(handlers.size, 0);
});

test('вверху страницы подвал не удерживается до завершения анимации профиля', () => {
    let listeners = 0;
    const page = { style: { minHeight: '' }, getBoundingClientRect() { return { height: 900 }; } };
    const context = vm.createContext({ console: { log() {} },
        window: { scrollY: 1.6, addEventListener() { listeners++; } },
        document: { documentElement: { scrollHeight: 1000 } }
    });
    vm.runInContext(profileSource, context);
    const finish = context.reserveProfileScrollSpace({ closest() { return page; } });
    assert.equal(page.style.minHeight, '');
    assert.equal(listeners, 0);
    finish();
});

test('при прокрутке запас высоты освобождается анимацией, навигация отменяет её', () => {
    let natural = 900, frames, cancelled = false;
    const page = { isConnected: true, style: { minHeight: '' },
        getBoundingClientRect() { return { height: Math.max(natural, parseFloat(this.style.minHeight) || 0) }; },
        animate(keyframes) { frames = keyframes; return { finished: Promise.resolve(), cancel() { cancelled = true; } }; }
    };
    const context = vm.createContext({ console: { log() {} },
        window: { scrollY: 180, innerHeight: 700, matchMedia() { return { matches: false }; }, addEventListener() {}, removeEventListener() {} },
        document: { documentElement: { get scrollHeight() { return page.getBoundingClientRect().height + 100; } } }
    });
    vm.runInContext(profileSource, context);
    const finish = context.reserveProfileScrollSpace({ closest() { return page; } });
    natural = 600;
    finish();
    assert.equal(frames[0].minHeight, '900px');
    assert.equal(frames[1].minHeight, '780px');
    context.clearProfileScrollSpace();
    assert.equal(cancelled, true);
    assert.equal(page.style.minHeight, '');
});

test('резерв высоты удаляется при уходе со страницы и не возвращается из старой анимации', () => {
    const handlers = new Map();
    const page = { style: { minHeight: '320px' }, isConnected: true, getBoundingClientRect() { return { height: 900 }; } };
    const context = vm.createContext({ console: { log() {} },
        window: { scrollY: 100, innerHeight: 700, addEventListener(n, fn) { handlers.set(n, fn); }, removeEventListener(n) { handlers.delete(n); } },
        document: { documentElement: { scrollHeight: 1000 } }
    });
    vm.runInContext(profileSource, context);
    const finish = context.reserveProfileScrollSpace({ closest() { return page; } });
    context.clearProfileScrollSpace();
    finish();
    assert.equal(page.style.minHeight, '320px');
    assert.equal(handlers.size, 0);
});

test('профиль использует прокрутку body, пропуская промежуточный overflow auto без переполнения', () => {
    const body = { scrollTop: 92, scrollHeight: 950, clientHeight: 764, parentElement: null };
    const main = { scrollTop: 0, scrollHeight: 820, clientHeight: 820, parentElement: body };
    const context = vm.createContext({ console: { log() {} }, window: { scrollY: 0 },
        document: { body, documentElement: {} }, getComputedStyle() { return { overflowY: 'auto' }; }
    });
    vm.runInContext(profileSource, context);
    assert.equal(context.getProfileScrollTop({ parentElement: main }), 92);
});

function profileAnimationHarness() {
    const pending = [];
    let flight;
    const element = name => {
        const classes = new Set();
        return { name, style: { removeProperty(key) { delete this[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; } }, attrs: {},
            classList: { contains(n) { return classes.has(n); }, add(...ns) { ns.forEach(n => classes.add(n)); }, remove(...ns) { ns.forEach(n => classes.delete(n)); }, toggle(n, v) { v ? classes.add(n) : classes.delete(n); } },
            setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; },
            getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; },
            animate(frames) { let finish; const animation = { finished: new Promise(r => { finish = r; }), cancel() {} }; pending.push({ element: this, frames, finish }); return animation; }
        };
    };
    const hero = element('hero'), button = element('button'), info = element('info'), meta = element('meta'), presence = element('presence');
    const display = element('display'), placeholder = element('placeholder'), frame = element('frame');
    hero.dataset = {}; hero.clientLeft = 0; hero.clientTop = 0; hero.isConnected = true;
    hero.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: parseFloat(hero.style.height) || (hero.classList.contains('is-expanded') ? 300 : 110) });
    frame.getBoundingClientRect = () => hero.classList.contains('is-expanded') ? { left: 620, top: 30, width: 138, height: 138 } : { left: 20, top: 12, width: 72, height: 72 };
    frame.querySelector = selector => selector.includes('display') ? display : placeholder;
    frame.closest = () => ({ classList: { contains() { return true; } } });
    frame.cloneNode = () => { const clone = element('flight'), dot = element('dot'), p = element('flight-placeholder'), d = element('flight-display'); clone.querySelector = s => s.includes('dot') ? dot : s.includes('placeholder') ? p : d; clone.querySelectorAll = () => []; clone.remove = () => { flight = null; }; return clone; };
    hero.append = clone => { flight = clone; };
    hero.querySelector = () => frame;
    hero.querySelectorAll = selector => [info, meta, presence].filter(el => selector.includes('.profile-' + el.name));
    const context = vm.createContext({ console: { log() {}, warn() {} }, window: { matchMedia() { return { matches: false }; } }, document: { getElementById(id) { return id === 'profile-hero' ? hero : button; } },
        getComputedStyle(el) { return { visibility: 'visible', gridTemplateRows: '220px 20px', borderWidth: hero.classList.contains('is-expanded') ? '3px' : '1px', boxShadow: 'none', fontSize: hero.classList.contains('is-expanded') ? '16px' : '12px' }; }
    });
    vm.runInContext(profileSource, context);
    return { context, hero, button, info, frame, flight: () => flight,
        async finishPhase() { pending.splice(0).forEach(a => a.finish()); await new Promise(setImmediate); },
        animations: () => pending
    };
}

test('текст профиля скрыт на всём пути аватара в обоих направлениях, временные стили очищаются', async () => {
    const h = profileAnimationHarness();
    for (const expanded of [true, false]) {
        const completion = h.context.setProfileHeroExpanded(expanded);
        await h.finishPhase();
        assert.equal(h.info.style.opacity, '0');
        assert.equal(h.frame.style.visibility, 'hidden');
        assert.ok(h.flight());
        assert.ok(h.animations().some(a => a.element.name === 'hero'));
        assert.ok(h.animations().some(a => a.element.name === 'flight'));
        assert.ok(!h.animations().some(a => a.element.name === 'info'));
        await h.finishPhase();
        assert.equal(h.flight(), null);
        assert.ok(h.animations().some(a => a.element.name === 'info'));
        await h.finishPhase();
        await completion;
        assert.equal(h.info.style.opacity, undefined);
        assert.equal(h.frame.style.visibility, undefined);
        assert.equal(h.hero.style.height, undefined);
        assert.equal(h.button.attrs['aria-busy'], undefined);
        assert.equal(h.button.attrs['aria-expanded'], String(expanded));
    }
});
