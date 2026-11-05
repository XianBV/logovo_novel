/* Способы входа текущего аккаунта. Коды и пароли не сохраняются в браузере. */
let accountEmailLinkPending = null;
let accountLinkBusy = false;
let accountLinkView = 0;
let accountLinkCooldownTimer = null;

function renderAccountConnectionsMarkup() {
    return '<section id="account-connections" class="account-connections" aria-label="Способы входа"><h3>Способы входа</h3><p role="status">Загрузка способов входа…</p></section>';
}

async function loadAccountConnections() {
    const container = document.getElementById('account-connections');
    if (!container || !STATE.currentUser) return;
    const userId = STATE.currentUser.user_id, view = ++accountLinkView;
    try {
        const response = await apiPostRequest('getAccountConnections', {});
        if (view !== accountLinkView || document.getElementById('account-connections') !== container || STATE.currentUser?.user_id !== userId) return;
        if (!response.success) throw new Error(response.error || 'Не удалось загрузить способы входа');
        let pending = null;
        try { pending = JSON.parse(sessionStorage.getItem(`account-link-pending:${userId}`)); } catch {}
        accountEmailLinkPending = pending?.until > Date.now() && typeof pending.id === 'string' ? pending : null;
        container.innerHTML = `<h3>Способы входа</h3><p>Один профиль, одни полки — удобный способ входа выбираете вы.</p>
            <article class="account-connection-card"><h4>Почта и пароль</h4>
            ${response.email ? `<p>${escapeHtml(response.email)}</p><p class="text-muted">Почта уже указана в аккаунте.</p>` : `<p class="text-muted">Почта пока не подключена. После подтверждения вы сможете входить также по почте и паролю.</p>
                ${response.linking_enabled ? `<form id="account-email-link-form" onsubmit="submitAccountEmailLink(); return false;">
                    <label for="account-link-email">Почта</label><input id="account-link-email" class="form-input" type="email" maxlength="254" autocomplete="email" required>
                    <label for="account-link-password">Пароль для входа на сайт</label><input id="account-link-password" class="form-input" type="password" minlength="8" maxlength="128" pattern="[!-~]{8,128}" autocomplete="new-password" required>
                    <label for="account-link-password-repeat">Повторите пароль</label><input id="account-link-password-repeat" class="form-input" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
                    <small>8–128 символов: латинские буквы, цифры и стандартные знаки, без пробелов. Регистр важен.</small>
                    <button id="account-link-send" class="btn btn-secondary" type="submit">Отправить код подтверждения</button></form>
                    <form id="account-email-link-confirm" onsubmit="confirmAccountEmailLink(); return false;" hidden>
                    <p id="account-link-code-description"></p><label for="account-link-code">Код из письма</label><input id="account-link-code" class="form-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required>
                    <button class="btn btn-primary" type="submit">Подтвердить почту</button></form>` : '<p>Подключение почты ещё настраивается.</p>'}`}</article>
            <article class="account-connection-card"><h4>Telegram</h4><p>${response.telegram_connected ? 'Подключён к этому аккаунту.' : 'Можно подключить Telegram и входить без почты и пароля.'}</p>
                ${!response.telegram_connected && response.linking_enabled ? '<button id="account-telegram-link" class="btn btn-secondary" type="button" onclick="beginAccountTelegramLink()">Подключить Telegram</button>' : ''}</article>
            <p id="account-link-status" role="status" aria-live="polite"></p>`;
        if (!response.email) restoreAccountEmailLinkForm();
    } catch (error) {
        if (view === accountLinkView && document.getElementById('account-connections') === container) {
            container.innerHTML = '<h3>Способы входа</h3><p role="status"></p><button class="btn btn-secondary" type="button" onclick="loadAccountConnections()">Повторить</button>';
            container.querySelector('[role="status"]').textContent = error.message;
        }
    }
}

function accountLinkStatus(text) {
    const node = document.getElementById('account-link-status');
    if (node) node.textContent = text;
}

function accountLinkContextCurrent(container, userId) {
    return STATE.currentUser?.user_id === userId && document.getElementById('account-connections') === container;
}

function restoreAccountEmailLinkForm() {
    const confirm = document.getElementById('account-email-link-confirm');
    if (confirm) confirm.hidden = !accountEmailLinkPending;
    if (accountEmailLinkPending && confirm) {
        document.getElementById('account-link-code-description').textContent = `Код отправлен на ${accountEmailLinkPending.email}. Он действует 10 минут. Для повторной отправки заполните пароль ещё раз.`;
        document.getElementById('account-link-email').value = accountEmailLinkPending.email;
    }
    refreshAccountLinkCooldown();
}

