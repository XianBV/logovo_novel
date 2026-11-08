/* ==========================================
   ЛОГОВО НОВЕЛЛ — НОВЕЛЛЫ
   Страница новеллы, форма и управление
   ========================================== */

console.log('📦 novels.js загружен');

function renderUiIcon(name) {
    return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="assets/icons.svg?v=20261108scheduled#icon-${name}"></use></svg>`;
}

function renderNovelProgress(novel, chapters, canEdit) {
    const translated = Math.max(Number(novel.chapter_count) || 0, chapters.length);
    const original = Math.max(0, Number(novel.original_chapter_count) || 0);
    const available = chapters.length;
    const translatedPercent = original ? Math.round(100 * Math.min(translated, original) / original) : null;
    return `
        <div class="novel-progress">
            <div class="novel-progress-meters">
                ${canEdit ? `<div data-novel-progress="translation">
                    <div class="novel-progress-caption">
                        <span class="novel-progress-label">${renderUiIcon('edit')} Перевод</span>
                        <strong>${original ? `${translated} / ${original} · ${translatedPercent}%` : `${translated} ${getNounEnding(translated, 'глава', 'главы', 'глав')}`}</strong>
                    </div>
                    ${original ? `<progress aria-label="Прогресс перевода" max="${original}" value="${Math.min(translated, original)}"></progress>` : ''}
                </div>` : ''}
                <div data-novel-progress="reading"${canEdit ? ' hidden' : ''}>
                    <div class="novel-progress-caption">
                        <span class="novel-progress-label">${renderUiIcon('book-open')} Чтение</span>
                        <strong data-reading-progress-count>${available ? `0 / ${available} · 0%` : 'Нет глав'}</strong>
                    </div>
                    ${available ? `<progress data-reading-progress aria-label="Прогресс чтения" max="${available}" value="0"></progress>` : ''}
                </div>
            </div>
            ${canEdit ? '<button type="button" class="btn btn-secondary btn-sm novel-progress-toggle" onclick="toggleNovelProgress(this)">К чтению</button>' : ''}
        </div>
    `;
}

function toggleNovelProgress(button) {
    const widget = button.closest('.novel-progress');
    const translation = widget.querySelector('[data-novel-progress="translation"]');
    const reading = widget.querySelector('[data-novel-progress="reading"]');
    const showReading = reading.hidden;
    reading.hidden = !showReading;
    translation.hidden = showReading;
    button.textContent = showReading ? 'К переводу' : 'К чтению';
}

async function renderNovelDetailsPage(novelId) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    // Каждая страница новеллы открывается в обычном режиме.
    STATE.isChapterEditMode = false;
    window.currentReadingProgress = null;

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

async function renderNovelGlossaryPage(novelId) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    container.innerHTML = '<div class="page-content novel-glossary-page"><div class="loading-spinner"><div class="spinner"></div></div></div>';

    try {
        const response = await apiRequest('getNovel', { id: novelId });
        if (!response.success || !response.novel) {
            throw new Error(response.error || 'Новелла не найдена');
        }

        const novel = response.novel;
        const useNovelSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
        const novelReference = useNovelSlug ? novel.slug : novel.novel_id;
        const breadcrumbs = getBreadcrumbs('novel-glossary', {
            id: novelReference,
            title: novel.title
        });

        container.innerHTML = `
            <section class="page-content novel-glossary-page">
                ${breadcrumbs}
                <div class="novel-glossary-heading">
                    ${renderUiIcon('dictionary')}
                    <div>
                        <p class="eyebrow">Глоссарий новеллы</p>
                        <h2>${escapeHtml(novel.title)}</h2>
                    </div>
                </div>
                <div class="empty-state novel-glossary-empty">
                    ${renderUiIcon('book')}
                    <h3>Терминов пока нет</h3>
                    <p>Позже здесь появятся понятия, имена и другие пояснения именно для этой новеллы.</p>
                    <button class="btn btn-secondary" onclick="navigateTo('novel-details', {id: '${novelReference}'})">Вернуться к новелле</button>
                </div>
            </section>
        `;
    } catch (error) {
        container.innerHTML = `
            <div class="page-content error-page">
                <h3>Не удалось открыть глоссарий</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn btn-secondary" onclick="goBackInHistory()">Вернуться</button>
            </div>
        `;
    }
}

function renderNovelDetailsContent(novel, chapters, breadcrumbs) {
    const container = document.querySelector('.novel-details-page');
    if (!container) return;

    const editionPreview = new URLSearchParams(window.location.search).get('layout') === 'edition';
    container.classList.toggle('is-edition-preview', editionPreview);

    const actualTranslationWordCount = chapters.reduce((sum, chapter) => sum + (Number(chapter.word_count) || 0), 0);
    const coverUrls = [...new Set(
        (Array.isArray(novel.cover_urls) ? novel.cover_urls : [novel.cover_url])
            .filter(url => typeof url === 'string' && url.trim())
    )];
    
    const canEdit = checkUserPermission('edit', novel);
    const useNovelSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
    const novelReference = useNovelSlug ? novel.slug : novel.novel_id;
    const progressHtml = renderNovelProgress(novel, chapters, canEdit);
    const alternateTitles = getNovelAlternateTitles(novel.alt_titles);

    window.currentNovelShareData = {
        novel_id: novel.novel_id,
        title: novel.title,
        access_type: novel.access_type,
        slug: novel.slug,
        can_manage_access: canEdit
    };

    const tagsHtml = novel.tags?.map(t => `
        <span class="tag-badge clickable"
            data-description="${t.description ? escapeHtml(t.description) : ''}"
            onclick="filterByTag('${escapeHtml(t.name)}')">
            ${escapeHtml(t.name)}
        </span>
    `).join('') || '';

    // ✨ СОЗДАЁМ HTML ДЛЯ КНОПОК УПРАВЛЕНИЯ ОТДЕЛЬНО ✨
    const actionsHtml = `
        <div class="novel-actions-bar">
            ${canEdit ? `
            <button class="action-btn edit" onclick="navigateTo('edit-novel', {id: '${novel.novel_id}'})" title="Редактировать новеллу" aria-label="Редактировать новеллу">
                ${renderUiIcon('edit')}
            </button>
            ` : ''}
            <button class="action-btn share" onclick="handleShareNovel('${novel.novel_id}')" title="Поделиться" aria-label="Поделиться">
                ${renderUiIcon('share')}
            </button>
            ${canEdit ? `
            <button class="action-btn delete" onclick="handleDeleteNovel('${novel.novel_id}')" title="Удалить новеллу" aria-label="Удалить новеллу">
                ${renderUiIcon('trash')}
            </button>
            ` : ''}
        </div>
    `;

    const glossaryActionHtml = `
        <button class="action-btn glossary" onclick="navigateTo('novel-glossary', {id: '${novelReference}'})" title="Глоссарий новеллы" aria-label="Глоссарий новеллы">
            ${renderUiIcon('dictionary')}
        </button>
    `;

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
            ${novel.access_type ? `<div class="info-access-row"><span>Доступ:</span><span class="info-value">${getAccessIcon(novel.access_type)}<span>${getAccessLabel(novel.access_type)}</span></span></div>` : ''}
            ${novel.created_at ? `<div><span>Добавлена:</span> <span>${formatDate(novel.created_at)}</span></div>` : ''}
            ${additionalLinksHtml}
        </div>
    `;

    // КНОПКА НАЧАТЬ ЧТЕНИЕ
    const hasSignedInReader = Boolean(STATE.currentUser && STATE.currentUser.user_id != null);
    const hasPublicChapters = chapters.some(chapter => !chapter.is_future);
    const isSubscribed = novel.chapter_notifications_subscribed === true;
    const chapterNotificationButton = `
        <button type="button" class="btn btn-secondary chapter-notification-btn" data-novel-reference="${escapeHtml(String(novelReference)).replaceAll('"', '&quot;')}" aria-pressed="${isSubscribed}" onclick="toggleChapterNotifications(this)">
            ${renderUiIcon('bell')}<span>${isSubscribed ? 'Уведомления включены' : 'Уведомить о выходе глав'}</span>
        </button>
    `;
    const startReadingButton = hasPublicChapters ? `
        <div class="start-reading-container">
            <button class="btn btn-primary start-reading-btn" onclick="startReading()"${hasSignedInReader ? ' disabled aria-busy="true"' : ''}>
                ${hasSignedInReader ? 'Загрузка чтения…' : 'Начать чтение'}
            </button>
        </div>
    ` : `<div class="start-reading-container">${chapterNotificationButton}</div>`;

    const authorName = novel.author || 'Автор не указан';
    const authorAliases = String(novel.author_aliases || '').split(/\s*\|\s*/);
    const readableAuthorName = /\p{Script=Han}/u.test(authorName)
        ? authorAliases.find(alias => /\p{Script=Cyrillic}/u.test(alias) && !/\p{Script=Han}/u.test(alias))
            || authorAliases.find(alias => /\p{Script=Latin}/u.test(alias) && !/\p{Script=Han}/u.test(alias))
        : '';

    const coverHtml = coverUrls.length ? `
        <button type="button" class="novel-cover-open" aria-label="Открыть обложки новеллы «${escapeHtml(novel.title)}»">
            <img src="${escapeHtml(coverUrls[0])}" alt="Обложка новеллы «${escapeHtml(novel.title)}»"
                onerror="handleCoverError(this)" onload="handleCoverLoad(this)">
        </button>
    ` : '<div class="no-cover">Нет обложки</div>';

    const headingHtml = `
        <div class="novel-header-center" data-debug="header-container">
            <h1 class="novel-main-title" id="novel-title" data-debug="main-title">${alternateTitles.length ? `
                <button type="button" class="novel-alt-titles-trigger" title="Другие названия" aria-haspopup="dialog" onclick="document.getElementById('novel-alt-titles').showModal()">${escapeHtml(novel.title)}</button>
            ` : escapeHtml(novel.title)}</h1>
            <div class="author-container">
                <span class="author-label">Автор:</span>
                <span class="author-name"><a href="?page=author&amp;name=${encodeURIComponent(authorName)}" onclick="handleLinkClick(event)">${escapeHtml(authorName)}${readableAuthorName ? ` <span class="novel-author-alias">(${escapeHtml(readableAuthorName)})</span>` : ''}</a></span>
            </div>
            ${alternateTitles.length ? `
                <dialog id="novel-alt-titles" class="novel-alt-titles-dialog" aria-labelledby="novel-alt-titles-heading" onclick="closeDialogOnBackdrop(event)">
                    <header>
                        <h2 id="novel-alt-titles-heading">Другие названия</h2>
                        <button type="button" class="novel-alt-titles-close" aria-label="Закрыть" onclick="this.closest('dialog').close()">${renderUiIcon('close')}</button>
                    </header>
                    <ul>${alternateTitles.map(title => `<li>${escapeHtml(title)}</li>`).join('')}</ul>
                </dialog>
            ` : ''}
            ${editionPreview ? startReadingButton : ''}
        </div>
    `;

    const coverGroupHtml = `
        <div class="novel-cover-float">
            ${coverHtml}
            ${editionPreview ? '' : startReadingButton}
        </div>
    `;

    const fixedMobilePanelsHtml = editionPreview ? '' : `
        <section class="fixed-mobile-novel-panels" aria-label="Основная информация о новелле">
            <article class="fixed-mobile-novel-panel fixed-mobile-overview-panel">
                <div class="fixed-mobile-overview-cover">
                    ${coverHtml}
                    ${startReadingButton}
                </div>
                <div class="fixed-mobile-overview-description">
                    <h2>${renderUiIcon('book')}<span>Описание</span></h2>
                    <div class="fixed-mobile-description">${renderCollapsibleNovelDescription(novel.description, 'fixed-novel-description')}</div>
                </div>
            </article>
            <article class="fixed-mobile-novel-panel fixed-mobile-info-panel">
                <h2>Основная информация</h2>
                ${infoTableHtml}
            </article>
        </section>
    `;

    const chaptersHtml = renderChaptersListV2(chapters, novel.has_volumes, canEdit, window.readChapterIds || [], novelReference); // Передаем ID прочитанных глав

    container.innerHTML = `
        <div class="page-header">
            ${breadcrumbs || '<div></div>'}
            <div class="novel-page-actions">
                ${glossaryActionHtml}
                ${actionsHtml}
            </div>
        </div>
        ${fixedMobilePanelsHtml}
        
        <!-- ОСНОВНОЙ КОНТЕЙНЕР С ОБТЕКАНИЕМ -->
        <div class="novel-content-wrapper">
            ${editionPreview ? `<div class="novel-edition-hero">${coverGroupHtml}${headingHtml}</div>` : coverGroupHtml}

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
                    <button class="tab-btn active" onclick="switchDescriptionTab('description')">${renderUiIcon('book')}<span>Описание</span></button>
                    <button class="tab-btn" onclick="switchDescriptionTab('info')" id="info-tab-button">${renderUiIcon('info')}<span>Информация</span></button>
                </div>
                
                <div id="float-description" class="tab-content active">
                    ${renderCollapsibleNovelDescription(novel.description, 'novel-description')}
                </div>
                
                <div id="float-info" class="tab-content">
                    ${infoTableHtml}
                </div>
            </div>

            <!-- ОКОНЧАНИЕ ВЕРХНЕЙ ГРУППЫ -->
            <div class="novel-float-clear"></div>
        </div>
        <div class="novel-taxonomy novel-taxonomy-top">
            <div class="tags-list">
                <strong>Теги:</strong>
                ${tagsHtml || '<span class="text-muted">Не указаны</span>'}
            </div>
        </div>
        
        ${editionPreview ? '' : `<hr class="section-divider">${headingHtml}`}
        <hr class="section-divider">

        <!-- ГЛАВЫ -->
        <section class="chapters-section-v2">
            
            <div class="chapters-header-v2">
                <div class="chapters-primary-controls">
                    <button class="btn btn-secondary btn-sm chapter-sort-icon-btn" id="chapter-sort-btn-v2" onclick="toggleChapterOrderV2()" title="${chapterSortOrder === 'asc' ? 'Показать сначала новые главы' : 'Показать сначала старые главы'}" aria-label="${chapterSortOrder === 'asc' ? 'Показать сначала новые главы' : 'Показать сначала старые главы'}">
                        ${renderUiIcon('sort')}
                    </button>
                    <div class="novel-shelf-control-anchor" id="novel-shelf-control-anchor"></div>
                </div>
                <div class="chapters-secondary-row">
                    ${hasPublicChapters && isSubscribed ? chapterNotificationButton : ''}
                    ${canEdit ? `
                    <div class="novel-chapter-edit-controls">
                        <span class="novel-chapter-stats-placeholder">Статистика <small>в разработке</small></span>
                        <div class="chapters-secondary-controls">
                            <button class="btn btn-primary btn-sm" onclick="navigateTo('add-chapter', {novelId: '${novel.novel_id}'})">
                                + Добавить
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="navigateTo('manage-chapters', {id: '${novelReference}'})" title="Управлять главами" aria-label="Управлять главами">
                                ${renderUiIcon('edit')}
                            </button>
                        </div>
                    </div>
                    ` : ''}
                    ${progressHtml}
                </div>
            </div>

            <div class="chapters-list-container-v2">
                <div class="chapters-list-header${hasSignedInReader ? ' has-read-toggle' : ''}">
                    ${hasSignedInReader ? '<div class="ch-read-toggle" aria-label="Статус чтения"></div>' : ''}
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

    const shelfButtonContainer = document.createElement('div');
    shelfButtonContainer.className = 'novel-shelf-control';
    const shelfControlAnchor = document.getElementById('novel-shelf-control-anchor');
    shelfControlAnchor?.appendChild(shelfButtonContainer);

    const shelfTypes = {
        want_to_read: 'Хочу прочитать',
        reading: 'Читаю сейчас',
        completed: 'Прочитано',
        favorite: 'В любимое',
        dropped: 'Брошено'
    };
    let selectedShelf = (novel.userShelves || []).find(type => shelfTypes[type]) || null;

    shelfButtonContainer.innerHTML = `
        <button type="button" class="shelf-trigger" aria-expanded="false" aria-haspopup="menu">
            ${renderUiIcon('shelf')}
            <span class="shelf-trigger-label">${selectedShelf ? shelfTypes[selectedShelf] : 'В полку'}</span>
        </button>
        <div class="shelf-menu" role="menu" aria-label="Выбор полки">
            <p class="shelf-menu-title">Моя полка</p>
            <div class="shelf-options">
                ${Object.entries(shelfTypes).map(([type, title]) => `
                    <button type="button" class="shelf-option${type === selectedShelf ? ' is-selected' : ''}" data-shelf-type="${type}" role="menuitemradio" aria-checked="${type === selectedShelf}">
                        <span>${title}</span>${type === selectedShelf ? renderUiIcon('check') : ''}
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    const closeShelfMenu = () => {
        shelfButtonContainer.classList.remove('menu-visible');
        shelfButtonContainer.querySelector('.shelf-trigger')?.setAttribute('aria-expanded', 'false');
        document.documentElement.classList.remove('shelf-menu-open');
        document.body.classList.remove('shelf-menu-open');
        document.documentElement.style.removeProperty('--shelf-scrollbar-compensation');
    };

    const updateShelfControl = (nextShelf) => {
        selectedShelf = nextShelf;
        novel.userShelves = nextShelf ? [nextShelf] : [];
        shelfButtonContainer.querySelector('.shelf-trigger-label').textContent = nextShelf ? shelfTypes[nextShelf] : 'В полку';
        shelfButtonContainer.querySelectorAll('.shelf-option').forEach(option => {
            const isSelected = option.dataset.shelfType === nextShelf;
            option.classList.toggle('is-selected', isSelected);
            option.setAttribute('aria-checked', String(isSelected));
            const icon = option.querySelector('.ui-icon');
            if (isSelected && !icon) option.insertAdjacentHTML('beforeend', renderUiIcon('check'));
            if (!isSelected && icon) icon.remove();
        });
    };

    const shelfTrigger = shelfButtonContainer.querySelector('.shelf-trigger');
    const shelfMenu = shelfButtonContainer.querySelector('.shelf-menu');
    const positionShelfMenu = () => {
        const triggerRect = shelfTrigger.getBoundingClientRect();
        const menuRect = shelfMenu.getBoundingClientRect();
        const safeMargin = 10;
        const gap = 8;
        const roomRight = window.innerWidth - triggerRect.left;
        const roomBelow = window.innerHeight - triggerRect.bottom;
        const roomAbove = triggerRect.top;

        let left = roomRight >= menuRect.width + safeMargin
            ? triggerRect.left
            : triggerRect.right - menuRect.width;
        let top = roomBelow >= menuRect.height + gap + safeMargin
            ? triggerRect.bottom + gap
            : triggerRect.top - menuRect.height - gap;

        if (roomAbove < menuRect.height + gap + safeMargin && roomBelow >= menuRect.height + gap + safeMargin) {
            top = triggerRect.bottom + gap;
        }

        left = Math.max(safeMargin, Math.min(left, window.innerWidth - menuRect.width - safeMargin));
        top = Math.max(safeMargin, Math.min(top, window.innerHeight - menuRect.height - safeMargin));
        shelfMenu.style.left = `${Math.round(left)}px`;
        shelfMenu.style.top = `${Math.round(top)}px`;
    };

    shelfTrigger.addEventListener('click', () => {
        if (!STATE.currentUser) {
            showToast('Для полок нужно войти в аккаунт', 'warning');
            return;
        }
        const isVisible = shelfButtonContainer.classList.toggle('menu-visible');
        shelfTrigger.setAttribute('aria-expanded', String(isVisible));
        if (isVisible) {
            const bodyWidth = document.body.getBoundingClientRect().width;
            const appWidth = document.getElementById('app')?.getBoundingClientRect().width
                ?? document.body.clientWidth;
            const scrollbarWidth = Math.max(
                0,
                bodyWidth - appWidth
            );
            document.documentElement.style.setProperty('--shelf-scrollbar-compensation', `${scrollbarWidth}px`);
        }
        document.documentElement.classList.toggle('shelf-menu-open', isVisible);
        document.body.classList.toggle('shelf-menu-open', isVisible);
        if (isVisible) requestAnimationFrame(positionShelfMenu);
    });

    let isShelfSaving = false;
    shelfButtonContainer.addEventListener('click', async (event) => {
        const shelfOption = event.target.closest('[data-shelf-type]');
        if (!shelfOption || isShelfSaving) return;

        isShelfSaving = true;
        shelfOption.classList.add('is-saving');
        shelfOption.setAttribute('aria-busy', 'true');
        shelfOption.insertAdjacentHTML('beforeend', '<span class="shelf-option-loading" aria-label="Сохраняется"></span>');

        try {
            const nextShelf = shelfOption.dataset.shelfType;
            if (nextShelf === selectedShelf) {
                const response = await apiPostRequest('removeFromReadingList', { novel_id: novel.novel_id });
                if (!response.success) throw new Error(response.error);
                updateShelfControl(null);
                clearCache();
                showToast('Новелла убрана с полки', 'success');
            } else {
                const response = await apiPostRequest('addToReadingList', { novel_id: novel.novel_id, list_type: nextShelf });
                if (!response.success) throw new Error(response.error);
                updateShelfControl(nextShelf);
                clearCache();
                showToast(`Новелла: «${shelfTypes[nextShelf]}»`, 'success');
            }
            closeShelfMenu();
        } catch (error) {
            showToast(`Не удалось изменить полку: ${error.message}`, 'error');
        } finally {
            isShelfSaving = false;
            shelfOption.classList.remove('is-saving');
            shelfOption.removeAttribute('aria-busy');
            shelfOption.querySelector('.shelf-option-loading')?.remove();
        }
    });

    const handleShelfClickOutside = event => {
        if (!document.body.contains(shelfButtonContainer)) {
            document.removeEventListener('click', handleShelfClickOutside);
            return;
        }
        if (!shelfButtonContainer.contains(event.target)) closeShelfMenu();
    };
    document.addEventListener('click', handleShelfClickOutside);

    // ИНИЦИАЛИЗАЦИЯ ДОПОЛНИТЕЛЬНЫХ ФУНКЦИЙ
    initializeNovelPageFeatures(novel);
    window.currentNovelChapters = chapters;
    window.currentNovelHasVolumes = novel.has_volumes;

    initTooltips();

    // Сохраняем данные для сортировки
    window.currentNovelChaptersV2 = chapters;
    window.currentNovelHasVolumesV2 = novel.has_volumes;
    window.currentNovelCanEditV2 = canEdit;
    window.currentNovelReferenceV2 = novelReference;
    
    // АВТОМАТИЧЕСКОЕ ПЕРЕКЛЮЧЕНИЕ НА ОПИСАНИЕ ПРИ ПОЯВЛЕНИИ САЙДБАРА
    if (!editionPreview) setupAutoTabSwitching();
    setupFixedMobilePanels();

    if (STATE.currentUser && STATE.currentUser.user_id != null) {
        loadAndDisplayReadingProgress(novel.novel_id);
    } else {
        updateStartReadingButton(null);
    }
}

function setupAutoTabSwitching() {
    const infoTabButton = document.getElementById('info-tab-button');
    if (!infoTabButton) return;

    function checkScreenSize() {
        if (!infoTabButton.isConnected) {
            window.removeEventListener('resize', checkScreenSize);
            return;
        }
        const hasSideInfo = document.documentElement.dataset.novelDetailsLayout === 'fixed'
            || window.innerWidth >= 1024;
        
        if (hasSideInfo && infoTabButton) {
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

async function toggleChapterNotifications(button) {
    if (STATE.currentUser?.user_id == null) {
        showModal('auth-modal');
        return;
    }

    const buttons = [...button.closest('.novel-details-page').querySelectorAll('.chapter-notification-btn')];
    const subscribe = button.getAttribute('aria-pressed') !== 'true';
    buttons.forEach(control => { control.disabled = true; });
    try {
        const response = await apiPostRequest('setNovelChapterSubscription', {
            novel: button.dataset.novelReference,
            subscribed: subscribe
        });
        if (!response.success) throw new Error(response.error || 'Не удалось сохранить уведомления');
        clearCache();
        buttons.forEach(control => {
            control.setAttribute('aria-pressed', String(response.subscribed));
            control.querySelector('span').textContent = response.subscribed ? 'Уведомления включены' : 'Уведомить о выходе глав';
        });
        showToast(response.subscribed ? 'Новые главы появятся в уведомлениях сайта' : 'Подписка на главы отключена', 'success');
    } catch (error) {
        showToast(error.message || 'Не удалось сохранить уведомления', 'error');
    } finally {
        buttons.forEach(control => { control.disabled = false; });
    }
}

function setupFixedMobilePanels() {
    const panelsContainer = document.querySelector('.fixed-mobile-novel-panels');
    if (!panelsContainer) return;

    let frameId = null;
    const syncHeight = () => {
        frameId = null;
        const isFixedMobile = document.documentElement.dataset.novelDetailsLayout === 'fixed'
            && window.matchMedia('(max-width: 767px)').matches;
        if (!isFixedMobile) {
            panelsContainer.style.height = '';
            return;
        }

        const panels = Array.from(panelsContainer.querySelectorAll('.fixed-mobile-novel-panel'));
        if (!panels.length) return;
        const viewportCenter = panelsContainer.scrollLeft + panelsContainer.clientWidth / 2;
        const activePanel = panels.reduce((closest, panel) => (
            Math.abs(panel.offsetLeft + panel.offsetWidth / 2 - viewportCenter)
            < Math.abs(closest.offsetLeft + closest.offsetWidth / 2 - viewportCenter)
                ? panel
                : closest
        ));
        panelsContainer.style.height = `${activePanel.offsetHeight}px`;
    };

    const scheduleHeightSync = () => {
        if (frameId !== null) return;
        frameId = requestAnimationFrame(syncHeight);
    };

    panelsContainer.addEventListener('scroll', scheduleHeightSync, { passive: true });
    panelsContainer.addEventListener('novel-description-toggle', scheduleHeightSync);
    window.addEventListener('resize', scheduleHeightSync, { once: true });
    requestAnimationFrame(syncHeight);
}

function initializeNovelPageFeatures(novel) {
    const coverButtons = document.querySelectorAll('.novel-cover-open');

    if (coverButtons.length) {
        const coverUrls = [...new Set(
            (Array.isArray(novel.cover_urls) ? novel.cover_urls : [novel.cover_url])
                .filter(url => typeof url === 'string' && url.trim())
        )];
        coverButtons.forEach(button => {
            button.addEventListener('click', () => showCoverGallery(coverUrls, novel.title));
        });
    }

}

function showCoverGallery(coverUrls, title) {
    const images = [...new Set((coverUrls || []).filter(url => typeof url === 'string' && url.trim()))];
    if (!images.length) return;

    closeCoverGallery();

    const gallery = document.createElement('div');
    gallery.id = 'cover-gallery-popup';
    gallery.className = 'cover-gallery-popup';
    gallery.innerHTML = `
        <div class="cover-gallery-dialog" role="dialog" aria-modal="true" aria-label="Обложки новеллы">
            <button type="button" class="popup-close" aria-label="Закрыть просмотр обложек">${renderUiIcon('close')}</button>
            <div class="cover-gallery-main"><img src="${escapeHtml(images[0])}" alt="Обложка новеллы «${escapeHtml(title || '')}»"></div>
            ${images.length > 1 ? `
                <div class="cover-gallery-thumbnails" aria-label="Выбор обложки">
                    ${images.map((url, index) => `
                        <button type="button" class="cover-gallery-thumbnail${index === 0 ? ' is-active' : ''}" data-cover-index="${index}" aria-label="Показать обложку ${index + 1}">
                            <img src="${escapeHtml(url)}" alt="Миниатюра обложки ${index + 1}">
                        </button>
                    `).join('')}
                </div>` : ''}
        </div>
    `;

    const close = () => closeCoverGallery();
    const mainImage = gallery.querySelector('.cover-gallery-main img');
    gallery.querySelector('.popup-close').addEventListener('click', close);
    gallery.addEventListener('click', event => {
        if (!event.target.closest('.cover-gallery-main img, .cover-gallery-thumbnail, .popup-close')) close();
    });
    gallery.querySelectorAll('.cover-gallery-thumbnail').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.coverIndex);
            mainImage.src = images[index];
            gallery.querySelectorAll('.cover-gallery-thumbnail').forEach(item => item.classList.toggle('is-active', item === button));
        });
    });
    gallery._escapeHandler = event => {
        if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', gallery._escapeHandler);
    document.body.appendChild(gallery);
    document.body.style.overflow = 'hidden';
}

function closeCoverGallery() {
    const gallery = document.getElementById('cover-gallery-popup');
    if (!gallery) return;
    if (gallery._escapeHandler) document.removeEventListener('keydown', gallery._escapeHandler);
    gallery.remove();
    document.body.style.overflow = '';
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
        public: 'Публичный',
        private: 'Приватный',
        link_only: 'По ссылке'
    };
    return labels[accessType] || accessType;
}

function getAccessIcon(accessType) {
    const icons = {
        public: 'globe',
        private: 'lock',
        link_only: 'link'
    };
    return icons[accessType] ? renderUiIcon(icons[accessType]) : '';
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

function renderCollapsibleNovelDescription(description, id) {
    const text = (description || '').trim() || 'Описание пока не добавлено.';
    const fullDescription = formatDescription(text);
    const previewLimit = 480;
    if (text.length <= previewLimit) return fullDescription;

    const preview = text.slice(0, previewLimit).replace(/\s+\S*$/, '').trimEnd();
    return `
        <div data-description-preview>${formatDescription(`${preview}…`)}</div>
        <div id="${id}" hidden>${fullDescription}</div>
        <button type="button" class="novel-description-toggle" aria-expanded="false" aria-controls="${id}" onclick="toggleNovelDescription(this)">
            <span>Читать далее</span>${renderUiIcon('chevron-down')}
        </button>
    `;
}

function toggleNovelDescription(button) {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.parentElement.querySelector('[data-description-preview]').hidden = expanded;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('span').textContent = expanded ? 'Свернуть' : 'Читать далее';
    button.dispatchEvent(new Event('novel-description-toggle', { bubbles: true }));
    if (!expanded) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
