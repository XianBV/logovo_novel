/* Официальный Telegram Login: JWT и подтверждение браузера остаются в памяти. */
let telegramSdkPromise = null;
let telegramLoginGeneration = 0;
let telegramLoginChallenge = null;
let telegramLoginWatchdog = null;
let telegramLoginPreparing = false;
let telegramLoginCleanup = null;
let telegramReturnPromise = null;
const TELEGRAM_REDIRECT_PENDING_KEY = 'logovo.telegram.redirect.v1';

function telegramLoginRedirectUri(href = window.location?.href) {
    if (!href) return undefined;
    const url = new URL(href);
    const path = url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -10) : url.pathname;
    return url.origin + path;
}

function captureTelegramReturn() {
    if (telegramReturnPromise) return telegramReturnPromise;
    if (!window.location?.href) return null;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const providerError = url.searchParams.get('error');
    if (code === null && providerError === null) return null;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(TELEGRAM_REDIRECT_PENDING_KEY)); } catch { /* Повреждённое состояние не принимается. */ }
    if (!pending && !url.searchParams.has('state')) return null;
    const state = url.searchParams.get('state');
    for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.href);
    try { sessionStorage.removeItem(TELEGRAM_REDIRECT_PENDING_KEY); } catch {}
    telegramReturnPromise = (async () => {
        try {
            if (!pending || state !== pending.challenge_id || !/^[a-f0-9-]{36}$/i.test(state || '') ||
                !/^[a-f0-9]{64}$/.test(pending.proof || '') || !Number.isFinite(pending.until) || pending.until <= Date.now() ||
                pending.redirect_uri !== telegramLoginRedirectUri()) throw new Error('invalid_state');
            if (providerError !== null) throw new Error('provider_cancelled');
            if (!code || code.length > 4096) throw new Error('invalid_code');
            const returnUrl = new URL(pending.return_url);
            if (returnUrl.origin !== url.origin || telegramLoginRedirectUri(returnUrl.href) !== pending.redirect_uri) throw new Error('invalid_state');
            window.history.replaceState(window.history.state, '', returnUrl.href);
            if (typeof showLogin === 'function') showLogin();
            if (typeof showModal === 'function') showModal('auth-modal', { loadTelegram: false });
            const ok = await window.onTelegramAuth({ code, challenge_id: state, proof: pending.proof, redirect_uri: pending.redirect_uri });
            if (!ok) await prepareTelegramLogin();
            return ok;
        } catch (error) {
            if (typeof showLogin === 'function') showLogin();
            if (typeof showModal === 'function') showModal('auth-modal', { loadTelegram: false });
            if (typeof showToast === 'function') showToast(error.message === 'provider_cancelled' ? 'Вход отменён в Telegram. Можно попробовать снова.' : 'Подтверждение входа истекло или относится к другой вкладке. Начните вход заново.', 'error');
            await prepareTelegramLogin();
            return false;
        }
    })();
    return telegramReturnPromise;
}

function telegramLoginVisible() {
    const modal = document.getElementById('auth-modal');
    const login = document.getElementById('auth-container');
    const registration = document.getElementById('registration-container');
    return !!modal?.classList.contains('show') && ((!!login && login.style.display !== 'none') || registration?.style.display === 'flex');
}

function loadTelegramLoginSdk() {
    if (window.Telegram?.Login?.init && window.Telegram.Login.auth) return Promise.resolve();
    if (!telegramSdkPromise) {
        telegramSdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const timer = setTimeout(() => finish(new Error('Telegram unavailable')), 15000);
            function finish(error) {
                clearTimeout(timer);
                script.onload = script.onerror = null;
                if (error) { script.remove(); reject(error); } else resolve();
            }
            script.async = true;
            script.src = 'https://oauth.telegram.org/js/telegram-login.js?6';
            script.onload = () => finish(window.Telegram?.Login?.auth ? null : new Error('Telegram unavailable'));
            script.onerror = () => finish(new Error('Telegram unavailable'));
            document.head.appendChild(script);
        }).catch(error => { telegramSdkPromise = null; throw error; });
    }
    return telegramSdkPromise;
}

function cancelTelegramLogin() {
    telegramLoginCleanup?.();
    telegramLoginCleanup = null;
    telegramLoginGeneration += 1;
    telegramLoginChallenge = null;
    telegramLoginPreparing = false;
    clearTimeout(telegramLoginWatchdog);
    telegramLoginWatchdog = null;
}

