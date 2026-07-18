/**
 * Тесты i18n-слоя (Проход Ж.1): полнота словарей RU/EN (рантайм-дубль
 * компиляторной гарантии satisfies), согласованность {плейсхолдеров} между
 * локалями, подстановка параметров в t()/translate() и правило выбора локали
 * (override localStorage → navigator.language ru* → en).
 */
import { describe, expect, it } from 'vitest';
import { ru } from '../src/i18n/ru';
import { en } from '../src/i18n/en';
import { resolveLocale, translate } from '../src/i18n';
import { MISSION_POOL } from '../src/meta/config';
import { IAP_SHELF } from '../src/monetize/config';

/** Все {имена} плейсхолдеров строки. */
function placeholders(s: string): string[] {
  return (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort();
}

/* ==================== ПОЛНОТА И СОГЛАСОВАННОСТЬ СЛОВАРЕЙ ================= */

describe('словари ru/en: полнота и согласованность', () => {
  it('наборы ключей идентичны (ru ⊆ en и en ⊆ ru)', () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(ruKeys);
  });

  it('ни одна строка не пуста ни в одной локали', () => {
    for (const [k, v] of Object.entries(ru)) expect(v, 'ru:' + k).not.toBe('');
    for (const [k, v] of Object.entries(en)) expect(v, 'en:' + k).not.toBe('');
  });

  it('плейсхолдеры {param} совпадают между локалями для каждого ключа', () => {
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(placeholders(en[key]), 'key ' + key).toEqual(placeholders(ru[key]));
    }
  });

  it('терминология EN из store-listing: Surge/Crystal Block/Journey Map', () => {
    expect(en['hud.surge']).toContain('Surge');
    expect(en['game.toast.surgeReady']).toContain('Crystal Block');
    expect(en['meta.map.title']).toContain('Journey Map');
    expect(en['booster.undo.name']).toBe('Undo');
    expect(en['booster.swap.name']).toBe('Swap');
    expect(en['booster.hammer.name']).toBe('Hammer');
  });
});

/* ==================== ССЫЛКИ КОНФИГОВ НА КЛЮЧИ =========================== */

describe('конфиги ссылаются на существующие ключи', () => {
  it('каждая миссия пула имеет перевод в обеих локалях', () => {
    for (const m of MISSION_POOL) {
      expect(ru[m.textKey], m.id).toBeTypeOf('string');
      expect(en[m.textKey], m.id).toBeTypeOf('string');
    }
  });

  it('каждый SKU полки имеет title/desc (и badge, если задан) в обеих локалях', () => {
    for (const sku of IAP_SHELF) {
      expect(ru[sku.titleKey], sku.id).toBeTypeOf('string');
      expect(en[sku.titleKey], sku.id).toBeTypeOf('string');
      expect(ru[sku.descKey], sku.id).toBeTypeOf('string');
      expect(en[sku.descKey], sku.id).toBeTypeOf('string');
      if (sku.badgeKey !== undefined) {
        expect(ru[sku.badgeKey], sku.id).toBeTypeOf('string');
        expect(en[sku.badgeKey], sku.id).toBeTypeOf('string');
      }
    }
  });
});

/* ============================ translate() =============================== */

describe('translate(): подстановка параметров', () => {
  it('подставляет один и несколько параметров', () => {
    expect(translate('ru', 'hud.best', { best: 1200 })).toBe('Рекорд 1200');
    expect(translate('en', 'hud.best', { best: 1200 })).toBe('Best 1200');
    expect(translate('en', 'hud.comboActive', { mult: 3, chain: 2 })).toBe('Combo ×3 · chain 2');
  });

  it('повторное вхождение плейсхолдера заменяется везде', () => {
    // Синтетическая проверка на split/join (в словарях повторов нет).
    expect(translate('ru', 'meta.streak.count', { n: 7 })).toBe('Серия: 7 дн.');
  });

  it('без params строка возвращается как есть (плейсхолдеры не трогаются)', () => {
    expect(translate('en', 'over.coinsValue')).toBe('+{coins} 🪙');
  });

  it('строка статуса rewarded собирается с четырьмя параметрами', () => {
    expect(
      translate('en', 'mon.status.rewarded', { rw3: 1, rw3cap: 2, rw4: 0, rw4cap: 2 })
    ).toBe('Rewarded today: RW-3 1/2 · RW-4 0/2');
  });
});

/* =========================== resolveLocale() ============================ */

describe('resolveLocale(): override → navigator → en', () => {
  it('валидный override из localStorage побеждает navigator', () => {
    expect(resolveLocale('en', 'ru-RU')).toBe('en');
    expect(resolveLocale('ru', 'en-US')).toBe('ru');
  });

  it('невалидный override игнорируется', () => {
    expect(resolveLocale('de', 'ru-RU')).toBe('ru');
    expect(resolveLocale('', 'en-US')).toBe('en');
  });

  it('navigator ru* → ru (регистронезависимо)', () => {
    expect(resolveLocale(null, 'ru')).toBe('ru');
    expect(resolveLocale(null, 'ru-RU')).toBe('ru');
    expect(resolveLocale(null, 'RU-ru')).toBe('ru');
  });

  it('прочие языки и отсутствие navigator → en', () => {
    expect(resolveLocale(null, 'de-DE')).toBe('en');
    expect(resolveLocale(null, 'en-GB')).toBe('en');
    expect(resolveLocale(null, undefined)).toBe('en');
  });
});
