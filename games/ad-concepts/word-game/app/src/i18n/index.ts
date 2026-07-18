/**
 * i18n-слой WordGrove (Проход Ж.1) — БЕЗ внешних зависимостей.
 *
 * Словари: ru.ts (источник истины по ключам) + en.ts (`satisfies` гарантирует
 * полноту). t(key, params) подставляет плейсхолдеры вида {имя}.
 *
 * Выбор локали (resolveLocale):
 *   1) override из localStorage (ключ 'wordgrove.locale' — префикс игры);
 *   2) navigator.language: ru* → ru, иначе en;
 *   3) fallback — en.
 *
 * ПРИМЕНЕНИЕ СМЕНЫ ЯЗЫКА — ПЕРЕЗАГРУЗКОЙ СТРАНИЦЫ (документированный выбор):
 * большая часть UI рендерит строки один раз при монтировании (ShopUi.mount,
 * статика index.html, инъекции оверлеев), и «горячая» смена потребовала бы
 * ре-рендер-шину по всем экранам. setLocale() только персистит выбор и меняет
 * текущую локаль в памяти; переключатель в мета-экране (MetaUi) вызывает
 * location.reload() — просто и надёжно, сейвы не затрагиваются.
 *
 * Модуль безопасен в среде без DOM (vitest/node): localStorage и navigator
 * читаются под guard'ами, по умолчанию — 'en'.
 */
import { EN } from './en';
import { RU, type TranslationKey } from './ru';

export type { TranslationKey };

export type Locale = 'ru' | 'en';

/** Ключ override-локали в localStorage — префикс игры, как у сейвов. */
export const LOCALE_STORAGE_KEY = 'wordgrove.locale';

const DICTS: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  ru: RU,
  en: EN
};

/** Чистая функция выбора локали (тестируется без DOM). */
export function resolveLocale(stored: string | null, navLang: string | undefined): Locale {
  if (stored === 'ru' || stored === 'en') return stored;
  if (typeof navLang === 'string' && navLang.toLowerCase().startsWith('ru')) return 'ru';
  return 'en';
}

/** Прочитать окружение браузера (guard'ы — модуль работает и в node). */
function detectLocale(): Locale {
  let stored: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    /* приватный режим — работаем без override */
  }
  const navLang = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return resolveLocale(stored, navLang);
}

let current: Locale = detectLocale();

export function getLocale(): Locale {
  return current;
}

/**
 * Установить локаль: персист в localStorage + смена в памяти.
 * ПЕРЕЗАГРУЗКУ страницы (применение к уже отрисованному UI) делает вызывающий
 * (MetaUi) — см. шапку модуля.
 */
export function setLocale(locale: Locale): void {
  current = locale;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* приватный режим — локаль живёт до перезагрузки */
  }
}

/** Подстановка плейсхолдеров {имя}; неизвестные остаются как есть. */
function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/** Перевод ключа в текущей локали с параметрами. */
export function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string {
  return interpolate(DICTS[current][key], params);
}

/**
 * Плюрализация счётного слова: ru — one/few/many (1 день / 2 дня / 5 дней,
 * порт plural() из прототипа meta.js), en — one/other (1 day / 2 days).
 * Возвращает ФОРМУ СЛОВА (число подставляет вызывающий).
 */
export function tPlural(n: number, one: TranslationKey, few: TranslationKey, many: TranslationKey): string {
  if (current === 'en') return t(n === 1 ? one : many);
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return t(one);
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return t(few);
  return t(many);
}
