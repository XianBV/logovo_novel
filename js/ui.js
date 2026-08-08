/* ==========================================
   ЛОГОВО НОВЕЛЛ — ИНТЕРФЕЙС
   Модальные окна, загрузка, уведомления и утилиты
   ========================================== */

console.log('📦 ui.js загружен');

function formatDateShort(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        // Формат: ДД.ММ.ГГГГ ЧЧ:ММ
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }) + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show', 'visible');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        // ✨ НАЧАЛО ИСПРАВЛЕНИЯ: Динамическая загрузка виджета ✨
        if (modalId === 'auth-modal' && !isTelegramWidgetLoaded) {
            const placeholder = document.getElementById('telegram-widget-placeholder');
            
            // Проверяем, что плейсхолдер существует
            if (placeholder) { 
                console.log('Загрузка виджета Telegram...');
                isTelegramWidgetLoaded = true; // Ставим флаг, чтобы не грузить дважды

                const script = document.createElement('script');
                script.async = true; // async здесь уже безопасен
                script.src = 'https://telegram.org/js/telegram-widget.js?22';
                
                // Все data-атрибуты из твоего HTML
                script.dataset.telegramLogin = 'logovo_saltfish_bot';
                script.dataset.size = 'large';
                script.dataset.onauth = 'onTelegramAuth(user)';
                script.dataset.requestAccess = 'write';

                // Добавляем скрипт ВНУТРЬ плейсхолдера
                // Теперь document.write() сработает только внутри этого div
                placeholder.appendChild(script);
            }
        }
        // ✨ КОНЕЦ ИСПРАВЛЕНИЯ ✨
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (document.activeElement) document.activeElement.blur(); // <-- ДОБАВЛЕНО: Снимаем фокус
        modal.classList.remove('show', 'visible');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

