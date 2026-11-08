/* ==========================================
   ЛОГОВО НОВЕЛЛ — ПРОФИЛЬ
   Профили, полки и общий доступ
   ========================================== */

console.log('📦 profile.js загружен');

const PROFILE_SHELF_TYPES = Object.freeze({
    all: { title: 'Все', icon: 'grid' },
    reading: { title: 'Читаю сейчас', icon: 'book-open' },
    want_to_read: { title: 'Хочу прочитать', icon: 'bookmark' },
    completed: { title: 'Прочитано', icon: 'check-circle' },
    favorite: { title: 'Любимое', icon: 'heart' },
    dropped: { title: 'Брошено', icon: 'archive' }
});
const PROFILE_SHELF_SORTS = new Set(['added_desc', 'title_asc', 'title_desc']);
const PROFILE_SHELF_VIEWS = new Set(['grid', 'list']);
const PROFILE_SHELF_WIDTH_DEFAULT = 180;
const PROFILE_SHELF_WIDTH_MIN = 64;
const PROFILE_SHELF_WIDTH_MAX = 320;
let activeProfileShelfType = 'all';
let activeProfileShelfSort = 'added_desc';
let activeProfileShelfView = 'grid';
let profileShelfLists = {};
let profileHeroInteractionCleanup = null;
let profileShelfSearch = '';
let profileLibraryRequest = 0;
let profileHeroTransition = null;
let profileShelfWidthRevision = 0;
let profileScrollSpace = null;

function getProfileStorageKey(name) {
    return `profile_${STATE.currentUser?.user_id ?? 'guest'}_${name}`;
}

function renderProfileAvatarMarkup(url, alt = 'Аватар') {
    const placeholder = '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>';
    if (!url || url === 'null' || url === 'undefined') return placeholder;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="profile-avatar-image" onerror="this.hidden=true; this.nextElementSibling.hidden=false;"><span class="avatar-placeholder-emoji" hidden>(_ _*) Z z z</span>`;
}

function formatProfileDays(days) {
    const remainder100 = days % 100;
    const remainder10 = days % 10;
    if (remainder100 >= 11 && remainder100 <= 14) return `${days} дней`;
    if (remainder10 === 1) return `${days} день`;
    if (remainder10 >= 2 && remainder10 <= 4) return `${days} дня`;
    return `${days} дней`;
}

function updateProfilePresence(isOnline) {
    const presence = document.getElementById('profile-presence');
    if (!presence) return;
    const avatarPanel = presence.closest('.profile-avatar-panel');
    const label = presence.querySelector('.profile-presence-label');
    presence.classList.toggle('is-online', Boolean(isOnline));
    presence.classList.toggle('is-offline', !isOnline);
    avatarPanel?.classList.toggle('is-online', Boolean(isOnline));
    avatarPanel?.classList.toggle('is-offline', !isOnline);
    if (label) label.textContent = isOnline ? 'В сети' : 'Не в сети';
}

function updateProfileHeroDetails(user) {
    const bio = document.getElementById('profile-bio');
    if (bio) {
        const bioText = bio.querySelector('.profile-bio-text');
        if (bioText) {
            bioText.textContent = user.bio?.trim() || '';
        }
        bio.classList.toggle('is-empty', !user.bio?.trim());
        bio.hidden = !user.bio?.trim();
    }

    const membership = document.getElementById('profile-membership');
    if (membership) {
        const registeredAt = user.created_at ? new Date(user.created_at) : null;
        const hasValidDate = registeredAt && !Number.isNaN(registeredAt.getTime());
        membership.hidden = !hasValidDate;
        if (hasValidDate) {
            const registrationDate = registeredAt.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            const registeredDay = Date.UTC(registeredAt.getFullYear(), registeredAt.getMonth(), registeredAt.getDate());
            const today = new Date();
            const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
            const daysInLair = Math.max(1, Math.floor((currentDay - registeredDay) / 86400000) + 1);
            membership.textContent = `С нами с ${registrationDate} · ${formatProfileDays(daysInLair)}`;
        }
    }

    const isOwnVisibleProfile = String(user.user_id) === String(STATE.currentUser?.user_id)
        && document.visibilityState === 'visible';
    updateProfilePresence(isOwnVisibleProfile || Boolean(user.is_online));
}

function getProfileScrollContainer(hero) {
    for (let element = hero.parentElement; element && element !== document.documentElement; element = element.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(element).overflowY) &&
            (element.scrollHeight > element.clientHeight + 1 || element.scrollTop > 0 || element === document.body)) return element;
    }
    return document.scrollingElement || document.documentElement;
}

function getProfileScrollTop(hero) {
    const container = getProfileScrollContainer(hero);
    return container === document.documentElement ? window.scrollY : container.scrollTop;
}

function clearProfileScrollSpace() {
    if (!profileScrollSpace) return;
    const { page, originalMinHeight, onScroll, target, releaseAnimation } = profileScrollSpace;
    releaseAnimation?.cancel();
    page.style.minHeight = originalMinHeight;
    target.removeEventListener('scroll', onScroll);
    profileScrollSpace = null;
}

function reserveProfileScrollSpace(hero) {
    const page = hero.closest?.('.profile-page');
    if (!page) return () => {};
    if (profileScrollSpace && profileScrollSpace.page !== page) clearProfileScrollSpace();
    const scrollContainer = getProfileScrollContainer(hero);
    const scrollTarget = scrollContainer === document.documentElement ? window : scrollContainer;
    const scrollTop = scrollTarget === window ? window.scrollY : scrollContainer.scrollTop;
    // Вверху страницы подвал следует за изменением высоты самой карточки.
    // Фиксация высоты здесь задерживала его до последнего кадра анимации.
    if (!profileScrollSpace && scrollTop <= 2) return () => {};
    if (!profileScrollSpace) {
        const container = getProfileScrollContainer(hero);
        const target = container === document.documentElement ? window : container;
        const pageHeight = page.getBoundingClientRect().height;
        const outsideHeight = container.scrollHeight - pageHeight;
        const state = { page, originalMinHeight: page.style.minHeight, outsideHeight, target, animating: true, pending: 0, onScroll: null };
        state.onScroll = () => {
            const scrollTop = target === window ? window.scrollY : container.scrollTop;
            if (!page.isConnected || scrollTop <= 2) { clearProfileScrollSpace(); return; }
            if (state.animating) return;
            state.releaseAnimation?.cancel();
            state.releaseAnimation = null;
            // Оставляем только место, нужное для текущей прокрутки. При движении
            // вверх оно уменьшается; вниз пустое пространство не наращивается.
            const viewportHeight = target === window ? window.innerHeight : container.clientHeight;
            const needed = Math.max(0, scrollTop + viewportHeight - state.outsideHeight);
            page.style.minHeight = `${needed}px`;
        };
        profileScrollSpace = state;
        target.addEventListener('scroll', state.onScroll, { passive: true });
    }
    const state = profileScrollSpace;
    state.releaseAnimation?.cancel();
    state.releaseAnimation = null;
    state.pending++;
    state.animating = true;
    page.style.minHeight = `${page.getBoundingClientRect().height}px`;
    return () => {
        if (profileScrollSpace !== state) return;
        state.pending--;
        state.animating = state.pending > 0;
        if (!state.animating) {
            const previousHeight = page.getBoundingClientRect().height;
            state.onScroll();
            if (profileScrollSpace !== state || typeof page.animate !== 'function' ||
                window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const nextHeight = page.getBoundingClientRect().height;
            if (previousHeight <= nextHeight + 1) return;
            const animation = page.animate([{ minHeight: `${previousHeight}px` }, { minHeight: `${nextHeight}px` }], {
                duration: 320, easing: 'cubic-bezier(.22,.72,.18,1)'
            });
            state.releaseAnimation = animation;
            animation.finished.catch(() => {}).then(() => {
                if (state.releaseAnimation === animation) state.releaseAnimation = null;
            });
        }
    };
}

async function setProfileHeroExpanded(expanded) {
    const hero = document.getElementById('profile-hero');
    const button = document.getElementById('profile-hero-toggle');
    if (!hero || !button) return;
    if (profileHeroTransition?.hero === hero) {
        profileHeroTransition.desired = expanded;
        return profileHeroTransition.promise;
    }
    if (hero.classList.contains('is-expanded') === expanded) return;
    const state = { hero, desired: expanded, animations: [], promise: null };
    profileHeroTransition = state;
    const finishScrollSpace = reserveProfileScrollSpace(hero);
    const updateState = () => {
        hero.classList.toggle('is-expanded', expanded);
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', expanded ? 'Свернуть профиль' : 'Развернуть профиль');
        button.removeAttribute('title');
    };
    state.promise = (async () => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof hero.animate !== 'function') {
            hero.classList.add('is-layout-measuring');
            updateState();
            hero.getBoundingClientRect();
            hero.classList.remove('is-layout-measuring');
            return;
        }
        const frame = hero.querySelector('.profile-avatar-frame');
        if (!frame) { updateState(); return; }
        const texts = [...hero.querySelectorAll('.profile-info, .profile-meta, .profile-presence')];
        const visible = elements => elements.filter(element => getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().height > 0);
        const startHero = hero.getBoundingClientRect();
        const startAvatar = frame.getBoundingClientRect();
        const flight = frame.cloneNode(true);
        flight.classList.add('profile-avatar-flight');
        flight.classList.toggle('is-online', frame.closest('.profile-avatar-panel')?.classList.contains('is-online'));
        flight.setAttribute('aria-hidden', 'true');
        flight.inert = true;
        const sourceStyle = getComputedStyle(frame.querySelector('.profile-avatar-display'));
        const sourceDisplayStyle = { borderWidth: sourceStyle.borderWidth, boxShadow: sourceStyle.boxShadow };
        const flightDisplay = flight.querySelector('.profile-avatar-display');
        flightDisplay.style.borderWidth = sourceDisplayStyle.borderWidth;
        flightDisplay.style.boxShadow = sourceDisplayStyle.boxShadow;
        const placeholder = flight.querySelector('.avatar-placeholder-emoji');
        const sourceFontSize = placeholder ? parseFloat(getComputedStyle(frame.querySelector('.avatar-placeholder-emoji')).fontSize) : 0;
        if (placeholder) placeholder.style.fontSize = sourceFontSize + 'px';
        flight.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        const relative = rect => ({ left: rect.left - startHero.left - hero.clientLeft, top: rect.top - startHero.top - hero.clientTop, width: rect.width, height: rect.height });
        const start = relative(startAvatar);
        Object.assign(flight.style, Object.fromEntries(Object.entries(start).map(([key, value]) => [key, value + 'px'])));
        hero.classList.add('is-layout-measuring');
        hero.append(flight);
        frame.style.visibility = 'hidden';
        button.setAttribute('aria-busy', 'true');
        const play = async (element, keyframes, duration) => {
            const animation = element.animate(keyframes, { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
            state.animations.push(animation);
            await animation.finished;
            return animation;
        };
        try {
            hero.dataset.animationPhase = 'hide-text';
            await Promise.all(visible(texts).map(element => play(element, [{ opacity: 1 }, { opacity: 0 }], 90)));
            texts.forEach(element => { element.style.opacity = '0'; });
            state.animations.forEach(animation => animation.cancel());
            state.animations = [];
            updateState();
            const endHeight = hero.getBoundingClientRect().height;
            const end = relative(frame.getBoundingClientRect());
            const rows = getComputedStyle(hero).gridTemplateRows;
            hero.style.gridTemplateRows = rows;
            hero.style.height = startHero.height + 'px';
            hero.classList.add('is-hero-animating');
            const resize = async () => {
                hero.dataset.animationPhase = expanded ? 'open-space' : 'close-space';
                const animation = await play(hero, [{ height: startHero.height + 'px' }, { height: endHeight + 'px' }], 420);
                hero.style.height = endHeight + 'px';
                animation.cancel();
            };
            const moveAvatar = async () => {
                hero.dataset.animationPhase = 'move-avatar';
                const scale = end.width / start.width;
                const motions = [play(flight, [
                    { transform: 'translate(0, 0) scale(1, 1)' },
                    { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px) scale(${scale}, ${end.height / start.height})` }
                ], 420)];
                const dot = flight.querySelector('.profile-presence-dot');
                if (dot) motions.push(play(dot, [{ transform: 'scale(1)' }, { transform: `scale(${1 / scale})` }], 420));
                if (placeholder && sourceFontSize) {
                    const finalFontSize = parseFloat(getComputedStyle(frame.querySelector('.avatar-placeholder-emoji')).fontSize);
                    motions.push(play(placeholder, [{ transform: 'scale(1)' }, { transform: `scale(${finalFontSize / sourceFontSize / scale})` }], 420));
                }
                const finalBorder = parseFloat(getComputedStyle(frame.querySelector('.profile-avatar-display')).borderWidth);
                motions.push(play(flightDisplay, [{ borderWidth: sourceDisplayStyle.borderWidth }, { borderWidth: (finalBorder / scale) + 'px' }], 420));
                await Promise.all(motions);
                frame.style.removeProperty('visibility');
                flight.remove();
            };
            const reveal = async () => {
                hero.dataset.animationPhase = 'show-text';
                await Promise.all(visible(texts).map(element => play(element, [{ opacity: 0 }, { opacity: 1 }], 130)));
                texts.forEach(element => element.style.removeProperty('opacity'));
            };
            // Текст появляется только после того, как аватар освободил его область.
            await Promise.all([resize(), moveAvatar()]);
            await reveal();
        } finally {
            state.animations.forEach(animation => animation.cancel());
            flight.remove();
            frame.style.removeProperty('visibility');
            texts.forEach(element => element.style.removeProperty('opacity'));
            hero.style.removeProperty('height');
            hero.style.removeProperty('grid-template-rows');
            hero.classList.remove('is-hero-animating', 'is-layout-measuring');
            delete hero.dataset.animationPhase;
            button.removeAttribute('aria-busy');
        }
    })();
    try { await state.promise; }
    catch (error) { console.warn('Не удалось завершить анимацию профиля:', error); updateState(); }
    finally {
        finishScrollSpace();
        if (profileHeroTransition === state) {
            profileHeroTransition = null;
            if (hero.isConnected && document.getElementById('profile-hero') === hero && state.desired !== expanded) {
                await setProfileHeroExpanded(state.desired);
            }
        }
    }
}

