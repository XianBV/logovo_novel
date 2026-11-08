/* ==========================================
   ЛОГОВО НОВЕЛЛ — КАТАЛОГ
   Карточки, поиск, фильтры, сортировка и пагинация
   ========================================== */

console.log('📦 catalog.js загружен');

async function renderCatalogPage(isSkeleton = false) {
    showSection('search-section');
    showSection('novels-container');
    
    const grid = document.getElementById('novels-grid');
    if (!grid) return;

    if (isSkeleton) {
        showSkeletonCards();
        return;
    }

    // Если функция вызвана уже с данными, работаем как обычно.
    setupAdvancedFilters();
    
    const novelsToShow = sortNovelsByCurrentPreference(STATE.filteredNovels);
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

function showSkeletonCards(count = 12) {
    const grid = document.getElementById('novels-grid');
    if (!grid) return;
    
    grid.classList.toggle('list-view', STATE.viewMode === 'list');
    
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
    const filterResult = document.getElementById('catalog-filter-result');
    for (const count of [novelsCount, filterResult].filter(Boolean)) {
        count.textContent = `${novels.length} ${getNounEnding(novels.length, 'новелла', 'новеллы', 'новелл')}`;
        count.classList.remove('skeleton-loader');
    }

    if (statsBar) statsBar.style.display = 'flex';
    grid.classList.toggle('list-view', STATE.viewMode === 'list');
    STATE.totalPages = Math.ceil(novels.length / STATE.itemsPerPage);
    
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
    
    grid.innerHTML = renderNovelCards(pageNovels);
}

function getNovelGridClassName(extraClass = '', viewMode = STATE.viewMode) {
    return ['novels-grid', extraClass, viewMode === 'list' ? 'list-view' : ''].filter(Boolean).join(' ');
}

function renderNovelCards(novels) {
    return novels.map(novel => renderNovelCard(novel)).join('');
}

function renderNovelCollection(novels, extraClass = '') {
    return `<div class="${getNovelGridClassName(extraClass)}">${renderNovelCards(novels)}</div>`;
}

function catalogAttribute(value) {
    return escapeHtml(String(value ?? '')).replaceAll('"', '&quot;');
}

const NOVEL_LANGUAGE_CODES = new Map([
    ['Китайский', 'ZH'],
    ['Корейский', 'KO'],
    ['Японский', 'JA'],
    ['Английский', 'EN'],
    ['Русский', 'RU']
]);

function renderNovelCard(novel) {
    const isListView = STATE.viewMode === 'list';
    const useSlug = ['link_only', 'private'].includes(novel.access_type) && novel.slug;
    const identifier = useSlug ? novel.slug : novel.novel_id;
    const title = escapeHtml(novel.title);
    const attribute = catalogAttribute;
    let href = `?page=novel-details&amp;id=${encodeURIComponent(identifier)}`;
    let action = 'handleLinkClick(event)';
    let state = '';
    let overlay = '';
    if (novel.is_deleted) {
        state = 'deleted';
        href = '#';
        action = 'event.preventDefault(); handleRestoreNovel(this.dataset.novelId, event)';
        overlay = '<span class="restore-icon">↩️</span><span>Восстановить</span>';
    } else if (novel.original_status === 'processing') {
        state = 'processing';
        href = '#';
        action = 'event.preventDefault()';
        overlay = '<div class="spinner"></div><span>Создаётся...</span>';
    } else if (novel.original_status === 'error') {
        state = 'error';
        href = '#';
        action = 'event.preventDefault(); handleErrorNovelClick(this.dataset.novelId)';
        overlay = '<span>⚠️</span><span>Ошибка</span>';
    }
    const cardClass = ['novel-card', isListView ? 'list-view-card' : 'grid-view-card', state].filter(Boolean).join(' ');
    const linkClass = isListView ? 'novel-row-link' : 'novel-card-link';
    const linkAttributes = `href="${href}" class="${linkClass}" data-novel-id="${attribute(novel.novel_id)}" onclick="${action}"${state === 'processing' ? ' aria-disabled="true" tabindex="-1"' : ''}`;
    const language = novel.language;
    const languageCode = NOVEL_LANGUAGE_CODES.get(language);
    const languageBadge = languageCode
        ? `<span aria-hidden="true">${languageCode}</span><span class="visually-hidden">${escapeHtml(language)}</span>`
        : escapeHtml(language);
    const statusBadge = novel.translation_status
        ? `<span class="novel-status ${getStatusClass(novel.translation_status)}">${escapeHtml(novel.translation_status)}</span>` : '';
    const cover = `
        ${overlay ? `<div class="novel-card-overlay">${overlay}</div>` : ''}
        ${isListView ? '' : statusBadge}
        <div class="novel-cover">
            ${novel.cover_url ? `<img src="${attribute(novel.cover_url)}" alt="${attribute(novel.title)}" loading="lazy">` : '<div class="no-cover">📚</div>'}
            ${language ? `<span class="novel-language" title="${catalogAttribute(language)}">${languageBadge}</span>` : ''}
        </div>`;
    if (!isListView) {
        return `<a ${linkAttributes}><div class="${cardClass}">
            ${cover}<div class="novel-info"><h3 class="novel-title">${title}</h3></div>
        </div></a>`;
    }
    const meta = [novel.orientation, novel.era, novel.perspective].filter(Boolean).join(' · ');
    const metaParts = [novel.original_chapter_count ? `${novel.original_chapter_count} глав в оригинале` : '', meta].filter(Boolean);
    return `<article class="${cardClass}">
        <a ${linkAttributes} aria-label="${attribute(novel.title)}"></a>
        ${cover}
        <div class="novel-info">
            <h3 class="novel-title">${title}</h3>
            ${novel.author ? `<p class="novel-author"><a href="?page=author&amp;name=${encodeURIComponent(novel.author)}" class="author-link-inline" onclick="handleLinkClick(event)">${escapeHtml(novel.author)}</a></p>` : ''}
            ${metaParts.length || statusBadge ? `<div class="novel-meta-line">${metaParts.map(part => `<span>${escapeHtml(part)}</span>`).join('')}${statusBadge}</div>` : ''}
        </div>
    </article>`;
}

function getStatusClass(status) {
    const _status = (status || '').toString().toLowerCase();
    if (_status.includes('продолжается') || _status.includes('ongoing') || _status.includes('в процессе')) return 'status-ongoing';
    if (_status.includes('заморожен') || _status.includes('заброшен') || _status.includes('hiatus') || _status.includes('перерыв')) return 'status-hiatus';
    if (_status.includes('завершен') || _status.includes('completed')) return 'status-completed';
    return 'status-unknown';
}

function handleRestoreNovel(novelId, event) {
    event?.stopPropagation();
    
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
    const novelsToShow = STATE.filteredNovels;
    renderNovelsGrid(novelsToShow);
    renderPagination();
    
    // Прокрутка вверх
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getNovelAlternateTitles(value) {
    const titles = Array.isArray(value) ? value : String(value ?? '').split('|');
    return titles.map(title => String(title ?? '').trim()).filter(Boolean);
}

function getCatalogSearchMatch(novel, query) {
    const matches = value => String(value ?? '').toLocaleLowerCase('ru').includes(query);
    if (matches(novel.title)) return { field: 'title', value: novel.title };
    const alternate = getNovelAlternateTitles(novel.alt_titles).find(matches);
    if (alternate) return { field: 'alternate', value: alternate };
    if (matches(novel.author)) return { field: 'author', value: novel.author };
    return null;
}

function setupSearchAutocomplete() {
    const form = document.getElementById('catalog-search-form');
    const input = document.getElementById('search-input');
    const clear = document.getElementById('catalog-search-clear');
    const results = document.getElementById('catalog-search-results');
    if (!form || !input || !clear || !results) return;

    const dismiss = () => { results.hidden = true; };
    input.addEventListener('input', () => {
        const query = input.value.trim().toLocaleLowerCase('ru');
        clear.hidden = !input.value;
        if (!query && STATE.catalogSearchQuery) performSearch();
        if (query.length < 2) return dismiss();

        const suggestions = [];
        let matchCount = 0;
        for (const novel of STATE.novels) {
            const match = getCatalogSearchMatch(novel, query);
            if (!match) continue;
            matchCount += 1;
            if (suggestions.length === 8) continue;
            const reference = ['private', 'link_only'].includes(novel.access_type) && novel.slug
                ? novel.slug : novel.novel_id;
            const caption = match.field === 'alternate' ? match.value : novel.author;
            suggestions.push(`<li><a class="catalog-suggestion" href="?page=novel-details&amp;id=${encodeURIComponent(reference)}" onclick="handleLinkClick(event)">
                <span class="catalog-suggestion-cover" aria-hidden="true">
                    ${renderUiIcon('book-open')}
                    ${novel.cover_url ? `<img src="${catalogAttribute(novel.cover_url)}" alt="" onerror="this.remove()">` : ''}
                </span>
                <span class="catalog-suggestion-text">
                    <strong>${highlightMatch(novel.title, query)}</strong>
                    ${caption ? `<small>${highlightMatch(caption, query)}</small>` : ''}
                </span>
            </a></li>`);
        }
        results.innerHTML = suggestions.length
            ? `<ul aria-label="Подходящие новеллы">${suggestions.join('')}</ul>
                ${matchCount > 5 ? `<button class="catalog-search-show-all" type="submit">Показать в каталоге · ${matchCount}</button>` : ''}`
            : '<p class="catalog-search-empty">Совпадений нет</p>';
        results.hidden = false;
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        dismiss();
        performSearch();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        clear.hidden = true;
        dismiss();
        performSearch();
        input.focus();
    });
    form.addEventListener('keydown', event => {
        if (results.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
            input.focus();
        } else if (event.key === 'ArrowDown' && event.target === input) {
            const first = results.querySelector('a');
            if (first) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    form.addEventListener('focusout', event => {
        if (!form.contains(event.relatedTarget)) dismiss();
    });
    document.addEventListener('pointerdown', event => {
        if (!form.contains(event.target)) dismiss();
    });
    results.addEventListener('click', event => {
        if (event.target.closest('a')) dismiss();
    });
}

function highlightMatch(text, query) {
    const value = String(text ?? '');
    const index = value.toLocaleLowerCase('ru').indexOf(query);
    if (index === -1) return escapeHtml(value);
    const end = index + query.length;
    return `${escapeHtml(value.slice(0, index))}<mark>${escapeHtml(value.slice(index, end))}</mark>${escapeHtml(value.slice(end))}`;
}

function closeDialogOnBackdrop(event) {
    const panel = event.currentTarget;
    if (event.target !== panel) return;
    const bounds = panel.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom) panel.close();
}

function toggleFilters() {
    const panel = document.getElementById('filters-panel');
    if (!panel) return;
    if (panel.open) return panel.close();

    const scrollPositions = [document.documentElement, document.body].map(element => ({
        element, top: element.scrollTop, left: element.scrollLeft
    }));
    const toggle = document.getElementById('filter-toggle');
    panel.addEventListener('close', () => {
        const tooltip = document.getElementById('custom-tooltip');
        if (tooltip && panel.contains(tooltip)) {
            tooltip.classList.remove('show');
            document.body.appendChild(tooltip);
        }
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.focus({ preventScroll: true });
        scrollPositions.forEach(({ element, top, left }) => {
            element.scrollTop = top;
            element.scrollLeft = left;
        });
    }, { once: true });
    panel.showModal();
    toggle?.setAttribute('aria-expanded', 'true');
}

function applyFilters() {
    applyFiltersAndSort();
    document.getElementById('filters-panel')?.close();
}

function showCatalogFilterPage(index) {
    const gallery = document.getElementById('catalog-filter-gallery');
    gallery.scrollTo({ left: gallery.clientWidth * index });
}

function syncCatalogFilterGallery(gallery) {
    const width = gallery.clientWidth;
    if (!width) return;
    const index = Math.round(gallery.scrollLeft / width);
    // Новая секция получает фокус только у точки остановки прокрутки.
    if (Math.abs(gallery.scrollLeft - index * width) > 2) return;
    const tabs = gallery.previousElementSibling.querySelectorAll('button');
    if (tabs[index]?.getAttribute('aria-current') === 'true') return;
    Array.from(gallery.children).forEach((page, position) => {
        const active = position === index;
        page.inert = !active;
        tabs[position].setAttribute('aria-current', String(active));
    });
}

function resetFilterControlsAndState() {
    [
        'language-filter',
        'era-filter',
        'perspective-filter',
        'orientation-filter',
        'original-status-filter',
        'translation-status-filter',
        'chapters-min',
        'chapters-max',
        'words-min',
        'words-max'
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.value = '';
        }
    });

    const tagMapContainer = document.getElementById('filter-tags-map');
    if (tagMapContainer) {
        tagMapContainer.querySelectorAll('.filter-tag-item').forEach(item => {
            item.classList.remove('include-active', 'exclude-active');
            syncCatalogTagButtons(item);
        });
    }
    const tagSearch = document.getElementById('catalog-tag-search');
    if (tagSearch) tagSearch.value = '';
    filterCatalogTags('');

    updateSelectedTagsDisplay('selected-include-tags', [], 'include');
    updateSelectedTagsDisplay('selected-exclude-tags', [], 'exclude');

    document
        .querySelectorAll('input[name="include-tag-mode"][value="any"]')
        .forEach(radio => { radio.checked = true; });

    document
        .querySelectorAll('input[name="exclude-tag-mode"][value="any"]')
        .forEach(radio => { radio.checked = true; });

    STATE.currentFilters = {
        language: '',
        era: '',
        perspective: '',
        orientation: '',
        originalStatus: '',
        translationStatus: '',
        chaptersMin: null,
        chaptersMax: null,
        wordsMin: null,
        wordsMax: null,
        includeTags: [],
        includeTagMode: 'any',
        excludeTags: [],
        excludeTagMode: 'any'
    };
}

function clearFilters() {
    resetFilterControlsAndState();
    applyFiltersAndSort();
    showToast('Фильтры сброшены', 'info');
}


function toggleSortPopup() {
    const popup = document.getElementById('sort-popup');
    const sortButton = document.getElementById('sort-btn');
    if (!popup || !sortButton) return;

    const isVisible = popup.style.display === 'block';

    if (isVisible) {
        popup.style.display = 'none';
        sortButton.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', closeSortPopupOnClickOutside, true);
    } else {
        // Позиционируем попап под кнопкой
        const rect = sortButton.getBoundingClientRect();
        popup.style.top = `${rect.bottom + window.scrollY + 5}px`; // 5px отступ снизу
        popup.style.display = 'block';
        sortButton.setAttribute('aria-expanded', 'true');
        const edgeGap = 8;
        const rightLimit = document.documentElement.clientWidth - popup.offsetWidth - edgeGap;
        const left = Math.max(edgeGap, Math.min(rect.left, rightLimit));
        popup.style.left = `${left + window.scrollX}px`;

        // Отмечаем активную опцию
        updateActiveSortOption();

        // Добавляем слушатель для закрытия по клику вне
        setTimeout(() => { // Небольшая задержка, чтобы не сработал на текущий клик
            document.addEventListener('click', closeSortPopupOnClickOutside, true);
        }, 0);
    }
}

function closeSortPopupOnClickOutside(event) {
    const popup = document.getElementById('sort-popup');
    const sortButton = document.getElementById('sort-btn');
    // Проверяем, что клик был не по попапу и не по кнопке
    if (popup && sortButton && !popup.contains(event.target) && !sortButton.contains(event.target)) {
        popup.style.display = 'none';
        sortButton.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', closeSortPopupOnClickOutside, true);
    }
}

function updateActiveSortOption() {
    const popup = document.getElementById('sort-popup');
    if (!popup) return;
    const currentSortValue = `${STATE.sortBy}_${STATE.sortOrder}`;
    popup.querySelectorAll('.sort-option').forEach(option => {
        option.classList.toggle('active', option.dataset.value === currentSortValue);
    });
}

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
    document.getElementById('sort-btn')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeSortPopupOnClickOutside, true);

    // Применяем сортировку
    applyFiltersAndSort();
}

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
    const sortLabel = sortButton.querySelector('.sort-label');

    if (sortLabel) {
        sortLabel.textContent =
        options[currentSortValue] || 'Сортировка';
    }
}

