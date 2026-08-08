/* ==========================================
   ЛОГОВО НОВЕЛЛ — ЯДРО
   Глобальное состояние и базовая защита DOM
   ========================================== */

const ROLE_THEMES = {
    default: {
        owner: 'Владелец',
        admin: 'Администратор',
        creator: 'Создатель',
        reader: 'Читатель'
    },
    'сянься': {
        owner: 'Основатель Секты',
        admin: 'Старейшина Пика Наказаний',
        creator: 'Ученик Пика Искусств',
        reader: 'Ученик'
    },
    'фэнтези': {
        owner: 'Владыка',
        admin: 'Хранитель',
        creator: 'Летописец',
        reader: 'Странник'
    },
    'достопочтенный': {
        owner: 'Этот Достопочтенный',
        admin: 'Правая Рука',
        creator: 'Верный Слуга',
        reader: 'Проситель'
    },
    'смешная': {
        owner: 'Повелитель Копипасты',
        admin: 'Местный Цензор',
        creator: 'Графоман',
        reader: 'Заглянул на огонёк'
    }
};

const STATE = {
    novels: [],
    filteredNovels: [],
    config: {},
    tags: [],
    currentUser: null,
    currentPage: 1,
    itemsPerPage: 12,
    totalPages: 1,
    isInitialized: false,
    isSubmittingNovel: false,
    currentFilters: {
        language: '',
        era: '',
        perspective: '',
        orientation: '',
        originalStatus: '',
        translationStatus: '',
        chaptersMin: null,
        chaptersMax: null,
        wordsMin: null,
        wordsMax: null,
        includeTags: [],
        includeTagMode: 'any',
        excludeTags: [],
        excludeTagMode: 'any'
    },
    viewMode: 'grid',
    sortBy: 'title',
    sortOrder: 'asc',
    currentRoleTheme: 'default',
    isChapterEditMode: false,
    cache: {
        data: {},
        ttl: 5 * 60 * 1000
    }
};

let isRendering = false;
let isTelegramWidgetLoaded = false;

const PROTECTED_IDS = ['app', 'app-container', 'breadcrumbs'];
const originalRemove = Element.prototype.remove;

Element.prototype.remove = function removeProtectedElementSafely() {
    if (PROTECTED_IDS.includes(this.id)) {
        console.warn('Защита: попытка удалить', this.id);
        return;
    }

    originalRemove.call(this);
};

console.log('📦 core.js загружен');