function toggleProfileHero() {
    const hero = document.getElementById('profile-hero');
    if (!hero) return;
    const desired = profileHeroTransition?.hero === hero ? profileHeroTransition.desired : hero.classList.contains('is-expanded');
    void setProfileHeroExpanded(!desired);
}

function setupProfileHeroAutoCollapse() {
    if (profileHeroInteractionCleanup) profileHeroInteractionCleanup();
    const hero = document.getElementById('profile-hero');
    if (!hero) return;

    let touchStartY = null;
    let touchStartX = null;
    let wheelDistance = 0;
    let wheelResetTimer = null;
    let gestureLockedUntil = 0;
    let blockCurrentWheelGesture = false;

    const applyGestureState = (expanded, wheelGesture = false) => {
        if (Date.now() < gestureLockedUntil) return;
        const hero = document.getElementById('profile-hero');
        if (!hero || hero.classList.contains('is-expanded') === expanded) return;
        gestureLockedUntil = Date.now() + 560;
        wheelDistance = 0;
        if (wheelGesture && typeof suppressProfileWheelTail === 'function') suppressProfileWheelTail();
        setProfileHeroExpanded(expanded);
    };

    const handleWheel = event => {
        if (event.target.closest('button, a, input, textarea, select, .profile-bio')) return;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const hero = document.getElementById('profile-hero');
        if (!hero) return;
        const isExpanded = hero.classList.contains('is-expanded');
        const startsCollapse = isExpanded && event.deltaY > 0;
        const startsExpand = !isExpanded && getProfileScrollTop(hero) <= 12 && event.deltaY < 0;

        if (!blockCurrentWheelGesture && !startsCollapse && !startsExpand) return;
        event.preventDefault();
        blockCurrentWheelGesture = true;

        if (Math.sign(wheelDistance) !== Math.sign(event.deltaY)) wheelDistance = 0;
        wheelDistance += event.deltaY;
        clearTimeout(wheelResetTimer);
        wheelResetTimer = setTimeout(() => {
            wheelDistance = 0;
            blockCurrentWheelGesture = false;
        }, 180);

        if (wheelDistance > 52) {
            applyGestureState(false, true);
        } else if (wheelDistance < -68 && getProfileScrollTop(hero) <= 12) {
            applyGestureState(true, true);
        }
    };

    const handleTouchStart = event => {
        if (event.touches.length !== 1 || event.target.closest('button, a, input, textarea, select, .profile-bio')) {
            touchStartY = null;
            return;
        }
        touchStartY = event.touches[0]?.clientY ?? null;
        touchStartX = event.touches[0]?.clientX ?? null;
    };

    const handleTouchMove = event => {
        if (touchStartY === null) return;
        const currentY = event.touches[0]?.clientY ?? touchStartY;
        const distance = currentY - touchStartY;
        const dx = (event.touches[0]?.clientX ?? touchStartX) - touchStartX;
        if (event.touches.length !== 1 || Math.abs(dx) > Math.abs(distance) * 1.6 && Math.abs(dx) > 14) {
            touchStartY = null;
            return;
        }
        const hero = document.getElementById('profile-hero');
        if (!hero) return;
        const shouldCollapse = hero.classList.contains('is-expanded') && distance < -4;
        const shouldExpand = !hero.classList.contains('is-expanded') && getProfileScrollTop(hero) <= 12 && distance > 4;
        if (shouldCollapse || shouldExpand) event.preventDefault();
    };

    const handleTouchEnd = event => {
        if (touchStartY === null) return;
        const touchEndY = event.changedTouches[0]?.clientY ?? touchStartY;
        const distance = touchEndY - touchStartY;
        touchStartY = null;
        if (distance < -36) {
            applyGestureState(false);
        } else if (distance > 36 && getProfileScrollTop(hero) <= 12) {
            applyGestureState(true);
        }
    };

    hero.addEventListener('wheel', handleWheel, { passive: false });
    hero.addEventListener('touchstart', handleTouchStart, { passive: true });
    hero.addEventListener('touchmove', handleTouchMove, { passive: false });
    hero.addEventListener('touchend', handleTouchEnd, { passive: true });
    const handleTouchCancel = () => { touchStartY = null; touchStartX = null; };
    hero.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    profileHeroInteractionCleanup = () => {
        clearTimeout(wheelResetTimer);
        hero.removeEventListener('wheel', handleWheel);
        hero.removeEventListener('touchstart', handleTouchStart);
        hero.removeEventListener('touchmove', handleTouchMove);
        hero.removeEventListener('touchend', handleTouchEnd);
        hero.removeEventListener('touchcancel', handleTouchCancel);
        profileHeroInteractionCleanup = null;
    };
}

