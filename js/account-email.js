/* Подтверждение почты и восстановление: токен живёт только в памяти вкладки. */
let accountEmailMode = null;
let accountEmailToken = null;
let accountEmailOperation = 0;
let accountEmailBusy = false;
let accountEmailAddress = '';
let accountConfirmationId = null;
let accountEmailCooldownTimer = null;
const accountEmailCooldowns = new Map();

function accountCooldownKey(email, mode) { return `account-mail-cooldown:${mode === 'forgot' ? 'password_reset' : 'email_confirm'}:${String(email).trim().toLowerCase()}`; }
function readAccountSession(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeAccountSession(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
function accountCooldownRemaining(email, mode) {
    const key = accountCooldownKey(email, mode);
    return Math.max(0, Math.ceil(((accountEmailCooldowns.get(key) || Number(readAccountSession(key)) || 0) - Date.now()) / 1000));
}
function refreshAccountEmailCooldown() {
    if (accountEmailCooldownTimer) clearInterval(accountEmailCooldownTimer);
    accountEmailCooldownTimer = null;
    const tick = () => {
        const requestMode = accountEmailMode === 'forgot' || accountEmailMode === 'resend';
        const email = requestMode ? document.getElementById('account-help-email')?.value || '' : accountEmailAddress;
        const button = document.getElementById(requestMode ? 'account-help-submit' : 'account-resend-code');
        if (!button) return 0;
        const remaining = accountCooldownRemaining(email, accountEmailMode);
        button.disabled = accountEmailBusy || remaining > 0;
        button.textContent = remaining ? `Повторить через ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : accountEmailMode === 'forgot' ? 'Отправить ссылку' : 'Отправить код ещё раз';
        if (!remaining && accountEmailCooldownTimer) { clearInterval(accountEmailCooldownTimer); accountEmailCooldownTimer = null; }
        return remaining;
    };
    if (tick()) accountEmailCooldownTimer = setInterval(tick, 1000);
}
function rememberAccountEmailCooldown(email, mode, seconds = 60) {
    const key = accountCooldownKey(email, mode), until = Date.now() + Math.max(60, Math.min(3600, Number(seconds) || 60)) * 1000;
    accountEmailCooldowns.set(key, until); writeAccountSession(key, String(until));
    refreshAccountEmailCooldown();
}
function pendingAccountConfirmation() {
    try { const pending = JSON.parse(readAccountSession('account-pending-confirmation')); return pending && pending.until > Date.now() ? pending : null; } catch { return null; }
}


function hideAccountHelp() {
    if (accountEmailCooldownTimer) clearInterval(accountEmailCooldownTimer);
    accountEmailCooldownTimer = null;
    accountEmailOperation += 1;
    accountEmailBusy = false;
    const container = document.getElementById('account-help-container');
    if (container) container.style.display = 'none';
    ['account-new-password', 'account-repeat-password', 'account-confirm-code'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    setAuthFormDisabled('account-help-form', true);
}

function showAccountHelp(mode, email = '', message = '', confirmationId = null) {
    if (mode === 'resend') { const pending = pendingAccountConfirmation(); if (pending?.email === email) return showAccountHelp('verify', email, message, pending.id); }
    hideAccountHelp();
    accountEmailMode = mode;
    accountEmailAddress = email;
    accountConfirmationId = confirmationId;
    if (mode === 'verify' && confirmationId) {
        const previous = pendingAccountConfirmation();
        writeAccountSession('account-pending-confirmation', JSON.stringify({ email, id: confirmationId, until: previous?.id === confirmationId ? previous.until : Date.now() + 600000 }));
    }
    const container = document.getElementById('account-help-container');
    if (!container) return;
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('registration-container').style.display = 'none';
    setAuthFormDisabled('login-form', true);
    setAuthFormDisabled('registration-form', true);
    const titles = { forgot: 'Восстановить пароль', resend: 'Подтвердите почту', verify: 'Введите код из письма', confirm: 'Подтверждение почты', reset: 'Новый пароль', invalid: 'Ссылка недействительна' };
    const descriptions = {
        forgot: 'Укажите почту аккаунта — отправим ссылку для нового пароля.',
        resend: 'Отправим шестизначный код на почту аккаунта.',
        verify: 'Код действует 10 минут. После пяти неверных попыток потребуется новый код.',
        confirm: 'Нажмите кнопку, чтобы подтвердить, что эта почта принадлежит вам.',
        reset: 'От 8 до 128 символов: латинские буквы, цифры и стандартные знаки. Без пробелов, регистр важен.',
        invalid: 'Запросите новое письмо. Эта ссылка повреждена или уже недоступна.'
    };
    const requestMode = mode === 'forgot' || mode === 'resend';
    container.innerHTML = `<h2 id="account-help-title"></h2><p id="account-help-description" class="auth-hint"></p>
        <form id="account-help-form" class="auth-method" onsubmit="handleAccountEmailSubmit(); return false;">
            ${requestMode ? '<input id="account-help-email" class="form-input" type="email" autocomplete="email" placeholder="Email аккаунта" aria-label="Email аккаунта" maxlength="254" oninput="refreshAccountEmailCooldown()" required>' : ''}
            ${mode === 'verify' ? '<input id="account-confirm-code" class="form-input" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Код из 6 цифр" aria-label="Код подтверждения" pattern="[0-9]{6}" minlength="6" maxlength="6" required>' : ''}
            ${mode === 'reset' ? '<input id="account-new-password" class="form-input" type="password" autocomplete="new-password" placeholder="Новый пароль" aria-label="Новый пароль" minlength="8" maxlength="128" pattern="[!-~]{8,128}" title="Латиница, цифры и стандартные знаки, без пробелов" required><input id="account-repeat-password" class="form-input" type="password" autocomplete="new-password" placeholder="Повторите пароль" aria-label="Повторите новый пароль" minlength="8" maxlength="128" pattern="[!-~]{8,128}" title="Латиница, цифры и стандартные знаки, без пробелов" required>' : ''}
            ${mode !== 'invalid' ? '<button id="account-help-submit" class="btn btn-primary" type="submit"></button>' : ''}
        </form>${mode === 'verify' ? '<button id="account-resend-code" class="btn btn-secondary" type="button" onclick="resendAccountConfirmation()">Отправить код ещё раз</button>' : ''}<p id="account-help-status" class="auth-hint" role="status" aria-live="polite"></p>
        <p class="auth-hint"><a href="#" onclick="showLogin(); return false;">Вернуться ко входу</a></p>`;
    document.getElementById('account-help-title').textContent = titles[mode] || titles.invalid;
    document.getElementById('account-help-description').textContent = descriptions[mode] || descriptions.invalid;
    document.getElementById('account-help-status').textContent = message;
    const submit = document.getElementById('account-help-submit');
    if (submit) submit.textContent = mode === 'reset' ? 'Сохранить новый пароль' : mode === 'confirm' ? 'Подтвердить почту' : mode === 'verify' ? 'Подтвердить код' : mode === 'resend' ? 'Отправить код' : 'Отправить ссылку';
    const input = document.getElementById('account-help-email');
    if (input) input.value = email;
    container.style.display = 'flex';
    showModal('auth-modal', { loadTelegram: false });
    (input || document.getElementById(mode === 'verify' ? 'account-confirm-code' : 'account-new-password') || submit)?.focus();
    refreshAccountEmailCooldown();
}

function captureAccountEmailLink() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (!fragment.has('account_action')) { const pending = pendingAccountConfirmation(); if (pending) showAccountHelp('verify', pending.email, '', pending.id); return; }
    const action = fragment.get('account_action');
    const token = fragment.get('token') || '';
    const clean = new URL(window.location.href);
    clean.hash = '';
    window.history.replaceState(window.history.state, '', clean);
    if (!['reset', 'confirm'].includes(action) || !/^[a-f0-9]{64}$/.test(token)) {
        accountEmailToken = null;
        showAccountHelp('invalid');
        return;
    }
    accountEmailToken = token;
    // Никакого автоматического подтверждения GET-запросом или при открытии ссылки.
    showAccountHelp(action);
}

async function handleAccountEmailSubmit() {
    if (accountEmailBusy || accountEmailMode === 'invalid') return;
    const mode = accountEmailMode;
    const operation = ++accountEmailOperation;
    const status = document.getElementById('account-help-status');
    const data = {};
    const actions = { forgot: 'requestPasswordReset', resend: 'resendEmailConfirmation', confirm: 'confirmEmail', reset: 'resetPassword', verify: 'confirmEmailCode' };
    if (mode === 'forgot' || mode === 'resend') {
        data.email = document.getElementById('account-help-email').value.trim();
        if (!data.email) { status.textContent = 'Укажите email аккаунта'; return; }
        if (accountCooldownRemaining(data.email, mode)) { refreshAccountEmailCooldown(); return; }
    } else if (mode === 'verify') {
        data.confirmation_id = accountConfirmationId;
        data.code = document.getElementById('account-confirm-code').value.trim();
        if (!/^\d{6}$/.test(data.code)) { status.textContent = 'Введите шесть цифр из письма'; return; }
    } else {
        if (!accountEmailToken) { status.textContent = 'Откройте ссылку из письма ещё раз.'; return; }
        data.token = accountEmailToken;
    }
    if (mode === 'reset') {
        data.password = document.getElementById('account-new-password').value;
        if (data.password.length < 8 || data.password.length > 128) { status.textContent = 'Пароль должен содержать от 8 до 128 символов'; return; }
        if (!/^[\x21-\x7E]+$/.test(data.password)) { status.textContent = 'Используйте латинские буквы, цифры и стандартные знаки без пробелов'; return; }
        if (data.password !== document.getElementById('account-repeat-password').value) { status.textContent = 'Пароли не совпадают'; return; }
    }
    accountEmailBusy = true;
    setAuthFormDisabled('account-help-form', true);
    status.textContent = 'Подождите…';
    try {
        const response = await apiPostRequest(actions[mode], data);
        if (operation !== accountEmailOperation) return;
        if (!response.success) {
            if (response.retry_after && data.email) rememberAccountEmailCooldown(data.email, mode, response.retry_after);
            status.textContent = response.error || 'Не удалось выполнить действие'; return;
        }
        if (mode === 'forgot' || mode === 'resend') {
            rememberAccountEmailCooldown(data.email, mode, response.retry_after);
            if (response.confirmation_id) { showAccountHelp('verify', data.email, response.message, response.confirmation_id); return; }
        }
        if (mode === 'reset' || mode === 'confirm' || mode === 'verify') {
            if (mode === 'confirm' || mode === 'verify') { try { sessionStorage.removeItem('account-pending-confirmation'); } catch {} }
            accountEmailToken = null;
            if (mode === 'reset') {
                ['session_token', 'currentUser', 'userRole', 'userFeatures'].forEach(key => localStorage.removeItem(key));
                STATE.currentUser = null;
                clearCache();
                updateUserDisplay();
            }
            showToast(response.message, 'success');
            showLogin();
        } else status.textContent = response.message;
    } catch {
        if (operation === accountEmailOperation) status.textContent = 'Не удалось связаться с сервером. Попробуйте ещё раз.';
    } finally {
        if (operation === accountEmailOperation) {
            accountEmailBusy = false;
            setAuthFormDisabled('account-help-form', false);
            refreshAccountEmailCooldown();
        }
    }
}


async function resendAccountConfirmation() {
    if (accountEmailBusy || accountCooldownRemaining(accountEmailAddress, 'verify')) return;
    const operation = ++accountEmailOperation;
    accountEmailBusy = true;
    refreshAccountEmailCooldown();
    const status = document.getElementById('account-help-status');
    try {
        const response = await apiPostRequest('resendEmailConfirmation', { email: accountEmailAddress });
        if (operation !== accountEmailOperation) return;
        if (response.retry_after || response.success) rememberAccountEmailCooldown(accountEmailAddress, 'verify', response.retry_after);
        if (response.success && response.confirmation_id) showAccountHelp('verify', accountEmailAddress, response.message, response.confirmation_id);
        else status.textContent = response.error || response.message || 'Не удалось отправить письмо';
    } catch { if (operation === accountEmailOperation) status.textContent = 'Сервер недоступен. Попробуйте позже.'; }
    finally { if (operation === accountEmailOperation) { accountEmailBusy = false; refreshAccountEmailCooldown(); } }
}

// Письмо может открыться в уже существующей вкладке без перезагрузки страницы.
window.addEventListener('hashchange', captureAccountEmailLink);