// Здесь читается только nonce для привязки сообщения к текущему окну входа.
// Подпись и все права пользователя по-прежнему проверяет сервер.
function telegramTokenHasNonce(token, nonce) {
    if (typeof token !== 'string' || token.length > 16384) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).nonce === nonce;
    } catch { return false; }
}

async function prepareTelegramLogin() {
    const container = document.getElementById('telegram-widget-placeholder');
    if (!container) return;
    const registration = document.getElementById('registration-container')?.style.display === 'flex';
    const slot = document.getElementById(registration ? 'telegram-register-slot' : 'telegram-login-slot');
    if (slot && container.parentElement !== slot) slot.appendChild(container);
    if (telegramLoginPreparing) return;
    if (telegramLoginChallenge && telegramLoginChallenge.until > Date.now()) return;
    cancelTelegramLogin();
    const generation = telegramLoginGeneration;
    telegramLoginPreparing = true;
    const requestedAt = Date.now();
    container.innerHTML = '<button id="telegram-login-button" class="btn btn-secondary telegram-login-button" type="button" onclick="startTelegramLogin()" aria-describedby="telegram-login-status" disabled>Подготовка Telegram…</button><p id="telegram-login-status" class="auth-hint" role="status" aria-live="polite"></p>';
    const button = document.getElementById('telegram-login-button');
    const status = document.getElementById('telegram-login-status');
    try {
        const response = await apiPostRequest('beginTelegramLogin', { redirect_uri: telegramLoginRedirectUri() });
        if (generation !== telegramLoginGeneration) return;
        if (!response.success) throw new Error(response.code === 'TELEGRAM_NOT_CONFIGURED' ? 'Вход через Telegram ещё настраивается. Пока можно войти по почте.' : 'Не удалось подготовить вход. Попробуйте ещё раз.');
        if (response.mode !== 'redirect') await loadTelegramLoginSdk();
        if (generation !== telegramLoginGeneration) return;
        telegramLoginChallenge = { mode: response.mode, authorization_url: response.authorization_url, redirect_uri: response.redirect_uri,
            client_id: response.client_id, challenge_id: response.challenge_id, nonce: response.nonce,
            proof: response.proof, until: requestedAt + Math.min(600, Number(response.expires_in) || 600) * 1000 - 5000 };
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4L21 3ZM10 14 21 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Продолжить с Telegram</span>';
        button.disabled = false;
        status.textContent = 'Без почты и отдельного пароля';
    } catch (error) {
        if (generation !== telegramLoginGeneration) return;
        button.textContent = 'Повторить подготовку Telegram';
        button.disabled = false;
        status.textContent = error.message === 'Вход через Telegram ещё настраивается. Пока можно войти по почте.' ? error.message : 'Telegram сейчас недоступен. Можно повторить попытку или войти по почте.';
    } finally { if (generation === telegramLoginGeneration) telegramLoginPreparing = false; }
}

