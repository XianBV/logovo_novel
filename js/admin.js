/* ==========================================
   ЛОГОВО НОВЕЛЛ — АДМИН-ПАНЕЛЬ
   Страница администрирования и управления
   ========================================== */

console.log('📦 admin.js загружен');

//=============================
// Админка
//=============================

async function renderAdminPage() {
    const container = document.getElementById(
        'page-content-container'
    );

    if (!container) {
        return;
    }

    container.innerHTML = `
        <section class="admin-page">
            <header class="admin-page-header">
                <div>
                    <p class="admin-page-eyebrow">
                        Управление сайтом
                    </p>

                    <h2>Админ-панель</h2>

                    <p class="admin-page-description">
                        Пользователи, заявки, контент и настройки
                        сайта в одном месте.
                    </p>
                </div>

                <button
                    type="button"
                    class="btn btn-secondary"
                    onclick="navigateTo('home')"
                >
                    Вернуться на сайт
                </button>
            </header>

            <div
                id="admin-page-content"
                class="admin-content"
            ></div>
        </section>
    `;

    await loadAdminData();
}

function openAdminPanel() {
    navigateTo('admin');
}

function getAdminContentRoot() {
    return (
        document.getElementById('admin-page-content') ||
        document.getElementById('admin-content')
    );
}

async function loadAdminData() {
    const content = getAdminContentRoot();
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
            tagsResponse,
            limitPersonalResponse,
            limitCommunityResponse,
            submissionsResponse
        ] = await Promise.all([
            apiRequest('getDashboardData'),
            apiRequest('getAllUsers'),
            apiRequest('getTags'),
            apiRequest('getSetting', { key: 'global_limit_personal' }),
            apiRequest('getSetting', { key: 'global_limit_community' }),
            apiRequest('getSubmissions', { status: 'pending' }, true)
        ]);

        const dashboardData = dashboardResponse?.success
            ? dashboardResponse
            : null;
        const usersData = usersResponse?.success
            ? usersResponse.users
            : [];
        const tagsData = tagsResponse?.success && Array.isArray(tagsResponse.tags)
            ? tagsResponse.tags
            : [];

        STATE.tags = tagsData;

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
        if (!tagsResponse?.success) console.error("Ошибка загрузки тегов:", tagsResponse?.error);

        const submissionsData =
            submissionsResponse?.success &&
            Array.isArray(submissionsResponse.submissions)
                ? submissionsResponse.submissions
                : [];

        if (!submissionsResponse?.success) {
            console.error(
                'Ошибка загрузки заявок:',
                submissionsResponse?.error
            );
        }

        renderAdminPanel(dashboardData, usersData, tagsData, limitsData, submissionsData);

    } catch (error) { // Эта ошибка ловит проблемы с самим apiRequest (например, сеть)
        console.error("Критическая ошибка загрузки данных админки:", error);
        content.innerHTML = `<p class="text-danger">Ошибка загрузки данных: ${error.message}</p>`;
    }
}