async function renderCreatorPage(creatorId) {
    const container = document.getElementById('page-content-container');
    showLoading(true, { title: 'Загрузка страницы создателя...' });

    try {
        const response = await apiRequest('getUserPublicProfile', { userId: creatorId });
        if (!response.success) throw new Error(response.error);

        const { user, novels } = response;
        const visibleNovels = novels.filter(n => !n.is_deleted); // Фильтруем удаленные

        const breadcrumbs = getBreadcrumbs('creator', { name: user.username });

        // ✨ ОБНОВЛЕННЫЙ HTML ✨
        container.innerHTML = `
            <div class="page-content creator-page">
                ${breadcrumbs}
                <div class="profile-header creator-header">
                    <button class="btn btn-ghost btn-sm creator-back-btn" onclick="goBackInHistory()">
                        ← Назад
                    </button>
                    <div class="profile-avatar-placeholder">
                        <span>${escapeHtml(user.username[0] || '?')}</span>
                    </div>
                    <div class="profile-info">
                        <h1 class="profile-username">
                            ${escapeHtml(user.username)}
                            <span class="profile-user-id">(id: ${user.user_id})</span>
                        </h1>

                        <div class="author-novel-count">
                             <span class="count-value">${visibleNovels.length}</span>
                             <span class="count-separator">•</span>
                             <span class="count-label">${getNounEnding(visibleNovels.length, 'Новелла', 'Новеллы', 'Новелл')}</span>
                         </div>
                        </div>
                </div>

                <div class="creator-novels">
                    <h2>Произведения создателя</h2>
                     ${visibleNovels.length > 0 ? renderNovelCollection(visibleNovels) : `
                        <p class="text-muted">У этого создателя пока нет добавленных произведений.</p>
                    `}
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `<div class="error-page"><h3>Ошибка</h3><p>${error.message}</p></div>`;
    } finally {
        showLoading(false);
    }
}

function updateAllAvatars(avatarUrl) {
    // Если аватарки нет, используем стандартную или генерируем красивую с инициалами
    const defaultAvatarUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23ccc"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="40" fill="%23fff">?</text></svg>';
    
    // Проверяем, что ссылка действительно есть и она не равна строкам "null" или "undefined"
    const finalUrl = (avatarUrl && avatarUrl !== 'null' && avatarUrl !== 'undefined') 
        ? avatarUrl 
        : defaultAvatarUrl;

    // Находим элементы (проверь, чтобы ID совпадали с твоими в index.html)
    const headerAvatar = document.getElementById('header-avatar'); // ID картинки в хедере
    const profileAvatar = document.getElementById('profile-avatar'); // ID картинки в профиле

    if (headerAvatar) headerAvatar.src = finalUrl;
    if (profileAvatar) profileAvatar.src = finalUrl;
}

async function renderProfilePage() {
    const container = document.getElementById('page-content-container');
    if (!container) return;
    if (!STATE.currentUser) {
        container.innerHTML = `<div class="page-content profile-page"><p>Загрузка данных пользователя...</p></div>`;
        return;
    }

    document.body.classList.add('profile-page-open');
    const canCreate = ['creator', 'admin', 'owner'].includes(STATE.currentUser.role);
    profileShelfSearch = '';
    activeProfileShelfType = 'all';
    const breadcrumbs = getBreadcrumbs('profile');
    const savedSort = localStorage.getItem(getProfileStorageKey('shelf_sort'));
    activeProfileShelfSort = PROFILE_SHELF_SORTS.has(savedSort) ? savedSort : 'added_desc';
    const savedView = localStorage.getItem(getProfileStorageKey('shelf_view'));
    activeProfileShelfView = PROFILE_SHELF_VIEWS.has(savedView) ? savedView : 'grid';

    const avatarContent = renderProfileAvatarMarkup(STATE.currentUser.avatar_url);

    // ✨ Убираем вкладку "Созданные", если пользователь не может создавать ✨
    const createdNovelsTabHtml = canCreate
        ? `<button class="tab-btn" onclick="switchProfileTab(this, 'created')">Созданные новеллы</button>`
        : '';

    const novelsContainerHTML = `
        <div class="profile-library-bar">
            <div class="tabs">
                <button class="tab-btn active" onclick="switchProfileTab(this, 'shelves')">Мои полки</button>
                ${createdNovelsTabHtml}
            </div>
            <div class="profile-library-controls" aria-label="Настройки отображения полок">
                <label class="shelf-sort-control" id="profile-shelf-sort-control" title="Сортировка новелл">
                    <span class="shelf-sort-icon" aria-hidden="true">${renderUiIcon('sort')}</span>
                    <span class="visually-hidden">Сортировка новелл</span>
                    <select onchange="changeProfileShelfSort(this.value)" aria-label="Сортировка новелл">
                        <option value="added_desc" ${activeProfileShelfSort === 'added_desc' ? 'selected' : ''}>По добавлению</option>
                        <option value="title_asc" ${activeProfileShelfSort === 'title_asc' ? 'selected' : ''}>Название А–Я</option>
                        <option value="title_desc" ${activeProfileShelfSort === 'title_desc' ? 'selected' : ''}>Название Я–А</option>
                    </select>
                </label>
                <div class="profile-view-toggle" aria-label="Вид карточек">
                    <button class="profile-library-control active" id="profile-shelf-view-toggle" type="button" onclick="toggleProfileShelfView()" title="${activeProfileShelfView === 'grid' ? 'Показать списком' : 'Показать сеткой'}" aria-label="${activeProfileShelfView === 'grid' ? 'Показать списком' : 'Показать сеткой'}">
                        ${renderUiIcon(activeProfileShelfView === 'grid' ? 'list' : 'grid')}
                    </button>
                </div>
            </div>
        </div>
        <div class="reading-lists-container">
            <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
    `;

    container.innerHTML = `
        <div class="page-content profile-page">
            <div class="page-header profile-page-header">
                 ${breadcrumbs}
                 <div class="profile-header-actions">
                     <button class="profile-icon-action" type="button" onclick="navigateTo('profile-settings')" title="Настройки профиля" aria-label="Настройки профиля">
                         ${renderUiIcon('sliders')}
                     </button>
                     <button class="profile-icon-action profile-logout-action" type="button" onclick="handleLogout()" title="Выйти из аккаунта" aria-label="Выйти из аккаунта">
                         ${renderUiIcon('logout')}
                     </button>
                 </div>
            </div>
            <section class="profile-header profile-hero" id="profile-hero" aria-labelledby="profile-title">
                <div class="profile-hero-decoration" aria-hidden="true">${renderUiIcon('book-open')}</div>
                <div class="profile-avatar-panel">
                    <span class="profile-field-label">Аватар</span>
                    <div class="profile-avatar-frame">
                        <div class="profile-avatar-display">
                             ${avatarContent}
                        </div>
                        <span class="profile-presence-dot" aria-hidden="true"></span>
                    </div>
                    <p class="profile-presence is-online" id="profile-presence" role="status">
                        <span class="profile-presence-label">В сети</span>
                    </p>
                </div>
                <div class="profile-info">
                    <div class="profile-identity-line">
                        <div class="profile-name-block">
                            <h1 class="profile-username" id="profile-title">${escapeHtml(STATE.currentUser.username)}</h1>
                        </div>
                        <span class="profile-user-id profile-user-id-compact">ID ${STATE.currentUser.user_id}</span>
                    </div>
                    <p class="profile-role-badge">
                        <span class="profile-field-label">Роль</span>
                        <span>${escapeHtml(getDisplayRoleName(STATE.currentUser.role))}</span>
                    </p>
                    <p class="profile-bio" id="profile-bio">
                        <span class="profile-bio-text"></span>
                    </p>
                </div>
                <div class="profile-meta">
                    <span class="profile-user-id profile-user-id-expanded">ID ${STATE.currentUser.user_id}</span>
                    <p class="profile-membership" id="profile-membership" hidden></p>
                </div>
                <button class="profile-hero-toggle" id="profile-hero-toggle" type="button" onclick="toggleProfileHero()" aria-expanded="false" aria-controls="profile-bio" aria-label="Развернуть профиль">
                    ${renderUiIcon('chevron-down')}
                </button>
            </section>
            ${novelsContainerHTML}
        </div>
    `;

    updateProfileHeroDetails(STATE.currentUser);
    setupProfileHeroAutoCollapse();
    const renderedHero = document.getElementById('profile-hero');
    const profileRequest = apiRequest('getUserPublicProfile', {
        userId: STATE.currentUser.user_id
    }, true).then(response => {
        if (!response.success || !response.user || document.getElementById('profile-hero') !== renderedHero) return;
        Object.assign(STATE.currentUser, {
            bio: response.user.bio || '',
            created_at: response.user.created_at || null,
            is_online: Boolean(response.user.is_online)
        });
        localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
        updateProfileHeroDetails(STATE.currentUser);
    }).catch(error => console.warn('Не удалось обновить сведения профиля:', error));

    await Promise.all([loadAndRenderReadingLists(), profileRequest]);
}

async function renderProfileSettingsPage() {
    if (profileHeroInteractionCleanup) profileHeroInteractionCleanup();
    const container = document.getElementById('page-content-container');
    if (!container || !STATE.currentUser) {
        navigateTo('home'); // Перенаправляем, если нет пользователя
        return;
    }

    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    const initialTab = ['notifications', 'account', 'appearance'].includes(requestedTab) ? requestedTab : 'edit-profile';

    // Хлебные крошки для настроек
    const breadcrumbs = getBreadcrumbs('profile-settings'); // Нужно будет добавить case в getBreadcrumbs

    container.innerHTML = `
        <div class="page-content settings-page profile-settings-page">
            ${breadcrumbs}
            <div class="profile-settings-heading"><h1>Настройки профиля</h1></div>

            <div class="tabs settings-tabs">
                <button class="tab-btn ${initialTab === 'edit-profile' ? 'active' : ''}" onclick="switchSettingsTab(this, 'edit-profile')">Редактирование</button>
                <button class="tab-btn ${initialTab === 'appearance' ? 'active' : ''}" onclick="switchSettingsTab(this, 'appearance')">Вид профиля</button>
                <button class="tab-btn ${initialTab === 'account' ? 'active' : ''}" onclick="switchSettingsTab(this, 'account')">Аккаунт</button>
                <button class="tab-btn ${initialTab === 'notifications' ? 'active' : ''}" onclick="switchSettingsTab(this, 'notifications')">Уведомления</button>
                </div>

            <div class="settings-content-container">
                <div id="settings-tab-edit-profile" class="tab-content ${initialTab === 'edit-profile' ? 'active' : ''}">
                    <h3>Аватар</h3>
                    <div class="avatar-upload-section">
                        <div class="profile-avatar-container">
                             <div class="profile-avatar-display" id="profile-avatar-preview">
                                 </div>
                             <button type="button" onclick="document.getElementById('avatar-upload-input').click()" class="btn btn-secondary btn-sm change-avatar-btn" title="Изменить аватар" aria-label="Выбрать аватар">
                                 ${renderUiIcon('edit')}
                             </button>
                             <input type="file" id="avatar-upload-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display: none;">
                             <button id="delete-avatar-btn" class="btn btn-danger btn-sm delete-avatar-btn" title="Удалить аватар" aria-label="Удалить аватар">
                                 ${renderUiIcon('trash')}
                             </button>
                        </div>
                        <div class="avatar-upload-controls">
                             <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('avatar-upload-input').click()">Выбрать изображение</button>
                             <small class="form-help">JPG, PNG, GIF или WebP · до 5 МБ</small>
                             <button id="upload-avatar-btn" class="btn btn-primary btn-sm upload-avatar-btn" style="display: none;">
                                 Сохранить аватар
                             </button>
                             <small id="avatar-upload-hint" class="form-help"></small>
                        </div>
                      </div>
                      <hr class="section-divider">
                      <div class="profile-bio-settings">
                          <div>
                              <h3><label for="profile-bio-input">Описание профиля</label></h3>
                          </div>
                          <textarea id="profile-bio-input" class="form-input" maxlength="500" rows="4" placeholder="Описание (необязательно)">${escapeHtml(STATE.currentUser.bio || '')}</textarea>
                          <div class="profile-bio-settings-footer">
                              <small id="profile-bio-counter-label"><span id="profile-bio-counter">${String(STATE.currentUser.bio || '').length}</span> / 500</small>
                              <button id="save-profile-bio-btn" class="btn btn-primary btn-sm" type="button" onclick="saveProfileBio()">Сохранить описание</button>
                          </div>
                      </div>
                </div>

                <div id="settings-tab-appearance" class="tab-content ${initialTab === 'appearance' ? 'active' : ''}">
                    <fieldset class="profile-shelf-placement-setting">
                        <legend>Расположение кнопок полок</legend>
                        <div class="profile-placement-options">
                            <label class="profile-placement-option">
                                <input type="radio" name="shelf-placement" value="side" ${getProfileShelfPlacement() === 'side' ? 'checked' : ''} onclick="setProfileShelfPlacement(this.value)">
                                <span class="profile-placement-preview preview-side" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
                                <span>Слева</span>
                            </label>
                            <label class="profile-placement-option">
                                <input type="radio" name="shelf-placement" value="top" ${getProfileShelfPlacement() === 'top' ? 'checked' : ''} onclick="setProfileShelfPlacement(this.value)">
                                <span class="profile-placement-preview preview-top" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
                                <span>Сверху</span>
                            </label>
                        </div>
                        <p class="form-help">Выбранный режим действует на всех размерах экрана. Сохраняется для этого аккаунта в этом браузере.</p>
                        <p class="form-help" id="profile-placement-status" role="status"></p>
                    </fieldset>
                </div>
                <div id="settings-tab-account" class="tab-content ${initialTab === 'account' ? 'active' : ''}">
                     <h3>Ваш аккаунт</h3>
                     <dl class="profile-account-details"><div><dt>Имя</dt><dd>${escapeHtml(STATE.currentUser.username)}</dd></div><div><dt>Email</dt><dd id="profile-account-email-value">${escapeHtml(STATE.currentUser.email || 'Не указан')}</dd></div><div><dt>ID</dt><dd>${escapeHtml(String(STATE.currentUser.user_id))}</dd></div><div><dt>Роль</dt><dd>${escapeHtml(getDisplayRoleName(STATE.currentUser.role))}</dd></div></dl>
                      ${renderAccountConnectionsMarkup()}
                      <button class="btn btn-danger" onclick="handleLogout()">Выйти из аккаунта</button>
                      </div>
                <div id="settings-tab-notifications" class="tab-content ${initialTab === 'notifications' ? 'active' : ''}">
                    ${renderNotificationSettingsMarkup()}
                </div>
            </div>
        </div>
    `;

    // Заполняем блок аватара текущим значением
    const previewContainer = document.getElementById('profile-avatar-preview');
    const deleteBtn = document.getElementById('delete-avatar-btn');
    if (previewContainer && deleteBtn) {
        let avatarUrl = STATE.currentUser.avatar_url || null;
        if (avatarUrl && avatarUrl.includes('drive.google.com/thumbnail')) {
            avatarUrl += '&t=' + new Date().getTime(); // Добавляем cache-buster
        }
        const avatarContent = renderProfileAvatarMarkup(avatarUrl);
        previewContainer.innerHTML = avatarContent;
        deleteBtn.style.display = STATE.currentUser.avatar_url ? 'inline-flex' : 'none'; // Показываем/скрываем кнопку удаления
    }

    // Запускаем настройку загрузки аватара
    setupAvatarUpload();
    const bioInput = document.getElementById('profile-bio-input');
    bioInput?.addEventListener('input', () => {
        const counter = document.getElementById('profile-bio-counter');
        if (counter) counter.textContent = String(bioInput.value.length);
    });
    loadAccountConnections();
    if (initialTab === 'notifications') loadNotificationShelfSettings();
}

async function saveProfileBio() {
    const input = document.getElementById('profile-bio-input');
    const button = document.getElementById('save-profile-bio-btn');
    if (!input || !button) return;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Сохраняю…';
    try {
        const response = await apiPostRequest('updateProfileBio', { bio: input.value });
        if (!response.success) throw new Error(response.error || 'Не удалось сохранить описание');
        STATE.currentUser.bio = response.bio || '';
        input.value = STATE.currentUser.bio;
        const counter = document.getElementById('profile-bio-counter');
        if (counter) counter.textContent = String(input.value.length);
        localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
        showToast('Описание профиля сохранено', 'success');
    } catch (error) {
        showToast(`Не удалось сохранить описание: ${error.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

function switchSettingsTab(button, tabName) {
    // Убираем active со всех кнопок
    document.querySelectorAll('.settings-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    // Добавляем active нажатой кнопке
    button.classList.add('active');

    // Прячем все контенты вкладок
    document.querySelectorAll('.settings-content-container .tab-content').forEach(content => {
        content.classList.remove('active'); // Используем класс active
    });
    // Показываем нужный контент
    const activeContent = document.getElementById(`settings-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.add('active'); // Показываем через класс
    }
    if (tabName === 'notifications') loadNotificationShelfSettings();
}

function setupAvatarUpload() {
    const fileInput = document.getElementById('avatar-upload-input');
    const previewContainer = document.getElementById('profile-avatar-preview');
    const uploadBtn = document.getElementById('upload-avatar-btn');
    const deleteBtn = document.getElementById('delete-avatar-btn');
    const uploadHint = document.getElementById('avatar-upload-hint');

    if (!fileInput || !previewContainer || !uploadBtn || !deleteBtn) {
        console.warn("Элементы управления аватаром не найдены.");
        return;
    }

    let currentBase64 = null; // Храним Base64 для отправки
    let selectionVersion = 0;

    // Обработка выбора файла
    fileInput.addEventListener('change', async (event) => {
        const version = ++selectionVersion;
        const file = event.target.files[0];
        currentBase64 = null;
        uploadBtn.style.display = 'none';
        if (uploadHint) uploadHint.textContent = '';
        previewContainer.innerHTML = renderProfileAvatarMarkup(STATE.currentUser?.avatar_url);
        if (!file) {
            currentBase64 = null;
            uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
            // Восстанавливаем текущий аватар или заглушку
            const currentAvatarUrl = STATE.currentUser?.avatar_url;
            previewContainer.innerHTML = renderProfileAvatarMarkup(currentAvatarUrl);
            return;
        }

        // Валидация
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
            showToast('Выберите изображение JPG, PNG, GIF или WebP.', 'error');
            fileInput.value = ''; // Сбрасываем выбор файла
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // Лимит 5MB для аватара
            showToast('Файл слишком большой (макс 5MB).', 'error');
            fileInput.value = '';
            return;
        }

        // Конвертация и предпросмотр
        try {
            // Используем fileToBase64 со сжатием (например, до 400px, качество 0.8)
            const converted = await fileToBase64(file, 400, 0.8);
            if (version !== selectionVersion || !previewContainer.isConnected) return;
            currentBase64 = converted;
            previewContainer.innerHTML = `<img src="${currentBase64}" alt="Предпросмотр" class="profile-avatar-image">`;
            uploadBtn.style.display = 'inline-block'; // Показываем кнопку сохранения
            if (uploadHint) uploadHint.textContent = `Выбран файл: ${file.name}`;
        } catch (error) {
            if (version !== selectionVersion || !previewContainer.isConnected) return;
            showToast('Ошибка обработки изображения: ' + error.message, 'error');
            fileInput.value = '';
            currentBase64 = null;
            uploadBtn.style.display = 'none';
            if (uploadHint) uploadHint.textContent = '';
        }
    });

    // Обработка клика "Сохранить аватар"
    uploadBtn.addEventListener('click', async () => {
        if (!currentBase64) {
            showToast('Сначала выберите файл', 'warning');
            return;
        }

        showLoading(true, { title: 'Загрузка аватара...' });
        uploadBtn.disabled = true;

        try {
            const response = await apiPostRequest('uploadAvatar', { avatar_base64: currentBase64 });
            if (response.success && response.avatar_url) {
                // Обновляем состояние и localStorage
                STATE.currentUser.avatar_url = response.avatar_url;
                localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
                // Обновляем отображение (можно просто перезагрузить данные пользователя в шапке)
                updateUserDisplay(); // Обновит шапку
                // Обновляем превью на странице профиля на реальный URL
                previewContainer.innerHTML = renderProfileAvatarMarkup(response.avatar_url);
                currentBase64 = null; // Сбрасываем Base64
                uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
                deleteBtn.style.display = 'inline-block'; // Показываем кнопку удаления
                fileInput.value = ''; // Сбрасываем input file
                if (uploadHint) uploadHint.textContent = ''; // ✨ Очищаем подсказку
            } else {
                throw new Error(response.error || 'Не удалось загрузить аватар');
            }
        } catch (error) {
            showToast('Ошибка загрузки: ' + error.message, 'error');
        } finally {
            showLoading(false);
            uploadBtn.disabled = false;
        }
    });

    // Обработка клика "Удалить аватар"
    deleteBtn.addEventListener('click', () => {
        showConfirmModal('Удалить аватар?', 'Вы уверены, что хотите удалить текущий аватар?', async () => {
            showLoading(true, { title: 'Удаление аватара...' });
            deleteBtn.disabled = true;
            try {
                const response = await apiPostRequest('deleteAvatar', {});
                if (response.success) {
                    // Обновляем состояние и localStorage
                    STATE.currentUser.avatar_url = null;
                    localStorage.setItem('currentUser', JSON.stringify(STATE.currentUser));
                    // Обновляем отображение
                    updateUserDisplay(); // Обновит шапку
                    previewContainer.innerHTML = '<span class="avatar-placeholder-emoji">(_ _*) Z z z</span>'; // Показываем заглушку
                    deleteBtn.style.display = 'none'; // Прячем кнопку удаления
                    fileInput.value = ''; // Сбрасываем input file
                    currentBase64 = null; // Сбрасываем Base64
                    uploadBtn.style.display = 'none'; // Прячем кнопку сохранения
                    if (uploadHint) uploadHint.textContent = ''; // ✨ Очищаем подсказку

                } else {
                    throw new Error(response.error || 'Не удалось удалить аватар');
                }
            } catch (error) {
                showToast('Ошибка удаления: ' + error.message, 'error');
            } finally {
                showLoading(false);
                deleteBtn.disabled = false;
            }
        });
    });
}

function renderShelfNovelCard(novel) {
    return `
        <a class="shelf-novel-item novel-card" href="?page=novel-details&amp;id=${encodeURIComponent(novel.novel_id)}" data-novel-id="${escapeHtml(String(novel.novel_id))}" title="${escapeHtml(novel.title)}" aria-label="${escapeHtml(novel.title)}"
             onclick="if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateTo('novel-details', {id: this.dataset.novelId}); }">
            <div class="novel-cover">
                ${novel.cover_url ? 
                    `<img src="${escapeHtml(novel.cover_url)}" alt="${escapeHtml(novel.title)}" loading="lazy">` : 
                    `<div class="no-cover"><span class="shelf-cover-ornament">${renderUiIcon('book-open')}</span><span class="shelf-cover-name">${escapeHtml(novel.title)}</span></div>`
                }
            </div>
            <div class="novel-info"><h3 class="novel-title">${escapeHtml(novel.title)}</h3></div>
        </a>
    `;
}

function renderShelfSkeletonCard() {
    return `
        <div class="shelf-novel-item novel-card skeleton-card">
            <div class="novel-cover"><div class="skeleton skeleton-cover"></div></div>
            <div class="novel-info"><div class="skeleton skeleton-text short"></div></div>
        </div>
    `;
}

function getProfileShelfItems(shelfType) {
    if (shelfType !== 'all') return profileShelfLists[shelfType] || [];
    const unique = new Map();
    Object.keys(PROFILE_SHELF_TYPES).filter(type => type !== 'all').forEach(type => {
        (profileShelfLists[type] || []).forEach(item => {
            const key = String(item.novel_id ?? item.novel?.novel_id ?? '');
            if (!key) return;
            const previous = unique.get(key);
            const previousDate = Date.parse(previous?.added_at || '') || 0;
            const currentDate = Date.parse(item.added_at || '') || 0;
            if (!previous || currentDate >= previousDate) unique.set(key, item);
        });
    });
    return [...unique.values()];
}

function getSortedProfileShelfNovels(shelfType) {
    const items = getProfileShelfItems(shelfType).map(item => ({
        item,
        novel: item.novel || STATE.novels.find(novel => String(novel.novel_id) === String(item.novel_id))
    })).filter(entry => entry.novel);

    return items.sort((left, right) => {
        if (activeProfileShelfSort === 'title_asc') {
            return left.novel.title.localeCompare(right.novel.title, 'ru', { sensitivity: 'base' });
        }
        if (activeProfileShelfSort === 'title_desc') {
            return right.novel.title.localeCompare(left.novel.title, 'ru', { sensitivity: 'base' });
        }
        const leftDate = Date.parse(left.item.added_at || '') || 0;
        const rightDate = Date.parse(right.item.added_at || '') || 0;
        return rightDate - leftDate;
    }).map(entry => entry.novel);
}

function renderActiveProfileShelf() {
    const contentContainer = document.querySelector('.shelves-content');
    if (!contentContainer) return;
    const allNovels = getSortedProfileShelfNovels(activeProfileShelfType);
    const query = profileShelfSearch.trim().toLocaleLowerCase('ru');
    const novels = allNovels.filter(novel => !query || novel.title.toLocaleLowerCase('ru').includes(query));
    contentContainer.innerHTML = novels.length
        ? novels.map(novel => renderShelfNovelCard(novel)).join('')
        : `<div class="profile-empty-state">${renderUiIcon(query ? 'search' : 'book-open')}<h3>${query ? 'Ничего не найдено' : 'На полке пока нет новелл'}</h3><p>${query ? 'Попробуйте другое название или очистите поиск.' : 'Добавляйте новеллы на эту полку со страницы произведения.'}</p>${query ? '<button class="btn btn-secondary btn-sm" type="button" onclick="clearProfileShelfSearch()">Очистить поиск</button>' : '<button class="btn btn-secondary btn-sm" type="button" onclick="navigateTo(\'home\')">Найти новеллу</button>'}</div>`;
    const heading = document.getElementById('active-shelf-title');
    const count = document.getElementById('active-shelf-count');
    if (heading) heading.textContent = PROFILE_SHELF_TYPES[activeProfileShelfType].title;
    if (count) count.textContent = query ? `${novels.length} из ${allNovels.length}` : `${allNovels.length} ${getNounEnding(allNovels.length, 'новелла', 'новеллы', 'новелл')}`;

    document.querySelectorAll('.shelf-nav-btn').forEach(button => {
        const isActive = button.dataset.shelfType === activeProfileShelfType;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

function searchProfileShelves(value) {
    profileShelfSearch = value;
    renderActiveProfileShelf();
}

function clearProfileShelfSearch() {
    const input = document.getElementById('profile-shelf-search');
    if (input) { input.value = ''; input.focus(); }
    searchProfileShelves('');
}

function switchShelfView(shelfType) {
    if (!PROFILE_SHELF_TYPES[shelfType]) return;
    activeProfileShelfType = shelfType;
    renderActiveProfileShelf();
}

function changeProfileShelfSort(sortType) {
    if (!PROFILE_SHELF_SORTS.has(sortType)) return;
    activeProfileShelfSort = sortType;
    localStorage.setItem(getProfileStorageKey('shelf_sort'), sortType);
    const sortControl = document.getElementById('profile-shelf-sort-control');
    if (sortControl) {
        const sortLabels = {
            added_desc: 'По добавлению',
            title_asc: 'Название А–Я',
            title_desc: 'Название Я–А'
        };
        sortControl.title = `Сортировка: ${sortLabels[sortType]}`;
    }
    renderActiveProfileShelf();
}

function changeProfileShelfView(viewType) {
    if (!PROFILE_SHELF_VIEWS.has(viewType)) return;
    activeProfileShelfView = viewType;
    localStorage.setItem(getProfileStorageKey('shelf_view'), viewType);

    const shelves = document.querySelector('.shelves-content');
    if (shelves) shelves.classList.toggle('list-view', viewType === 'list');
    const toggle = document.getElementById('profile-shelf-view-toggle');
    if (toggle) {
        const nextView = viewType === 'grid' ? 'list' : 'grid';
        const nextLabel = nextView === 'grid' ? 'Показать сеткой' : 'Показать списком';
        toggle.innerHTML = renderUiIcon(nextView);
        toggle.title = nextLabel;
        toggle.setAttribute('aria-label', nextLabel);
    }
}

function toggleProfileShelfView() {
    changeProfileShelfView(activeProfileShelfView === 'grid' ? 'list' : 'grid');
}

function clampProfileShelfWidth(width) {
    return Math.round(Math.min(PROFILE_SHELF_WIDTH_MAX, Math.max(PROFILE_SHELF_WIDTH_MIN, Number(width) || PROFILE_SHELF_WIDTH_DEFAULT)));
}

function getProfileShelfPlacement() {
    const saved = localStorage.getItem(getProfileStorageKey('shelf_nav_placement'));
    if (saved === 'top' || saved === 'side') return saved;
    return window.matchMedia('(max-width: 767px)').matches ? 'top' : 'side';
}

function setProfileShelfPlacement(placement) {
    if (!['side', 'top'].includes(placement)) return;
    localStorage.setItem(getProfileStorageKey('shelf_nav_placement'), placement);
    applyProfileShelfPlacement();
    const status = document.getElementById('profile-placement-status');
    if (status) status.textContent = 'Сохранено';
}

function applyProfileShelfPlacement() {
    const layout = document.querySelector('.shelves-layout');
    if (!layout) return;
    const top = getProfileShelfPlacement() === 'top';
    layout.dataset.placement = top ? 'top' : 'side';
    const normalized = clampProfileShelfWidth(parseFloat(layout.style.getPropertyValue('--shelf-nav-width')));
    const expanded = top || normalized > 104;
    layout.classList.toggle('is-compact', !expanded);
    const toggle = layout.querySelector('.shelf-nav-toggle');
    if (toggle) {
        toggle.hidden = top;
        toggle.disabled = top;
        toggle.tabIndex = top ? -1 : 0;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Свернуть названия полок' : 'Развернуть названия полок');
        toggle.removeAttribute('title');
    }
    const nav = layout.querySelector('.shelves-nav');
    if (nav) {
        nav.removeAttribute('title');
        nav.setAttribute('aria-description', top
            ? 'Влево и вправо — прокрутить полки.'
            : 'Жест влево — свернуть названия, вправо — развернуть');
    }
    const resizer = layout.querySelector('.shelves-resizer');
    if (resizer) { resizer.hidden = top; resizer.tabIndex = top ? -1 : 0; }
}

function updateProfileShelfOverflow(layout) {
    const items = layout?.querySelector('.shelf-nav-items');
    const nav = layout?.querySelector('.shelves-nav');
    if (!items || !nav) return;
    nav.dataset.overflowStart = String(items.scrollLeft > 2);
    nav.dataset.overflowEnd = String(items.scrollLeft + items.clientWidth < items.scrollWidth - 2);
}

function setupProfileShelfOverflow() {
    const layout = document.querySelector('.shelves-layout');
    const items = layout?.querySelector('.shelf-nav-items');
    if (!items) return;
    const update = () => updateProfileShelfOverflow(layout);
    items.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
            if (items.isConnected) update();
            else observer.disconnect();
        });
        observer.observe(items);
    }
    update();
}

function applyProfileShelfWidth(width) {
    const layout = document.querySelector('.shelves-layout');
    if (!layout) return;
    const normalized = clampProfileShelfWidth(width);
    layout.style.setProperty('--shelf-nav-width', `${normalized}px`);
    applyProfileShelfPlacement();
    if (normalized > 104) localStorage.setItem(getProfileStorageKey('shelf_nav_expanded_width'), String(normalized));
    const resizer = layout.querySelector('.shelves-resizer');
    if (resizer) resizer.setAttribute('aria-valuenow', String(normalized));
    updateProfileShelfOverflow(layout);
}

function setProfileShelfCollapsed(collapsed) {
    const layout = document.querySelector('.shelves-layout');
    if (!layout || layout.dataset.placement === 'top' || layout.classList.contains('is-compact') === collapsed) return;
    const expandedWidth = Math.max(120, clampProfileShelfWidth(localStorage.getItem(getProfileStorageKey('shelf_nav_expanded_width'))));
    const width = collapsed ? PROFILE_SHELF_WIDTH_MIN : expandedWidth;
    const finishScrollSpace = reserveProfileScrollSpace(layout);
    applyProfileShelfWidth(width);
    layout.getBoundingClientRect();
    finishScrollSpace();
    void persistProfileShelfWidth(width);
}

function toggleProfileShelfCollapsed() {
    const layout = document.querySelector('.shelves-layout');
    if (layout) setProfileShelfCollapsed(!layout.classList.contains('is-compact'));
}

async function persistProfileShelfWidth(width) {
    const normalized = clampProfileShelfWidth(width);
    profileShelfWidthRevision++;
    localStorage.setItem(getProfileStorageKey('shelf_nav_width'), String(normalized));
    try {
        await apiPostRequest('updateProfilePreferences', { shelf_nav_width: normalized });
    } catch (error) {
        console.warn('Ширина полок сохранена только на этом устройстве:', error);
    }
}

function setupProfileShelfResizer() {
    const layout = document.querySelector('.shelves-layout');
    const resizer = layout?.querySelector('.shelves-resizer');
    if (!layout || !resizer) return;
    let currentWidth = clampProfileShelfWidth(parseFloat(getComputedStyle(layout).getPropertyValue('--shelf-nav-width')));

    const finishResize = event => {
        if (!resizer.hasPointerCapture?.(event.pointerId)) return;
        resizer.releasePointerCapture(event.pointerId);
        layout.classList.remove('is-resizing');
        persistProfileShelfWidth(currentWidth);
    };

    resizer.addEventListener('pointerdown', event => {
        event.preventDefault();
        currentWidth = clampProfileShelfWidth(parseFloat(getComputedStyle(layout).getPropertyValue('--shelf-nav-width')));
        resizer.setPointerCapture(event.pointerId);
        layout.classList.add('is-resizing');
    });
    resizer.addEventListener('pointermove', event => {
        if (!resizer.hasPointerCapture?.(event.pointerId)) return;
        const rect = layout.getBoundingClientRect();
        const availableMax = Math.max(PROFILE_SHELF_WIDTH_MIN, Math.min(PROFILE_SHELF_WIDTH_MAX, rect.width - 180));
        currentWidth = Math.round(Math.min(availableMax, Math.max(PROFILE_SHELF_WIDTH_MIN, event.clientX - rect.left)));
        applyProfileShelfWidth(currentWidth);
    });
    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);
    resizer.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        currentWidth = clampProfileShelfWidth(parseFloat(getComputedStyle(layout).getPropertyValue('--shelf-nav-width')));
        currentWidth = clampProfileShelfWidth(currentWidth + (event.key === 'ArrowRight' ? 12 : -12));
        applyProfileShelfWidth(currentWidth);
        persistProfileShelfWidth(currentWidth);
    });
}

async function getInitialProfileShelfWidth() {
    const locallySaved = clampProfileShelfWidth(localStorage.getItem(getProfileStorageKey('shelf_nav_width')));
    const revision = profileShelfWidthRevision;
    const storageKey = getProfileStorageKey('shelf_nav_width');
    try {
        const response = await apiRequest('getProfilePreferences', {}, true);
        if (revision !== profileShelfWidthRevision || storageKey !== getProfileStorageKey('shelf_nav_width')) {
            return clampProfileShelfWidth(localStorage.getItem(getProfileStorageKey('shelf_nav_width')));
        }
        if (response.success && response.synced && response.preferences?.shelf_nav_width) {
            const remoteWidth = clampProfileShelfWidth(response.preferences.shelf_nav_width);
            localStorage.setItem(getProfileStorageKey('shelf_nav_width'), String(remoteWidth));
            return remoteWidth;
        }
    } catch (error) {
        console.warn('Используется локальная ширина полок:', error);
    }
    return revision === profileShelfWidthRevision && storageKey === getProfileStorageKey('shelf_nav_width')
        ? locallySaved : clampProfileShelfWidth(localStorage.getItem(getProfileStorageKey('shelf_nav_width')));
}

async function switchProfileTab(button, tabName) {
    document.querySelectorAll('.profile-page .tab-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    const libraryControls = document.querySelector('.profile-library-controls');
    if (libraryControls) libraryControls.hidden = tabName !== 'shelves';

    const contentContainer = document.querySelector('.reading-lists-container');
    contentContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    if (tabName === 'shelves') {
        // Вызываем ВАШУ существующую функцию
        await loadAndRenderReadingLists();
    } else if (tabName === 'created') {
        // Вызываем нашу новую функцию
        await renderProfileCreatedNovels();
    }
}

async function renderProfileCreatedNovels() {
    const container = document.querySelector('.reading-lists-container');
    const requestId = ++profileLibraryRequest;
    try {
        const response = await apiRequest('getMyCreatedNovels', {});
        if (requestId !== profileLibraryRequest || !container?.isConnected) return;
        if (!response.success) throw new Error(response.error);

        const { novels } = response;
        const canCreate = ['creator', 'admin', 'owner'].includes(STATE.currentUser?.role);
        const actions = canCreate ? `<div class="profile-created-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="navigateTo('add-novel')">Добавить новеллу</button>
        </div>` : '';
        const content = novels.length
            ? renderNovelCollection(novels, 'profile-created-novels')
            : `<div class="profile-empty-state">${renderUiIcon('library')}<h3>Созданных новелл пока нет</h3></div>`;
        container.innerHTML = actions + content;
    } catch (error) {
        if (requestId !== profileLibraryRequest || !container?.isConnected) return;
        container.innerHTML = `<div class="profile-empty-state"><h3>Не удалось загрузить новеллы</h3><p>${escapeHtml(error.message)}</p><button class="btn btn-secondary btn-sm" onclick="renderProfileCreatedNovels()">Попробовать снова</button></div>`;
    }
}

async function loadAndRenderReadingLists() {
    const container = document.querySelector('.reading-lists-container');
    if (!container) return;
    const requestId = ++profileLibraryRequest;
    const localShelfWidth = clampProfileShelfWidth(localStorage.getItem(getProfileStorageKey('shelf_nav_width')));
    const placement = getProfileShelfPlacement();
    const isCompactShelfNav = placement === 'side' && localShelfWidth <= 104;
    const gridClass = getNovelGridClassName('shelves-content', activeProfileShelfView);

    // Сразу показываем скелетоны, пока грузятся данные
    container.innerHTML = `
        <section class="profile-shelves profile-shelves-skeleton" aria-hidden="true">
            <div class="shelves-layout ${isCompactShelfNav ? 'is-compact' : ''}" data-placement="${placement}" style="--shelf-nav-width: ${localShelfWidth}px">
                <nav class="shelves-nav"><div class="shelf-nav-items">
                    ${Array.from({ length: Object.keys(PROFILE_SHELF_TYPES).length }, () => `
                        <div class="shelf-nav-btn">
                            <span class="shelf-nav-icon skeleton skeleton-shelf-icon"></span>
                            <span class="shelf-nav-label skeleton skeleton-shelf-label"></span>
                            <span class="shelf-count skeleton skeleton-shelf-count"></span>
                        </div>
                    `).join('')}
                </div></nav>
                <div class="shelves-resizer"></div>
                <div class="shelves-main">
                    <div class="${gridClass}">
                        ${Array(6).fill(null).map(() => renderShelfSkeletonCard()).join('')}
                    </div>
                </div>
            </div>
        </section>
    `;

    try {
        const syncedShelfWidth = getInitialProfileShelfWidth();
        const response = await apiRequest('getReadingLists', {}, true);
        if (requestId !== profileLibraryRequest || !container.isConnected) return;
        if (!response.success) throw new Error(response.error);

        const { lists } = response;
        window.userShelves = lists;
        profileShelfLists = lists;
        const savedSort = localStorage.getItem(getProfileStorageKey('shelf_sort'));
        activeProfileShelfSort = PROFILE_SHELF_SORTS.has(savedSort) ? savedSort : 'added_desc';

        const navHtml = Object.entries(PROFILE_SHELF_TYPES).map(([type, shelf], index) => {
            const count = getProfileShelfItems(type).length;
            return `<button class="shelf-nav-btn ${index === 0 ? 'active' : ''}"
                            type="button" data-shelf-type="${type}" data-count="${count}" onclick="switchShelfView('${type}')"
                            aria-pressed="${index === 0}" aria-label="${escapeHtml(shelf.title)}: ${count}" title="${escapeHtml(shelf.title)}">
                        <span class="shelf-nav-icon" aria-hidden="true">${renderUiIcon(shelf.icon)}</span>
                        <span class="shelf-nav-label">${escapeHtml(shelf.title)}</span>
                        <span class="shelf-count">${count}</span>
                    </button>`;
        }).join('');

        container.innerHTML = `
            <section class="profile-shelves" aria-label="Мои книжные полки">
                <div class="shelves-layout" data-placement="${getProfileShelfPlacement()}" style="--shelf-nav-width: ${localShelfWidth}px">
                    <nav class="shelves-nav" aria-label="Книжные полки">
                        <div class="shelf-nav-header"><span class="shelf-nav-heading">Полки</span><button class="shelf-nav-toggle" type="button" onclick="toggleProfileShelfCollapsed()" aria-label="Свернуть названия полок" aria-expanded="true">${renderUiIcon('chevron-down')}</button></div>
                        <div class="shelf-nav-items">${navHtml}</div>
                    </nav>
                    <div class="shelves-resizer" role="separator" tabindex="0" aria-label="Изменить ширину списка полок" aria-orientation="vertical" aria-valuemin="${PROFILE_SHELF_WIDTH_MIN}" aria-valuemax="${PROFILE_SHELF_WIDTH_MAX}" aria-valuenow="${localShelfWidth}"></div>
                    <div class="shelves-main">
                        <div class="shelves-content-tools">
                            <div class="active-shelf-heading"><h2 id="active-shelf-title"></h2><span id="active-shelf-count" aria-live="polite"></span></div>
                            <label class="profile-shelf-search">${renderUiIcon('search')}<input id="profile-shelf-search" type="search" placeholder="Найти на полке" aria-label="Поиск на выбранной полке" value="${escapeHtml(profileShelfSearch)}" oninput="searchProfileShelves(this.value)"></label>
                        </div>
                        <div class="${getNovelGridClassName('shelves-content', activeProfileShelfView)}"></div>
                    </div>
                </div>
            </section>
        `;
        applyProfileShelfWidth(localShelfWidth);
        renderActiveProfileShelf();
        setupProfileShelfResizer();
        setupProfileShelfOverflow();
        syncedShelfWidth.then(width => {
            if (requestId === profileLibraryRequest && container.isConnected) applyProfileShelfWidth(width);
        });
    } catch (error) {
        if (requestId !== profileLibraryRequest || !container.isConnected) return;
        container.innerHTML = `<div class="profile-empty-state"><h3>Полки пока не загрузились</h3><p>${escapeHtml(error.message)}</p><button class="btn btn-secondary btn-sm" onclick="loadAndRenderReadingLists()">Попробовать снова</button></div>`;
    }
}

async function handleAddToReadingList(novelId, listType) {
    event.preventDefault(); // Оставляем это, чтобы ссылка не перезагружала сразу
    if (!STATE.currentUser) {
        showToast('Для этого действия нужно войти', 'warning');
        return;
    }

    try {
        const response = await apiPostRequest('addToReadingList', {
            novel_id: novelId,
            list_type: listType
        });
        if (!response.success) throw new Error(response.error);

        clearCache(); // Очищаем кэш на всякий случай

        // --- ДОБАВЛЕНО: Перезагрузка через 1 секунду ---
        setTimeout(() => location.reload(), 1000);
        // ---------------------------------------------

    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    }
    // finally блок не нужен, т.к. мы уходим на перезагрузку
}

async function handleRemoveFromReadingList(novelId) {
    event.preventDefault(); // Оставляем
    if (!STATE.currentUser) {
        showToast('Для этого действия нужно войти', 'warning');
        return;
    }

    // Модальное окно подтверждения остается без изменений
    showConfirmModal(
        'Убрать с полок?',
        'Вы уверены, что хотите убрать эту новеллу со всех своих книжных полок?',
        async () => {
            try {
                const response = await apiPostRequest('removeFromReadingList', { novel_id: novelId });
                if (!response.success) throw new Error(response.error);

                clearCache();

                // --- ДОБАВЛЕНО: Перезагрузка через 1 секунду ---
                setTimeout(() => location.reload(), 1000);
                // ---------------------------------------------

            } catch (error) {
                showToast('Ошибка: ' + error.message, 'error');
            }
            // finally блок не нужен
        }
    );
}

async function handleShareNovel(novelId) {
    const currentNovel = window.currentNovelShareData;
    if (currentNovel && String(currentNovel.novel_id) === String(novelId)) {
        renderShareModal(currentNovel);
        return;
    }

    showLoading(true, { title: 'Подготовка ссылки...' });
    try {
        const response = await apiRequest('getNovel', { id: novelId }, true);
        if (!response.success) throw new Error(response.error);

        response.novel.can_manage_access = checkUserPermission('edit', response.novel);
        renderShareModal(response.novel);
    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderShareModal(novel) {
    const existingModal = document.getElementById('share-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.className = 'modal show visible share-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'share-modal-title');

    const useSlug = (novel.access_type === 'link_only' || novel.access_type === 'private') && novel.slug;
    const linkIdentifier = useSlug ? novel.slug : novel.novel_id;
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.hash = '';
    shareUrl.searchParams.set('page', 'novel-details');
    shareUrl.searchParams.set('id', linkIdentifier);

    const accessTypes = {
        public: {
            label: 'Публичная новелла',
            note: 'Ссылку сможет открыть любой пользователь.',
            icon: 'globe'
        },
        link_only: {
            label: 'Доступ по ссылке',
            note: 'Новеллу увидят те, кому вы отправите ссылку.',
            icon: 'link'
        },
        private: {
            label: 'Закрытый доступ',
            note: 'Ссылка откроется только у пользователей с разрешением.',
            icon: 'lock'
        }
    };
    const accessInfo = accessTypes[novel.access_type] || accessTypes.public;
    const canManageAccess = Boolean(novel.can_manage_access ?? checkUserPermission('edit', novel));
    const safeTitle = escapeHtml(novel.title || 'Новелла');
    const safeShareUrl = escapeHtml(shareUrl.toString());

    window.currentShareNovelData = {
        novelId: novel.novel_id,
        title: novel.title || 'Новелла',
        url: shareUrl.toString()
    };

    modal.innerHTML = `
        <div class="modal-content share-dialog">
            <button class="share-close" type="button" onclick="closeShareModal()" aria-label="Закрыть">
                ${renderUiIcon('close')}
            </button>

            <section class="share-panel active" data-share-panel="share">
                <header class="share-header">
                    <span class="share-kicker">Поделиться новеллой</span>
                    <h2 id="share-modal-title">${safeTitle}</h2>
                </header>

                <div class="share-visibility">
                    <span class="share-visibility-icon">${renderUiIcon(accessInfo.icon)}</span>
                    <span>
                        <strong>${accessInfo.label}</strong>
                        <small>${accessInfo.note}</small>
                    </span>
                </div>

                <div class="share-actions-grid">
                    <button type="button" class="share-action share-action-primary" onclick="shareNovelViaSystem()">
                        ${renderUiIcon('share')}
                        <span>Отправить</span>
                    </button>
                    <button type="button" class="share-action" onclick="copyShareLink()">
                        ${renderUiIcon('copy')}
                        <span>Копировать ссылку</span>
                    </button>
                </div>

                <div class="share-link-preview" title="${safeShareUrl}">
                    ${renderUiIcon('link')}
                    <span>${safeShareUrl}</span>
                </div>

                ${canManageAccess ? `
                    <button type="button" class="share-settings-link" onclick="openShareAccessSettings()">
                        ${renderUiIcon('lock')}
                        <span>
                            <strong>Настройки доступа</strong>
                            <small>Читатели, редакторы и разрешения</small>
                        </span>
                    </button>
                ` : ''}
            </section>

            <section class="share-panel share-access-panel" data-share-panel="access">
                <header class="share-access-header">
                    <button type="button" class="share-back" onclick="showSharePanel('share')" aria-label="Вернуться к отправке ссылки">
                        ${renderUiIcon('arrow-left')}
                    </button>
                    <span>
                        <span class="share-kicker">Новелла</span>
                        <h2>Настройки доступа</h2>
                    </span>
                </header>

                <p class="share-access-intro">Выберите пользователя и укажите, сможет ли он только читать новеллу или также редактировать её.</p>
                <div class="add-permission-form">
                    <input type="search" id="user-search-input-share" class="form-input" placeholder="Поиск по имени или email...">
                    <select id="permission-level-select" class="form-select">
                        <option value="read">Читатель</option>
                        <option value="edit">Редактор</option>
                    </select>
                    <button class="btn btn-primary" onclick="grantUserPermission('${novel.novel_id}')">Выдать доступ</button>
                </div>
                <div id="permissions-list">
                    <div class="loading-spinner"><div class="spinner"></div></div>
                </div>
            </section>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
        if (event.target === modal) closeShareModal();
    });

    const escapeHandler = event => {
        if (event.key === 'Escape') closeShareModal();
    };
    modal._escapeHandler = escapeHandler;
    document.addEventListener('keydown', escapeHandler);
    modal.querySelector('.share-close')?.focus();
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    if (modal._escapeHandler) document.removeEventListener('keydown', modal._escapeHandler);
    modal.remove();
}

function showSharePanel(panelName) {
    const modal = document.getElementById('share-modal');
    if (!modal) return;

    modal.querySelectorAll('[data-share-panel]').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.sharePanel === panelName);
    });
    modal.querySelector('.share-dialog')?.classList.toggle('access-view', panelName === 'access');
}

