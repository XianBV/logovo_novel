/* ==========================================
   ЛОГОВО НОВЕЛЛ — ЗАПУСК ПРИЛОЖЕНИЯ
   Загрузка данных, события и инициализация
   ========================================== */

console.log('📦 script.js загружен');

const PRESENCE_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;
const PRESENCE_CHECK_INTERVAL_MS = 60 * 1000;
let presenceTimerId = null;
let presenceVisibilityBound = false;

function getPresenceStorageKey() {
    return `presence_last_sent_${STATE.currentUser?.user_id ?? 'guest'}`;
}

async function sendPresenceHeartbeat() {
    if (!STATE.currentUser || document.visibilityState !== 'visible') return;

    const storageKey = getPresenceStorageKey();
    const now = Date.now();
    const lastSentAt = Number(localStorage.getItem(storageKey) || 0);
    if (now - lastSentAt < PRESENCE_HEARTBEAT_INTERVAL_MS) {
        if (typeof updateProfilePresence === 'function') updateProfilePresence(true);
        return;
    }

    localStorage.setItem(storageKey, String(now));
    try {
        const response = await apiPostRequest('touchPresence', {});
        if (response?.success) {
            STATE.currentUser.is_online = true;
            if (typeof updateProfilePresence === 'function') updateProfilePresence(true);
        }
    } catch (error) {
        if (localStorage.getItem(storageKey) === String(now)) {
            localStorage.removeItem(storageKey);
        }
        console.warn('Не удалось обновить статус присутствия:', error);
    }
}

function startPresenceTracking() {
    if (presenceTimerId) clearInterval(presenceTimerId);
    if (!STATE.currentUser) return;

    void sendPresenceHeartbeat();
    presenceTimerId = setInterval(() => {
        void sendPresenceHeartbeat();
    }, PRESENCE_CHECK_INTERVAL_MS);

    if (!presenceVisibilityBound) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void sendPresenceHeartbeat();
        });
        presenceVisibilityBound = true;
    }
}

// Страницы каталога и редактора используют общий список новелл, теги и
// конфигурацию. Остальным страницам достаточно данных текущей сессии.
function getInitialDataScopeForPage(page) {
    const fullDataPages = [
        'home',
        'catalog',
        'author',
        'add-novel',
        'edit-novel'
    ];

    if (fullDataPages.includes(page)) return 'full';
    // Админ-панель получает данные отдельными прямыми запросами после
    // безопасной загрузки текущей сессии.
    if (page === 'admin') return 'session';
    return 'session';
}

function hasLoadedInitialDataScope(requiredScope) {
    const loadedScope = STATE.initialDataScope;

    if (loadedScope === 'full') return true;
    if (requiredScope === 'session') {
        return loadedScope === 'session' || loadedScope === 'admin';
    }

    return loadedScope === requiredScope;
}

async function loadInitialDataForPage(page) {
    const requiredScope = getInitialDataScopeForPage(page);

    if (hasLoadedInitialDataScope(requiredScope)) {
        return;
    }

    const response = await requestInitialData(requiredScope);

    if (!response.success) throw new Error(response.error);

    STATE.currentUser = (
        response.user &&
        response.user.user_id !== null &&
        response.user.user_id !== undefined
    ) ? response.user : null;

    if (requiredScope === 'full') {
        STATE.novels = Array.isArray(response.novels)
            ? response.novels
            : [];
        STATE.filteredNovels = STATE.novels;
        STATE.config = response.config || {};
        STATE.tags = Array.isArray(response.tags) ? response.tags : [];
    }

    STATE.currentRoleTheme = response.roleTheme || STATE.currentRoleTheme || 'default';

    STATE.novelDetailsLayout = response.novelDetailsLayout === 'fixed'
        ? 'fixed'
        : 'adaptive';
    document.documentElement.dataset.novelDetailsLayout = STATE.novelDetailsLayout;

    STATE.initialDataScope = requiredScope;
}

async function requestInitialData(scope) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await apiRequest('getInitialData', { scope }, attempt > 0);
            if (!response.success) throw new Error(response.error);
            return response;
        } catch (error) {
            const transient = /fetch failed|failed to fetch|networkerror|network request failed|сетевая ошибка|HTTP (502|503|504)\b/i.test(String(error.message));
            if (attempt || !transient) throw error;
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }
}

function renderInitialDataError() {
    const container = document.getElementById('page-content-container');
    if (!container) return;
    showSection('page-content-container');
    container.innerHTML = `<div class="page-content startup-load-error" role="alert">
        <h1>Не удалось загрузить сайт</h1>
        <p>Проверьте соединение и повторите загрузку. Выходить из аккаунта не нужно.</p>
        <button type="button" class="btn btn-secondary" onclick="window.location.reload()">Повторить загрузку</button>
    </div>`;
}