function renderUsersTableRows(users) {
    if (!users || users.length === 0) {
        return '<tr><td colspan="7" class="text-center">Пользователи не найдены</td></tr>';
    }
    const currentUserId = String(STATE.currentUser?.user_id ?? '');
    const currentUserIsOwner = STATE.currentUser?.role === 'owner' || currentUserId === '0';
    return users.map(user => {
        const isSelf = String(user.user_id) === currentUserId;
        const isProtectedOwner = user.role === 'owner' || String(user.user_id) === '0';
        const canBlock = !isSelf && !isProtectedOwner && (currentUserIsOwner || user.role !== 'admin');
        const canDelete = currentUserIsOwner && !isSelf && !isProtectedOwner;
        return `
            <tr>
                <td>${user.user_id}</td>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.email || '-')}</td>
                <td><span class="role-badge role-${user.role}">${getDisplayRoleName(user.role)}</span></td>
                <td><span class="user-status-badge ${user.is_banned ? 'is-blocked' : 'is-active'}">${user.is_banned ? 'Заблокирован' : 'Активен'}</span></td>
                <td>${formatDate(user.created_at)}</td>
                <td class="table-actions">
                    <button class="btn btn-sm btn-secondary" onclick="editUserRole(${user.user_id}, '${user.role}')">Изменить роль</button>
                    ${canBlock ? `<button class="btn btn-sm ${user.is_banned ? 'btn-secondary' : 'btn-warning'}" onclick="handleToggleUserBlock(${user.user_id}, ${user.is_banned ? 'false' : 'true'})">${user.is_banned ? 'Разблокировать' : 'Заблокировать'}</button>` : ''}
                    ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="handleDeleteUser(${user.user_id})">Удалить навсегда</button>` : ''}
                </td>
            </tr>`;
    }).join('');
}

function renderAdminPanel(dashboardData, users, tags, limits, submissions) {
    const content = getAdminContentRoot();
    if (!content) return;

    // Определяем наши вкладки
    const tabs = {
        stats: '📊 Дашборд',
        submissions: '📥 Заявки',
        users: '👥 Пользователи',
        access: '🔒 Доступы',
        tags: '🔖 Теги',
        trash: '🗑️ Корзина',
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
        <div id="admin-tab-submissions" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-users" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-access" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-tags" class="admin-tab-content" style="display: none;"></div>
        <div id="admin-tab-trash" class="admin-tab-content" style="display: none;"></div>
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

    const submissionsContent = document.getElementById(
        'admin-tab-submissions'
    );

    if (submissionsContent) {
        const typeNames = {
            author: 'Автор',
            tag: 'Тег',
            novel_request: 'Запрос новеллы',
            other: 'Другое'
        };

        const submissionsHtml =
            submissions && submissions.length > 0
                ? submissions.map(submission => {
                    const aliases = Array.isArray(
                        submission.payload?.aliases
                    )
                        ? submission.payload.aliases
                        : [];

                    return `
                        <article class="submission-card">
                            <div class="submission-card-header">
                                <span class="submission-type">
                                    ${escapeHtml(
                                        typeNames[
                                            submission.submission_type
                                        ] || submission.submission_type
                                    )}
                                </span>

                                <span class="submission-status">
                                    Ожидает проверки
                                </span>
                            </div>

                            <h4>
                                ${escapeHtml(submission.title || '')}
                            </h4>

                            ${
                                aliases.length > 0
                                    ? `
                                        <p class="submission-aliases">
                                            <strong>
                                                Альтернативные имена:
                                            </strong>
                                            ${aliases
                                                .map(alias =>
                                                    escapeHtml(alias)
                                                )
                                                .join(', ')}
                                        </p>
                                    `
                                    : ''
                            }

                            ${
                                submission.body
                                    ? `
                                        <p class="submission-body">
                                            ${escapeHtml(submission.body)}
                                        </p>
                                    `
                                    : ''
                            }

                            <div class="submission-meta">
                                Отправитель: #${escapeHtml(
                                    String(submission.created_by || '—')
                                )}
                                ·
                                ${formatDate(submission.created_at)}
                            </div>
                        </article>
                    `;
                }).join('')
                : `
                    <div class="empty-state">
                        <p>Новых заявок пока нет.</p>
                    </div>
                `;

        submissionsContent.innerHTML = `
            <div class="admin-section-header">
                <div>
                    <h3>Заявки</h3>
                    <p class="text-muted">
                        Предложения, ожидающие модерации
                    </p>
                </div>

                <span class="submission-count">
                    ${submissions?.length || 0}
                </span>
            </div>

            <div class="submissions-list">
                ${submissionsHtml}
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
                        <tr><th>ID</th><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th><th>Создан</th><th>Действия</th></tr>
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

    // Вкладка "Теги"
    const tagsContent = document.getElementById('admin-tab-tags');
    if (tagsContent) {
        let tagsHtml = '<p class="text-muted">Теги не загружены или отсутствуют.</p>';
        if (Array.isArray(tags)) {
            if (tags.length > 0) {
                 tagsHtml = tags.map(t => `
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
             console.warn("Данные тегов не получены или имеют неверный формат:", tags);
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

function handleToggleUserBlock(userId, shouldBlock) {
    showConfirmModal(
        shouldBlock ? 'Заблокировать пользователя' : 'Разблокировать пользователя',
        shouldBlock
            ? `Пользователь ID ${userId} сразу выйдет из аккаунта и не сможет войти снова, пока вы его не разблокируете.`
            : `Пользователь ID ${userId} снова сможет войти на сайт.`,
        async () => {
            showLoading(true, { title: shouldBlock ? 'Блокировка...' : 'Разблокировка...' });
            try {
                const response = await apiPostRequest(shouldBlock ? 'blockUser' : 'unblockUser', { user_id: userId });
                if (response.success) {
                    showToast(response.message, 'success');
                    await loadAdminData();
                } else { throw new Error(response.error); }
            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    );
}

// Полное удаление доступно только владельцу и специально требует два подтверждения.
function handleDeleteUser(userId) {
    showConfirmModal(
        'Безвозвратное удаление пользователя',
        `Пользователь ID ${userId} и все его личные данные будут удалены. Его новеллы сохранятся и перейдут владельцу сайта. Продолжить?`,
        () => {
            showConfirmModal(
                'Последнее подтверждение',
                'Отменить это действие после удаления будет невозможно. Обычно безопаснее использовать блокировку.',
                async () => {
                    showLoading(true, { title: 'Полное удаление пользователя...' });
                    try {
                        const response = await apiPostRequest('deleteUser', { user_id: userId });
                        if (response.success) {
                            showToast(response.message, 'success');
                            await loadAdminData();
                        } else { throw new Error(response.error); }
                    } catch (error) {
                        showToast('Ошибка удаления: ' + error.message, 'error');
                    } finally {
                        showLoading(false);
                    }
                }
            );
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

// ==========================================
// ВКЛАДКИ И КОРЗИНА
// ==========================================

function showAdminTab(tabName, buttonElement) {
    const root =
        buttonElement?.closest('.admin-content') ||
        getAdminContentRoot();

    if (!root) {
        return;
    }

    // Скрываем содержимое всех вкладок только этой панели
    root.querySelectorAll('.admin-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    // Снимаем активное состояние только с кнопок этой панели
    root.querySelectorAll('.admin-tabs .tab-btn').forEach(button => {
        button.classList.remove('active');
    });

    // Показываем выбранную вкладку
    const activeContent = root.querySelector(
        `#admin-tab-${tabName}`
    );

    if (activeContent) {
        activeContent.style.display = 'block';
    }

    if (buttonElement) {
        buttonElement.classList.add('active');
    }
}

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
