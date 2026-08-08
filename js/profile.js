/* ==========================================
   ЛОГОВО НОВЕЛЛ — ПРОФИЛЬ
   Профили, полки и общий доступ
   ========================================== */

console.log('📦 profile.js загружен');

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

function updateAllAvatars(avatarUrl) {
    // Если аватарки нет, используем стандартную или генерируем красивую с инициалами
    const defaultAvatarUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23ccc"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="40" fill="%23fff">?</text></svg>';
    
    // Проверяем, что ссылка действительно есть и она не равна строкам "null" или "undefined"
    const finalUrl = (avatarUrl && avatarUrl !== 'null' && avatarUrl !== 'undefined') 
        ? avatarUrl 
        : defaultAvatarUrl;

    // Находим элементы (проверь, чтобы ID совпадали с твоими в index.html)
    const headerAvatar = document.getElementById('header-avatar'); // ID картинки в хедере
    const profileAvatar = document.getElementById('profile-avatar'); // ID картинки в профиле

    if (headerAvatar) headerAvatar.src = finalUrl;
    if (profileAvatar) profileAvatar.src = finalUrl;
}

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

function renderShelfSkeletonCard() {
    return `
        <div class="shelf-novel-item skeleton-card">
            <div class="shelf-novel-cover skeleton"></div>
            <div class="shelf-novel-title skeleton skeleton-text"></div>
        </div>
    `;
}

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

function renderShareModal(novel) {
    // Удаляем старое модальное окно, если оно есть
    const existingModal = document.getElementById('share-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.className = 'modal show visible'; 

    const useSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
    const linkIdentifier = useSlug ? novel.slug : novel.novel_id;

    const shareUrl = `${window.location.origin}/?page=novel-details&id=${linkIdentifier}`;

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

function switchShareTab(button, tabName) {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    
    modal.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    modal.querySelectorAll('.share-tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`share-tab-${tabName}`).classList.add('active');
}

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

function copyToClipboard(selector) {
    const input = document.querySelector(selector);
    if (input) {
        input.select();
        document.execCommand('copy');
        showToast('Ссылка скопирована!', 'success');
    }
}

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
