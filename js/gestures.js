/* Жесты истории временно отключены. Здесь обрабатываются только полки. */
function getHorizontalGestureDirection(dx, dy, threshold = 64) {
    return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.6
        ? (dx > 0 ? 'right' : 'left') : null;
}

function isTopShelfNavigation(nav) {
    return nav?.closest?.('.shelves-layout')?.dataset?.placement === 'top';
}

let profileWheelTailActive = false;
let profileWheelTailTimer = null;
function suppressProfileWheelTail() {
    profileWheelTailActive = true;
    clearTimeout(profileWheelTailTimer);
    profileWheelTailTimer = setTimeout(() => { profileWheelTailActive = false; }, 240);
}

function consumeProfileWheelTail(event) {
    if (!profileWheelTailActive || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    suppressProfileWheelTail();
    return true;
}

function setupProfileShelfGestures() {
    let touch = null;
    let lastGestureAt = 0;
    let wheel = null;
    let wheelTimer;
    const excluded = 'input, textarea, select, [contenteditable], .chapter-editor, .modal, [role="dialog"], .shelves-resizer';
    const isBlocked = target => !target || target.closest(excluded) ||
        [...document.querySelectorAll('.modal, [role="dialog"]')].some(dialog =>
            dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden') ||
        window.getSelection()?.toString() || (typeof isRendering !== 'undefined' && isRendering);
    const perform = (direction, nav, wheelGesture = false) => {
        if (Date.now() - lastGestureAt < 650 || !nav?.isConnected || isTopShelfNavigation(nav) || typeof setProfileShelfCollapsed !== 'function') return;
        lastGestureAt = Date.now();
        if (wheelGesture) suppressProfileWheelTail();
        setProfileShelfCollapsed(direction === 'left');
    };
    document.addEventListener('touchstart', event => {
        touch = null;
        if (event.touches.length !== 1 || isBlocked(event.target)) return;
        const nav = event.target.closest('.shelves-nav');
        if (!nav || isTopShelfNavigation(nav) || Date.now() - lastGestureAt < 650) return;
        const point = event.touches[0];
        touch = { x: point.clientX, y: point.clientY, at: Date.now(), nav };
    }, { passive: true });
    document.addEventListener('touchmove', event => {
        if (!touch) return;
        if (event.touches.length !== 1) { touch = null; return; }
        const point = event.touches[0], dx = point.clientX - touch.x, dy = point.clientY - touch.y;
        const crossDominates = Math.abs(dy) > 14 && Math.abs(dy) >= Math.abs(dx);
        if (crossDominates) { touch = null; return; }
        const direction = getHorizontalGestureDirection(dx, dy, 10);
        if (direction && event.cancelable) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', event => {
        const gesture = touch;
        touch = null;
        if (!gesture || event.touches.length || Date.now() - gesture.at > 5000 || isBlocked(event.target)) return;
        const point = event.changedTouches[0];
        if (!point) return;
        const dx = point.clientX - gesture.x, dy = point.clientY - gesture.y;
        const direction = getHorizontalGestureDirection(dx, dy);
        if (direction) perform(direction, gesture.nav);
    }, { passive: true });
    document.addEventListener('touchcancel', () => { touch = null; }, { passive: true });

    // Capture продолжает поглощать инерцию, даже когда после изменения размера
    // под указателем уже находится другой участок страницы.
    document.addEventListener('wheel', event => {
        if (consumeProfileWheelTail(event)) return;
        if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || isBlocked(event.target)) return;
        const nav = event.target.closest('.shelves-nav');
        if (!nav || isTopShelfNavigation(nav)) return;
        const delta = event.deltaX;
        const cross = event.deltaY;
        if (Math.abs(delta) < 3 && Math.abs(cross) < 3) return;
        if (Math.abs(delta) <= Math.abs(cross) * 1.6) { wheel = null; clearTimeout(wheelTimer); return; }
        if (event.cancelable) event.preventDefault();
        if (Date.now() - lastGestureAt < 650) return;
        const sign = Math.sign(delta);
        if (!wheel || wheel.nav !== nav || wheel.sign !== sign) wheel = { distance: 0, sign, nav };
        wheel.distance += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerWidth : 1);
        clearTimeout(wheelTimer);
        if (Math.abs(wheel.distance) >= 100) {
            const direction = wheel.distance > 0 ? 'left' : 'right';
            wheel = null;
            perform(direction, nav, true);
            return;
        }
        wheelTimer = setTimeout(() => { wheel = null; }, 180);
    }, { passive: false, capture: true });
}

setupProfileShelfGestures();
