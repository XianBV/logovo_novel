/* ==========================================
   ЛОГОВО НОВЕЛЛ — УВЕДОМЛЕНИЯ
   Новые главы и настройки книжных полок
   ========================================== */

console.log('📦 notifications.js загружен');

const NOTIFICATION_SHELVES = Object.freeze({
    reading: {
        title: 'Читаю сейчас',
        description: 'Сообщать о новых главах текущего чтения',
        defaultEnabled: true
    },
    favorite: {
        title: 'В любимом',
        description: 'Следить за обновлениями любимых новелл',
        defaultEnabled: true
    },
    want_to_read: {
        title: 'Хочу прочитать',
        description: 'Сообщать об обновлениях отложенных новелл',
        defaultEnabled: false
    },
    completed: {
        title: 'Прочитано',
        description: 'Сообщать, если у завершённого чтения появится новая глава',
        defaultEnabled: false
    },
    dropped: {
        title: 'Брошено',
        description: 'Сообщать об обновлениях брошенных новелл',
        defaultEnabled: false
    }
});

let notificationCenterReady = false;
let notificationLastLoadedAt = 0;
let notificationItems = [];
let notificationSessionKey = null;
let notificationSummaryRequest = 0;

function getNotificationSessionKey() {
    const userId = STATE.currentUser?.user_id;
    return userId === null || userId === undefined ? null : `${userId}:${localStorage.getItem('session_token') || ''}`;
}

function syncNotificationSession() {
    const sessionKey = getNotificationSessionKey();
    if (sessionKey !== notificationSessionKey) {
        notificationSessionKey = sessionKey;
        notificationSummaryRequest += 1;
        notificationLastLoadedAt = 0;
        notificationItems = [];
        updateNotificationBadge(0);
        renderNotificationList([]);
        closeNotificationMenu();
    }
    return sessionKey;
}

function setupNotificationCenter() {
    if (notificationCenterReady) return;
    const button = document.getElementById('notification-btn');
    const menu = document.getElementById('notification-menu');
    const readAllButton = document.getElementById('notification-read-all');
    if (!button || !menu) return;

    notificationCenterReady = true;
    button.addEventListener('click', event => {
        event.stopPropagation();
        toggleNotificationMenu();
    });
    menu.addEventListener('click', event => event.stopPropagation());
    readAllButton?.addEventListener('click', markAllNotificationsRead);
    document.addEventListener('click', event => {
        if (!event.target.closest('#notification-center')) closeNotificationMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeNotificationMenu();
    });
}

function syncNotificationHeaderForUser() {
    syncNotificationSession();
    const center = document.getElementById('notification-center');
    if (!center) return;
    const isSignedIn = Boolean(STATE.currentUser?.user_id !== null && STATE.currentUser?.user_id !== undefined);
    center.style.display = isSignedIn ? 'flex' : 'none';
    if (!isSignedIn) {
        notificationItems = [];
        notificationLastLoadedAt = 0;
        updateNotificationBadge(0);
        closeNotificationMenu();
        return;
    }
    refreshNotificationSummary();
}

async function refreshNotificationSummary(force = false) {
    const sessionKey = syncNotificationSession();
    if (sessionKey === null) return;
    const now = Date.now();
    if (!force && now - notificationLastLoadedAt < 60000) return;
    notificationLastLoadedAt = now;
    const requestId = ++notificationSummaryRequest;
    const isCurrentRequest = () => requestId === notificationSummaryRequest && getNotificationSessionKey() === sessionKey;

    try {
        const response = await apiRequest('getNotifications', { limit: 20 }, true);
        if (!isCurrentRequest()) return;
        if (!response.success) throw new Error(response.error);
        notificationItems = Array.isArray(response.notifications) ? response.notifications : [];
        updateNotificationBadge(Number(response.unread_count) || 0);
        renderNotificationList(notificationItems);
    } catch (error) {
        if (!isCurrentRequest()) return;
        notificationLastLoadedAt = 0;
        updateNotificationBadge(0);
        renderNotificationError(error);
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notification-badge');
    const button = document.getElementById('notification-btn');
    if (!badge || !button) return;
    const safeCount = Math.max(0, Number(count) || 0);
    badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    badge.hidden = safeCount === 0;
    button.setAttribute('aria-label', safeCount
        ? `Открыть уведомления, непрочитанных: ${safeCount}`
        : 'Открыть уведомления');
}

function toggleNotificationMenu() {
    const menu = document.getElementById('notification-menu');
    const button = document.getElementById('notification-btn');
    if (!menu || !button) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) refreshNotificationSummary(true);
}

function closeNotificationMenu() {
    const menu = document.getElementById('notification-menu');
    const button = document.getElementById('notification-btn');
    if (menu) menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
}

function formatNotificationTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'только что';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч. назад`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} дн. назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function renderNotificationList(items) {
    const container = document.getElementById('notification-list');
    const readAllButton = document.getElementById('notification-read-all');
    if (!container) return;
    const hasUnread = items.some(item => !item.is_read);
    if (readAllButton) readAllButton.disabled = !hasUnread;

    if (!items.length) {
        container.innerHTML = `
            <div class="notification-empty">
                ${renderUiIcon('bell')}
                <strong>Пока тихо</strong>
                <span>Новые главы с выбранных полок появятся здесь.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(item => `
        <article class="notification-item${item.is_read ? '' : ' is-unread'}" data-notification-id="${item.notification_id}">
            <button class="notification-main" type="button" onclick="openNotification(${item.notification_id}, '${escapeHtml(String(item.novel_reference))}', '${escapeHtml(String(item.chapter_number ?? ''))}')">
                <span class="notification-item-icon">${renderUiIcon('book')}</span>
                <span class="notification-item-copy">
                    <strong>${escapeHtml(item.title || 'Новая глава')}</strong>
                    <span>${escapeHtml(item.message || '')}</span>
                    <time>${formatNotificationTime(item.created_at)}</time>
                </span>
            </button>
            <button class="notification-delete" type="button" onclick="deleteNotificationItem(${item.notification_id})" title="Удалить уведомление" aria-label="Удалить уведомление">
                ${renderUiIcon('close')}
            </button>
        </article>
    `).join('');
}

