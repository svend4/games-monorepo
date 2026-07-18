/**
 * I18N-слой Block Surge (Проход Ж.1): RU/EN без внешних зависимостей.
 *
 * Выбор локали (resolveLocale): override из localStorage (ключ
 * `blocksurge_locale` — тот же префикс игры, что и у остальных сейвов) →
 * navigator.language (ru* → ru, иначе en) → en.
 *
 * СМЕНА ЯЗЫКА — ЧЕРЕЗ ПЕРЕЗАГРУЗКУ СТРАНИЦЫ (осознанный выбор): Phaser-тексты
 * сцены и DOM-оверлеи (MetaUi/ShopUi/онбординг) создаются один раз при
 * монтировании; «живая» смена потребовала бы ре-рендер всех слоёв и повторную
 * привязку обработчиков. Reload проще и надёжнее: setLocale() персистит выбор,
 * вызывающий (MetaUi, кнопки RU/EN в настройках) делает location.reload(),
 * прогресс в localStorage не затрагивается.
 *
 * Полнота словарей гарантируется компилятором: TranslationKey выводится из
 * ru.ts, en.ts обязан `satisfies Record<TranslationKey, string>` (см. файлы
 * словарей) + дублирующий рантайм-тест в tests/i18n.test.ts.
 */
import { ru, type TranslationKey } from './ru';
import { en } from './en';

export type { TranslationKey } from './ru';

export type Locale = 'ru' | 'en';

/** Ключ localStorage с override локали (префикс игры, как blocksurge_meta). */
export const LOCALE_KEY = 'blocksurge_locale';

const DICTS: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = { ru, en };

/** Параметры подстановки: {name} в строке → params.name. */
export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Чистое разрешение локали (тестируется без DOM):
 * валидный override → он; navigator ru* → ru; иначе en.
 */
export function resolveLocale(stored: string | null, navigatorLanguage: string | undefined): Locale {
  if (stored === 'ru' || stored === 'en') return stored;
  if (navigatorLanguage !== undefined && navigatorLanguage.toLowerCase().startsWith('ru')) {
    return 'ru';
  }
  return 'en';
}

function detectLocale(): Locale {
  let stored: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') stored = localStorage.getItem(LOCALE_KEY);
  } catch {
    /* приватный режим — работаем без override */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return resolveLocale(stored, nav);
}

/* Локаль фиксируется на загрузке модуля (смена — через reload, см. шапку). */
let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Персист выбора локали. НЕ перерисовывает UI — вызывающий обязан сделать
 * location.reload() (задокументированный выбор, см. шапку файла).
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* приватный режим — до перезагрузки поживёт в памяти */
  }
}

/** Чистый перевод с явной локалью (для тестов и спецслучаев). */
export function translate(locale: Locale, key: TranslationKey, params?: TranslateParams): string {
  let s: string = DICTS[locale][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      s = s.split('{' + name + '}').join(String(value));
    }
  }
  return s;
}

/** Перевод в текущей локали — основной вход всего игрового UI. */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(currentLocale, key, params);
}
