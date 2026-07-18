/**
 * Тесты i18n-слоя (Проход Ж.1): полнота локалей (каждый ключ есть в ru и en —
 * дублирует компиляторную гарантию `satisfies`), resolveLocale (override →
 * navigator.language → en), интерполяция {параметров}, плюрализация,
 * метки конфиг-строк (labels) и точка подключения levelsFor(locale).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LEVELS, levelsFor } from '../src/core/levels';
import { LEVELS_EN } from '../src/core/levelsEn';
import { getLocale, resolveLocale, setLocale, t, tPlural, LOCALE_STORAGE_KEY } from '../src/i18n';
import { EN } from '../src/i18n/en';
import { RU } from '../src/i18n/ru';
import { geoLabel, missionText, planLabel, regionName, skuBadge, skuDesc, skuTitle, subPerks, themeLabel } from '../src/i18n/labels';
import { GEO_LABELS, GEO_ORDER } from '../src/ads/ecpm';
import { MISSIONS, REGIONS, THEMES } from '../src/meta/config';
import { IAP_SHELF } from '../src/monetize/config';

/* Локаль — модульное состояние: возвращаем дефолт node-окружения (en). */
afterEach(() => {
  setLocale('en');
});

describe('полнота словарей', () => {
  it('наборы ключей ru и en совпадают (нет пропусков и лишних)', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(RU).sort());
  });

  it('нет пустых строк ни в одной локали', () => {
    for (const [k, v] of Object.entries(RU)) expect(v, 'ru:' + k).not.toBe('');
    for (const [k, v] of Object.entries(EN)) expect(v, 'en:' + k).not.toBe('');
  });

  it('плейсхолдеры {x} каждого ключа одинаковы в обеих локалях', () => {
    const params = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(RU) as Array<keyof typeof RU>) {
      expect(params(EN[k]), k).toEqual(params(RU[k]));
    }
  });
});

describe('resolveLocale (override → navigator → en)', () => {
  it('localStorage-override побеждает navigator', () => {
    expect(resolveLocale('en', 'ru-RU')).toBe('en');
    expect(resolveLocale('ru', 'en-US')).toBe('ru');
  });

  it('мусорный override игнорируется', () => {
    expect(resolveLocale('de', 'ru-RU')).toBe('ru');
    expect(resolveLocale('', 'de-DE')).toBe('en');
  });

  it('navigator: ru* → ru, иначе en; без navigator — en', () => {
    expect(resolveLocale(null, 'ru')).toBe('ru');
    expect(resolveLocale(null, 'ru-RU')).toBe('ru');
    expect(resolveLocale(null, 'RU-ru')).toBe('ru');
    expect(resolveLocale(null, 'de-DE')).toBe('en');
    expect(resolveLocale(null, undefined)).toBe('en');
  });

  it('в node-окружении стартовая локаль — en, ключ override — префикс игры', () => {
    expect(getLocale()).toBe('en');
    expect(LOCALE_STORAGE_KEY).toBe('wordgrove.locale');
  });
});

describe('t(): перевод и интерполяция', () => {
  it('подставляет параметры в активной локали', () => {
    setLocale('ru');
    expect(t('hud.level', { n: 2, total: 10 })).toBe('Уровень 2/10');
    setLocale('en');
    expect(t('hud.level', { n: 2, total: 10 })).toBe('Level 2/10');
  });

  it('неизвестный плейсхолдер остаётся как есть, без параметров — шаблон', () => {
    setLocale('en');
    expect(t('hud.level')).toBe('Level {n}/{total}');
    expect(t('hud.level', { n: 1 })).toBe('Level 1/{total}');
  });

  it('setLocale переключает словарь без перезагрузки модуля', () => {
    setLocale('ru');
    expect(t('meta.close')).toBe('✕ Играть');
    setLocale('en');
    expect(t('meta.close')).toBe('✕ Play');
  });
});