function openShareAccessSettings() {
    const modal = document.getElementById('share-modal');
    const shareData = window.currentShareNovelData;
    if (!modal || !shareData) return;

    showSharePanel('access');
    if (modal.dataset.accessLoaded === 'true') return;

    modal.dataset.accessLoaded = 'true';
    setupUserSearchAutocomplete('user-search-input-share');
    loadNovelPermissions(shareData.novelId);
}

async function copyShareLink() {
    const shareData = window.currentShareNovelData;
    if (!shareData?.url) return;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareData.url);
        } else {
            const input = document.createElement('textarea');
            input.value = shareData.url;
            input.setAttribute('readonly', '');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }
        showToast('Ссылка скопирована', 'success');
    } catch (error) {
        showToast('Не удалось скопировать ссылку', 'error');
    }
}

async function shareNovelViaSystem() {
    const shareData = window.currentShareNovelData;
    if (!shareData?.url) return;

    if (!navigator.share) {
        await copyShareLink();
        return;
    }

    try {
        await navigator.share({
            title: shareData.title,
            text: `Новелла «${shareData.title}»`,
            url: shareData.url
        });
    } catch (error) {
        if (error?.name !== 'AbortError') {
            showToast('Не удалось открыть меню отправки', 'error');
        }
    }
}