function restoreSortPreference() {
    const defaultSort = {
        field: 'title',
        order: 'asc'
    };

    try {
        const savedSort = localStorage.getItem('novel-sort-preference');

        if (!savedSort) {
            STATE.sortBy = defaultSort.field;
            STATE.sortOrder = defaultSort.order;
            return;
        }

        const [field, order] = savedSort.split('_');

        const validFields = ['updated', 'added', 'title'];
        const validOrders = ['asc', 'desc'];

        if (
            validFields.includes(field) &&
            validOrders.includes(order)
        ) {
            STATE.sortBy = field;
            STATE.sortOrder = order;
        } else {
            STATE.sortBy = defaultSort.field;
            STATE.sortOrder = defaultSort.order;
        }
    } catch (error) {
        console.warn(
            'Не удалось восстановить сортировку:',
            error
        );

        STATE.sortBy = defaultSort.field;
        STATE.sortOrder = defaultSort.order;
    }
}

async function initializeApp() {
    if (STATE.isInitialized) return;
    const telegramReturn = typeof captureTelegramReturn === 'function' ? captureTelegramReturn() : null;
    if (telegramReturn && await telegramReturn) return;

    restoreSortPreference();

    console.log('🚀 Инициализация приложения...');

    // СРАЗУ восстанавливаем состояние из localStorage
    const savedUser = localStorage.getItem('currentUser');
    const savedRole = localStorage.getItem('userRole');
    
    if (savedUser) {
        try {
            STATE.currentUser = JSON.parse(savedUser);
            
            // Немедленно показываем UI элементы без ожидания
            if (savedRole === 'admin' || savedRole === 'owner') {
                const adminBtn = document.getElementById('admin-btn');
                if (adminBtn) adminBtn.style.display = 'inline-flex';
            }
            
            updateUserDisplay();
        } catch (e) {
            console.error('Ошибка восстановления пользователя:', e);
        }
    }

    // --- ЭТАП 1: МГНОВЕННАЯ ОТРИСОВКА ---
    applyTheme(currentThemePalette, currentThemeMode);
    setupEventListeners();
    if (typeof captureAccountEmailLink === 'function') captureAccountEmailLink();
    updateSortButtonText();
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    const urlParams = new URLSearchParams(window.location.search);
    const page = urlParams.get('page') || 'home';

    const pageNumberFromUrl = parseInt(urlParams.get('p')) || 1;
    STATE.currentPage = pageNumberFromUrl;
    
    // Сразу показываем заглушку для текущей страницы
    if (page === 'home' || page === 'catalog') {
        renderCatalogPage(true); // Скелет каталога
    } else {
            const pageContainer = document.getElementById('page-content-container');
            if (pageContainer) {
                showSection('page-content-container');
                
                // ✨ НАЧАЛО ИСПРАВЛЕНИЯ ✨
                if (page === 'chapter-read') {
                    // Если это страница чтения, мы не показываем
                    // заглушку-книгу. Мы ждём, пока renderChapterReadPage
                    // сам вызовет оверлей с пузырьками.
                    pageContainer.innerHTML = '';
                } else {
                    // Для всех остальных страниц (детали, профиль и т.д.)
                    // показываем заглушку-книгу, как и раньше.
                    pageContainer.innerHTML = renderBookLoadingMarkup();
                }
                // ✨ КОНЕЦ ИСПРАВЛЕНИЯ ✨
            }
        }

    // --- ЭТАП 2: ЕДИНЫЙ ЗАПРОС ДАННЫХ ---
    try {
        // Загружаем только те общие данные, которые нужны текущей странице.
        await loadInitialDataForPage(page);

        // --- ЭТАП 3: ФИНАЛЬНАЯ ОТРИСОВКА ---
        updateUserDisplay();
        setupSearchAutocomplete();
        startPresenceTracking();

        try {
            const savedSort = localStorage.getItem('novel-sort-preference');
            if (savedSort && savedSort.includes('_')) {
                const [field, order] = savedSort.split('_');
                // Проверяем, что значения валидны (опционально, но полезно)
                // Нужен список допустимых полей и порядков
                const validFields = ['updated', 'added', 'title']; // Добавь все свои поля
                const validOrders = ['asc', 'desc'];
                if (validFields.includes(field) && validOrders.includes(order)) {
                    STATE.sortBy = field;
                    STATE.sortOrder = order;
                    console.log(`🗂️ Сортировка восстановлена: ${field} ${order}`);
                }
            }
        } catch (err) {
            console.warn("Не удалось прочитать сортировку из localStorage:", err);
        }

        // Обновляем значение select'а ПОСЛЕ чтения из localStorage
        const sortSelectEl = document.getElementById('sort-select'); // Переименовал, чтобы не конфликтовать
        if(sortSelectEl) sortSelectEl.value = `${STATE.sortBy}_${STATE.sortOrder}`;

        updateSortButtonText();

        const savedViewMode = localStorage.getItem('novel-view-mode');
        if (savedViewMode && ['grid', 'list'].includes(savedViewMode)) { // Проверяем значение
            STATE.viewMode = savedViewMode;
        } else {
            STATE.viewMode = 'grid'; // Значение по умолчанию
        }

        const gridBtn = document.getElementById('grid-view');
        const listBtn = document.getElementById('list-view');
        if (gridBtn && listBtn) {
            gridBtn.classList.toggle('active', STATE.viewMode === 'grid');
            listBtn.classList.toggle('active', STATE.viewMode === 'list');
            gridBtn.setAttribute('aria-pressed', String(STATE.viewMode === 'grid'));
            listBtn.setAttribute('aria-pressed', String(STATE.viewMode === 'list'));
            console.log(`🖼️ Вид восстановлен: ${STATE.viewMode}`);
        }

        const params = {};
        urlParams.forEach((value, key) => {
            if (key !== 'page' && key !== 'p') params[key] = value;
        });
        
        // ✨ ЗАМЕНА: Вместо renderPage(page, params) сразу применяем фильтры/сортировку,
        // если начальная страница - каталог. Иначе рендерим нужную страницу. ✨
        if (page === 'home' || page === 'catalog') {
             // Сначала настраиваем фильтры (если они еще не настроены)
             setupAdvancedFilters(); // Убедись, что эта функция вызывается до applyFiltersAndSort
             applyFiltersAndSort(); // Применяем начальную сортировку/фильтры
        } else {
             await renderPage(page, params); // Рендерим другую страницу
        }
        
        STATE.isInitialized = true;
        console.log('Инициализация завершена!');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        renderInitialDataError();
    }
}