describe('tPlural: русские one/few/many и английские one/other', () => {
  it('ru: 1 день / 2 дня / 5 дней / 11 дней / 21 день', () => {
    setLocale('ru');
    const f = (n: number): string => tPlural(n, 'plural.day.one', 'plural.day.few', 'plural.day.many');
    expect(f(1)).toBe('день');
    expect(f(2)).toBe('дня');
    expect(f(5)).toBe('дней');
    expect(f(11)).toBe('дней');
    expect(f(21)).toBe('день');
    expect(f(104)).toBe('дня');
  });

  it('en: 1 day / n days', () => {
    setLocale('en');
    const f = (n: number): string => tPlural(n, 'plural.day.one', 'plural.day.few', 'plural.day.many');
    expect(f(1)).toBe('day');
    expect(f(2)).toBe('days');
    expect(f(21)).toBe('days');
  });
});

describe('labels: метки конфиг-строк с fallback', () => {
  it('каждый регион/миссия/тема/SKU из конфигов имеет перевод в обеих локалях', () => {
    for (const locale of ['ru', 'en'] as const) {
      setLocale(locale);
      for (const r of REGIONS) {
        const name = regionName(r.id, r.name);
        expect(name).not.toBe('');
        if (locale === 'en') expect(name, r.id).not.toBe(r.name); // не fallback
      }
      for (const m of MISSIONS) {
        const text = missionText(m.id, m.text);
        expect(text).not.toBe('');
        if (locale === 'en') expect(text, m.id).not.toBe(m.text);
      }
      for (const theme of THEMES) {
        const label = themeLabel(theme);
        expect(label).not.toBe('');
        if (locale === 'en') expect(label, theme).not.toBe(theme);
      }
      for (const sku of IAP_SHELF) {
        expect(skuTitle(sku)).not.toBe('');
        expect(skuDesc(sku)).not.toBe('');
        if (locale === 'en') {
          expect(skuTitle(sku), sku.id).not.toBe(sku.title);
          expect(skuDesc(sku), sku.id).not.toBe(sku.desc);
        }
        if (sku.badge !== undefined && locale === 'en') {
          expect(skuBadge(sku.badge), sku.id).not.toBe(sku.badge);
        }
      }
      expect(subPerks()).toHaveLength(6);
      expect(planLabel('monthly')).not.toBe('');
      expect(planLabel('yearly')).not.toBe('');
      // Гео-метки симулятора рекламы (баннер B-1 / оверлей) локализованы:
      // «Бленд 60/40» не утекает в EN-игровой UI.
      for (const g of GEO_ORDER) expect(geoLabel(g, GEO_LABELS[g])).not.toBe('');
      if (locale === 'en') expect(geoLabel('blend', GEO_LABELS.blend)).toBe('Blend 60/40');
    }
  });

  it('в ru метки совпадают с каноническими строками конфигов (совместимость 1:1)', () => {
    setLocale('ru');
    for (const r of REGIONS) expect(regionName(r.id, 'x')).toBe(r.name);
    for (const m of MISSIONS) expect(missionText(m.id, 'x')).toBe(m.text);
    for (const theme of THEMES) expect(themeLabel(theme)).toBe(theme);
    for (const sku of IAP_SHELF) {
      expect(skuTitle(sku)).toBe(sku.title);
      expect(skuDesc(sku)).toBe(sku.desc);
    }
    for (const g of GEO_ORDER) expect(geoLabel(g, 'x')).toBe(GEO_LABELS[g]);
  });

  it('неизвестный id падает на fallback, а не роняет UI', () => {
    setLocale('en');
    expect(regionName('unknown', 'Fallback')).toBe('Fallback');
    expect(missionText('unknown', 'Fallback')).toBe('Fallback');
    expect(themeLabel('Неизвестная тема')).toBe('Неизвестная тема');
    expect(skuBadge('НЕТ ТАКОГО')).toBe('НЕТ ТАКОГО');
  });
});

describe('levelsFor(locale): точка подключения языкозависимого контента', () => {
  it('ru играет русский набор, en — английский пакет Ж.2', () => {
    expect(levelsFor('ru')).toBe(LEVELS);
    expect(levelsFor('en')).toBe(LEVELS_EN);
    expect(levelsFor('en')).not.toBe(LEVELS);
  });
});