function setupUserSearchAutocomplete(inputId) {
    const searchInput = document.getElementById(inputId);
    if (!searchInput) return;

    let autocompleteList = null;
    let debounceTimer = null;

    searchInput.addEventListener('input', function() {
        const query = this.value.trim();

        if (autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        if (query.length < 2) return;

        debounceTimer = setTimeout(async () => {
            try {
                // Используем API для поиска пользователей
                const response = await apiRequest('searchUserForPermission', { query });
                if (searchInput.value.trim() !== query) return; // Проверка актуальности
                if (!response.success || response.users.length === 0) return;

                autocompleteList = document.createElement('div');
                autocompleteList.className = 'autocomplete-list'; // Используем тот же класс
                autocompleteList.style.width = searchInput.offsetWidth + 'px';

                response.users.forEach(user => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerHTML = `
                        <div class="autocomplete-title">${highlightMatch(user.username, query)}</div>
                        ${user.email ? `<div class="autocomplete-author">${highlightMatch(user.email, query)}</div>` : ''}
                    `;
                    item.addEventListener('click', () => {
                        searchInput.value = user.email || user.username; // Подставляем email или имя
                        if (autocompleteList) autocompleteList.remove();
                        autocompleteList = null;
                    });
                    autocompleteList.appendChild(item);
                });

                searchInput.parentElement.appendChild(autocompleteList); // Добавляем список

            } catch (error) {
                console.error('Ошибка автодополнения пользователей:', error);
            }
        }, 300);
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && autocompleteList) {
            autocompleteList.remove();
            autocompleteList = null;
        }
    });
}