function sortNovelsByCurrentPreference(novels) {
    const sortField = STATE.sortBy;
    const sortMultiplier =
        STATE.sortOrder === 'asc' ? 1 : -1;

    return [...novels].sort((a, b) => {
        if (
            sortField === 'title' ||
            sortField === 'author'
        ) {
            const valA = a[sortField] || '';
            const valB = b[sortField] || '';

            return valA.localeCompare(
                valB,
                'ru',
                { sensitivity: 'base' }
            ) * sortMultiplier;
        }

        if (
            sortField === 'updated' ||
            sortField === 'added'
        ) {
            const fieldName =
                sortField === 'updated'
                    ? 'updated_at'
                    : 'created_at';

            const valA = a[fieldName]
                ? new Date(a[fieldName])
                : new Date(0);

            const valB = b[fieldName]
                ? new Date(b[fieldName])
                : new Date(0);

            return (valA - valB) * sortMultiplier;
        }

        return 0;
    });
}

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

    const query = STATE.catalogSearchQuery;
    let novelsToProcess = STATE.novels.filter(novel => !query || getCatalogSearchMatch(novel, query));

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
    novelsToProcess =
        sortNovelsByCurrentPreference(novelsToProcess);
    
    // --- ШАГ 3: ОБНОВЛЕНИЕ СОСТОЯНИЯ И РЕНДЕРИНГ ---
    STATE.filteredNovels = novelsToProcess; // Сохраняем отфильтрованный и отсортированный результат
    STATE.currentPage = 1; // Сбрасываем на первую страницу
    renderNovelsGrid(STATE.filteredNovels); // Обновляем сетку
    renderPagination(); // Обновляем пагинацию
    updateFilterInfo(); // Обновляем инфо о фильтрах/сортировке (если есть)

}