function showConfirmModal(title, message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content confirm-modal">
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn-primary confirm-yes">Да</button>
                <button class="btn btn-secondary confirm-no">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const yesBtn = modal.querySelector('.confirm-yes');
    const noBtn = modal.querySelector('.confirm-no');
    
    const cleanup = () => {
        modal.remove();
    };
    
    yesBtn.onclick = () => {
        cleanup();
        if (onConfirm) onConfirm();
    };
    
    noBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    
    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function showAlertModal(title, message, type = 'info') {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content alert-modal alert-${type}">
            <div class="alert-icon">${icons[type] || icons.info}</div>
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn-primary alert-ok">OK</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const okBtn = modal.querySelector('.alert-ok');
    
    const cleanup = () => {
        modal.remove();
    };
    
    okBtn.onclick = cleanup;
    
    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function showPromptModal(title, message, defaultValue = '', onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal show visible';
    modal.innerHTML = `
        <div class="modal-content prompt-modal">
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(message)}</p>
            <input type="text" class="form-input prompt-input" value="${escapeHtml(defaultValue)}">
            <div class="modal-actions">
                <button class="btn btn-primary prompt-ok">OK</button>
                <button class="btn btn-secondary prompt-cancel">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const input = modal.querySelector('.prompt-input');
    const okBtn = modal.querySelector('.prompt-ok');
    const cancelBtn = modal.querySelector('.prompt-cancel');
    
    const cleanup = () => {
        modal.remove();
    };
    
    okBtn.onclick = () => {
        const value = input.value.trim();
        cleanup();
        if (onConfirm) onConfirm(value);
    };
    
    cancelBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    
    // Enter для подтверждения
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            okBtn.click();
        }
    });
    
    // ESC для отмены
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    // Фокус на input
    setTimeout(() => input.focus(), 100);
}

function showSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

function hideSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function showLoading(show, options = {}) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;

    // Показываем/скрываем сам оверлей (темный фон)
    overlay.style.display = show ? 'flex' : 'none';

    if (show) {
        // Очищаем предыдущее содержимое
        overlay.innerHTML = '';

        // --- КЛЮЧЕВОЕ РЕШЕНИЕ: Что показать? ---
        if (options.animationType) {
            // ПОКАЗЫВАЕМ КАСТОМНУЮ АНИМАЦИЮ
            overlay.innerHTML = '<div id="custom-loading-animation"></div>'; // Контейнер для анимации
            overlay.classList.add('custom-animation-mode'); // Добавляем класс для стилизации фона, если нужно

            // Вызываем нужную функцию для отрисовки анимации
            if (options.animationType === 'bubbles') {
                showBubbleLoadingAnimation(); // Новое имя функции
            } else if (options.animationType === 'book') {
                showBookLoadingAnimation(); // Новое имя функции
            }
            // Можно добавить другие типы анимации
        } else {
            // ПОКАЗЫВАЕМ СТАНДАРТНОЕ ОКНО
            overlay.classList.remove('custom-animation-mode'); // Убираем класс кастомной анимации
            overlay.innerHTML = `
                <div class="loading-box">
                    <div class="loading-spinner-large"></div>
                    <h3 id="loading-title">${options.title || 'Загрузка...'}</h3>
                    <p id="loading-description">${options.description || ''}</p>
                    ${options.progress ? `
                        <div class="progress-container" id="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
                            </div>
                            <span id="progress-text">0%</span>
                        </div>` : ''}
                </div>
            `;
            // Обновляем прогресс, если нужно
            if (options.progress) {
                updateProgress(0, options.description || '');
            }
        }
    } else {
        // При скрытии просто очищаем
        overlay.classList.remove('custom-animation-mode');
        overlay.innerHTML = '';
    }
}

function updateProgress(percent, text = '') {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const loadingDesc = document.getElementById('loading-description');
    
    if (progressFill) {
        progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    
    if (progressText) {
        progressText.textContent = `${Math.round(percent)}%`;
    }
    
    if (text && loadingDesc) {
        loadingDesc.textContent = text;
    }
}

function getDisplayRoleName(role) {
    // 1. Берем тему из STATE, которую мы получили от сервера в initializeApp
    const currentThemeName = STATE.currentRoleTheme || 'default';
    
    // 2. Ищем объект темы в справочнике ROLE_THEMES (он у тебя в начале script.js)
    const theme = ROLE_THEMES[currentThemeName] || ROLE_THEMES['default'];
    
    // 3. Возвращаем перевод для конкретной роли
    return theme[role] || role; 
}

function showBubbleLoadingAnimation() {
    const container = document.querySelector('#loading-overlay #custom-loading-animation');
    if (!container){
        console.error("Контейнер #custom-loading-animation не найден внутри #loading-overlay!");
        return;
    }

    let bubblesHtml = '<div class="bubbles-container">';

    const bubbleCount = 50; // Оставляем 50
    const blurProbability = 0.4; // Оставляем 40%
    // ✨ 1. Увеличиваем силу размытия ✨
    const blurAmount = '4px';  // Попробуем 3px (было 1.5px)

    for (let i = 0; i < bubbleCount; i++) {
        const size = 5 + Math.random() * 25;
        const left = Math.random() * 100;
        const delay = Math.random() * 5;
        const duration = 5 + Math.random() * 5;
        let opacity = 0.1 + Math.random() * 0.3; // Начальная прозрачность

        let individualStyle = '';

        if (Math.random() < blurProbability) {
            individualStyle += `filter: blur(${blurAmount});`;
            // ✨ 2. Затемняем: Уменьшаем opacity еще сильнее для размытых ✨
            opacity = Math.max(0.02, opacity * 0.4); // Уменьшаем на 60%, минимум 0.02 (было * 0.7)
        }

        bubblesHtml += `
            <div class="bubble" style="
                left: ${left}%;
                width: ${size}px;
                height: ${size}px;
                opacity: ${opacity};
                animation-delay: ${delay}s;
                animation-duration: ${duration}s;
                ${individualStyle}
            "></div>`;
    }
    bubblesHtml += '</div>';

    container.innerHTML = bubblesHtml;
}

function showFishLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    
    const loadingBox = overlay.querySelector('.loading-box');
    if (!loadingBox) return;
    
    loadingBox.classList.add('fish-loading');
    
    // Создаём рыбок
    const fishContainer = document.createElement('div');
    fishContainer.className = 'fish-container';
    
    const fishes = ['🐟', '🐠', '🐡', '🦈', '🐙'];
    
    for (let i = 0; i < 5; i++) {
        const fish = document.createElement('div');
        fish.className = 'swimming-fish';
        fish.textContent = fishes[i % fishes.length];
        fish.style.top = `${20 + i * 15}%`;
        fish.style.animationDelay = `${i * 0.5}s`;
        fish.style.animationDuration = `${4 + Math.random() * 2}s`;
        fishContainer.appendChild(fish);
    }
    
    loadingBox.appendChild(fishContainer);
}

