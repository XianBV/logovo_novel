/* Отдельный Google Apps Script. Не добавлять в старый сервер code.gs.
 * Свойство скрипта AUTH_MAIL_RELAY_SECRET: случайный ключ не короче 32 символов.
 * Публикация: веб-приложение, выполнять от владельца служебного Gmail.
 * Реальные письма отправляются только после проверки подписи запроса.
 */
function doPost(event) {
  function answer(success, code, extra) {
    return ContentService.createTextOutput(JSON.stringify(Object.assign({ success: success, code: code }, extra || {})))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var raw = event && event.postData && event.postData.contents;
    if (typeof raw !== 'string' || raw.length > 16000) return answer(false, 'invalid');
    var data = JSON.parse(raw);
    if (!Number.isSafeInteger(data.issued_at) || Math.abs(Date.now() - data.issued_at) > 300000 ||
        !/^[a-f0-9]{32}$/.test(data.nonce || '') || !/^[a-f0-9]{64}$/.test(data.signature || '') ||
        typeof data.payload !== 'string' || data.payload.length > 10000) return answer(false, 'invalid');
    var secret = PropertiesService.getScriptProperties().getProperty('AUTH_MAIL_RELAY_SECRET');
    if (!secret || secret.length < 32) return answer(false, 'not_configured');
    var bytes = Utilities.computeHmacSha256Signature(data.issued_at + '\n' + data.nonce + '\n' + data.payload, secret, Utilities.Charset.UTF_8);
    var expected = bytes.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
    var mismatch = 0;
    for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ data.signature.charCodeAt(i);
    if (mismatch !== 0) return answer(false, 'denied');
    var mail = JSON.parse(data.payload);
    if (mail.action === 'status') return answer(true, 'status', { remaining: Math.max(0, MailApp.getRemainingDailyQuota()) });
    if (mail.action && mail.action !== 'send') return answer(false, 'invalid');
    if (typeof mail.to !== 'string' || mail.to.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(mail.to) ||
        typeof mail.subject !== 'string' || !mail.subject.length || mail.subject.length > 200 || /[\r\n]/.test(mail.subject) ||
        typeof mail.text !== 'string' || !mail.text.length || mail.text.length > 8000) return answer(false, 'invalid_mail');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return answer(false, 'busy');
    try {
      var cache = CacheService.getScriptCache();
      var key = 'account_mail_' + data.nonce;
      if (cache.get(key)) return answer(true, 'duplicate');
      if (MailApp.getRemainingDailyQuota() < 1) return answer(false, 'quota');
      // Отмечаем до отправки: сетевой сбой после принятия письма не создаёт дубль.
      cache.put(key, 'sending', 600);
      MailApp.sendEmail({ to: mail.to, subject: mail.subject, body: mail.text, name: 'Логово новелл' });
      return answer(true, 'sent');
    } finally { lock.releaseLock(); }
  } catch (_) {
    // Без адресов, токенов и подробностей ошибок в публичном ответе или журнале.
    return answer(false, 'failed');
  }
}
