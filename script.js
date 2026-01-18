/* ==========================================
   ЛОГОВО НОВЕЛЛ - ПОЛНАЯ ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
   Все функции + оптимизация + автодополнение поиска
   ========================================== */

// ==========================================
// ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ
// ==========================================

const API_BASE = 'https://script.google.com/macros/s/AKfycbx9c1jATu23yjI0HWRQI-uNqKVwHorthbmwHHVyBK5W8ipMUUXZUxwuagkh0GPJU2p4Aw/exec';

// ==========================================
// ✨ ХРАНИЛИЩЕ ТЕМ ДЛЯ РОЛЕЙ
// ==========================================
const ROLE_THEMES = {
    'default': { // Стандартная тема
        owner: 'Владелец',
        admin: 'Администратор',
        creator: 'Создатель',
        reader: 'Читатель'
    },
    'сянься': { // Тема культивации
        owner: 'Основатель Секты',
        admin: 'Старейшина Пика Наказаний',
        creator: 'Ученик Пика Искусств',
        reader: 'Ученик'
    },
    'фэнтези': { // Тема фэнтези
        owner: 'Владыка',
        admin: 'Хранитель',
        creator: 'Летописец',
        reader: 'Странник'
    },
    'достопочтенный': { // Тема "Этот Достопочтенный"
        owner: 'Этот Достопочтенный',
        admin: 'Правая Рука',
        creator: 'Верный Слуга',
        reader: 'Проситель'
    },
    'смешная': { // Смешная тема
        owner: 'Повелитель Копипасты',
        admin: 'Местный Цензор',
        creator: 'Графоман',
        reader: 'Заглянул на огонёк'
    },
};

// Централизованное состояние приложения
const STATE = {
    novels: [],
    filteredNovels: [],
    config: {},
    genresAndTags: { genres: [], tags: [] },
    currentUser: null,
    currentPage: 1,
    itemsPerPage: 12,
    totalPages: 1,
    isInitialized: false,
    isSubmittingNovel: false,
    currentFilters: {
        language: '',
        era: '',
        perspective: '',
        orientation: '',
        originalStatus: '', // Новое имя
        translationStatus: '', // Новое имя
        chaptersMin: null,
        chaptersMax: null,
        wordsMin: null,
        wordsMax: null,
        includeGenres: [], // Жанры для включения
        includeGenreMode: 'any', // 'any' или 'all'
        excludeGenres: [], // Жанры для исключения
        excludeGenreMode: 'any', // 'any' (режим 'all' для исключения редко нужен)
        includeTags: [], // Теги для включения
        includeTagMode: 'any', // 'any' или 'all'
        excludeTags: [], // Теги для исключения
        excludeTagMode: 'any', // 'any'
    },
    viewMode: 'grid', // grid или list
    sortBy: 'updated', // updated, title, author, chapters
    sortOrder: 'desc',
    currentRoleTheme: 'default',
    isChapterEditMode: false,
    cache: {
        data: {},
        ttl: 5 * 60 * 1000 // 5 минут
    }
};

let currentThemePalette = localStorage.getItem('novel-library-theme') || 'classic';
let currentThemeMode = localStorage.getItem('novel-library-mode') || 'light';
let chapterSortOrder = 'asc';
let chapterNumberCheckTimeout = null;
let lastCheckedNumber = null;
let isRendering = false;
let tooltipElement = null
let currentScrollHandler = null;
let isTelegramWidgetLoaded = false;

console.log('📦 Script.js загружен - ПОЛНАЯ версия');

// Защита критических элементов от удаления
const PROTECTED_IDS = ['app', 'app-container', 'breadcrumbs'];
const originalRemove = Element.prototype.remove;
Element.prototype.remove = function() {
    if (PROTECTED_IDS.includes(this.id)) {
        console.warn('⚠️ Защита: попытка удалить', this.id);
        return;
    }
    originalRemove.call(this);
};

// ==========================================
// API КОММУНИКАЦИЯ - ОПТИМИЗИРОВАННАЯ
// ==========================================

// ✅ ПРАВИЛЬНАЯ И РАБОЧАЯ ВЕРСИЯ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ (GET-ЗАПРОСЫ)
function apiRequest(action, data = {}, forceFresh = false) {
    // Добавляем токен сессии, если он есть
    const sessionToken = localStorage.getItem('session_token');
    if (sessionToken) {
        data.session_token = sessionToken;
    }

    const cacheKey = `${action}_${JSON.stringify(data)}`;
    
// Проверяем кэш, НО игнорируем его для опроса статуса
    if (!forceFresh && STATE.cache.data[cacheKey]) {
        const cached = STATE.cache.data[cacheKey];
        if (Date.now() - cached.timestamp < STATE.cache.ttl) {
            console.log(`💾 Кэш: ${action}`);
            return Promise.resolve(cached.data);
        }
    }
    
    // Оборачиваем в Promise для использования async/await
    return new Promise((resolve, reject) => {
        // Создаём уникальное имя для нашего "почтового ящика"
        const callbackName = 'jsonp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Формируем URL с параметрами
        const params = new URLSearchParams({ action, callback: callbackName, ...data });
        const script = document.createElement('script');
        script.src = `${API_BASE}?${params}`;
        
        // Таймер безопасности на случай, если сервер не отвечает
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout: сервер не отвечает'));
        }, 30000); // 30 секунд
        
        // Функция для очистки
        const cleanup = () => {
            clearTimeout(timeout);
            if (script.parentNode) document.head.removeChild(script);
            delete window[callbackName]; // Удаляем "почтовый ящик"
        };
        
        // Создаём тот самый "почтовый ящик" (глобальную функцию)
        window[callbackName] = (response) => {
            cleanup();
            // Кэшируем ответ
            STATE.cache.data[cacheKey] = {
                data: response,
                timestamp: Date.now()
            };
            resolve(response); // Отправляем данные туда, где их ждут
        };
        
        // Обработка сетевых ошибок
        script.onerror = () => {
            cleanup();
            reject(new Error('Сетевая ошибка'));
        };
        
        // Добавляем скрипт на страницу, чтобы запустить запрос
        document.head.appendChild(script);
    });
}

// ✅ ДВУХЭТАПНАЯ ВЕРСИЯ ДЛЯ ОТПРАВКИ ДАННЫХ (POST-ЗАПРОСЫ)
async function apiPostRequest(action, data = {}) {
    console.log(`📤 POST (двухэтапный): ${action}`);
    
    const sessionToken = localStorage.getItem('session_token');
    if (sessionToken) { 
        data.session_token = sessionToken; 
    }
    
    try {
        // ШАГ 1: Генерируем уникальный ID запроса
        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // ШАГ 2: Отправляем данные через форму
        console.log(`📨 Отправка данных: ${requestId}`);
        await submitPostData(action, data, requestId);
        
        // ШАГ 3: Опрашиваем статус через GET
        console.log(`🔄 Ожидание результата: ${requestId}`);
        const result = await pollRequestStatus(requestId);
        
        console.log(`✅ POST успешен: ${action}`, result);
        return result;
        
    } catch (error) {
        console.error(`❌ POST ошибка: ${action}`, error);
        throw error;
    }
}

// Вспомогательная функция: отправка данных через форму
function submitPostData(action, data, requestId) {
    return new Promise((resolve) => {
        const uniqueId = 'iframe_' + requestId;
        
        // Создаём невидимый iframe
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.name = uniqueId;
        iframe.id = uniqueId;
        document.body.appendChild(iframe);

        // Создаём форму
        const form = document.createElement('form');
        form.target = uniqueId;
        form.action = API_BASE;
        form.method = 'POST';

        // Добавляем поля
        const fields = {
            action: action,
            request_id: requestId,
            data: JSON.stringify(data)
        };

        for (let [key, value] of Object.entries(fields)) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = value;
            form.appendChild(input);
        }

        document.body.appendChild(form);

        // Отправляем форму
        form.submit();

        // Даём время на отправку, затем удаляем элементы
        setTimeout(() => {
            if (iframe.parentNode) iframe.remove();
            if (form.parentNode) form.remove();
            resolve();
        }, 1500); // Увеличили до 1.5 сек для надёжности
    });
}

// Вспомогательная функция: опрос статуса запроса
async function pollRequestStatus(requestId, maxAttempts = 40) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Ждём перед проверкой (первую проверку делаем сразу)
        if (attempt > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 секунда
        }
        
        try {
            // Запрашиваем статус через GET
            const response = await apiRequest('getPostStatus', { request_id: requestId }, true);
            
            if (response.status === 'completed') {
                console.log(`✅ Запрос выполнен (попытка ${attempt}/${maxAttempts})`);
                return response.result;
            } else if (response.status === 'error') {
                throw new Error(response.error || 'Ошибка выполнения запроса');
            } else if (response.status === 'pending') {
                console.log(`⏳ Ожидание... (попытка ${attempt}/${maxAttempts})`);
                // Продолжаем опрос
            } else {
                // Статус не найден - запрос ещё не обработан
                console.log(`⏳ Запрос обрабатывается... (попытка ${attempt}/${maxAttempts})`);
            }
        } catch (error) {
            // Если это последняя попытка, выбрасываем ошибку
            if (attempt === maxAttempts) {
                throw new Error(`Timeout: запрос не выполнен за ${maxAttempts} секунд`);
            }
            // Иначе продолжаем попытки
            console.log(`⚠️ Ошибка проверки статуса (попытка ${attempt}/${maxAttempts}):`, error.message);
        }
    }
    
    throw new Error('Timeout: превышено максимальное время ожидания');
}

// Очистка кэша
function clearCache() {
    STATE.cache.data = {};
    console.log('🗑️ Кэш очищен');
}

// ==========================================
// НАВИГАЦИЯ - POPSTATE (РАБОТАЮЩИЕ ПРЯМЫЕ ССЫЛКИ)
// ==========================================

/**
 * Умная навигация назад с использованием истории браузера
 */
function goBackInHistory() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        navigateTo('home');
    }
}

function navigateTo(page, params = {}) {

    // ✨ ГЛАВНОЕ ИСПРАВЛЕНИЕ: Создаём URL с чистого листа
    const url = new URL(window.location.origin + window.location.pathname);
    
    // 1. Добавляем обязательный параметр 'page'
    url.searchParams.set('page', page);
    
    // 2. Добавляем только те параметры, которые нужны для ЭТОЙ страницы
    Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
            url.searchParams.set(key, params[key]);
        }
    });

    // 3. Если мы переходим на каталог, сохраняем номер страницы пагинации
    if ((page === 'home' || page === 'catalog') && STATE.currentPage > 1) {
        url.searchParams.set('p', STATE.currentPage);
    }
    
    // Обновляем адресную строку и рендерим страницу
    window.history.pushState({ page, params }, '', url);
    renderPage(page, params, { scrollToTop: true });
}

// Обработка кнопок Назад/Вперёд браузера
window.addEventListener('popstate', (e) => {
    if (e.state && e.state.page) {
        renderPage(e.state.page, e.state.params || {});
    } else {
        // Парсим URL если нет state
        const urlParams = new URLSearchParams(window.location.search);
        const page = urlParams.get('page') || 'home';
        const params = {};
        
        urlParams.forEach((value, key) => {
            if (key !== 'page') params[key] = value;
        });
        
        renderPage(page, params, { scrollToTop: false });
    }
});

// Главный роутер страниц
// ЗАМЕНИТЕ ВАШУ ФУНКЦИЮ renderPage НА ЭТУ:
async function renderPage(page, params = {}, options = {}) {
    const { scrollToTop = false } = options;

    window.scrollTo(0, 0);

    // ✨ ИСПРАВЛЕНИЕ №2: Принудительно включаем скролл
    // (на случай, если модальное окно не закрылось и оставило overflow: hidden)
    try {
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto'; // И для <html> на всякий случай
    } catch (e) {}

    if (isRendering) {
        console.warn('Рендеринг уже идёт, новый вызов заблокирован:', page);
        return;
    }
    isRendering = true;

    // --- Дальше идет ВЕСЬ ВАШ КОД ИЗ renderPage без изменений ---

    // --- ✨ НОВЫЙ БЛОК: Удаление плавающей кнопки полки ---
    const floatingButton = document.querySelector('.floating-shelf-button');
    if (floatingButton && page !== 'novel-details') { // Удаляем, если НЕ страница деталей
        floatingButton.remove();
        console.log("Плавающая кнопка полки удалена.");
    }

    // Remove previous scroll/mousemove listeners if they exist
    if (currentScrollHandler) {
        // ✨ Получаем сохраненную цель (теперь это document) ✨
        const scrollTarget = currentScrollHandler._scrollTarget;
        // ✨ Исправляем targetName и проверку ✨
        const targetName = scrollTarget === window ? 'window' : (scrollTarget?.tagName || 'unknown');

        if (scrollTarget && scrollTarget === window) { // <-- Проверяем window
            scrollTarget.removeEventListener('scroll', currentScrollHandler);
            console.log(`Scroll listener removed from ${targetName}.`);
        } else {
            // Предупреждение остается, на случай если цель изменится
            console.warn(`Попытка удалить слушатель скролла с неожиданной цели: ${scrollTarget}`);
            // Попробуем удалить с window на всякий случай, если что-то пошло не так
            window.removeEventListener('scroll', currentScrollHandler);
        }

        if (currentScrollHandler._mouseMoveHandler) {
            document.removeEventListener('mousemove', currentScrollHandler._mouseMoveHandler);
            console.log("MouseMove listener removed.");
        }

        currentScrollHandler = null;
    }

    const mainHeader = document.getElementById('main-header');
    if (mainHeader) {
        if (page !== 'chapter-read') {
            mainHeader.classList.remove('is-hidden'); // Показываем
        } else {
            mainHeader.classList.add('is-hidden'); // Скрываем
        }
    }
    
    console.log(`📄 Рендеринг: ${page}`, params);

    // ✨ НАШ НОВЫЙ "ОХРАННИК" ✨
    // Список страниц, для которых нужны права 'creator' или выше
    const creatorPages = ['add-novel', 'edit-novel', 'add-chapter', 'edit-chapter'];
    // Проверяем, нужна ли для страницы авторизация
    if ((creatorPages.includes(page) || page === 'profile') && !STATE.currentUser) {
        // Сначала базовая проверка: если пользователь вообще не вошел
        showToast('Для доступа к этой странице необходимо войти', 'warning');
        navigateTo('home'); // Просто перенаправляем на главную
        isRendering = false;
        return;
    }

    // Теперь более строгая проверка: проверяем права на создание/редактирование
    if (creatorPages.includes(page) && !checkUserPermission('create')) {
        // checkUserPermission('create') вернет true для creator, admin и owner
        showToast('У вас недостаточно прав для доступа к этой странице', 'error');
        navigateTo('home'); // Перенаправляем на главную
        isRendering = false;
        return;
    }
    
    const catalogViewElements = ['search-section', 'novels-container'];
    const pageViewContainer = document.getElementById('page-content-container');

    if (page === 'home' || page === 'catalog') {
        catalogViewElements.forEach(id => showSection(id));
        if (pageViewContainer) {
            pageViewContainer.style.display = 'none';
            pageViewContainer.innerHTML = '';
        }
    } else {
        catalogViewElements.forEach(id => hideSection(id));
        if (pageViewContainer) pageViewContainer.style.display = 'block';
    }
    
    try {
        switch(page) {
            case 'home':
            case 'catalog':
                await renderCatalogPage();
                break;
                
            case 'novel-details':
                if (params.id) await renderNovelDetailsPage(params.id);
                break;
                
            case 'add-novel':
                await renderNovelFormPage();
                break;
                
            case 'edit-novel':
                if (params.id) await renderNovelFormPage(params.id);
                break;
                
            case 'chapter-read':
                if (params.id) await renderChapterReadPage(params.id);
                break;
                
            case 'add-chapter':
                if (params.novelId) await renderChapterFormPage(params.novelId);
                break;
                
            case 'edit-chapter':
                if (params.id) await renderChapterFormPage(null, params.id);
                break;
                
            case 'author':
                if (params.name) await renderAuthorPage(params.name);
                break;
            
            case 'profile':
                await renderProfilePage();
                break;

            case 'profile-settings': // ✨ NEW CASE ✨
                await renderProfileSettingsPage();
                break;
            
            case 'creator': // ✨ NEW
                if (params.id) await renderCreatorPage(params.id);
                break;
                
            default:
                await renderCatalogPage();
        }
    } catch (error) {
        console.error('Ошибка рендеринга:', error);
        showToast('Не удалось загрузить страницу', 'error');
    } finally {
        // --- (Логика прокрутки) ---
        if (scrollToTop) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0; 
            document.body.scrollTop = 0; 
        }
        // --- КОНЕЦ ВСТАВКИ ---

        isRendering = false; // ✨ Снимаем блокировку в конце
    }
}

/**
 * ✨ NEW: Глобальный обработчик для всех SPA-ссылок.
 * Позволяет левому клику работать как SPA, а правому - как обычной ссылке.
 * @param {Event} event - Событие клика
 */
function handleLinkClick(event) {
    // 1. Проверяем, что это простой левый клик
    if (
        event.button !== 0 || // Не левая кнопка
        event.ctrlKey ||       // Нажат Ctrl
        event.metaKey ||       // Нажат Cmd (Mac)
        event.shiftKey ||      // Нажат Shift
        event.altKey           // Нажат Alt
    ) {
        return; // Разрешаем стандартное поведение (открыть в новой вкладке, etc.)
    }
    
    // 2. Находим сам тег <a> (клик мог быть по <span> внутри него)
    // currentTarget - это тот, на ком висит onclick
    const link = event.currentTarget; 
    
    // 3. Предотвращаем переход по ссылке
    event.preventDefault();
    
    try {
        // 4. Получаем URL из href
        const url = new URL(link.href);
        
        // 5. Парсим параметры
        const urlParams = url.searchParams;
        const page = urlParams.get('page') || 'home';
        const params = {};
        
        urlParams.forEach((value, key) => {
            if (key !== 'page') {
                params[key] = value;
            }
        });
        
        // 6. Вызываем нашу SPA-навигацию
        navigateTo(page, params);
        
    } catch (error) {
        console.error('Ошибка SPA-навигации:', error);
        // В случае ошибки, просто переходим по ссылке как обычно
        window.location.href = link.href;
    }
}

// Хлебные крошки
function getBreadcrumbs(page, params = {}) {
    // Если мы на главной, возвращаем пустую строку
    if (page === 'home' || page === 'catalog') {
        return '';
    }

    // ✨ Используем ваше название переменной
    let breadcrumbs = '<a href="/?page=home" onclick="handleLinkClick(event)">Главная</a>';
    
    // ✨ Включаем все ваши 'case'
    switch(page) {
        case 'novel-details':
            breadcrumbs += ` <span>›</span> <span>${escapeHtml(params.title || 'Новелла')}</span>`;
            break;
        case 'chapter-read':
            // ✨ ИСПРАВЛЕНО:
            breadcrumbs += ` <span>›</span> <a href="/?page=novel-details&id=${params.novelId}" onclick="handleLinkClick(event)">${escapeHtml(params.novelTitle || 'Новелла')}</a>`;
            breadcrumbs += ` <span>›</span> <span>${escapeHtml(params.chapterTitle || 'Глава')}</span>`;
            break;
        case 'creator':
            breadcrumbs += ` <span>›</span> <span>Профиль: ${escapeHtml(params.name || 'Создатель')}</span>`;
            break;
        case 'profile':
            breadcrumbs += ' <span>›</span> <span>Мой профиль</span>';
            break;
        case 'profile-settings': // ✨ NEW CASE ✨
            breadcrumbs += ' <span>›</span> <a href="/?page=profile" onclick="handleLinkClick(event)">Мой профиль</a>';
            breadcrumbs += ' <span>›</span> <span>Настройки</span>';
            break;
        case 'add-chapter':
        case 'edit-chapter':
            // ✨ ИСПРАВЛЕНО:
            breadcrumbs += ` <span>›</span> <a href="/?page=novel-details&id=${params.novelId}" onclick="handleLinkClick(event)">${escapeHtml(params.novelTitle || 'Новелла')}</a>`;
            breadcrumbs += ` <span>›</span> <span>${page === 'add-chapter' ? 'Добавление главы' : 'Редактирование главы'}</span>`;
            break;
        case 'add-novel':
            breadcrumbs += ' <span>›</span> <span>Добавить новеллу</span>';
            break;
        case 'edit-novel':
            // ✨ ИСПРАВЛЕНО:
            breadcrumbs += ` <span>›</span> <a href="/?page=novel-details&id=${params.id}" onclick="handleLinkClick(event)">${escapeHtml(params.title || 'Новелла')}</a>`;
            breadcrumbs += ` <span>›</span> <span>Редактирование</span>`;
            break;
        case 'author':
            breadcrumbs += ' <span>›</span> <span>Автор</span>';
            break;
    }
    
    // Возвращаем готовый HTML в контейнере
    return `<div class="breadcrumbs">${breadcrumbs}</div>`;
}

// ==========================================
// СТРАНИЦА КАТАЛОГА (ГЛАВНАЯ)
// ==========================================

async function renderCatalogPage(isSkeleton = false) {
    showSection('search-section');
    showSection('novels-container');
    
    const grid = document.getElementById('novels-grid');
    if (!grid) return;

    // ✨ Если это первый запуск, показываем скелет
    if (isSkeleton) {
    // Применяем правильный класс в зависимости от режима просмотра (до вставки skeleton)
    grid.className = STATE.viewMode === 'list' ? 'novels-grid list-view' : 'novels-grid';
        
        // Рисуем 12 skeleton карточек
        grid.innerHTML = Array(12).fill(null).map(() => renderSkeletonCard()).join('');
        return;
    }

    // Если функция вызвана уже с данными, работаем как обычно
    if (STATE.genresAndTags.genres.length === 0) {
        // Мы уже загрузили их в initializeApp, но на всякий случай оставим проверку
        await loadGenresAndTags();
    }
    setupAdvancedFilters();
    
    const novelsToShow = STATE.filteredNovels.length > 0 ? STATE.filteredNovels : STATE.novels;
    renderNovelsGrid(novelsToShow);
    renderPagination();
}

function renderSkeletonCard() {
  const isListView = STATE.viewMode === 'list';
    if (isListView) {
        return `
        <div class="novel-card skeleton-card list-view-card">
            <div class="novel-cover">
                <div class="skeleton skeleton-cover"></div>
            </div>
            <div class="novel-info">
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text short"></div>
            </div>
        </div>
        `;
    }

    return `
        <div class="novel-card skeleton-card grid-view-card">
            <div class="novel-cover">
                <div class="skeleton skeleton-cover"></div>
            </div>
            <div class="novel-info">
                <div class="skeleton skeleton-title"></div>
            </div>
        </div>
    `;
}

/**
 * Показывает skeleton карточки при загрузке
 */
function showSkeletonCards(count = 12) {
    const grid = document.getElementById('novels-grid');
    if (!grid) return;
    
    // Применяем правильный класс в зависимости от режима просмотра (до вставки skeleton)
    grid.className = STATE.viewMode === 'list' ? 'novels-grid list-view' : 'novels-grid';
    
    // Генерируем skeleton карточки
    const skeletons = Array(count).fill(null).map(() => renderSkeletonCard()).join('');
    grid.innerHTML = skeletons;
}