function startTelegramLogin() {
    if (!telegramLoginVisible() || telegramLoginPreparing) return;
    if (!telegramLoginChallenge || telegramLoginChallenge.until <= Date.now()) {
        telegramLoginChallenge = null;
        prepareTelegramLogin();
        return;
    }
    const generation = telegramLoginGeneration;
    const challenge = telegramLoginChallenge;
    const button = document.getElementById('telegram-login-button');
    const status = document.getElementById('telegram-login-status');
    if (button.disabled) return;
    delete status.dataset.telegramError;
    button.disabled = true;
    if (challenge.mode === 'redirect') {
        try {
            const authUrl = new URL(challenge.authorization_url);
            if (authUrl.origin !== 'https://oauth.telegram.org' || authUrl.pathname !== '/auth' ||
                authUrl.searchParams.get('response_type') !== 'code' || authUrl.searchParams.get('state') !== challenge.challenge_id ||
                authUrl.searchParams.get('client_id') !== String(challenge.client_id) ||
                authUrl.searchParams.get('redirect_uri') !== challenge.redirect_uri || challenge.redirect_uri !== telegramLoginRedirectUri()) throw new Error('Invalid authorization URL');
            const pending = JSON.stringify({ challenge_id: challenge.challenge_id, proof: challenge.proof, redirect_uri: challenge.redirect_uri,
                until: challenge.until, return_url: window.location.href });
            sessionStorage.setItem(TELEGRAM_REDIRECT_PENDING_KEY, pending);
            if (sessionStorage.getItem(TELEGRAM_REDIRECT_PENDING_KEY) !== pending) throw new Error('Storage unavailable');
            status.textContent = 'Переходим в Telegram…';
            window.location.assign(authUrl.href);
        } catch {
            try { sessionStorage.removeItem(TELEGRAM_REDIRECT_PENDING_KEY); } catch {}
            button.disabled = false;
            status.textContent = 'Не удалось начать вход. Разрешите временное хранение данных для этой вкладки и попробуйте снова.';
        }
        return;
    }
    status.textContent = 'Подтвердите вход в окне Telegram';
    // Открытие синхронно с нажатием: браузер не блокирует popup после сетевого await.
    const retry = message => {
        if (generation !== telegramLoginGeneration) return;
        cancelTelegramLogin();
        button.disabled = false;
        button.textContent = 'Повторить вход через Telegram';
        status.textContent = message;
    };
    let completed = false;
    let closeTimer = null;
    const cleanup = () => {
        clearTimeout(closeTimer);
        clearTimeout(telegramLoginWatchdog);
        window.removeEventListener('message', onMessage);
    };
    const receive = async result => {
        if (completed || generation !== telegramLoginGeneration || !telegramLoginVisible()) return;
        if (typeof result?.id_token !== 'string' || !result.id_token || result.error) {
            const messages = {
                popup_closed: 'Окно Telegram закрылось, но подтверждение не дошло до сайта. Попробуйте ещё раз.',
                'missing id_token': 'Telegram не передал подтверждение входа. Попробуйте ещё раз.',
                'malformed id_token': 'Не удалось прочитать подтверждение Telegram. Попробуйте ещё раз.',
                access_denied: 'Вход через Telegram не разрешён. Можно попробовать снова.'
            };
            const code = Object.hasOwn(messages, result?.error) ? result.error : 'unknown_response';
            const fail = () => {
                if (completed || generation !== telegramLoginGeneration) return;
                status.dataset.telegramError = code;
                console.warn('Telegram Login:', code);
                retry(messages[code] || 'Telegram не завершил подтверждение входа. Попробуйте ещё раз.');
            };
            // SDK прекращает слушать сообщения сразу при закрытии popup.
            // Даём уже отправленному ответу дойти до страницы перед отказом.
            if (code === 'popup_closed') { if (!closeTimer) closeTimer = setTimeout(fail, 1500); }
            else fail();
            return;
        }
        completed = true;
        cleanup();
        telegramLoginCleanup = null;
        telegramLoginChallenge = null;
        button.textContent = 'Проверка входа…';
        let ok = false;
        try { ok = await window.onTelegramAuth({ id_token: result.id_token, challenge_id: challenge.challenge_id, proof: challenge.proof }); }
        catch { /* Повторная попытка не сохраняет ответ Telegram. */ }
        if (!ok && generation === telegramLoginGeneration) retry('Сайт не принял подтверждение Telegram. Попробуйте ещё раз.');
    };
    const onMessage = event => {
        if (event.origin !== 'https://oauth.telegram.org' || !event.source || event.source === window) return;
        let data = event.data;
        if (typeof data === 'string') {
            if (data.length > 65536) return;
            try { data = JSON.parse(data); } catch { return; }
        }
        if (data?.event !== 'auth_result' || data.error) return;
        const token = data.result;
        if (!telegramTokenHasNonce(token, challenge.nonce)) return;
        receive({ id_token: token });
    };
    telegramLoginCleanup = cleanup;
    window.addEventListener('message', onMessage);
    telegramLoginWatchdog = setTimeout(() => retry('Время подтверждения истекло. Нажмите кнопку, чтобы попробовать снова.'), Math.max(1, challenge.until - Date.now()));
    try {
        const opening = window.Telegram.Login.auth({ client_id: Number(challenge.client_id), scope: ['profile'], lang: 'ru', nonce: challenge.nonce }, receive);
        opening?.catch?.(() => { if (!completed) retry('Не удалось открыть Telegram. Попробуйте снова.'); });
    } catch { retry('Не удалось открыть Telegram. Проверьте разрешение на всплывающие окна и попробуйте снова.'); }
}
