/*
 * Публичная конфигурация сайта. Значение не является секретом:
 * браузеру нужен адрес серверной функции для отправки запросов.
 * Перед публикацией сюда будет подставлен адрес вида:
 * https://PROJECT_REF.supabase.co/functions/v1/api
 */
if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    window.LOVO_API_BASE = window.LOVO_API_BASE || 'https://ldyjdfxlgltsysriftwn.supabase.co/functions/v1/api';
}