function renderNotificationError(error) {
    const container = document.getElementById('notification-list');
    if (!container) return;
    container.innerHTML = `
        <div class="notification-empty notification-error">
            ${renderUiIcon('warning')}
            <strong>Уведомления пока не подключены</strong>
            <span>Интерфейс готов; осталось применить подготовленное обновление базы.</span>
        </div>
    `;
    console.warn('Не удалось загрузить уведомления:', error);
}

function updateNotificationItemLocally(notificationId, patch) {
    notificationItems = notificationItems.map(item => (
        Number(item.notification_id) === Number(notificationId) ? { ...item, ...patch } : item
    ));
    renderNotificationList(notificationItems);
    updateNotificationBadge(notificationItems.filter(item => !item.is_read).length);
}

function openNotification(notificationId, novelReference, chapterNumber) {
    updateNotificationItemLocally(notificationId, { is_read: true });
    apiPostRequest('markNotificationRead', { notification_id: notificationId }).catch(error => {
        console.warn('Не удалось отметить уведомление прочитанным:', error);
    });
    closeNotificationMenu();
    navigateTo('chapter-read', { novel: novelReference, chapter: chapterNumber });
}

async function markAllNotificationsRead() {
    const sessionKey = getNotificationSessionKey();
    const unread = notificationItems.filter(item => !item.is_read);
    if (!unread.length) return;
    notificationItems = notificationItems.map(item => ({ ...item, is_read: true }));
    renderNotificationList(notificationItems);
    updateNotificationBadge(0);
    try {
        const response = await apiPostRequest('markAllNotificationsRead', {});
        if (!response.success) throw new Error(response.error);
    } catch (error) {
        if (getNotificationSessionKey() !== sessionKey) return;
        notificationLastLoadedAt = 0;
        showToast('Не удалось отметить уведомления', 'error');
    }
}

async function deleteNotificationItem(notificationId) {
    const sessionKey = getNotificationSessionKey();
    const previousItems = notificationItems;
    notificationItems = notificationItems.filter(item => Number(item.notification_id) !== Number(notificationId));
    renderNotificationList(notificationItems);
    updateNotificationBadge(notificationItems.filter(item => !item.is_read).length);
    try {
        const response = await apiPostRequest('deleteNotification', { notification_id: notificationId });
        if (!response.success) throw new Error(response.error);
    } catch (error) {
        if (getNotificationSessionKey() !== sessionKey) return;
        notificationItems = previousItems;
        renderNotificationList(notificationItems);
        updateNotificationBadge(notificationItems.filter(item => !item.is_read).length);
        showToast('Не удалось удалить уведомление', 'error');
    }
}

function renderNotificationSettingsMarkup() {
    return `
        <section class="notification-settings-card">
            <header>
                ${renderUiIcon('bell')}
                <span>
                    <h3>Новые главы</h3>
                    <p>Выберите полки, обновления которых должны появляться в уведомлениях.</p>
                </span>
            </header>
            <div id="notification-shelf-settings" class="notification-shelf-settings">
                <div class="notification-settings-loading">Загрузка настроек…</div>
            </div>
        </section>
    `;
}

async function loadNotificationShelfSettings() {
    const container = document.getElementById('notification-shelf-settings');
    if (!container || container.dataset.loaded === 'true') return;
    try {
        const response = await apiRequest('getNotificationShelfSettings', {}, true);
        if (!response.success) throw new Error(response.error);
        container.dataset.loaded = 'true';
        renderNotificationShelfSettings(response.settings || {});
    } catch (error) {
        container.innerHTML = '<p class="notification-settings-error">Настройки станут доступны после подключения таблиц уведомлений.</p>';
    }
}

function renderNotificationShelfSettings(settings) {
    const container = document.getElementById('notification-shelf-settings');
    if (!container) return;
    container.innerHTML = Object.entries(NOTIFICATION_SHELVES).map(([listType, shelf]) => {
        const enabled = Object.hasOwn(settings, listType) ? settings[listType] === true : shelf.defaultEnabled;
        return `
            <label class="notification-setting-row">
                <span>
                    <strong>${shelf.title}</strong>
                    <small>${shelf.description}</small>
                </span>
                <input type="checkbox" ${enabled ? 'checked' : ''} onchange="saveNotificationShelfSetting('${listType}', this)">
                <span class="notification-switch" aria-hidden="true"></span>
            </label>
        `;
    }).join('');
}

async function saveNotificationShelfSetting(listType, input) {
    const row = input.closest('.notification-setting-row');
    input.disabled = true;
    row?.classList.add('is-saving');
    try {
        const response = await apiPostRequest('updateNotificationShelfSetting', {
            list_type: listType,
            enabled: input.checked
        });
        if (!response.success) throw new Error(response.error);
        showToast('Настройка уведомлений сохранена', 'success');
    } catch (error) {
        input.checked = !input.checked;
        showToast('Не удалось сохранить настройку', 'error');
    } finally {
        input.disabled = false;
        row?.classList.remove('is-saving');
    }
}
