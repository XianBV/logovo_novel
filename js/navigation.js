/* ==========================================
   ЛОГОВО НОВЕЛЛ — НАВИГАЦИЯ
   SPA-маршрутизация и хлебные крошки
   ========================================== */

console.log('📦 navigation.js загружен');

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

let pendingPageRender = null;

async function renderPage(page, params = {}, options = {}) {
    const request = { page, params: { ...params }, options: { ...options } };
    if (isRendering) {
        // Пока старая страница загружается, сохраняем последний выбранный маршрут.
        pendingPageRender = request;
        return;
    }
    isRendering = true;
    try {
        let next = request;
        while (next) {
            pendingPageRender = null;
            try {
                await renderPageContent(next.page, next.params, next.options);
            } catch (error) {
                console.error('Ошибка подготовки страницы:', error);
                showToast('Не удалось загрузить страницу', 'error');
            }
            next = pendingPageRender;
        }
    } finally {
        isRendering = false;
    }
}

async function renderPageContent(page, params = {}, options = {}) {
    const { scrollToTop = false } = options;

    if (typeof clearProfileScrollSpace === 'function') clearProfileScrollSpace();
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;

    // ✨ ИСПРАВЛЕНИЕ №2: Принудительно включаем скролл
    // (на случай, если модальное окно не закрылось и оставило overflow: hidden)
    try {
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto'; // И для <html> на всякий случай
    } catch (e) {}

    // Убираем горячие клавиши и полноэкранный режим редактора главы
    // перед переходом на другую виртуальную страницу.
    if (typeof STATE.chapterEditorCleanup === 'function') {
        STATE.chapterEditorCleanup();
    }

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

    // Страница чтения создаёт свой обработчик сохранения позиции. Перед
    // переходом сохраняем её один раз и не оставляем слушатель на новой странице.
    if (typeof window.chapterReadingPositionCleanup === 'function') {
        // Место чтения сразу записывается в браузер, а сетевой запрос уходит
        // в фоне. Переход на страницу новеллы не должен ждать ответ сервера.
        void window.chapterReadingPositionCleanup();
    }

    const chapterEditorPages = ['add-chapter', 'edit-chapter'];
    const isChapterEditorPage = chapterEditorPages.includes(page);
    document.body.classList.toggle('chapter-editor-page-open', isChapterEditorPage);
    document.body.classList.toggle('profile-page-open', page === 'profile');

    const mainHeader = document.getElementById('main-header');
    if (mainHeader) {
        if (page !== 'chapter-read' && !isChapterEditorPage) {
            mainHeader.classList.remove('is-hidden'); // Показываем
        } else {
            mainHeader.classList.add('is-hidden'); // Скрываем
        }
    }
    
    console.log(`📄 Рендеринг: ${page}`, params);

    // При первом переходе на главную список новелл может ещё не быть загружен.
    // Сразу заменяем предыдущую страницу скелетом каталога, чтобы переход
    // ощущался мгновенным, а данные спокойно догружались уже на главной.
    const isCatalogPage = page === 'home' || page === 'catalog';
    const needsCatalogData = (
        isCatalogPage &&
        !hasLoadedInitialDataScope('full')
    );

    if (needsCatalogData) {
        ['search-section', 'novels-container'].forEach(id => showSection(id));

        const pageViewContainer = document.getElementById('page-content-container');
        if (pageViewContainer) {
            pageViewContainer.style.display = 'none';
            pageViewContainer.innerHTML = '';
        }

        await renderCatalogPage(true);
    }

    // Если приложение было открыто сразу на лёгкой странице (например,
    // чтение главы), при переходе в каталог или редактор подгружаем
    // недостающие общие данные один раз.
    try {
        await loadInitialDataForPage(page);
        updateUserDisplay();
    } catch (error) {
        console.error('Ошибка начальной загрузки страницы:', error);
        showToast('Не удалось загрузить данные страницы', 'error');
        return;
    }

    // Не рисуем промежуточную страницу, если за время загрузки уже выбрана другая.
    if (pendingPageRender) return;

    // ✨ НАШ НОВЫЙ "ОХРАННИК" ✨
    // Список страниц, для которых нужны права 'creator' или выше
    const creatorPages = ['add-novel', 'edit-novel', 'add-chapter', 'edit-chapter', 'manage-chapters'];
    // Проверяем, нужна ли для страницы авторизация
    if ((creatorPages.includes(page) || page === 'profile') && !STATE.currentUser) {
        // Сначала базовая проверка: если пользователь вообще не вошел
        showToast('Для доступа к этой странице необходимо войти', 'warning');
        navigateTo('home'); // Просто перенаправляем на главную
        return;
    }

    // Теперь более строгая проверка: проверяем права на создание/редактирование
    if (creatorPages.includes(page) && !checkUserPermission('create')) {
        // checkUserPermission('create') вернет true для creator, admin и owner
        showToast('У вас недостаточно прав для доступа к этой странице', 'error');
        navigateTo('home'); // Перенаправляем на главную
        return;
    }

    if (page === 'admin') {
        const role = STATE.currentUser?.role;
        if (
            !STATE.currentUser ||
            !['admin', 'owner'].includes(role)
        ) {
            showToast(
                'У вас нет доступа к админ-панели',
                'error'
            );
            navigateTo('home');
            return;
        }
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

            case 'admin':
                await renderAdminPage();
                break;
                
            case 'novel-details':
                if (params.id) await renderNovelDetailsPage(params.id);
                break;

            case 'novel-glossary':
                if (params.id) await renderNovelGlossaryPage(params.id);
                break;
                
            case 'add-novel':
                await renderNovelFormPage();
                break;
                
            case 'edit-novel':
                if (params.id) await renderNovelFormPage(params.id);
                break;
                
            case 'chapter-read':
                if (
                    params.novel &&
                    params.chapter !== undefined &&
                    params.chapter !== ''
                ) {
                    await renderChapterReadPage(
                        params.novel,
                        params.chapter
                    );
                } else if (params.id) {
                    // Временная поддержка старых ссылок
                    await renderChapterReadPage(params.id);
                }
                break;
                
            case 'add-chapter':
                if (params.novelId) {
                    await renderChapterFormPage(
                        params.novelId,
                        null,
                        null,
                        params.returnTo
                    );
                }
                break;
                
            case 'edit-chapter':
                if (
                    params.novel &&
                    params.chapter !== undefined &&
                    params.chapter !== ''
                ) {
                    await renderChapterFormPage(
                        params.novel,
                        null,
                        params.chapter,
                        params.returnTo
                    );
                } else if (params.id) {
                    // Старые ссылки продолжают работать и после загрузки заменяются на канонические.
                    await renderChapterFormPage(
                        null,
                        params.id,
                        null,
                        params.returnTo
                    );
                }
                break;

            case 'manage-chapters':
                if (params.id) await renderChapterManagerPage(params.id);
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

    }
}

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