function renderNovelsGrid(novels) {
    const grid = document.getElementById('novels-grid');
    const statsBar = document.getElementById('stats-bar');
    const novelsCount = document.getElementById('novels-count');
    
    if (!grid) return;
    
    // Обновляем статистику
    if (novelsCount) {
        novelsCount.textContent = `${novels.length} ${getNounEnding(novels.length, 'новелла', 'новеллы', 'новелл')}`;
    }
    
    if (statsBar) statsBar.style.display = 'flex';
    
    if (novels.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <h3>Новеллы не найдены</h3>
                <p>Попробуйте изменить поисковый запрос или фильтры</p>
            </div>
        `;
        return;
    }
    
    // Пагинация
    const startIdx = (STATE.currentPage - 1) * STATE.itemsPerPage;
    const endIdx = startIdx + STATE.itemsPerPage;
    const pageNovels = novels.slice(startIdx, endIdx);
    
    STATE.totalPages = Math.ceil(novels.length / STATE.itemsPerPage);
    
    // Рендерим карточки
    grid.className = STATE.viewMode === 'list' ? 'novels-grid list-view' : 'novels-grid';
    grid.innerHTML = pageNovels.map(novel => renderNovelCard(novel)).join('');
}

/**
 * ✅ ОБНОВЛЕННАЯ ВЕРСИЯ V2
 * Рендерит карточку новеллы как ССЫЛКУ <a> для гибридной SPA-навигации.
 * @param {object} novel - Объект с данными новеллы
 */
function renderNovelCard(novel) {
    const isListView = STATE.viewMode === 'list';
    let cardClass = 'novel-card';
    let overlayHtml = '';
    // ✨ Определяем URL ссылки ✨
    const novelUrl = `/?page=novel-details&id=${novel.novel_id}`;
    // ✨ Атрибуты для тега <a> - URL и класс для перехвата ✨
    let linkAttributes = `href="${novelUrl}" class="novel-card-link"`;

    // Логика для удаленных, обрабатывающихся, ошибочных
    if (novel.is_deleted) {
        cardClass += ' deleted';
        // Убираем стандартный URL, добавляем onclick для восстановления
        linkAttributes = `href="#" onclick="handleRestoreNovel('${novel.novel_id}'); event.preventDefault();" class="novel-card-link deleted-link"`;
        overlayHtml = `<div class="novel-card-overlay"><span class="restore-icon">↩️</span><span>Восстановить</span></div>`;
    } else if (novel.original_status === 'processing') {
        cardClass += ' processing';
        linkAttributes = `href="#" class="novel-card-link disabled"`; // Делаем некликабельной
        overlayHtml = `<div class="novel-card-overlay"><div class="spinner"></div><span>Создается...</span></div>`;
    } else if (novel.original_status === 'error') {
        cardClass += ' error';
        // Убираем стандартный URL, добавляем onclick для обработки ошибки
        linkAttributes = `href="#" onclick="handleErrorNovelClick('${novel.novel_id}'); event.preventDefault();" class="novel-card-link error-link"`;
        overlayHtml = `<div class="novel-card-overlay"><span class="error-icon">⚠️</span><span>Ошибка</span></div>`;
    }

    const statusClass = getStatusClass(novel.translation_status);

    // Содержимое карточки (внутренний HTML для div.novel-card)
    let cardInnerHtml = '';

    if (!isListView) { // --- СЕТКА ---
        cardClass += ' grid-view-card';
        cardInnerHtml = `
            ${overlayHtml}
            ${novel.language ? `<span class="novel-language">${escapeHtml(novel.language)}</span>` : ''}
            ${novel.translation_status ? `<span class="novel-status ${statusClass}">${escapeHtml(novel.translation_status)}</span>` : ''}
            <div class="novel-cover">
                ${novel.cover_url ? `<img src="${escapeHtml(novel.cover_url)}" alt="${escapeHtml(novel.title)}" loading="lazy">` : '<div class="no-cover">📚</div>'}
            </div>
            <div class="novel-info">
                <h3 class="novel-title">${escapeHtml(novel.title)}</h3>
            </div>
        `;
    } else { // --- СПИСОК ---
        cardClass += ' list-view-card';
        const metaInfo = [novel.orientation, novel.era, novel.perspective].filter(Boolean).join(' · ');
        cardInnerHtml = `
            ${overlayHtml}
            ${novel.language ? `<span class="novel-language">${escapeHtml(novel.language)}</span>` : ''}
            ${novel.translation_status ? `<span class="novel-status ${statusClass}">${escapeHtml(novel.translation_status)}</span>` : ''}
            <div class="novel-cover">
                 ${novel.cover_url ? `<img src="${escapeHtml(novel.cover_url)}" alt="${escapeHtml(novel.title)}" loading="lazy">` : '<div class="no-cover">📚</div>'}
            </div>
            <div class="novel-info">
                <h3 class="novel-title">${escapeHtml(novel.title)}</h3>
                <p class="novel-author">
                    <a href="/?page=author&name=${encodeURIComponent(novel.author)}" class="author-link-inline" onclick="handleLinkClick(event)">
                        ${escapeHtml(novel.author)}
                    </a>
                </p>
                <div class="novel-meta-line">
                     ${novel.original_chapter_count ? `<span>${novel.original_chapter_count} глав в оригинале</span>` : ''}
                     ${metaInfo ? `<span>${escapeHtml(metaInfo)}</span>` : ''}
                </div>
            </div>
        `;
    }
    // ✨ Возвращаем ССЫЛКУ <a>, которая ОБОРАЧИВАЕТ <div> карточки ✨
    // ✨ К ссылке добавляем onclick="handleLinkClick(event)" для перехвата ✨
    return `<a ${linkAttributes} onclick="handleLinkClick(event)">
               <div class="${cardClass}">
                   ${cardInnerHtml}
               </div>
           </a>`;
}

// Добавим вспомогательную функцию для статуса (если её еще нет)
function getStatusClass(status) {
    const _status = (status || '').toString().toLowerCase();
    if (_status.includes('продолжается') || _status.includes('ongoing') || _status.includes('в процессе')) return 'status-ongoing';
    if (_status.includes('заморожен') || _status.includes('заброшен') || _status.includes('hiatus') || _status.includes('перерыв')) return 'status-hiatus';
    if (_status.includes('завершен') || _status.includes('completed')) return 'status-completed';
    return 'status-unknown';
}

function handleRestoreNovel(novelId) {
    // Останавливаем переход на другую страницу, если он был
    event.stopPropagation(); 
    
    showConfirmModal('Восстановить новеллу?', 'Вы уверены, что хотите восстановить эту новеллу из корзины?',
        async () => {
            showLoading(true, { title: 'Восстановление...' });
            try {
                const response = await apiPostRequest('restoreNovel', { novelId: novelId });
                if (response.success) {
                    showToast(response.message, 'success');
                    clearCache();
                    // Обновляем вкладку "Созданные", если мы на странице профиля
                    if (document.querySelector('.profile-page')) {
                        await renderProfileCreatedNovels();
                    }
                } else {
                    throw new Error(response.error);
                }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

// ==========================================
// ПАГИНАЦИЯ
// ==========================================

function renderPagination() {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer || STATE.totalPages <= 1) {
        if (paginationContainer) paginationContainer.innerHTML = ''; // Очищаем контейнер, если страниц мало
        return;
    }
    
    // ✨ Теперь мы управляем всем контейнером, а не его частью
    paginationContainer.style.display = 'flex';
    
    const maxButtons = 7;
    const current = STATE.currentPage;
    const total = STATE.totalPages;
    
    // Собираем HTML только для кнопок
    let buttonsHtml = `
        <button class="pagination-btn" ${current === 1 ? 'disabled' : ''} 
                onclick="goToPage(1)" title="Первая страница">«</button>
        <button class="pagination-btn" ${current === 1 ? 'disabled' : ''} 
                onclick="goToPage(${current - 1})" title="Предыдущая">‹</button>
    `;
    
    let startPage = Math.max(1, current - Math.floor(maxButtons / 2));
    let endPage = Math.min(total, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        buttonsHtml += `<button class="pagination-btn page-number" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) buttonsHtml += `<span class="pagination-ellipsis">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        buttonsHtml += `
            <button class="pagination-btn page-number ${i === current ? 'active' : ''}" 
                    onclick="goToPage(${i})">${i}</button>
        `;
    }
    
    if (endPage < total) {
        if (endPage < total - 1) buttonsHtml += `<span class="pagination-ellipsis">...</span>`;
        buttonsHtml += `<button class="pagination-btn page-number" onclick="goToPage(${total})">${total}</button>`;
    }
    
    buttonsHtml += `
        <button class="pagination-btn" ${current === total ? 'disabled' : ''} 
                onclick="goToPage(${current + 1})" title="Следующая">›</button>
        <button class="pagination-btn" ${current === total ? 'disabled' : ''} 
                onclick="goToPage(${total})" title="Последняя">»</button>
    `;
    
    // ✨ Полностью заменяем содержимое контейнера только кнопками
    paginationContainer.innerHTML = `<div class="pagination-wrapper">${buttonsHtml}</div>`;
}

function goToPage(page) {
    if (page < 1 || page > STATE.totalPages || page === STATE.currentPage) return;
    
    // ✨ ИЗМЕНЕНИЕ: Обновляем URL, добавляя номер страницы
    const url = new URL(window.location);
    url.searchParams.set('p', page); // 'p' - короткий параметр для номера страницы
    // Обновляем адресную строку без перезагрузки страницы
    window.history.pushState({ page: 'catalog', params: { p: page } }, '', url);

    STATE.currentPage = page;
    const novelsToShow = STATE.filteredNovels.length > 0 ? STATE.filteredNovels : STATE.novels;
    renderNovelsGrid(novelsToShow);
    renderPagination();
    
    // Прокрутка вверх
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// ДЕТАЛИ НОВЕЛЛЫ
// ==========================================

async function renderNovelDetailsPage(novelId) {
    const container = document.getElementById('page-content-container');
    if (!container) return;
    
    // --- Skeleton Loading ---
    container.innerHTML = `
        <div class="page-content novel-details-page novel-details-page-skeleton">
            <div class="breadcrumbs-skeleton skeleton"></div>
            <div class="page-header-skeleton">
                <div class="skeleton" style="width: 150px; height: 36px;"></div>
                <div class="skeleton" style="width: 250px; height: 36px;"></div>
            </div>
            <div class="novel-content-wrapper-skeleton">
                <div class="novel-cover-float-skeleton skeleton"></div>
                <aside class="novel-info-desktop-skeleton skeleton"></aside>
                <div class="novel-description-float-skeleton">
                    <div class="tabs-skeleton skeleton"></div>
                    <div class="text-skeleton skeleton"></div>
                    <div class="text-skeleton skeleton" style="width: 80%;"></div>
                    <div class="text-skeleton skeleton" style="width: 60%;"></div>
                </div>
            </div>
            <hr class="section-divider">
            <div class="taxonomy-skeleton skeleton"></div>
            <hr class="section-divider">
             <div class="chapters-header-skeleton skeleton"></div>
             <div class="chapters-list-skeleton">
                <div class="skeleton" style="height: 40px; margin-bottom: 5px;"></div>
                <div class="skeleton" style="height: 40px; margin-bottom: 5px;"></div>
                <div class="skeleton" style="height: 40px; margin-bottom: 5px;"></div>
             </div>
        </div>
    `;
    // --- End Skeleton ---
    
    try {
        const response = await apiRequest('getNovel', { id: novelId });
        
        if (response.success && response.novel) {
            // ✨ ВОТ ИЗМЕНЕНИЕ: Передаем название новеллы в "хлебные крошки"
            const breadcrumbs = getBreadcrumbs('novel-details', {
                id: novelId, // Pass ID for edit link in breadcrumbs if needed
                title: response.novel.title
            });

            renderNovelDetailsContent(response.novel, response.novel.chapters || [], breadcrumbs);

        } else {
            throw new Error(response.error || 'Новелла не найдена');
        }
    } catch (error) {
        // Render error message (replaces skeleton)
         container.innerHTML = `
             <div class="error-page">
                 <h3>❌ Ошибка загрузки</h3>
                 <p>${error.message}</p>
                 <button class="btn btn-primary" onclick="goBackInHistory()">
                     ← Вернуться
                 </button>
             </div>
         `;
    }
    // No showLoading(false) needed
}


function renderNovelDetailsContent(novel, chapters, breadcrumbs) {
    const container = document.querySelector('.novel-details-page');
    if (!container) return;

    const actualTranslationWordCount = chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0);
    
    const canEdit = checkUserPermission('edit', novel);

    const tagsHtml = novel.tags?.map(t => `
        <span class="tag-badge clickable"
            data-description="${t.description ? escapeHtml(t.description) : ''}"
            onclick="filterByTag('${escapeHtml(t.name)}')">
            ${escapeHtml(t.name)}
        </span>
    `).join('') || '';

    // ✨ СОЗДАЁМ HTML ДЛЯ КНОПОК УПРАВЛЕНИЯ ОТДЕЛЬНО ✨
    const actionsHtml = canEdit ? `
        <div class="novel-actions-bar">
            <button class="action-btn edit" onclick="navigateTo('edit-novel', {id: '${novel.novel_id}'})" title="Редактировать новеллу">
                ✏️ <span>Редактировать</span>
            </button>
            <button class="action-btn share" onclick="handleShareNovel('${novel.novel_id}')" title="Поделиться">
                🔗 <span>Поделиться</span>
            </button>
            <button class="action-btn delete" onclick="handleDeleteNovel('${novel.novel_id}')" title="Удалить новеллу">
                🗑️ <span>Удалить</span>
            </button>
        </div>
    ` : '';

    let additionalLinksHtml = ''; // Объявляем переменную
    if (novel.additional_links) {
        try {
            // Используем makeLinksClickable для превращения ссылок в кликабельные
            additionalLinksHtml = `
                <div>
                    <span>Доп. ссылки:</span>
                    <span class="additional-links-display">${makeLinksClickable(novel.additional_links)}</span>
                </div>`;
        } catch (e) {
             console.error("Ошибка в makeLinksClickable:", e);
             additionalLinksHtml = `<div><span>Доп. ссылки:</span> <span>${escapeHtml(novel.additional_links)}</span></div>`; // Fallback без кликабельности
        }
    }

    // РАСШИРЕННАЯ ИНФОРМАЦИОННАЯ ТАБЛИЦА
    const infoTableHtml = `
        <div class="info-table">
            ${novel.creator ? `<div><span>Создатель:</span> <span class="author-name"><a href="/?page=creator&id=${novel.creator.user_id}" onclick="handleLinkClick(event)">${escapeHtml(novel.creator.username)}</a></span></div>` : ''}
            ${novel.language ? `<div><span>Язык оригинала:</span> <span>${escapeHtml(novel.language)}</span></div>` : ''}
            ${novel.year ? `<div><span>Год:</span> <span>${escapeHtml(novel.year)}</span></div>` : ''}
            ${novel.original_status ? `<div><span>Статус оригинала:</span> <span>${escapeHtml(novel.original_status)}</span></div>` : ''}
            ${novel.translation_status ? `<div><span>Статус перевода:</span> <span>${escapeHtml(novel.translation_status)}</span></div>` : ''}
            ${novel.era ? `<div><span>Эра:</span> <span>${escapeHtml(novel.era)}</span></div>` : ''}
            ${novel.orientation ? `<div><span>Тип отношений:</span> <span>${escapeHtml(novel.orientation)}</span></div>` : ''}
            ${novel.perspective ? `<div><span>Перспектива:</span> <span>${escapeHtml(novel.perspective)}</span></div>` : ''}
            <div><span>Слов (ориг./пер.):</span> <span>${formatNumber(novel.original_word_count || 0)} / ${formatNumber(actualTranslationWordCount)}</span></div>
            <div><span>Глав (ориг./пер.):</span> <span>${novel.original_chapter_count || 0} / ${novel.chapter_count || 0}</span></div>
            ${novel.access_type ? `<div><span>Доступ:</span> <span>${getAccessLabel(novel.access_type)}</span></div>` : ''}
            ${novel.created_at ? `<div><span>Добавлена:</span> <span>${formatDate(novel.created_at)}</span></div>` : ''}
            ${novel.updated_at ? `<div><span>Обновлена:</span> <span>${formatDate(novel.updated_at)}</span></div>` : ''}
            ${additionalLinksHtml}
        </div>
    `;

    // КНОПКА НАЧАТЬ ЧТЕНИЕ
    const startReadingButton = chapters.length > 0 ? `
        <div class="start-reading-container">
            <button class="btn btn-primary start-reading-btn" onclick="startReading()">
                Начать чтение
            </button>
            ${chapters.length > 1 ? `
                <div class="reading-progress">
                    <small>Доступно глав: ${chapters.length}</small>
                </div>
            ` : ''}
        </div>
    ` : '';

    const chaptersHtml = renderChaptersListV2(chapters, novel.has_volumes, canEdit, window.readChapterIds || []); // Передаем ID прочитанных глав

    container.innerHTML = `
        <div class="page-header">
            ${breadcrumbs || '<div></div>'}  ${actionsHtml}
        </div>
        
        <!-- ОСНОВНОЙ КОНТЕЙНЕР С ОБТЕКАНИЕМ -->
        <div class="novel-content-wrapper">
            <!-- ОБЛОЖКА С FLOAT И КНОПКОЙ -->
            <div class="novel-cover-float">
                ${novel.cover_url ? 
                   `<img src="${escapeHtml(novel.cover_url)}" alt="${escapeHtml(novel.title)}" 
                        onerror="handleCoverError(this)" 
                        onload="handleCoverLoad(this)">` : 
                    '<div class="no-cover">📚</div>'
                }
                ${startReadingButton}
            </div>
            
            <!-- САЙДБАР ИНФОРМАЦИИ ДЛЯ ДЕСКТОПА -->
            <aside class="novel-info-desktop">
                <h3>Основная информация</h3>
                ${infoTableHtml}
                
                ${novel.rating ? `
                    <div class="rating-container">
                        <div class="rating-display">
                            <span class="rating-label">Рейтинг:</span>
                            <div class="rating-stars">
                                ${renderStars(novel.rating)}
                            </div>
                            <span class="rating-value">${novel.rating}/5</span>
                        </div>
                    </div>
                ` : ''}
            </aside>
            
            <!-- ОПИСАНИЕ, КОТОРОЕ ОБТЕКАЕТ -->
            <div class="novel-description-float">
                <div class="description-tabs">
                    <button class="tab-btn active" onclick="switchDescriptionTab('description')">📖 Описание</button>
                    <button class="tab-btn" onclick="switchDescriptionTab('info')" id="info-tab-button">ℹ️ Информация</button>
                </div>
                
                <div id="float-description" class="tab-content active">
                    ${formatDescription(novel.description || 'Описание пока не добавлено.')}
                </div>
                
                <div id="float-info" class="tab-content">
                    ${infoTableHtml}
                </div>
            </div>
            
            <!-- ОЧИСТКА ОБТЕКАНИЯ -->
            <div style="clear: both;"></div>
        </div>

        <!-- ТЕГИ -->
        <div class="novel-taxonomy">
            <div class="tags-list">
                <strong>Теги:</strong>
                ${tagsHtml || '<span class="text-muted">Не указаны</span>'}
            </div>
        </div>
        
        <!-- ЗАГОЛОВОК И АВТОР С ЦЕНТРИРОВАНИЕМ -->
        <hr class="section-divider">
        <div class="novel-header-center" data-debug="header-container">
            <h1 class="novel-main-title" id="novel-title" data-debug="main-title">${escapeHtml(novel.title)}</h1>
            <div class="author-container" onclick="navigateTo('author', {name: '${escapeHtml(novel.author)}'})">
                <span class="author-label">Автор:</span>
                <span class="author-name"><a href="/?page=author&name=${encodeURIComponent(novel.author)}" onclick="handleLinkClick(event)">${escapeHtml(novel.author)}</a></span>
            </div>
            ${novel.alt_titles ? `
                <div class="alt-titles-popup" id="alt-titles-popup" data-debug="alt-titles-popup" style="display: none;">
                    <div class="popup-content">
                        <strong>Альтернативные названия:</strong>
                        <div class="alt-titles-list">${escapeHtml(novel.alt_titles)}</div>
                    </div>
                </div>
            ` : ''}
        </div>
        <hr class="section-divider">

        <!-- ГЛАВЫ -->
        <section class="chapters-section-v2">
            
            ${canEdit ? `
            <div class="chapters-header-v2">
                <div class="chapter-count">Всего глав: ${chapters.length}</div>
                <div class="chapters-controls-v2">
                    <button class="btn btn-secondary btn-sm" id="chapter-sort-btn-v2" onclick="toggleChapterOrderV2()">
                        ${chapterSortOrder === 'asc' ? 'Сортировка: ↑ Старые' : 'Сортировка: ↓ Новые'}
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="navigateTo('add-chapter', {novelId: '${novel.novel_id}'})">
                        + Добавить
                    </button>
                    
                    <button class="btn btn-secondary btn-sm" id="toggle-chapter-edit-btn" onclick="toggleChapterEditMode(this)">
                        ✏️ Редактировать
                    </button>
                    <button class="btn btn-secondary btn-sm" id="cancel-chapter-edit-btn" style="display: none;" onclick="toggleChapterEditMode(null, true)">
                        ❌ Отмена
                    </button>
                    </div>
            </div>
            ` : ''}

            <div class="chapters-list-container-v2">
                <div class="chapters-list-header">
                    <div class="ch-num">№</div>
                    <div class="ch-title">Название</div>
                    <div class="ch-words">Слов</div>
                    <div class="ch-updated">Обновлено</div>
                    ${STATE.currentUser?.role === 'owner' ? '<div class="ch-actions">Действия</div>' : ''}
                </div>
                <div id="chapters-list-v2">
                    ${chapters.length > 0 ? chaptersHtml : '<p class="text-muted no-chapters">Пока нет глав</p>'}
                </div>
            </div>
        </section>
        `;

    // --- НОВЫЙ БЛОК: Создание и настройка плавающей кнопки ---
    const shelfButtonContainer = document.createElement('div');
    shelfButtonContainer.className = 'floating-shelf-button';
    document.body.appendChild(shelfButtonContainer); // Добавляем контейнер в body

    // Проверяем, есть ли новелла хотя бы на одной полке
    const currentUserShelves = novel.userShelves || [];
    const isOnAnyShelf = currentUserShelves.length > 0;

    const shelfTypes = { /* ... (скопируй объект shelfTypes отсюда) ... */
        want_to_read: 'Хочу прочитать',
        reading: 'Читаю сейчас',
        completed: 'Прочитано',
        favorite: 'В любимое',
        dropped: 'Брошено'
    };

    let shelfLinksHtml = '';
    Object.entries(shelfTypes).forEach(([type, title]) => {
        const isActive = currentUserShelves.includes(type);
        shelfLinksHtml += `
            <a href="#" class="${isActive ? 'active-shelf' : ''}"
               onclick="handleAddToReadingList(${novel.novel_id}, '${type}')">
                <span>${title}</span>
            </a>`;
    });

    const removeLinkHtml = `
        <hr style="${isOnAnyShelf ? '' : 'display: none;'}">
        <a href="#" class="remove-link ${isOnAnyShelf ? '' : 'hidden'}"
           onclick="handleRemoveFromReadingList(${novel.novel_id})">
            <span>🗑️ Убрать с полок</span>
        </a>`;

    // Генерируем HTML кнопки и меню
    shelfButtonContainer.innerHTML = `
        <button class="btn-float" title="Добавить на полку">
            +
        </button>
        <div class="dropdown-menu">
            ${shelfLinksHtml}
            ${removeLinkHtml}
        </div>
    `;

    // Находим созданные элементы
    const mainButton = shelfButtonContainer.querySelector('.btn-float');
    const dropdownMenu = shelfButtonContainer.querySelector('.dropdown-menu');

    // ФУНКЦИЯ ДЛЯ ЗАКРЫТИЯ МЕНЮ
    const closeShelfMenu = () => {
        shelfButtonContainer.classList.remove('menu-visible');
        document.removeEventListener('click', handleClickOutsideShelfMenu); // Удаляем слушатель клика вне
        console.log("Меню полки закрыто, слушатель click outside удален");
    };

    // ФУНКЦИЯ ДЛЯ ОБРАБОТКИ КЛИКА ВНЕ МЕНЮ
    const handleClickOutsideShelfMenu = (event) => {
        // Закрываем, если клик был НЕ по контейнеру кнопки
        if (!shelfButtonContainer.contains(event.target)) {
            closeShelfMenu();
        }
    };

    // ОБРАБОТЧИК КЛИКА ПО ОСНОВНОЙ КНОПКЕ (+)
    mainButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Предотвращаем всплытие клика до document
        const isVisible = shelfButtonContainer.classList.toggle('menu-visible');
        console.log("Клик по кнопке полки, меню видимо:", isVisible);

        if (isVisible) {
            // Если меню открылось, добавляем слушатель клика вне (с небольшой задержкой)
            setTimeout(() => {
                document.addEventListener('click', handleClickOutsideShelfMenu);
                console.log("Добавлен слушатель click outside для меню полки");
            }, 0);
        } else {
            // Если меню закрылось по клику на кнопку, сразу удаляем слушатель
            document.removeEventListener('click', handleClickOutsideShelfMenu);
            console.log("Меню полки закрыто кнопкой, слушатель click outside удален");
        }
    });

    // Обработчик клика ПО ПУНКТУ МЕНЮ (чтобы закрыть меню после выбора)
    dropdownMenu.addEventListener('click', (event) => {
        // Проверяем, был ли клик по ссылке <a> внутри меню
        if (event.target.closest('a')) {
             // Небольшая задержка перед закрытием, чтобы успел сработать onclick ссылки
            setTimeout(closeShelfMenu, 50);
        }
    });
    // --- КОНЕЦ НОВОГО БЛОКА ---

    // ИНИЦИАЛИЗАЦИЯ ДОПОЛНИТЕЛЬНЫХ ФУНКЦИЙ
    initializeNovelPageFeatures(novel, chapters);
    window.currentNovelChapters = chapters;
    window.currentNovelHasVolumes = novel.has_volumes;

    initTooltips();

    // Сохраняем данные для сортировки
    window.currentNovelChaptersV2 = chapters;
    window.currentNovelHasVolumesV2 = novel.has_volumes;
    window.currentNovelCanEditV2 = canEdit;
    
    // АВТОМАТИЧЕСКОЕ ПЕРЕКЛЮЧЕНИЕ НА ОПИСАНИЕ ПРИ ПОЯВЛЕНИИ САЙДБАРА
    setupAutoTabSwitching();

    // --- ✨ ДОБАВЬ ЭТОТ ВЫЗОВ ЗДЕСЬ ✨ ---
    setTimeout(() => {
        // Проверяем пользователя ВНУТРИ setTimeout
        if (STATE.currentUser && STATE.currentUser.user_id != null) {
            console.log(`Запуск loadAndDisplayReadingProgress для novelId: ${novel.novel_id}`); // Добавим лог
            loadAndDisplayReadingProgress(novel.novel_id);
        } else {
            console.log("Пользователь не авторизован, прогресс не загружается."); // Добавим лог
        }
    }, 100); // Увеличили задержку до 100 мс
    // --- ✨ КОНЕЦ ДОБАВЛЕНИЯ ✨ ---
}

// ФУНКЦИЯ ДЛЯ НАЧАЛА ЧТЕНИЯ (v3 - всегда с самой первой главы)
function startReading() {
    // Проверяем, есть ли вообще главы для этой новеллы
    if (window.currentNovelChapters && window.currentNovelChapters.length > 0) {

        // ✨ ИЗМЕНЕНИЕ: Находим главу с минимальным номером
        // Сначала копируем массив, чтобы не менять исходный
        const chaptersCopy = [...window.currentNovelChapters];

        // Сортируем копию ТОЛЬКО по возрастанию номера (и тома)
        chaptersCopy.sort((a, b) => {
            // Сначала по номеру тома (если есть)
            const volCompare = (a.volume_order || 0) - (b.volume_order || 0);
            if (volCompare !== 0) return volCompare;
            // Затем по номеру главы
            return (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0);
        });

        // Берем самую первую главу из отсортированного списка
        const firstChapter = chaptersCopy[0];

        // Переходим на страницу чтения этой главы
        navigateTo('chapter-read', {
            id: firstChapter.chapter_id
        });

    } else {
        // Если глав нет, показываем сообщение
        showAlertModal('Нет глав', 'Пока нет доступных глав для чтения', 'info');
    }
}

// ФУНКЦИЯ АВТОМАТИЧЕСКОГО ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК
function setupAutoTabSwitching() {
    function checkScreenSize() {
        const infoTabButton = document.getElementById('info-tab-button');
        const isDesktop = window.innerWidth >= 1024;
        
        if (isDesktop && infoTabButton) {
            const infoTab = document.getElementById('float-info');
            if (infoTab && infoTab.classList.contains('active')) {
                switchDescriptionTab('description');
            }
            infoTabButton.style.display = 'none';
        } else if (infoTabButton) {
            infoTabButton.style.display = 'flex';
        }
    }
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
}

// ПРОСТАЯ ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ
function initializeNovelPageFeatures(novel, chapters) {
    const titleElement = document.getElementById('novel-title');

    if (titleElement && novel.alt_titles) {
        titleElement.style.cursor = 'pointer';

        // Убираем создание altTitlesHtml здесь
        // const altTitlesHtml = novel.alt_titles.split('|') ...

        titleElement.addEventListener('click', (e) => {
            e.stopPropagation();
            // ✨ Передаем сырую строку novel.alt_titles ✨
            showAltTitlesPopup(novel.alt_titles); // Убрали e.target
        });
    }
}

/**
 * ✨ NEW: Показывает попап с альтернативными названиями снизу экрана
 * @param {string} altTitlesString - Строка с названиями, разделенными '|'
 */
function showAltTitlesPopup(altTitlesString) {
    // Удаляем существующий попап если есть
    const existingPopup = document.getElementById('custom-alt-titles-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Разбиваем строку на массив названий и убираем пустые
    const titlesArray = altTitlesString.split('|').map(t => t.trim()).filter(Boolean);

    // Генерируем HTML: каждый заголовок в <p>, между ними <hr>
    let titlesHtml = '';
    titlesArray.forEach((title, index) => {
        titlesHtml += `<p>${escapeHtml(title)}</p>`;
        // Добавляем разделитель <hr> после каждого, кроме последнего
        if (index < titlesArray.length - 1) {
            titlesHtml += '<hr>';
        }
    });

    // Если названий нет, показываем сообщение
    if (!titlesHtml) {
        titlesHtml = '<p class="text-muted">Альтернативных названий нет.</p>';
    }

    // Создаем попап
    const popup = document.createElement('div');
    popup.id = 'custom-alt-titles-popup';
    // ✨ Добавляем класс для стилизации и анимации ✨
    popup.className = 'custom-alt-titles-popup bottom-sheet';
    popup.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">
                <h3>Альтернативные названия</h3>
                <button class="popup-close" onclick="closeAltTitlesPopup()">×</button>
            </div>
            <div class="popup-body">
                ${titlesHtml}
            </div>
        </div>
    `;

    document.body.appendChild(popup);
    // Блокируем прокрутку фона
    document.body.style.overflow = 'hidden';

    // --- ✨ ИСПРАВЛЕННЫЙ БЛОК ЗАКРЫТИЯ ---
    const content = popup.querySelector('.popup-content');

    // Закрытие при клике на ФОН (а не на контент)
    popup.addEventListener('click', (event) => {
        // Если клик был НЕ по .popup-content и НЕ по его дочерним элементам
        if (!content.contains(event.target)) {
            closeAltTitlesPopup();
        }
    });

    // Закрытие при нажатии Escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') closeAltTitlesPopup();
    };
    document.addEventListener('keydown', escapeHandler);

    // Сохраняем обработчик Escape для удаления при закрытии
    popup._escapeHandler = escapeHandler;
    // --- ✨ КОНЕЦ ИСПРАВЛЕНИЙ ---

    // Показываем попап с анимацией
    setTimeout(() => popup.classList.add('show'), 10);
}

// ФУНКЦИЯ ЗАКРЫТИЯ ПОПАПА
function closeAltTitlesPopup() {
    const popup = document.getElementById('custom-alt-titles-popup');
    if (popup) {
        if (popup._escapeHandler) {
            document.removeEventListener('keydown', popup._escapeHandler);
        }
        // Убираем класс для анимации скрытия
        popup.classList.remove('show');
        // Возвращаем прокрутку фона
        document.body.style.overflow = '';
        // Удаляем элемент после завершения анимации
        setTimeout(() => {
            popup.remove();
        }, 300); // Должно совпадать с длительностью анимации в CSS
    }
}

// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
/**
 * Проверяет, находится ли новелла в списке чтения
 */
function isInReadingList(novelId) {
    // Эта функция должна быть уже реализована, но если нет:
    return STATE.currentUser?.reading_list?.includes(novelId) || false;
}

function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let stars = '';
    
    for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
            stars += '<span class="star">★</span>';
        } else if (i === fullStars && hasHalfStar) {
            stars += '<span class="star">★</span>';
        } else {
            stars += '<span class="star empty">☆</span>';
        }
    }
    return stars;
}

function getAccessLabel(accessType) {
    const labels = {
        public: '🌐 Публичный',
        private: '🔒 Приватный', 
        link_only: '🔗 По ссылке'
    };
    return labels[accessType] || accessType;
}

