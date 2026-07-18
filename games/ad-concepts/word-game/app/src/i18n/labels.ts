/**
 * Метки для КОНФИГ-строк (Проход Ж.1): регионы/миссии/темы меты, SKU полки,
 * планы и перки подписки.
 *
 * Конфиги (meta/config.ts, monetize/config.ts) сознательно НЕ тронуты:
 * их русские строки остаются каноническими идентификаторами данных (сейвы,
 * аналитика и старые тесты работают 1:1). Локализуется только ОТОБРАЖЕНИЕ —
 * хелперы ниже мапят id/каноническую строку на типизированный ключ словаря
 * с fallback'ом на исходную строку (неизвестный id не роняет UI).
 */
import { t, type TranslationKey } from './index';

/* ------------------------------- Мета ------------------------------- */

const REGION_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  grove: 'region.grove',
  meadow: 'region.meadow'
};

/** Имя региона атласа по id (fallback — каноническое имя из конфига). */
export function regionName(id: string, fallback: string): string {
  const key = REGION_NAME_KEYS[id] as TranslationKey | undefined;
  return key === undefined ? fallback : t(key);
}

const MISSION_TEXT_KEYS: Readonly<Record<string, TranslationKey>> = {
  bonus5: 'mission.bonus5',
  levels3: 'mission.levels3',
  nohint: 'mission.nohint'
};

/** Текст daily-миссии по id (fallback — текст из конфига). */
export function missionText(id: string, fallback: string): string {
  const key = MISSION_TEXT_KEYS[id] as TranslationKey | undefined;
  return key === undefined ? fallback : t(key);
}

/** Канонические РУ-темы дня (meta/config.ts THEMES) → ключи словаря.
 * Канон остаётся и analytics-параметром theme_id (поведение 1:1). */
const THEME_KEYS: Readonly<Record<string, TranslationKey>> = {
  'Кухня': 'theme.kitchen',
  'Осень': 'theme.autumn',
  'Кино 80-х': 'theme.cinema80s',
  'Природа': 'theme.nature',
  'Город': 'theme.city',
  'Музыка': 'theme.music',
  'Путешествия': 'theme.travel'
};

/** Отображаемая тема дня (fallback — каноническая строка). */
export function themeLabel(theme: string): string {
  const key = THEME_KEYS[theme] as TranslationKey | undefined;
  return key === undefined ? theme : t(key);
}

/* ------------------------------ Магазин ------------------------------ */

const SKU_TITLE_KEYS: Readonly<Record<string, TranslationKey>> = {
  coins_handful: 'sku.coins_handful.title',
  coins_starter: 'sku.coins_starter.title',
  coins_pouch: 'sku.coins_pouch.title',
  coins_chest: 'sku.coins_chest.title',
  coins_chest_t: 'sku.coins_chest_t.title',
  coins_region: 'sku.coins_region.title',
  coins_master: 'sku.coins_master.title'
};

const SKU_DESC_KEYS: Readonly<Record<string, TranslationKey>> = {
  coins_handful: 'sku.coins_handful.desc',
  coins_starter: 'sku.coins_starter.desc',
  coins_pouch: 'sku.coins_pouch.desc',
  coins_chest: 'sku.coins_chest.desc',
  coins_chest_t: 'sku.coins_chest_t.desc',
  coins_region: 'sku.coins_region.desc',
  coins_master: 'sku.coins_master.desc'
};

/** Канонические РУ-бейджи SKU (monetize/config.ts) → ключи словаря. */
const SKU_BADGE_KEYS: Readonly<Record<string, TranslationKey>> = {
  'СТАРТ': 'sku.badge.start',
  'ЛУЧШИЙ СТАРТ': 'sku.badge.bestStart',
  'ЯКОРЬ': 'sku.badge.anchor'
};

export function skuTitle(sku: { readonly id: string; readonly title: string }): string {
  const key = SKU_TITLE_KEYS[sku.id] as TranslationKey | undefined;
  return key === undefined ? sku.title : t(key);
}

export function skuDesc(sku: { readonly id: string; readonly desc: string }): string {
  const key = SKU_DESC_KEYS[sku.id] as TranslationKey | undefined;
  return key === undefined ? sku.desc : t(key);
}

export function skuBadge(badge: string): string {
  const key = SKU_BADGE_KEYS[badge] as TranslationKey | undefined;
  return key === undefined ? badge : t(key);
}

/** Метка плана подписки (вместо MONETIZE.SUB.*.label из конфига). */
export function planLabel(plan: 'monthly' | 'yearly'): string {
  return t(plan === 'yearly' ? 'plan.yearly' : 'plan.monthly');
}

/** Перки WordGrove Club (порядок 1:1 с MONETIZE.SUB.perks). */
export function subPerks(): readonly string[] {
  return [t('shop.perk1'), t('shop.perk2'), t('shop.perk3'), t('shop.perk4'), t('shop.perk5'), t('shop.perk6')];
}
