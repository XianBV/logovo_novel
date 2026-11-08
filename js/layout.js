/* Единый комфортный диапазон всех книжных сеток; на узких экранах остаются две колонки. */
const NOVEL_GRID_CARD_SIZE = Object.freeze({ min: 150, max: 200 });

function getNovelGridColumnCount(width, gap = 16, cardWidth = NOVEL_GRID_CARD_SIZE.min) {
    return Math.max(2, Math.floor((width + gap) / (cardWidth + gap)));
}

// Одна схема для каталога, полок и созданных новелл: минимум две колонки,
// дополнительные появляются по ширине области. Последний ряд остаётся слева.
function getNovelGridLayout(width, gap = 16) {
    const columns = getNovelGridColumnCount(width, gap);
    return { columns, cardWidth: Math.min(NOVEL_GRID_CARD_SIZE.max, (width - gap * (columns - 1)) / columns) };
}

function setupNovelGridSizing() {
    if (typeof ResizeObserver !== 'function') return;
    const selector = '.novels-grid';
    const observed = new Set();
    let frame = 0;
    const update = grid => {
        if (grid.classList.contains('list-view')) return;
        const width = grid.clientWidth;
        if (!width) return;
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        const layout = getNovelGridLayout(width, gap);
        const template = `repeat(${layout.columns}, minmax(0, ${NOVEL_GRID_CARD_SIZE.max}px))`;
        if (grid.style.getPropertyValue('--novel-grid-template') !== template) {
            grid.style.setProperty('--novel-grid-template', template);
        }
    };
    const resizeObserver = new ResizeObserver(entries => entries.forEach(entry => update(entry.target)));
    const refresh = () => {
        frame = 0;
        observed.forEach(grid => {
            if (!grid.isConnected) { resizeObserver.unobserve(grid); observed.delete(grid); }
        });
        document.querySelectorAll(selector).forEach(grid => {
            if (!observed.has(grid)) { observed.add(grid); resizeObserver.observe(grid); }
            update(grid);
        });
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(refresh);
    };
    new MutationObserver(records => {
        if (records.some(record => record.type === 'childList' ||
            record.target.matches?.(selector))) schedule();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    refresh();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNovelGridSizing, { once: true });
else setupNovelGridSizing();