function formatDate(dateString) {
    if (!dateString) return 'Неизвестно';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

function switchDescriptionTab(tabName) {
    document.querySelectorAll('.description-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.tab-btn[onclick*="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.novel-description-float .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`float-${tabName}`).classList.add('active');
}

function formatDescription(text) {
    if (!text) return '<p>Нет описания</p>';
    return text.split('\n').filter(p => p.trim() !== '').map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

/**
 * Создает плавающую кнопку добавления на полку и её выпадающее меню.
 * @param {object} novel - Объект новеллы, включая поле novel.userShelves (массив строк).
 * УДАЛИТЬ/ 
function createFloatingShelfButton(novel) {
    const existingButton = document.querySelector('.floating-shelf-button');
    if (existingButton) {
        existingButton.remove();
    }

    // Проверяем, есть ли новелла хотя бы на одной полке
    const currentUserShelves = novel.userShelves || []; // Массив полок ['reading', 'favorite'] или []
    const isOnAnyShelf = currentUserShelves.length > 0;

    // Определяем типы полок и их названия
    const shelfTypes = {
        want_to_read: 'Хочу прочитать',
        reading: 'Читаю сейчас',
        completed: 'Прочитано',
        favorite: 'В любимое',
        dropped: 'Брошено'
    };

    // Генерируем HTML для пунктов меню (полок)
    let shelfLinksHtml = '';
    Object.entries(shelfTypes).forEach(([type, title]) => {
        const isActive = currentUserShelves.includes(type); // Проверяем, активна ли эта полка
        // Добавляем класс active-shelf, если полка активна
        shelfLinksHtml += `
            <a href="#" class="${isActive ? 'active-shelf' : ''}"
               onclick="handleAddToReadingList(${novel.novel_id}, '${type}')">
                <span>${title}</span>
            </a>`;
    });

    // Генерируем HTML для кнопки "Убрать с полок" (скрываем, если isOnAnyShelf = false)
    const removeLinkHtml = `
        <hr style="${isOnAnyShelf ? '' : 'display: none;'}">
        <a href="#" class="remove-link ${isOnAnyShelf ? '' : 'hidden'}"
           onclick="handleRemoveFromReadingList(${novel.novel_id})">
            <span>🗑️ Убрать с полок</span>
        </a>`;

    // Собираем весь HTML кнопки и меню
    const buttonHtml = `
        <div class="floating-shelf-button">
            <button class="btn-float" title="Добавить на полку">
                +
            </button>
            <div class="dropdown-menu">
                ${shelfLinksHtml}
                ${removeLinkHtml}
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', buttonHtml);
}

function removeFloatingShelfButton() {
    // ✨ ИСПРАВЛЕНО: Ищем по классу .floating-shelf-button, а не по id
    const floatingButton = document.querySelector('.floating-shelf-button');
    
    if (floatingButton) {
        floatingButton.remove();
    } 
}

/**
 * ✨ NEW: Переключает режим редактирования глав
 */
function toggleChapterEditMode(button, forceCancel = false) {
    if (forceCancel) {
        STATE.isChapterEditMode = false;
    } else {
        STATE.isChapterEditMode = !STATE.isChapterEditMode;
    }

    const mainBtn = document.getElementById('toggle-chapter-edit-btn');
    const cancelBtn = document.getElementById('cancel-chapter-edit-btn');
    const listContainer = document.getElementById('chapters-list-v2');

    if (STATE.isChapterEditMode) {
        if (mainBtn) mainBtn.textContent = '✅ Готово';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        if (listContainer) listContainer.classList.add('edit-mode');
    } else {
        if (mainBtn) mainBtn.textContent = '✏️ Редактировать';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (listContainer) listContainer.classList.remove('edit-mode');
    }

    // Перерисовываем список глав, чтобы показать/скрыть кнопки
    rerenderChapterListFromState();
}

/**
 * ✨ NEW: Вспомогательная функция для перерисовки списка глав
 */
function rerenderChapterListFromState() {
    const container = document.getElementById('chapters-list-v2');
    if (container && window.currentNovelChaptersV2) {
        container.innerHTML = renderChaptersListV2(
            window.currentNovelChaptersV2,
            window.currentNovelHasVolumesV2,
            window.currentNovelCanEditV2,
            window.readChapterIds || []
        );
        // Повторно инициализируем тултипы
        initializeTooltips();
    }
}

function handleCoverError(img) {
    console.warn('Ошибка загрузки обложки:', img.src);
    img.style.display = 'none';
    
    // Показываем fallback
    const fallback = img.nextElementSibling;
    if (fallback && fallback.classList.contains('no-cover')) {
        fallback.style.display = 'flex';
    }
    
    // Пробуем альтернативную ссылку если это Google Drive
    if (img.src.includes('googleusercontent.com')) {
        const fileId = img.src.split('/d/')[1];
        if (fileId) {
            // Пробуем другую форму ссылки
            const alternativeUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=s1000`;
            setTimeout(() => {
                img.src = alternativeUrl;
                img.style.display = 'block';
                if (fallback) fallback.style.display = 'none';
            }, 1000);
        }
    }
}

function handleCoverLoad(img) {
    console.log('Обложка успешно загружена:', img.src);
    const fallback = img.nextElementSibling;
    if (fallback && fallback.classList.contains('no-cover')) {
        fallback.style.display = 'none';
    }
}

// ==========================================
// АДАПТИВНЫЙ ДИЗАЙН ДЛЯ ДЕТАЛЕЙ НОВЕЛЛЫ
// ==========================================

/**
 * Настройка адаптивного сайдбара для мобильных устройств
 */
function setupResponsiveSidebar() {
    if (window.innerWidth > 768) return; // Только для мобильных
    
    const infoGrid = document.querySelector('.novel-info-grid');
    if (!infoGrid) return;
    
    // Превращаем в табы
    const cover = infoGrid.querySelector('.novel-cover-large');
    const info = infoGrid.querySelector('.novel-details-info');
    
    if (!cover || !info) return;
    
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'mobile-novel-tabs';
    tabsContainer.innerHTML = `
        <div class="tab-buttons">
            <button class="tab-btn active" data-tab="description">Описание</button>
            <button class="tab-btn" data-tab="info">Информация</button>
        </div>
        <div class="tab-content tab-content-description active">
            ${cover.innerHTML}
            ${info.querySelector('.novel-description')?.outerHTML || ''}
        </div>
        <div class="tab-content tab-content-info">
            ${info.innerHTML.replace(info.querySelector('.novel-description')?.outerHTML || '', '')}
        </div>
    `;
    
    infoGrid.replaceWith(tabsContainer);
    
    // Обработчики переключения табов
    tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            
            tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            tabsContainer.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            tabsContainer.querySelector(`.tab-content-${tab}`).classList.add('active');
        });
    });
}

/**
 * ✨ FINAL VERSION: Рендерит список глав V2 с правильной сортировкой томов и глав внутри них
 */
function renderChaptersListV2(chapters, hasVolumes, canEdit, readChapterIds = []) {
    if (!chapters || chapters.length === 0) {
        return '<p class="text-muted no-chapters">Пока нет глав</p>';
    }

    // 1. Сортируем ВСЕ главы ОДИН РАЗ правильно
    const sortedChapters = [...chapters].sort((a, b) => {
        const orderMultiplier = chapterSortOrder === 'asc' ? 1 : -1;
        const numA = parseFloat(a.chapter_number) || 0;
        const numB = parseFloat(b.chapter_number) || 0;
        const numCompare = numA - numB;
        if (numCompare !== 0) return orderMultiplier * numCompare;
        const volA = a.volume_order || 0;
        const volB = b.volume_order || 0;
        const volCompare = volA - volB;
        if (volCompare !== 0) return orderMultiplier * volCompare;
        const nameA = a.volume_name || '';
        const nameB = b.volume_name || '';
        return orderMultiplier * nameA.localeCompare(nameB);
    });

    // 2. Если томов нет, просто рендерим отсортированный список
    if (!hasVolumes) {
        return sortedChapters.map(ch => renderChapterItemV2(ch, canEdit, readChapterIds.includes(ch.chapter_id))).join('');
    }

    // 3. Группируем главы по томам (для получения названий и ключей)
    const volumes = {};
    sortedChapters.forEach(ch => {
        const volName = ch.volume_name || 'Основной том'; // Используем "Основной том"
        // Ключ для группировки и сортировки томов
        const volKey = `${String(ch.volume_order || 9999).padStart(5, '0')}-${volName}`;
        if (!volumes[volKey]) {
            volumes[volKey] = { name: volName }; // Нам нужно только имя для заголовка
        }
        // Сами главы хранить здесь больше не нужно
    });

    console.log('Группировка томов:', volumes);

    // 4. Сортируем КЛЮЧИ томов с учетом "Основного тома" и chapterSortOrder
    const sortedVolumeKeys = Object.keys(volumes).sort((keyA, keyB) => {
        const orderMultiplier = chapterSortOrder === 'asc' ? 1 : -1;
        
        // ✨ ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ:
        // Проверяем ключ по имени, а не по номеру "09999"
        const isA_Main = keyA.endsWith('-Основной том');
        const isB_Main = keyB.endsWith('-Основной том');

        // Логика для "Основного тома"
        if (isA_Main && !isB_Main) {
            // A = "Основной", B = "Номерной"
            // Цель (asc): Основной ПЕРВЫЙ. A должен быть ДО B. -> return -1
            // Цель (desc): Основной ПОСЛЕДНИЙ. A должен быть ПОСЛЕ B. -> return 1
            return chapterSortOrder === 'asc' ? -1 : 1; 
        }
        if (!isA_Main && isB_Main) {
            // A = "Номерной", B = "Основной"
            // Цель (asc): Основной (B) ПЕРВЫЙ. A должен быть ПОСЛЕ B. -> return 1
            // Цель (desc): Основной (B) ПОСЛЕДНИЙ. A должен быть ДО B. -> return -1
            return chapterSortOrder === 'asc' ? 1 : -1; 
        }

        // Логика для обычных томов (или если оба основные / оба не основные)
        // Сортируем по полному ключу (который содержит номер тома)
        return keyA.localeCompare(keyB) * orderMultiplier;
    });


    // 5. Рендерим секции томов в ПРАВИЛЬНОМ ПОРЯДКЕ
    return sortedVolumeKeys.map(volKey => {
        const volume = volumes[volKey]; // Получаем имя тома

        // ФИЛЬТРУЕМ УЖЕ ОТСОРТИРОВАННЫЙ список глав sortedChapters для текущего тома
        const chaptersForVolume = sortedChapters.filter(ch => {
            const currentVolName = ch.volume_name || 'Основной том';
            const currentVolOrder = ch.volume_order || 9999;
            const currentVolKey = `${String(currentVolOrder).padStart(5, '0')}-${currentVolName}`;
            return currentVolKey === volKey;
        });

        // Если для этого тома нет глав (не должно случиться, но на всякий случай)
        if (chaptersForVolume.length === 0) return '';

        // Рендерим секцию тома с УЖЕ отсортированными главами
        return `
            <div class="volume-section-v2">
                <div class="volume-header-v2" onclick="toggleVolumeV2(this)">
                    ${escapeHtml(volume.name)}
                    <span class="volume-chapter-count">(${chaptersForVolume.length} глав)</span>
                    <span class="volume-toggle-icon">▼</span>
                </div>
                <div class="volume-chapters-v2">
                    ${chaptersForVolume.map(ch => renderChapterItemV2(ch, canEdit, readChapterIds.includes(ch.chapter_id))).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * НОВАЯ ВЕРСИЯ: Рендерит одну строку (главу) для списка V2
 */
function renderChapterItemV2(chapter, canEdit, isRead) {
    const isOwner = STATE.currentUser?.role === 'owner';
    const readClass = isRead ? 'read' : 'unread'; // Класс для подсветки

    // Форматируем даты для отображения и для tooltip
    const updatedDateStr = formatDateOnly(chapter.updated_at || chapter.created_at);
    const createdDateStr = formatDateTooltip(chapter.created_at);
    const tooltipText = `Добавлено: ${createdDateStr}`;

    // --- ✨ НОВАЯ ЛОГИКА ДЛЯ КНОПОК ---
    let actionsHtml = '';
    if (canEdit && STATE.isChapterEditMode) {
        // РЕЖИМ РЕДАКТИРОВАНИЯ: Показываем кнопки "Edit" и "Delete"
        actionsHtml = `
            <button class="btn btn-sm btn-icon" title="Редактировать" onclick="event.stopPropagation(); navigateTo('edit-chapter', {id: '${chapter.chapter_id}'})">
                ✏️
            </button>
            <button class="btn btn-sm btn-icon btn-danger" title="Удалить" onclick="event.stopPropagation(); handleDeleteChapter('${chapter.chapter_id}', '${escapeHtml(chapter.chapter_title)}')">
                🗑️
            </button>
        `;
    } else if (isOwner) {
        // ОБЫЧНЫЙ РЕЖИМ: Показываем "Docs" для владельца
        actionsHtml = `
            <a href="https://docs.google.com/document/d/${chapter.file_id}/edit" 
               target="_blank" 
               class="btn btn-sm btn-ghost" 
               title="Открыть в Google Docs"
               onclick="event.stopPropagation()">
                📄 Docs
            </a>
        `;
    }
    // -----------------------------

    return `
        <div class="chapter-item-v2 ${readClass}">
            <div class="ch-num">${chapter.chapter_number}</div>
            <div class="ch-title">
                <a href="/?page=chapter-read&id=${chapter.chapter_id}" onclick="handleLinkClick(event)">
                    ${escapeHtml(chapter.chapter_title)}
                </a>
            </div>
            <div class="ch-words">${formatNumber(chapter.word_count || 0)}</div>
            <div class="ch-updated" data-tooltip="${tooltipText}">${updatedDateStr}</div>
            
            ${actionsHtml ? `<div class="ch-actions">${actionsHtml}</div>` : ''}
        </div>
    `;
}

/**
 * НОВАЯ ВЕРСИЯ: Переключает порядок сортировки глав V2
 */
function toggleChapterOrderV2() {
    chapterSortOrder = chapterSortOrder === 'asc' ? 'desc' : 'asc';

    // Обновляем текст кнопки сортировки
    const sortBtn = document.getElementById('chapter-sort-btn-v2');
    if (sortBtn) {
        sortBtn.textContent = chapterSortOrder === 'asc' ? 'Сортировка: ↑ Старые' : 'Сортировка: ↓ Новые';
    }

    // Перерисовываем список глав
    const container = document.getElementById('chapters-list-v2');
    if (container && window.currentNovelChaptersV2) {
        container.innerHTML = renderChaptersListV2(
            window.currentNovelChaptersV2,
            window.currentNovelHasVolumesV2,
            window.currentNovelCanEditV2,
            window.readChapterIds || [] // Передаем прочитанные ID
        );
        // Повторно инициализируем тултипы, так как элементы перерисованы
        initializeTooltips(); 
    }
}

/**
 * НОВАЯ ВЕРСИЯ: Сворачивает/разворачивает том V2
 */
function toggleVolumeV2(headerElement) {
    const volumeSection = headerElement.closest('.volume-section-v2');
    if (volumeSection) {
        volumeSection.classList.toggle('collapsed');
    }
}


// --- Вспомогательные функции для форматирования дат ---
function formatDateShort(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        // Формат: ДД.ММ.ГГГГ ЧЧ:ММ
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }) + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function formatDateTooltip(dateString) {
     if (!dateString) return 'Неизвестно';
    try {
        const date = new Date(dateString);
        // Формат: ДД Месяца ГГГГ, ЧЧ:ММ:СС
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }) + ', ' + date.toLocaleTimeString('ru-RU');
    } catch (e) {
        return dateString;
    }
}

/**
 * Форматирует дату в формат ДД.ММ.ГГГГ
 */
function formatDateOnly(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (e) {
        return dateString; // Возвращаем как есть при ошибке
    }
}

function initializeTooltips() {
    // Удаляем старый tooltip, если он есть
    if (tooltipElement) {
        tooltipElement.remove();
        tooltipElement = null;
    }

    // Создаем элемент tooltip один раз
    tooltipElement = document.createElement('div');
    tooltipElement.id = 'dynamic-tooltip';
    tooltipElement.className = 'tooltip-v2';
    document.body.appendChild(tooltipElement);

    const elementsWithTooltip = document.querySelectorAll('[data-tooltip]');

    elementsWithTooltip.forEach(elem => {
        elem.addEventListener('mouseenter', showTooltip);
        elem.addEventListener('mouseleave', hideTooltip);
        elem.addEventListener('mousemove', moveTooltip);
    });
}

function showTooltip(event) {
    const text = event.target.getAttribute('data-tooltip');
    if (!tooltipElement || !text) return;
    tooltipElement.textContent = text;
    tooltipElement.style.display = 'block';
    moveTooltip(event); // Позиционируем сразу
}

function hideTooltip() {
    if (!tooltipElement) return;
    tooltipElement.style.display = 'none';
}

/**
 * ✨ UPDATED: Позиционирует tooltip с учетом границ экрана
 */
function moveTooltip(event) {
    if (!tooltipElement || tooltipElement.style.display === 'none') return;

    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;
    const cursorPadding = 15; // Отступ от курсора

    let left = event.pageX + cursorPadding;
    let top = event.pageY + cursorPadding;

    // Проверка выхода за правый край
    if (left + tooltipWidth > window.innerWidth) {
        left = event.pageX - tooltipWidth - cursorPadding; // Смещаем влево от курсора
    }

    // Проверка выхода за нижний край
    if (top + tooltipHeight > window.innerHeight) {
        top = event.pageY - tooltipHeight - cursorPadding; // Смещаем вверх от курсора
    }

    // Минимальные значения, чтобы не уходило за левый/верхний край
    left = Math.max(5, left); // Минимум 5px от левого края
    top = Math.max(5, top);   // Минимум 5px от верхнего края

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
}

// ==========================================
// ЧТЕНИЕ ГЛАВЫ
// ==========================================

// Заменяем существующую renderChapterReadPage
async function renderChapterReadPage(chapterId) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    showLoading(true, { animationType: 'bubbles' });
    
    container.innerHTML = `<div class="page-content chapter-read-page"></div>`;
    
    try {
        // ВАЖНО: Я предполагаю, что твой ответ от 'getChapter'
        // теперь также включает:
        // response.chapter.allChapters (массив всех глав новеллы)
        // response.chapter.prevChapterId (ID или null)
        // response.chapter.nextChapterId (ID или null)
        const response = await apiRequest('getChapter', { id: chapterId });
        
        if (response.success && response.chapter) {
            const chapter = response.chapter;
            window.currentChapterData = chapter;

            // --- ✨ НАЧАЛО: Автоматическая отметка прочитанным ✨ ---
            if (STATE.currentUser) { // Проверяем, что пользователь вошел
                // Проверяем, не была ли глава уже отмечена (чтобы не слать лишний запрос)
                if (!window.readChapterIds || !window.readChapterIds.includes(chapterId)) {
                    console.log(`Автоматически отмечаем главу ${chapterId} как прочитанную...`);
                    // Вызываем существующую функцию БЕЗ await, чтобы не блокировать рендеринг
                    handleMarkAsRead(chapterId, chapter.novel_id, true)
                        .then(() => {
                            updateMarkReadUnreadButtons(chapterId);
                            if (window.readChapterIds && !window.readChapterIds.includes(chapterId)) {
                               window.readChapterIds.push(chapterId);
                            }
                        })
                        .catch(error => {
                            // Лог ошибки теперь тоже внутри handleMarkAsRead
                            // console.warn(`Не удалось автоматически отметить главу ${chapterId}:`, error);
                        });
                } else {
                    console.log(`Глава ${chapterId} уже была отмечена как прочитанная.`);
                }
            }
            // --- ✨ КОНЕЦ: Автоматическая отметка прочитанным ✨ ---
            
            // Сохраняем данные для оверлея быстрой навигации
            window.currentChapterList = chapter.allChapters || [];
            window.currentNovelIdForNav = chapter.novel_id;
            
            // Генерируем хлебные крошки
            const breadcrumbs = getBreadcrumbs('chapter-read', {
                novelId: chapter.novel_id,
                novelTitle: chapter.novel_title,
                chapterTitle: `Глава ${chapter.chapter_number}`
            });

            // Рендерим всё
            renderChapterContentV2(chapter, breadcrumbs); 

            const overlay = document.getElementById('chapter-load-overlay');
            if (overlay) overlay.style.display = 'none';
            
            // Запускаем JS для скролла хедера
            setupReaderHeaderScroll();
        } else {
            throw new Error('Глава не найдена');
        }
    } catch (error) {
        container.innerHTML = `
            <div class="error-page">
                <h3>❌ Ошибка загрузки главы</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="goBackInHistory()">← Вернуться</button>
            </div>
        `;
    } finally {
        showLoading(false);
        const overlay = document.getElementById('chapter-load-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

// Заменяем существующую renderChapterContentV2
function renderChapterContentV2(chapter, breadcrumbsHtml) { 
    const container = document.querySelector('.chapter-read-page');
    if (!container) return;
    
    // --- 1. HTML для нового хедера ---
    const readerHeaderHtml = `
        <header class="reader-header" id="reader-header">
            <div class="reader-header-left">
                <a href="/?page=novel-details&id=${chapter.novel_id}" onclick="handleLinkClick(event)" class="btn-reader-back" title="К новелле">
                    <span>←</span>
                </a>
            </div>
            <div class="reader-header-center">
                <button class="btn-reader-title" onclick="toggleChapterQuickNav()">
                    <span>
                        Гл. ${chapter.chapter_number}: ${escapeHtml(chapter.chapter_title)}
                    </span>
                    <span class="title-caret">▼</span>
                </button>
            </div>
            <div class="reader-header-right">
                <button class="btn btn-ghost btn-sm" onclick="toggleReadingSettings()" title="Настройки чтения">
                    ⚙️
                </button>
            </div>
        </header>
    `;

    // --- 2. HTML для нижней навигации ---
    const bottomNavHtml = `
        <div class="reader-bottom-nav">
            ${chapter.prevChapterId ? 
                `<a href="/?page=chapter-read&id=${chapter.prevChapterId}" onclick="handleLinkClick(event)" class="btn btn-nav-prev">
                    ← <span class="nav-text">Предыдущая</span>
                 </a>` : 
                '<span></span>' /* Пустая ячейка для выравнивания */
            }
            
            <a href="/?page=novel-details&id=${chapter.novel_id}" onclick="handleLinkClick(event)" class="btn btn-nav-toc">
                Оглавление
            </a>
            
            ${chapter.nextChapterId ? 
                `<a href="/?page=chapter-read&id=${chapter.nextChapterId}" onclick="handleLinkClick(event)" class="btn btn-nav-next">
                    <span class="nav-text">Следующая</span> →
                 </a>` : 
                '<span></span>' /* Пустая ячейка для выравнивания */
            }
        </div>
    `;

    // --- 3. HTML для контента (с крошками) ---
    const contentHtml = `
        <article class="chapter-content-wrapper">
            
            ${breadcrumbsHtml} 
            
            <div class="chapter-text" id="chapter-text">
                ${chapter.content ? formatChapterText(chapter.content) : `
                    <div class="no-content">
                        <p>Текст главы пока не загружен</p>
                    </div>
                `}
            </div>
            
            ${bottomNavHtml}
            
        </article>
    `;
    
    // Сначала вставляем хедер, потом контент
    container.innerHTML = readerHeaderHtml + contentHtml;
    
    // Применяем настройки (если они есть)
    const settings = getReadingSettings();
    setTimeout(() => applyReadingSettings(settings), 100);
}

/**
 * Показывает или скрывает оверлей быстрой навигации по главам
 */
function toggleChapterQuickNav() {
    let overlay = document.getElementById('quick-nav-overlay');
    
    // Если оверлей еще не создан, создаем его
    if (!overlay) {
        overlay = renderChapterQuickNav();
    }
    
    // Показываем или скрываем
    const isVisible = overlay.classList.toggle('show');
    document.body.style.overflow = isVisible ? 'hidden' : '';
    
    // Если показали, фокусируемся на поиске
    if (isVisible) {
        const searchInput = document.getElementById('quick-nav-search');
        if (searchInput) {
            searchInput.focus();
        }
    }
}

/**
 * Создает HTML для оверлея быстрой навигации (вызывается 1 раз)
 */
function renderChapterQuickNav() {
    const chapters = window.currentChapterList || [];
    const novelId = window.currentNovelIdForNav || null;

    const sortedChaptersForNav = [...chapters].sort((a, b) => {
        // Преобразуем номера глав в числа (parseFloat для поддержки дробных)
        const numA = parseFloat(a.chapter_number) || 0;
        const numB = parseFloat(b.chapter_number) || 0;

        return numA - numB;

    });

    const overlay = document.createElement('div');
    overlay.id = 'quick-nav-overlay';
    
    const listHtml = sortedChaptersForNav.length > 0
        ? sortedChaptersForNav.map(ch => `
            <a href="/?page=chapter-read&id=${ch.chapter_id}"
               class="quick-nav-item"
               onclick="handleLinkClick(event); toggleChapterQuickNav()">
                <span class="quick-nav-number">Гл. ${ch.chapter_number}</span>
                <span class="quick-nav-title">${escapeHtml(ch.chapter_title)}</span>
            </a>
          `).join('')
        : '<p class="text-muted">Список глав не загружен</p>';

    overlay.innerHTML = `
        <div class="quick-nav-header">
            <input type="text" id="quick-nav-search" class="form-input" 
                   placeholder="Поиск по номеру или названию..."
                   oninput="filterQuickNav(this.value)">
            <button class="quick-nav-close" onclick="toggleChapterQuickNav()">×</button>
        </div>
        <div class="quick-nav-list">
            ${listHtml}
        </div>
        ${novelId ? `
            <div class="quick-nav-footer">
                <a href="/?page=novel-details&id=${novelId}" 
                   class="btn btn-secondary"
                   onclick="handleLinkClick(event); toggleChapterQuickNav()">
                    Перейти к оглавлению
                </a>
            </div>
        ` : ''}
    `;
    
    document.body.appendChild(overlay);
    return overlay;
}

/**
 * Фильтрует список в оверлее быстрой навигации
 */
function filterQuickNav(query) {
    const list = document.querySelector('.quick-nav-list');
    if (!list) return;
    
    const items = list.getElementsByTagName('a');
    const normalizedQuery = query.toLowerCase().trim();
    
    for (let item of items) {
        const text = item.textContent.toLowerCase();
        if (text.includes(normalizedQuery)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    }
}

/**
 * Настраивает авто-скрытие хедера (С ЛОГАМИ, V10 - Правильное чтение scrollTop)
 */
function setupReaderHeaderScroll() {
    const header = document.getElementById('reader-header');
    if (!header) {
        console.error("Хедер чтения ('reader-header') не найден!");
        return;
    }
    console.log("setupReaderHeaderScroll: Хедер найден, высота:", header.offsetHeight);

    // Инициализируем lastScrollTop ПРАВИЛЬНЫМ текущим значением
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const delta = 250;
    const headerHeight = header.offsetHeight;

    // Цель - window
    const scrollTarget = window;
    const scrollTargetName = 'window';

    // Обработчик скролла
    currentScrollHandler = (event) => {
        // ✨ ИСПРАВЛЕНИЕ: Используем стандартный способ получения scrollTop ✨
        let st = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

        // Игнорируем маленький скролл у верха
        if (st > 5 && Math.abs(lastScrollTop - st) <= delta) {
             return;
         }

        // --- Логика показа/скрытия (без изменений) ---
        if (st > lastScrollTop && st > headerHeight){
          header.classList.add('is-hidden');
        } else {
          // Показываем, если скроллим вверх ИЛИ почти у самого верха
          if (st < lastScrollTop || st <= 5) {
              // Проверяем, существует ли класс перед удалением
              if (header.classList.contains('is-hidden')) {
                  header.classList.remove('is-hidden');
              }
          }
        }
        // --------------------------------------------------------

        lastScrollTop = st <= 0 ? 0 : st;
    };

    // Отложенное добавление с фазой перехвата (оставляем)
    setTimeout(() => {
        if (currentScrollHandler) {
             scrollTarget.addEventListener('scroll', currentScrollHandler, {
                 capture: true,
                 passive: true
             });
            console.log(`setupReaderHeaderScroll: Scroll listener ADDED (delayed & capturing) to '${scrollTargetName}'.`);
        } else {
            console.log(`setupReaderHeaderScroll: Listener was cleared before delayed attachment.`);
        }
    }, 100);

    // --- Обработчик mousemove (без изменений) ---
    let mouseMoveTimeout;
    const mouseMoveHandler = (e) => {
        clearTimeout(mouseMoveTimeout);
        mouseMoveTimeout = setTimeout(() => {
            if (e.clientY < 80) {
                 // Проверяем, существует ли класс перед удалением
                 if (header.classList.contains('is-hidden')) {
                     console.log("MouseMove near top: Forcing header visible");
                     header.classList.remove('is-hidden');
                 }
            }
        }, 100);
    };
    document.addEventListener('mousemove', mouseMoveHandler);
    console.log("setupReaderHeaderScroll: MouseMove listener added.");

    // Сохраняем цель (window) и обработчик mousemove
    currentScrollHandler._scrollTarget = scrollTarget;
    currentScrollHandler._mouseMoveHandler = mouseMoveHandler;

     // Код удаления в renderPage НЕ меняем!
}

// ==========================================
// ФОРМА НОВЕЛЛЫ (ВИРТУАЛЬНАЯ СТРАНИЦА)
// ==========================================

async function renderNovelFormPage(novelId = null) {
    const container = document.getElementById('page-content-container');
    if (!container) return;
    
    const isEdit = !!novelId;
    let novelData = null;
    
    if (isEdit) {
        showLoading(true, { title: 'Загрузка данных для редактирования...' });
        try {
            // ✨ ИСПРАВЛЕНИЕ: Используем правильное имя API-действия 'getNovel'
            const response = await apiRequest('getNovel', { id: novelId }, true);
            if (response.success && response.novel) {
                novelData = response.novel;
            } else {
                throw new Error(response.error || 'Не удалось загрузить данные новеллы.');
            }
        } catch (error) {
            showToast(error.message, 'error');
            showLoading(false);
            goBackInHistory(); // Возвращаемся назад при ошибке
            return;
        }
        showLoading(false);
    }
    
    if (STATE.genresAndTags.genres.length === 0) {
        await loadGenresAndTags();
    }

    const pageType = isEdit ? 'edit-novel' : 'add-novel';
    // ✨ ИСПРАВЛЕНИЕ: Передаем ID и название в хлебные крошки
    const breadcrumbs = getBreadcrumbs(pageType, { 
        id: novelId, 
        title: novelData ? novelData.title : 'Новелла' 
    });
    
    container.innerHTML = `
        <div class="page-content">
            ${breadcrumbs}
            <div class="novel-form-page">
                <h1>${isEdit ? '✏️ Редактирование новеллы' : '➕ Добавить новеллу'}</h1>
                
                <form id="novel-form" class="novel-form">
                    <input type="hidden" name="novel_id" value="${novelId || ''}">
                    
                    <fieldset class="form-section">
                        <legend>Основная информация</legend>
                        
                        <div class="form-group">
                            <label for="novel-title">Название *</label>
                            <input type="text" id="novel-title" name="title" class="form-input" required
                                   value="${novelData ? escapeHtml(novelData.title) : ''}" placeholder="Введите название новеллы">
                        </div>

                        <div class="form-group">
                            <label for="alt-title-input">Альтернативные названия</label>
                            <div class="input-group">
                                <input type="text" id="alt-title-input" class="form-input"
                                        placeholder="Введите название и нажмите '+'">
                                <button type="button" class="btn btn-secondary" onclick="addAltTitleTag()" style="border-radius: 0 var(--radius-md) var(--radius-md) 0;">+</button>
                            </div>
                            <div id="alt-titles-container" class="tags-container" style="margin-top: 0.75rem;"></div>
                            <input type="hidden" id="novel-alt-titles" name="alt_titles" value="${novelData ? escapeHtml(novelData.alt_titles || '') : ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="novel-author">Автор *</label>
                            <input type="text" id="novel-author" name="author" class="form-input" required
                                   value="${novelData ? escapeHtml(novelData.author) : ''}" placeholder="Имя автора">
                        </div>
                        
                        <div class="form-group">
                            <label for="novel-description">Описание</label>
                            <textarea id="novel-description" name="description" class="form-textarea" rows="8"
                                      placeholder="Краткое описание сюжета...">${novelData ? escapeHtml(novelData.description || '') : ''}</textarea>
                            <small class="form-help">Рекомендуемая длина - до 3000 символов</small>
                        </div>
                    </fieldset>
                    
                    <fieldset class="form-section">
                        <legend>Классификация и статистика</legend>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="original-language">Язык оригинала</label>
                                <select id="original-language" name="language" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.LANGUAGES ? STATE.config.LANGUAGES.map(lang => 
                                        `<option value="${lang}" ${novelData && novelData.language === lang ? 'selected' : ''}>${lang}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="novel-year">Год</label>
                                <input type="number" id="novel-year" name="year" class="form-input"
                                       value="${novelData ? escapeHtml(novelData.year || '') : ''}" placeholder="2025">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="original-chapter-count">Глав в оригинале</label>
                                <input type="number" id="original-chapter-count" name="original_chapter_count" class="form-input"
                                       placeholder="0" value="${novelData ? escapeHtml(novelData.original_chapter_count || '') : ''}" min="0">
                            </div>
                            <div class="form-group">
                                <label for="original-word-count">Слова в оригинале</label>
                                <input type="number" id="original-word-count" name="original_word_count" class="form-input"
                                       placeholder="0" value="${novelData ? escapeHtml(novelData.original_word_count || '') : ''}" min="0">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="original-status">Статус оригинала</label>
                                <select id="original-status" name="original_status" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.STATUS_OPTIONS ? STATE.config.STATUS_OPTIONS.map(status => 
                                        `<option value="${status}" ${novelData && novelData.original_status === status ? 'selected' : ''}>${status}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                             <div class="form-group">
                                <label for="translation-status">Статус перевода</label>
                                <select id="translation-status" name="translation_status" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.STATUS_OPTIONS ? STATE.config.STATUS_OPTIONS.map(status => 
                                        `<option value="${status}" ${novelData && novelData.translation_status === status ? 'selected' : ''}>${status}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                        </div>

                         <div class="form-row">
                            <div class="form-group">
                                <label for="era">Эра</label>
                                <select id="era" name="era" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.ERAS ? STATE.config.ERAS.map(era => 
                                        `<option value="${era}" ${novelData && novelData.era === era ? 'selected' : ''}>${era}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="perspective">Перспектива</label>
                                <select id="perspective" name="perspective" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.PERSPECTIVES ? STATE.config.PERSPECTIVES.map(p => 
                                        `<option value="${p}" ${novelData && novelData.perspective === p ? 'selected' : ''}>${p}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                             <div class="form-group">
                                <label for="orientation">Тип отношений</label>
                                <select id="orientation" name="orientation" class="form-select">
                                    <option value="">Выберите...</option>
                                    ${STATE.config.ORIENTATIONS ? STATE.config.ORIENTATIONS.map(o => 
                                        `<option value="${o}" ${novelData && novelData.orientation === o ? 'selected' : ''}>${o}</option>`
                                    ).join('') : ''}
                                </select>
                            </div>
                        </div>
                    </fieldset>
                    
                    <fieldset class="form-section">
                        <legend>Теги и метки</legend>
                        
                        <div class="form-group">
                            <label>Теги</label>
                            <input type="text" id="tags-input" class="form-input" 
                                   placeholder="Начните вводить тег..."
                                   list="tags-datalist"
                                   autocomplete="off">
                            <datalist id="tags-datalist">
                                ${STATE.genresAndTags.tags.map(t => 
                                    `<option value="${escapeHtml(t.name)}">`
                                ).join('')}
                            </datalist>
                            <div id="tags-container" class="tags-container">
                                ${novelData && novelData.tags ? novelData.tags.map(t => 
                                    `<span class="selected-tag" data-value="${escapeHtml(t.name)}">
                                        ${escapeHtml(t.name)} 
                                        <button type="button" onclick="removeTag(this)">×</button>
                                    </span>`
                                ).join('') : ''}
                            </div>
                            <small class="form-help">Нажмите Enter для добавления</small>
                        </div>
                    </fieldset>

                    <fieldset class="form-section">
                        <legend>Обложка и ссылки</legend>
                        <div class="form-group">
                            <label>Обложка</label>
                            <div class="cover-input">
                                <label class="form-radio">
                                    <input type="radio" name="cover-type" value="url" checked>
                                    URL изображения
                                </label>
                                <label class="form-radio">
                                    <input type="radio" name="cover-type" value="file">
                                    Загрузить файл
                                </label>
                            </div>
                            <input type="url" id="cover-url" name="cover_url"
                                   class="form-input" 
                                   placeholder="https://example.com/cover.jpg"
                                   value="${novelData && novelData.cover_url ? escapeHtml(novelData.cover_url) : ''}">
                            <input type="file" id="cover-file" accept="image/*" 
                                   class="form-input hidden">
                            <small class="form-help">💡 Поддерживаемые форматы: JPG, PNG, GIF, WebP (макс 10 МБ)</small>
                            
                            <!-- ПРЕДПРОСМОТР -->
                            <div id="cover-preview-container" class="cover-preview hidden">
                                <div class="preview-header">
                                    <span id="cover-preview-filename">Предпросмотр</span>
                                    <button type="button" id="remove-preview" class="btn-icon" title="Удалить">❌</button>
                                </div>
                                <img id="cover-preview-image" alt="Предпросмотр обложки">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="novel-links">Дополнительные ссылки</label>
                            <textarea id="novel-links" name="additional_links" 
                                      class="form-textarea" rows="2"
                                      placeholder="Ссылки на каналы, сайты и т.д.">${novelData && novelData.additional_links ? escapeHtml(novelData.additional_links) : ''}</textarea>
                        </div>
                    </fieldset>

                    <fieldset class="form-section">
                        <legend>Настройки доступа</legend>
                        <div class="form-group">
                            <label for="access-type">Тип доступа</label>
                            <select id="access-type" name="access_type" class="form-select">
                                <option value="public" ${!novelData || novelData.access_type === 'public' ? 'selected' : ''}>
                                    Публичный (все видят)
                                </option>
                                <option value="link_only" ${novelData && novelData.access_type === 'link_only' ? 'selected' : ''}>
                                    По ссылке
                                </option>
                                <option value="private" ${novelData && novelData.access_type === 'private' ? 'selected' : ''}>
                                    Приватный (только я)
                                </option>
                            </select>
                            <small class="form-help">Публичные новеллы отображаются в каталоге</small>
                        </div>
                        <div class="form-group">
                            <label class="form-checkbox">
                                <input type="checkbox" id="is-personal-novel" name="is_personal"
                                    ${novelData && novelData.is_personal ? 'checked' : ''}>
                                Создать как личную новеллу
                            </label>
                            <small class="form-help">
                                Новелла будет создана в вашей личной папке Google Drive и будет видна только вам.
                            </small>
                        </div>
                    </fieldset>
                    
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary btn-lg">
                            ${isEdit ? '💾 Сохранить изменения' : '➕ Создать новеллу'}
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="goBackInHistory()">
                            ❌ Отмена
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    setupNovelForm();
    setupCoverPreview();
    setupAuthorAutocomplete();
    setupAltTitlesInput();
}

function setupNovelForm() {
    const form = document.getElementById('novel-form');
    if (form) {
        form.addEventListener('submit', handleNovelSubmit);
    }

    form.addEventListener('keydown', (e) => {
        // Если нажат Enter и активный элемент - не textarea
        if (e.key === 'Enter') {
            // И активный элемент НЕ textarea И НЕ поле ввода альт. названий
            if (e.target.tagName !== 'TEXTAREA' && e.target.id !== 'alt-title-input') {
                e.preventDefault(); // Отменяем отправку формы
            }
        }
    });
    
    // Настройка тегов/жанров с автодополнением
    setupTagsInput('tags-input', 'tags-container', STATE.genresAndTags.tags);
    
    // Переключение типа обложки
    const coverTypeRadios = document.querySelectorAll('input[name="cover-type"]');
    const coverUrl = document.getElementById('cover-url');
    const coverFile = document.getElementById('cover-file');
    
    if (coverFile) {
        coverFile.addEventListener('change', function() {
            if (this.files.length > 0) {
                showToast(`Выбран файл: ${this.files[0].name}`, 'info');
            }
        });
    } // ← ВОТ ЭТА СКОБКА БЫЛА ПРОПУЩЕНА!
    
    coverTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'url') {
                coverUrl.classList.remove('hidden');
                coverFile.classList.add('hidden');
            } else {
                coverUrl.classList.add('hidden');
                coverFile.classList.remove('hidden');
            }
        });
    });
}

// ==========================================
// РАБОТА С ФАЙЛАМИ И ИЗОБРАЖЕНИЯМИ
// ==========================================

/**
 * Конвертация файла в Base64 с автоматическим сжатием
 * @param {File} file - Файл изображения
 * @param {number} maxWidth - Максимальная ширина (по умолчанию 800px)
 * @param {number} quality - Качество сжатия 0-1 (по умолчанию 0.8)
 */
function fileToBase64(file, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('Файл должен быть изображением'));
            return;
        }
        
        // Проверка размера (макс 10MB)
        if (file.size > 10 * 1024 * 1024) {
            reject(new Error('Файл слишком большой (макс 10MB)'));
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                // Сжимаем изображение
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Масштабируем если больше maxWidth
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Конвертируем в Base64 с сжатием
                const base64 = canvas.toDataURL('image/jpeg', quality);
                
                // Вычисляем размер после сжатия
                const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
                console.log(`📸 Изображение сжато: ${Math.round(file.size / 1024)}KB → ${sizeKB}KB`);
                
                resolve(base64);
            };
            
            img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Ошибка чтения файла'));
        reader.readAsDataURL(file);
    });
}

/**
 * Настройка предпросмотра обложки
 */
function setupCoverPreview() {
    const coverUrlInput = document.getElementById('cover-url');
    const coverFileInput = document.getElementById('cover-file');
    const coverTypeRadios = document.querySelectorAll('input[name="cover-type"]');
    const removePreviewBtn = document.getElementById('remove-preview');

    // Флаг для отслеживания активной загрузки
    let currentPreviewAttempt = 0;

    // Переключение типа обложки
    coverTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'url') {
                coverUrlInput.classList.remove('hidden');
                coverFileInput.classList.add('hidden');
            } else {
                coverUrlInput.classList.add('hidden');
                coverFileInput.classList.remove('hidden');
            }
            hideCoverPreview();
            currentPreviewAttempt++; // Отменяем предыдущие попытки
        });
    });

    // Предпросмотр URL
    if (coverUrlInput) {
        coverUrlInput.addEventListener('input', debounce((e) => {
            const url = e.target.value.trim();
            
            // Проверяем, что URL валидный и полный
            if (!url) {
                hideCoverPreview();
                return;
            }
            
            // Базовая проверка валидности URL
            if (!isValidImageUrl(url)) {
                hideCoverPreview();
                return;
            }
            
            // Увеличиваем счетчик попыток
            currentPreviewAttempt++;
            const thisAttempt = currentPreviewAttempt;
            
            showCoverPreview(url, 'url', '', thisAttempt, currentPreviewAttempt);
        }, 800)); // Увеличим задержку до 800мс
    }

    // Предпросмотр файла
    if (coverFileInput) {
        coverFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    showToast('Пожалуйста, выберите изображение', 'error');
                    hideCoverPreview();
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('Файл слишком большой (макс 10MB)', 'error');
                    hideCoverPreview();
                    e.target.value = '';
                    return;
                }

                try {
                    const base64 = await fileToBase64(file);
                    currentPreviewAttempt++;
                    showCoverPreview(base64, 'file', file.name, currentPreviewAttempt, currentPreviewAttempt);
                    showToast(`Выбран файл: ${file.name}`, 'info');
                } catch (error) {
                    showToast('Ошибка загрузки изображения', 'error');
                    hideCoverPreview();
                }
            } else {
                hideCoverPreview();
            }
        });
    }

    // Удаление предпросмотра
    if (removePreviewBtn) {
        removePreviewBtn.addEventListener('click', () => {
            hideCoverPreview();
            if (coverUrlInput) coverUrlInput.value = '';
            if (coverFileInput) coverFileInput.value = '';
            currentPreviewAttempt++; // Отменяем текущую попытку
        });
    }
}