function showBookLoadingAnimation() {
    const container = document.getElementById('custom-loading-animation');
    if (!container) return;

    // HTML для анимации книги (из CSS)
    container.innerHTML = `
        <div class="page-loading-animation" style="min-height: auto;"> <div class="book">
                <div class="book__pg-shadow"></div>
                <div class="book__pg"></div>
                <div class="book__pg book__pg--2"></div>
                <div class="book__pg book__pg--3"></div>
                <div class="book__pg book__pg--4"></div>
                <div class="book__pg book__pg--5"></div>
            </div>
            <p style="margin-top: 1rem;">Загрузка...</p> </div>
    `;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.log(`🔔 [${type}]:`, message);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num) return '0';
    return new Intl.NumberFormat('ru-RU').format(num);
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return escapeHtml(text);
    return escapeHtml(text.substring(0, maxLength)) + '...';
}

function getNounEnding(number, one, two, five) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
}

function makeLinksClickable(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escapeHtml(text).replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function formatDate(dateString) {
    if (!dateString) return 'Неизвестно';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

function updateUserDisplay() {
    const loginBtn = document.getElementById('login-btn');
    const userInfoBlock = document.getElementById('user-info');
    const adminBtn = document.getElementById('admin-btn');

    if (!loginBtn || !userInfoBlock) {
        console.error("UI elements not found!");
        return;
    }

    if (STATE.currentUser) {
        // Показываем профиль
        loginBtn.style.display = 'none';
        userInfoBlock.style.display = 'flex';
        
        // Обновляем имя и аватар
        const userNameEl = document.getElementById('user-name');
        const userAvatarEl = document.getElementById('user-avatar');
        
        if (userNameEl) userNameEl.textContent = STATE.currentUser.username;
        if (userAvatarEl) userAvatarEl.textContent = STATE.currentUser.username[0].toUpperCase();
        
        // Управление кнопками на основе ролей
        const role = STATE.currentUser.role;
        
        // Админ панель
        if (adminBtn) {
            adminBtn.style.display = (role === 'admin' || role === 'owner') ? 'inline-flex' : 'none';
        }
        
        // Добавляем классы к документу для CSS
        document.documentElement.setAttribute('data-user-role', role);
        if (role === 'admin' || role === 'owner') {
            document.documentElement.classList.add('is-admin');
        }
        if (['creator', 'admin', 'owner'].includes(role)) {
            document.documentElement.classList.add('can-create');
        }

        // ✨ Обновление аватара в ШАПКЕ ✨
        const userAvatarHeader = document.querySelector('#user-info .user-icon'); 
        if (userAvatarHeader) {
            // Добавил дополнительную проверку на "null", чтобы избежать ошибок
            if (STATE.currentUser.avatar_url && STATE.currentUser.avatar_url !== 'null') {
                let avatarUrl = escapeHtml(STATE.currentUser.avatar_url);
                if (avatarUrl.includes('drive.google.com/thumbnail')) {
                    avatarUrl += '&t=' + new Date().getTime(); 
                }
                // Убрал лишний слэш перед $, теперь ссылка подставляется правильно!
                // Также починил fallback: если картинка всё же не загрузится, вернется рожица (°ロ°) !
                userAvatarHeader.innerHTML = `<img src="${avatarUrl}" alt="Аватар" class="header-avatar-image" onerror="this.onerror=null; this.parentElement.innerHTML='(°ロ°) !';">`; 
            } else {
                userAvatarHeader.innerHTML = '(°ロ°) !'; 
            }
        }
        // ✨ Конец обновления аватара в шапке ✨
        
    } else {
        // Неавторизован
        loginBtn.style.display = 'inline-flex';
        userInfoBlock.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';

        const userAvatarHeader = document.querySelector('#user-info .user-icon');
        if (userAvatarHeader) userAvatarHeader.innerHTML = '(°ロ°) !'; // Возвращаем заглушку
        
        // Убираем классы
        document.documentElement.classList.remove('is-admin', 'can-create');
        document.documentElement.removeAttribute('data-user-role');
    }
}

function checkUserPermission(action, novel) {
    if (!STATE.currentUser) return false;
    
    const userId = STATE.currentUser.user_id;
    const role = STATE.currentUser.role;
    
    // Владелец может всё
    if (userId === 0 || role === 'owner') return true;
    
    // Админы могут всё
    if (role === 'admin') return true;
    
    // Создатель может редактировать свою новеллу
    if (action === 'edit' && novel && novel.creator_id === userId) return true;
    
    // Создатели могут создавать новое
    if (action === 'create' && (role === 'creator' || role === 'admin')) return true;
    
    return false;
}

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') {
        return;
    }

    document.querySelectorAll('.modal.show').forEach(modal => {
        hideModal(modal.id);
    });
});
