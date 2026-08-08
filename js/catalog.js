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

    // ✨ Если это первый запуск, показываем скелет
    if (isSkeleton) {
    // Применяем правильный класс в зависимости от режима просмотра (до вставки skeleton)
    grid.className = STATE.viewMode === 'list' ? 'novels-grid list-view' : 'novels-grid';
        
        // Рисуем 12 skeleton карточек
        grid.innerHTML = Array(12).fill(null).map(() => renderSkeletonCard()).join('');
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

        novelsCount.classList.remove('skeleton-loader'); // Убираем скелетон
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

function renderNovelCard(novel) {
    const isListView = STATE.viewMode === 'list';
    let cardClass = 'novel-card';
    let overlayHtml = '';
    
    // Проверяем: если новелла "по ссылке" ИЛИ "приватная", берем slug. Для публичных (public) оставляем ID.
    const useSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
    const linkIdentifier = useSlug ? novel.slug : novel.novel_id;
    
    const novelUrl = `/?page=novel-details&id=${linkIdentifier}`;
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

function highlightMatch(text, query) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return escapeHtml(text);
    
    const before = escapeHtml(text.substring(0, index));
    const match = escapeHtml(text.substring(index, index + query.length));
    const after = escapeHtml(text.substring(index + query.length));
    
    return `${before}<strong>${match}</strong>${after}`;
}

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
        });
    }

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

function closeSortPopupOnClickOutside(event) {
    const popup = document.getElementById('sort-popup');
    const sortButton = document.getElementById('sort-btn');
    // Проверяем, что клик был не по попапу и не по кнопке
    if (popup && sortButton && !popup.contains(event.target) && !sortButton.contains(event.target)) {
        popup.style.display = 'none';
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

function setupAdvancedFilters() {
    // Заполняем простые селекты
    populateSelect('language-filter', STATE.config.LANGUAGES);
    populateSelect('era-filter', STATE.config.ERAS);
    populateSelect('orientation-filter', STATE.config.ORIENTATIONS);
    populateSelect('perspective-filter', STATE.config.PERSPECTIVES);
    populateSelect('original-status-filter', STATE.config.STATUS_OPTIONS);
    populateSelect('translation-status-filter', STATE.config.STATUS_OPTIONS);

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
             data-value="${escapeHtml(tag.name)}"
             data-description="${tag.description ? escapeHtml(tag.description) : ''}">
            <span class="filter-tag-name">${escapeHtml(tag.name)}</span>
            <button class="tag-filter-btn include-btn" title="Включить" onclick="handleTagFilterClick(this, 'include')">+</button>
            <button class="tag-filter-btn exclude-btn" title="Исключить" onclick="handleTagFilterClick(this, 'exclude')">-</button>
        </div>
    `).join('');

    // Восстанавливаем состояние из STATE.currentFilters, если оно есть
    updateTagMapSelectionFromState();
}

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
    container.innerHTML = tagNames.map(name =>
        `<span class="selected-tag ${type}">${escapeHtml(name)}</span>`
    ).join('');
}

function filterByTag(tagName) {
    navigateTo('home');

    setTimeout(() => {
        resetFilterControlsAndState();

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
    if (tooltip && tooltip.style.display === 'block') {
        updateTooltipPosition(e, tooltip);
    }
}

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

function performSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    
    const query = input.value.toLowerCase().trim();
    
    if (!query) {
        STATE.filteredNovels =
            sortNovelsByCurrentPreference(
                STATE.novels
            );

        STATE.currentPage = 1;
        renderNovelsGrid(STATE.filteredNovels);
        renderPagination();
        return;
    }
    
    const searchResults = STATE.novels.filter(
        novel =>
            novel.title.toLowerCase().includes(query) ||
            novel.author.toLowerCase().includes(query) ||
            (
                novel.description &&
                novel.description
                    .toLowerCase()
                    .includes(query)
            )
    );

    STATE.filteredNovels =
        sortNovelsByCurrentPreference(searchResults);
    
    STATE.currentPage = 1;
    renderNovelsGrid(STATE.filteredNovels);
    renderPagination();
}