/**
 * Проверка, является ли URL валидным для изображения
 */
function isValidImageUrl(url) {
    try {
        const urlObj = new URL(url);
        // Проверяем протокол
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return false;
        }
        // Опционально: проверка расширения файла
        const pathname = urlObj.pathname.toLowerCase();
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const hasImageExtension = imageExtensions.some(ext => pathname.endsWith(ext));
        
        // Разрешаем URL без расширения (могут быть динамические изображения)
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Показать предпросмотр обложки с проверкой актуальности
 */
function showCoverPreview(src, type, filename = '', attemptId, currentAttemptId) {
    const previewContainer = document.getElementById('cover-preview-container');
    const previewImage = document.getElementById('cover-preview-image');
    const previewFilename = document.getElementById('cover-preview-filename');

    if (!previewContainer || !previewImage) return;

    // Очищаем старые обработчики
    previewImage.onerror = null;
    previewImage.onload = null;

    previewImage.onerror = () => {
        // Проверяем, что эта попытка еще актуальна
        if (attemptId !== currentAttemptId) {
            return; // Игнорируем устаревшие попытки
        }
        
        // Показываем ошибку только для URL (не для файлов)
        if (type === 'url') {
            hideCoverPreview();
            // Показываем тост только если пользователь уже закончил вводить
            // (не показываем для промежуточных состояний)
            showToast('Не удалось загрузить изображение по URL', 'warning', 3000);
        }
    };

    previewImage.onload = () => {
        // Проверяем, что эта попытка еще актуальна
        if (attemptId !== currentAttemptId) {
            return; // Игнорируем устаревшие попытки
        }
        
        previewContainer.classList.remove('hidden');
        if (previewFilename) {
            previewFilename.textContent = filename || (type === 'url' ? 'Обложка по URL' : 'Обложка');
        }
    };

    previewImage.src = src;
}

function hideCoverPreview() {
    const previewContainer = document.getElementById('cover-preview-container');
    const previewImage = document.getElementById('cover-preview-image');
    
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewImage) {
        previewImage.onerror = null;
        previewImage.onload = null;
        previewImage.src = '';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function handleNovelSubmit(e) {
    e.preventDefault();

    if (STATE.isSubmittingNovel) {
        showToast('Подождите, идёт отправка...', 'warning');
        return;
    }

    STATE.isSubmittingNovel = true;
    showLoading(true, { title: 'Сохранение новеллы', description: 'Обработка данных...', progress: true });

    const form = e.target;
    const novelData = {};
    const formData = new FormData(form);
    formData.forEach((value, key) => { novelData[key] = value; });

    novelData.is_personal = form.querySelector('#is-personal-novel')?.checked || false;
    novelData.tags = Array.from(document.getElementById('tags-container').querySelectorAll('.selected-tag')).map(tag => tag.dataset.value);

    const coverType = document.querySelector('input[name="cover-type"]:checked')?.value;
    const coverFile = document.getElementById('cover-file');

    // Обработка загрузки файла обложки
    if (coverType === 'file' && coverFile?.files.length > 0) {
        try {
            updateProgress(20, 'Сжатие изображения...');
            novelData.cover_base64 = await fileToBase64(coverFile.files[0], 800, 0.85);
            novelData.cover_url = ''; // Важно: очищаем URL, если загружаем файл
        } catch (error) {
            showToast('Ошибка загрузки обложки: ' + error.message, 'error');
            STATE.isSubmittingNovel = false;
            showLoading(false);
            return;
        }
    }

    try {
        updateProgress(60, 'Отправка на сервер...');
        const action = novelData.novel_id ? 'updateNovel' : 'createNovel';
        
        // Отправляем данные
        const response = await apiPostRequest(action, novelData);

        // ==========================================================
        // ✨ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ ЛОГИКИ ✨
        // ==========================================================

        // 1. ПРОВЕРЯЕМ ОТВЕТ СЕРВЕРА НА ЛЮБУЮ ОШИБКУ
        // Сервер сам проверит дубликаты и другие проблемы. Если success: false,
        // мы просто показываем ошибку и останавливаемся.
        if (!response.success) {
            throw new Error(response.error || 'Неизвестная ошибка сервера');
        }

        // 2. ЕСЛИ ВСЁ УСПЕШНО (даже если сервер ещё обрабатывает в фоне)
        // Мы показываем сообщение и ПРИНУДИТЕЛЬНО ПЕРЕЗАГРУЖАЕМ СТРАНИЦУ.
        // Это заставит браузер запросить с сервера самый свежий список новелл,
        // в котором уже точно будет правильная ссылка на обложку.
        
        updateProgress(100, 'Готово!');
        showToast('Новелла успешно сохранена! Обновление...', 'success');
        clearCache(); // Очищаем локальный кэш перед перезагрузкой
        
        // Переходим на главную страницу через 1.5 секунды
        setTimeout(() => {
            window.location.href = window.location.origin + window.location.pathname;
        }, 1500);

    } catch (error) {
        // Этот блок теперь ловит абсолютно все ошибки: и сжатия, и ответа сервера.
        console.error('Ошибка сохранения:', error);
        showToast('❌ Ошибка: ' + error.message, 'error');
        STATE.isSubmittingNovel = false; // Снимаем блокировку кнопки
        showLoading(false); // Прячем оверлей загрузки
    }
    // `finally` блок больше не нужен, т.к. мы уходим на перезагрузку.
}

// ==========================================
// ФОРМА ГЛАВЫ (ВИРТУАЛЬНАЯ СТРАНИЦА)
// ==========================================

async function renderChapterFormPage(novelId = null, chapterId = null) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    const isEdit = !!chapterId;
    
    // ✅ КРИТИЧНО: Объявляем переменные ВНЕ блока try
    let chapterData = null;
    let novelData = null;
    let nextChapterNumber = '';
    let lastVolumeName = '';
    let existingVolumes = [];
    let uniqueVolumes = [];
    let datalistOptions = '';

    showLoading(true, { title: 'Загрузка данных...' });

    try {
        // Если это редактирование, сначала получаем данные главы
        if (isEdit) {
            const chapterResponse = await apiRequest('getChapter', { id: chapterId }, true);
            if (chapterResponse.success && chapterResponse.chapter) {
                chapterData = chapterResponse.chapter;
                novelId = chapterData.novel_id;
            } else {
                throw new Error(chapterResponse.error || 'Не удалось найти главу.');
            }
        }

        // Получаем данные новеллы
        if (novelId) {
            const novelResponse = await apiRequest('getNovel', { id: novelId }, true);
            if (novelResponse.success && novelResponse.novel) {
                novelData = novelResponse.novel;
            } else {
                throw new Error(novelResponse.error || 'Новелла не найдена.');
            }
        } else {
            throw new Error('Не указан ID новеллы для создания главы.');
        }

        // ✨ Автозаполнение номера главы
        if (!isEdit) {
            console.log('🔍 Запрашиваем следующий номер для новеллы:', novelId);
            const nextNumResponse = await apiRequest('getNextChapterNumber', { novel_id: novelId });
            console.log('📥 Ответ от сервера:', nextNumResponse);
            
            if (nextNumResponse.success) {
                nextChapterNumber = nextNumResponse.next_number;
                console.log('✅ Следующий номер главы:', nextChapterNumber);
            } else {
                console.warn('⚠️ Не удалось получить следующий номер:', nextNumResponse.error);
            }
        }
        
        // ✨ Автозаполнение тома
        if (!isEdit && novelData.chapters && novelData.chapters.length > 0) {
            console.log('📚 Ищем последний том. Всего глав:', novelData.chapters.length);
            
            // Сортируем главы по номеру и берём последнюю
            const sortedChapters = [...novelData.chapters].sort((a, b) => b.chapter_number - a.chapter_number);
            const lastChapter = sortedChapters[0];
            
            console.log('📖 Последняя глава:', lastChapter);
            
            if (lastChapter.volume_name) {
                lastVolumeName = lastChapter.volume_name;
                console.log('✅ Последний том:', lastVolumeName);
            } else {
                console.log('ℹ️ У последней главы нет тома');
            }
        } else {
            console.log('ℹ️ Нет глав для автозаполнения тома (isEdit:', isEdit, ', глав:', novelData?.chapters?.length || 0, ')');
        }
        
        // Собираем уникальные названия томов для datalist
        existingVolumes = novelData.chapters.map(ch => ch.volume_name).filter(Boolean);
        uniqueVolumes = [...new Set(existingVolumes)];
        datalistOptions = uniqueVolumes.map(vol => `<option value="${escapeHtml(vol)}"></option>`).join('');
       
    } catch (error) {
        showToast('Ошибка загрузки: ' + error.message, 'error');
        showLoading(false);
        goBackInHistory();
        return;
    }
    
    showLoading(false);

    const breadcrumbs = getBreadcrumbs(isEdit ? 'edit-chapter' : 'add-chapter', {
        novelId: novelData.novel_id,
        novelTitle: novelData.title
    });
    
    container.innerHTML = `
        <div class="page-content chapter-form-page">
            ${breadcrumbs}
            <h1>${isEdit ? '✏️ Редактирование главы' : '➕ Добавить главу'}</h1>
            <p class="text-muted">Новелла: ${escapeHtml(novelData.title)}</p>
            
            <form id="chapter-form" class="chapter-form">
                <input type="hidden" id="chapter-novel-id" name="novel_id" value="${novelId}">
                ${chapterId ? `<input type="hidden" name="chapter_id" value="${chapterId}">` : ''}
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="volume-name">Название тома (если есть)</label>
                        <input type="text" id="volume-name" name="volume_name" 
                               class="form-input"
                               value="${chapterData && chapterData.volume_name ? escapeHtml(chapterData.volume_name) : escapeHtml(lastVolumeName)}"
                               placeholder="${lastVolumeName ? 'Текущий том: ' + escapeHtml(lastVolumeName) : 'Начните вводить или создайте новый том'}"
                               list="volume-datalist">
                        <datalist id="volume-datalist">
                            ${datalistOptions}
                        </datalist>
                    </div>
                    
                    <div class="form-group">
                        <label for="chapter-number">Номер главы *</label>
                        <input type="number" id="chapter-number" name="chapter_number" 
                               class="form-input" required step="any" min="0"
                               value="${chapterData ? chapterData.chapter_number : nextChapterNumber}"
                               placeholder="1">
                        <small class="form-help" id="chapter-number-hint">Можно использовать дробные номера (1.5, 2.1)</small>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="chapter-title">Название главы *</label>
                    <input type="text" id="chapter-title" name="chapter_title" 
                           class="form-input" required
                           value="${chapterData ? escapeHtml(chapterData.chapter_title) : ''}"
                           placeholder="Введите название главы">
                </div>
                
                <div class="form-group">
                    <label for="chapter-content">Содержание главы (опционально)</label>
                    <textarea id="chapter-content" name="content" 
                              class="form-textarea" rows="15"
                              placeholder="Текст главы... Будет создан документ в Google Docs.">${chapterData && chapterData.content ? escapeHtml(chapterData.content) : ''}</textarea>
                </div>
                
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary btn-lg">
                        ${isEdit ? '💾 Сохранить' : '➕ Создать главу'}
                    </button>
                    <button type="button" class="btn btn-secondary" 
                            onclick="navigateTo('novel-details', {id: '${novelId}'})">
                        ❌ Отмена
                    </button>
                </div>
            </form>
        </div>
    `;
    
    setupChapterForm(novelId, chapterId);
}

function setupChapterForm(novelId, chapterId) {
    const form = document.getElementById('chapter-form');
    if (form) {
        form.addEventListener('submit', handleChapterSubmit);
    }
    
    // Проверка номера главы на дубликаты
    const numberInput = document.getElementById('chapter-number');
    const hint = document.getElementById('chapter-number-hint'); // Получаем элемент подсказки один раз

    let checkAttempt = 0; // Счетчик попыток проверки

    if (numberInput && hint) {
        numberInput.addEventListener('input', function() {
            clearTimeout(chapterNumberCheckTimeout);
            const number = this.value.trim();

            // ✅ Очищаем подсказку, если поле пустое
            if (!number) {
                hint.textContent = 'Можно использовать дробные номера (1.5, 2.1)';
                hint.style.color = ''; // Возвращаем стандартный цвет
                numberInput.style.borderColor = ''; // Возвращаем стандартную рамку
                lastCheckedNumber = null; // Сбрасываем последнее проверенное
                checkAttempt++;
                return;
            }

            const currentAttempt = ++checkAttempt; // Увеличиваем счетчик для этой попытки
            
            // Уменьшаем задержку до 500мс
            chapterNumberCheckTimeout = setTimeout(async () => {
                if (currentAttempt !== checkAttempt) {
                    console.log('Проверка номера отменена (устарела)');
                    return;
                }

                // ✅ Проверяем снова на всякий случай, если пользователь быстро стёр
                const currentNumber = numberInput.value.trim();
                if (!currentNumber) {
                     hint.textContent = 'Можно использовать дробные номера (1.5, 2.1)';
                     hint.style.color = '';
                     numberInput.style.borderColor = '';
                     lastCheckedNumber = null;
                     return;
                }
                if (currentNumber === lastCheckedNumber) return; // Не проверяем то же самое число повторно

                lastCheckedNumber = currentNumber; // Запоминаем число, которое проверяем
                hint.textContent = 'Проверка...';
                hint.style.color = '';
                numberInput.style.borderColor = '';

                try { // ✅ Добавляем try...catch
                  const exists = await checkChapterNumberExists(novelId, currentNumber, chapterId);

                  // Снова проверяем актуальность попытки ПОСЛЕ await
                  if (currentAttempt !== checkAttempt) {
                     console.log('Результат проверки номера отменен (устарел)');
                     return;
                  }
                  
                  // Проверяем, не изменилось ли значение, пока ждали ответа
                  if (numberInput.value.trim() !== currentNumber) return;

                  if (exists) {
                      hint.textContent = '⚠️ Глава с таким номером уже существует!';
                      hint.style.color = '#d32f2f'; // Красный
                      numberInput.style.borderColor = '#d32f2f';
                  } else {
                      hint.textContent = '✓ Номер доступен';
                      hint.style.color = '#4CAF50'; // Зеленый
                      numberInput.style.borderColor = '#4CAF50';
                  }
                } catch (error) {
                    // Проверяем актуальность перед показом ошибки
                    if (currentAttempt !== checkAttempt) return;
                    if (numberInput.value.trim() !== currentNumber) return;
                    console.error("Ошибка проверки номера главы:", error);
                    hint.textContent = 'Ошибка проверки';
                    hint.style.color = '#d32f2f';
                    numberInput.style.borderColor = '#d32f2f';
                }

            }, 500); // Задержка 500 мс
        });
    }
}

async function handleChapterSubmit(e) {
    e.preventDefault();
    
    showLoading(true, {
        title: 'Сохранение главы',
        description: 'Создание документа в Google Drive...'
    });
    
    const form = e.target;
    const formData = new FormData(form);
    const chapterData = {};
    
    formData.forEach((value, key) => {
        if (value) chapterData[key] = value;
    });
    
    // Нормализуем номер главы
    chapterData.chapter_number = normalizeChapterNumber(chapterData.chapter_number);
    
    // Проверка на дубликат
    const exists = await checkChapterNumberExists(
        chapterData.novel_id, 
        chapterData.chapter_number, 
        chapterData.chapter_id
    );
    
    if (exists) {
        showToast('Глава с таким номером уже существует!', 'error');
        showLoading(false);
        return;
    }
    
    try {
        const action = chapterData.chapter_id ? 'updateChapter' : 'addChapter';
        const response = await apiPostRequest(action, chapterData);
        
        if (response.success) {
            showToast('Глава сохранена!', 'success');
            clearCache();
            
            setTimeout(() => {
                navigateTo('novel-details', { id: chapterData.novel_id });
            }, 1000);
        } else {
            throw new Error(response.error || 'Не удалось сохранить');
        }
    } catch (error) {
        console.error('Ошибка сохранения главы:', error);
        showToast('❌ Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ==========================================
// СТРАНИЦА АВТОРА
// ==========================================

// Function to render the Author Page
async function renderAuthorPage(authorName) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    showLoading(true, { animationType: 'book' });

    const authorNovels = STATE.novels.filter(n => n.author === authorName && !n.is_deleted);

    const authorData = {
        name: authorName,
        aliases: "Автор Alias 1 | 笔名 | 작가 이름" // Пример алиасов
    };

    const breadcrumbs = getBreadcrumbs('author', { name: authorName });

    // ✨ ОБНОВЛЕННЫЙ HTML ✨
    container.innerHTML = `
        <div class="page-content author-page">
            ${breadcrumbs}
            <div class="author-header">
                <button class="btn btn-ghost btn-sm author-back-btn" onclick="goBackInHistory()">
                    ← Назад
                </button>
                <h1>${escapeHtml(authorData.name)}</h1>
                ${authorData.aliases ? `
                    <div class="author-aliases">
                        <small>Также известен как:</small>
                        <span>${escapeHtml(authorData.aliases.split('|').join(' • '))}</span>
                    </div>
                ` : ''}

                <div class="author-novel-count">
                    <span class="count-value">${authorNovels.length}</span>
                    <span class="count-separator">•</span>
                    <span class="count-label">${getNounEnding(authorNovels.length, 'Новелла', 'Новеллы', 'Новелл')}</span>
                </div>
                </div>

            <div class="author-novels">
                <h2>Произведения автора</h2>
                ${authorNovels.length > 0 ? `
                    <div class="novels-grid">
                        ${authorNovels.map(novel => renderNovelCard(novel)).join('')}
                    </div>
                ` : `
                    <p class="text-muted">У этого автора пока нет добавленных произведений.</p>
                `}
            </div>
        </div>
    `;

    showLoading(false);
}

/**
 * ✨ NEW - Рендеринг публичной страницы создателя (V2 - со статистикой)
 */
async function renderCreatorPage(creatorId) {
    const container = document.getElementById('page-content-container');
    showLoading(true, { title: 'Загрузка страницы создателя...' });

    try {
        const response = await apiRequest('getUserPublicProfile', { userId: creatorId });
        if (!response.success) throw new Error(response.error);

        const { user, novels } = response;
        const visibleNovels = novels.filter(n => !n.is_deleted); // Фильтруем удаленные

        const novelsHtml = visibleNovels.length > 0
            ? visibleNovels.map(novel => renderNovelCard(novel)).join('')
            : '<p class="text-muted">У этого создателя пока нет публичных новелл.</p>';

        const breadcrumbs = getBreadcrumbs('creator', { name: user.username });

        // ✨ ОБНОВЛЕННЫЙ HTML ✨
        container.innerHTML = `
            <div class="page-content creator-page">
                ${breadcrumbs}
                <div class="profile-header creator-header">
                    <button class="btn btn-ghost btn-sm creator-back-btn" onclick="goBackInHistory()">
                        ← Назад
                    </button>
                    <div class="profile-avatar-placeholder">
                        <span>${escapeHtml(user.username[0] || '?')}</span>
                    </div>
                    <div class="profile-info">
                        <h1 class="profile-username">
                            ${escapeHtml(user.username)}
                            <span class="profile-user-id">(id: ${user.user_id})</span>
                        </h1>

                        <div class="author-novel-count">
                             <span class="count-value">${visibleNovels.length}</span>
                             <span class="count-separator">•</span>
                             <span class="count-label">${getNounEnding(visibleNovels.length, 'Новелла', 'Новеллы', 'Новелл')}</span>
                         </div>
                        </div>
                </div>

                <div class="creator-novels">
                    <h2>Произведения создателя</h2>
                     ${visibleNovels.length > 0 ? `
                        <div class="novels-grid">
                            ${novelsHtml}
                        </div>
                    ` : `
                        <p class="text-muted">У этого создателя пока нет добавленных произведений.</p>
                    `}
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `<div class="error-page"><h3>Ошибка</h3><p>${error.message}</p></div>`;
    } finally {
        showLoading(false);
    }
}

// ==========================================
// ПОИСК С АВТОДОПОЛНЕНИЕМ
// ==========================================

function setupSearchAutocomplete() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;
    
    let autocompleteList = null;
    
    searchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        
        // Удаляем старый список
        if (autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
        
        if (query.length < 2) return;
        
        // Ищем совпадения
        const matches = STATE.novels.filter(novel => 
            novel.title.toLowerCase().includes(query) ||
            novel.author.toLowerCase().includes(query)
        ).slice(0, 5);
        
        if (matches.length === 0) return;
        
        // Создаём список автодополнения
        autocompleteList = document.createElement('div');
        autocompleteList.className = 'autocomplete-list';
        autocompleteList.style.width = this.offsetWidth + 'px'; // Задаём ширину, равную ширине инпута
        
        matches.forEach(novel => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `
                <div class="autocomplete-title">${highlightMatch(novel.title, query)}</div>
                <div class="autocomplete-author">${highlightMatch(novel.author, query)}</div>
            `;
            item.addEventListener('click', () => {
                navigateTo('novel-details', { id: novel.novel_id });
                autocompleteList.remove();
            });
            autocompleteList.appendChild(item);
        });
        
        this.parentElement.appendChild(autocompleteList);
    });
    
    // Закрываем при клике вне
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    });
}

function setupAuthorAutocomplete() {
    const authorInput = document.getElementById('novel-author');
    if (!authorInput) return;

    let autocompleteList = null;
    let debounceTimer = null;

    // Основной обработчик ввода
    authorInput.addEventListener('input', function() {
        const query = this.value.trim();
        
        // Закрываем предыдущий список
        if (autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
        
        // Дебаунс
        if (debounceTimer) clearTimeout(debounceTimer);
        
        if (query.length < 2) return;

        debounceTimer = setTimeout(async () => {
            try {
                const response = await apiRequest('searchAuthors', { query });
                
                // Проверяем актуальность запроса
                if (authorInput.value.trim() !== query) return;
                if (!response.success || !response.authors || response.authors.length === 0) return;

                // Создаём список - ТОЧНО КАК В ПОИСКЕ
                autocompleteList = document.createElement('div');
                autocompleteList.className = 'autocomplete-list author-autocomplete';
                autocompleteList.style.width = authorInput.offsetWidth + 'px'; // Ширина как у инпута

                response.authors.forEach(author => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerHTML = highlightMatch(author.name, query);
                    
                    item.addEventListener('click', () => {
                        authorInput.value = author.name;
                        autocompleteList.remove();
                        autocompleteList = null;
                    });
                    
                    autocompleteList.appendChild(item);
                });

                // ✅ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ - добавляем в родительский контейнер
                authorInput.parentElement.appendChild(autocompleteList);

            } catch (error) {
                console.error('Ошибка автодополнения авторов:', error);
            }
        }, 300);
    });

    // Закрываем при клике вне - ТОЧНО КАК В ПОИСКЕ
    document.addEventListener('click', (e) => {
        if (!authorInput.contains(e.target) && autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    });

    // Дополнительно: закрытие по ESC
    authorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    });
}

function highlightMatch(text, query) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return escapeHtml(text);
    
    const before = escapeHtml(text.substring(0, index));
    const match = escapeHtml(text.substring(index, index + query.length));
    const after = escapeHtml(text.substring(index + query.length));
    
    return `${before}<strong>${match}</strong>${after}`;
}

// ==========================================
// ФИЛЬТРЫ
// ==========================================

function toggleFilters() {
    const panel = document.getElementById('filters-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}

function applyFilters() {
    const languageFilter = document.getElementById('language-filter');
    const eraFilter = document.getElementById('era-filter');
    const statusFilter = document.getElementById('status-filter');
    const perspectiveFilter = document.getElementById('perspective-filter');
    const orientationFilter = document.getElementById('orientation-filter');
    
    STATE.currentFilters.language = languageFilter ? languageFilter.value : '';
    STATE.currentFilters.era = eraFilter ? eraFilter.value : '';
    STATE.currentFilters.status = statusFilter ? statusFilter.value : '';
    STATE.currentFilters.perspective = perspectiveFilter ? perspectiveFilter.value : '';
    STATE.currentFilters.orientation = orientationFilter ? orientationFilter.value : '';

    applyFiltersAndSort();
}

function clearFilters() {
    // Сброс полей формы
    document.getElementById('language-filter').value = '';
    document.getElementById('era-filter').value = '';
    document.getElementById('perspective-filter').value = '';
    document.getElementById('orientation-filter').value = '';
    document.getElementById('original-status-filter').value = '';
    document.getElementById('translation-status-filter').value = '';
    document.getElementById('chapters-min').value = '';
    document.getElementById('chapters-max').value = '';
    document.getElementById('words-min').value = '';
    document.getElementById('words-max').value = '';

    // --- ИЗМЕНЕНО: Сброс новой карты тегов и связанных элементов ---
    // Сбрасываем классы на карте тегов
    const tagMapContainer = document.getElementById('filter-tags-map');
    if (tagMapContainer) {
        tagMapContainer.querySelectorAll('.filter-tag-item').forEach(item => {
            item.classList.remove('include-active', 'exclude-active');
        });
    }
    // Очищаем списки выбранных тегов
    updateSelectedTagsDisplay('selected-include-tags', [], 'include');
    updateSelectedTagsDisplay('selected-exclude-tags', [], 'exclude');
    // Сбрасываем радио-кнопки режимов
    document.querySelectorAll('input[name="include-tag-mode"][value="any"]').forEach(radio => radio.checked = true);
    document.querySelectorAll('input[name="exclude-tag-mode"][value="any"]').forEach(radio => radio.checked = true);
    // --- Конец изменений ---

    // Сброс состояния фильтров в STATE
    STATE.currentFilters = {
        language: '', era: '', perspective: '', orientation: '',
        originalStatus: '', translationStatus: '',
        chaptersMin: null, chaptersMax: null, wordsMin: null, wordsMax: null,
        includeTags: [], includeTagMode: 'any',
        excludeTags: [], excludeTagMode: 'any',
    };

    // Вызов общей функции
    applyFiltersAndSort();
    showToast('Фильтры сброшены', 'info');
}

/**
 * Показывает/скрывает попап сортировки
 */
function toggleSortPopup() {
    const popup = document.getElementById('sort-popup');
    const sortButton = document.getElementById('sort-btn');
    if (!popup || !sortButton) return;

    const isVisible = popup.style.display === 'block';

    if (isVisible) {
        popup.style.display = 'none';
        document.removeEventListener('click', closeSortPopupOnClickOutside, true);
    } else {
        // Позиционируем попап под кнопкой
        const rect = sortButton.getBoundingClientRect();
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = `${rect.bottom + window.scrollY + 5}px`; // 5px отступ снизу
        popup.style.display = 'block';

        // Отмечаем активную опцию
        updateActiveSortOption();

        // Добавляем слушатель для закрытия по клику вне
        setTimeout(() => { // Небольшая задержка, чтобы не сработал на текущий клик
            document.addEventListener('click', closeSortPopupOnClickOutside, true);
        }, 0);
    }
}

/**
 * Закрывает попап сортировки, если клик был вне его
 */
function closeSortPopupOnClickOutside(event) {
    const popup = document.getElementById('sort-popup');
    const sortButton = document.getElementById('sort-btn');
    // Проверяем, что клик был не по попапу и не по кнопке
    if (popup && sortButton && !popup.contains(event.target) && !sortButton.contains(event.target)) {
        popup.style.display = 'none';
        document.removeEventListener('click', closeSortPopupOnClickOutside, true);
    }
}

/**
 * Обновляет активную опцию в попапе сортировки
 */
function updateActiveSortOption() {
    const popup = document.getElementById('sort-popup');
    if (!popup) return;
    const currentSortValue = `${STATE.sortBy}_${STATE.sortOrder}`;
    popup.querySelectorAll('.sort-option').forEach(option => {
        option.classList.toggle('active', option.dataset.value === currentSortValue);
    });
}

/**
 * Обрабатывает выбор опции сортировки
 */
function handleSortOptionClick(value, text) {
    const [field, order] = value.split('_');
    STATE.sortBy = field;
    STATE.sortOrder = order;

    // Сохраняем в localStorage
    try {
        localStorage.setItem('novel-sort-preference', value);
    } catch (err) {
        console.warn("Не удалось сохранить сортировку в localStorage:", err);
    }

    // Обновляем текст кнопки
    updateSortButtonText();

    // Закрываем попап
    const popup = document.getElementById('sort-popup');
    if (popup) popup.style.display = 'none';
    document.removeEventListener('click', closeSortPopupOnClickOutside, true);

    // Применяем сортировку
    applyFiltersAndSort();
}

/**
 * Обновляет текст на кнопке сортировки
 */
function updateSortButtonText() {
    const sortButton = document.getElementById('sort-btn');
    if (!sortButton) return;
    const currentSortValue = `${STATE.sortBy}_${STATE.sortOrder}`;
    const options = { // Тексты опций для кнопки
        "updated_desc": "Обновление ↓",
        "updated_asc": "Обновление ↑",
        "added_desc": "Добавление ↓",
        "added_asc": "Добавление ↑",
        "title_asc": "Название А-Я",
        "title_desc": "Название Я-А"
    };
    sortButton.querySelector('span:last-child').textContent = options[currentSortValue] || 'Сортировка';
}

/**
 * Применяет текущие фильтры и сортировку...
 */
function applyFiltersAndSort() {
    // --- ШАГ 0: СЧИТЫВАНИЕ ЗНАЧЕНИЙ ФИЛЬТРОВ ИЗ ФОРМЫ ---
    STATE.currentFilters.language = document.getElementById('language-filter')?.value || '';
    STATE.currentFilters.era = document.getElementById('era-filter')?.value || '';
    STATE.currentFilters.perspective = document.getElementById('perspective-filter')?.value || '';
    STATE.currentFilters.orientation = document.getElementById('orientation-filter')?.value || '';
    STATE.currentFilters.originalStatus = document.getElementById('original-status-filter')?.value || '';
    STATE.currentFilters.translationStatus = document.getElementById('translation-status-filter')?.value || '';

    STATE.currentFilters.chaptersMin = parseInt(document.getElementById('chapters-min')?.value) || null;
    STATE.currentFilters.chaptersMax = parseInt(document.getElementById('chapters-max')?.value) || null;
    STATE.currentFilters.wordsMin = parseInt(document.getElementById('words-min')?.value) || null;
    STATE.currentFilters.wordsMax = parseInt(document.getElementById('words-max')?.value) || null;

    // --- ИЗМЕНЕНО: Считываем теги и режимы из нового UI ---
    // Теги уже обновлены в STATE.currentFilters функцией updateFiltersFromTagMap()
    // Считываем режимы из радио-кнопок
    STATE.currentFilters.includeTagMode = document.querySelector('input[name="include-tag-mode"]:checked')?.value || 'any';
    STATE.currentFilters.excludeTagMode = document.querySelector('input[name="exclude-tag-mode"]:checked')?.value || 'any';
    // --- Конец изменений ---

    console.log("Applying filters:", STATE.currentFilters); // Лог для отладки

    let novelsToProcess = [...STATE.novels];

    // --- ШАГ 1: ФИЛЬТРАЦИЯ ---
    novelsToProcess = novelsToProcess.filter(novel => {
        // Простые селекты
        if (STATE.currentFilters.language && novel.language !== STATE.currentFilters.language) return false;
        if (STATE.currentFilters.era && novel.era !== STATE.currentFilters.era) return false;
        if (STATE.currentFilters.perspective && novel.perspective !== STATE.currentFilters.perspective) return false;
        if (STATE.currentFilters.orientation && novel.orientation !== STATE.currentFilters.orientation) return false;
        if (STATE.currentFilters.originalStatus && novel.original_status !== STATE.currentFilters.originalStatus) return false;
        if (STATE.currentFilters.translationStatus && novel.translation_status !== STATE.currentFilters.translationStatus) return false;

        // Диапазоны глав
        const chapterCount = novel.original_chapter_count || 0;
        if (STATE.currentFilters.chaptersMin !== null && chapterCount < STATE.currentFilters.chaptersMin) return false;
        if (STATE.currentFilters.chaptersMax !== null && chapterCount > STATE.currentFilters.chaptersMax) return false;

        // Диапазоны слов (translation_word_count)
        const wordCount = novel.translation_word_count || 0;
        if (STATE.currentFilters.wordsMin !== null && wordCount < STATE.currentFilters.wordsMin) return false;
        if (STATE.currentFilters.wordsMax !== null && wordCount > STATE.currentFilters.wordsMax) return false;


        // Фильтры по тегам (сложная логика)
        const novelTags = novel.tags ? novel.tags.map(t => String(t.name || '').trim()) : []; // Добавим trim на всякий случай
        console.log(`📘 Новелла ID: ${novel.novel_id}, Теги: [${novelTags.join(', ')}]`);

        // Проверка включения
        if (!checkTaxonomyFilter(novelTags, STATE.currentFilters.includeTags, STATE.currentFilters.includeTagMode)) {
            console.log(`   ❌ Провалила проверку ВКЛЮЧЕНИЯ (Include tags: [${STATE.currentFilters.includeTags.join(', ')}])`);
            return false;
        } 

        // Проверка исключения
        if (!checkTaxonomyFilter(novelTags, STATE.currentFilters.excludeTags, STATE.currentFilters.excludeTagMode, true)) {
            console.log(`   ❌ Провалила проверку ИСКЛЮЧЕНИЯ (Exclude tags: [${STATE.currentFilters.excludeTags.join(', ')}])`);
            return false;
        }

        return true; // Прошла все фильтры
    });

    // --- ШАГ 2: СОРТИРОВКА ---
    const sortField = STATE.sortBy;
    const sortMultiplier = STATE.sortOrder === 'asc' ? 1 : -1;

    novelsToProcess.sort((a, b) => {
        let valA, valB;

        if (sortField === 'title' || sortField === 'author') {
            // Сортировка строк (с учетом локали)
            valA = a[sortField] || '';
            valB = b[sortField] || '';
            return valA.localeCompare(valB, 'ru', { sensitivity: 'base' }) * sortMultiplier;
        } else if (sortField === 'updated' || sortField === 'added') {
            // Сортировка дат (created_at или updated_at)
            const fieldName = sortField === 'updated' ? 'updated_at' : 'created_at';
             // Преобразуем в Date объекты, обрабатывая возможные null/undefined
             valA = a[fieldName] ? new Date(a[fieldName]) : new Date(0); // Ранняя дата для null
             valB = b[fieldName] ? new Date(b[fieldName]) : new Date(0);
             return (valA - valB) * sortMultiplier;
        }
        // Добавить сортировку по числам (главы, слова), если нужно
        // else if (sortField === 'chapters') { ... }

        return 0; // По умолчанию не сортируем
    });

    // --- ШАГ 3: ОБНОВЛЕНИЕ СОСТОЯНИЯ И РЕНДЕРИНГ ---
    STATE.filteredNovels = novelsToProcess; // Сохраняем отфильтрованный и отсортированный результат
    STATE.currentPage = 1; // Сбрасываем на первую страницу
    renderNovelsGrid(STATE.filteredNovels); // Обновляем сетку
    renderPagination(); // Обновляем пагинацию
    updateFilterInfo(); // Обновляем инфо о фильтрах/сортировке (если есть)

}

// Вспомогательная функция для обновления инфо-строки (можно добавить)
function updateFilterInfo() {
  const filterInfoEl = document.getElementById('filter-info');
  if (!filterInfoEl) return;

  // ✨ ИСПРАВЛЕНИЕ: Получаем текст кнопки сортировки ✨
  const sortButton = document.getElementById('sort-btn');
  let sortText = '';
  if (sortButton) {
      // Берем текстовое содержимое кнопки (без иконки)
      const buttonTextElement = sortButton.querySelector('span:last-child');
      if (buttonTextElement) {
          sortText = buttonTextElement.textContent.trim();
      }
  }
  // ------------------------------------------

  // TODO: Сформировать строку, описывающую активные фильтры
  // Пока просто добавляем текст сортировки
  filterInfoEl.textContent = sortText ? ` | Сортировка: ${sortText}` : '';
}

/** Вспомогательная функция для получения выбранных тегов/жанров */
function getSelectedTags(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.filter-tag.active')).map(tag => tag.dataset.value);
}

/**
  * Вспомогательная функция для проверки фильтра по жанрам/тегам
  * @param {string[]} itemTaxonomies - Жанры/теги элемента (новеллы).
  * @param {string[]} selectedTaxonomies - Выбранные в фильтре жанры/теги.
  * @param {'any'|'all'} mode - Режим ('Любой из' или 'Все из').
  * @param {boolean} isExclude - True, если это фильтр ИСКЛЮЧЕНИЯ.
  * @returns {boolean} True, если элемент проходит проверку.
  */
function checkTaxonomyFilter(itemTaxonomies, selectedTaxonomies, mode, isExclude = false) {
    if (!Array.isArray(itemTaxonomies)) itemTaxonomies = [];
    if (selectedTaxonomies.length === 0) {
        return true;
    }

    const lowerItemTaxonomies = itemTaxonomies.map(t => String(t || '').toLowerCase());
    let result = true; // Результат по умолчанию

    if (isExclude) {
        const hasExcluded = selectedTaxonomies.some(tax =>
            lowerItemTaxonomies.includes(String(tax || '').toLowerCase())
        );
        result = !hasExcluded;
        // --- ЛОГ РЕЗУЛЬТАТА ---
        console.log(`   🔍 checkTaxonomyFilter (EXCLUDE): itemTags=[${lowerItemTaxonomies.join(', ')}], selected=[${selectedTaxonomies.join(', ')}], hasExcluded=${hasExcluded}, result=${result}`);
        // ---------------------
    } else {
        if (mode === 'any') {
            const hasIncluded = selectedTaxonomies.some(tax =>
                lowerItemTaxonomies.includes(String(tax || '').toLowerCase())
            );
            result = hasIncluded;
             // --- ЛОГ РЕЗУЛЬТАТА ---
             console.log(`   🔍 checkTaxonomyFilter (INCLUDE any): itemTags=[${lowerItemTaxonomies.join(', ')}], selected=[${selectedTaxonomies.join(', ')}], hasIncluded=${hasIncluded}, result=${result}`);
             // ---------------------
        }
        else if (mode === 'all') {
            const hasAllIncluded = selectedTaxonomies.every(tax =>
                lowerItemTaxonomies.includes(String(tax || '').toLowerCase())
            );
            result = hasAllIncluded;
             // --- ЛОГ РЕЗУЛЬТАТА ---
             console.log(`   🔍 checkTaxonomyFilter (INCLUDE all): itemTags=[${lowerItemTaxonomies.join(', ')}], selected=[${selectedTaxonomies.join(', ')}], hasAllIncluded=${hasAllIncluded}, result=${result}`);
             // ---------------------
        }
    }
    return result; // Возвращаем вычисленный результат
}

// ==========================================
// РАСШИРЕННЫЕ ФИЛЬТРЫ С РЕЖИМАМИ
// ==========================================

/**
 * Заполняет элементы управления расширенных фильтров
 */
function setupAdvancedFilters() {
    // Заполняем простые селекты
    populateSelect('language-filter', STATE.config.LANGUAGES);
    populateSelect('era-filter', STATE.config.ERAS);
    populateSelect('orientation-filter', STATE.config.ORIENTATIONS);
    populateSelect('perspective-filter', STATE.config.PERSPECTIVES);
    populateSelect('original-status-filter', STATE.config.STATUS_OPTIONS);
    populateSelect('translation-status-filter', STATE.config.STATUS_OPTIONS);

    // УДАЛЕНО: Заполнение контейнеров жанров и тегов

    // ДОБАВЛЕНО: Рендерим новую карту тегов
    renderFilterTagMap();

    initTooltips()
}

/** Вспомогательная функция для заполнения select */
function populateSelect(selectId, optionsArray) {
    const select = document.getElementById(selectId);
    if (select && optionsArray && optionsArray.length > 0) {
        // --- НАЧАЛО ИЗМЕНЕНИЙ ---
        // Сохраняем первую опцию ("Выберите...")
        const firstOption = select.options[0];
        // Очищаем все остальные опции
        select.innerHTML = '';
        // Возвращаем первую опцию, если она была
        if (firstOption && firstOption.value === '') {
             select.appendChild(firstOption);
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---

        // Добавляем новые опции (как и раньше)
        select.innerHTML += optionsArray.map(opt =>
            `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`
        ).join('');
    }
}

/**
 * Генерирует HTML для карты тегов в фильтрах.
 */
function renderFilterTagMap() {
    const container = document.getElementById('filter-tags-map');
    if (!container || !STATE.genresAndTags?.tags) {
        if (container) container.innerHTML = '<p class="text-danger">Не удалось загрузить теги.</p>';
        return;
    }

    if (STATE.genresAndTags.tags.length === 0) {
        container.innerHTML = '<p class="text-muted">Нет доступных тегов.</p>';
        return;
    }

    container.innerHTML = STATE.genresAndTags.tags.map(tag => `
        <div class="filter-tag-item"
             data-value="${escapeHtml(tag.name)}"
             data-description="${tag.description ? escapeHtml(tag.description) : ''}" {/* Убедись, что этот атрибут добавляется */} >
            <span class="filter-tag-name">${escapeHtml(tag.name)}</span>
            <button class="tag-filter-btn include-btn" title="Включить" onclick="handleTagFilterClick(this, 'include')">+</button>
            <button class="tag-filter-btn exclude-btn" title="Исключить" onclick="handleTagFilterClick(this, 'exclude')">-</button>
        </div>
    `).join('');

    // Восстанавливаем состояние из STATE.currentFilters, если оно есть
    updateTagMapSelectionFromState();
}

/**
 * Обрабатывает клик по кнопке '+' или '-' на теге в карте фильтров.
 */
function handleTagFilterClick(buttonElement, mode) { // mode: 'include' or 'exclude'
    const tagItem = buttonElement.closest('.filter-tag-item');
    if (!tagItem) return;

    const tagName = tagItem.dataset.value;
    const isIncludeActive = tagItem.classList.contains('include-active');
    const isExcludeActive = tagItem.classList.contains('exclude-active');

    // Логика переключения состояния
    if (mode === 'include') {
        if (isIncludeActive) { // Кликнули + на уже включенном -> выключить
            tagItem.classList.remove('include-active');
        } else { // Кликнули + на выключенном или исключенном
            tagItem.classList.remove('exclude-active'); // Снимаем исключение, если было
            tagItem.classList.add('include-active');    // Включаем
        }
    } else if (mode === 'exclude') {
        if (isExcludeActive) { // Кликнули - на уже исключенном -> выключить
            tagItem.classList.remove('exclude-active');
        } else { // Кликнули - на выключенном или включенном
            tagItem.classList.remove('include-active'); // Снимаем включение, если было
            tagItem.classList.add('exclude-active');    // Исключаем
        }
    }

    // Обновляем состояние в STATE и списки выбранных тегов
    updateFiltersFromTagMap();

    // Применяем фильтры
    applyFiltersAndSort();
}

/**
 * Обновляет STATE.currentFilters.includeTags/excludeTags
 * и отображение в #selected-include-tags / #selected-exclude-tags
 * на основе классов .include-active / .exclude-active в #filter-tags-map.
 */
function updateFiltersFromTagMap() {
    const tagMapContainer = document.getElementById('filter-tags-map');
    if (!tagMapContainer) return;

    STATE.currentFilters.includeTags = [];
    STATE.currentFilters.excludeTags = [];

    tagMapContainer.querySelectorAll('.filter-tag-item').forEach(item => {
        const tagName = item.dataset.value;
        if (item.classList.contains('include-active')) {
            STATE.currentFilters.includeTags.push(tagName);
        } else if (item.classList.contains('exclude-active')) {
            STATE.currentFilters.excludeTags.push(tagName);
        }
    });

    updateSelectedTagsDisplay('selected-include-tags', STATE.currentFilters.includeTags, 'include');
    updateSelectedTagsDisplay('selected-exclude-tags', STATE.currentFilters.excludeTags, 'exclude');
}

/**
 * Обновляет отображение выбранных тегов в указанном контейнере.
 */
function updateSelectedTagsDisplay(containerId, tagNames, type) { // type: 'include' or 'exclude'
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = tagNames.map(name =>
        `<span class="selected-tag ${type}">${escapeHtml(name)}</span>`
    ).join('');
}

/**
 * Устанавливает классы include-active/exclude-active на карте тегов
 * на основе текущих значений в STATE.currentFilters.
 * Вызывается один раз при инициализации карты.
 */
 function updateTagMapSelectionFromState() {
    const tagMapContainer = document.getElementById('filter-tags-map');
    if (!tagMapContainer) return;

    tagMapContainer.querySelectorAll('.filter-tag-item').forEach(item => {
        const tagName = item.dataset.value;
        item.classList.remove('include-active', 'exclude-active'); // Сначала сбрасываем

        if (STATE.currentFilters.includeTags.includes(tagName)) {
            item.classList.add('include-active');
        } else if (STATE.currentFilters.excludeTags.includes(tagName)) {
            item.classList.add('exclude-active');
        }
    });

    // Также обновляем списки выбранных
    updateSelectedTagsDisplay('selected-include-tags', STATE.currentFilters.includeTags, 'include');
    updateSelectedTagsDisplay('selected-exclude-tags', STATE.currentFilters.excludeTags, 'exclude');

    // Восстанавливаем состояние радио-кнопок
    const includeMode = STATE.currentFilters.includeTagMode || 'any';
    const excludeMode = STATE.currentFilters.excludeTagMode || 'any';
    document.querySelector(`input[name="include-tag-mode"][value="${includeMode}"]`).checked = true;
    document.querySelector(`input[name="exclude-tag-mode"][value="${excludeMode}"]`).checked = true;
}


function renderFilterTags(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = items.map(item => `
        <button class="filter-tag" data-value="${escapeHtml(item.name)}" data-type="${type}"
                onclick="toggleFilterTag(this)">
            ${escapeHtml(item.name)}
        </button>
    `).join('');
}

function setFilterMode(type, mode) {
    if (type === 'genre') {
        STATE.currentFilters.genreMode = mode;
        document.querySelectorAll('.genre-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    } else if (type === 'tag') {
        STATE.currentFilters.tagMode = mode;
        document.querySelectorAll('.tag-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }
}

// ==========================================
// ФИЛЬТРАЦИЯ ПО ЖАНРАМ И ТЕГАМ ИЗ БЕЙДЖЕЙ
// ==========================================

/**
 * Фильтрует новеллы по жанру при клике на бейдж
 */
function filterByGenre(genreName) {
    // Переходим на страницу каталога
    navigateTo('home');
    
    // Ждём загрузки страницы
    setTimeout(() => {
        // Сбрасываем все фильтры
        resetFilters();
        
        // Активируем выбранный жанр
        const genreButtons = document.querySelectorAll('#filter-genres-container .filter-tag');
        genreButtons.forEach(btn => {
            if (btn.dataset.value === genreName) {
                btn.classList.add('active');
                toggleFilterTag(btn);
            }
        });
        
        // Применяем фильтры
        applyFilters();
        
        // Показываем уведомление
        showToast(`Фильтр: жанр "${genreName}"`, 'info');
    }, 300);
}

/**
 * Фильтрует новеллы по тегу при клике на бейдж
 */
function filterByTag(tagName) {
    // Переходим на страницу каталога
    navigateTo('home');
    
    // Ждём загрузки страницы
    setTimeout(() => {
        // Сбрасываем все фильтры
        resetFilters();
        
        // Активируем выбранный тег
        const tagButtons = document.querySelectorAll('#filter-tags-container .filter-tag');
        tagButtons.forEach(btn => {
            if (btn.dataset.value === tagName) {
                btn.classList.add('active');
                toggleFilterTag(btn);
            }
        });
        
        // Применяем фильтры
        applyFilters();
        
        // Показываем уведомление
        showToast(`Фильтр: тег "${tagName}"`, 'info');
    }, 300);
}

/**
 * Инициализация кастомных tooltip для жанров и тегов
 */
/**
 * Инициализация кастомных tooltip для элементов с data-description (с делегированием).
 */
function initTooltips() {
    // Удаляем старый tooltip-элемент, если он есть
    const oldTooltip = document.getElementById('custom-tooltip');
    if (oldTooltip) {
        oldTooltip.remove();
    }

    // Создаём элемент tooltip один раз при инициализации
    const tooltip = document.createElement('div');
    tooltip.id = 'custom-tooltip';
    tooltip.className = 'custom-tooltip'; // Убедись, что стиль .custom-tooltip есть в CSS
    document.body.appendChild(tooltip);

    // --- Используем делегирование событий ---
    document.body.removeEventListener('mouseover', handleTooltipMouseOver); // Убираем старый слушатель (если был)
    document.body.removeEventListener('mouseout', handleTooltipMouseOut);
    document.body.removeEventListener('mousemove', handleTooltipMouseMove);

    document.body.addEventListener('mouseover', handleTooltipMouseOver);
    document.body.addEventListener('mouseout', handleTooltipMouseOut);
    document.body.addEventListener('mousemove', handleTooltipMouseMove);
}

// Вспомогательная функция для mouseover
function handleTooltipMouseOver(e) {
    const target = e.target.closest('[data-description]');
    const tooltip = document.getElementById('custom-tooltip');
    if (target && tooltip) {
        const description = target.dataset.description;
        if (description && description.trim() !== '') {
            tooltip.textContent = description;
            updateTooltipPosition(e, tooltip); // Сначала позиционируем
            tooltip.classList.add('show'); // Добавляем класс для плавного появления
        } else {
            tooltip.classList.remove('show'); // Убираем класс, если описание пустое
        }
    }
}

// Вспомогательная функция для mouseout
function handleTooltipMouseOut(e) {
    const target = e.target.closest('[data-description]');
    const tooltip = document.getElementById('custom-tooltip');
    if (target && tooltip) {
         tooltip.classList.remove('show'); // Просто убираем класс при уходе мыши
    }
}

// Вспомогательная функция для mousemove (остается без изменений)
function handleTooltipMouseMove(e) {
    const tooltip = document.getElementById('custom-tooltip');
    if (tooltip && tooltip.style.display === 'block') {
        updateTooltipPosition(e, tooltip);
    }
}

// Функция updateTooltipPosition остается без изменений
function updateTooltipPosition(e, tooltip) {
    // Убедимся, что tooltip существует перед доступом к offsetWidth/offsetHeight
    if (!tooltip) return;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const cursorPadding = 15;

    let left = e.pageX + cursorPadding;
    let top = e.pageY + cursorPadding;

    // Проверка выхода за края окна
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Проверка правого края
    if (left + tooltipWidth > scrollX + viewportWidth) {
        left = e.pageX - tooltipWidth - cursorPadding;
    }
    // Проверка левого края
    if (left < scrollX) {
         left = e.pageX + cursorPadding; // Возвращаем справа от курсора
    }

    // Проверка нижнего края
    if (top + tooltipHeight > scrollY + viewportHeight) {
        top = e.pageY - tooltipHeight - cursorPadding;
    }
     // Проверка верхнего края
    if (top < scrollY) {
         top = e.pageY + cursorPadding; // Возвращаем снизу от курсора
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

// ==========================================
// ПЕРЕКЛЮЧЕНИЕ ВИДОВ
// ==========================================

function toggleViewMode(mode) {
    if (!['grid', 'list'].includes(mode) || STATE.viewMode === mode) return; // Проверка

    STATE.viewMode = mode;
    localStorage.setItem('novel-view-mode', mode);

    const gridBtn = document.getElementById('grid-view');
    const listBtn = document.getElementById('list-view');

    // ✨ Убедись, что обе кнопки обновляются ✨
    if (gridBtn && listBtn) {
        gridBtn.classList.toggle('active', mode === 'grid');
        listBtn.classList.toggle('active', mode === 'list');
    }

    // Перерисовываем сетку с учетом пагинации
    const novelsToShow = STATE.filteredNovels.length > 0 ? STATE.filteredNovels : STATE.novels;
    renderNovelsGrid(novelsToShow); // Функция сама учтет STATE.viewMode
}

// ==========================================
// МОДАЛЬНЫЕ ОКНА (ТОЛЬКО ДЛЯ АДМИНКИ)
// ==========================================

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show', 'visible');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        // ✨ НАЧАЛО ИСПРАВЛЕНИЯ: Динамическая загрузка виджета ✨
        if (modalId === 'auth-modal' && !isTelegramWidgetLoaded) {
            const placeholder = document.getElementById('telegram-widget-placeholder');
            
            // Проверяем, что плейсхолдер существует
            if (placeholder) { 
                console.log('Загрузка виджета Telegram...');
                isTelegramWidgetLoaded = true; // Ставим флаг, чтобы не грузить дважды

                const script = document.createElement('script');
                script.async = true; // async здесь уже безопасен
                script.src = 'https://telegram.org/js/telegram-widget.js?22';
                
                // Все data-атрибуты из твоего HTML
                script.dataset.telegramLogin = 'logovo_saltfish_bot';
                script.dataset.size = 'large';
                script.dataset.onauth = 'onTelegramAuth(user)';
                script.dataset.requestAccess = 'write';

                // Добавляем скрипт ВНУТРЬ плейсхолдера
                // Теперь document.write() сработает только внутри этого div
                placeholder.appendChild(script);
            }
        }
        // ✨ КОНЕЦ ИСПРАВЛЕНИЯ ✨
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (document.activeElement) document.activeElement.blur(); // <-- ДОБАВЛЕНО: Снимаем фокус
        modal.classList.remove('show', 'visible');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

function showAdminTab(tabName, buttonElement) {
    // Прячем все контенты вкладок
    document.querySelectorAll('#admin-content .admin-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    // Убираем класс 'active' со всех кнопок
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Показываем нужный контент и делаем активной нужную кнопку
    const activeContent = document.getElementById(`admin-tab-${tabName}`);
    if (activeContent) {
        activeContent.style.display = 'block';
    }
    if (buttonElement) {
        buttonElement.classList.add('active');
    }
}

// ==========================================
// КАСТОМНЫЕ МОДАЛЬНЫЕ ОКНА
// ==========================================

/**
 * Кастомное окно подтверждения (вместо confirm)
 */
function showConfirmModal(title, message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content confirm-modal">
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn-primary confirm-yes">Да</button>
                <button class="btn btn-secondary confirm-no">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const yesBtn = modal.querySelector('.confirm-yes');
    const noBtn = modal.querySelector('.confirm-no');
    
    const cleanup = () => {
        modal.remove();
    };
    
    yesBtn.onclick = () => {
        cleanup();
        if (onConfirm) onConfirm();
    };
    
    noBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    
    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * Кастомное окно оповещения (вместо alert)
 */
function showAlertModal(title, message, type = 'info') {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content alert-modal alert-${type}">
            <div class="alert-icon">${icons[type] || icons.info}</div>
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn-primary alert-ok">OK</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const okBtn = modal.querySelector('.alert-ok');
    
    const cleanup = () => {
        modal.remove();
    };
    
    okBtn.onclick = cleanup;
    
    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * Кастомное окно с полем ввода (вместо prompt)
 */
function showPromptModal(title, message, defaultValue = '', onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content prompt-modal">
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <input type="text" class="form-input prompt-input" value="${escapeHtml(defaultValue)}">
            <div class="modal-actions">
                <button class="btn btn-primary prompt-ok">OK</button>
                <button class="btn btn-secondary prompt-cancel">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const input = modal.querySelector('.prompt-input');
    const okBtn = modal.querySelector('.prompt-ok');
    const cancelBtn = modal.querySelector('.prompt-cancel');
    
    const cleanup = () => {
        modal.remove();
    };
    
    okBtn.onclick = () => {
        const value = input.value.trim();
        cleanup();
        if (onConfirm) onConfirm(value);
    };
    
    cancelBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    
    // Enter для подтверждения
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            okBtn.click();
        }
    });
    
    // ESC для отмены
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    // Фокус на input
    setTimeout(() => input.focus(), 100);
}

// ==========================================
// КОРЗИНА
// ==========================================

async function renderTrashTabContent() {
    const container = document.getElementById('admin-tab-trash'); // ID вкладки
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Загрузка корзины...</div>';

    try {
        // Запрашиваем данные корзины с сервера
        const response = await apiRequest('getTrash');
        if (!response.success) throw new Error(response.error);

        const items = response.items || [];

        // Собираем HTML для каждого элемента
        const itemsHtml = items.map(item => {
            // ✨ ИСПОЛЬЗУЕМ ГОТОВОЕ ПОЛЕ 'title' ✨
            const title = item.title || `Неизвестный ${item.item_type}`;

            return `
                <div class="item trash-item">
                    <div class="trash-item-info">
                        <strong>${item.item_type === 'novel' ? 'Новелла' : 'Глава'}</strong>
                        <p>${escapeHtml(title)}</p>
                        <small>ID: ${item.item_id} | Удалено: ${formatDateShort(item.deleted_at)}</small>
                    </div>
                    <div class="table-actions trash-item-actions">
                         <button class="btn btn-sm btn-icon" title="Предпросмотр (скоро)" disabled>👁️</button>
                         <button class="btn btn-sm btn-success" title="Восстановить"
                                onclick="restoreFromTrash('${item.item_type}', '${item.item_id}')">
                            ↩️
                         </button>
                         <button class="btn btn-sm btn-danger" title="Удалить навсегда"
                                 onclick="deleteFromTrashPermanent('${item.item_type}', '${item.item_id}')">
                             🗑️
                         </button>
                    </div>
                </div>`;
        }).join('');

        // Финальная отрисовка вкладки
        container.innerHTML = `
            <h3><i class="fas fa-trash"></i> Управление корзиной</h3>
            <div class="admin-actions">
                 <button class="btn btn-danger" onclick="emptyTrashConfirm()">
                    <i class="fas fa-times-circle"></i> Очистить корзину
                </button>
            </div>
            <div class="items-list">
                ${items.length > 0 ? itemsHtml : '<p class="text-muted" style="text-align: center; padding: 2rem;">Корзина пуста</p>'}
            </div>
        `;
    } catch (error) {
        container.innerHTML = `<p class="text-danger">Ошибка загрузки корзины: ${error.message}</p>`;
    }
}

async function openTrash() {
    showLoading(true, { title: 'Загрузка корзины' });
    
    try {
        const response = await apiRequest('getTrash');
        
        if (response.success) {
            renderTrashModal(response.items || []);
        } else {
            showToast('Не удалось загрузить корзину', 'error');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderTrashModal(items) {
    const modal = document.getElementById('trash-modal');
    if (!modal) {
        createTrashModal();
        renderTrashModal(items);
        return;
    }
    
    const container = modal.querySelector('.trash-items');
    if (!container) return;
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-muted">Корзина пуста</p>';
    } else {
        container.innerHTML = items.map(item => `
            <div class="trash-item">
                <div class="trash-item-info">
                    <strong>${escapeHtml(item.item_type === 'novel' ? 'Новелла' : 'Глава')}</strong>
                    <p>${escapeHtml(item.title || item.name)}</p>
                    <small>Удалено: ${formatDate(item.deleted_at)}</small>
                </div>
                <div class="trash-item-actions">
                    <button class="btn btn-sm btn-success" 
                            onclick="restoreFromTrash('${item.item_type}', '${item.item_id}')">
                        ↩️ Восстановить
                    </button>
                    <button class="btn btn-sm btn-danger" 
                            onclick="deleteFromTrashPermanent('${item.item_type}', '${item.item_id}')">
                        🗑️ Удалить навсегда
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    showModal('trash-modal');
}

function restoreFromTrash(itemType, itemId) {
    showConfirmModal('Восстановление элемента', 'Вы уверены, что хотите восстановить этот элемент?', async () => {
        showLoading(true, { title: 'Восстановление' });
        try {
            const response = await apiPostRequest('restoreFromTrash', { itemType, itemId });
            if (response.success) {
                showToast('Восстановлено!', 'success');
                clearCache();
                renderTrashTabContent(); // ✨ Обновляем содержимое вкладки
            } else { throw new Error(response.error || 'Ошибка восстановления'); }
        } catch (error) { showToast('Ошибка: ' + error.message, 'error'); } 
        finally { showLoading(false); }
    });
}

// Функция для кнопки "Удалить навсегда" в строке корзины
function deleteFromTrashPermanent(itemType, itemId) {
    showConfirmModal(
        'Удалить навсегда?',
        'ВНИМАНИЕ! Это действие необратимо. Элемент будет удален из системы полностью (включая файлы на Диске, если применимо). Продолжить?',
        async () => {
            showLoading(true, { title: 'Полное удаление...' });
            try {
                // ✨ ВЫЗЫВАЕМ ПРАВИЛЬНЫЕ ДЕЙСТВИЯ ✨
                const action = itemType === 'novel' ? 'permanentDeleteNovel' : 'permanentDeleteChapter';
                const params = itemType === 'novel' ? { novelId: itemId } : { chapterId: itemId };

                // permanent: true БОЛЬШЕ НЕ НУЖЕН

                const response = await apiPostRequest(action, params);

                if (response.success) {
                    showToast('Элемент удален навсегда', 'success');
                    renderTrashTabContent(); // Обновляем содержимое вкладки корзины
                } else {
                    throw new Error(response.error || `Не удалось удалить ${itemType}`);
                }
            } catch (error) {
                showToast(`Ошибка удаления: ${error.message}`, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

// Функция для кнопки "Очистить корзину"
function emptyTrashConfirm() {
    showConfirmModal(
        'Очистить корзину?',
        'Вы уверены, что хотите полностью очистить корзину? Все элементы в ней будут удалены НАВСЕГДА (включая файлы на Диске). Это действие необратимо.',
        async () => {
            showLoading(true, { title: 'Очистка корзины...' });
            try {
                const response = await apiPostRequest('emptyTrash', {}); // Вызываем emptyTrash на сервере
                if (response.success) {
                    showToast(response.message || 'Корзина очищена', 'success');
                    renderTrashTabContent(); // Обновляем вкладку
                } else {
                    // Показываем сообщение об ошибке с сервера, если есть
                    throw new Error(response.message || response.error || 'Не удалось очистить корзину');
                }
            } catch (error) {
                 // Показываем ошибку в виде модального окна, т.к. сообщение может быть длинным
                 showAlertModal('Ошибка при очистке', error.message, 'error');
                 // На всякий случай обновляем вкладку, чтобы увидеть, что осталось
                 renderTrashTabContent();
            } finally {
                showLoading(false);
            }
        }
    );
}

function formatDate(dateString) {
    if (!dateString) return 'Неизвестно';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

//=============================
// Админка
//=============================

function openAdminPanel() {
    showModal('admin-modal');
    loadAdminData();
}

async function loadAdminData() {
    const content = document.getElementById('admin-content');
    if (!content) return;

    content.innerHTML = `
        <div class="modal-loading-overlay">
            <div class="spinner spinner-lg"></div>
        </div>
    `;

    try {
        const [
            dashboardResponse,
            usersResponse, 
            genresAndTagsResponse,
            limitPersonalResponse,
            limitCommunityResponse
        ] = await Promise.all([
            apiRequest('getDashboardData'),
            apiRequest('getAllUsers'),
            apiRequest('getGenresAndTags'),
            apiRequest('getSetting', { key: 'global_limit_personal' }),
            apiRequest('getSetting', { key: 'global_limit_community' })
        ]);

        // --- ИЗМЕНЕНИЕ ЗДЕСЬ ---
        // Проверяем успех каждого запроса и извлекаем нужные данные
        const dashboardData = dashboardResponse?.success ? dashboardResponse : null;
        const usersData = usersResponse?.success ? usersResponse.users : [];
        // Извлекаем genres и tags ТОЛЬКО если запрос был успешным
        const genresAndTagsData = genresAndTagsResponse?.success
                                    ? genresAndTagsResponse // Передаем весь объект {genres: [], tags: []}
                                    : { genres: [], tags: [] }; // Передаем пустые массивы при ошибке

        const limitsData = {
            personal: limitPersonalResponse?.success && limitPersonalResponse.value !== null
                ? limitPersonalResponse.value
                : 10, // Лимит по умолчанию, если в БД нет
            community: limitCommunityResponse?.success && limitCommunityResponse.value !== null
                ? limitCommunityResponse.value
                : 50
        };

        // Логируем ошибки, если были
        if (!dashboardResponse?.success) console.error("Ошибка загрузки статистики:", dashboardResponse?.error);
        if (!usersResponse?.success) console.error("Ошибка загрузки пользователей:", usersResponse?.error);
        if (!genresAndTagsResponse?.success) console.error("Ошибка загрузки жанров/тегов:", genresAndTagsResponse?.error);

        // Передаем извлеченные данные
        renderAdminPanel(dashboardData, usersData, genresAndTagsData, limitsData);
        // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    } catch (error) { // Эта ошибка ловит проблемы с самим apiRequest (например, сеть)
        console.error("Критическая ошибка загрузки данных админки:", error);
        content.innerHTML = `<p class="text-danger">Ошибка загрузки данных: ${error.message}</p>`;
    }
}

function renderUsersTableRows(users) {
    if (!users || users.length === 0) {
        return '<tr><td colspan="6" class="text-center">Пользователи не найдены</td></tr>';
    }
    return users.map(user => `
        <tr>
            <td>${user.user_id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.email || '-')}</td>
            <td><span class="role-badge role-${user.role}">${getDisplayRoleName(user.role)}</span></td>
            <td>${formatDate(user.created_at)}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-secondary" onclick="editUserRole(${user.user_id}, '${user.role}')">Изменить роль</button>
                ${user.role !== 'owner' ? `<button class="btn btn-sm btn-danger" onclick="handleDeleteUser(${user.user_id}, '${escapeHtml(user.username)}')">Удалить</button>` : ''}
            </td>
        </tr>`).join('');
}

function renderAdminPanel(dashboardData, users, genresAndTags, limits) {
    const content = document.getElementById('admin-content');
    if (!content) return;

    // Определяем наши вкладки
    const tabs = {
        stats: '📊 Дашборд',
        users: '👥 Пользователи',
        access: '🔒 Доступы',
        genres: '🏷️ Жанры',
        tags: '🔖 Теги',
        trash: '🗑️ Корзина',
        database: '🗄️ База данных',
        settings: '⚙️ Настройки'
    };

    // Создаём HTML для кнопок-вкладок
    const tabsHtml = Object.entries(tabs).map(([key, title], index) => `
        <button class="tab-btn ${index === 0 ? 'active' : ''}" onclick="showAdminTab('${key}', this)">
            ${title}
        </button>
    `).join('');
    
    // Вставляем всю базовую HTML-структуру в модальное окно
    content.innerHTML = `
        <nav class="admin-tabs">${tabsHtml}</nav>
        <div id="admin-tab-stats" class="admin-tab-content" style="display: block;"></div>
        <div id="admin-tab-users" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-access" class="admin-tab-content" style="display: none;"></div> <div id="admin-tab-genres" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-genres" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-tags" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-trash" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-database" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-settings" class="admin-tab-content" style="display: none;"></div>
    `;
    
    // --- Теперь наполняем каждую вкладку реальным содержимым ---

    // Вкладка "Статистика"
    const statsContent = document.getElementById('admin-tab-stats');
    if (statsContent) {
        statsContent.innerHTML = `
            <h3>Дашборд</h3>

            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${dashboardData?.stats?.novels || 0}</div><div class="stat-label">Новелл</div></div>
                <div class="stat-card"><div class="stat-value">${dashboardData?.stats?.chapters || 0}</div><div class="stat-label">Глав</div></div>
                <div class="stat-card"><div class="stat-value">${dashboardData?.stats?.tags || 0}</div><div class="stat-label">Тегов</div></div>
                <div class="stat-card"><div class="stat-value">${dashboardData?.stats?.trashItems || 0}</div><div class="stat-label">В корзине</div></div>
            </div>

            <hr class="section-divider">

            <div class="dashboard-columns">

                <div class="dashboard-column">
                    <h4>Требуется внимание (Ошибки)</h4>
                    <div class="dashboard-list">
                        ${dashboardData?.errorNovels?.length > 0 
                            ? dashboardData.errorNovels.map(novel => `
                                <div class="dashboard-item error-item" onclick="navigateTo('edit-novel', {id: '${novel.novel_id}'})">
                                    <strong class="item-title">⚠️ ${escapeHtml(novel.title)}</strong>
                                    <small class="item-meta">${escapeHtml(novel.description)}</small>
                                </div>
                            `).join('')
                            : '<p class="text-muted">Ошибок не найдено.</p>'
                        }
                    </div>
                </div>

                <div class="dashboard-column">
                    <h4>Недавние новеллы</h4>
                    <div class="dashboard-list">
                        ${dashboardData?.recentNovels?.length > 0 
                            ? dashboardData.recentNovels.map(novel => `
                                <div class="dashboard-item" onclick="navigateTo('novel-details', {id: '${novel.novel_id}'})">
                                    <strong class="item-title">${escapeHtml(novel.title)}</strong>
                                    <small class="item-meta">Добавлено: ${formatDate(novel.created_at)}</small>
                                </div>
                            `).join('')
                            : '<p class="text-muted">Нет недавних новелл.</p>'
                        }
                    </div>
                </div>

            </div>
        `;
    }

    // Вкладка "Пользователи"
    const usersContent = document.getElementById('admin-tab-users');
    if (usersContent) {
        usersContent.innerHTML = `
            <h3>Управление пользователями</h3>
            <div class="users-filters">
                <input type="search" id="user-search-input" class="form-input" placeholder="Поиск по ID, имени или email...">
                <button class="btn btn-primary" id="user-search-btn">Найти</button>
            </div>
            <div class="table-responsive">
                <table class="users-table">
                    <thead>
                        <tr><th>ID</th><th>Имя</th><th>Email</th><th>Роль</th><th>Создан</th><th>Действия</th></tr>
                    </thead>
                    <tbody>
                        ${renderUsersTableRows(users)}
                    </tbody>
                </table>
            </div>`;
        
        // --- ПРАВИЛЬНАЯ ПРИВЯЗКА СОБЫТИЙ ---
        // Для клика по кнопке
        document.getElementById('user-search-btn').addEventListener('click', handleSearchUsers);

        // Для нажатия Enter в поле поиска
        document.getElementById('user-search-input').addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                handleSearchUsers();
            }
        });

        // 2. ОТДЕЛЬНЫЙ обработчик для клика по кнопке "Найти"
        document.querySelector('#admin-tab-users .btn-primary').addEventListener('click', handleSearchUsers);
    }

    // Вкладка "Доступы"
    const accessContent = document.getElementById('admin-tab-access');
    if (accessContent) {
        accessContent.innerHTML = `
            <h3>Управление доступами</h3>
            <p>В разработке...</p>
        `;
    }

    // Вкладка "Жанры"
    const genresContent = document.getElementById('admin-tab-genres');
    if (genresContent) {
        let genresHtml = '<p class="text-muted">Жанры отключены или не загружены.</p>'; // Сообщение по умолчанию
        if (genresAndTags?.genres && genresAndTags.genres.length > 0) {
            genresHtml = genresAndTags.genres.map(g => `
                <div class="item">
                    <span>${escapeHtml(g.name)}</span>
                    ${g.description ? `<p class="item-description">${escapeHtml(g.description)}</p>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="/* handleDeleteGenre('${g.id}', '${escapeHtml(g.name)}') */ alert('Жанры отключены')">Удалить</button>
                </div>`).join('');
        } else if (genresAndTags?.genres) {
            genresHtml = '<p class="text-muted">Нет добавленных жанров.</p>';
        }

        genresContent.innerHTML = `
            <h3>Управление жанрами (Отключено)</h3>
            <div class="admin-form">
                <input type="text" id="new-genre-input" placeholder="Название жанра" class="form-input" disabled>
                <input type="text" id="new-genre-desc" placeholder="Описание (опционально)" class="form-input" disabled>
                <button class="btn btn-primary" onclick="alert('Жанры отключены')" disabled>Добавить жанр</button>
            </div>
            <div class="items-list">
                ${genresHtml}
            </div>`;
    } else {
        console.error("Элемент #admin-tab-genres не найден!");
    }

    // Вкладка "Теги" (исправленная)
    const tagsContent = document.getElementById('admin-tab-tags');
    if (tagsContent) {
        let tagsHtml = '<p class="text-muted">Теги не загружены или отсутствуют.</p>';
        if (genresAndTags?.tags && Array.isArray(genresAndTags.tags)) {
            if (genresAndTags.tags.length > 0) {
                 tagsHtml = genresAndTags.tags.map(t => `
                    <div class="item" data-tag-name="${escapeHtml(t.name.toLowerCase())}">
                        <div class="tag-content">
                            <span>${escapeHtml(t.name)}</span>
                            ${t.description ? `<p class="item-description" data-full-description="${escapeHtml(t.description)}">${escapeHtml(t.description)}</p>` : ''}
                        </div>
                        <div class="table-actions">
                            <button class="btn btn-sm btn-icon btn-secondary" title="Редактировать" onclick="openEditTagModal('${t.id}', '${escapeHtml(t.name)}', this)">
                                ✏️
                            </button>
                            <button class="btn btn-sm btn-danger" title="Удалить" onclick="handleDeleteTag('${t.id}', '${escapeHtml(t.name)}')">
                                🗑️
                            </button>
                        </div>
                    </div>`).join('');
            } else {
                tagsHtml = '<p class="text-muted" style="padding: 15px;">Нет добавленных тегов.</p>'; // Добавляем отступ
            }
        } else {
             console.warn("Данные тегов не получены или имеют неверный формат в renderAdminPanel:", genresAndTags);
        }

        tagsContent.innerHTML = `
            <h3>Управление тегами</h3>
            <div class="admin-form">
                <div class="form-input-container">
                    <input type="text" id="new-tag-input" placeholder="Название тега" class="form-input">
                    <textarea id="new-tag-desc" placeholder="Описание (опционально)" class="form-input"></textarea>
                </div>
                <button class="btn btn-primary btn-add" onclick="handleAddTag()" title="Добавить тег">+</button>
            </div>

            <div class="tag-search-container">
                <input type="search" id="tag-search-input" class="form-input" placeholder="🔍 Поиск тегов..." oninput="filterAdminTags(this.value)">
            </div>

            <div class="items-list" id="admin-tags-list">
                ${tagsHtml}
            </div>`;
    } else {
        console.error("Элемент #admin-tab-tags не найден!");
    }

    // Вкладка "База данных"
    const dbContent = document.getElementById('admin-tab-database');
    if (dbContent) {
        dbContent.innerHTML = `
            <h3>Управление базой данных</h3>
            <div class="admin-actions">
                <button class="btn btn-warning" onclick="updateDatabaseStructure()">🔄 Обновить структуру БД</button>
                <button class="btn btn-secondary" onclick="handleCleanupSessions()">🧹 Очистить старые сессии</button>
                <button class="btn btn-danger" onclick="clearDatabaseConfirm()">⚠️ Очистить базу данных</button>
                <button class="btn btn-danger" onclick="clearDriveFolderConfirm()">⚠️ Очистить папку Drive</button>
                <button class="btn btn-danger" onclick="clearDataConfirm()">⚠️ Очистить ВСЕ ДАННЫЕ</button>
            </div>`;
    }

    const settingsContent = document.getElementById('admin-tab-settings'); // Новое ID
    if (settingsContent) {
        // Генерируем опции для выпадающего списка
        const themeOptions = Object.keys(ROLE_THEMES).map(themeKey =>
            `<option value="${themeKey}" ${STATE.currentRoleTheme === themeKey ? 'selected' : ''}>
                ${themeKey.charAt(0).toUpperCase() + themeKey.slice(1)}
             </option>`
        ).join('');

        settingsContent.innerHTML = `
            <h3>🎨 Настройки отображения</h3>
            <div class="form-group">
                <label for="role-theme-select">Тема названий ролей</label>
                <select id="role-theme-select" class="form-select" onchange="handleRoleThemeChange(this)">
                    ${themeOptions}
                </select>
                <small class="form-help">Выбранная тема будет видна всем пользователям на сайте.</small>
            </div>

            <hr class="section-divider">
            <h3>Глобальные лимиты</h3>
            <small class="form-help">Лимиты по умолчанию для всех пользователей с ролью 'Creator'. (Индивидуальные лимиты настраиваются во вкладке "Доступы")</small>

            <div class="form-group">
                <label for="global-limit-personal">Лимит личных новелл</label>
                <input type="number" id="global-limit-personal" class="form-input" value="${limits.personal}">
            </div>

            <div class="form-group">
                <label for="global-limit-community">Лимит общих новелл</label>
                <input type="number" id="global-limit-community" class="form-input" value="${limits.community}">
            </div>

            <div class="admin-actions">
                <button class="btn btn-primary" onclick="handleSaveGlobalSettings()">Сохранить лимиты</button>
            </div>
            `;
    }

    renderTrashTabContent();
}

/**
 * Фильтрует список тегов в админ-панели по введенному тексту.
 */
function filterAdminTags(query) {
    const listContainer = document.getElementById('admin-tags-list');
    if (!listContainer) return;

    const items = listContainer.querySelectorAll('.item');
    const normalizedQuery = query.toLowerCase().trim();

    items.forEach(item => {
        const tagName = item.dataset.tagName || ''; // Получаем имя из data-атрибута
        if (tagName.includes(normalizedQuery)) {
            item.style.display = 'flex'; // Показываем
        } else {
            item.style.display = 'none'; // Скрываем
        }
    });
}

// 1. Новая функция, которая создаёт красивое модальное окно
function showRoleChangeModal(userId, currentRole) {
    const roles = ['reader', 'creator', 'admin']; // Роль 'owner' нельзя назначить
    
    const optionsHtml = roles.map(role => 
        `<option value="${role}" ${role === currentRole ? 'selected' : ''}>
            ${getDisplayRoleName(role)}
        </option>`
    ).join('');

    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content prompt-modal">
            <h3>Изменение роли</h3>
            <p class="modal-text">Выберите новую роль для пользователя с ID: ${userId}</p>
            <select class="form-select" id="role-select">${optionsHtml}</select>
            <div class="modal-actions">
                <button class="btn btn-primary">Сохранить</button>
                <button class="btn btn-secondary">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    const cleanup = () => modal.remove();
    
    modal.querySelector('.btn-primary').onclick = async () => {
        const newRole = modal.querySelector('#role-select').value;
        cleanup();
        clearCache();
        
        // 2. Вызываем старую логику, но уже с выбранной ролью
        showLoading(true, { title: 'Изменение роли...' });
        try {
            const response = await apiPostRequest('updateUserRole', { user_id: userId, new_role: newRole });
            if (response.success) {
                showToast('Роль успешно изменена!', 'success');
                loadAdminData(); // Перезагружаем данные админки
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            showToast('Ошибка: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    };
    
    modal.querySelector('.btn-secondary').onclick = cleanup;
}

/**
 * Открывает модальное окно для редактирования тега.
 */
function openEditTagModal(tagId, tagName, buttonElement) {
    // Находим родительский элемент .item, чтобы добраться до описания
    const itemElement = buttonElement.closest('.item');
    const descriptionElement = itemElement.querySelector('.item-description');
    // Получаем полное описание из data-атрибута или пусто, если элемента нет
    const currentDescription = descriptionElement ? descriptionElement.dataset.fullDescription || '' : '';

    // Удаляем старое модальное окно, если оно есть
    const existingModal = document.getElementById('edit-tag-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Создаем новое модальное окно
    const modal = document.createElement('div');
    modal.id = 'edit-tag-modal';
    modal.className = 'modal show visible'; // Классы для показа
    modal.innerHTML = `
        <div class="modal-content">
            <button class="close-btn" onclick="document.getElementById('edit-tag-modal').remove()">×</button>
            <h3>Редактирование тега</h3>
            <input type="hidden" id="edit-tag-id" value="${tagId}">

            <div class="form-group">
                <label for="edit-tag-name">Название *</label>
                <input type="text" id="edit-tag-name" class="form-input" value="${escapeHtml(tagName)}" required>
            </div>

            <div class="form-group">
                <label for="edit-tag-description">Описание</label>
                <textarea id="edit-tag-description" class="form-textarea" rows="4">${escapeHtml(currentDescription)}</textarea>

            <div class="modal-actions">
                <button class="btn btn-primary" onclick="handleUpdateTag()">Сохранить</button>
                <button class="btn btn-secondary" onclick="document.getElementById('edit-tag-modal').remove()">Отмена</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Фокус на поле названия
    const nameInput = document.getElementById('edit-tag-name');
    if (nameInput) {
        nameInput.focus();
        nameInput.select(); // Выделяем текст для удобства
    }
}

// 3. Старую функцию `editUserRole` теперь просто заменяем на вызов новой
function editUserRole(userId, currentRole) {
    showRoleChangeModal(userId, currentRole);
}

async function handleRoleThemeChange(selectElement) {
    const newTheme = selectElement.value;
    showLoading(true, { title: 'Смена темы ролей...' });
    try {
        const response = await apiPostRequest('setRoleTheme', { theme: newTheme });
        if (response.success) {
            showToast('Тема ролей успешно изменена!', 'success');
            // Обновляем состояние на клиенте, чтобы сразу видеть изменения
            STATE.currentRoleTheme = newTheme;
            // Можно перезагрузить админку для чистоты
            loadAdminData();
        } else {
            throw new Error(response.error);
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Сохраняет глобальные лимиты из админ-панели
 */
async function handleSaveGlobalSettings() {
    const personalLimit = document.getElementById('global-limit-personal').value;
    const communityLimit = document.getElementById('global-limit-community').value;

    showLoading(true, { title: 'Сохранение лимитов...' });
    try {
        const response = await apiPostRequest('setGlobalLimits', { 
            personalLimit: personalLimit, 
            communityLimit: communityLimit 
        });
        
        if (response.success) {
            showToast(response.message, 'success');
        } else {
            throw new Error(response.error);
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Обработчик для кнопки поиска
async function handleSearchUsers() {
    const query = document.getElementById('user-search-input').value;
    showLoading(true, { title: 'Поиск...' });
    try {
        const response = await apiRequest('searchUsers', { query });
        if (response.success) {
            const tableBody = document.querySelector('#admin-tab-users tbody');
            if (tableBody) {
                tableBody.innerHTML = renderUsersTableRows(response.users);
            }
        } else { 
            throw new Error(response.error); 
        }
    } catch (error) {
        showToast('Ошибка поиска: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Обработчик для кнопки удаления
function handleDeleteUser(userId, username) {
    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите НАВСЕГДА удалить пользователя "${username}" (ID: ${userId})? Это действие необратимо.`,
        async () => {
            showLoading(true, { title: 'Удаление пользователя...' });
            try {
                const response = await apiPostRequest('deleteUser', { user_id: userId });
                if (response.success) {
                    showToast(response.message, 'success');
                    loadAdminData(); // Обновляем всю админку
                } else { throw new Error(response.error); }
            } catch (error) {
                showToast('Ошибка удаления: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

async function addGenre() {
    const input = document.getElementById('new-genre-input');
    // 1. Находим поле с описанием
    const descInput = document.getElementById('new-genre-desc'); 
    
    const name = input?.value.trim();
    // 2. Считываем описание (или ставим пустую строку, если оно не заполнено)
    const description = descInput?.value.trim() || ''; 
    
    if (!name) {
        showToast('Введите название жанра', 'warning');
        return;
    }
    
    try {
        // 3. Отправляем оба поля на сервер
        const response = await apiPostRequest('addGenre', { name, description }); 
        
        if (response.success) {
            showToast('Жанр добавлен', 'success');
            input.value = '';
            descInput.value = ''; // 4. Очищаем оба поля
            clearCache();
            loadAdminData();
        } else {
            throw new Error(response.error || 'Ошибка');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    }
}

async function deleteGenre(id) {
    showConfirmModal(
        'Удаление жанра', // Заголовок
        'Вы уверены, что хотите удалить этот жанр?', // Сообщение
        async () => {
            // Этот код выполнится только если пользователь нажмёт "Да"
            try {
                const response = await apiPostRequest('deleteGenre', { id });
                
                if (response.success) {
                    showToast('Жанр удалён', 'success');
                    clearCache();
                    loadAdminData();
                } else {
                    throw new Error(response.error || 'Ошибка');
                }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            }
        }
    );
}

/**
 * Обработчик добавления тега с проверкой дублей и индикатором загрузки.
 */
async function handleAddTag() {
    const input = document.getElementById('new-tag-input');
    const descInput = document.getElementById('new-tag-desc');
    const name = input?.value.trim();
    const description = descInput?.value.trim() || '';

    if (!name) {
        showToast('Введите название тега', 'warning');
        return;
    }

    // --- Клиентская проверка на дубликат ---
    const existingTags = Array.from(document.querySelectorAll('#admin-tab-tags .item span'))
                              .map(span => span.textContent.trim().toLowerCase());
    if (existingTags.includes(name.toLowerCase())) {
        showToast(`Тег "${name}" уже существует`, 'warning');
        return;
    }
    // --- Конец проверки ---

    showLoading(true, { title: 'Добавление тега...' }); // Показываем спиннер
    try {
        const response = await apiPostRequest('addTag', { name, description });
        if (response.success) {
            showToast('Тег добавлен', 'success');
            if (input) input.value = '';
            if (descInput) descInput.value = '';
            clearCache(); // Очищаем кэш
            await loadAdminData(); // Перезагружаем данные админки
        } else {
            throw new Error(response.error || 'Ошибка добавления тега');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false); // Прячем спиннер
    }
}

/**
 * Обрабатывает сохранение изменений тега из модального окна.
 */
async function handleUpdateTag() {
    const id = document.getElementById('edit-tag-id').value;
    const nameInput = document.getElementById('edit-tag-name');
    const descriptionInput = document.getElementById('edit-tag-description');

    const name = nameInput?.value.trim();
    const description = descriptionInput?.value.trim() || '';

    if (!name) {
        showToast('Название тега не может быть пустым', 'warning');
        if (nameInput) nameInput.focus(); // Фокус на поле
        return;
    }

    showLoading(true, { title: 'Сохранение изменений...' });

    try {
        // Вызываем действие updateTag на сервере
        const response = await apiPostRequest('updateTag', { id, name, description });

        if (response.success) {
            showToast('Тег успешно обновлен', 'success');
            document.getElementById('edit-tag-modal')?.remove(); // Закрываем модалку
            clearCache(); // Очищаем кэш
            await loadAdminData(); // Перезагружаем данные админки
        } else {
            throw new Error(response.error || 'Ошибка обновления тега');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Обработчик удаления тега с подтверждением и индикатором загрузки.
 */
function handleDeleteTag(id, name) {
    showConfirmModal(
        'Удаление тега',
        `Вы уверены, что хотите удалить тег "${escapeHtml(name)}"? Он будет помечен как неактивный.`,
        async () => {
            showLoading(true, { title: 'Удаление тега...' }); // Показываем спиннер
            try {
                const response = await apiPostRequest('deleteTag', { id });
                if (response.success) {
                    showToast('Тег удалён (помечен неактивным)', 'success');
                    clearCache(); // Очищаем кэш
                    await loadAdminData(); // Перезагружаем данные админки
                } else {
                    throw new Error(response.error || 'Ошибка удаления тега');
                }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false); // Прячем спиннер
            }
        }
    );
}

function updateDatabaseStructure() {
    showConfirmModal(
        'Обновление структуры БД',
        'Вы уверены, что хотите обновить структуру базы данных? Это безопасная операция.',
        async () => {
            showLoading(true, { title: 'Обновление БД' });
            try {
                // ✨ ИЗМЕНЕНИЕ ЗДЕСЬ: используем apiRequest вместо apiPostRequest
                const response = await apiRequest('updateDatabaseStructure', {});
                
                if (response.success) {
                    // Используем сообщение от сервера, оно теперь умное!
                    showToast(response.message, 'success');
                } else {
                    throw new Error(response.error || 'Ошибка');
                }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

function clearDatabaseConfirm() {
    // Первое подтверждение
    showConfirmModal(
        'Очистка базы данных',
        'ВНИМАНИЕ! Это действие удалит ВСЕ новеллы, главы, жанры и теги. Вы уверены?',
        () => {
            // Если нажали "Да", показываем второе, более страшное окно
            showConfirmModal(
                'Окончательное подтверждение',
                'Вы АБСОЛЮТНО уверены? Данные будет невозможно восстановить. Это действие необратимо.',
                async () => {
                    // Если и здесь нажали "Да", выполняем опасное действие
                    showLoading(true, { title: 'Очистка БД' });
                    
                    try {
                        const response = await apiPostRequest('clearDatabase', {});
                        
                        if (response.success) {
                            showToast('База данных очищена', 'success');
                            clearCache();
                            setTimeout(() => location.reload(), 2000);
                        } else {
                            throw new Error(response.error || 'Ошибка');
                        }
                    } catch (error) {
                        showToast('Ошибка: ' + error.message, 'error');
                    } finally {
                        showLoading(false);
                    }
                }
            );
        }
    );
}

function clearDriveFolderConfirm() {
    // Первое подтверждение
    showConfirmModal(
        'Очистка папки Drive',
        'ВНИМАНИЕ! Это действие удалит ВСЕ файлы новелл из папки на Google Drive. Продолжить?',
        () => {
            // Второе подтверждение
            showConfirmModal(
                'Окончательное подтверждение',
                'Вы ТОЧНО уверены? Эта операция затронет все созданные новеллы.',
                async () => {
                    // Основная логика
                    showLoading(true, { title: 'Очистка Drive' });
                    
                    try {
                        const response = await apiPostRequest('clearDriveFolder', {});
                        
                        if (response.success) {
                            showToast('Папка Drive очищена', 'success');
                        } else {
                            throw new Error(response.error || 'Ошибка');
                        }
                    } catch (error) {
                        showToast('Ошибка: ' + error.message, 'error');
                    } finally {
                        showLoading(false);
                    }
                }
            );
        }
    );
}

function handleCleanupSessions() {
    showConfirmModal(
        'Очистка старых сессий',
        'Вы уверены, что хотите удалить все истёкшие сессии пользователей? Это заставит неактивных пользователей заново войти в систему.',
        async () => {
            showLoading(true, { title: 'Очистка сессий...' });
            try {
                const response = await apiRequest('cleanupSessions'); // Используем apiRequest
                if (response.success) {
                    showToast(`Удалено истёкших сессий: ${response.deletedCount}`, 'success');
                } else { throw new Error(response.error); }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

function clearDataConfirm() {
    showConfirmModal(
        'ПОЛНАЯ ОЧИСТКА ДАННЫХ',
        'ВНИМАНИЕ! Это действие удалит ВСЕ новеллы, главы, авторов, жанры и теги. Таблицы пользователей и сессий останутся. Это действие НЕОБРАТИМО. Вы абсолютно уверены?',
        async () => {
            showLoading(true, { title: 'Очистка данных...' });
            try {
                const response = await apiPostRequest('clearAllDataExceptUsers', {});
                if (response.success) {
                    showToast(response.message, 'success');
                    setTimeout(() => location.reload(), 2000);
                } else { throw new Error(response.error); }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

// Закрытие модальных окон по ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(modal => {
            hideModal(modal.id);
        });
    }
});

// ==========================================
// ЗАГРУЗКА ДАННЫХ
// ==========================================

async function loadNovels() {
    try {
        const response = await apiRequest('getAllNovels');
        
        if (response.success) {
            STATE.novels = response.novels || [];
            STATE.filteredNovels = STATE.novels;
            console.log('Загружено новелл:', STATE.novels.length);
        }
    } catch (error) {
        console.error('Ошибка загрузки новелл:', error);
        STATE.novels = [];
        STATE.filteredNovels = [];
    }
}

async function loadConfig() {
    try {
        const response = await apiRequest('getConfig');
        
        if (response.success) {
            STATE.config = response.config || {};
        }
    } catch (error) {
        console.error('Ошибка загрузки конфигурации:', error);
    }
}

async function loadUser() {
    try {
        // Токен уже передаётся в apiRequest автоматически!
        const response = await apiRequest('getCurrentUser');
        
        if (response.success && response.user && response.user.auth_type !== 'anonymous') {
            STATE.currentUser = response.user;
            console.log('Текущий пользователь:', STATE.currentUser.username, 'Роль:', STATE.currentUser.role);
            updateUserDisplay();
        } else {
            STATE.currentUser = null;
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        STATE.currentUser = null;
    }
}

async function loadGenresAndTags() {
    try {
        const response = await apiRequest('getGenresAndTags');
        
        if (response.success) {
            STATE.genresAndTags = {
                genres: response.genres || [],
                tags: response.tags || []
            };
        }
    } catch (error) {
        console.error('Ошибка загрузки жанров/тегов:', error);
    }
}


// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================

/**
 * ✨ FINAL - Полная, правильная и оптимизированная функция инициализации
 */
async function initializeApp() {
    if (STATE.isInitialized) return;
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
                    pageContainer.innerHTML = `
                      <div class="page-loading-animation">
                          <div class="book">
                              <div class="book__pg-shadow"></div>
                              <div class="book__pg"></div>
                              <div class="book__pg book__pg--2"></div>
                              <div class="book__pg book__pg--3"></div>
                              <div class="book__pg book__pg--4"></div>
                              <div class="book__pg book__pg--5"></div>
                          </div>
                          <p>Загрузка...</p>
                      </div>`;
                }
                // ✨ КОНЕЦ ИСПРАВЛЕНИЯ ✨
            }
        }

    // --- ЭТАП 2: ЕДИНЫЙ ЗАПРОС ДАННЫХ ---
    try {
        // ✨ ДЕЛАЕМ ВСЕГО ОДИН ЗАПРОС ВМЕСТО ЧЕТЫРЁХ! ✨
        const response = await apiRequest('getInitialData');
        if (!response.success) throw new Error(response.error);

        // Раскладываем полученные данные по своим местам
        STATE.currentUser = (response.user && response.user.user_id !== null && response.user.user_id !== undefined) ? response.user : null;
        STATE.novels = response.novels;
        STATE.filteredNovels = response.novels;
        STATE.config = response.config;
        STATE.genresAndTags = response.genresAndTags;
        STATE.currentRoleTheme = response.roleTheme || 'default';

        // --- ЭТАП 3: ФИНАЛЬНАЯ ОТРИСОВКА ---
        updateUserDisplay();
        setupSearchAutocomplete();

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
        showToast('Критическая ошибка загрузки данных', 'error');
    }
}

// ==========================================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ==========================================

function setupEventListeners() {
    // Поиск
    bindClick('search-btn', performSearch);
    
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
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
    bindClick('add-novel-btn', () => navigateTo('add-novel'));
    bindClick('admin-btn', openAdminPanel);
    
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
        if (e.ctrlKey && e.key === 'n' && STATE.currentUser) {
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

function performSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    
    const query = input.value.toLowerCase().trim();
    
    if (!query) {
        STATE.filteredNovels = [];
        STATE.currentPage = 1;
        renderNovelsGrid(STATE.novels);
        renderPagination();
        return;
    }
    
    STATE.filteredNovels = STATE.novels.filter(novel => 
        novel.title.toLowerCase().includes(query) ||
        novel.author.toLowerCase().includes(query) ||
        (novel.description && novel.description.toLowerCase().includes(query))
    );
    
    STATE.currentPage = 1;
    renderNovelsGrid(STATE.filteredNovels);
    renderPagination();
}

// ==========================================
// УТИЛИТЫ
// ==========================================

function showSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

function hideSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

/**
 * Показывает/скрывает оверлей загрузки.
 * @param {boolean} show - Показать или скрыть.
 * @param {object} options - Опции:
 * - title {string}: Заголовок для стандартного окна.
 * - description {string}: Описание для стандартного окна.
 * - progress {boolean}: Показать прогресс-бар.
 * - animationType {string}: 'bubbles' или 'book' для показа кастомной анимации ВМЕСТО стандартного окна.
 */
function showLoading(show, options = {}) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;

    // Показываем/скрываем сам оверлей (темный фон)
    overlay.style.display = show ? 'flex' : 'none';

    if (show) {
        // Очищаем предыдущее содержимое
        overlay.innerHTML = '';

        // --- КЛЮЧЕВОЕ РЕШЕНИЕ: Что показать? ---
        if (options.animationType) {
            // ПОКАЗЫВАЕМ КАСТОМНУЮ АНИМАЦИЮ
            overlay.innerHTML = '<div id="custom-loading-animation"></div>'; // Контейнер для анимации
            overlay.classList.add('custom-animation-mode'); // Добавляем класс для стилизации фона, если нужно

            // Вызываем нужную функцию для отрисовки анимации
            if (options.animationType === 'bubbles') {
                showBubbleLoadingAnimation(); // Новое имя функции
            } else if (options.animationType === 'book') {
                showBookLoadingAnimation(); // Новое имя функции
            }
            // Можно добавить другие типы анимации
        } else {
            // ПОКАЗЫВАЕМ СТАНДАРТНОЕ ОКНО
            overlay.classList.remove('custom-animation-mode'); // Убираем класс кастомной анимации
            overlay.innerHTML = `
                <div class="loading-box">
                    <div class="loading-spinner-large"></div>
                    <h3 id="loading-title">${options.title || 'Загрузка...'}</h3>
                    <p id="loading-description">${options.description || ''}</p>
                    ${options.progress ? `
                        <div class="progress-container" id="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
                            </div>
                            <span id="progress-text">0%</span>
                        </div>` : ''}
                </div>
            `;
            // Обновляем прогресс, если нужно
            if (options.progress) {
                updateProgress(0, options.description || '');
            }
        }
    } else {
        // При скрытии просто очищаем
        overlay.classList.remove('custom-animation-mode');
        overlay.innerHTML = '';
    }
}

/**
 * Обновление прогресс-бара
 * @param {number} percent - Процент выполнения (0-100)
 * @param {string} text - Текст статуса
 */
function updateProgress(percent, text = '') {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const loadingDesc = document.getElementById('loading-description');
    
    if (progressFill) {
        progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    
    if (progressText) {
        progressText.textContent = `${Math.round(percent)}%`;
    }
    
    if (text && loadingDesc) {
        loadingDesc.textContent = text;
    }
}

/**
 * Исправленная версия: Получает красивое название роли.
 * Теперь она всегда проверяет актуальную тему из STATE.
 */
function getDisplayRoleName(role) {
    // 1. Берем тему из STATE, которую мы получили от сервера в initializeApp
    const currentThemeName = STATE.currentRoleTheme || 'default';
    
    // 2. Ищем объект темы в справочнике ROLE_THEMES (он у тебя в начале script.js)
    const theme = ROLE_THEMES[currentThemeName] || ROLE_THEMES['default'];
    
    // 3. Возвращаем перевод для конкретной роли
    return theme[role] || role; 
}

// ==========================================
// КАСТОМНЫЕ АНИМАЦИИ ЗАГРУЗКИ
// ==========================================

/**
 * ✨ UPDATED v3: Увеличивает размытие и затемняет размытые пузырьки.
 */
function showBubbleLoadingAnimation() {
    const container = document.querySelector('#loading-overlay #custom-loading-animation');
    if (!container){
        console.error("Контейнер #custom-loading-animation не найден внутри #loading-overlay!");
        return;
    }

    let bubblesHtml = '<div class="bubbles-container">';

    const bubbleCount = 50; // Оставляем 50
    const blurProbability = 0.4; // Оставляем 40%
    // ✨ 1. Увеличиваем силу размытия ✨
    const blurAmount = '4px';  // Попробуем 3px (было 1.5px)

    for (let i = 0; i < bubbleCount; i++) {
        const size = 5 + Math.random() * 25;
        const left = Math.random() * 100;
        const delay = Math.random() * 5;
        const duration = 5 + Math.random() * 5;
        let opacity = 0.1 + Math.random() * 0.3; // Начальная прозрачность

        let individualStyle = '';

        if (Math.random() < blurProbability) {
            individualStyle += `filter: blur(${blurAmount});`;
            // ✨ 2. Затемняем: Уменьшаем opacity еще сильнее для размытых ✨
            opacity = Math.max(0.02, opacity * 0.4); // Уменьшаем на 60%, минимум 0.02 (было * 0.7)
        }

        bubblesHtml += `
            <div class="bubble" style="
                left: ${left}%;
                width: ${size}px;
                height: ${size}px;
                opacity: ${opacity};
                animation-delay: ${delay}s;
                animation-duration: ${duration}s;
                ${individualStyle}
            "></div>`;
    }
    bubblesHtml += '</div>';

    container.innerHTML = bubblesHtml;
}

/**
 * Анимация рыбок для загрузки (для проекта "Логово Солёной Рыбки")
 */
function showFishLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    
    const loadingBox = overlay.querySelector('.loading-box');
    if (!loadingBox) return;
    
    loadingBox.classList.add('fish-loading');
    
    // Создаём рыбок
    const fishContainer = document.createElement('div');
    fishContainer.className = 'fish-container';
    
    const fishes = ['🐟', '🐠', '🐡', '🦈', '🐙'];
    
    for (let i = 0; i < 5; i++) {
        const fish = document.createElement('div');
        fish.className = 'swimming-fish';
        fish.textContent = fishes[i % fishes.length];
        fish.style.top = `${20 + i * 15}%`;
        fish.style.animationDelay = `${i * 0.5}s`;
        fish.style.animationDuration = `${4 + Math.random() * 2}s`;
        fishContainer.appendChild(fish);
    }
    
    loadingBox.appendChild(fishContainer);
}

/**
 * Добавляет анимацию книги в контейнер кастомной загрузки.
 */
function showBookLoadingAnimation() {
    const container = document.getElementById('custom-loading-animation');
    if (!container) return;

    // HTML для анимации книги (из CSS)
    container.innerHTML = `
        <div class="page-loading-animation" style="min-height: auto;"> <div class="book">
                <div class="book__pg-shadow"></div>
                <div class="book__pg"></div>
                <div class="book__pg book__pg--2"></div>
                <div class="book__pg book__pg--3"></div>
                <div class="book__pg book__pg--4"></div>
                <div class="book__pg book__pg--5"></div>
            </div>
            <p style="margin-top: 1rem;">Загрузка...</p> </div>
    `;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.log(`🔔 [${type}]:`, message);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num) return '0';
    return new Intl.NumberFormat('ru-RU').format(num);
}

function formatChapterText(text) {
    if (!text) return '';
    return text.split('\n')
        .map(p => p.trim() === '' ? '<br>' : `<p>${escapeHtml(p)}</p>`)
        .join('');
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return escapeHtml(text);
    return escapeHtml(text.substring(0, maxLength)) + '...';
}

function getNounEnding(number, one, two, five) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
}

function makeLinksClickable(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escapeHtml(text).replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function normalizeChapterNumber(number) {
    const num = parseFloat(number);
    return isNaN(num) ? 0 : num;
}

function updateUserDisplay() {
    const loginBtn = document.getElementById('login-btn');
    const userInfoBlock = document.getElementById('user-info');
    const adminBtn = document.getElementById('admin-btn');

    if (!loginBtn || !userInfoBlock) {
        console.error("UI elements not found!");
        return;
    }

    if (STATE.currentUser) {
        // Показываем профиль
        loginBtn.style.display = 'none';
        userInfoBlock.style.display = 'flex';
        
        // Обновляем имя и аватар
        const userNameEl = document.getElementById('user-name');
        const userAvatarEl = document.getElementById('user-avatar');
        
        if (userNameEl) userNameEl.textContent = STATE.currentUser.username;
        if (userAvatarEl) userAvatarEl.textContent = STATE.currentUser.username[0].toUpperCase();
        
        // Управление кнопками на основе ролей
        const role = STATE.currentUser.role;
        
        // Админ панель
        if (adminBtn) {
            adminBtn.style.display = (role === 'admin' || role === 'owner') ? 'inline-flex' : 'none';
        }
        
        // Добавляем классы к документу для CSS
        document.documentElement.setAttribute('data-user-role', role);
        if (role === 'admin' || role === 'owner') {
            document.documentElement.classList.add('is-admin');
        }
        if (['creator', 'admin', 'owner'].includes(role)) {
            document.documentElement.classList.add('can-create');
        }

        // ✨ Обновление аватара в ШАПКЕ ✨
        const userAvatarHeader = document.querySelector('#user-info .user-icon'); // Найди элемент для аватара в шапке
        if (userAvatarHeader) {
            if (STATE.currentUser.avatar_url) {
                // Если есть URL, создаем img
                let avatarUrl = escapeHtml(STATE.currentUser.avatar_url);
                if (avatarUrl.includes('drive.google.com/thumbnail')) {
                    avatarUrl += '&t=' + new Date().getTime(); // Добавляем cache-buster
                }
                userAvatarHeader.innerHTML = `<img src="\${avatarUrl}" alt="Аватар" class="header-avatar-image" onerror="this.onerror=null; this.src=''; this.innerHTML='👤';">`; // Используй свой класс для стилей
            } else {
                // Иначе показываем заглушку
                userAvatarHeader.innerHTML = '(°ロ°) !'; // Твоя заглушка
            }
        }
        // ✨ Конец обновления аватара в шапке ✨
        
    } else {
        // Неавторизован
        loginBtn.style.display = 'inline-flex';
        userInfoBlock.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';

        const userAvatarHeader = document.querySelector('#user-info .user-icon');
        if (userAvatarHeader) userAvatarHeader.innerHTML = '(°ロ°) !'; // Возвращаем заглушку
        
        // Убираем классы
        document.documentElement.classList.remove('is-admin', 'can-create');
        document.documentElement.removeAttribute('data-user-role');
    }
}

function checkUserPermission(action, novel) {
    if (!STATE.currentUser) return false;
    
    const userId = STATE.currentUser.user_id;
    const role = STATE.currentUser.role;
    
    // Владелец может всё
    if (userId === 0 || role === 'owner') return true;
    
    // Админы могут всё
    if (role === 'admin') return true;
    
    // Создатель может редактировать свою новеллу
    if (action === 'edit' && novel && novel.creator_id === userId) return true;
    
    // Создатели могут создавать новое
    if (action === 'create' && (role === 'creator' || role === 'admin')) return true;
    
    return false;
}

function toggleThemeMode() {
    const newMode = currentThemeMode === 'light' ? 'dark' : 'light';
    applyTheme(currentThemePalette, newMode);
}

/**
 * Применяет выбранную палитру и режим
 * @param {string} palette - Название палитры (classic, sunset, etc.)
 * @param {string} mode - Режим (light или dark)
 */
function applyTheme(palette, mode) {
    const html = document.documentElement;
    html.setAttribute('data-theme', palette);
    html.setAttribute('data-mode', mode);

    // Обновляем иконку на кнопке
    const icon = document.querySelector('.theme-icon');
    if (icon) {
        icon.textContent = mode === 'dark' ? '☀️' : '🌙';
    }

    // ✨ НОВОЕ: Обновляем кнопку в панели настроек чтения (если она открыта) ✨
    const readerThemeBtn = document.getElementById('reader-theme-toggle-btn');
    if (readerThemeBtn) {
        readerThemeBtn.textContent = mode === 'dark' ? 'Тема: Светлая ☀️' : 'Тема: Тёмная 🌙';
    }
    // ✨ КОНЕЦ ✨

    // Сохраняем выбор
    localStorage.setItem('novel-library-theme', palette);
    localStorage.setItem('novel-library-mode', mode);

    // Обновляем глобальные переменные
    currentThemePalette = palette;
    currentThemeMode = mode;
}

/**
 * Устанавливает новую палитру, сохраняя текущий режим
 * @param {string} newPalette - Название новой палитры
 */
function setThemePalette(newPalette) {
    applyTheme(newPalette, currentThemeMode);
}

function applyAutoTheme() {
    const hour = new Date().getHours();
    // С 7 утра до 7 вечера - светлая, иначе - тёмная
    if (hour > 7 && hour < 19) {
        applyTheme('light');
    } else {
        applyTheme('dark');
    }
}

// ✨ Добавляем новые обработчики событий
// Эту функцию нужно вызвать один раз внутри setupEventListeners()
function setupThemeSwitcher() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeMenu = document.getElementById('theme-menu');
    if (!themeToggleBtn || !themeMenu) return;

    let longPressTimer;

    // ОБЫЧНЫЙ КЛИК: переключение light/dark
    themeToggleBtn.addEventListener('click', toggleThemeMode);

    // ПРАВЫЙ КЛИК (для ПК): открывает меню палитр
    themeToggleBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Отменяем стандартное меню браузера
        themeMenu.classList.toggle('hidden');
    });

    // ДОЛГОЕ НАЖАТИЕ (для телефонов): открывает меню палитр
    themeToggleBtn.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
            e.preventDefault();
            themeMenu.classList.toggle('hidden');
        }, 500); // 500 мс = 0.5 секунды
    });

    themeToggleBtn.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
    });

    // Закрываем меню, если кликнуть куда-то еще
    document.addEventListener('click', (e) => {
        if (!themeToggleBtn.contains(e.target) && !themeMenu.contains(e.target)) {
            themeMenu.classList.add('hidden');
        }
    });

    // Обработчики для кнопок внутри меню палитр
    document.querySelectorAll('.theme-option').forEach(button => {
        button.addEventListener('click', () => {
            const newPalette = button.dataset.theme;
            setThemePalette(newPalette);
            themeMenu.classList.add('hidden'); // Закрываем меню после выбора
        });
    });
}

function setupTagsInput(inputId, containerId, availableItems = []) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);

    if (!input || !container) {
        return; // Просто выходим, если элементы не найдены
    }

    // Используем 'keydown'
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault(); // Предотвращаем стандартное поведение Enter
            const value = this.value.trim();
            if (value) {
                addTag(value, container); // Добавляем плашку
                this.value = '';         // Очищаем поле
            }
        }
    });
}

function addTag(value, container) {
    // Проверяем на дубликат
    const existing = Array.from(container.querySelectorAll('.selected-tag'))
        .find(tag => tag.dataset.value === value);
    
    if (existing) {
        showToast('Уже добавлено', 'warning');
        return;
    }
    
    const tag = document.createElement('span');
    tag.className = 'selected-tag';
    tag.dataset.value = value;
    tag.innerHTML = `
        ${escapeHtml(value)} 
        <button type="button" onclick="removeTag(this)" class="remove-tag-btn">×</button>
    `;
    
    container.appendChild(tag);
}

function removeTag(button) {
    button.parentElement.remove();
}

async function checkNovelExists(title, author, excludeId = null) {
    const existing = STATE.novels.find(novel => 
        novel.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        novel.author.toLowerCase().trim() === author.toLowerCase().trim() &&
        novel.novel_id !== excludeId
    );
    return !!existing;
}

/**
 * ✨ NEW: Настраивает поле ввода альтернативных названий при загрузке формы
 */
function setupAltTitlesInput() {
    const hiddenInput = document.getElementById('novel-alt-titles');
    const container = document.getElementById('alt-titles-container');
    const inputField = document.getElementById('alt-title-input');

    if (!hiddenInput || !container || !inputField) return;

    // Заполняем контейнер плашками из скрытого поля при загрузке
    const initialTitles = hiddenInput.value.split('|').map(t => t.trim()).filter(Boolean);
    initialTitles.forEach(title => createAltTitleTag(title, container, hiddenInput));

    // Добавление по Enter
    inputField.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAltTitleTag();
        }
    });
}

