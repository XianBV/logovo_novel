/* ==========================================
   ЛОГОВО НОВЕЛЛ — НОВЕЛЛЫ
   Страница новеллы, форма и управление
   ========================================== */

console.log('📦 novels.js загружен');

async function renderNovelDetailsPage(novelId) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    // Каждая страница новеллы открывается в обычном режиме.
    STATE.isChapterEditMode = false;

    window.scrollTo({ top: 0, behavior: 'instant' });
    
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
            // Условие: подменяем URL только для скрытых и приватных
            const useSlug = (response.novel.access_type === 'link_only' || response.novel.access_type === 'private') && response.novel.slug;
            
            if (useSlug) {
                const currentUrl = new URL(window.location.href);
                if (currentUrl.searchParams.get('id') !== response.novel.slug) {
                    currentUrl.searchParams.set('id', response.novel.slug);
                    window.history.replaceState({ page: 'novel-details', params: { id: response.novel.slug } }, '', currentUrl);
                }
            }

            // Хлебные крошки: в id передаем то, что должно быть в URL, а в title СТРОГО название новеллы
            const breadcrumbs = getBreadcrumbs('novel-details', {
                id: useSlug ? response.novel.slug : response.novel.novel_id, 
                title: response.novel.title // <-- Вот тут гарантия, что будет название
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

    const useNovelSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
    const novelReference = useNovelSlug ? novel.slug : novel.novel_id;
    const chaptersHtml = renderChaptersListV2(chapters, novel.has_volumes, canEdit, window.readChapterIds || [], novelReference); // Передаем ID прочитанных глав

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
    window.currentNovelReferenceV2 = novelReference;
    
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

async function renderNovelFormPage(novelId = null) {
    const container = document.getElementById('page-content-container');
    if (!container) return;
    
    const isEdit = !!novelId;
    let novelData = null;
    const currentYear = new Date().getFullYear();
    
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
                
                <form
                    id="novel-form"
                    class="novel-form"
                    autocomplete="off"
                >
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
                            <label for="novel-author-search">Автор *</label>

                            <input
                                type="text"
                                id="novel-author-search"
                                class="form-input"
                                required
                                value="${novelData ? escapeHtml(novelData.author || '') : ''}"
                                placeholder="Имя автора"
                                autocomplete="off"
                                autocapitalize="off"
                                spellcheck="false"
                                data-lpignore="true"
                                data-1p-ignore="true"
                                data-bwignore="true"
                            >

                            <input
                                type="hidden"
                                id="novel-author-value"
                                name="author"
                                value="${novelData ? escapeHtml(novelData.author || '') : ''}"
                            >
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
                                <input
                                    type="number"
                                    id="novel-year"
                                    name="year"
                                    class="form-input"
                                    value="${isEdit ? escapeHtml(novelData?.year || '') : currentYear}"
                                    min="1"
                                    step="1"
                                    inputmode="numeric"
                                    autocomplete="off"
                                >
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
                                ${STATE.tags.map(t => 
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
    
    // Настройка тегов с автодополнением
    setupTagsInput('tags-input', 'tags-container', STATE.tags);
}

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

function removeAltTitleTag(button) {
    const container = document.getElementById('alt-titles-container');
    const hiddenInput = document.getElementById('novel-alt-titles');
    button.parentElement.remove();
    if (container && hiddenInput) {
        updateHiddenAltTitlesInput(container, hiddenInput); // Обновляем скрытое поле
    }
}

function updateHiddenAltTitlesInput(container, hiddenInput) {
    const titles = Array.from(container.querySelectorAll('.selected-tag'))
        .map(tag => tag.dataset.value.trim()) // Собираем значения из data-атрибутов
        .filter(Boolean); // Убираем пустые
    hiddenInput.value = titles.join(' | '); // Соединяем через |
}

function handleDeleteNovel(novelId) {
    showConfirmModal(
        '🗑️ Удаление новеллы',
        'Вы уверены? Новелла будет перемещена в корзину.\nВы сможете восстановить её из раздела "Созданные" в вашем профиле.',
        () => deleteNovel(novelId)
    );
}

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