function refreshAccountLinkCooldown() {
    clearInterval(accountLinkCooldownTimer);
    const userId = STATE.currentUser?.user_id;
    const button = document.getElementById('account-link-send');
    if (!button) return;
    const tick = () => {
        if (document.getElementById('account-link-send') !== button || STATE.currentUser?.user_id !== userId) { clearInterval(accountLinkCooldownTimer); return; }
        let until = 0; try { until = Number(sessionStorage.getItem(`account-link-cooldown:${userId}`)); } catch {}
        const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        button.disabled = accountLinkBusy || remaining > 0;
        button.textContent = remaining ? `Повторить через ${remaining} с` : 'Отправить код подтверждения';
        if (!remaining) clearInterval(accountLinkCooldownTimer);
    };
    tick(); accountLinkCooldownTimer = setInterval(tick, 1000);
}

async function submitAccountEmailLink() {
    if (accountLinkBusy || !STATE.currentUser) return;
    const container = document.getElementById('account-connections'), userId = STATE.currentUser.user_id;
    const email = document.getElementById('account-link-email').value.trim();
    const password = document.getElementById('account-link-password').value;
    if (password !== document.getElementById('account-link-password-repeat').value) { accountLinkStatus('Пароли не совпадают'); return; }
    accountLinkBusy = true; refreshAccountLinkCooldown();
    try {
        const response = await apiPostRequest('beginEmailLink', { email, password });
        if (!accountLinkContextCurrent(container, userId)) return;
        if (response.retry_after) try { sessionStorage.setItem(`account-link-cooldown:${userId}`, String(Date.now() + response.retry_after * 1000)); } catch {}
        if (response.success) {
            accountEmailLinkPending = { id: response.confirmation_id, email: response.email, until: Date.now() + 600000 };
            try { sessionStorage.setItem(`account-link-pending:${userId}`, JSON.stringify(accountEmailLinkPending)); } catch {}
            restoreAccountEmailLinkForm();
            document.getElementById('account-link-code')?.focus();
        }
        accountLinkStatus(response.message || response.error);
    } catch { if (accountLinkContextCurrent(container, userId)) accountLinkStatus('Не удалось связаться с сервером. Повторите попытку.'); }
    finally {
        accountLinkBusy = false;
        if (accountLinkContextCurrent(container, userId)) {
            document.getElementById('account-link-password').value = '';
            document.getElementById('account-link-password-repeat').value = '';
        }
        refreshAccountLinkCooldown();
    }
}

function storeLinkedAccountUser(user) {
    STATE.currentUser = user;
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('userRole', user.role);
    localStorage.setItem('userFeatures', JSON.stringify(user.features || []));
    const emailLabel = document.getElementById('profile-account-email-value');
    if (emailLabel) emailLabel.textContent = user.email || 'Не указан';
    clearCache(); updateUserDisplay();
}

async function confirmAccountEmailLink() {
    if (accountLinkBusy || !accountEmailLinkPending || !STATE.currentUser) return;
    const container = document.getElementById('account-connections'), userId = STATE.currentUser.user_id;
    const form = document.getElementById('account-email-link-confirm');
    accountLinkBusy = true; form.querySelector('button').disabled = true;
    try {
        const response = await apiPostRequest('confirmEmailLink', { confirmation_id: accountEmailLinkPending.id, code: document.getElementById('account-link-code').value });
        if (!accountLinkContextCurrent(container, userId)) return;
        if (response.success) {
            storeLinkedAccountUser(response.user);
            accountEmailLinkPending = null;
            try { sessionStorage.removeItem(`account-link-pending:${userId}`); } catch {}
            await loadAccountConnections(); showToast(response.message, 'success');
        } else accountLinkStatus(response.error);
    } catch { if (accountLinkContextCurrent(container, userId)) accountLinkStatus('Не удалось связаться с сервером. Код можно ввести повторно.'); }
    finally {
        accountLinkBusy = false;
        if (accountLinkContextCurrent(container, userId) && document.getElementById('account-email-link-confirm') === form) { form.querySelector('button').disabled = false; document.getElementById('account-link-code').value = ''; }
        refreshAccountLinkCooldown();
    }
}

async function completeAccountTelegramLink(credentials) {
    const response = await apiPostRequest('linkTelegram', credentials);
    if (!response.success) { showToast(response.error || 'Не удалось подключить Telegram', 'error'); return false; }
    storeLinkedAccountUser(response.user);
    showToast(response.message, 'success');
    setTimeout(() => window.location.reload(), 500);
    return true;
}
