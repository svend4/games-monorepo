/**
 * Тема оформления Block Surge (Проход Ж.1, контраст-проход по фидбеку
 * владельца «фон слишком тёмный»). ВСЕ числа цветов фона/панелей/вторичного
 * текста — здесь, в одном модуле; ни сцена, ни index.html их не дублируют.
 *
 * Два пресета яркости фона (тумблер в настройках меты, 07 гл.):
 *  - 'dark'    — жанровая тёмная тема, но с поднятой читаемостью: пустые
 *    клетки поля заметно светлее фона и с рамкой, панели HUD/дока на ступень
 *    светлее прежних, вторичный текст светлее;
 *  - 'lighter' — та же схема ещё на ступень светлее (для дешёвых LCD, 07 §4).
 * Неоновые акценты (циан/жёлтый/зелёный) не трогаем — они в коде сцены и CSS.
 *
 * Применение БЕЗ перезагрузки: канвас читает theme() каждый кадр, DOM — через
 * CSS-переменные (applyThemeCss), подписчики (сцена) — через onThemeChanged.
 * Персист — localStorage `blocksurge_theme` (префикс игры, как прочие сейвы).
 */

export type ThemeMode = 'dark' | 'lighter';

export const THEME_KEY = 'blocksurge_theme';

/** Палитра пресета: числа — для Phaser Graphics, строки — для текста/CSS. */
export interface ThemePalette {
  /* ------- канвас партии (Phaser) ------- */
  /** Фон канваса (камера). */
  canvasBg: number;
  /** Подложка поля 8×8. */
  boardPanel: number;
  /** Пустая клетка поля — явно светлее фона (контраст-проход, пункт 1). */
  cellEmpty: number;
  /** Рамка пустой клетки. */
  cellEmptyBorder: number;
  /** Гнездо фигуры в доке. */
  dockSlot: number;
  /** Рамка гнезда дока (контраст-проход, пункт 2). */
  dockSlotBorder: number;
  /** Гнездо кристальной бомбы. */
  bombSlot: number;
  /** Трек шкалы «Прилива». */
  surgeTrack: number;
  /** Вторичный текст канваса (подписи HUD) — светлее прежнего (пункт 3). */
  textSecondary: string;
  /** Приглушённый текст канваса (подсказки пустого гнезда бомбы). */
  textDim: string;
  /* ------- DOM (CSS-переменные) ------- */
  css: {
    /** --bg: фон страницы. */
    bg: string;
    /** --panel: панели HUD/дока (coinBox, бустер-бар, баннер). */
    panel: string;
    /** --panel-hover */
    panelHover: string;
    /** --panel-border */
    panelBorder: string;
    /** --section-bg: секции мета-экрана. */
    sectionBg: string;
    /** --section-border */
    sectionBorder: string;
    /** --card-bg: карточки списков (узлы, миссии, SKU). */
    cardBg: string;
    /** --card-border */
    cardBorder: string;
    /** --text-secondary */
    textSecondary: string;
    /** --text-tertiary */
    textTertiary: string;
    /** --screen-top / --screen-bottom: градиент полноэкранных оверлеев. */
    screenTop: string;
    screenBottom: string;
  };
}

export const THEMES: Readonly<Record<ThemeMode, ThemePalette>> = {
  dark: {
    canvasBg: 0x0e1117,
    boardPanel: 0x0f1520,
    cellEmpty: 0x222c3e,
    cellEmptyBorder: 0x3a4a66,
    dockSlot: 0x1a2231,
    dockSlotBorder: 0x33415c,
    bombSlot: 0x14293a,
    surgeTrack: 0x222c3e,
    textSecondary: '#9fadbf',
    textDim: '#55677e',
    css: {
      bg: '#0e1117',
      panel: '#1a2231',
      panelHover: '#232e42',
      panelBorder: '#33415c',
      sectionBg: '#151f2d',
      sectionBorder: '#2a3852',
      cardBg: '#131d2b',
      cardBorder: '#2e3c56',
      textSecondary: '#9fadbf',
      textTertiary: '#8493a6',
      screenTop: '#1a2534',
      screenBottom: '#0d121a'
    }
  },
  lighter: {
    canvasBg: 0x1a2230,
    boardPanel: 0x1c2635,
    cellEmpty: 0x2e3a50,
    cellEmptyBorder: 0x485874,
    dockSlot: 0x27324a,
    dockSlotBorder: 0x415270,
    bombSlot: 0x1e3850,
    surgeTrack: 0x2e3a50,
    textSecondary: '#aebccd',
    textDim: '#6b7f97',
    css: {
      bg: '#1a2230',
      panel: '#27324a',
      panelHover: '#303d5a',
      panelBorder: '#415270',
      sectionBg: '#212d40',
      sectionBorder: '#3c4e6c',
      cardBg: '#1e2a3d',
      cardBorder: '#3c4c6a',
      textSecondary: '#aebccd',
      textTertiary: '#93a3b6',
      screenTop: '#273549',
      screenBottom: '#161e2b'
    }
  }
};

/** Чистый парс сохранённого значения (тестируется без DOM): мусор → 'dark'. */
export function parseThemeMode(stored: string | null): ThemeMode {
  return stored === 'lighter' ? 'lighter' : 'dark';
}

function loadThemeMode(): ThemeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      return parseThemeMode(localStorage.getItem(THEME_KEY));
    }
  } catch {
    /* приватный режим */
  }
  return 'dark';
}

let mode: ThemeMode = loadThemeMode();

type ThemeListener = (palette: ThemePalette) => void;
const listeners = new Set<ThemeListener>();

export function themeMode(): ThemeMode {
  return mode;
}

/** Текущая палитра — канвас читает её каждый кадр (смена видна сразу). */
export function theme(): ThemePalette {
  return THEMES[mode];
}

/** Прокинуть палитру в CSS-переменные DOM (index.html читает var(--...)). */
export function applyThemeCss(): void {
  if (typeof document === 'undefined') return;
  const c = theme().css;
  const s = document.documentElement.style;
  s.setProperty('--bg', c.bg);
  s.setProperty('--panel', c.panel);
  s.setProperty('--panel-hover', c.panelHover);
  s.setProperty('--panel-border', c.panelBorder);
  s.setProperty('--section-bg', c.sectionBg);
  s.setProperty('--section-border', c.sectionBorder);
  s.setProperty('--card-bg', c.cardBg);
  s.setProperty('--card-border', c.cardBorder);
  s.setProperty('--text-secondary', c.textSecondary);
  s.setProperty('--text-tertiary', c.textTertiary);
  s.setProperty('--screen-top', c.screenTop);
  s.setProperty('--screen-bottom', c.screenBottom);
}

/** Подписка на смену пресета (сцена перекрашивает статичные тексты/камеру). */
export function onThemeChanged(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Сменить пресет: персист + CSS сразу + уведомление подписчиков. */
export function setThemeMode(next: ThemeMode): void {
  mode = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, next);
  } catch {
    /* приватный режим — до перезагрузки поживёт в памяти */
  }
  applyThemeCss();
  for (const fn of listeners) fn(theme());
}