function getBreadcrumbs(page, params = {}) {
    // Если мы на главной, возвращаем пустую строку
    if (page === 'home' || page === 'catalog') {
        return '';
    }

    // ✨ Используем ваше название переменной
    let breadcrumbs = '<a href="/?page=home" onclick="handleLinkClick(event)">Главная</a>';
    
    // ✨ Включаем все ваши 'case'
    switch(page) {
        case 'novel-details': {
            const title = escapeHtml(params.title || 'Новелла');
            breadcrumbs += ` <span aria-hidden="true">›</span> <span aria-current="page" title="${title.replaceAll('"', '&quot;')}">${title}</span>`;
            break;
        }
        case 'novel-glossary':
            breadcrumbs += ` <span>›</span> <a href="/?page=novel-details&id=${encodeURIComponent(params.id || '')}" onclick="handleLinkClick(event)">${escapeHtml(params.title || 'Новелла')}</a>`;
            breadcrumbs += ' <span>›</span> <span>Глоссарий</span>';
            break;
        case 'manage-chapters':
            breadcrumbs += ` <span>›</span> <a href="/?page=novel-details&id=${encodeURIComponent(params.id || '')}" onclick="handleLinkClick(event)">${escapeHtml(params.title || 'Новелла')}</a>`;
            breadcrumbs += ' <span>›</span> <span>Управление главами</span>';
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

window.addEventListener('popstate', event => {
    if (event.state && event.state.page) {
        renderPage(event.state.page, event.state.params || {});
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const page = urlParams.get('page') || 'home';
    const params = {};

    urlParams.forEach((value, key) => {
        if (key !== 'page') {
            params[key] = value;
        }
    });

    renderPage(page, params, { scrollToTop: false });
});