async function grantUserPermission(novelId) {
    const input = document.getElementById('user-search-input-share');
    const permissionSelect = document.getElementById('permission-level-select');
    const query = input.value.trim();
    const permission = permissionSelect.value;

    if (!query) {
        showToast('Введите имя или email пользователя', 'warning');
        return;
    }
    
    showLoading(true, { title: 'Поиск пользователя...' });
    try {
        const searchResponse = await apiRequest('searchUserForPermission', { query });
        if (!searchResponse.success || searchResponse.users.length === 0) {
            throw new Error('Пользователь не найден.');
        }
        
        const targetUser = searchResponse.users[0];
        
        const grantResponse = await apiPostRequest('grantPermission', {
            novelId,
            targetUserId: targetUser.user_id,
            permission
        });
        
        if (!grantResponse.success) throw new Error(grantResponse.error);
        
        showToast(`Доступ «${permission}» выдан пользователю ${targetUser.username}`, 'success');
        loadNovelPermissions(novelId);
        input.value = '';

    } catch (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function copyToClipboard(selector) {
    const input = document.querySelector(selector);
    if (input) {
        input.select();
        document.execCommand('copy');
        showToast('Ссылка скопирована!', 'success');
    }
}

async function loadNovelPermissions(novelId) {
    const listContainer = document.getElementById('permissions-list');
    if (!listContainer) return;
    try {
        const response = await apiRequest('getNovelPermissions', { novelId });
        if (!response.success) throw new Error(response.error);
        if (!document.body.contains(listContainer)) return;

        if (response.permissions.length === 0) {
            listContainer.innerHTML = '<p class="text-muted">Вы еще никому не выдали доступ.</p>';
            return;
        }

        listContainer.innerHTML = response.permissions.map(p => `
            <div class="permission-item">
                <span>${escapeHtml(p.username)} (${escapeHtml(p.email || 'нет email')}) - <i>${p.permission}</i></span>
                <button class="btn btn-sm btn-danger" onclick="revokeUserPermission('${novelId}', ${p.user_id})">Отозвать</button>
            </div>
        `).join('');

    } catch (error) {
        listContainer.innerHTML = `<p class="text-danger">Ошибка: ${error.message}</p>`;
    }
}

async function revokeUserPermission(novelId, userId) {
    showConfirmModal('Отозвать доступ?', 'Вы уверены?', async () => {
        showLoading(true, { title: 'Отзыв доступа...' });
        try {
            const response = await apiPostRequest('revokePermission', { novelId, targetUserId: userId });
            if (!response.success) throw new Error(response.error);
            showToast('Доступ отозван', 'success');
            loadNovelPermissions(novelId);
        } catch (error) {
            showToast('Ошибка: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
}
