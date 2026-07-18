/**
 * i18n-слой Orchard Peaks (Проход Ж.1): RU/EN, без внешних зависимостей.
 *
 * ВЫБОР ЛОКАЛИ (по порядку приоритета):
 *   1) localStorage-override 'orchardPeaks.locale' ('ru' | 'en') — выбор игрока;
 *   2) navigator.language: ru* → ru, иначе en;
 *   3) en — дефолт (основной язык листинга — английский, store-listing.md).
 *
 * ПРИМЕНЕНИЕ СМЕНЫ ЯЗЫКА — ПЕРЕЗАГРУЗКА СТРАНИЦЫ (осознанное решение):
 * строки живут и в статическом каркасе index.html, и в лениво смонтированных
 * оверлеях (магазин, оверлей рекламы), и в кэшированных текстах кнопок.
 * «Живая» смена потребовала бы ре-рендера каждого экрана и повторного
 * применения статического DOM — хрупко и легко упустить экран. Поэтому
 * MetaUi (вкладка «Настройки») после setLocale() вызывает location.reload():
 * гарантированно консистентный UI, сейвы в localStorage не затрагиваются.
 *
 * Словари: ru.ts — канонический список ключей (TranslationKey = keyof typeof ru),
 * en.ts — `satisfies Record<TranslationKey, string>`: полнота обеих локалей
 * гарантируется компилятором; рантайм-дубль — tests/i18n.test.ts.
 */
import { ru, type TranslationKey } from './ru';
import { en } from './en';

export type { TranslationKey } from './ru';

export type Locale = 'ru' | 'en';

/** Ключ localStorage с override-локалью (префикс игры — как у сейвов). */
export const LOCALE_KEY = 'orchardPeaks.locale';

/** Параметры подстановки в плейсхолдеры {name}. */
export type TParams = Record<string, string | number>;

const DICTS: Record<Locale, Record<TranslationKey, string>> = { ru, en };

/**
 * Чистое разрешение локали (тестируется без DOM):
 * override → navigator.language → en.
 */
export function detectLocale(stored: string | null, navLang: string | null): Locale {
  if (stored === 'ru' || stored === 'en') return stored;
  if (navLang !== null && navLang.toLowerCase().startsWith('ru')) return 'ru';
  return 'en';
}

function readStoredLocale(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_KEY) : null;
  } catch {
    return null; // приватный режим — работаем по navigator/дефолту
  }
}

function readNavigatorLanguage(): string | null {
  try {
    return typeof navigator !== 'undefined' ? navigator.language : null;
  } catch {
    return null;
  }
}

let current: Locale = detectLocale(readStoredLocale(), readNavigatorLanguage());

export function getLocale(): Locale {
  return current;
}

/**
 * Сменить локаль: пишет override и переключает текущую. Перезагрузку страницы
 * (см. шапку) выполняет вызывающий UI — так setLocale остаётся тестируемой.
 */
export function setLocale(locale: Locale): void {
  current = locale;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* приватный режим — локаль живёт до перезагрузки */
  }
}

function interpolate(s: string, params?: TParams): string {
  if (params === undefined) return s;
  return s.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/** Перевод по статическому ключу (полнота гарантирована компилятором). */
export function t(key: TranslationKey, params?: TParams): string {
  return interpolate(DICTS[current][key], params);
}

/**
 * Перевод по ДИНАМИЧЕСКОМУ ключу (строки конфигов: zone.*, order.*, iap.*,
 * placement.*, mission.*, booster.*, plan.*) с фолбэком на строку конфига.
 * Покрытие таких ключей в обеих локалях проверяет tests/i18n.test.ts.
 */
export function tDyn(key: string, fallback: string, params?: TParams): string {
  const dict = DICTS[current] as Record<string, string | undefined>;
  return interpolate(dict[key] ?? fallback, params);
}
