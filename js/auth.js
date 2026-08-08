/* ==========================================
   ЛОГОВО НОВЕЛЛ — АВТОРИЗАЦИЯ
   Вход, регистрация и выход из аккаунта
   ========================================== */

console.log('📦 auth.js загружен');

// ==========================================
// АУТЕНТИФИКАЦИЯ - EMAIL/ПАРОЛЬ
// ==========================================

function setAuthFormDisabled(formId, disabled) {
    const form = document.getElementById(formId);

    if (!form) {
        return;
    }

    form.querySelectorAll('input, button, select, textarea').forEach(element => {
        element.disabled = disabled;
    });
}

/**
 * Показать форму входа
 */
function showLogin() {
    const loginContainer = document.getElementById('auth-container');
    const registrationContainer = document.getElementById('registration-container');

    loginContainer.style.display = 'flex';
    registrationContainer.style.display = 'none';

    setAuthFormDisabled('login-form', false);
    setAuthFormDisabled('registration-form', true);

    const emailInput = document.getElementById('auth-email');
    if (emailInput) {
        emailInput.focus();
    }
}

/**
 * Показать форму регистрации
 */
function showRegistration() {
    const loginContainer = document.getElementById('auth-container');
    const registrationContainer = document.getElementById('registration-container');

    loginContainer.style.display = 'none';
    registrationContainer.style.display = 'flex';

    setAuthFormDisabled('login-form', true);
    setAuthFormDisabled('registration-form', false);

    const usernameInput = document.getElementById('reg-username');
    if (usernameInput) {
        usernameInput.focus();
    }
}

/**
 * Вход по email и паролю
 */
async function handleEmailLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    
    if (!email || !password) {
        showToast('Заполните все поля', 'warning');
        return;
    }
    
    try {
        showLoading(true, { title: 'Вход...' });
        
        // ✅ ВОЗВРАЩАЕМ apiRequest и ПРАВИЛЬНОЕ НАЗВАНИЕ 'loginWithEmail'
        const response = await apiPostRequest('loginWithEmail', {
            email: email,
            password: password
        });
        
        // ВАЖНО: Проверяем, что сервер вернул успешный ответ и объект пользователя
        if (response && response.success && response.user) {
            
            // ✅ ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ КЛЮЧ 'session_token'
            localStorage.setItem('session_token', response.session_token);
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            
            // ✨ Сохраняем и новые данные, как вы хотели
            localStorage.setItem('userRole', response.user.role);
            localStorage.setItem('userFeatures', JSON.stringify(response.user.features || []));

            STATE.currentUser = response.user;
            
            updateUserDisplay();
            hideModal('auth-modal');
            showToast('Добро пожаловать, ' + response.user.username + '!', 'success');

            // Перезагрузка для чистого обновления состояния
            setTimeout(() => {
                window.location.reload();
            }, 500);

        } else {
            // Обрабатываем ошибку, которую вернул сервер (например, "Неверный пароль")
            showToast('Ошибка: ' + (response.error || 'Неверный email или пароль'), 'error');
        }
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        // Эта ошибка сработает, если сам запрос apiRequest упадет (например, таймаут)
        showToast('Сетевая ошибка или ошибка сервера', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Регистрация нового пользователя
 */
async function handleRegistration() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    
    if (!username || !email || !password) {
        showToast('Заполните все поля', 'warning');
        return;
    }
    
    if (password.length < 6) {
        showToast('Пароль должен быть минимум 6 символов', 'warning');
        return;
    }
    
    try {
        showLoading(true, { title: 'Регистрация...' });
        
        const response = await apiPostRequest('registerWithEmail', {
            username: username,
            email: email,
            password: password
        });
        
        if (response.success) {
            showToast('Регистрация успешна! Войдите в систему.', 'success');
            
            document.getElementById('reg-password').value = '';
            // Переключаемся через функцию, которая правильно
            // включает форму входа и отключает регистрацию
            showLogin();// Подставляем зарегистрированный email
            document.getElementById('auth-email').value = email;

            // Поле пароля входа оставляем пустым
            document.getElementById('auth-password').value = '';

            // Сразу переводим курсор в пароль
            document.getElementById('auth-password').focus();
        } else {
            showToast('Ошибка: ' + response.error, 'error');
        }
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        showToast('Не удалось зарегистрироваться', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Выход из системы
 */
async function handleLogout() {
    // Получаем токен, чтобы отправить его на сервер для завершения сессии
    const session_token = localStorage.getItem('session_token');

    // ✅ Немедленно очищаем все локальные данные о пользователе
    localStorage.removeItem('session_token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole'); // Также чистим роль
    localStorage.removeItem('userFeatures'); // и права
    STATE.currentUser = null;
    clearCache(); // Очищаем кэш данных
    
    // ✅ В фоне отправляем запрос на сервер, чтобы он тоже завершил сессию.
    // Нам не нужно ждать ответа, поэтому мы не используем await.
    if (session_token) {
        apiPostRequest('logout', { session_token })
            .catch(e => console.warn('Фоновый выход не удался:', e));
    }

    showToast('Вы вышли из системы. Переход на главную...', 'info');

    // 3. ✨ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Жесткий редирект на чистый URL (Главную) ✨
    // Это уберет все параметры типа ?page=profile и предотвратит ошибку
    setTimeout(() => {
        window.location.href = window.location.origin + window.location.pathname;
    }, 500);
}

/**
 * ✅ НОВАЯ ФУНКЦИЯ
 * Вызывается автоматически виджетом Telegram после успешной авторизации.
 * Разместите эту функцию в глобальной области видимости (не внутри других функций).
 */
window.onTelegramAuth = async function(user) {
    console.log('Данные от виджета Telegram:', user);
    showLoading(true, { title: 'Вход через Telegram...' });

    try {
        // Отправляем ВСЕ данные от Telegram (включая 'hash') на сервер
        // для проверки подлинности в функции 'authenticateTelegram'.
        const response = await apiRequest('authenticateTelegram', user);

        if (response && response.success && response.user) {
            // Эта та же логика, что и в handleEmailLogin
            
            localStorage.setItem('session_token', response.session_token);
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            localStorage.setItem('userRole', response.user.role);
            localStorage.setItem('userFeatures', JSON.stringify(response.user.features || []));

            STATE.currentUser = response.user;
            
            updateUserDisplay();
            hideModal('auth-modal'); // Закрываем модальное окно
            showToast('Добро пожаловать, ' + response.user.username + '!', 'success');

            // Перезагрузка страницы для чистого обновления состояния
            setTimeout(() => {
                window.location.reload();
            }, 500);

        } else {
            // Сервер отклонил вход (например, неверный hash)
            throw new Error(response.error || 'Не удалось войти. Сервер отклонил данные.');
        }
    } catch (error) {
        console.error('Ошибка входа через Telegram (onTelegramAuth):', error);
        showToast('Ошибка: ' + error.message, 'error');
        showLoading(false); // Прячем загрузку при ошибке
    }
}
