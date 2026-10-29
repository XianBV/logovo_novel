/* Официальный Telegram Login: JWT и подтверждение браузера остаются в памяти. */
let telegramSdkPromise = null;
let telegramLoginGeneration = 0;
let telegramLoginChallenge = null;
let telegramLoginWatchdog = null;
let telegramLoginPreparing = false;

function telegramLoginVisible() {
    const modal = document.getElementById('auth-modal');
    const login = document.getElementById('auth-container');
    return !!modal?.classList.contains('show') && login?.style.display !== 'none';
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
    telegramLoginGeneration += 1;
    telegramLoginChallenge = null;
    telegramLoginPreparing = false;
    clearTimeout(telegramLoginWatchdog);
    telegramLoginWatchdog = null;
}

async function prepareTelegramLogin() {
    const container = document.getElementById('telegram-widget-placeholder');
    if (!container || telegramLoginPreparing) return;
    if (telegramLoginChallenge && telegramLoginChallenge.until > Date.now()) return;
    cancelTelegramLogin();
    const generation = telegramLoginGeneration;
    telegramLoginPreparing = true;
    const requestedAt = Date.now();
    container.innerHTML = '<button id="telegram-login-button" class="btn btn-secondary" type="button" onclick="startTelegramLogin()" disabled>Подготовка Telegram…</button><p id="telegram-login-status" class="auth-hint" role="status" aria-live="polite"></p>';
    const button = document.getElementById('telegram-login-button');
    const status = document.getElementById('telegram-login-status');
    try {
        const response = await apiPostRequest('beginTelegramLogin', {});
        if (generation !== telegramLoginGeneration) return;
        if (!response.success) throw new Error(response.code === 'TELEGRAM_NOT_CONFIGURED' ? 'Вход через Telegram ещё настраивается. Пока можно войти по почте.' : 'Не удалось подготовить вход. Попробуйте ещё раз.');
        await loadTelegramLoginSdk();
        if (generation !== telegramLoginGeneration) return;
        telegramLoginChallenge = { client_id: response.client_id, challenge_id: response.challenge_id, nonce: response.nonce,
            proof: response.proof, until: requestedAt + Math.min(600, Number(response.expires_in) || 600) * 1000 - 5000 };
        button.textContent = 'Войти через Telegram';
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
    button.disabled = true;
    status.textContent = 'Подтвердите вход в окне Telegram';
    // Открытие синхронно с нажатием: браузер не блокирует popup после сетевого await.
    const retry = message => {
        if (generation !== telegramLoginGeneration) return;
        cancelTelegramLogin();
        button.disabled = false;
        button.textContent = 'Повторить вход через Telegram';
        status.textContent = message;
    };
    telegramLoginWatchdog = setTimeout(() => retry('Подтверждение не завершено. Нажмите кнопку, чтобы попробовать снова.'), 120000);
    let completed = false;
    try {
        const opening = window.Telegram.Login.auth({ client_id: Number(challenge.client_id), scope: ['profile'], lang: 'ru', nonce: challenge.nonce }, async result => {
            if (completed || generation !== telegramLoginGeneration || !telegramLoginVisible()) return;
            completed = true;
            clearTimeout(telegramLoginWatchdog);
            if (!result?.id_token || result.error) { retry('Вход отменён или не завершён. Можно попробовать снова.'); return; }
            telegramLoginChallenge = null;
            button.textContent = 'Проверка входа…';
            let ok = false;
            try { ok = await window.onTelegramAuth({ id_token: result.id_token, challenge_id: challenge.challenge_id, proof: challenge.proof }); }
            catch { /* Повторная попытка не сохраняет ответ Telegram. */ }
            if (!ok && generation === telegramLoginGeneration) retry('Не удалось завершить вход. Нажмите кнопку ещё раз.');
        });
        opening?.catch?.(() => retry('Не удалось открыть Telegram. Попробуйте снова.'));
    } catch { retry('Не удалось открыть Telegram. Проверьте разрешение на всплывающие окна и попробуйте снова.'); }
}
