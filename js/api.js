/* ==========================================
   ЛОГОВО НОВЕЛЛ — API
   Запросы к Google Apps Script
   ========================================== */

const API_BASE = '';
const CONFIGURED_API_BASE = String(window.LOVO_API_BASE || '').replace(/\/$/, '');
const IS_LOCAL_SITE = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
const NORMAL_API_BASE = CONFIGURED_API_BASE || (
    window.location.port === '3000'
        ? `${window.location.origin}/api`
        : (IS_LOCAL_SITE ? 'http://127.0.0.1:3000/api' : '')
);
const NORMAL_GET_ACTIONS = new Set([
    'getNextChapterNumber',
    'checkChapterNumber',
    'getTags',
    'searchAuthors',
    'getNovel',
    'getChapter',
    'getChapterForEdit',
    'getReadingLists',
    'getReadingProgress',
    'getMyCreatedNovels',
    'getTrash',
    'getNovelPermissions',
    'searchUserForPermission',
    'getUserPublicProfile',
    'getSubmissions',
    'getDashboardData',
    'getAllUsers',
    'searchUsers',
    'getSetting',
    'cleanupSessions'
]);

function getNormalApiBase() {
    if (NORMAL_API_BASE) return NORMAL_API_BASE;
    throw new Error('Адрес серверной функции Supabase ещё не указан в js/config.js');
}

function shouldUseNormalGet(action, data) {
    return NORMAL_GET_ACTIONS.has(action) || (
        action === 'getInitialData' && (data.scope === 'session' || data.scope === 'full')
    );
}

console.log('📦 api.js загружен');

// ==========================================
// API КОММУНИКАЦИЯ - ОПТИМИЗИРОВАННАЯ
// ==========================================

// ✅ ПРАВИЛЬНАЯ И РАБОЧАЯ ВЕРСИЯ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ (GET-ЗАПРОСЫ)
function apiRequest(action, data = {}, forceFresh = false) {
    // Добавляем токен сессии, если он есть
    const sessionToken = localStorage.getItem('session_token');
    if (sessionToken) {
        data.session_token = sessionToken;
    }

    const cacheKey = `${action}_${JSON.stringify(data)}`;
    
// Проверяем кэш, НО игнорируем его для опроса статуса
    if (!forceFresh && STATE.cache.data[cacheKey]) {
        const cached = STATE.cache.data[cacheKey];
        if (Date.now() - cached.timestamp < STATE.cache.ttl) {
            console.log(`💾 Кэш: ${action}`);
            return Promise.resolve(cached.data);
        }
    }

    if (shouldUseNormalGet(action, data)) {
        const params = new URLSearchParams({ action, ...data });
        return fetch(`${getNormalApiBase()}/query?${params}`)
            .then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `Ошибка сервера: HTTP ${response.status}`);
                STATE.cache.data[cacheKey] = { data: result, timestamp: Date.now() };
                return result;
            });
    }
    
    // Оборачиваем в Promise для использования async/await
    return new Promise((resolve, reject) => {
        // Создаём уникальное имя для нашего "почтового ящика"
        const callbackName = 'jsonp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Формируем URL с параметрами
        const params = new URLSearchParams({ action, callback: callbackName, ...data });
        const script = document.createElement('script');
        script.src = `${API_BASE}?${params}`;
        
        // Таймер безопасности на случай, если сервер не отвечает
        const timeoutMs = action === 'getChapterForEdit'
            ? 60000
            : (action === 'getPostStatus' ? 10000 : 30000);
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout: сервер не отвечает'));
        }, timeoutMs);
        
        // Функция для очистки
        const cleanup = () => {
            clearTimeout(timeout);
            if (script.parentNode) document.head.removeChild(script);
            delete window[callbackName]; // Удаляем "почтовый ящик"
        };
        
        // Создаём тот самый "почтовый ящик" (глобальную функцию)
        window[callbackName] = (response) => {
            cleanup();
            // Кэшируем ответ
            STATE.cache.data[cacheKey] = {
                data: response,
                timestamp: Date.now()
            };
            resolve(response); // Отправляем данные туда, где их ждут
        };
        
        // Обработка сетевых ошибок
        script.onerror = () => {
            cleanup();
            reject(new Error('Сетевая ошибка'));
        };
        
        // Добавляем скрипт на страницу, чтобы запустить запрос
        document.head.appendChild(script);
    });
}