function updateFilterInfo() {
    const toggle = document.getElementById('filter-toggle');
    if (!toggle) return;
    const filters = STATE.currentFilters;
    const fields = ['language', 'era', 'perspective', 'orientation', 'originalStatus', 'translationStatus', 'chaptersMin', 'chaptersMax', 'wordsMin', 'wordsMax'];
    const count = fields.filter(key => filters[key] !== '' && filters[key] != null).length
        + (filters.includeTags?.length || 0) + (filters.excludeTags?.length || 0);
    toggle.querySelector('[data-filter-caption]').textContent = count ? `Фильтры · ${count}` : 'Фильтры';
    toggle.classList.toggle('has-filters', count > 0);
}

function getSelectedTags(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.filter-tag.active')).map(tag => tag.dataset.value);
}

function checkTaxonomyFilter(itemTaxonomies, selectedTaxonomies, mode, isExclude = false) {
    if (!Array.isArray(itemTaxonomies)) itemTaxonomies = [];
    if (selectedTaxonomies.length === 0) {
        return true;
    }

    const lowerItemTaxonomies = itemTaxonomies.map(t => String(t || '').toLowerCase());
    let result = true; // Результат по умолчанию

    if (isExclude) {
        const matches = tax => lowerItemTaxonomies.includes(String(tax || '').toLowerCase());
        const hasExcluded = mode === 'all'
            ? selectedTaxonomies.every(matches)
            : selectedTaxonomies.some(matches);
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

function setupAdvancedFilters() {
    // Поддерживаем текущую конфигурацию сервера и прежние имена параметров.
    const facets = [
        ['language-filter', 'languages', 'LANGUAGES', 'language'],
        ['era-filter', 'eras', 'ERAS', 'era'],
        ['orientation-filter', 'orientations', 'ORIENTATIONS', 'orientation'],
        ['perspective-filter', 'perspectives', 'PERSPECTIVES', 'perspective'],
        ['original-status-filter', 'statusOptions', 'STATUS_OPTIONS', 'original_status'],
        ['translation-status-filter', 'statusOptions', 'STATUS_OPTIONS', 'translation_status']
    ];
    facets.forEach(([id, key, legacyKey, field]) => {
        const configured = STATE.config[key] || STATE.config[legacyKey] || [];
        const values = [...new Set([...configured, ...STATE.novels.map(novel => novel[field])].filter(Boolean))];
        populateSelect(id, values);
    });

    // Рендерим карту тегов
    renderFilterTagMap();

    initTooltips()
}

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

function renderFilterTagMap() {
    const container = document.getElementById('filter-tags-map');
    if (!container || !Array.isArray(STATE.tags)) {
        if (container) container.innerHTML = '<p class="text-danger">Не удалось загрузить теги.</p>';
        return;
    }

    if (STATE.tags.length === 0) {
        container.innerHTML = '<p class="text-muted">Нет доступных тегов.</p>';
        return;
    }

    container.innerHTML = STATE.tags.map(tag => `
        <div class="filter-tag-item"
             data-value="${catalogAttribute(tag.name)}"
             data-description="${catalogAttribute(tag.description)}">
            <button type="button" class="filter-tag-name" aria-pressed="false"
                    onclick="handleTagFilterClick(this, this.closest('.exclude-active') ? 'exclude' : 'include')">${escapeHtml(tag.name)}</button>
            <button type="button" class="tag-filter-btn include-btn" title="Включить" aria-label="Включить тег: ${catalogAttribute(tag.name)}" aria-pressed="false" onclick="handleTagFilterClick(this, 'include')">+</button>
            <button type="button" class="tag-filter-btn exclude-btn" title="Исключить" aria-label="Исключить тег: ${catalogAttribute(tag.name)}" aria-pressed="false" onclick="handleTagFilterClick(this, 'exclude')">−</button>
        </div>
    `).join('');

    // Восстанавливаем состояние из STATE.currentFilters, если оно есть
    updateTagMapSelectionFromState();
    filterCatalogTags(document.getElementById('catalog-tag-search')?.value || '');
}

function filterCatalogTags(value) {
    const query = value.trim().toLocaleLowerCase('ru');
    const items = document.querySelectorAll('#filter-tags-map .filter-tag-item');
    let visible = 0;
    items.forEach(item => {
        item.hidden = !item.dataset.value.toLocaleLowerCase('ru').includes(query);
        if (!item.hidden) visible += 1;
    });
    const empty = document.getElementById('catalog-tags-empty');
    if (empty) empty.hidden = !items.length || visible > 0;
}

function syncCatalogTagButtons(item) {
    const included = item.classList.contains('include-active');
    const excluded = item.classList.contains('exclude-active');
    item.querySelector('.filter-tag-name')?.setAttribute('aria-pressed', String(included || excluded));
    item.querySelector('.include-btn')?.setAttribute('aria-pressed', String(included));
    item.querySelector('.exclude-btn')?.setAttribute('aria-pressed', String(excluded));
    const includeButton = item.querySelector('.include-btn');
    if (includeButton) includeButton.textContent = included ? '✓' : '+';
    item.querySelector('.filter-tag-name')?.setAttribute('aria-label',
        `${included ? 'Включён' : excluded ? 'Исключён' : 'Включить'}: ${item.dataset.value}${included || excluded ? '. Нажмите, чтобы снять выбор' : ''}`);
}

function handleTagFilterClick(buttonElement, mode) { // mode: 'include' or 'exclude'
    const tagItem = buttonElement.closest('.filter-tag-item');
    if (!tagItem) return;
    document.getElementById('custom-tooltip')?.classList.remove('show');

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
    syncCatalogTagButtons(tagItem);
    updateFiltersFromTagMap();

    // Применяем фильтры
    applyFiltersAndSort();
}

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
        syncCatalogTagButtons(item);
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

function updateSelectedTagsDisplay(containerId, tagNames, type) { // type: 'include' or 'exclude'
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = tagNames.map(name => {
        const description = STATE.tags?.find(tag => tag.name === name)?.description;
        return `<button type="button" class="selected-tag ${type}" data-value="${catalogAttribute(name)}" data-description="${catalogAttribute(description)}" onclick="removeCatalogTag(this, '${type}')" aria-label="Убрать тег: ${catalogAttribute(name)}">${escapeHtml(name)}<span aria-hidden="true"> ×</span></button>`;
    }).join('');
}

function removeCatalogTag(button, type) {
    const field = type === 'include' ? 'includeTags' : 'excludeTags';
    STATE.currentFilters[field] = STATE.currentFilters[field].filter(name => name !== button.dataset.value);
    updateTagMapSelectionFromState();
    applyFiltersAndSort();
    document.getElementById('catalog-tag-search')?.focus({ preventScroll: true });
}

function filterByTag(tagName) {
    navigateTo('home');

    setTimeout(() => {
        resetFilterControlsAndState();
        STATE.catalogSearchQuery = '';
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        const clearSearch = document.getElementById('catalog-search-clear');
        if (clearSearch) clearSearch.hidden = true;

        const tagItem = Array.from(
            document.querySelectorAll('#filter-tags-map .filter-tag-item')
        ).find(item => item.dataset.value === tagName);

        if (!tagItem) {
            showToast(`Тег "${tagName}" не найден в фильтрах`, 'warning');
            return;
        }

        tagItem.classList.add('include-active');
        updateFiltersFromTagMap();
        applyFiltersAndSort();
        showToast(`Фильтр: тег "${tagName}"`, 'info');
    }, 300);
}


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

function handleTooltipMouseOver(e) {
    const target = e.target.closest('[data-description]');
    const tooltip = document.getElementById('custom-tooltip');
    if (target && tooltip) {
        const description = target.dataset.description;
        if (description && description.trim() !== '') {
            const host = target.closest('dialog') || document.body;
            if (tooltip.parentElement !== host) host.appendChild(tooltip);
            tooltip.textContent = description;
            updateTooltipPosition(e, tooltip); // Сначала позиционируем
            tooltip.classList.add('show'); // Добавляем класс для плавного появления
        } else {
            tooltip.classList.remove('show'); // Убираем класс, если описание пустое
        }
    }
}

function handleTooltipMouseOut(e) {
    const target = e.target.closest('[data-description]');
    const tooltip = document.getElementById('custom-tooltip');
    if (target && tooltip) {
         tooltip.classList.remove('show'); // Просто убираем класс при уходе мыши
    }
}

function handleTooltipMouseMove(e) {
    const tooltip = document.getElementById('custom-tooltip');
    if (tooltip?.classList.contains('show')) {
        updateTooltipPosition(e, tooltip);
    }
}

function updateTooltipPosition(e, tooltip) {
    // Убедимся, что tooltip существует перед доступом к offsetWidth/offsetHeight
    if (!tooltip) return;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const cursorPadding = 15;

    let left = e.clientX + cursorPadding;
    let top = e.clientY + cursorPadding;

    // Проверка выхода за края окна
    const scrollX = 0;
    const scrollY = 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Проверка правого края
    if (left + tooltipWidth > scrollX + viewportWidth) {
        left = e.clientX - tooltipWidth - cursorPadding;
    }
    // Проверка левого края
    if (left < scrollX) {
         left = e.clientX + cursorPadding; // Возвращаем справа от курсора
    }

    // Проверка нижнего края
    if (top + tooltipHeight > scrollY + viewportHeight) {
        top = e.clientY - tooltipHeight - cursorPadding;
    }
     // Проверка верхнего края
    if (top < scrollY) {
         top = e.clientY + cursorPadding; // Возвращаем снизу от курсора
    }

    // После переноса относительно курсора подсказка всё равно должна помещаться
    // на узком экране и внутри верхнего слоя диалога.
    tooltip.style.left = `${Math.max(8, Math.min(left, viewportWidth - tooltipWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(top, viewportHeight - tooltipHeight - 8))}px`;
}

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
        gridBtn.setAttribute('aria-pressed', String(mode === 'grid'));
        listBtn.setAttribute('aria-pressed', String(mode === 'list'));
    }

    // Перерисовываем сетку с учетом пагинации
    renderNovelsGrid(STATE.filteredNovels);
}

function performSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    STATE.catalogSearchQuery = input.value.trim().toLocaleLowerCase('ru');
    applyFiltersAndSort();
}
