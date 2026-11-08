/* ==========================================
   ЛОГОВО НОВЕЛЛ — ГЛАВЫ
   Чтение, настройки и управление главами
   ========================================== */

console.log('📦 chapters.js загружен');

let chapterSortOrder = 'asc';
let currentScrollHandler = null;
let chapterNumberCheckTimeout = null;
let lastCheckedNumber = null;
let tooltipElement = null;

// ==========================================
// НАСТРОЙКИ ЧТЕНИЯ
// ==========================================

function toggleReadingSettings() {
    let panel = document.getElementById('reading-settings-panel');

    // Если панели нет, создаем ее
    if (!panel) {
       // --- ИЗМЕНЕНИЕ ЗДЕСЬ ---
        // Получаем ID главы из URL, чтобы передать в createReadingSettingsPanel
        const currentChapterId = new URLSearchParams(window.location.search).get('id');
        // Нам нужен ВЕСЬ объект главы, а не только ID.
        // Предполагаем, что он сохранен в window.currentChapterData (нужно будет сохранить его в renderChapterReadPage)
        if (window.currentChapterData) {
            createReadingSettingsPanel(window.currentChapterData); // Передаем объект главы
            panel = document.getElementById('reading-settings-panel');
        } else {
             console.error("Не найдены данные текущей главы для создания панели настроек.");
             return; // Не можем создать панель без данных
        }
        if (!panel) return;
    }

    const isVisible = panel.classList.toggle('show');

    // ✨ Убираем слушатель скролла отсюда, он мешал ✨
    // window.removeEventListener('scroll', closeSettingsOnScroll);

    if (isVisible) {
        // ✨ Добавляем слушатель БЕЗ capture (false) ✨
        // Небольшая задержка, чтобы не сработал на текущий клик по кнопке
        setTimeout(() => {
            document.addEventListener('click', closeSettingsOnClickOutside);
            console.log('Добавлен слушатель click для закрытия настроек');
        }, 0);
        // Добавляем слушатель скролла для закрытия (одноразовый)
        window.addEventListener('scroll', closeSettingsOnScroll, { once: true });

    } else {
        removeSettingsListeners(); // Убираем слушатели
    }
}

// Вспомогательная функция для закрытия по клику вне
function closeSettingsOnClickOutside(event) {
    const panel = document.getElementById('reading-settings-panel');
    const button = document.querySelector('.reader-header-right button'); // Находим кнопку настроек

    console.log('Клик вне настроек:', event.target); // Лог для отладки

    // Закрываем, если клик был не по панели и не по кнопке
    if (panel && button && !panel.contains(event.target) && !button.contains(event.target)) {
        console.log('Закрываем панель...');
        panel.classList.remove('show');
        removeSettingsListeners(); // Убираем слушатели
    }
}

// Вспомогательная функция для закрытия при скролле
function closeSettingsOnScroll() {
    const panel = document.getElementById('reading-settings-panel');
    if (panel) {
        panel.classList.remove('show');
        removeSettingsListeners();
    }
}

// Вспомогательная функция для удаления слушателей
function removeSettingsListeners() {
    // ✨ Убираем слушатель БЕЗ capture (false) ✨
    document.removeEventListener('click', closeSettingsOnClickOutside);
    window.removeEventListener('scroll', closeSettingsOnScroll); // Убираем и скролл
    console.log('Удалены слушатели click/scroll для закрытия настроек');
}

function createReadingSettingsPanel(chapter) { // Принимаем весь объект chapter
    const settings = getReadingSettings();

    const panel = document.createElement('div');
    panel.id = 'reading-settings-panel';
    panel.className = 'reading-settings-panel';

    panel.innerHTML = `
        <h3>⚙️ Настройки чтения</h3>

        <div class="setting-group">
            <label>Размер шрифта</label>
            <div class="font-size-controls">
                <button onclick="adjustFontSize(-2)">A-</button>
                <span id="font-size-display">${settings.fontSize}px</span>
                <button onclick="adjustFontSize(2)">A+</button>
            </div>
        </div>

        <div class="setting-group">
            <label>Шрифт</label>
            <select id="font-family-select" onchange="changeFontFamily(this.value)">
                <option value="default" ${settings.fontFamily === 'default' ? 'selected' : ''}>По умолчанию</option>
                <option value="serif" ${settings.fontFamily === 'serif' ? 'selected' : ''}>Serif</option>
                <option value="sans-serif" ${settings.fontFamily === 'sans-serif' ? 'selected' : ''}>Sans-serif</option>
                <option value="monospace" ${settings.fontFamily === 'monospace' ? 'selected' : ''}>Monospace</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Ширина текста</label>
            <select id="text-width-select" onchange="changeTextWidth(this.value)">
                <option value="narrow" ${settings.textWidth === 'narrow' ? 'selected' : ''}>Узкий</option>
                <option value="medium" ${settings.textWidth === 'medium' ? 'selected' : ''}>Средний</option>
                <option value="wide" ${settings.textWidth === 'wide' ? 'selected' : ''}>Широкий</option>
                <option value="full" ${settings.textWidth === 'full' ? 'selected' : ''}>На всю ширину</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Межстрочный интервал</label>
            <select id="line-height-select" onchange="changeLineHeight(this.value)">
                <option value="1.4" ${settings.lineHeight === '1.4' ? 'selected' : ''}>Узкий</option>
                <option value="1.6" ${settings.lineHeight === '1.6' ? 'selected' : ''}>Нормальный</option>
                <option value="1.8" ${settings.lineHeight === '1.8' ? 'selected' : ''}>Комфортный</option>
                <option value="2.0" ${settings.lineHeight === '2.0' ? 'selected' : ''}>Широкий</option>
            </select>
        </div>

        <div class="setting-group">
            <label>Тема</label>
            <button class="btn btn-secondary btn-sm" id="reader-theme-toggle-btn" onclick="toggleThemeMode()" style="width: 100%;">
                ${currentThemeMode === 'dark' ? 'Тема: Светлая ☀️' : 'Тема: Тёмная 🌙'}
            </button>
        </div>

        <div class="setting-group">
            <label>
                <input type="checkbox" id="auto-scroll"
                       ${settings.autoScroll ? 'checked' : ''}
                       onchange="toggleAutoScroll(this.checked)">
                Автопрокрутка
            </label>
        </div>

        <button class="btn btn-secondary btn-sm" onclick="resetReadingSettings()">
            Сбросить настройки
        </button>
    `;

    // Вставляем панель (как и раньше)
    const headerRight = document.querySelector('.reader-header-right');
    if (headerRight) {
         headerRight.appendChild(panel);
    } else {
         console.error("Could not find '.reader-header-right' to append settings panel.");
    }
}

function getReadingSettings() {
    const defaults = {
        fontSize: 18,
        fontFamily: 'default',
        textWidth: 'medium',
        lineHeight: '1.6',
        autoScroll: false
    };
    
    const saved = localStorage.getItem('reading-settings');
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
}

function saveReadingSettings(settings) {
    localStorage.setItem('reading-settings', JSON.stringify(settings));
}

function applyReadingSettings(settings) {
    const text = document.getElementById('chapter-text');
    if (!text) return;
    
    text.style.fontSize = settings.fontSize + 'px';
    text.style.lineHeight = settings.lineHeight;
    
    const fontFamilies = {
        default: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        serif: 'Georgia, "Times New Roman", serif',
        'sans-serif': 'Arial, Helvetica, sans-serif',
        monospace: '"Courier New", monospace'
    };
    text.style.fontFamily = fontFamilies[settings.fontFamily] || fontFamilies.default;
    
    const widths = {
        narrow: '600px',
        medium: '800px',
        wide: '1000px',
        full: '100%'
    };
    text.style.maxWidth = widths[settings.textWidth] || widths.medium;
}