/**
 * ✨ NEW: Добавляет тег альтернативного названия
 */
function addAltTitleTag() {
    const inputField = document.getElementById('alt-title-input');
    const container = document.getElementById('alt-titles-container');
    const hiddenInput = document.getElementById('novel-alt-titles');

    if (!inputField || !container || !hiddenInput) return;

    const value = inputField.value.trim();
    if (value) {
        // Проверяем на дубликат
        const currentTitles = hiddenInput.value.split('|').map(t => t.trim().toLowerCase());
        if (currentTitles.includes(value.toLowerCase())) {
            showToast('Такое название уже добавлено', 'warning');
            return;
        }

        createAltTitleTag(value, container, hiddenInput);
        inputField.value = ''; // Очищаем поле ввода
        updateHiddenAltTitlesInput(container, hiddenInput); // Обновляем скрытое поле
    }
}

/**
 * ✨ NEW: Создает DOM-элемент (плашку) для альтернативного названия
 */
function createAltTitleTag(value, container, hiddenInput) {
    const tag = document.createElement('span');
    tag.className = 'selected-tag alt-title-tag'; // Добавляем доп. класс для стилизации, если нужно
    tag.dataset.value = value;
    tag.innerHTML = `
        ${escapeHtml(value)}
        <button type="button" onclick="removeAltTitleTag(this)" class="remove-tag-btn">×</button>
    `;
    container.appendChild(tag);
}


