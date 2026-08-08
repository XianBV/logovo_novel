/* ==========================================
   ЛОГОВО НОВЕЛЛ — АВТОРЫ
   Страницы авторов, поиск и заявки
   ========================================== */

console.log('📦 authors.js загружен');

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

function setupAuthorAutocomplete() {
    const authorInput = document.getElementById('novel-author-search');
    const authorValueInput = document.getElementById('novel-author-value');

    if (!authorInput || !authorValueInput) {
        return;
    }

    let autocompleteList = null;
    let debounceTimer = null;
    let requestNumber = 0;

    function removeAutocompleteList() {
        if (autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    }

    function createAutocompleteList() {
        removeAutocompleteList();

        autocompleteList = document.createElement('div');
        autocompleteList.className =
            'autocomplete-list author-autocomplete';
        autocompleteList.setAttribute('role', 'listbox');
        autocompleteList.style.width =
            `${authorInput.offsetWidth}px`;

        authorInput.parentElement.appendChild(autocompleteList);

        return autocompleteList;
    }

    function showAutocompleteState(message, stateClass = '') {
        const list = createAutocompleteList();

        const state = document.createElement('div');
        state.className =
            `autocomplete-item author-autocomplete-state ${stateClass}`;
        state.setAttribute('role', 'status');
        state.textContent = message;

        list.appendChild(state);
    }

    function showAddAuthorOption(query) {
        const list = createAutocompleteList();

        const emptyState = document.createElement('div');
        emptyState.className =
            'autocomplete-item author-autocomplete-state';
        emptyState.textContent = 'Авторы не найдены';
        list.appendChild(emptyState);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className =
            'autocomplete-item author-autocomplete-add';

        addButton.innerHTML = `
            <span class="author-add-icon">＋</span>
            <span>
                <strong>Предложить нового автора</strong>
                <small>${escapeHtml(query)}</small>
            </span>
        `;

        addButton.addEventListener('click', () => {
            removeAutocompleteList();
            openAuthorSubmissionModal(query);
        });

        list.appendChild(addButton);
    }

    function renderAuthors(authors, query) {
        const list = createAutocompleteList();

        authors.forEach(author => {
            const item = document.createElement('button');

            item.type = 'button';
            item.className = 'autocomplete-item author-result-item';
            item.setAttribute('role', 'option');

            const aliases = Array.isArray(author.aliases)
                ? author.aliases
                : String(author.aliases || '')
                    .split('|')
                    .map(alias => alias.trim())
                    .filter(Boolean);

            const aliasesHtml = aliases.length > 0
                ? `
                    <span class="author-result-aliases">
                        ${aliases
                            .map(alias => highlightMatch(alias, query))
                            .join('<span class="author-alias-separator"> • </span>')}
                    </span>
                `
                : '';

            item.innerHTML = `
                <span class="author-result-content">
                    <span class="author-result-name">
                        ${highlightMatch(author.name, query)}
                    </span>

                    ${aliasesHtml}
                </span>
            `;

            item.addEventListener('click', () => {
                authorInput.value = author.name;
                authorValueInput.value = author.name;
                authorInput.dataset.authorId = author.id;

                removeAutocompleteList();
            });

            list.appendChild(item);
        });
    }

    authorInput.addEventListener('input', function() {
        const query = this.value.trim();

        /*
         * Пока сохраняем обычное поведение формы.
         * После реализации заявок новый автор больше
         * не будет создаваться простым вводом.
         */
        authorValueInput.value = query;

        /*
         * Пользователь изменил текст после выбора автора —
         * старый ID больше нельзя считать выбранным.
         */
        delete authorInput.dataset.authorId;

        removeAutocompleteList();

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        requestNumber += 1;
        const currentRequest = requestNumber;

        if (query.length === 0) {
            return;
        }

        if (query.length < 2) {
            showAutocompleteState(
                'Введите хотя бы 2 символа'
            );
            return;
        }

        showAutocompleteState(
            'Ищем авторов…',
            'is-loading'
        );

        debounceTimer = setTimeout(async () => {
            try {
                const response = await apiRequest(
                    'searchAuthors',
                    { query },
                    true
                );

                /*
                 * Не отображаем устаревший ответ,
                 * если пользователь уже изменил запрос.
                 */
                if (
                    currentRequest !== requestNumber ||
                    authorInput.value.trim() !== query
                ) {
                    return;
                }

                if (!response.success) {
                    throw new Error(
                        response.error ||
                        'Не удалось выполнить поиск'
                    );
                }

                const authors = Array.isArray(response.authors)
                    ? response.authors
                    : [];

                if (authors.length === 0) {
                    showAddAuthorOption(query);
                    return;
                }

                renderAuthors(authors, query);

            } catch (error) {
                console.error(
                    'Ошибка автодополнения авторов:',
                    error
                );

                if (
                    currentRequest === requestNumber &&
                    authorInput.value.trim() === query
                ) {
                    showAutocompleteState(
                        'Не удалось загрузить авторов',
                        'is-error'
                    );
                }
            }
        }, 300);
    });

    document.addEventListener('click', event => {
        const clickInsideInput =
            authorInput.contains(event.target);

        const clickInsideList =
            autocompleteList &&
            autocompleteList.contains(event.target);

        if (!clickInsideInput && !clickInsideList) {
            removeAutocompleteList();
        }
    });

    authorInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            removeAutocompleteList();
        }
    });
}

function openAuthorSubmissionModal(suggestedName = '') {
    if (!STATE.currentUser) {
        showToast(
            'Для отправки заявки необходимо войти',
            'warning'
        );

        showModal('auth-modal');
        return;
    }

    const nameInput = document.getElementById(
        'author-submission-name'
    );

    const aliasesInput = document.getElementById(
        'author-submission-aliases'
    );

    const bioInput = document.getElementById(
        'author-submission-bio'
    );

    if (!nameInput || !aliasesInput || !bioInput) {
        showToast(
            'Форма предложения автора не найдена',
            'error'
        );
        return;
    }

    nameInput.value = suggestedName.trim();
    aliasesInput.value = '';
    bioInput.value = '';

    showModal('author-submission-modal');

    setTimeout(() => {
        nameInput.focus();
        nameInput.select();
    }, 50);
}


async function handleAuthorSubmission(event) {
    event.preventDefault();

    const nameInput = document.getElementById(
        'author-submission-name'
    );

    const aliasesInput = document.getElementById(
        'author-submission-aliases'
    );

    const bioInput = document.getElementById(
        'author-submission-bio'
    );

    const submitButton = document.getElementById(
        'author-submission-submit'
    );

    const name = nameInput.value.trim();

    const aliases = aliasesInput.value
        .split(/\r?\n/)
        .map(alias => alias.trim())
        .filter(Boolean);

    const bio = bioInput.value.trim();

    if (!name) {
        showToast('Укажите имя автора', 'warning');
        nameInput.focus();
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Отправка…';

    try {
        const response = await apiPostRequest(
            'createAuthorSubmission',
            {
                name,
                aliases,
                bio
            }
        );

        if (!response.success) {
            throw new Error(
                response.error ||
                'Не удалось отправить заявку'
            );
        }

        hideModal('author-submission-modal');

        showToast(
            'Заявка на автора отправлена на модерацию',
            'success'
        );

    } catch (error) {
        console.error(
            'Ошибка отправки заявки автора:',
            error
        );

        showToast(error.message, 'error');

    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Отправить заявку';
    }
}