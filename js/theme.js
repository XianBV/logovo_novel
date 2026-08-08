/* ==========================================
   ЛОГОВО НОВЕЛЛ — ТЕМЫ
   
   ========================================== */

let currentThemePalette = localStorage.getItem('novel-library-theme') || 'classic';
let currentThemeMode = localStorage.getItem('novel-library-mode') || 'light';

function toggleThemeMode() {
    const newMode = currentThemeMode === 'light' ? 'dark' : 'light';
    applyTheme(currentThemePalette, newMode);
}

/**
 * Применяет выбранную палитру и режим
 * @param {string} palette - Название палитры (classic, sunset, etc.)
 * @param {string} mode - Режим (light или dark)
 */
function applyTheme(palette, mode) {
    const html = document.documentElement;
    html.setAttribute('data-theme', palette);
    html.setAttribute('data-mode', mode);

    // Обновляем иконку на кнопке
    const icon = document.querySelector('.theme-icon');
    if (icon) {
        icon.textContent = mode === 'dark' ? '☀️' : '🌙';
    }

    // ✨ НОВОЕ: Обновляем кнопку в панели настроек чтения (если она открыта) ✨
    const readerThemeBtn = document.getElementById('reader-theme-toggle-btn');
    if (readerThemeBtn) {
        readerThemeBtn.textContent = mode === 'dark' ? 'Тема: Светлая ☀️' : 'Тема: Тёмная 🌙';
    }
    // ✨ КОНЕЦ ✨

    // Сохраняем выбор
    localStorage.setItem('novel-library-theme', palette);
    localStorage.setItem('novel-library-mode', mode);

    // Обновляем глобальные переменные
    currentThemePalette = palette;
    currentThemeMode = mode;
}

/**
 * Устанавливает новую палитру, сохраняя текущий режим
 * @param {string} newPalette - Название новой палитры
 */
function setThemePalette(newPalette) {
    applyTheme(newPalette, currentThemeMode);
}

function applyAutoTheme() {
    const hour = new Date().getHours();
    // С 7 утра до 7 вечера - светлая, иначе - тёмная
    if (hour > 7 && hour < 19) {
        applyTheme('light');
    } else {
        applyTheme('dark');
    }
}

// ✨ Добавляем новые обработчики событий
// Эту функцию нужно вызвать один раз внутри setupEventListeners()
function setupThemeSwitcher() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeMenu = document.getElementById('theme-menu');
    if (!themeToggleBtn || !themeMenu) return;

    let longPressTimer;

    // ОБЫЧНЫЙ КЛИК: переключение light/dark
    themeToggleBtn.addEventListener('click', toggleThemeMode);

    // ПРАВЫЙ КЛИК (для ПК): открывает меню палитр
    themeToggleBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Отменяем стандартное меню браузера
        themeMenu.classList.toggle('hidden');
    });

    // ДОЛГОЕ НАЖАТИЕ (для телефонов): открывает меню палитр
    themeToggleBtn.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
            e.preventDefault();
            themeMenu.classList.toggle('hidden');
        }, 500); // 500 мс = 0.5 секунды
    });

    themeToggleBtn.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
    });

    // Закрываем меню, если кликнуть куда-то еще
    document.addEventListener('click', (e) => {
        if (!themeToggleBtn.contains(e.target) && !themeMenu.contains(e.target)) {
            themeMenu.classList.add('hidden');
        }
    });

    // Обработчики для кнопок внутри меню палитр
    document.querySelectorAll('.theme-option').forEach(button => {
        button.addEventListener('click', () => {
            const newPalette = button.dataset.theme;
            setThemePalette(newPalette);
            themeMenu.classList.add('hidden'); // Закрываем меню после выбора
        });
    });
}