/**
 * ✨ NEW: Удаляет тег альтернативного названия
 */
function removeAltTitleTag(button) {
    const container = document.getElementById('alt-titles-container');
    const hiddenInput = document.getElementById('novel-alt-titles');
    button.parentElement.remove();
    if (container && hiddenInput) {
        updateHiddenAltTitlesInput(container, hiddenInput); // Обновляем скрытое поле
    }
}

/**
 * ✨ NEW: Обновляет значение скрытого input'а на основе плашек в контейнере
 */
function updateHiddenAltTitlesInput(container, hiddenInput) {
    const titles = Array.from(container.querySelectorAll('.selected-tag'))
        .map(tag => tag.dataset.value.trim()) // Собираем значения из data-атрибутов
        .filter(Boolean); // Убираем пустые
    hiddenInput.value = titles.join(' | '); // Соединяем через |
}

async function checkChapterNumberExists(novelId, chapterNumber, excludeId = null) {
    try {
        // Вызываем специальное действие 'checkChapterNumber' на сервере
        const response = await apiRequest('checkChapterNumber', {
            novel_id: novelId,
            chapter_number: chapterNumber,
            exclude_chapter_id: excludeId
        }, true); // true - чтобы пропустить кэш и получить свежие данные

        // Сервер напрямую возвращает true или false в поле 'exists'
        if (response.success) {
            return response.exists;
        }
        return false; // В случае ошибки считаем, что дубликата нет

    } catch (error) {
        console.error('Ошибка проверки номера главы:', error);
        return false; // Безопасное значение по умолчанию
    }
}