// POST-запросы идут через Node.js локально или через Supabase Edge Function на сайте.
// Пока перенос не завершён, серверная логика сама вызывает оставшийся мост Apps Script.
async function apiPostRequest(action, data = {}) {
    console.log(`📤 POST через серверную функцию: ${action}`);
    
    const sessionToken = localStorage.getItem('session_token');
    if (sessionToken) { 
        data.session_token = sessionToken; 
    }
    
    try {
        const mutationId = window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const response = await fetch(`${getNormalApiBase()}/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, data, mutation_id: mutationId })
        });

        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error('Новый сервер вернул некорректный ответ');
        }

        if (!response.ok) {
            throw new Error(result.error || `Ошибка сервера: HTTP ${response.status}`);
        }
        
        console.log(`✅ POST успешен: ${action}`, result);
        return result;
        
    } catch (error) {
        console.error(`❌ POST ошибка: ${action}`, error);
        if (error instanceof TypeError && /fetch/i.test(error.message)) {
            throw new Error(IS_LOCAL_SITE
                ? 'Локальный сервер не запущен. Откройте сайт через http://127.0.0.1:3000'
                : 'Серверная функция Supabase сейчас недоступна');
        }
        throw error;
    }
}

// Вспомогательная функция: отправка данных через форму
function submitPostData(action, data, requestId) {
    return new Promise((resolve, reject) => {
        const uniqueId = 'iframe_' + requestId;
        
        // Создаём невидимый iframe
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.name = uniqueId;
        iframe.id = uniqueId;
        // Создаём форму
        const form = document.createElement('form');
        form.target = uniqueId;
        form.action = API_BASE;
        form.method = 'POST';

        // Добавляем поля
        const fields = {
            action: action,
            request_id: requestId,
            data: JSON.stringify(data)
        };

        for (let [key, value] of Object.entries(fields)) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = value;
            form.appendChild(input);
        }

        let submitted = false;
        let resolved = false;

        const resolveOnce = () => {
            if (resolved) return;
            resolved = true;
            resolve();
        };

        const cleanup = () => {
            if (iframe.parentNode) iframe.remove();
            if (form.parentNode) form.remove();
        };

        // Сначала ждём загрузки пустой рамки. Иначе её первоначальный load
        // можно ошибочно принять за ответ Apps Script и оборвать POST.
        iframe.addEventListener('load', () => {
            if (!submitted) {
                submitted = true;
                try {
                    form.submit();
                    // Запрос уже передан браузеру. Форму можно убрать,
                    // но iframe оставляем до настоящего ответа сервера.
                    setTimeout(() => {
                        if (form.parentNode) form.remove();
                        resolveOnce();
                    }, 300);
                } catch (error) {
                    cleanup();
                    reject(error);
                }
                return;
            }

            // Второй load означает, что Apps Script действительно ответил.
            cleanup();
        });

        document.body.appendChild(iframe);
        document.body.appendChild(form);

        // Защитная очистка не влияет на выполнение нормального запроса.
        setTimeout(cleanup, 10 * 60 * 1000);
    });
}

// Вспомогательная функция: опрос статуса запроса
async function pollRequestStatus(requestId, options = {}) {
    const maxDurationMs = options.maxDurationMs || 120000;
    const missingRequestTimeoutMs = options.missingRequestTimeoutMs || 20000;
    const startedAt = Date.now();
    let missingSince = null;
    let attempt = 0;

    while (Date.now() - startedAt < maxDurationMs) {
        attempt += 1;
        if (attempt > 1) {
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
        
        try {
            // Запрашиваем статус через GET
            const response = await apiRequest('getPostStatus', { request_id: requestId }, true);
            
            if (response.status === 'completed') {
                console.log(`✅ Запрос выполнен (проверка ${attempt})`);
                return response.result;
            } else if (response.status === 'error') {
                const serverError = new Error(response.error || 'Ошибка выполнения запроса');
                serverError.isServerResponse = true;
                throw serverError;
            } else if (response.status === 'pending') {
                missingSince = null;
                console.log(`⏳ Сервер сохраняет главу... (проверка ${attempt})`);
            } else if (response.status === 'not_found') {
                if (missingSince === null) missingSince = Date.now();
                if (Date.now() - missingSince >= missingRequestTimeoutMs) {
                    throw new Error('Сервер не получил запрос на сохранение. Попробуйте ещё раз.');
                }
                console.log(`⏳ Ожидаем приём запроса сервером... (проверка ${attempt})`);
            } else {
                console.log(`⏳ Ожидаем ответ сервера... (проверка ${attempt})`);
            }
        } catch (error) {
            if (error.isServerResponse || /Сервер не получил запрос/.test(error.message)) {
                throw error;
            }
            if (Date.now() - startedAt >= maxDurationMs) break;
            console.log(`⚠️ Временная ошибка проверки статуса (проверка ${attempt}):`, error.message);
        }
    }
    
    throw new Error('Сервер не завершил сохранение за отведённое время. Локальный черновик сохранён.');
}

// Очистка кэша
function clearCache() {
    STATE.cache.data = {};
    console.log('🗑️ Кэш очищен');
}