function setupEventListeners() {
    const authorSubmissionForm = document.getElementById(
        'author-submission-form'
    );

    if (authorSubmissionForm) {
        authorSubmissionForm.addEventListener(
            'submit',
            handleAuthorSubmission
        );
    }
    
    // Фильтры
    bindClick('filter-toggle', toggleFilters);
    bindClick('apply-filters', applyFilters);
    bindClick('clear-filters', clearFilters);
    bindClick('sort-btn', toggleSortPopup);

    // ✨ ОБНОВЛЕННЫЙ БЛОК СОРТИРОВКИ ✨
    //const sortSelect = document.getElementById('sort-select');
    //if (sortSelect) {
        // Устанавливаем начальное значение из STATE
    //    sortSelect.value = `${STATE.sortBy}_${STATE.sortOrder}`;

        // Добавляем обработчик изменения
    //    sortSelect.addEventListener('change', (e) => {
    //        const [field, order] = e.target.value.split('_');
    //        STATE.sortBy = field;
    //        STATE.sortOrder = order;
            // Сохраняем выбор в localStorage (опционально)
    //        try {
    //            localStorage.setItem('novel-sort-preference', e.target.value); // Сохраняем строку 'updated_desc' и т.п.
    //        } catch (err) {
    //            console.warn("Не удалось сохранить сортировку в localStorage:", err);
    //      }
    //        applyFiltersAndSort(); // Переприменяем фильтры и сортировку
    //    });
    //}
    
    // Кнопки
    bindClick('admin-btn', openAdminPanel);
    if (typeof setupNotificationCenter === 'function') setupNotificationCenter();
    
    setupThemeSwitcher();
    
    // Переключение видов
    bindClick('grid-view', () => toggleViewMode('grid'));
    bindClick('list-view', () => toggleViewMode('list'));
    
    // Логотип - на главную
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.addEventListener('click', () => navigateTo('home'));
        logo.style.cursor = 'pointer';
    }

    // Обработчики для опций внутри попапа сортировки
    document.querySelectorAll('#sort-popup .sort-option').forEach(option => {
        option.addEventListener('click', () => {
            handleSortOptionClick(option.dataset.value, option.textContent);
        });
    });

    // ✨ Обновляем текст кнопки сортировки при инициализации ✨
    updateSortButtonText();
    
    // Горячие клавиши
    document.addEventListener('keydown', (e) => {
        // Ctrl+K - фокус на поиск
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.focus();
        }
        
        // Ctrl+N - добавить новеллу (если есть права)
        if (e.ctrlKey && e.key === 'n' && ['creator', 'admin', 'owner'].includes(STATE.currentUser?.role)) {
            e.preventDefault();
            navigateTo('add-novel');
        }
    });
    
    console.log('Обработчики событий настроены');
}

function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el && typeof handler === 'function') {
        el.addEventListener('click', handler);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

console.log('✅ Приложение готово к инициализации');