function adjustFontSize(delta) {
    const settings = getReadingSettings();
    settings.fontSize = Math.max(12, Math.min(32, settings.fontSize + delta));
    
    const display = document.getElementById('font-size-display');
    if (display) display.textContent = settings.fontSize + 'px';
    
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeFontFamily(family) {
    const settings = getReadingSettings();
    settings.fontFamily = family;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeTextWidth(width) {
    const settings = getReadingSettings();
    settings.textWidth = width;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function changeLineHeight(height) {
    const settings = getReadingSettings();
    settings.lineHeight = height;
    saveReadingSettings(settings);
    applyReadingSettings(settings);
}

function toggleAutoScroll(enabled) {
    const settings = getReadingSettings();
    settings.autoScroll = enabled;
    saveReadingSettings(settings);
    
    if (enabled) {
        startAutoScroll();
    } else {
        stopAutoScroll();
    }
}

let autoScrollInterval = null;

function startAutoScroll() {
    stopAutoScroll();
    autoScrollInterval = setInterval(() => {
        window.scrollBy(0, 1);
    }, 50);
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

function resetReadingSettings() {
    localStorage.removeItem('reading-settings');
    const settings = getReadingSettings();
    applyReadingSettings(settings);
    
    document.getElementById('font-family-select').value = settings.fontFamily;
    document.getElementById('text-width-select').value = settings.textWidth;
    document.getElementById('line-height-select').value = settings.lineHeight;
    document.getElementById('auto-scroll').checked = settings.autoScroll;
    document.getElementById('font-size-display').textContent = settings.fontSize + 'px';
    
    showToast('Настройки сброшены', 'info');
}

//======================================================
// ПРОГРЕСС ЧТЕНИЯ
//======================================================

/**
 * ✨ ОБНОВЛЕНО: Отмечает главу прочитанной (вручную или автоматически)
 */
async function handleMarkAsRead(chapterId, novelId, isAutomatic = false) {
    // Используем ID кнопки ИЗ ПАНЕЛИ НАСТРОЕК
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');
    const markUnreadBtn = document.getElementById('mark-as-unread-btn'); // Нужна и вторая кнопка для обновления UI

    // Сначала проверка пользователя
    if (!STATE.currentUser) {
        // Показываем тост только при ручном вызове
        if (!isAutomatic) showToast('Для отслеживания прогресса нужно войти в систему', 'warning');
        return; // Выходим, если не авторизован
    }

    // Взаимодействуем с кнопкой только при ручном вызове
    if (!isAutomatic && markReadBtn) {
        markReadBtn.disabled = true;
        markReadBtn.textContent = 'Сохранение...';
    } else if (!isAutomatic && !markReadBtn) {
        console.warn("handleMarkAsRead вызван вручную, но кнопка 'mark-as-read-btn-panel' не найдена.");
        // Не показываем тост про вход, т.к. пользователь авторизован
    }

    try {
        const response = await apiPostRequest('markChapterRead', { chapter_id: chapterId });

        if (response.success) {
            // Обновляем локальный список ID
            if (window.readChapterIds && !window.readChapterIds.includes(chapterId)) {
                window.readChapterIds.push(chapterId);
            } else if (!window.readChapterIds) {
                window.readChapterIds = [chapterId]; // Инициализируем, если его не было
            }

            // Обновляем UI кнопок в панели (вызовется и для автомат. и для ручного)
            updateMarkReadUnreadButtons(chapterId);

            // Показываем тост только при ручном успешном вызове
            if (!isAutomatic) {
                showToast('Глава отмечена как прочитанная!', 'success');
            } else {
                 console.log(`Автоматическая отметка прочитанным для ${chapterId} успешна.`);
            }

            // Обновляем список глав на странице новеллы (если мы там)
            rerenderChapterListFromState();

            // Очищаем кэш новеллы
            delete STATE.cache.data[`getNovel_${JSON.stringify({id: novelId})}`];

        } else {
            throw new Error(response.error || 'Не удалось сохранить прогресс');
        }
    } catch (error) {
         // Показываем ошибку только при ручном вызове
        if (!isAutomatic) {
            showToast('Ошибка: ' + error.message, 'error');
            // Восстанавливаем кнопку только если это был ручной вызов и кнопка существует
            if (markReadBtn) {
                markReadBtn.textContent = '✔️ Отметить прочитанной';
                markReadBtn.disabled = false;
            }
        } else {
             console.error(`Ошибка автоматической отметки прочитанным для ${chapterId}:`, error);
        }
        // Обновляем кнопки в любом случае при ошибке, чтобы вернуть их в норм. состояние
        updateMarkReadUnreadButtons(chapterId);
    }
}

/**
 * ✨ ОБНОВЛЕНО: Отмечает главу НЕПРОЧИТАННОЙ
 */
async function handleMarkAsUnread(chapterId, novelId) {
    const markUnreadBtn = document.getElementById('mark-as-unread-btn');
    // Кнопка "Отметить прочитанной" тоже нужна для обновления UI
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');

    if (!STATE.currentUser || !markUnreadBtn) {
        showToast('Для изменения статуса нужно войти', 'warning');
        return;
    }

    markUnreadBtn.disabled = true;
    markUnreadBtn.textContent = 'Обновление...';

    try {
        const response = await apiPostRequest('markChapterUnread', { chapter_id: chapterId });

        if (response.success) {
            showToast('Глава отмечена как непрочитанная', 'success');

            // Обновляем локальный список прочитанных ID
            if (window.readChapterIds) {
                window.readChapterIds = window.readChapterIds.filter(id => id !== chapterId);
            }

            // Обновляем состояние кнопок в панели
            updateMarkReadUnreadButtons(chapterId);

            // Очищаем кэш новеллы
            delete STATE.cache.data[`getNovel_${JSON.stringify({id: novelId})}`];

            // Обновляем список глав на странице новеллы
            rerenderChapterListFromState();

        } else {
            throw new Error(response.error || 'Не удалось обновить статус');
        }
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
        // Возвращаем кнопку в исходное состояние при ошибке
        markUnreadBtn.textContent = '❌ Отметить непрочитанной';
        markUnreadBtn.disabled = false;
        // Обновляем кнопки на всякий случай
         updateMarkReadUnreadButtons(chapterId);
    }
}

/**
 * ✨ NEW: Обновляет видимость кнопок "Прочитано"/"Непрочитано" в панели настроек
 */
function updateMarkReadUnreadButtons(currentChapterId) {
    const markUnreadBtn = document.getElementById('mark-as-unread-btn');
    const markReadBtn = document.getElementById('mark-as-read-btn-panel');
    const statusMessage = document.getElementById('read-status-message');

    // Если панель настроек еще не открыта, элементы не будут найдены
    if (!markUnreadBtn || !markReadBtn || !statusMessage) {
        // console.log("Панель настроек чтения не открыта, кнопки не обновлены."); // Можно раскомментировать для отладки
        return;
    }

    // Проверяем статус текущей главы
    const isRead = window.readChapterIds && window.readChapterIds.includes(currentChapterId);

    if (isRead) {
        markUnreadBtn.style.display = 'block'; // Показываем "Отметить непрочитанной"
        markUnreadBtn.disabled = false;
        markUnreadBtn.textContent = '❌ Отметить непрочитанной'; // Стандартный текст
        markReadBtn.style.display = 'none';   // Скрываем "Отметить прочитанной"
        statusMessage.textContent = 'Глава отмечена как прочитанная.';
    } else {
        markUnreadBtn.style.display = 'none';   // Скрываем "Отметить непрочитанной"
        markReadBtn.style.display = 'block';  // Показываем "Отметить прочитанной"
        markReadBtn.disabled = false;
        markReadBtn.textContent = '✔️ Отметить прочитанной'; // Стандартный текст
        statusMessage.textContent = 'Глава еще не прочитана.';
    }
}

async function toggleChapterReadStatus(button, chapterId, novelId, isRead) {
    if (!STATE.currentUser) {
        showToast('Для отслеживания прогресса нужно войти', 'warning');
        return;
    }

    button.disabled = true;
    button.classList.add('is-saving');
    button.setAttribute('aria-busy', 'true');

    try {
        const response = isRead
            ? await apiPostRequest('markChapterUnread', {
                chapter_id: chapterId,
                novel_id: novelId
            })
            : await apiPostRequest('markChapterRead', {
                chapter_id: chapterId,
                novel_id: novelId,
                // Ручная отметка из оглавления не означает, что читатель
                // действительно открывал эту главу.
                preserve_last_chapter: true
            });
        if (!response.success) {
            throw new Error(response.error || 'Не удалось изменить статус главы');
        }

        const readIds = new Set((window.readChapterIds || []).map(id => String(id)));
        if (isRead) {
            readIds.delete(String(chapterId));
        } else {
            readIds.add(String(chapterId));
        }
        window.readChapterIds = [...readIds];
        window.currentReadingProgress = {
            ...(window.currentReadingProgress || {}),
            progress: response.progress ?? window.currentReadingProgress?.progress ?? 0,
            chapters_read: response.chapters_read ?? readIds.size,
            total_chapters: response.total_chapters ?? window.currentReadingProgress?.total_chapters,
            last_chapter_id: response.last_chapter_id ?? null,
            last_chapter_number: response.last_chapter_number ?? null,
            read_chapters: window.readChapterIds
        };

        updateStartReadingButton(window.currentReadingProgress);
        rerenderChapterListFromState();
        showToast(
            isRead
                ? 'Глава отмечена как непрочитанная'
                : 'Глава отмечена как прочитанная',
            'success'
        );
    } catch (error) {
        button.disabled = false;
        button.classList.remove('is-saving');
        button.removeAttribute('aria-busy');
        showToast('Не удалось изменить статус: ' + error.message, 'error');
    }
}

// Убираем 'chapters' из аргументов
async function loadAndDisplayReadingProgress(novelId) {
    const widget = document.querySelector('.novel-progress');
    let progress = null;
    try {
        const response = await apiRequest('getReadingProgress', { novel_id: novelId });
        if (response.success) progress = response;
    } catch (error) {
        console.warn('Не удалось загрузить прогресс чтения:', error);
    }
    if (widget && !widget.isConnected) return;

    window.currentReadingProgress = progress;
    window.readChapterIds = progress?.read_chapters || [];
    updateStartReadingButton(progress);
    const currentChapterId = new URLSearchParams(window.location.search).get('id');
    updateMarkReadUnreadButtons(currentChapterId);
    rerenderChapterListFromState();
}


// ==========================================
// ОГЛАВЛЕНИЕ И ТОМЫ
// ==========================================


function renderChaptersListV2(chapters, hasVolumes, canEdit, readChapterIds = [], novelReference = null) {
    if (!chapters || chapters.length === 0) {
        return '<p class="text-muted no-chapters">Пока нет глав</p>';
    }

    // 1. Сортируем ВСЕ главы ОДИН РАЗ правильно
    const sortedChapters = [...chapters].sort((a, b) => {
        const orderMultiplier = chapterSortOrder === 'asc' ? 1 : -1;
        const numA = parseFloat(a.chapter_number) || 0;
        const numB = parseFloat(b.chapter_number) || 0;
        const numCompare = numA - numB;
        if (numCompare !== 0) return orderMultiplier * numCompare;
        const volA = a.volume_order || 0;
        const volB = b.volume_order || 0;
        const volCompare = volA - volB;
        if (volCompare !== 0) return orderMultiplier * volCompare;
        const nameA = a.volume_name || '';
        const nameB = b.volume_name || '';
        return orderMultiplier * nameA.localeCompare(nameB);
    });
    const readChapterIdSet = new Set(
        (readChapterIds || []).map(id => String(id))
    );

    // 2. Если томов нет, просто рендерим отсортированный список
    if (!hasVolumes) {
        return sortedChapters.map(ch => renderChapterItemV2(ch, canEdit, readChapterIdSet.has(String(ch.chapter_id)), novelReference)).join('');
    }

    // 3. Группируем главы по томам (для получения названий и ключей)
    const volumes = {};
    sortedChapters.forEach(ch => {
        const volName = ch.volume_name || 'Основной том'; // Используем "Основной том"
        // Ключ для группировки и сортировки томов
        const volKey = `${String(ch.volume_order || 9999).padStart(5, '0')}-${volName}`;
        if (!volumes[volKey]) {
            volumes[volKey] = { name: volName }; // Нам нужно только имя для заголовка
        }
        // Сами главы хранить здесь больше не нужно
    });

    console.log('Группировка томов:', volumes);

    // 4. Сортируем КЛЮЧИ томов с учетом "Основного тома" и chapterSortOrder
    const sortedVolumeKeys = Object.keys(volumes).sort((keyA, keyB) => {
        const orderMultiplier = chapterSortOrder === 'asc' ? 1 : -1;
        
        // ✨ ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ:
        // Проверяем ключ по имени, а не по номеру "09999"
        const isA_Main = keyA.endsWith('-Основной том');
        const isB_Main = keyB.endsWith('-Основной том');

        // Логика для "Основного тома"
        if (isA_Main && !isB_Main) {
            // A = "Основной", B = "Номерной"
            // Цель (asc): Основной ПЕРВЫЙ. A должен быть ДО B. -> return -1
            // Цель (desc): Основной ПОСЛЕДНИЙ. A должен быть ПОСЛЕ B. -> return 1
            return chapterSortOrder === 'asc' ? -1 : 1; 
        }
        if (!isA_Main && isB_Main) {
            // A = "Номерной", B = "Основной"
            // Цель (asc): Основной (B) ПЕРВЫЙ. A должен быть ПОСЛЕ B. -> return 1
            // Цель (desc): Основной (B) ПОСЛЕДНИЙ. A должен быть ДО B. -> return -1
            return chapterSortOrder === 'asc' ? 1 : -1; 
        }

        // Логика для обычных томов (или если оба основные / оба не основные)
        // Сортируем по полному ключу (который содержит номер тома)
        return keyA.localeCompare(keyB) * orderMultiplier;
    });


    // 5. Рендерим секции томов в ПРАВИЛЬНОМ ПОРЯДКЕ
    return sortedVolumeKeys.map(volKey => {
        const volume = volumes[volKey]; // Получаем имя тома

        // ФИЛЬТРУЕМ УЖЕ ОТСОРТИРОВАННЫЙ список глав sortedChapters для текущего тома
        const chaptersForVolume = sortedChapters.filter(ch => {
            const currentVolName = ch.volume_name || 'Основной том';
            const currentVolOrder = ch.volume_order || 9999;
            const currentVolKey = `${String(currentVolOrder).padStart(5, '0')}-${currentVolName}`;
            return currentVolKey === volKey;
        });

        // Если для этого тома нет глав (не должно случиться, но на всякий случай)
        if (chaptersForVolume.length === 0) return '';

        // Рендерим секцию тома с УЖЕ отсортированными главами
        return `
            <div class="volume-section-v2">
                <div class="volume-header-v2" onclick="toggleVolumeV2(this)">
                    ${escapeHtml(volume.name)}
                    <span class="volume-chapter-count">(${chaptersForVolume.length} глав)</span>
                    <span class="volume-toggle-icon">▼</span>
                </div>
                <div class="volume-chapters-v2">
                    ${chaptersForVolume.map(ch => renderChapterItemV2(ch, canEdit, readChapterIdSet.has(String(ch.chapter_id)), novelReference)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * НОВАЯ ВЕРСИЯ: Рендерит одну строку (главу) для списка V2
 */
function renderChapterItemV2(chapter, canEdit, isRead, novelReference = null) {
    const isOwner = STATE.currentUser?.role === 'owner';
    const canTrackReading = Boolean(
        STATE.currentUser &&
        STATE.currentUser.user_id !== null &&
        STATE.currentUser.user_id !== undefined
    );
    const readClass = isRead ? 'read' : 'unread'; // Класс для подсветки
    const chapterNovelReference = novelReference || chapter.novel_slug || chapter.novel_id;

    // Форматируем даты для отображения и для tooltip
    const updatedDateStr = formatDateOnly(chapter.updated_at || chapter.created_at);
    const createdDateStr = formatDateTooltip(chapter.created_at);
    const tooltipText = `Добавлено: ${createdDateStr}`;
    const scheduleLabel = chapter.is_future
        ? `Отложенная глава. Выход ${formatDateTooltip(chapter.publish_at)}`
        : '';

    // --- ✨ НОВАЯ ЛОГИКА ДЛЯ КНОПОК ---
    let actionsHtml = '';
    if (canEdit && STATE.isChapterEditMode) {
        // РЕЖИМ РЕДАКТИРОВАНИЯ: Показываем кнопки "Edit" и "Delete"
        actionsHtml = `
            <button class="btn btn-sm btn-icon" title="Редактировать" onclick="event.stopPropagation(); navigateTo('edit-chapter', {novel: '${escapeHtml(chapterNovelReference)}', chapter: '${escapeHtml(chapter.chapter_number)}'})">
                ${renderUiIcon('edit')}
            </button>
            <button class="btn btn-sm btn-icon btn-danger" title="Удалить" onclick="event.stopPropagation(); handleDeleteChapter('${chapter.chapter_id}', '${escapeHtml(chapter.chapter_title)}')">
                ${renderUiIcon('trash')}
            </button>
        `;
    } else if (isOwner) {
        // ОБЫЧНЫЙ РЕЖИМ: Показываем "Docs" для владельца
        actionsHtml = `
            <a href="https://docs.google.com/document/d/${chapter.file_id}/edit" 
               target="_blank" 
               class="btn btn-sm btn-ghost" 
               title="Открыть в Google Docs"
               onclick="event.stopPropagation()">
                📄 Docs
            </a>
        `;
    }
    // -----------------------------

    return `
        <div class="chapter-item-v2 ${readClass}${canTrackReading ? ' has-read-toggle' : ''}">
            ${canTrackReading ? `
                <div class="ch-read-toggle">
                    <button type="button"
                            class="chapter-read-toggle-btn${isRead ? ' is-read' : ' is-unread'}"
                            title="${isRead ? 'Отметить непрочитанной' : 'Отметить прочитанной'}"
                            aria-label="${isRead ? 'Отметить главу непрочитанной' : 'Отметить главу прочитанной'}"
                            onclick="event.stopPropagation(); toggleChapterReadStatus(this, '${chapter.chapter_id}', '${chapter.novel_id}', ${isRead})">
                        ${renderUiIcon(isRead ? 'eye-off' : 'eye')}
                    </button>
                </div>
            ` : ''}
            <div class="ch-num">${chapter.chapter_number}</div>
            <div class="ch-title">
                <a href="/?page=chapter-read&novel=${encodeURIComponent(chapterNovelReference)}&chapter=${encodeURIComponent(chapter.chapter_number)}" onclick="handleLinkClick(event)">
                    ${escapeHtml(chapter.chapter_title)}
                </a>
                ${scheduleLabel ? `
                    <span class="chapter-scheduled-icon" role="img" aria-label="${scheduleLabel}" title="${scheduleLabel}">
                        ${renderUiIcon('clock')}
                    </span>
                ` : ''}
            </div>
            <div class="ch-words">${formatNumber(chapter.word_count || 0)}</div>
            <div class="ch-updated" data-tooltip="${tooltipText}">${updatedDateStr}</div>
            
            ${actionsHtml ? `<div class="ch-actions">${actionsHtml}</div>` : ''}
        </div>
    `;
}

/**
 * НОВАЯ ВЕРСИЯ: Переключает порядок сортировки глав V2
 */
function toggleChapterOrderV2() {
    chapterSortOrder = chapterSortOrder === 'asc' ? 'desc' : 'asc';

    // Подсказка объясняет порядок, который включится следующим нажатием.
    const sortBtn = document.getElementById('chapter-sort-btn-v2');
    if (sortBtn) {
        const sortLabel = chapterSortOrder === 'asc' ? 'Показать сначала новые главы' : 'Показать сначала старые главы';
        sortBtn.title = sortLabel;
        sortBtn.setAttribute('aria-label', sortLabel);
    }

    // Перерисовываем список глав
    const container = document.getElementById('chapters-list-v2');
    if (container && window.currentNovelChaptersV2) {
        container.innerHTML = renderChaptersListV2(
            window.currentNovelChaptersV2,
            window.currentNovelHasVolumesV2,
            window.currentNovelCanEditV2,
            window.readChapterIds || [], // Передаем прочитанные ID
            window.currentNovelReferenceV2
        );
        // Повторно инициализируем тултипы, так как элементы перерисованы
        initializeTooltips(); 
    }
}

/**
 * НОВАЯ ВЕРСИЯ: Сворачивает/разворачивает том V2
 */
function toggleVolumeV2(headerElement) {
    const volumeSection = headerElement.closest('.volume-section-v2');
    if (volumeSection) {
        volumeSection.classList.toggle('collapsed');
    }
}

// ==========================================
// РЕДАКТИРОВАНИЕ ОГЛАВЛЕНИЯ
// ==========================================

async function renderChapterManagerPage(novelReference) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    container.innerHTML = `
        <div class="page-content chapter-manager-page">
            <div class="chapter-manager-loading">
                <div class="spinner"></div>
                <p>Загружаем главы…</p>
            </div>
        </div>
    `;

    try {
        const response = await apiRequest('getNovel', { id: novelReference }, true);
        if (!response.success || !response.novel) {
            throw new Error(response.error || 'Новелла не найдена');
        }

        const novel = response.novel;
        if (!checkUserPermission('edit', novel)) {
            throw new Error('У вас нет прав на управление главами этой новеллы');
        }

        const useSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
        const canonicalReference = useSlug ? novel.slug : novel.novel_id;
        const chapters = [...(novel.chapters || [])].sort((a, b) => {
            const volumeCompare = Number(a.volume_order || 0) - Number(b.volume_order || 0);
            if (volumeCompare !== 0) return volumeCompare;
            return (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0);
        });
        const breadcrumbs = getBreadcrumbs('manage-chapters', {
            id: canonicalReference,
            title: novel.title
        });

        window.currentChapterManagerNovel = novel;
        window.currentChapterManagerNovelReference = canonicalReference;
        window.currentChapterManagerChapters = chapters;
        window.chapterManagerSelectedIds = new Set();

        container.innerHTML = `
            <section class="page-content chapter-manager-page">
                ${breadcrumbs}
                <header class="chapter-manager-heading">
                    <h1 class="visually-hidden">Управление главами новеллы «${escapeHtml(novel.title)}»</h1>
                    <div class="chapter-manager-heading-actions">
                        <button class="btn btn-secondary" onclick="navigateTo('novel-details', {id: '${escapeHtml(canonicalReference)}'})">
                            К новелле
                        </button>
                        <button class="btn btn-primary" onclick="navigateTo('add-chapter', {novelId: '${novel.novel_id}', returnTo: 'manage-chapters'})">
                            + Добавить главу
                        </button>
                    </div>
                </header>

                <div class="chapter-manager-toolbar">
                    <label class="chapter-manager-select-all">
                        <input type="checkbox" id="chapter-manager-select-all">
                        <span>Выбрать все</span>
                    </label>
                    <span class="chapter-manager-selected-count" id="chapter-manager-selected-count">Ничего не выбрано</span>
                    <div class="chapter-manager-batch-actions">
                        <button class="btn btn-secondary btn-sm" id="chapter-manager-edit-selected" disabled>
                            ${renderUiIcon('edit')}<span>Редактировать</span>
                        </button>
                        <button class="btn btn-danger btn-sm" id="chapter-manager-delete-selected" disabled>
                            ${renderUiIcon('trash')}<span>Удалить выбранные</span>
                        </button>
                    </div>
                </div>

                <p class="chapter-manager-list-count">${chapters.length} ${getNounEnding(chapters.length, 'глава', 'главы', 'глав')}</p>
                <div class="chapter-manager-list" id="chapter-manager-list">
                    ${chapters.length ? renderChapterManagerRows(chapters, canonicalReference) : `
                        <div class="chapter-manager-empty">
                            ${renderUiIcon('book')}
                            <h2>Глав пока нет</h2>
                            <p>Добавьте первую главу — она появится здесь и на странице новеллы.</p>
                        </div>
                    `}
                </div>
            </section>
        `;

        initializeChapterManagerInteractions();
    } catch (error) {
        container.innerHTML = `
            <div class="page-content error-page">
                <h3>Не удалось открыть управление главами</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn btn-secondary" onclick="goBackInHistory()">Вернуться</button>
            </div>
        `;
    }
}

function renderChapterManagerRows(chapters, novelReference) {
    return chapters.map(chapter => {
        const volumeLabel = chapter.volume_name || 'Без тома';
        const updatedAt = formatDateOnly(chapter.updated_at || chapter.created_at);
        return `
            <article class="chapter-manager-row" data-chapter-id="${chapter.chapter_id}">
                <label class="chapter-manager-checkbox" aria-label="Выбрать главу ${escapeHtml(chapter.chapter_number)}">
                    <input type="checkbox" class="chapter-manager-item-checkbox" value="${chapter.chapter_id}">
                    <span></span>
                </label>
                <div class="chapter-manager-number">${escapeHtml(chapter.chapter_number)}</div>
                <div class="chapter-manager-main">
                    <h2>
                        <button type="button" class="chapter-manager-title-link" onclick="navigateTo('edit-chapter', {novel: '${escapeHtml(novelReference)}', chapter: '${escapeHtml(chapter.chapter_number)}', returnTo: 'manage-chapters'})">
                            ${escapeHtml(chapter.chapter_title || `Глава ${chapter.chapter_number}`)}
                        </button>
                    </h2>
                    <p>${escapeHtml(volumeLabel)} · ${formatNumber(chapter.word_count || 0)} слов · ${updatedAt}</p>
                </div>
                <div class="chapter-manager-row-actions">
                    <button class="btn btn-secondary btn-icon" title="Редактировать главу" aria-label="Редактировать главу" onclick="navigateTo('edit-chapter', {novel: '${escapeHtml(novelReference)}', chapter: '${escapeHtml(chapter.chapter_number)}', returnTo: 'manage-chapters'})">
                        ${renderUiIcon('edit')}
                    </button>
                    <button class="btn btn-danger btn-icon" title="Удалить главу" aria-label="Удалить главу" onclick="confirmManagedChapterDeletion(['${chapter.chapter_id}'])">
                        ${renderUiIcon('trash')}
                    </button>
                </div>
            </article>
        `;
    }).join('');
}

function initializeChapterManagerInteractions() {
    const selectAll = document.getElementById('chapter-manager-select-all');
    const checkboxes = [...document.querySelectorAll('.chapter-manager-item-checkbox')];
    const editButton = document.getElementById('chapter-manager-edit-selected');
    const deleteButton = document.getElementById('chapter-manager-delete-selected');

    selectAll?.addEventListener('change', () => {
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAll.checked;
        });
        updateChapterManagerSelection();
    });
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateChapterManagerSelection);
    });
    editButton?.addEventListener('click', () => {
        const selected = getSelectedChapterManagerChapters();
        if (selected.length !== 1) return;
        navigateTo('edit-chapter', {
            novel: window.currentChapterManagerNovelReference,
            chapter: selected[0].chapter_number,
            returnTo: 'manage-chapters'
        });
    });
    deleteButton?.addEventListener('click', () => {
        const ids = [...(window.chapterManagerSelectedIds || [])];
        if (ids.length) confirmManagedChapterDeletion(ids);
    });
    updateChapterManagerSelection();
}

function getSelectedChapterManagerChapters() {
    const selected = window.chapterManagerSelectedIds || new Set();
    return (window.currentChapterManagerChapters || []).filter(chapter => (
        selected.has(String(chapter.chapter_id))
    ));
}

function updateChapterManagerSelection() {
    const checkboxes = [...document.querySelectorAll('.chapter-manager-item-checkbox')];
    const selectedIds = new Set(
        checkboxes.filter(checkbox => checkbox.checked).map(checkbox => String(checkbox.value))
    );
    window.chapterManagerSelectedIds = selectedIds;

    document.querySelectorAll('.chapter-manager-row').forEach(row => {
        row.classList.toggle('is-selected', selectedIds.has(String(row.dataset.chapterId)));
    });

    const count = selectedIds.size;
    const countLabel = document.getElementById('chapter-manager-selected-count');
    if (countLabel) {
        countLabel.textContent = count
            ? `Выбрано: ${count}`
            : 'Ничего не выбрано';
    }

    const selectAll = document.getElementById('chapter-manager-select-all');
    if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && count === checkboxes.length;
        selectAll.indeterminate = count > 0 && count < checkboxes.length;
    }

    const editButton = document.getElementById('chapter-manager-edit-selected');
    const deleteButton = document.getElementById('chapter-manager-delete-selected');
    if (editButton) editButton.disabled = count !== 1;
    if (deleteButton) deleteButton.disabled = count === 0;
}

function confirmManagedChapterDeletion(chapterIds) {
    const normalizedIds = [...new Set(chapterIds.map(String))];
    const selectedChapters = (window.currentChapterManagerChapters || []).filter(chapter => (
        normalizedIds.includes(String(chapter.chapter_id))
    ));
    if (!selectedChapters.length) return;

    const count = selectedChapters.length;
    const message = count === 1
        ? `Удалить главу «${selectedChapters[0].chapter_title}»? Она будет перемещена в корзину.`
        : `Удалить выбранные главы (${count})? Они будут перемещены в корзину.`;
    showConfirmModal(
        count === 1 ? 'Удаление главы' : 'Групповое удаление',
        message,
        () => deleteManagedChapters(normalizedIds)
    );
}

async function deleteManagedChapters(chapterIds) {
    const novel = window.currentChapterManagerNovel;
    if (!novel || !chapterIds.length) return;

    showLoading(true, {
        title: chapterIds.length === 1 ? 'Удаление главы' : `Удаление глав (${chapterIds.length})`
    });
    try {
        const response = await apiPostRequest('deleteChaptersBulk', {
            novel_id: novel.novel_id,
            chapter_ids: chapterIds
        });
        if (!response.success) throw new Error(response.error || 'Не удалось удалить главы');

        clearCache();
        showToast(
            response.deleted_count === 1
                ? 'Глава перемещена в корзину'
                : `Главы перемещены в корзину: ${response.deleted_count}`,
            'success'
        );
        await renderChapterManagerPage(window.currentChapterManagerNovelReference);
    } catch (error) {
        showToast('Не удалось удалить: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function toggleChapterEditMode(button, forceCancel = false) {
    if (forceCancel) {
        STATE.isChapterEditMode = false;
    } else {
        STATE.isChapterEditMode = !STATE.isChapterEditMode;
    }

    const mainBtn = document.getElementById('toggle-chapter-edit-btn');
    const cancelBtn = document.getElementById('cancel-chapter-edit-btn');
    const listContainer = document.getElementById('chapters-list-v2');

    if (STATE.isChapterEditMode) {
        if (mainBtn) {
            mainBtn.innerHTML = renderUiIcon('check');
            mainBtn.title = 'Готово';
            mainBtn.setAttribute('aria-label', 'Готово');
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        if (listContainer) listContainer.classList.add('edit-mode');
    } else {
        if (mainBtn) {
            mainBtn.innerHTML = renderUiIcon('edit');
            mainBtn.title = 'Редактировать главы';
            mainBtn.setAttribute('aria-label', 'Редактировать главы');
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (listContainer) listContainer.classList.remove('edit-mode');
    }

    // Перерисовываем список глав, чтобы показать/скрыть кнопки
    rerenderChapterListFromState();
}

/**
 * ✨ NEW: Вспомогательная функция для перерисовки списка глав
 */
function rerenderChapterListFromState() {
    const container = document.getElementById('chapters-list-v2');
    if (container && window.currentNovelChaptersV2) {
        container.innerHTML = renderChaptersListV2(
            window.currentNovelChaptersV2,
            window.currentNovelHasVolumesV2,
            window.currentNovelCanEditV2,
            window.readChapterIds || [],
            window.currentNovelReferenceV2
        );
        // Повторно инициализируем тултипы
        initializeTooltips();
    }
}

// ==========================================
// ЗАПУСК ЧТЕНИЯ
// ==========================================

// Начинаем с первой главы или возвращаемся к последней реально открытой.
function startReading() {
    // Проверяем, есть ли вообще главы для этой новеллы
    if (window.currentNovelChapters && window.currentNovelChapters.length > 0) {

        // ✨ ИЗМЕНЕНИЕ: Находим главу с минимальным номером
        // Сначала копируем массив, чтобы не менять исходный
        const chaptersCopy = [...window.currentNovelChapters];

        // Сортируем копию ТОЛЬКО по возрастанию номера (и тома)
        chaptersCopy.sort((a, b) => {
            // Сначала по номеру тома (если есть)
            const volCompare = (a.volume_order || 0) - (b.volume_order || 0);
            if (volCompare !== 0) return volCompare;
            // Затем по номеру главы
            return (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0);
        });

        // Для вошедшего читателя продолжаем с последней реально открытой главы.
        // Кнопка хранит тот же выбор, который показан её подписью.
        const startButton = document.getElementById('start-reading-btn');
        const buttonChapter = startButton?.dataset.chapterId
            ? chaptersCopy.find(chapter => String(chapter.chapter_id) === String(startButton.dataset.chapterId))
            : startButton?.dataset.chapterNumber
                ? chaptersCopy.find(chapter => String(chapter.chapter_number) === String(startButton.dataset.chapterNumber))
                : null;
        // Если сохранённая глава стала недоступна, безопасно начинаем с первой.
        const targetChapter = buttonChapter || findLastOpenedChapter() || chaptersCopy[0];
        const novelReference = window.currentNovelReferenceV2 || targetChapter.novel_id;

        // Переходим на выбранную главу
        navigateTo('chapter-read', {
            novel: novelReference,
            chapter: targetChapter.chapter_number
        });

    } else {
        // Если глав нет, показываем сообщение
        showAlertModal('Нет глав', 'Пока нет доступных глав для чтения', 'info');
    }
}

async function trackOpenedChapter(chapterId, novelId, lastParagraphIndex = 0) {
    if (!STATE.currentUser) return;

    try {
        const response = await apiPostRequest('updateReadingProgress', {
            chapter_id: chapterId,
            novel_id: novelId,
            last_paragraph_index: lastParagraphIndex
        });
        if (!response.success) throw new Error(response.error || 'Не удалось сохранить прогресс');

        if (!window.readChapterIds) window.readChapterIds = [];
        if (!window.readChapterIds.some(id => String(id) === String(chapterId))) {
            window.readChapterIds.push(chapterId);
        }

        window.currentReadingProgress = {
            ...(window.currentReadingProgress || {}),
            last_chapter_id: chapterId,
            last_chapter_number: response.last_chapter,
            read_chapters: window.readChapterIds
        };
        updateMarkReadUnreadButtons(chapterId);
        rerenderChapterListFromState();
    } catch (error) {
        console.error(`Не удалось сохранить последнюю открытую главу ${chapterId}:`, error);
    }
}

// ==========================================
// ФОРМАТИРОВАНИЕ ТЕКСТА ГЛАВЫ
// ==========================================

function normalizeChapterRichColor(color) {
    const value = String(color || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!rgb) return '';
    return `#${rgb.slice(1, 4)
        .map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0'))
        .join('')}`;
}

function normalizeChapterRichSize(size, fallback = 18) {
    const numeric = Number(size);
    return Number.isFinite(numeric) && numeric >= 10 && numeric <= 48
        ? Math.round(numeric)
        : fallback;
}

function parseChapterRichDocument(value) {
    if (!value) return null;

    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || !Array.isArray(parsed.blocks)) return null;
        return {
            version: 1,
            blocks: parsed.blocks
        };
    } catch (error) {
        console.warn('Не удалось прочитать форматирование главы:', error);
        return null;
    }
}

function findLastOpenedChapter(progress = window.currentReadingProgress) {
    const chapters = window.currentNovelChapters || [];
    if (!progress || !chapters.length) return null;

    return chapters.find(chapter => (
        progress.last_chapter_id != null &&
        String(chapter.chapter_id) === String(progress.last_chapter_id)
    )) || chapters.find(chapter => (
        progress.last_chapter_number != null &&
        String(chapter.chapter_number) === String(progress.last_chapter_number)
    )) || null;
}

function updateStartReadingButton(progress = window.currentReadingProgress) {
    const buttons = document.querySelectorAll('.start-reading-btn');

    const lastOpenedChapter = findLastOpenedChapter(progress);
    buttons.forEach(button => {
        button.textContent = lastOpenedChapter ? 'Продолжить чтение' : 'Начать чтение';
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.dataset.mode = lastOpenedChapter ? 'continue' : 'start';
        if (lastOpenedChapter) {
            button.dataset.chapterId = lastOpenedChapter.chapter_id;
            button.dataset.chapterNumber = lastOpenedChapter.chapter_number;
        } else {
            delete button.dataset.chapterId;
            delete button.dataset.chapterNumber;
        }
    });

    const meter = document.querySelector('[data-reading-progress]');
    if (meter) {
        const chapters = new Set((window.currentNovelChapters || []).map(chapter => String(chapter.chapter_id)));
        const read = new Set((progress?.read_chapters || []).map(String));
        const completed = [...read].filter(id => chapters.has(id)).length;
        meter.value = completed;
        const percent = Math.round(100 * completed / meter.max);
        document.querySelector('[data-reading-progress-count]').textContent = `${completed} / ${meter.max} · ${percent}%`;
    }
}

function getChapterNovelReference(chapter) {
    const useSlug = (chapter?.novel_access_type === 'link_only' || chapter?.novel_access_type === 'private') && chapter?.novel_slug;
    return useSlug ? chapter.novel_slug : chapter?.novel_id;
}

function getCurrentChapterParagraphIndex() {
    const paragraphs = Array.from(document.querySelectorAll('#chapter-text p'));
    if (!paragraphs.length) return 0;

    const readingLine = Math.max(0, document.getElementById('reader-header')?.offsetHeight || 0) + 24;
    const index = paragraphs.findIndex(paragraph => paragraph.getBoundingClientRect().bottom > readingLine);
    return index === -1 ? paragraphs.length - 1 : index;
}

function getReadingPositionStorageKey(novelId) {
    const userId = STATE.currentUser?.user_id ?? 'guest';
    return `novel_lair_reading_position_${userId}_${novelId}`;
}

function readLocalChapterPosition(novelId, chapterId) {
    try {
        const stored = JSON.parse(localStorage.getItem(getReadingPositionStorageKey(novelId)) || 'null');
        return stored && String(stored.chapterId) === String(chapterId)
            ? Math.max(0, Number(stored.paragraphIndex) || 0)
            : null;
    } catch {
        return null;
    }
}

function rememberLocalChapterPosition(chapterId, novelId) {
    const paragraphIndex = getCurrentChapterParagraphIndex();
    const position = { chapterId, paragraphIndex, savedAt: Date.now() };
    window.currentChapterReadingPosition = position;
    try {
        localStorage.setItem(getReadingPositionStorageKey(novelId), JSON.stringify(position));
    } catch (error) {
        console.warn('Не удалось сохранить место чтения в браузере:', error);
    }
    return position;
}

async function saveChapterParagraphPosition(chapterId, novelId, { keepalive = false } = {}) {
    if (!STATE.currentUser || !chapterId || !novelId) return;

    const position = rememberLocalChapterPosition(chapterId, novelId);
    const paragraphIndex = position.paragraphIndex;
    if (
        window.lastSavedChapterParagraphIndex === paragraphIndex &&
        String(window.lastSavedChapterId) === String(chapterId)
    ) return;
    window.lastSavedChapterParagraphIndex = paragraphIndex;

    try {
        await apiPostRequest('updateReadingProgress', {
            chapter_id: chapterId,
            novel_id: novelId,
            last_paragraph_index: paragraphIndex
        }, { keepalive });
        window.lastSavedChapterId = chapterId;
    } catch (error) {
        console.warn('Не удалось сохранить место чтения:', error);
    }
}

async function restoreAndTrackChapterPosition(chapter) {
    const chapterId = chapter.chapter_id;
    const novelId = chapter.novel_id;
    let paragraphIndex = readLocalChapterPosition(novelId, chapterId);

    // Если это первое открытие на этом устройстве, берём сохранённую позицию
    // из базы. Пока она загружается, текст ещё закрыт общим загрузочным слоем.
    if (paragraphIndex === null && STATE.currentUser) {
        try {
            const progress = await apiRequest('getReadingProgress', { novel_id: novelId });
            if (progress.success && String(progress.last_chapter_id) === String(chapterId)) {
                paragraphIndex = Math.max(0, Number(progress.last_paragraph_index) || 0);
            }
        } catch (error) {
            console.warn('Не удалось загрузить сохранённое место чтения:', error);
        }
    }
    paragraphIndex = paragraphIndex ?? 0;

    const paragraphs = Array.from(document.querySelectorAll('#chapter-text p'));
    const target = paragraphs[Math.min(paragraphIndex, Math.max(0, paragraphs.length - 1))];
    if (target && paragraphIndex > 0) {
        requestAnimationFrame(() => {
            target.scrollIntoView({ block: 'start' });
            window.scrollBy(0, -(document.getElementById('reader-header')?.offsetHeight || 0) - 16);
        });
    }

    window.lastSavedChapterParagraphIndex = paragraphIndex;
    window.lastSavedChapterId = null;
    window.currentChapterReadingPosition = { chapterId, paragraphIndex, savedAt: Date.now() };
    const rememberPosition = () => {
        window.currentChapterReadingPosition = {
            chapterId,
            paragraphIndex: getCurrentChapterParagraphIndex(),
            savedAt: Date.now()
        };
    };
    const saveNow = (keepalive = false) => saveChapterParagraphPosition(chapterId, novelId, { keepalive });
    const saveOnPageHide = () => { void saveNow(true); };

    // Прокрутка меняет только значение в памяти браузера. Запроса к Supabase
    // и записи в localStorage здесь нет.
    window.addEventListener('scroll', rememberPosition, { passive: true });
    window.addEventListener('pagehide', saveOnPageHide, { once: true });
    window.chapterReadingPositionCleanup = () => {
        window.removeEventListener('scroll', rememberPosition);
        window.removeEventListener('pagehide', saveOnPageHide);
        const saving = saveNow();
        window.chapterReadingPositionCleanup = null;
        return saving;
    };
}

function renderChapterRichRuns(runs = []) {
    return runs.map(run => {
        let content = escapeHtml(run.text || '').replace(/\n/g, '<br>');
        if (!content) return '';
        if (run.bold) content = `<strong>${content}</strong>`;
        if (run.italic) content = `<em>${content}</em>`;
        if (run.underline) content = `<u>${content}</u>`;
        if (run.strike) content = `<s>${content}</s>`;

        const styles = [];
        const color = normalizeChapterRichColor(run.color);
        const size = run.size ? normalizeChapterRichSize(run.size, 18) : null;
        if (color) styles.push(`color:${color}`);
        if (size) styles.push(`font-size:${size}px`);
        return styles.length ? `<span style="${styles.join(';')}">${content}</span>` : content;
    }).join('');
}

function renderChapterRichContent(value, fallbackText = '') {
    const documentData = parseChapterRichDocument(value);
    if (!documentData) return formatChapterText(fallbackText);

    const blocks = documentData.blocks.map(block => {
        if (block.type === 'divider') return '<hr class="chapter-divider">';
        const content = renderChapterRichRuns(Array.isArray(block.runs) ? block.runs : []);
        if (block.type === 'quote') {
            return `<blockquote class="chapter-quote"><p>${content || '<br>'}</p></blockquote>`;
        }
        return `<p>${content || '<br>'}</p>`;
    }).join('');

    return `<div class="chapter-rich-content">${blocks}</div>`;
}

function chapterRichDocumentToPlainText(value) {
    const documentData = parseChapterRichDocument(value);
    if (!documentData) return '';

    return documentData.blocks.map(block => {
        if (block.type === 'divider') return '';
        return (block.runs || []).map(run => run.text || '').join('');
    }).join('\n');
}

function renderChapterEditorContent(value, fallbackText = '') {
    const documentData = parseChapterRichDocument(value);
    if (!documentData) {
        return (fallbackText || '').split('\n').map(line =>
            `<p>${line ? escapeHtml(line) : '<br>'}</p>`
        ).join('');
    }

    return documentData.blocks.map(block => {
        if (block.type === 'divider') return '<hr>';
        const content = renderChapterRichRuns(block.runs || []) || '<br>';
        return block.type === 'quote'
            ? `<blockquote>${content}</blockquote>`
            : `<p>${content}</p>`;
    }).join('');
}

function collectChapterEditorRuns(root) {
    const runs = [];

    const appendRun = (text, style) => {
        if (!text) return;
        const normalized = {
            text,
            bold: !!style.bold,
            italic: !!style.italic,
            underline: !!style.underline,
            strike: !!style.strike,
            color: normalizeChapterRichColor(style.color),
            size: style.size ? normalizeChapterRichSize(style.size, 18) : null
        };
        const previous = runs[runs.length - 1];
        const sameStyle = previous &&
            previous.bold === normalized.bold &&
            previous.italic === normalized.italic &&
            previous.underline === normalized.underline &&
            previous.strike === normalized.strike &&
            previous.color === normalized.color &&
            previous.size === normalized.size;
        if (sameStyle) previous.text += text;
        else runs.push(normalized);
    };

    const walk = (node, inherited = {}) => {
        if (node.nodeType === Node.TEXT_NODE) {
            appendRun(node.nodeValue || '', inherited);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const element = node;
        if (element.tagName === 'BR') {
            appendRun('\n', inherited);
            return;
        }

        if (['P', 'DIV'].includes(element.tagName) && runs.length > 0) {
            const lastText = runs[runs.length - 1]?.text || '';
            if (!lastText.endsWith('\n')) appendRun('\n', inherited);
        }

        const style = { ...inherited };
        if (['B', 'STRONG'].includes(element.tagName)) style.bold = true;
        if (['I', 'EM'].includes(element.tagName)) style.italic = true;
        if (element.tagName === 'U') style.underline = true;
        if (['S', 'STRIKE', 'DEL'].includes(element.tagName)) style.strike = true;

        const computedColor = element.style?.color || element.getAttribute?.('color') || '';
        const normalizedColor = normalizeChapterRichColor(computedColor);
        if (normalizedColor) style.color = normalizedColor;

        const fontSize = parseFloat(element.style?.fontSize || '');
        if (Number.isFinite(fontSize)) style.size = fontSize;

        Array.from(element.childNodes).forEach(child => walk(child, style));
    };

    Array.from(root.childNodes).forEach(node => walk(node, {}));
    return runs.filter(run => run.text !== '');
}

function serializeChapterEditorContent() {
    const editor = document.getElementById('chapter-content-editor');
    if (!editor) return null;

    const blocks = [];
    let inlineBuffer = [];

    const flushInlineBuffer = () => {
        if (inlineBuffer.length === 0) return;
        const holder = document.createElement('div');
        inlineBuffer.forEach(node => holder.appendChild(node.cloneNode(true)));
        blocks.push({ type: 'paragraph', runs: collectChapterEditorRuns(holder) });
        inlineBuffer = [];
    };

    Array.from(editor.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            inlineBuffer.push(node);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName;
        if (tag === 'HR') {
            flushInlineBuffer();
            blocks.push({ type: 'divider', runs: [] });
        } else if (tag === 'BLOCKQUOTE') {
            flushInlineBuffer();
            blocks.push({ type: 'quote', runs: collectChapterEditorRuns(node) });
        } else if (['P', 'DIV'].includes(tag)) {
            flushInlineBuffer();
            blocks.push({ type: 'paragraph', runs: collectChapterEditorRuns(node) });
        } else {
            inlineBuffer.push(node);
        }
    });
    flushInlineBuffer();

    if (blocks.length === 0) blocks.push({ type: 'paragraph', runs: [] });

    return {
        version: 1,
        blocks
    };
}

function formatChapterInline(text) {
    let html = escapeHtml(text);

    html = html
        .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<u>$1</u>')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    return html;
}

function formatChapterText(text) {
    if (!text) return '';

    const result = [];
    let quoteLines = [];

    const flushQuote = () => {
        if (quoteLines.length === 0) return;
        result.push(`<blockquote class="chapter-quote">${quoteLines
            .map(line => `<p>${formatChapterInline(line)}</p>`)
            .join('')}</blockquote>`);
        quoteLines = [];
    };

    text.split('\n').forEach(line => {
        const trimmed = line.trim();

        if (/^>\s?/.test(trimmed)) {
            quoteLines.push(trimmed.replace(/^>\s?/, ''));
            return;
        }

        flushQuote();

        if (/^(---|\*\*\*|___)$/.test(trimmed)) {
            result.push('<hr class="chapter-divider">');
        } else if (!trimmed) {
            result.push('<br>');
        } else {
            result.push(`<p>${formatChapterInline(line)}</p>`);
        }
    });

    flushQuote();
    return result.join('');
}

function getChapterPlainText(text) {
    return (text || '')
        .replace(/^(>\s?)/gm, '')
        .replace(/^(---|\*\*\*|___)$/gm, '')
        .replace(/(\*\*|__|~~|\*)/g, '');
}

// ==========================================
// СТРАНИЦА ЧТЕНИЯ
// ==========================================

// Заменяем существующую renderChapterReadPage
async function renderChapterReadPage(
    chapterReference,
    chapterNumber = null
) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    showLoading(true, { animationType: 'bubbles' });
    
    container.innerHTML = `<div class="page-content chapter-read-page"></div>`;
    
    try {
        // ВАЖНО: Я предполагаю, что твой ответ от 'getChapter'
        // теперь также включает:
        // response.chapter.allChapters (массив всех глав новеллы)
        // response.chapter.prevChapterId (ID или null)
        // response.chapter.nextChapterId (ID или null)
        const requestParams =
            chapterNumber !== null
                ? {
                    novel: chapterReference,
                    chapter: chapterNumber
                }
                : {
                    id: chapterReference
                };

        const response = await apiRequest(
            'getChapter',
            requestParams
        );
        
        if (response.success && response.chapter) {
            const chapter = response.chapter;
            const chapterId = chapter.chapter_id;

            window.currentChapterData = chapter;

            // Приводим адрес к новому понятному формату.
            // Старые ссылки с id после загрузки тоже будут заменены.
            const canonicalUrl = new URL(window.location.href);

            canonicalUrl.search = '';
            canonicalUrl.searchParams.set('page', 'chapter-read');
            const novelReference = getChapterNovelReference(chapter);
            canonicalUrl.searchParams.set('novel', novelReference);
            canonicalUrl.searchParams.set(
                'chapter',
                chapter.chapter_number
            );

            window.history.replaceState(
                {
                    page: 'chapter-read',
                    params: {
                        novel: String(novelReference),
                        chapter: String(chapter.chapter_number)
                    }
                },
                '',
                canonicalUrl
            );

            // Сохраняем данные для оверлея быстрой навигации
            window.currentChapterList = chapter.allChapters || [];
            window.currentNovelIdForNav = novelReference;
            
            // Генерируем хлебные крошки
            // Здесь мы тоже должны опираться на access_type, если сервер его отдает вместе с главой,
            // но главное - текст (novelTitle) должен быть названием.
            const useSlug = (chapter.novel_access_type === 'link_only' || chapter.novel_access_type === 'private') && chapter.novel_slug;

            const breadcrumbs = getBreadcrumbs('chapter-read', {
                novelId: useSlug ? chapter.novel_slug : chapter.novel_id, 
                novelTitle: chapter.novel_title, // <-- Отображается красивое название
                chapterTitle: `Глава ${chapter.chapter_number}`
            });

            // Рендерим всё
            renderChapterContentV2(chapter, breadcrumbs); 

            // Сначала возвращаем читателя к сохранённому абзацу, затем начинаем
            // запоминать новое место при прокрутке.
            await restoreAndTrackChapterPosition(chapter);

            const overlay = document.getElementById('chapter-load-overlay');
            if (overlay) overlay.style.display = 'none';
            
            // Запускаем JS для скролла хедера
            setupReaderHeaderScroll();
        } else {
            throw new Error('Глава не найдена');
        }
    } catch (error) {
        container.innerHTML = `
            <div class="error-page">
                <h3>❌ Ошибка загрузки главы</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="goBackInHistory()">← Вернуться</button>
            </div>
        `;
    } finally {
        showLoading(false);
        const overlay = document.getElementById('chapter-load-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

// Заменяем существующую renderChapterContentV2
function renderChapterContentV2(chapter, breadcrumbsHtml) { 
    const container = document.querySelector('.chapter-read-page');
    if (!container) return;
    const novelReference = getChapterNovelReference(chapter);
    
    // --- 1. HTML для нового хедера ---
    const readerHeaderHtml = `
        <header class="reader-header" id="reader-header">
            <div class="reader-header-left">
                <a href="/?page=novel-details&id=${encodeURIComponent(novelReference)}" onclick="handleLinkClick(event)" class="btn-reader-back" title="К новелле">
                    <span>←</span>
                </a>
            </div>
            <div class="reader-header-center">
                <button class="btn-reader-title" onclick="toggleChapterQuickNav()">
                    <span>
                        Гл. ${chapter.chapter_number}: ${escapeHtml(chapter.chapter_title)}
                    </span>
                    <span class="title-caret">▼</span>
                </button>
            </div>
            <div class="reader-header-right">
                <button class="btn btn-ghost btn-sm" onclick="toggleReadingSettings()" title="Настройки чтения">
                    ⚙️
                </button>
            </div>
        </header>
    `;

    // --- 2. HTML для нижней навигации ---
    const bottomNavHtml = `
        <div class="reader-bottom-nav">
            ${chapter.prevChapterNumber !== null &&
              chapter.prevChapterNumber !== undefined
                    ? `
                        <a
                            href="/?page=chapter-read&novel=${encodeURIComponent(novelReference)}&chapter=${encodeURIComponent(chapter.prevChapterNumber)}"
                            onclick="handleLinkClick(event)"
                            class="btn btn-nav-prev"
                        >
                            ← <span class="nav-text">Предыдущая</span>
                        </a>
                    `
                    : '<span></span>'
            }
            
            <a href="/?page=novel-details&id=${encodeURIComponent(novelReference)}" onclick="handleLinkClick(event)" class="btn btn-nav-toc">
                Оглавление
            </a>
            
            ${
                chapter.nextChapterNumber !== null &&
                chapter.nextChapterNumber !== undefined
                    ? `
                        <a
                            href="/?page=chapter-read&novel=${encodeURIComponent(novelReference)}&chapter=${encodeURIComponent(chapter.nextChapterNumber)}"
                            onclick="handleLinkClick(event)"
                            class="btn btn-nav-next"
                        >
                            <span class="nav-text">Следующая</span> →
                        </a>
                    `
                    : '<span></span>'
            }
        </div>
    `;

    // --- 3. HTML для контента (с крошками) ---
    const contentHtml = `
        <article class="chapter-content-wrapper">
            
            ${breadcrumbsHtml} 
            
            <div class="chapter-text" id="chapter-text">
                ${(chapter.content || chapter.content_rich) ? renderChapterRichContent(chapter.content_rich, chapter.content) : `
                    <div class="no-content">
                        <p>Текст главы пока не загружен</p>
                    </div>
                `}
            </div>
            
            ${bottomNavHtml}
            
        </article>
    `;
    
    // Сначала вставляем хедер, потом контент
    container.innerHTML = readerHeaderHtml + contentHtml;
    
    // Применяем настройки (если они есть)
    const settings = getReadingSettings();
    setTimeout(() => applyReadingSettings(settings), 100);
}

/**
 * Показывает или скрывает оверлей быстрой навигации по главам
 */
function toggleChapterQuickNav() {
    let overlay = document.getElementById('quick-nav-overlay');
    
    // Если оверлей еще не создан, создаем его
    if (!overlay) {
        overlay = renderChapterQuickNav();
    }
    
    // Показываем или скрываем
    const isVisible = overlay.classList.toggle('show');
    document.body.style.overflow = isVisible ? 'hidden' : '';
    
    // Если показали, фокусируемся на поиске
    if (isVisible) {
        const searchInput = document.getElementById('quick-nav-search');
        if (searchInput) {
            searchInput.focus();
        }
    }
}

/**
 * Создает HTML для оверлея быстрой навигации (вызывается 1 раз)
 */
function renderChapterQuickNav() {
    const chapters = window.currentChapterList || [];
    const novelId = window.currentNovelIdForNav || null;

    const sortedChaptersForNav = [...chapters].sort((a, b) => {
        // Преобразуем номера глав в числа (parseFloat для поддержки дробных)
        const numA = parseFloat(a.chapter_number) || 0;
        const numB = parseFloat(b.chapter_number) || 0;

        return numA - numB;

    });

    const overlay = document.createElement('div');
    overlay.id = 'quick-nav-overlay';
    
    const listHtml = sortedChaptersForNav.length > 0
        ? sortedChaptersForNav.map(ch => `
            <a href="/?page=chapter-read&novel=${encodeURIComponent(novelId)}&chapter=${encodeURIComponent(ch.chapter_number)}"
               class="quick-nav-item"
               onclick="handleLinkClick(event); toggleChapterQuickNav()">
                <span class="quick-nav-number">Гл. ${ch.chapter_number}</span>
                <span class="quick-nav-title">${escapeHtml(ch.chapter_title)}</span>
            </a>
          `).join('')
        : '<p class="text-muted">Список глав не загружен</p>';

    overlay.innerHTML = `
        <div class="quick-nav-header">
            <input type="text" id="quick-nav-search" class="form-input" 
                   placeholder="Поиск по номеру или названию..."
                   oninput="filterQuickNav(this.value)">
            <button class="quick-nav-close" onclick="toggleChapterQuickNav()">×</button>
        </div>
        <div class="quick-nav-list">
            ${listHtml}
        </div>
        ${novelId ? `
            <div class="quick-nav-footer">
                <a href="/?page=novel-details&id=${novelId}" 
                   class="btn btn-secondary"
                   onclick="handleLinkClick(event); toggleChapterQuickNav()">
                    Перейти к оглавлению
                </a>
            </div>
        ` : ''}
    `;
    
    document.body.appendChild(overlay);
    return overlay;
}

/**
 * Фильтрует список в оверлее быстрой навигации
 */
function filterQuickNav(query) {
    const list = document.querySelector('.quick-nav-list');
    if (!list) return;
    
    const items = list.getElementsByTagName('a');
    const normalizedQuery = query.toLowerCase().trim();
    
    for (let item of items) {
        const text = item.textContent.toLowerCase();
        if (text.includes(normalizedQuery)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    }
}

/**
 * Настраивает авто-скрытие хедера (С ЛОГАМИ, V10 - Правильное чтение scrollTop)
 */
function setupReaderHeaderScroll() {
    const header = document.getElementById('reader-header');
    if (!header) {
        console.error("Хедер чтения ('reader-header') не найден!");
        return;
    }
    console.log("setupReaderHeaderScroll: Хедер найден, высота:", header.offsetHeight);

    // Инициализируем lastScrollTop ПРАВИЛЬНЫМ текущим значением
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const delta = 250;
    const headerHeight = header.offsetHeight;

    // Цель - window
    const scrollTarget = window;
    const scrollTargetName = 'window';

    // Обработчик скролла
    currentScrollHandler = (event) => {
        // ✨ ИСПРАВЛЕНИЕ: Используем стандартный способ получения scrollTop ✨
        let st = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

        // Игнорируем маленький скролл у верха
        if (st > 5 && Math.abs(lastScrollTop - st) <= delta) {
             return;
         }

        // --- Логика показа/скрытия (без изменений) ---
        if (st > lastScrollTop && st > headerHeight){
          header.classList.add('is-hidden');
        } else {
          // Показываем, если скроллим вверх ИЛИ почти у самого верха
          if (st < lastScrollTop || st <= 5) {
              // Проверяем, существует ли класс перед удалением
              if (header.classList.contains('is-hidden')) {
                  header.classList.remove('is-hidden');
              }
          }
        }
        // --------------------------------------------------------

        lastScrollTop = st <= 0 ? 0 : st;
    };

    // Отложенное добавление с фазой перехвата (оставляем)
    setTimeout(() => {
        if (currentScrollHandler) {
             scrollTarget.addEventListener('scroll', currentScrollHandler, {
                 capture: true,
                 passive: true
             });
            console.log(`setupReaderHeaderScroll: Scroll listener ADDED (delayed & capturing) to '${scrollTargetName}'.`);
        } else {
            console.log(`setupReaderHeaderScroll: Listener was cleared before delayed attachment.`);
        }
    }, 100);

    // --- Обработчик mousemove (без изменений) ---
    let mouseMoveTimeout;
    const mouseMoveHandler = (e) => {
        clearTimeout(mouseMoveTimeout);
        mouseMoveTimeout = setTimeout(() => {
            if (e.clientY < 80) {
                 // Проверяем, существует ли класс перед удалением
                 if (header.classList.contains('is-hidden')) {
                     console.log("MouseMove near top: Forcing header visible");
                     header.classList.remove('is-hidden');
                 }
            }
        }, 100);
    };
    document.addEventListener('mousemove', mouseMoveHandler);
    console.log("setupReaderHeaderScroll: MouseMove listener added.");

    // Сохраняем цель (window) и обработчик mousemove
    currentScrollHandler._scrollTarget = scrollTarget;
    currentScrollHandler._mouseMoveHandler = mouseMoveHandler;

     // Код удаления в renderPage НЕ меняем!
}

// ==========================================
// ФОРМА ГЛАВЫ (ВИРТУАЛЬНАЯ СТРАНИЦА)
// ==========================================

function formatChapterDateTimeLocal(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';

    const localDate = new Date(
        date.getTime() - date.getTimezoneOffset() * 60 * 1000
    );

    return localDate.toISOString().slice(0, 16);
}

function returnFromChapterEditor() {
    const target = window.currentChapterEditorReturnTarget;
    if (target?.page) {
        navigateTo(target.page, target.params || {});
        return;
    }
    goBackInHistory();
}

async function renderChapterFormPage(
    novelId = null,
    chapterId = null,
    chapterNumber = null,
    returnTo = null
) {
    const container = document.getElementById('page-content-container');
    if (!container) return;

    const isEdit = !!chapterId || (chapterNumber !== null && chapterNumber !== undefined && chapterNumber !== '');
    
    // ✅ КРИТИЧНО: Объявляем переменные ВНЕ блока try
    let chapterData = null;
    let novelData = null;
    let nextChapterNumber = '';
    let lastVolumeName = '';
    let existingVolumes = [];
    let uniqueVolumes = [];
    let volumeShortcutButtons = '';

    showLoading(true, { title: 'Загрузка данных...' });

    try {
        // Если это редактирование, сначала получаем данные главы
        if (isEdit) {
            const requestParams = chapterId
                ? { id: chapterId }
                : { novel: novelId, chapter: chapterNumber };
            const chapterResponse = await apiRequest('getChapterForEdit', requestParams, true);
            if (chapterResponse.success && chapterResponse.chapter) {
                chapterData = chapterResponse.chapter;
                novelData = chapterResponse.novel || null;
                chapterId = chapterData.chapter_id;
                novelId = chapterData.novel_id;
            } else {
                throw new Error(chapterResponse.error || 'Не удалось найти главу.');
            }
        }

        // Получаем данные новеллы
        if (!novelData) {
            if (!novelId) {
                throw new Error('Не указан ID новеллы для создания главы.');
            }

            const novelResponse = await apiRequest('getNovel', { id: novelId }, true);
            if (novelResponse.success && novelResponse.novel) {
                novelData = novelResponse.novel;
                novelId = novelData.novel_id;
            } else {
                throw new Error(novelResponse.error || 'Новелла не найдена.');
            }
        }

        // ✨ Автозаполнение номера главы
        if (!isEdit) {
            console.log('🔍 Запрашиваем следующий номер для новеллы:', novelId);
            const nextNumResponse = await apiRequest('getNextChapterNumber', { novel_id: novelId });
            console.log('📥 Ответ от сервера:', nextNumResponse);
            
            if (nextNumResponse.success) {
                nextChapterNumber = nextNumResponse.next_number;
                console.log('✅ Следующий номер главы:', nextChapterNumber);
            } else {
                console.warn('⚠️ Не удалось получить следующий номер:', nextNumResponse.error);
            }
        }
        
        // ✨ Автозаполнение тома
        if (!isEdit && novelData.chapters && novelData.chapters.length > 0) {
            console.log('📚 Ищем последний том. Всего глав:', novelData.chapters.length);
            
            // Сортируем главы по номеру и берём последнюю
            const sortedChapters = [...novelData.chapters].sort((a, b) => b.chapter_number - a.chapter_number);
            const lastChapter = sortedChapters[0];
            
            console.log('📖 Последняя глава:', lastChapter);
            
            if (lastChapter.volume_name) {
                lastVolumeName = lastChapter.volume_name;
                console.log('✅ Последний том:', lastVolumeName);
            } else {
                console.log('ℹ️ У последней главы нет тома');
            }
        } else {
            console.log('ℹ️ Нет глав для автозаполнения тома (isEdit:', isEdit, ', глав:', novelData?.chapters?.length || 0, ')');
        }
        
        // Собираем уникальные названия томов для datalist
        existingVolumes = novelData.chapters.map(ch => ch.volume_name).filter(Boolean);
        uniqueVolumes = [...new Set(existingVolumes)];
        volumeShortcutButtons = uniqueVolumes.map(vol => `
            <button type="button" class="chapter-volume-chip" data-volume-name="${escapeHtml(vol)}">
                ${escapeHtml(vol)}
            </button>
        `).join('');
       
    } catch (error) {
        showToast('Ошибка загрузки: ' + error.message, 'error');
        showLoading(false);
        goBackInHistory();
        return;
    }
    
    showLoading(false);

    const useNovelSlug = (novelData.access_type === 'link_only' || novelData.access_type === 'private') && novelData.slug;
    const novelReference = useNovelSlug ? novelData.slug : novelData.novel_id;

    if (isEdit) {
        const canonicalUrl = new URL(window.location.href);
        canonicalUrl.search = '';
        canonicalUrl.searchParams.set('page', 'edit-chapter');
        canonicalUrl.searchParams.set('novel', novelReference);
        canonicalUrl.searchParams.set('chapter', chapterData.chapter_number);
        if (returnTo === 'manage-chapters') {
            canonicalUrl.searchParams.set('returnTo', 'manage-chapters');
        }
        window.history.replaceState(
            {
                page: 'edit-chapter',
                params: {
                    novel: String(novelReference),
                    chapter: String(chapterData.chapter_number),
                    ...(returnTo === 'manage-chapters'
                        ? { returnTo: 'manage-chapters' }
                        : {})
                }
            },
            '',
            canonicalUrl
        );
    }

    const breadcrumbs = getBreadcrumbs(isEdit ? 'edit-chapter' : 'add-chapter', {
        novelId: novelReference,
        novelTitle: novelData.title
    });
    const publishAtValue = chapterData
        ? formatChapterDateTimeLocal(chapterData.publish_at)
        : '';
    const initialRichDocument = parseChapterRichDocument(chapterData?.content_rich);
    const initialPlainContent = chapterData?.content || '';
    const initialEditorHtml = renderChapterEditorContent(initialRichDocument, initialPlainContent);
    const initialRichValue = initialRichDocument ? JSON.stringify(initialRichDocument) : '';

    window.currentChapterEditorReturnTarget = returnTo === 'manage-chapters'
        ? {
            page: 'manage-chapters',
            params: { id: String(novelReference) }
        }
        : {
            page: 'novel-details',
            params: { id: String(novelReference) }
        };

    container.innerHTML = `
        <div class="page-content chapter-form-page">
            <div class="chapter-editor-topbar">
                ${breadcrumbs}
                <div class="chapter-editor-topbar-actions">
                    <button type="button" class="chapter-editor-action-btn"
                            onclick="returnFromChapterEditor()">
                        Отмена
                    </button>
                    <button type="submit" class="chapter-editor-action-btn chapter-editor-action-btn-primary"
                            form="chapter-form">
                        ${isEdit ? 'Сохранить' : 'Создать'}
                    </button>
                </div>
            </div>

            <div class="chapter-draft-banner" id="chapter-draft-banner" hidden>
                <div>
                    <strong>Найден локальный черновик</strong>
                    <span id="chapter-draft-banner-time"></span>
                </div>
                <div class="chapter-draft-banner-actions">
                    <button type="button" class="btn btn-primary btn-sm" id="chapter-draft-restore-btn">Восстановить</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="chapter-draft-discard-btn">Удалить</button>
                </div>
            </div>

            <form id="chapter-form" class="chapter-form">
                <input type="hidden" id="chapter-novel-id" name="novel_id" value="${novelId}">
                ${chapterId ? `<input type="hidden" name="chapter_id" value="${chapterId}">` : ''}

                <section class="chapter-editor-meta-card">
                    <div class="form-row chapter-editor-meta-grid chapter-editor-meta-grid-primary">
                        <div class="form-group">
                            <label for="volume-name">Том</label>
                            <input type="text" id="volume-name" name="volume_name"
                                   class="form-input"
                                   value="${chapterData && chapterData.volume_name ? escapeHtml(chapterData.volume_name) : escapeHtml(lastVolumeName)}"
                                   placeholder="${lastVolumeName ? 'Текущий том: ' + escapeHtml(lastVolumeName) : 'Например: Том 1'}"
                                   autocomplete="off">
                            ${volumeShortcutButtons ? `
                                <div class="chapter-volume-shortcuts" aria-label="Существующие тома">
                                    ${volumeShortcutButtons}
                                </div>
                            ` : '<small class="form-help">У новеллы пока нет созданных томов.</small>'}
                        </div>

                        <div class="form-group">
                            <label for="chapter-number">Номер главы *</label>
                            <input type="number" id="chapter-number" name="chapter_number"
                                   class="form-input" required step="any" min="0"
                                   value="${chapterData ? chapterData.chapter_number : nextChapterNumber}"
                                   placeholder="1">
                            <small class="form-help" id="chapter-number-hint">Можно использовать дробные номера (1.5, 2.1)</small>
                        </div>

                    </div>

                    <div class="form-row chapter-editor-meta-grid chapter-editor-meta-grid-secondary">
                        <div class="form-group chapter-title-group">
                            <label for="chapter-title">Название главы *</label>
                            <input type="text" id="chapter-title" name="chapter_title"
                                   class="form-input chapter-title-input" required
                                   value="${chapterData ? escapeHtml(chapterData.chapter_title) : ''}"
                                   placeholder="Введите название главы"
                                   autocomplete="off">
                        </div>

                        <div class="form-group">
                            <label for="chapter-publish-at">Дата публикации</label>
                            <input type="datetime-local" id="chapter-publish-at" name="publish_at"
                                   class="form-input" value="${publishAtValue}">
                            <small class="form-help">Оставьте пустым, чтобы опубликовать сразу.</small>
                        </div>
                    </div>
                </section>

                <section class="chapter-editor-card" id="chapter-editor-card">
                    <div class="chapter-editor-toolbar-shell">
                      <div class="chapter-editor-toolbar" role="toolbar" aria-label="Инструменты редактора">
                        <div class="chapter-editor-toolbar-group">
                            <label class="visually-hidden" for="chapter-selection-size-select">Размер выделения</label>
                            <select class="editor-tool-select editor-tool-select-size" id="chapter-selection-size-select" title="Размер выделения или нового текста">
                                <option value="">Размер</option>
                                <option value="12">12</option>
                                <option value="14">14</option>
                                <option value="16">16</option>
                                <option value="18">18</option>
                                <option value="20">20</option>
                                <option value="24">24</option>
                                <option value="28">28</option>
                                <option value="32">32</option>
                            </select>
                            <label class="editor-color-tool" title="Цвет выделения или нового текста">
                                <span>A</span>
                                <input type="color" id="chapter-selection-color" value="#7a7a7a" aria-label="Цвет выделения или нового текста">
                            </label>
                            <button type="button" class="editor-tool-btn editor-tool-reset" id="chapter-selection-format-reset" title="Сбросить оформление выделения" aria-label="Сбросить оформление выделения">×</button>
                        </div>
                        <div class="chapter-editor-toolbar-group chapter-editor-formatting-group">
                            <button type="button" class="editor-tool-btn" data-editor-action="bold" title="Жирный (Ctrl+B)" aria-label="Жирный"><strong>Ж</strong></button>
                            <button type="button" class="editor-tool-btn" data-editor-action="italic" title="Курсив (Ctrl+I)" aria-label="Курсив"><em>К</em></button>
                            <button type="button" class="editor-tool-btn" data-editor-action="underline" title="Подчёркнутый (Ctrl+U)" aria-label="Подчёркнутый"><u>Ч</u></button>
                            <button type="button" class="editor-tool-btn" data-editor-action="strike" title="Зачёркнутый" aria-label="Зачёркнутый"><s>З</s></button>
                            <button type="button" class="editor-tool-btn" data-editor-action="quote" title="Цитата" aria-label="Цитата">❝</button>
                            <button type="button" class="editor-tool-btn" data-editor-action="divider" title="Линия-разделитель" aria-label="Линия-разделитель">―</button>
                        </div>
                        <div class="chapter-editor-toolbar-group">
                            <button type="button" class="editor-tool-btn" id="chapter-find-toggle" title="Поиск и замена (Ctrl+F)" aria-label="Поиск и замена">⌕</button>
                            <button type="button" class="editor-tool-btn" id="chapter-preview-toggle" title="Предпросмотр (Ctrl+Shift+P)" aria-label="Предпросмотр">◫</button>
                            <button type="button" class="editor-tool-btn" id="chapter-fullscreen-toggle" title="Полноэкранный режим (Ctrl+Shift+E)" aria-label="Полноэкранный режим">⛶</button>
                        </div>
                      </div>

                      <div class="chapter-find-panel" id="chapter-find-panel" hidden>
                        <div class="chapter-find-row">
                            <button type="button" class="chapter-find-icon-btn chapter-replace-toggle" id="chapter-replace-toggle" aria-label="Показать замену" aria-expanded="false">›</button>
                            <input type="text" class="chapter-find-input" id="chapter-find-input" placeholder="Найти">
                            <span class="chapter-find-count" id="chapter-find-count">0/0</span>
                            <button type="button" class="chapter-find-icon-btn" id="chapter-find-prev-btn" title="Предыдущее совпадение" aria-label="Предыдущее совпадение">↑</button>
                            <button type="button" class="chapter-find-icon-btn" id="chapter-find-next-btn" title="Следующее совпадение" aria-label="Следующее совпадение">↓</button>
                            <button type="button" class="chapter-find-icon-btn" id="chapter-find-close-btn" title="Закрыть" aria-label="Закрыть поиск">×</button>
                        </div>
                        <div class="chapter-replace-row" id="chapter-replace-row" hidden>
                            <input type="text" class="chapter-find-input" id="chapter-replace-input" placeholder="Заменить на">
                            <button type="button" class="chapter-find-icon-btn" id="chapter-replace-btn" title="Заменить текущее" aria-label="Заменить текущее">↔</button>
                            <button type="button" class="chapter-find-icon-btn" id="chapter-replace-all-btn" title="Заменить всё" aria-label="Заменить всё">≋</button>
                        </div>
                      </div>
                    </div>

                    <div class="chapter-editor-workspace" id="chapter-editor-workspace">
                        <div class="chapter-editor-input-pane">
                            <label class="visually-hidden" for="chapter-content-editor">Содержание главы</label>
                             <div id="chapter-content-editor" class="chapter-editor-surface" contenteditable="true"
                                  role="textbox" aria-multiline="true" spellcheck="true"
                                  data-placeholder="Начните писать или вставьте готовый текст главы...">${initialEditorHtml}</div>
                            <textarea id="chapter-content" name="content" hidden>${escapeHtml(initialPlainContent)}</textarea>
                            <textarea id="chapter-content-rich" name="content_rich" hidden>${escapeHtml(initialRichValue)}</textarea>
                        </div>
                        <article class="chapter-editor-preview" id="chapter-editor-preview" hidden>
                            <div class="chapter-editor-preview-empty">Предпросмотр появится здесь.</div>
                        </article>
                    </div>

                    <div class="chapter-editor-statusbar">
                        <div class="chapter-editor-stats" aria-live="polite">
                            <span><strong id="chapter-stat-words">0</strong> слов</span>
                            <span><strong id="chapter-stat-chars">0</strong> знаков</span>
                            <span><strong id="chapter-stat-paragraphs">0</strong> абзацев</span>
                            <span>≈ <strong id="chapter-stat-reading">0</strong> мин чтения</span>
                        </div>
                        <span class="chapter-draft-status" id="chapter-draft-status">Черновик ещё не сохранён</span>
                    </div>
                </section>
            </form>
        </div>
    `;
    
    setupChapterForm(novelId, chapterId);
}

function setupChapterForm(novelId, chapterId) {
    const form = document.getElementById('chapter-form');
    if (form) {
        form.addEventListener('submit', handleChapterSubmit);
    }
    
    // Проверка номера главы на дубликаты
    const numberInput = document.getElementById('chapter-number');
    const hint = document.getElementById('chapter-number-hint'); // Получаем элемент подсказки один раз

    let checkAttempt = 0; // Счетчик попыток проверки

    if (numberInput && hint) {
        numberInput.addEventListener('input', function() {
            clearTimeout(chapterNumberCheckTimeout);
            const number = this.value.trim();

            // ✅ Очищаем подсказку, если поле пустое
            if (!number) {
                hint.textContent = 'Можно использовать дробные номера (1.5, 2.1)';
                hint.style.color = ''; // Возвращаем стандартный цвет
                numberInput.style.borderColor = ''; // Возвращаем стандартную рамку
                lastCheckedNumber = null; // Сбрасываем последнее проверенное
                checkAttempt++;
                return;
            }

            const currentAttempt = ++checkAttempt; // Увеличиваем счетчик для этой попытки
            
            // Уменьшаем задержку до 500мс
            chapterNumberCheckTimeout = setTimeout(async () => {
                if (currentAttempt !== checkAttempt) {
                    console.log('Проверка номера отменена (устарела)');
                    return;
                }

                // ✅ Проверяем снова на всякий случай, если пользователь быстро стёр
                const currentNumber = numberInput.value.trim();
                if (!currentNumber) {
                     hint.textContent = 'Можно использовать дробные номера (1.5, 2.1)';
                     hint.style.color = '';
                     numberInput.style.borderColor = '';
                     lastCheckedNumber = null;
                     return;
                }
                if (currentNumber === lastCheckedNumber) return; // Не проверяем то же самое число повторно

                lastCheckedNumber = currentNumber; // Запоминаем число, которое проверяем
                hint.textContent = 'Проверка...';
                hint.style.color = '';
                numberInput.style.borderColor = '';

                try { // ✅ Добавляем try...catch
                  const exists = await checkChapterNumberExists(novelId, currentNumber, chapterId);

                  // Снова проверяем актуальность попытки ПОСЛЕ await
                  if (currentAttempt !== checkAttempt) {
                     console.log('Результат проверки номера отменен (устарел)');
                     return;
                  }
                  
                  // Проверяем, не изменилось ли значение, пока ждали ответа
                  if (numberInput.value.trim() !== currentNumber) return;

                  if (exists) {
                      hint.textContent = '⚠️ Глава с таким номером уже существует!';
                      hint.style.color = '#d32f2f'; // Красный
                      numberInput.style.borderColor = '#d32f2f';
                  } else {
                      hint.textContent = '✓ Номер доступен';
                      hint.style.color = '#4CAF50'; // Зеленый
                      numberInput.style.borderColor = '#4CAF50';
                  }
                } catch (error) {
                    // Проверяем актуальность перед показом ошибки
                    if (currentAttempt !== checkAttempt) return;
                    if (numberInput.value.trim() !== currentNumber) return;
                    console.error("Ошибка проверки номера главы:", error);
                    hint.textContent = 'Ошибка проверки';
                    hint.style.color = '#d32f2f';
                    numberInput.style.borderColor = '#d32f2f';
                }

            }, 500); // Задержка 500 мс
        });
    }

    setupChapterEditor(novelId, chapterId);
}

function getChapterDraftKey(novelId, chapterId) {
    return `chapter-draft-${novelId}-${chapterId || 'new'}`;
}

function syncChapterEditorFields() {
    const richField = document.getElementById('chapter-content-rich');
    const plainField = document.getElementById('chapter-content');
    const richDocument = serializeChapterEditorContent();
    if (!richDocument) {
        return {
            content: plainField?.value || '',
            content_rich: richField?.value || ''
        };
    }

    const contentRich = JSON.stringify(richDocument);
    const content = chapterRichDocumentToPlainText(richDocument);
    if (richField) richField.value = contentRich;
    if (plainField) plainField.value = content;
    return { content, content_rich: contentRich };
}

function getChapterEditorState() {
    const contentState = syncChapterEditorFields();
    return {
        volume_name: document.getElementById('volume-name')?.value || '',
        chapter_number: document.getElementById('chapter-number')?.value || '',
        chapter_title: document.getElementById('chapter-title')?.value || '',
        publish_at: document.getElementById('chapter-publish-at')?.value || '',
        content: contentState.content,
        content_rich: contentState.content_rich
    };
}

function applyChapterEditorState(state) {
    if (!state) return;

    const fields = {
        'volume-name': state.volume_name,
        'chapter-number': state.chapter_number,
        'chapter-title': state.chapter_title,
        'chapter-publish-at': state.publish_at
    };

    Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element && value !== undefined && value !== null) {
            element.value = value;
        }
    });

    const editor = document.getElementById('chapter-content-editor');
    const richDocument = parseChapterRichDocument(state.content_rich);
    if (editor) {
        editor.innerHTML = renderChapterEditorContent(richDocument, state.content || '');
    }
    syncChapterEditorFields();
}

function clearChapterEditorDraft(novelId, chapterId) {
    try {
        localStorage.removeItem(getChapterDraftKey(novelId, chapterId));
    } catch (error) {
        console.warn('Не удалось удалить локальный черновик:', error);
    }
}

function setupChapterEditor(novelId, chapterId) {
    if (typeof STATE.chapterEditorCleanup === 'function') STATE.chapterEditorCleanup();

    const form = document.getElementById('chapter-form');
    const editor = document.getElementById('chapter-content-editor');
    const editorCard = document.getElementById('chapter-editor-card');
    const preview = document.getElementById('chapter-editor-preview');
    const findPanel = document.getElementById('chapter-find-panel');
    const findInput = document.getElementById('chapter-find-input');
    const replaceInput = document.getElementById('chapter-replace-input');
    const replaceRow = document.getElementById('chapter-replace-row');
    const draftStatus = document.getElementById('chapter-draft-status');
    const draftBanner = document.getElementById('chapter-draft-banner');
    const selectionSizeSelect = document.getElementById('chapter-selection-size-select');
    const selectionColorInput = document.getElementById('chapter-selection-color');
    const draftKey = getChapterDraftKey(novelId, chapterId);

    if (!form || !editor || !editorCard || !preview) return;

    let autosaveTimeout = null;
    let previewVisible = false;
    let fullscreen = false;
    let pendingDraft = null;
    let searchRanges = [];
    let currentSearchIndex = -1;
    let savedEditorRange = null;
    let historyTimeout = null;
    let historyEntries = [];
    let historyIndex = -1;
    let applyingHistory = false;
    let lastDraftSnapshot = JSON.stringify(getChapterEditorState());

    const setDraftStatus = (message, state = '') => {
        if (!draftStatus) return;
        draftStatus.textContent = message;
        draftStatus.dataset.state = state;
    };

    const dispatchEditorInput = () => {
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatChange' }));
    };

    const updateStats = () => {
        const state = syncChapterEditorFields();
        const text = state.content || '';
        const richDocument = parseChapterRichDocument(state.content_rich);
        const words = text.trim()
            ? text.trim().split(/\s+/).filter(word => /[A-Za-zА-Яа-яЁё0-9\u3400-\u9FFF]/.test(word)).length
            : 0;
        const paragraphs = richDocument?.blocks.filter(block =>
            block.type !== 'divider' && (block.runs || []).some(run => (run.text || '').trim())
        ).length || 0;
        const readingMinutes = words > 0 ? Math.max(1, Math.ceil(words / 200)) : 0;

        const values = {
            'chapter-stat-words': formatNumber(words),
            'chapter-stat-chars': formatNumber(text.length),
            'chapter-stat-paragraphs': formatNumber(paragraphs),
            'chapter-stat-reading': readingMinutes
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
    };

    const updatePreview = () => {
        const state = syncChapterEditorFields();
        const title = document.getElementById('chapter-title')?.value.trim() || 'Без названия';
        const number = document.getElementById('chapter-number')?.value.trim();
        const volume = document.getElementById('volume-name')?.value.trim();
        const heading = number ? `Глава ${escapeHtml(number)}: ${escapeHtml(title)}` : escapeHtml(title);

        preview.innerHTML = `
            ${volume ? `<div class="chapter-editor-preview-volume">${escapeHtml(volume)}</div>` : ''}
            <h2>${heading}</h2>
            <div class="chapter-editor-preview-text">
                ${state.content.trim()
                    ? renderChapterRichContent(state.content_rich, state.content)
                    : '<p class="text-muted">Текст главы пока пуст.</p>'}
            </div>
        `;
    };

    const saveDraft = (showMessage = false) => {
        try {
            const data = getChapterEditorState();
            const savedAt = new Date().toISOString();
            localStorage.setItem(draftKey, JSON.stringify({ savedAt, data }));
            lastDraftSnapshot = JSON.stringify(data);
            setDraftStatus(`Черновик сохранён в ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'saved');
            if (showMessage) showToast('Черновик сохранён на этом устройстве', 'success');
        } catch (error) {
            console.warn('Не удалось сохранить локальный черновик:', error);
            setDraftStatus('Не удалось сохранить черновик', 'error');
        }
    };

    const scheduleAutosave = () => {
        clearTimeout(autosaveTimeout);
        const snapshot = JSON.stringify(getChapterEditorState());
        if (snapshot !== lastDraftSnapshot) setDraftStatus('Есть несохранённые изменения…', 'dirty');
        autosaveTimeout = setTimeout(() => saveDraft(false), 900);
    };

    const pushEditorHistory = () => {
        clearTimeout(historyTimeout);
        const html = editor.innerHTML;
        if (historyEntries[historyIndex] === html) return;
        historyEntries = historyEntries.slice(0, historyIndex + 1);
        historyEntries.push(html);
        if (historyEntries.length > 100) historyEntries.shift();
        historyIndex = historyEntries.length - 1;
    };

    const scheduleEditorHistory = () => {
        clearTimeout(historyTimeout);
        historyTimeout = setTimeout(pushEditorHistory, 450);
    };

    const resetEditorHistory = () => {
        clearTimeout(historyTimeout);
        historyEntries = [editor.innerHTML];
        historyIndex = 0;
    };

    const applyEditorHistory = html => {
        applyingHistory = true;
        editor.innerHTML = html;
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        applyingHistory = false;
        updateStats();
        if (previewVisible) updatePreview();
        if (findPanel && !findPanel.hidden && findInput?.value) updateSearch(false);
        scheduleAutosave();
        updateToolbarState();
    };

    const undoEditor = () => {
        clearTimeout(historyTimeout);
        if (historyEntries[historyIndex] !== editor.innerHTML) pushEditorHistory();
        if (historyIndex <= 0) return;
        historyIndex -= 1;
        applyEditorHistory(historyEntries[historyIndex]);
    };

    const redoEditor = () => {
        clearTimeout(historyTimeout);
        if (historyEntries[historyIndex] !== editor.innerHTML) {
            pushEditorHistory();
            return;
        }
        if (historyIndex >= historyEntries.length - 1) return;
        historyIndex += 1;
        applyEditorHistory(historyEntries[historyIndex]);
    };

    const togglePreview = (force) => {
        previewVisible = typeof force === 'boolean' ? force : !previewVisible;
        editorCard.classList.toggle('is-previewing', previewVisible);
        preview.hidden = !previewVisible;
        updatePreview();
        const button = document.getElementById('chapter-preview-toggle');
        if (button) {
            button.setAttribute('aria-pressed', String(previewVisible));
            button.title = previewVisible ? 'Вернуться к редактору (Ctrl+Shift+P)' : 'Предпросмотр (Ctrl+Shift+P)';
        }
    };

    const toggleFullscreen = (force) => {
        fullscreen = typeof force === 'boolean' ? force : !fullscreen;
        editorCard.classList.toggle('is-fullscreen', fullscreen);
        document.body.classList.toggle('chapter-editor-fullscreen-open', fullscreen);
        document.getElementById('chapter-fullscreen-toggle')?.setAttribute('aria-pressed', String(fullscreen));
        if (fullscreen) editor.focus();
    };

    const selectionBelongsToEditor = () => {
        const selection = window.getSelection();
        return !!selection?.rangeCount && editor.contains(selection.anchorNode);
    };

    const restoreEditorRange = () => {
        if (!savedEditorRange) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedEditorRange.cloneRange());
    };

    const normalizeEditorFontTags = (forcedSize = null, forcedColor = '') => {
        editor.querySelectorAll('font').forEach(font => {
            const span = document.createElement('span');
            const sizeMap = { 1: 10, 2: 12, 3: 16, 4: 18, 5: 24, 6: 32, 7: 40 };
            const size = forcedSize || sizeMap[font.getAttribute('size')] || null;
            const color = normalizeChapterRichColor(forcedColor || font.getAttribute('color'));
            if (size) span.style.fontSize = `${normalizeChapterRichSize(size, 18)}px`;
            if (color) span.style.color = color;
            while (font.firstChild) span.appendChild(font.firstChild);
            font.replaceWith(span);
        });
    };

    const runCommand = (command, value = null) => {
        editor.focus();
        restoreEditorRange();
        document.execCommand(command, false, value);
        normalizeEditorFontTags();
        dispatchEditorInput();
        updateToolbarState();
    };

    const toggleQuote = () => {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection?.anchorNode?.parentElement;
        const quote = anchor?.closest?.('blockquote');
        runCommand('formatBlock', quote && editor.contains(quote) ? 'p' : 'blockquote');
    };

    const applyEditorAction = action => {
        const commands = {
            bold: 'bold',
            italic: 'italic',
            underline: 'underline',
            strike: 'strikeThrough'
        };
        if (commands[action]) runCommand(commands[action]);
        else if (action === 'quote') toggleQuote();
        else if (action === 'divider') runCommand('insertHorizontalRule');
    };

    const applySelectionSize = size => {
        if (!size) return;
        restoreEditorRange();
        const selection = window.getSelection();
        const collapsed = !selection?.rangeCount || selection.isCollapsed;
        editor.dataset.pendingFontSize = String(size);
        editor.focus();
        document.execCommand('fontSize', false, '7');
        if (!collapsed) {
            normalizeEditorFontTags(size);
            delete editor.dataset.pendingFontSize;
            dispatchEditorInput();
        }
    };

    const applySelectionColor = color => {
        const normalized = normalizeChapterRichColor(color);
        if (!normalized) return;
        restoreEditorRange();
        const selection = window.getSelection();
        const collapsed = !selection?.rangeCount || selection.isCollapsed;
        editor.dataset.pendingFontColor = normalized;
        editor.focus();
        document.execCommand('foreColor', false, normalized);
        if (!collapsed) {
            normalizeEditorFontTags(null, normalized);
            delete editor.dataset.pendingFontColor;
            dispatchEditorInput();
        }
    };

    const resetSelectionFormatting = () => {
        editor.focus();
        restoreEditorRange();
        document.execCommand('removeFormat', false, null);
        delete editor.dataset.pendingFontSize;
        delete editor.dataset.pendingFontColor;
        if (selectionSizeSelect) selectionSizeSelect.value = '';
        dispatchEditorInput();
        updateToolbarState();
    };

    const updateToolbarState = () => {
        const states = {
            bold: document.queryCommandState('bold'),
            italic: document.queryCommandState('italic'),
            underline: document.queryCommandState('underline'),
            strike: document.queryCommandState('strikeThrough')
        };
        Object.entries(states).forEach(([action, active]) => {
            document.querySelector(`[data-editor-action="${action}"]`)?.setAttribute('aria-pressed', String(active));
        });
        const selection = window.getSelection();
        const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection?.anchorNode?.parentElement;
        const inQuote = !!anchor?.closest?.('blockquote') && editor.contains(anchor);
        document.querySelector('[data-editor-action="quote"]')?.setAttribute('aria-pressed', String(inQuote));
    };

    const clearSearchHighlights = () => {
        if (CSS?.highlights) {
            CSS.highlights.delete('chapter-search');
            CSS.highlights.delete('chapter-search-current');
        }
    };

    const buildSearchRanges = query => {
        if (!query) return [];
        const ranges = [];
        const needle = query.toLocaleLowerCase();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const haystack = (node.nodeValue || '').toLocaleLowerCase();
            let from = 0;
            while (from <= haystack.length - needle.length) {
                const index = haystack.indexOf(needle, from);
                if (index === -1) break;
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + needle.length);
                ranges.push(range);
                from = index + Math.max(1, needle.length);
            }
        }
        return ranges;
    };

    const showCurrentSearchResult = (scroll = true) => {
        const count = document.getElementById('chapter-find-count');
        if (searchRanges.length === 0) {
            currentSearchIndex = -1;
            if (count) count.textContent = '0/0';
            clearSearchHighlights();
            return;
        }

        currentSearchIndex = (currentSearchIndex + searchRanges.length) % searchRanges.length;
        if (count) count.textContent = `${currentSearchIndex + 1}/${searchRanges.length}`;
        if (CSS?.highlights && typeof Highlight !== 'undefined') {
            CSS.highlights.set('chapter-search', new Highlight(...searchRanges));
            CSS.highlights.set('chapter-search-current', new Highlight(searchRanges[currentSearchIndex]));
        }
        if (scroll) {
            const range = searchRanges[currentSearchIndex];
            const target = range.startContainer.parentElement || editor;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const updateSearch = (keepIndex = false) => {
        const previousIndex = currentSearchIndex;
        searchRanges = buildSearchRanges(findInput?.value || '');
        currentSearchIndex = keepIndex ? Math.min(previousIndex, searchRanges.length - 1) : (searchRanges.length ? 0 : -1);
        showCurrentSearchResult(false);
    };

    const moveSearch = direction => {
        if (!searchRanges.length) return;
        currentSearchIndex += direction;
        showCurrentSearchResult(true);
    };

    const replaceRange = (range, replacement) => {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertText', false, replacement);
    };

    const replaceCurrent = () => {
        if (!searchRanges.length || currentSearchIndex < 0) return;
        replaceRange(searchRanges[currentSearchIndex], replaceInput?.value || '');
        editor.normalize();
        dispatchEditorInput();
        updateSearch(true);
        showCurrentSearchResult(true);
    };

    const replaceAll = () => {
        const replacement = replaceInput?.value || '';
        [...searchRanges].reverse().forEach(range => replaceRange(range, replacement));
        editor.normalize();
        dispatchEditorInput();
        updateSearch(false);
    };

    const toggleReplaceRow = () => {
        if (!replaceRow) return;
        const expanded = replaceRow.hidden;
        replaceRow.hidden = !expanded;
        const toggle = document.getElementById('chapter-replace-toggle');
        toggle?.setAttribute('aria-expanded', String(expanded));
        if (toggle) {
            toggle.textContent = expanded ? '⌄' : '›';
            toggle.setAttribute('aria-label', expanded ? 'Скрыть замену' : 'Показать замену');
        }
        if (expanded) replaceInput?.focus();
    };

    const toggleFindPanel = force => {
        if (!findPanel) return;
        const shouldOpen = typeof force === 'boolean' ? force : findPanel.hidden;
        findPanel.hidden = !shouldOpen;
        if (shouldOpen) {
            findInput?.focus();
            updateSearch(false);
        } else {
            clearSearchHighlights();
        }
    };

    const handleEditorInput = () => {
        const pendingSize = editor.dataset.pendingFontSize || null;
        const pendingColor = editor.dataset.pendingFontColor || '';
        if (pendingSize || pendingColor) {
            normalizeEditorFontTags(pendingSize, pendingColor);
            delete editor.dataset.pendingFontSize;
            delete editor.dataset.pendingFontColor;
        } else {
            normalizeEditorFontTags();
        }
        updateStats();
        if (previewVisible) updatePreview();
        if (findPanel && !findPanel.hidden && findInput?.value) updateSearch(true);
        scheduleAutosave();
        if (!applyingHistory) scheduleEditorHistory();
        updateToolbarState();
    };

    form.addEventListener('input', event => {
        if (event.target === editor || editor.contains(event.target)) handleEditorInput();
        else {
            updateStats();
            if (previewVisible) updatePreview();
            scheduleAutosave();
        }
    });

    document.querySelectorAll('[data-editor-action]').forEach(button => {
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => applyEditorAction(button.dataset.editorAction));
    });

    document.querySelectorAll('.chapter-volume-chip').forEach(button => {
        button.addEventListener('click', () => {
            const volumeInput = document.getElementById('volume-name');
            if (!volumeInput) return;
            volumeInput.value = button.dataset.volumeName || '';
            volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    selectionSizeSelect?.addEventListener('change', () => applySelectionSize(selectionSizeSelect.value));
    selectionColorInput?.addEventListener('input', () => applySelectionColor(selectionColorInput.value));
    document.getElementById('chapter-selection-format-reset')?.addEventListener('mousedown', event => event.preventDefault());
    document.getElementById('chapter-selection-format-reset')?.addEventListener('click', resetSelectionFormatting);

    document.getElementById('chapter-preview-toggle')?.addEventListener('click', () => togglePreview());
    document.getElementById('chapter-fullscreen-toggle')?.addEventListener('click', () => toggleFullscreen());
    document.getElementById('chapter-find-toggle')?.addEventListener('click', () => toggleFindPanel());
    document.getElementById('chapter-replace-toggle')?.addEventListener('click', toggleReplaceRow);
    document.getElementById('chapter-find-prev-btn')?.addEventListener('click', () => moveSearch(-1));
    document.getElementById('chapter-find-next-btn')?.addEventListener('click', () => moveSearch(1));
    document.getElementById('chapter-find-close-btn')?.addEventListener('click', () => toggleFindPanel(false));
    document.getElementById('chapter-replace-btn')?.addEventListener('click', replaceCurrent);
    document.getElementById('chapter-replace-all-btn')?.addEventListener('click', replaceAll);
    findInput?.addEventListener('input', () => updateSearch(false));
    findInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            moveSearch(event.shiftKey ? -1 : 1);
        }
    });

    document.getElementById('chapter-draft-restore-btn')?.addEventListener('click', () => {
        if (!pendingDraft) return;
        applyChapterEditorState(pendingDraft.data);
        lastDraftSnapshot = JSON.stringify(pendingDraft.data);
        if (draftBanner) draftBanner.hidden = true;
        updateStats();
        updatePreview();
        setDraftStatus('Локальный черновик восстановлен', 'saved');
        showToast('Черновик восстановлен', 'success');
    });

    document.getElementById('chapter-draft-discard-btn')?.addEventListener('click', () => {
        clearChapterEditorDraft(novelId, chapterId);
        pendingDraft = null;
        if (draftBanner) draftBanner.hidden = true;
        setDraftStatus('Локальный черновик удалён');
    });

    const keyboardHandler = event => {
        const modifier = event.ctrlKey || event.metaKey;
        const key = String(event.key || '').toLocaleLowerCase();
        const editorFocused = document.activeElement === editor || selectionBelongsToEditor();

        if (editorFocused && modifier && !event.shiftKey && key === 'z') {
            event.preventDefault();
            undoEditor();
        } else if (editorFocused && modifier && (key === 'y' || (event.shiftKey && key === 'z'))) {
            event.preventDefault();
            redoEditor();
        } else if (editorFocused && modifier && !event.shiftKey && ['b', 'i', 'u'].includes(key)) {
            event.preventDefault();
            applyEditorAction({ b: 'bold', i: 'italic', u: 'underline' }[key]);
        } else if (editorFocused && modifier && !event.shiftKey && key === 'f') {
            event.preventDefault();
            toggleFindPanel(true);
        } else if (modifier && !event.shiftKey && key === 's') {
            event.preventDefault();
            saveDraft(true);
        } else if (modifier && event.shiftKey && key === 'f') {
            event.preventDefault();
            toggleFindPanel();
        } else if (modifier && event.shiftKey && key === 'p') {
            event.preventDefault();
            togglePreview();
        } else if (modifier && event.shiftKey && key === 'e') {
            event.preventDefault();
            toggleFullscreen();
        } else if (event.key === 'Escape') {
            if (fullscreen) toggleFullscreen(false);
            else if (findPanel && !findPanel.hidden) toggleFindPanel(false);
        }
    };

    const selectionChangeHandler = () => {
        if (selectionBelongsToEditor()) {
            savedEditorRange = window.getSelection().getRangeAt(0).cloneRange();
            updateToolbarState();
        }
    };
    document.addEventListener('keydown', keyboardHandler);
    document.addEventListener('selectionchange', selectionChangeHandler);

    try {
        const storedDraft = localStorage.getItem(draftKey);
        if (storedDraft) {
            pendingDraft = JSON.parse(storedDraft);
            const currentState = JSON.stringify(getChapterEditorState());
            const storedState = JSON.stringify(pendingDraft.data || {});
            if (pendingDraft.data && currentState !== storedState) {
                if (draftBanner) draftBanner.hidden = false;
                const bannerTime = document.getElementById('chapter-draft-banner-time');
                if (bannerTime && pendingDraft.savedAt) {
                    bannerTime.textContent = `Сохранён ${new Date(pendingDraft.savedAt).toLocaleString()}`;
                }
            } else {
                setDraftStatus('Локальный черновик совпадает с текстом', 'saved');
            }
        }
    } catch (error) {
        console.warn('Не удалось прочитать локальный черновик:', error);
    }

    updateStats();
    updatePreview();
    resetEditorHistory();

    STATE.chapterEditorCleanup = () => {
        clearTimeout(autosaveTimeout);
        clearTimeout(historyTimeout);
        clearSearchHighlights();
        document.removeEventListener('keydown', keyboardHandler);
        document.removeEventListener('selectionchange', selectionChangeHandler);
        document.body.classList.remove('chapter-editor-fullscreen-open');
        STATE.chapterEditorCleanup = null;
    };
}

async function handleChapterSubmit(e) {
    e.preventDefault();

    const form = e.target;
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    const submitButton = document.querySelector(`button[type="submit"][form="${form.id}"]`);
    if (submitButton) submitButton.disabled = true;

    showLoading(true, {
        title: 'Сохранение главы',
        description: 'Создание документа в Google Drive...'
    });

    syncChapterEditorFields();
    const formData = new FormData(form);
    const chapterData = {};
    
    formData.forEach((value, key) => {
        if (value || key === 'publish_at' || key === 'volume_name') chapterData[key] = value;
    });
    
    // Нормализуем номер главы
    chapterData.chapter_number = normalizeChapterNumber(chapterData.chapter_number);
    if (chapterData.publish_at) {
        const localPublishDate = new Date(chapterData.publish_at);
        if (!Number.isNaN(localPublishDate.getTime())) {
            chapterData.publish_at = localPublishDate.toISOString();
        }
    }
    
    try {
        const action = chapterData.chapter_id ? 'updateChapter' : 'addChapter';
        const response = await apiPostRequest(action, chapterData);
        
        if (response.success) {
            clearChapterEditorDraft(chapterData.novel_id, chapterData.chapter_id);
            showToast('Глава сохранена!', 'success');
            clearCache();
            
            setTimeout(() => {
                returnFromChapterEditor();
            }, 1000);
        } else {
            throw new Error(response.error || 'Не удалось сохранить');
        }
    } catch (error) {
        console.error('Ошибка сохранения главы:', error);
        showToast('❌ Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
        delete form.dataset.submitting;
        if (submitButton) submitButton.disabled = false;
    }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ФОРМЫ ГЛАВЫ
// ==========================================

function normalizeChapterNumber(number) {
    const num = parseFloat(number);
    return isNaN(num) ? 0 : num;
}

async function checkChapterNumberExists(novelId, chapterNumber, excludeId = null) {
    try {
        // Вызываем специальное действие 'checkChapterNumber' на сервере
        const response = await apiRequest('checkChapterNumber', {
            novel_id: novelId,
            chapter_number: chapterNumber,
            exclude_chapter_id: excludeId
        }, true); // true - чтобы пропустить кэш и получить свежие данные

        // Сервер напрямую возвращает true или false в поле 'exists'
        if (response.success) {
            return response.exists;
        }
        return false; // В случае ошибки считаем, что дубликата нет

    } catch (error) {
        console.error('Ошибка проверки номера главы:', error);
        return false; // Безопасное значение по умолчанию
    }
}

// ==========================================
// УДАЛЕНИЕ ГЛАВ
// ==========================================

function handleDeleteChapter(chapterId, chapterTitle) {
    // ✨ ИЗМЕНЕНИЕ: Добавляем название в сообщение
    const title = chapterTitle ? ` "${chapterTitle}"` : '';
    showConfirmModal(
        '🗑️ Удаление главы',
        `Вы уверены, что хотите удалить главу${title}?\nОна будет перемещена в корзину.`,
        () => deleteChapter(chapterId) // Вызываем асинхронный хелпер
    );
}

async function deleteChapter(chapterId) {
    showLoading(true, { title: 'Удаление главы' });
    
    try {
        const response = await apiPostRequest('deleteChapter', { 
            chapterId: chapterId, 
            permanent: false 
        });
        
        if (response.success) {
            showToast('Глава перемещена в корзину', 'success');
            clearCache();
            location.reload(); // Перезагружаем страницу
        } else {
            throw new Error(response.error || 'Ошибка удаления');
        }
    } catch (error) {
        showToast('Не удалось удалить: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ==========================================
// ДАТЫ И ПОДСКАЗКИ ОГЛАВЛЕНИЯ
// ==========================================

function formatDateTooltip(dateString) {
     if (!dateString) return 'Неизвестно';
    try {
        const date = new Date(dateString);
        // Формат: ДД Месяца ГГГГ, ЧЧ:ММ:СС
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }) + ', ' + date.toLocaleTimeString('ru-RU');
    } catch (e) {
        return dateString;
    }
}

function formatDateOnly(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (e) {
        return dateString; // Возвращаем как есть при ошибке
    }
}

function initializeTooltips() {
    // Удаляем старый tooltip, если он есть
    if (tooltipElement) {
        tooltipElement.remove();
        tooltipElement = null;
    }

    // Создаем элемент tooltip один раз
    tooltipElement = document.createElement('div');
    tooltipElement.id = 'dynamic-tooltip';
    tooltipElement.className = 'tooltip-v2';
    document.body.appendChild(tooltipElement);

    const elementsWithTooltip = document.querySelectorAll('[data-tooltip]');

    elementsWithTooltip.forEach(elem => {
        elem.addEventListener('mouseenter', showTooltip);
        elem.addEventListener('mouseleave', hideTooltip);
        elem.addEventListener('mousemove', moveTooltip);
    });
}

function showTooltip(event) {
    const text = event.target.getAttribute('data-tooltip');
    if (!tooltipElement || !text) return;
    tooltipElement.textContent = text;
    tooltipElement.style.display = 'block';
    moveTooltip(event); // Позиционируем сразу
}

function hideTooltip() {
    if (!tooltipElement) return;
    tooltipElement.style.display = 'none';
}

function moveTooltip(event) {
    if (!tooltipElement || tooltipElement.style.display === 'none') return;

    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;
    const cursorPadding = 15; // Отступ от курсора

    let left = event.pageX + cursorPadding;
    let top = event.pageY + cursorPadding;

    // Проверка выхода за правый край
    if (left + tooltipWidth > window.innerWidth) {
        left = event.pageX - tooltipWidth - cursorPadding; // Смещаем влево от курсора
    }

    // Проверка выхода за нижний край
    if (top + tooltipHeight > window.innerHeight) {
        top = event.pageY - tooltipHeight - cursorPadding; // Смещаем вверх от курсора
    }

    // Минимальные значения, чтобы не уходило за левый/верхний край
    left = Math.max(5, left); // Минимум 5px от левого края
    top = Math.max(5, top);   // Минимум 5px от верхнего края

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
}