function handleDeleteNovel(novelId) {
    showConfirmModal(
        '🗑️ Удаление новеллы',
        'Вы уверены? Новелла будет перемещена в корзину.\nВы сможете восстановить её из раздела "Созданные" в вашем профиле.',
        () => deleteNovel(novelId)
    );
}

/**
 * ✨ НОВАЯ УНИВЕРСАЛЬНАЯ ФУНКЦИЯ УДАЛЕНИЯ
 * Отправляет запрос на удаление новеллы (в корзину или навсегда).
 */
async function deleteNovel(novelId, permanent = false) {
    const loadingTitle = permanent ? 'Полное удаление...' : 'Перемещение в корзину...';
    showLoading(true, { title: loadingTitle });
    
    try {
        const response = await apiPostRequest('deleteNovel', { 
            novelId: novelId, 
            permanent: permanent // Теперь флаг передается правильно
        });
        
        if (response.success) {
            showToast(permanent ? 'Новелла удалена навсегда' : 'Новелла перемещена в корзину', 'success');
            clearCache();
            setTimeout(() => navigateTo('home'), 1000);
        } else {
            throw new Error(response.error || 'Ошибка удаления');
        }
    } catch (error) {
        showToast('Не удалось удалить: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * ✨ ОБНОВЛЕННАЯ ФУНКЦИЯ
 * Обработчик для удаления ошибочной записи. Теперь вызывает универсальную функцию.
 */
function handleErrorNovelClick(novelId) {
    // Останавливаем стандартное поведение, если клик был по ссылке
    if (event) event.preventDefault();
    
    showConfirmModal(
        'Ошибка создания новеллы',
        'При создании этой новеллы произошла ошибка. Хотите удалить эту запись навсегда и попробовать снова?',
        () => {
            // Пользователь нажал "Да", удаляем ошибочную запись навсегда
            deleteNovel(novelId, true); // true означает перманентное удаление
        }
    );
}

function handleDeleteChapter(chapterId, chapterTitle) {
    // ✨ ИЗМЕНЕНИЕ: Добавляем название в сообщение
    const title = chapterTitle ? ` "${chapterTitle}"` : '';
    showConfirmModal(
        '🗑️ Удаление главы',
        `Вы уверены, что хотите удалить главу${title}?\nОна будет перемещена в корзину.`,
        () => deleteChapter(chapterId) // Вызываем асинхронный хелпер
    );
}

async function deleteChapter(chapterId) {
    showLoading(true, { title: 'Удаление главы' });
    
    try {
        const response = await apiPostRequest('deleteChapter', { 
            chapterId: chapterId, 
            permanent: false 
        });
        
        if (response.success) {
            showToast('Глава перемещена в корзину', 'success');
            clearCache();
            location.reload(); // Перезагружаем страницу
        } else {
            throw new Error(response.error || 'Ошибка удаления');
        }
    } catch (error) {
        showToast('Не удалось удалить: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function toggleReadingSettings() {
    let panel = document.getElementById('reading-settings-panel');

    // Если панели нет, создаем ее
    if (!panel) {
       // --- ИЗМЕНЕНИЕ ЗДЕСЬ ---
        // Получаем ID главы из URL, чтобы передать в createReadingSettingsPanel
        const currentChapterId = new URLSearchParams(window.location.search).get('id');
        // Нам нужен ВЕСЬ объект главы, а не только ID.
        // Предполагаем, что он сохранен в window.currentChapterData (нужно будет сохранить его в renderChapterReadPage)
        if (window.currentChapterData) {
            createReadingSettingsPanel(window.currentChapterData); // Передаем объект главы
            panel = document.getElementById('reading-settings-panel');
        } else {
             console.error("Не найдены данные текущей главы для создания панели настроек.");
             return; // Не можем создать панель без данных
        }
        if (!panel) return;
    }

    const isVisible = panel.classList.toggle('show');

    // ✨ Убираем слушатель скролла отсюда, он мешал ✨
    // window.removeEventListener('scroll', closeSettingsOnScroll);

    if (isVisible) {
        // ✨ Добавляем слушатель БЕЗ capture (false) ✨
        // Небольшая задержка, чтобы не сработал на текущий клик по кнопке
        setTimeout(() => {
            document.addEventListener('click', closeSettingsOnClickOutside);
            console.log('Добавлен слушатель click для закрытия настроек');
        }, 0);
        // Добавляем слушатель скролла для закрытия (одноразовый)
        window.addEventListener('scroll', closeSettingsOnScroll, { once: true });

    } else {
        removeSettingsListeners(); // Убираем слушатели
    }
}

// Вспомогательная функция для закрытия по клику вне
function closeSettingsOnClickOutside(event) {
    const panel = document.getElementById('reading-settings-panel');
    const button = document.querySelector('.reader-header-right button'); // Находим кнопку настроек

    console.log('Клик вне настроек:', event.target); // Лог для отладки

    // Закрываем, если клик был не по панели и не по кнопке
    if (panel && button && !panel.contains(event.target) && !button.contains(event.target)) {
        console.log('Закрываем панель...');
        panel.classList.remove('show');
        removeSettingsListeners(); // Убираем слушатели
    }
}

// Вспомогательная функция для закрытия при скролле
function closeSettingsOnScroll() {
    const panel = document.getElementById('reading-settings-panel');
    if (panel) {
        panel.classList.remove('show');
        removeSettingsListeners();
    }
}

// Вспомогательная функция для удаления слушателей
function removeSettingsListeners() {
    // ✨ Убираем слушатель БЕЗ capture (false) ✨
    document.removeEventListener('click', closeSettingsOnClickOutside);
    window.removeEventListener('scroll', closeSettingsOnScroll); // Убираем и скролл
    console.log('Удалены слушатели click/scroll для закрытия настроек');
}

function createReadingSettingsPanel(chapter) { // Принимаем весь объект chapter
    const settings = getReadingSettings();
    const isReadInitially = chapter.isRead || false; // Получаем статус из данных главы

    // Получаем ID текущей главы и новеллы
    const currentChapterId = chapter.chapter_id;
    const currentNovelId = chapter.novel_id;

    const panel = document.createElement('div');
    panel.id = 'reading-settings-panel';
    panel.className = 'reading-settings-panel';

    // Определяем начальное состояние кнопок и сообщения
    const markUnreadDisplay = isReadInitially ? 'block' : 'none';
    const markReadDisplay = isReadInitially ? 'none' : 'block';
    const initialStatusMessage = isReadInitially ? 'Глава отмечена как прочитанная.' : 'Глава еще не прочитана.';

    panel.innerHTML = `
        <h3>⚙️ Настройки чтения</h3>

        <div class="setting-group">
            <label>Размер шрифта</label>
            <div class="font-size-controls">
                <button onclick="adjustFontSize(-2)">A-</button>
                <span id="font-size-display">${settings.fontSize}px</span>
                <button onclick="adjustFontSize(2)">A+</button>
            </div>
        </div>

        <div class="setting-group">
            <label>Шрифт</label>
            <select id="font-family-select" onchange="changeFontFamily(this.value)">
                <option value="default" ${settings.fontFamily === 'default' ? 'selected' : ''}>По умолчанию</option>
                <option value="serif" ${settings.fontFamily === 'serif' ? 'selected' : ''}>Serif</option>
                <option value="sans-serif" ${settings.fontFamily === 'sans-serif' ? 'selected' : ''}>Sans-serif</option>
                <option value="monospace" ${settings.fontFamily === 'monospace' ? 'selected' : ''}>Monospace</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Ширина текста</label>
            <select id="text-width-select" onchange="changeTextWidth(this.value)">
                <option value="narrow" ${settings.textWidth === 'narrow' ? 'selected' : ''}>Узкий</option>
                <option value="medium" ${settings.textWidth === 'medium' ? 'selected' : ''}>Средний</option>
                <option value="wide" ${settings.textWidth === 'wide' ? 'selected' : ''}>Широкий</option>
                <option value="full" ${settings.textWidth === 'full' ? 'selected' : ''}>На всю ширину</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Межстрочный интервал</label>
            <select id="line-height-select" onchange="changeLineHeight(this.value)">
                <option value="1.4" ${settings.lineHeight === '1.4' ? 'selected' : ''}>Узкий</option>
                <option value="1.6" ${settings.lineHeight === '1.6' ? 'selected' : ''}>Нормальный</option>
                <option value="1.8" ${settings.lineHeight === '1.8' ? 'selected' : ''}>Комфортный</option>
                <option value="2.0" ${settings.lineHeight === '2.0' ? 'selected' : ''}>Широкий</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Тема</label>
            <button class="btn btn-secondary btn-sm" id="reader-theme-toggle-btn" onclick="toggleThemeMode()" style="width: 100%;">
                ${currentThemeMode === 'dark' ? 'Тема: Светлая ☀️' : 'Тема: Тёмная 🌙'}
            </button>
        </div>

        <div class="setting-group">
            <label>Статус чтения</label>
            <button class="btn btn-secondary btn-sm" id="mark-as-unread-btn"
                    onclick="event.stopPropagation(); handleMarkAsUnread('${currentChapterId}', '${currentNovelId}')"
                    style="width: 100%; display: ${markUnreadDisplay};">
                ❌ Отметить непрочитанной
            </button>
            <button class="btn btn-success btn-sm" id="mark-as-read-btn-panel"
                    onclick="event.stopPropagation(); handleMarkAsRead('${currentChapterId}', '${currentNovelId}')"
                    style="width: 100%; display: ${markReadDisplay};">
                 ✔️ Отметить прочитанной
            </button>
            <p id="read-status-message" style="text-align: center; font-size: 0.85em; color: var(--text-secondary); margin-top: 0.5em;">
                ${initialStatusMessage}
            </p>
        </div>

        <div class="setting-group">
            <label>
                <input type="checkbox" id="auto-scroll"
                       ${settings.autoScroll ? 'checked' : ''}
                       onchange="toggleAutoScroll(this.checked)">
                Автопрокрутка
            </label>
        </div>

        <button class="btn btn-secondary btn-sm" onclick="resetReadingSettings()">
            Сбросить настройки
        </button>
    `;

    // Вставляем панель (как и раньше)
    const headerRight = document.querySelector('.reader-header-right');
    if (headerRight) {
         headerRight.appendChild(panel);
    } else {
         console.error("Could not find '.reader-header-right' to append settings panel.");
    }
}

function getReadingSettings() {
    const defaults = {
        fontSize: 18,
        fontFamily: 'default',
        textWidth: 'medium',
        lineHeight: '1.6',
        autoScroll: false
    };
    
    const saved = localStorage.getItem('reading-settings');
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
}

function saveReadingSettings(settings) {
    localStorage.setItem('reading-settings', JSON.stringify(settings));
}

function applyReadingSettings(settings) {
    const text = document.getElementById('chapter-text');
    if (!text) return;
    
    text.style.fontSize = settings.fontSize + 'px';
    text.style.lineHeight = settings.lineHeight;
    
    const fontFamilies = {
        default: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        serif: 'Georgia, "Times New Roman", serif',
        'sans-serif': 'Arial, Helvetica, sans-serif',
        monospace: '"Courier New", monospace'
    };
    text.style.fontFamily = fontFamilies[settings.fontFamily] || fontFamilies.default;
    
    const widths = {
        narrow: '600px',
        medium: '800px',
        wide: '1000px',
        full: '100%'
    };
    text.style.maxWidth = widths[settings.textWidth] || widths.medium;
}

function adjustFontSize(delta) {
    const settings = getReadingSettings();
    settings.fontSize = Math.max(12, Math.min(32, settings.fontSize + delta));
    
    const display = document.getElementById('font-size-display');
    if (display) display.textContent = settings.fontSize + 'px';
    
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeFontFamily(family) {
    const settings = getReadingSettings();
    settings.fontFamily = family;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeTextWidth(width) {
    const settings = getReadingSettings();
    settings.textWidth = width;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeLineHeight(height) {
    const settings = getReadingSettings();
    settings.lineHeight = height;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function toggleAutoScroll(enabled) {
    const settings = getReadingSettings();
    settings.autoScroll = enabled;
    saveReadingSettings(settings);
    
    if (enabled) {
        startAutoScroll();
    } else {
        stopAutoScroll();
    }
}

let autoScrollInterval = null;

function startAutoScroll() {
    stopAutoScroll();
    autoScrollInterval = setInterval(() => {
        window.scrollBy(0, 1);
    }, 50);
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

function resetReadingSettings() {
    localStorage.removeItem('reading-settings');
    const settings = getReadingSettings();
    applyReadingSettings(settings);
    
    document.getElementById('font-family-select').value = settings.fontFamily;
    document.getElementById('text-width-select').value = settings.textWidth;
    document.getElementById('line-height-select').value = settings.lineHeight;
    document.getElementById('auto-scroll').checked = settings.autoScroll;
    document.getElementById('font-size-display').textContent = settings.fontSize + 'px';
    
    showToast('Настройки сброшены', 'info');
}

//======================================================
// Отметить главу прочитаной/непрочитаной и прогресс бар
//======================================================

/**
 * ✨ ОБНОВЛЕНО: Отмечает главу прочитанной (вручную или автоматически)
 */
async function handleMarkAsRead(chapterId, novelId, isAutomatic = false) {
    // Используем ID кнопки ИЗ ПАНЕЛИ НАСТРОЕК
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');
    const markUnreadBtn = document.getElementById('mark-as-unread-btn'); // Нужна и вторая кнопка для обновления UI

    // Сначала проверка пользователя
    if (!STATE.currentUser) {
        // Показываем тост только при ручном вызове
        if (!isAutomatic) showToast('Для отслеживания прогресса нужно войти в систему', 'warning');
        return; // Выходим, если не авторизован
    }

    // Взаимодействуем с кнопкой только при ручном вызове
    if (!isAutomatic && markReadBtn) {
        markReadBtn.disabled = true;
        markReadBtn.textContent = 'Сохранение...';
    } else if (!isAutomatic && !markReadBtn) {
        console.warn("handleMarkAsRead вызван вручную, но кнопка 'mark-as-read-btn-panel' не найдена.");
        // Не показываем тост про вход, т.к. пользователь авторизован
    }

    try {
        const response = await apiPostRequest('markChapterRead', { chapter_id: chapterId });

        if (response.success) {
            // Обновляем локальный список ID
            if (window.readChapterIds && !window.readChapterIds.includes(chapterId)) {
                window.readChapterIds.push(chapterId);
            } else if (!window.readChapterIds) {
                window.readChapterIds = [chapterId]; // Инициализируем, если его не было
            }

            // Обновляем UI кнопок в панели (вызовется и для автомат. и для ручного)
            updateMarkReadUnreadButtons(chapterId);

            // Показываем тост только при ручном успешном вызове
            if (!isAutomatic) {
                showToast('Глава отмечена как прочитанная!', 'success');
            } else {
                 console.log(`Автоматическая отметка прочитанным для ${chapterId} успешна.`);
            }

            // Обновляем список глав на странице новеллы (если мы там)
            rerenderChapterListFromState();

            // Очищаем кэш новеллы
            delete STATE.cache.data[`getNovel_${JSON.stringify({id: novelId})}`];

        } else {
            throw new Error(response.error || 'Не удалось сохранить прогресс');
        }
    } catch (error) {
         // Показываем ошибку только при ручном вызове
        if (!isAutomatic) {
            showToast('Ошибка: ' + error.message, 'error');
            // Восстанавливаем кнопку только если это был ручной вызов и кнопка существует
            if (markReadBtn) {
                markReadBtn.textContent = '✔️ Отметить прочитанной';
                markReadBtn.disabled = false;
            }
        } else {
             console.error(`Ошибка автоматической отметки прочитанным для ${chapterId}:`, error);
        }
        // Обновляем кнопки в любом случае при ошибке, чтобы вернуть их в норм. состояние
        updateMarkReadUnreadButtons(chapterId);
    }
}

/**
 * ✨ ОБНОВЛЕНО: Отмечает главу НЕПРОЧИТАННОЙ
 */
async function handleMarkAsUnread(chapterId, novelId) {
    const markUnreadBtn = document.getElementById('mark-as-unread-btn');
    // Кнопка "Отметить прочитанной" тоже нужна для обновления UI
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');

    if (!STATE.currentUser || !markUnreadBtn) {
        showToast('Для изменения статуса нужно войти', 'warning');
        return;
    }

    markUnreadBtn.disabled = true;
    markUnreadBtn.textContent = 'Обновление...';

    try {
        const response = await apiPostRequest('markChapterUnread', { chapter_id: chapterId });

        if (response.success) {
            showToast('Глава отмечена как непрочитанная', 'success');

            // Обновляем локальный список прочитанных ID
            if (window.readChapterIds) {
                window.readChapterIds = window.readChapterIds.filter(id => id !== chapterId);
            }

            // Обновляем состояние кнопок в панели
            updateMarkReadUnreadButtons(chapterId);

            // Очищаем кэш новеллы
            delete STATE.cache.data[`getNovel_${JSON.stringify({id: novelId})}`];

            // Обновляем список глав на странице новеллы
            rerenderChapterListFromState();

        } else {
            throw new Error(response.error || 'Не удалось обновить статус');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
        // Возвращаем кнопку в исходное состояние при ошибке
        markUnreadBtn.textContent = '❌ Отметить непрочитанной';
        markUnreadBtn.disabled = false;
        // Обновляем кнопки на всякий случай
         updateMarkReadUnreadButtons(chapterId);
    }
}

/**
 * ✨ NEW: Обновляет видимость кнопок "Прочитано"/"Непрочитано" в панели настроек
 */
function updateMarkReadUnreadButtons(currentChapterId) {
    const markUnreadBtn = document.getElementById('mark-as-unread-btn');
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');
    const statusMessage = document.getElementById('read-status-message');

    // Если панель настроек еще не открыта, элементы не будут найдены
    if (!markUnreadBtn || !markReadBtn || !statusMessage) {
        // console.log("Панель настроек чтения не открыта, кнопки не обновлены."); // Можно раскомментировать для отладки
        return;
    }

    // Проверяем статус текущей главы
    const isRead = window.readChapterIds && window.readChapterIds.includes(currentChapterId);

    if (isRead) {
        markUnreadBtn.style.display = 'block'; // Показываем "Отметить непрочитанной"
        markUnreadBtn.disabled = false;
        markUnreadBtn.textContent = '❌ Отметить непрочитанной'; // Стандартный текст
        markReadBtn.style.display = 'none';   // Скрываем "Отметить прочитанной"
        statusMessage.textContent = 'Глава отмечена как прочитанная.';
    } else {
        markUnreadBtn.style.display = 'none';   // Скрываем "Отметить непрочитанной"
        markReadBtn.style.display = 'block';  // Показываем "Отметить прочитанной"
        markReadBtn.disabled = false;
        markReadBtn.textContent = '✔️ Отметить прочитанной'; // Стандартный текст
        statusMessage.textContent = 'Глава еще не прочитана.';
    }
}

// Убираем 'chapters' из аргументов
async function loadAndDisplayReadingProgress(novelId) {
    try {
        const response = await apiRequest('getReadingProgress', { novel_id: novelId });

        // Мы больше не ищем container, progressBar, progressText

        if (response.success) {
             // Сразу обновляем список ID
            window.readChapterIds = response.read_chapters || [];

            // Обновляем кнопки в панели (если она открыта)
            const currentChapterId = new URLSearchParams(window.location.search).get('id');
            updateMarkReadUnreadButtons(currentChapterId);

            // Подсветка прочитанных глав (перерисовка списка)
            rerenderChapterListFromState();

        } else {
             // Если запрос не успешен, тоже сбрасываем и обновляем
             window.readChapterIds = [];
             const currentChapterId = new URLSearchParams(window.location.search).get('id');
             updateMarkReadUnreadButtons(currentChapterId);
             rerenderChapterListFromState();
        }
    } catch (error) {
        console.warn('Не удалось загрузить прогресс чтения:', error);
        // Сбрасываем и обновляем при ошибке
        window.readChapterIds = [];
        const currentChapterId = new URLSearchParams(window.location.search).get('id');
        updateMarkReadUnreadButtons(currentChapterId);
        rerenderChapterListFromState();
    }
}

//===========================================
//  ЛИЧНЫЙ КАБИНЕТ И ДОБАВЛЕНИЕ НОВЕЛЛ НА ПОЛКУ
//===========================================

/**
 * Рендеринг страницы профиля пользователя
 */
async function renderProfilePage() {
    const container = document.getElementById('page-content-container');
    if (!container || !STATE.currentUser) {
        container.innerHTML = `<div class="page-content profile-page"><p>Загрузка данных пользователя...</p></div>`;
        return;
    }

    const canCreate = ['creator', 'admin', 'owner'].includes(STATE.currentUser.role);
    const breadcrumbs = getBreadcrumbs('profile');

    const avatarContent = STATE.currentUser.avatar_url
        ? `<img src="${escapeHtml(STATE.currentUser.avatar_url)}" alt="Аватар" class="profile-avatar-image" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'avatar-placeholder-emoji\\'>👤</span>';">`
        : '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>';

    // ✨ Убираем вкладку "Созданные", если пользователь не может создавать ✨
    const createdNovelsTabHtml = canCreate
        ? `<button class="tab-btn" onclick="switchProfileTab(this, 'created')">Созданные новеллы</button>`
        : '';

    const novelsContainerHTML = `
        <div class="tabs">
            <button class="tab-btn active" onclick="switchProfileTab(this, 'shelves')">Мои полки</button>
            ${createdNovelsTabHtml}
        </div>
        <div class="reading-lists-container">
            <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
    `;

    container.innerHTML = `
        <div class="page-content profile-page">
            <div class="page-header profile-page-header">
                 ${breadcrumbs}
                 <button class="btn btn-secondary btn-sm profile-settings-btn" onclick="navigateTo('profile-settings')">
                     ⚙️ Настройки
                 </button>
            </div>
            <div class="profile-header">
                <div class="profile-avatar-display">
                     ${avatarContent}
                </div>
                <div class="profile-info">
                    <h1 class="profile-username">
                        ${escapeHtml(STATE.currentUser.username)}
                        <span class="profile-user-id">(id: ${STATE.currentUser.user_id})</span>
                    </h1>
                    <p class="profile-email">${escapeHtml(STATE.currentUser.email || 'Email не указан')}</p>
                    <p class="profile-role">Статус: ${getDisplayRoleName(STATE.currentUser.role)}</p>
                     </div>
                <button class="btn-logout-profile" onclick="handleLogout()">Выйти</button>
            </div>
            ${novelsContainerHTML}
        </div>
    `;

    // Загрузка активной вкладки (полки по умолчанию)
    await loadAndRenderReadingLists();
}

/**
 * ✨ NEW: Рендерит страницу настроек профиля с вкладками.
 */
async function renderProfileSettingsPage() {
    const container = document.getElementById('page-content-container');
    if (!container || !STATE.currentUser) {
        navigateTo('home'); // Перенаправляем, если нет пользователя
        return;
    }

    // Хлебные крошки для настроек
    const breadcrumbs = getBreadcrumbs('profile-settings'); // Нужно будет добавить case в getBreadcrumbs

    container.innerHTML = `
        <div class="page-content settings-page">
            ${breadcrumbs}
            <h1>Настройки профиля</h1>

            <div class="tabs settings-tabs">
                <button class="tab-btn active" onclick="switchSettingsTab(this, 'edit-profile')">✏️ Редактирование</button>
                <button class="tab-btn" onclick="switchSettingsTab(this, 'account')">⚙️ Аккаунт</button>
                </div>

            <div class="settings-content-container">
                <div id="settings-tab-edit-profile" class="tab-content active">
                    <h3>Изменение аватара</h3>
                    <div class="avatar-upload-section">
                        <div class="profile-avatar-container">
                             <div class="profile-avatar-display" id="profile-avatar-preview">
                                 </div>
                             <label for="avatar-upload-input" class="btn btn-secondary btn-sm change-avatar-btn" title="Изменить аватар">
                                 ✏️
                                 <input type="file" id="avatar-upload-input" accept="image/*" style="display: none;">
                             </label>
                             <button id="delete-avatar-btn" class="btn btn-danger btn-sm delete-avatar-btn" title="Удалить аватар">
                                 🗑️
                             </button>
                        </div>
                        <div class="avatar-upload-controls">
                             <p>Выберите изображение (макс 5MB, JPG/PNG/GIF/WebP)</p>
                             <button id="upload-avatar-btn" class="btn btn-primary btn-sm upload-avatar-btn" style="display: none;">
                                 💾 Сохранить аватар
                             </button>
                             <small id="avatar-upload-hint" class="form-help"></small>
                        </div>
                    </div>
                     <hr class="section-divider">
                     <h3>Другие настройки профиля</h3>
                     <p class="text-muted">Редактирование имени пользователя и описания профиля пока не доступно.</p>
                </div>

                <div id="settings-tab-account" class="tab-content">
                     <h3>Настройки аккаунта</h3>
                     <p class="text-muted">Здесь могут быть настройки уведомлений, смена пароля (если используется) и т.д.</p>
                     <p>Ваш Email: ${escapeHtml(STATE.currentUser.email || 'Не указан')}</p>
                     <p>Ваш ID: ${STATE.currentUser.user_id}</p>
                     <button class="btn btn-danger" onclick="handleLogout()">Выйти из аккаунта</button>
                     </div>
            </div>
        </div>
    `;

    // Заполняем блок аватара текущим значением
    const previewContainer = document.getElementById('profile-avatar-preview');
    const deleteBtn = document.getElementById('delete-avatar-btn');
    if (previewContainer && deleteBtn) {
        let avatarUrl = STATE.currentUser.avatar_url ? escapeHtml(STATE.currentUser.avatar_url) : null;
        if (avatarUrl && avatarUrl.includes('drive.google.com/thumbnail')) {
            avatarUrl += '&t=' + new Date().getTime(); // Добавляем cache-buster
        }
        const avatarContent = avatarUrl
            ? `<img src="\${avatarUrl}" alt="Аватар" class="profile-avatar-image" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'avatar-placeholder-emoji\\'>👤</span>';">`
            : '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>';
        previewContainer.innerHTML = avatarContent;
        deleteBtn.style.display = STATE.currentUser.avatar_url ? 'inline-flex' : 'none'; // Показываем/скрываем кнопку удаления
    }

    // Запускаем настройку загрузки аватара
    setupAvatarUpload();
}

/**
 * ✨ NEW: Переключает вкладки на странице настроек.
 */
function switchSettingsTab(button, tabName) {
    // Убираем active со всех кнопок
    document.querySelectorAll('.settings-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    // Добавляем active нажатой кнопке
    button.classList.add('active');

    // Прячем все контенты вкладок
    document.querySelectorAll('.settings-content-container .tab-content').forEach(content => {
        content.classList.remove('active'); // Используем класс active
    });
    // Показываем нужный контент
    const activeContent = document.getElementById(`settings-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.add('active'); // Показываем через класс
    }
}

/**
 * ✨ NEW: Настраивает обработчики для загрузки, предпросмотра и удаления аватара.
 */
function setupAvatarUpload() {
    const fileInput = document.getElementById('avatar-upload-input');
    const previewContainer = document.getElementById('profile-avatar-preview');
    const uploadBtn = document.getElementById('upload-avatar-btn');
    const deleteBtn = document.getElementById('delete-avatar-btn');
    const uploadHint = document.getElementById('avatar-upload-hint');

    if (!fileInput || !previewContainer || !uploadBtn || !deleteBtn) {
        console.warn("Элементы управления аватаром не найдены.");
        return;
    }

    let currentBase64 = null; // Храним Base64 для отправки

    // Обработка выбора файла
    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            currentBase64 = null;
            uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
            // Восстанавливаем текущий аватар или заглушку
            const currentAvatarUrl = STATE.currentUser?.avatar_url;
            previewContainer.innerHTML = currentAvatarUrl
                ? `<img src="${escapeHtml(currentAvatarUrl)}" alt="Аватар" class="profile-avatar-image" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'avatar-placeholder-emoji\\'>👤</span>';">`
                : '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>';
            return;
        }

        // Валидация
        if (!file.type.startsWith('image/')) {
            showToast('Пожалуйста, выберите изображение.', 'error');
            fileInput.value = ''; // Сбрасываем выбор файла
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // Лимит 5MB для аватара
            showToast('Файл слишком большой (макс 5MB).', 'error');
            fileInput.value = '';
            return;
        }

        // Конвертация и предпросмотр
        try {
            // Используем fileToBase64 со сжатием (например, до 400px, качество 0.8)
            currentBase64 = await fileToBase64(file, 400, 0.8);
            previewContainer.innerHTML = `<img src="${currentBase64}" alt="Предпросмотр" class="profile-avatar-image">`;
            uploadBtn.style.display = 'inline-block'; // Показываем кнопку сохранения
            if (uploadHint) uploadHint.textContent = `Выбран файл: ${file.name}`;
        } catch (error) {
            showToast('Ошибка обработки изображения: ' + error.message, 'error');
            fileInput.value = '';
            currentBase64 = null;
            uploadBtn.style.display = 'none';
            if (uploadHint) uploadHint.textContent = '';
        }
    });

    // Обработка клика "Сохранить аватар"
    uploadBtn.addEventListener('click', async () => {
        if (!currentBase64) {
            showToast('Сначала выберите файл', 'warning');
            return;
        }

        showLoading(true, { title: 'Загрузка аватара...' });
        uploadBtn.disabled = true;

        try {
            const response = await apiPostRequest('uploadAvatar', { avatar_base64: currentBase64 });
            if (response.success && response.avatar_url) {
                // Обновляем состояние и localStorage
                STATE.currentUser.avatar_url = response.avatar_url;
                localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
                // Обновляем отображение (можно просто перезагрузить данные пользователя в шапке)
                updateUserDisplay(); // Обновит шапку
                // Обновляем превью на странице профиля на реальный URL
                previewContainer.innerHTML = `<img src="${escapeHtml(response.avatar_url)}" alt="Аватар" class="profile-avatar-image" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'avatar-placeholder-emoji\\'>👤</span>';">`;
                currentBase64 = null; // Сбрасываем Base64
                uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
                deleteBtn.style.display = 'inline-block'; // Показываем кнопку удаления
                fileInput.value = ''; // Сбрасываем input file
                if (uploadHint) uploadHint.textContent = ''; // ✨ Очищаем подсказку
            } else {
                throw new Error(response.error || 'Не удалось загрузить аватар');
            }
        } catch (error) {
            showToast('Ошибка загрузки: ' + error.message, 'error');
        } finally {
            showLoading(false);
            uploadBtn.disabled = false;
        }
    });

    // Обработка клика "Удалить аватар"
    deleteBtn.addEventListener('click', () => {
        showConfirmModal('Удалить аватар?', 'Вы уверены, что хотите удалить текущий аватар?', async () => {
            showLoading(true, { title: 'Удаление аватара...' });
            deleteBtn.disabled = true;
            try {
                const response = await apiPostRequest('deleteAvatar', {});
                if (response.success) {
                    // Обновляем состояние и localStorage
                    STATE.currentUser.avatar_url = null;
                    localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
                    // Обновляем отображение
                    updateUserDisplay(); // Обновит шапку
                    previewContainer.innerHTML = '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>'; // Показываем заглушку
                    deleteBtn.style.display = 'none'; // Прячем кнопку удаления
                    fileInput.value = ''; // Сбрасываем input file
                    currentBase64 = null; // Сбрасываем Base64
                    uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
                    if (uploadHint) uploadHint.textContent = ''; // ✨ Очищаем подсказку

                } else {
                    throw new Error(response.error || 'Не удалось удалить аватар');
                }
            } catch (error) {
                showToast('Ошибка удаления: ' + error.message, 'error');
            } finally {
                showLoading(false);
                deleteBtn.disabled = false;
            }
        });
    });
}

/**
 * ✨ NEW: Рендерит новую, компактную карточку для полки (только обложка и название под ней)
 */
function renderShelfNovelCard(novel) {
    return `
        <div class="shelf-novel-item" onclick="navigateTo('novel-details', {id: '${novel.novel_id}'})">
            <div class="shelf-novel-cover">
                ${novel.cover_url ? 
                    `<img src="${escapeHtml(novel.cover_url)}" alt="${escapeHtml(novel.title)}" loading="lazy">` : 
                    '<div class="no-cover">📚</div>'
                }
            </div>
            <p class="shelf-novel-title">${escapeHtml(novel.title)}</p>
        </div>
    `;
}

/**
 * ✨ NEW: Рендерит скелетон для новой компактной карточки
 */
function renderShelfSkeletonCard() {
    return `
        <div class="shelf-novel-item skeleton-card">
            <div class="shelf-novel-cover skeleton"></div>
            <div class="shelf-novel-title skeleton skeleton-text"></div>
        </div>
    `;
}

/**
 * ✨ NEW: Переключает отображаемые новеллы при клике на полку
 */
function switchShelfView(shelfType, buttonElement) {
    // Снимаем класс 'active' со всех кнопок-полок
    document.querySelectorAll('.shelf-nav-btn').forEach(btn => btn.classList.remove('active'));
    // Добавляем класс 'active' только что нажатой кнопке
    buttonElement.classList.add('active');

    const contentContainer = document.querySelector('.shelves-content');
    if (!contentContainer) return;
    
    // Получаем данные о новеллах для выбранной полки (они уже загружены в STATE)
    const shelfNovels = window.userShelves[shelfType] || [];
    const allNovelsData = STATE.novels;

    if (shelfNovels.length > 0) {
        const novelsToRender = shelfNovels.map(item => {
            return allNovelsData.find(n => n.novel_id === item.novel_id);
        }).filter(Boolean); // Убираем новеллы, которые могли быть не найдены

        contentContainer.innerHTML = novelsToRender.map(novel => renderShelfNovelCard(novel)).join('');
    } else {
        contentContainer.innerHTML = '<p class="text-muted">На этой полке пока пусто.</p>';
    }
}

async function switchProfileTab(button, tabName) {
    document.querySelectorAll('.profile-page .tab-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    const contentContainer = document.querySelector('.reading-lists-container');
    contentContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    if (tabName === 'shelves') {
        // Вызываем ВАШУ существующую функцию
        await loadAndRenderReadingLists();
    } else if (tabName === 'created') {
        // Вызываем нашу новую функцию
        await renderProfileCreatedNovels();
    }
}

async function renderProfileCreatedNovels() {
    const container = document.querySelector('.reading-lists-container');
    try {
        const response = await apiRequest('getMyCreatedNovels', {});
        if (!response.success) throw new Error(response.error);

        const { novels } = response;
        if (novels.length > 0) {
            container.innerHTML = `<div class="novels-grid">${novels.map(n => renderNovelCard(n)).join('')}</div>`;
        } else {
            // ✨ ИЗМЕНЕНИЕ ЗДЕСЬ ✨
            // Проверяем, может ли пользователь создавать новеллы
            const canCreate = ['creator', 'admin', 'owner'].includes(STATE.currentUser.role);
            
            let emptyHtml = '<p>Вы еще не создали ни одной новеллы.</p>';
            if (canCreate) {
                // Если может - добавляем кнопку
                emptyHtml += `<button class="btn btn-primary" style="margin-top: 1rem;" onclick="navigateTo('add-novel')">
                                Создать?
                            </button>`;
            }
            container.innerHTML = `<div class="text-muted">${emptyHtml}</div>`;
        }
    } catch (error) {
        container.innerHTML = `<p class="text-danger">Не удалось загрузить созданные новеллы: ${error.message}</p>`;
    }
}

/**
 * ✨ REWRITTEN: Загрузка и отрисовка книжных полок в новом двухколоночном дизайне
 */
async function loadAndRenderReadingLists() {
    const container = document.querySelector('.reading-lists-container');
    if (!container) return;

    // Сразу показываем скелетоны, пока грузятся данные
    container.innerHTML = `
        <div class="shelves-layout">
            <nav class="shelves-nav">
                <div class="skeleton" style="width: 80%; height: 2rem; margin-bottom: 0.5rem;"></div>
                <div class="skeleton" style="width: 70%; height: 2rem; margin-bottom: 0.5rem;"></div>
                <div class="skeleton" style="width: 90%; height: 2rem; margin-bottom: 0.5rem;"></div>
            </nav>
            <div class="shelves-content">
                ${Array(6).fill(null).map(() => renderShelfSkeletonCard()).join('')}
            </div>
        </div>
    `;

    try {
        const response = await apiRequest('getReadingLists', {});
        if (!response.success) throw new Error(response.error);

        const { lists } = response;
        // Сохраняем данные полок в глобальную переменную, чтобы не запрашивать их снова
        window.userShelves = lists; 

        const listTypes = {
            reading: 'Читаю сейчас',
            want_to_read: 'Хочу прочитать',
            completed: 'Прочитано',
            favorite: 'Любимое',
            dropped: 'Брошено'
        };

        // Создаем HTML для левой колонки (навигация по полкам)
        const navHtml = Object.entries(listTypes).map(([type, title], index) => {
            const count = lists[type]?.length || 0;
            return `<button class="shelf-nav-btn ${index === 0 ? 'active' : ''}" 
                            onclick="switchShelfView('${type}', this)">
                        ${title} <span class="shelf-count">${count}</span>
                    </button>`;
        }).join('');
        
        // По умолчанию показываем первую полку ("Читаю сейчас")
        const initialShelfNovels = lists.reading || [];
        const novelsToRender = initialShelfNovels.map(item => {
            return STATE.novels.find(n => n.novel_id === item.novel_id);
        }).filter(Boolean);

        const contentHtml = novelsToRender.length > 0
            ? novelsToRender.map(novel => renderShelfNovelCard(novel)).join('')
            : '<p class="text-muted">На этой полке пока пусто.</p>';

        // Финальная отрисовка
        container.innerHTML = `
            <div class="shelves-layout">
                <nav class="shelves-nav">${navHtml}</nav>
                <div class="shelves-content">${contentHtml}</div>
            </div>
        `;

    } catch (error) {
        container.innerHTML = `<p class="text-danger">Не удалось загрузить списки: ${error.message}</p>`;
    }
}

/**
 * Обработчик добавления новеллы в список
 */
async function handleAddToReadingList(novelId, listType) {
    event.preventDefault(); // Оставляем это, чтобы ссылка не перезагружала сразу
    if (!STATE.currentUser) {
        showToast('Для этого действия нужно войти', 'warning');
        return;
    }

    try {
        const response = await apiPostRequest('addToReadingList', {
            novel_id: novelId,
            list_type: listType
        });
        if (!response.success) throw new Error(response.error);

        clearCache(); // Очищаем кэш на всякий случай

        // --- ДОБАВЛЕНО: Перезагрузка через 1 секунду ---
        setTimeout(() => location.reload(), 1000);
        // ---------------------------------------------

    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    }
    // finally блок не нужен, т.к. мы уходим на перезагрузку
}

/**
 * Обработчик удаления новеллы из списков
 */
/**
 * Обработчик удаления новеллы из списков
 */
async function handleRemoveFromReadingList(novelId) {
    event.preventDefault(); // Оставляем
    if (!STATE.currentUser) {
        showToast('Для этого действия нужно войти', 'warning');
        return;
    }

    // Модальное окно подтверждения остается без изменений
    showConfirmModal(
        'Убрать с полок?',
        'Вы уверены, что хотите убрать эту новеллу со всех своих книжных полок?',
        async () => {
            try {
                const response = await apiPostRequest('removeFromReadingList', { novel_id: novelId });
                if (!response.success) throw new Error(response.error);

                clearCache();

                // --- ДОБАВЛЕНО: Перезагрузка через 1 секунду ---
                setTimeout(() => location.reload(), 1000);
                // ---------------------------------------------

            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            }
            // finally блок не нужен
        }
    );
}

// ==========================================
// АУТЕНТИФИКАЦИЯ - EMAIL/ПАРОЛЬ
// ==========================================

/**
 * Показать форму входа
 */
function showLogin() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('registration-container').style.display = 'none';
}

/**
 * Показать форму регистрации
 */
function showRegistration() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('registration-container').style.display = 'flex';
}

/**
 * Вход по email и паролю
 */
async function handleEmailLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    
    if (!email || !password) {
        showToast('Заполните все поля', 'warning');
        return;
    }
    
    try {
        showLoading(true, { title: 'Вход...' });
        
        // ✅ ВОЗВРАЩАЕМ apiRequest и ПРАВИЛЬНОЕ НАЗВАНИЕ 'loginWithEmail'
        const response = await apiRequest('loginWithEmail', {
            email: email,
            password: password
        },  true); // Третий параметр true для пропуска кэша
        
        // ВАЖНО: Проверяем, что сервер вернул успешный ответ и объект пользователя
        if (response && response.success && response.user) {
            
            // ✅ ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ КЛЮЧ 'session_token'
            localStorage.setItem('session_token', response.session_token);
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            
            // ✨ Сохраняем и новые данные, как вы хотели
            localStorage.setItem('userRole', response.user.role);
            localStorage.setItem('userFeatures', JSON.stringify(response.user.features || []));

            STATE.currentUser = response.user;
            
            updateUserDisplay();
            hideModal('auth-modal');
            showToast('Добро пожаловать, ' + response.user.username + '!', 'success');

            // Перезагрузка для чистого обновления состояния
            setTimeout(() => {
                window.location.reload();
            }, 500);

        } else {
            // Обрабатываем ошибку, которую вернул сервер (например, "Неверный пароль")
            showToast('Ошибка: ' + (response.error || 'Неверный email или пароль'), 'error');
        }
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        // Эта ошибка сработает, если сам запрос apiRequest упадет (например, таймаут)
        showToast('Сетевая ошибка или ошибка сервера', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Регистрация нового пользователя
 */
async function handleRegistration() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    
    if (!username || !email || !password) {
        showToast('Заполните все поля', 'warning');
        return;
    }
    
    if (password.length < 6) {
        showToast('Пароль должен быть минимум 6 символов', 'warning');
        return;
    }
    
    try {
        showLoading(true, { title: 'Регистрация...' });
        
        const response = await apiRequest('registerWithEmail', {
            username: username,
            email: email,
            password: password
        });
        
        if (response.success) {
            showToast('Регистрация успешна! Войдите в систему.', 'success');
            
            // Переключаемся на форму входа
            document.getElementById('registration-container').style.display = 'none';
            document.getElementById('auth-container').style.display = 'flex';
            
            // Автозаполняем email
            document.getElementById('auth-email').value = email;
            
        } else {
            showToast('Ошибка: ' + response.error, 'error');
        }
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        showToast('Не удалось зарегистрироваться', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Выход из системы
 */
async function handleLogout() {
    // Получаем токен, чтобы отправить его на сервер для завершения сессии
    const session_token = localStorage.getItem('session_token');

    // ✅ Немедленно очищаем все локальные данные о пользователе
    localStorage.removeItem('session_token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole'); // Также чистим роль
    localStorage.removeItem('userFeatures'); // и права
    STATE.currentUser = null;
    clearCache(); // Очищаем кэш данных
    
    // ✅ В фоне отправляем запрос на сервер, чтобы он тоже завершил сессию.
    // Нам не нужно ждать ответа, поэтому мы не используем await.
    if (session_token) {
        apiRequest('logout', { session_token })
            .catch(e => console.warn('Фоновый выход не удался:', e));
    }

    showToast('Вы вышли из системы. Переход на главную...', 'info');

    // 3. ✨ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Жесткий редирект на чистый URL (Главную) ✨
    // Это уберет все параметры типа ?page=profile и предотвратит ошибку
    setTimeout(() => {
        window.location.href = window.location.origin + window.location.pathname;
    }, 500);
}

/**
 * ✅ НОВАЯ ФУНКЦИЯ
 * Вызывается автоматически виджетом Telegram после успешной авторизации.
 * Разместите эту функцию в глобальной области видимости (не внутри других функций).
 */
window.onTelegramAuth = async function(user) {
    console.log('Данные от виджета Telegram:', user);
    showLoading(true, { title: 'Вход через Telegram...' });

    try {
        // Отправляем ВСЕ данные от Telegram (включая 'hash') на сервер
        // для проверки подлинности в функции 'authenticateTelegram'.
        const response = await apiRequest('authenticateTelegram', user);

        if (response && response.success && response.user) {
            // Эта та же логика, что и в handleEmailLogin
            
            localStorage.setItem('session_token', response.session_token);
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            localStorage.setItem('userRole', response.user.role);
            localStorage.setItem('userFeatures', JSON.stringify(response.user.features || []));

            STATE.currentUser = response.user;
            
            updateUserDisplay();
            hideModal('auth-modal'); // Закрываем модальное окно
            showToast('Добро пожаловать, ' + response.user.username + '!', 'success');

            // Перезагрузка страницы для чистого обновления состояния
            setTimeout(() => {
                window.location.reload();
            }, 500);

        } else {
            // Сервер отклонил вход (например, неверный hash)
            throw new Error(response.error || 'Не удалось войти. Сервер отклонил данные.');
        }
    } catch (error) {
        console.error('Ошибка входа через Telegram (onTelegramAuth):', error);
        showToast('Ошибка: ' + error.message, 'error');
        showLoading(false); // Прячем загрузку при ошибке
    }
}

/**
 * Обработчик для кнопки "Поделиться"
 */
async function handleShareNovel(novelId) {
    // ✅ ИСПРАВЛЕНО: Изменён текст загрузки
    showLoading(true, { title: 'Загрузка настроек доступа...' });
    try {
        const response = await apiRequest('getNovel', { id: novelId }, true);
        if (!response.success) throw new Error(response.error);

        renderShareModal(response.novel); // Вызываем новую, улучшенную функцию
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Рендерит улучшенное модальное окно "Поделиться" с вкладками
 */
function renderShareModal(novel) {
    // Удаляем старое модальное окно, если оно есть
    const existingModal = document.getElementById('share-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.className = 'modal show visible'; 

    const shareUrl = `${window.location.origin}${window.location.pathname}?page=novel-details&id=${novel.novel_id}`;

    let accessInfoHtml = '';
    if (novel.access_type === 'public') {
        accessInfoHtml = '<p>🌍 Эта новелла публична и доступна всем.</p>';
    } else if (novel.access_type === 'link_only') {
        accessInfoHtml = '<p>🔗 Любой, у кого есть ссылка, может просматривать эту новеллу.</p>';
    } else if (novel.access_type === 'private') {
        accessInfoHtml = '<p>🔒 Эту новеллу могут просматривать только пользователи с доступом.</p>';
    }

    modal.innerHTML = `
        <div class="modal-content large-modal">
            <button class="close-btn" onclick="document.getElementById('share-modal').remove()">×</button>
            <h2>Поделиться новеллой</h2>

            <div class="tabs">
                <button class="tab-btn active" onclick="switchShareTab(this, 'link')">Ссылка</button>
                <button class="tab-btn" onclick="switchShareTab(this, 'access')">Управление доступом</button>
            </div>

            <div id="share-tab-link" class="share-tab-content active">
                <h4>Ссылка для просмотра</h4>
                <div class="share-link-container">
                    <input type="text" class="form-input" value="${shareUrl}" readonly id="share-url-input">
                    <button class="btn btn-secondary" onclick="copyToClipboard('#share-url-input')">Копировать</button>
                </div>
                ${accessInfoHtml}
            </div>

            <div id="share-tab-access" class="share-tab-content">
                <h4>Выдать доступ пользователям</h4>
                <div class="add-permission-form">
                    <input type="search" id="user-search-input-share" class="form-input" placeholder="Поиск по имени или email...">
                    <select id="permission-level-select" class="form-select">
                        <option value="read">Читатель</option>
                        <option value="edit">Редактор</option>
                    </select>
                    <button class="btn btn-primary" onclick="grantUserPermission('${novel.novel_id}')">Выдать доступ</button>
                </div>
                <div id="permissions-list">
                    <div class="loading-spinner"><div class="spinner"></div></div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    loadNovelPermissions(novel.novel_id);
    setupUserSearchAutocomplete('user-search-input-share');
}

// ✨ НУЖНО ДОБАВИТЬ ЭТУ ФУНКЦИЮ для автокомплита в модалке ✨
function setupUserSearchAutocomplete(inputId) {
    const searchInput = document.getElementById(inputId);
    if (!searchInput) return;

    let autocompleteList = null;
    let debounceTimer = null;

    searchInput.addEventListener('input', function() {
        const query = this.value.trim();

        if (autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        if (query.length < 2) return;

        debounceTimer = setTimeout(async () => {
            try {
                // Используем API для поиска пользователей
                const response = await apiRequest('searchUserForPermission', { query });
                if (searchInput.value.trim() !== query) return; // Проверка актуальности
                if (!response.success || response.users.length === 0) return;

                autocompleteList = document.createElement('div');
                autocompleteList.className = 'autocomplete-list'; // Используем тот же класс
                autocompleteList.style.width = searchInput.offsetWidth + 'px';

                response.users.forEach(user => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerHTML = `
                        <div class="autocomplete-title">${highlightMatch(user.username, query)}</div>
                        ${user.email ? `<div class="autocomplete-author">${highlightMatch(user.email, query)}</div>` : ''}
                    `;
                    item.addEventListener('click', () => {
                        searchInput.value = user.email || user.username; // Подставляем email или имя
                        if (autocompleteList) autocompleteList.remove();
                        autocompleteList = null;
                    });
                    autocompleteList.appendChild(item);
                });

                searchInput.parentElement.appendChild(autocompleteList); // Добавляем список

            } catch (error) {
                console.error('Ошибка автодополнения пользователей:', error);
            }
        }, 300);
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    });
}

/**
 * Переключает вкладки в окне "Поделиться"
 */
function switchShareTab(button, tabName) {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    
    modal.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    modal.querySelectorAll('.share-tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`share-tab-${tabName}`).classList.add('active');
}

/**
 * Выдает доступ пользователю (улучшенная версия)
 */
async function grantUserPermission(novelId) {
    const input = document.getElementById('user-search-input-share');
    const permissionSelect = document.getElementById('permission-level-select');
    const query = input.value.trim();
    const permission = permissionSelect.value;

    if (!query) {
        showToast('Введите имя или email пользователя', 'warning');
        return;
    }
    
    showLoading(true, { title: 'Поиск пользователя...' });
    try {
        const searchResponse = await apiRequest('searchUserForPermission', { query });
        if (!searchResponse.success || searchResponse.users.length === 0) {
            throw new Error('Пользователь не найден.');
        }
        
        const targetUser = searchResponse.users[0];
        
        const grantResponse = await apiPostRequest('grantPermission', {
            novelId,
            targetUserId: targetUser.user_id,
            permission
        });
        
        if (!grantResponse.success) throw new Error(grantResponse.error);
        
        showToast(`Доступ «${permission}» выдан пользователю ${targetUser.username}`, 'success');
        loadNovelPermissions(novelId);
        input.value = '';

    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Копирует текст в буфер обмена
 */
function copyToClipboard(selector) {
    const input = document.querySelector(selector);
    if (input) {
        input.select();
        document.execCommand('copy');
        showToast('Ссылка скопирована!', 'success');
    }
}

/**
 * Загружает и отображает список пользователей с доступом
 */
async function loadNovelPermissions(novelId) {
    const listContainer = document.getElementById('permissions-list');
    try {
        const response = await apiRequest('getNovelPermissions', { novelId });
        if (!response.success) throw new Error(response.error);

        if (response.permissions.length === 0) {
            listContainer.innerHTML = '<p class="text-muted">Вы еще никому не выдали доступ.</p>';
            return;
        }

        listContainer.innerHTML = response.permissions.map(p => `
            <div class="permission-item">
                <span>${escapeHtml(p.username)} (${escapeHtml(p.email || 'нет email')}) - <i>${p.permission}</i></span>
                <button class="btn btn-sm btn-danger" onclick="revokeUserPermission('${novelId}', ${p.user_id})">Отозвать</button>
            </div>
        `).join('');

    } catch (error) {
        listContainer.innerHTML = `<p class="text-danger">Ошибка: ${error.message}</p>`;
    }
}

/**
 * Отзывает доступ у пользователя
 */
async function revokeUserPermission(novelId, userId) {
    showConfirmModal('Отозвать доступ?', 'Вы уверены?', async () => {
        showLoading(true, { title: 'Отзыв доступа...' });
        try {
            const response = await apiPostRequest('revokePermission', { novelId, targetUserId: userId });
            if (!response.success) throw new Error(response.error);
            showToast('Доступ отозван', 'success');
            loadNovelPermissions(novelId);
        } catch (error) {
            showToast('Ошибка: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
}

// ==========================================
// ЗАПУСК ПРИЛОЖЕНИЯ
// ==========================================

// ✅ НОВЫЙ КОД:
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

console.log('✅ Script.js ПОЛНАЯ версия загружена и готова!');
