/**
 * Тесты EN-контента (Проход Ж.2): все 12 английских уровней проходят ТЕ ЖЕ
 * инварианты, что русский набор (validateLevel — порт node-валидатора
 * Прохода А): INV-W1 (составимость сеточных и бонусных слов из
 * мультимножества колеса), INV-W2 (пересечения, связность, раны 1:1, bbox),
 * правила бонусов (длина >= 3, без дублей, не из сетки). Плюс: структура
 * пакета (колесо = буквы базы, прогрессия сложности, уникальность баз и
 * мультимножеств колёс — R-9), детерминизм генератора tools/gen-levels.ts
 * (INV-W4: повторная генерация даёт бит-в-бит те же уровни, и именно они
 * закоммичены в levelsEn.ts) и языкозависимый дневной кроссворд.
 */
import { describe, expect, it } from 'vitest';
import { CoreGame } from '../src/core/game';
import { LEVELS, levelsFor } from '../src/core/levels';
import { LEVELS_EN } from '../src/core/levelsEn';
import type { KeyValueStorage } from '../src/core/storage';
import { canCompose, validateLevel } from '../src/core/validate';
import { EN_PACK_INDEX, generateEnPack, PACK_SPEC } from '../tools/gen-levels';

class MemStorage implements KeyValueStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

/* ==================== ИНВАРИАНТЫ INV-W1/INV-W2 (валидатор Прохода А) ==================== */

describe('EN-уровни: инварианты INV-W1/INV-W2 на всех 12 уровнях', () => {
  for (let i = 0; i < LEVELS_EN.length; i++) {
    it(`уровень ${i + 1} («${LEVELS_EN[i].base}») валиден`, () => {
      expect(validateLevel(LEVELS_EN[i])).toEqual([]);
    });
  }

  it('INV-W1 явно: каждое слово сетки и каждый бонус составимы из колеса', () => {
    for (const level of LEVELS_EN) {
      for (const pw of level.words) {
        expect(canCompose(pw.w, level.wheel), `${level.base}: слово ${pw.w}`).toBe(true);
      }
      for (const b of level.bonus) {
        expect(canCompose(b, level.wheel), `${level.base}: бонус ${b}`).toBe(true);
      }
    }
  });
});

/* ==================== СТРУКТУРА ПАКЕТА И ПРОГРЕССИЯ ==================== */

describe('EN-пакет: структура и прогрессия сложности', () => {
  it('ровно 12 уровней, только A-Z, слова сетки 3-7 букв, бонусов >= 2', () => {
    expect(LEVELS_EN.length).toBe(12);
    for (const level of LEVELS_EN) {
      expect(level.base).toMatch(/^[A-Z]{6,7}$/);
      for (const ch of level.wheel) expect(ch).toMatch(/^[A-Z]$/);
      for (const pw of level.words) expect(pw.w).toMatch(/^[A-Z]{3,7}$/);
      for (const b of level.bonus) expect(b).toMatch(/^[A-Z]{3,7}$/);
      expect(level.bonus.length).toBeGreaterThanOrEqual(2); // R-8: копилка жёлудей
    }
  });

  it('колесо каждого уровня — перестановка букв базы (03 §5.2, шаг 1)', () => {
    for (const level of LEVELS_EN) {
      const wheelSorted = [...level.wheel].sort().join('');
      const baseSorted = level.base.split('').sort().join('');
      expect(wheelSorted).toBe(baseSorted);
      // Колесо перемешано: базовое слово не читается по кругу с первой буквы.
      expect(level.wheel.join('')).not.toBe(level.base);
    }
  });

  it('первое слово сетки — база уровня (якорь укладки, 11 §3.4)', () => {
    for (const level of LEVELS_EN) {
      expect(level.words[0].w).toBe(level.base);
      expect(level.words[0].d).toBe('H');
    }
  });

  it('прогрессия: колесо 6 → 7 букв, слов сетки 4 → 8, не убывая', () => {
    for (let i = 1; i < LEVELS_EN.length; i++) {
      expect(LEVELS_EN[i].wheel.length).toBeGreaterThanOrEqual(LEVELS_EN[i - 1].wheel.length);
      expect(LEVELS_EN[i].words.length).toBeGreaterThanOrEqual(LEVELS_EN[i - 1].words.length);
    }
    expect(LEVELS_EN[0].wheel.length).toBe(6);
    expect(LEVELS_EN[LEVELS_EN.length - 1].wheel.length).toBe(7);
    expect(LEVELS_EN[0].words.length).toBe(4);
    expect(LEVELS_EN[LEVELS_EN.length - 1].words.length).toBe(8);
  });

  it('R-9: базы и мультимножества колёс не повторяются внутри пакета', () => {
    const bases = new Set<string>();
    const wheels = new Set<string>();
    for (const level of LEVELS_EN) {
      expect(bases.has(level.base)).toBe(false);
      bases.add(level.base);
      const wheelKey = [...level.wheel].sort().join('');
      expect(wheels.has(wheelKey)).toBe(false);
      wheels.add(wheelKey);
    }
  });
});

/* ==================== ДЕТЕРМИНИЗМ ГЕНЕРАТОРА (INV-W4) ==================== */

describe('генератор tools/gen-levels.ts: детерминизм при фиксированном сиде', () => {
  it('повторная генерация пакета даёт бит-в-бит тот же результат', () => {
    const a = generateEnPack(EN_PACK_INDEX);
    const b = generateEnPack(EN_PACK_INDEX);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('закоммиченный LEVELS_EN — ровно выход генератора (данные не правились руками)', () => {
    expect(generateEnPack(EN_PACK_INDEX)).toEqual(LEVELS_EN);
  });

  it('PACK_SPEC согласован с закоммиченным пакетом (базы и число слов)', () => {
    expect(PACK_SPEC.length).toBe(LEVELS_EN.length);
    PACK_SPEC.forEach((spec, i) => {
      expect(LEVELS_EN[i].base).toBe(spec.base.toUpperCase());
      expect(LEVELS_EN[i].words.length).toBe(spec.words);
    });
  });
});

/* ==================== ЛОКАЛЬ: КАМПАНИЯ И ДНЕВНОЙ КРОССВОРД ==================== */

describe('levelsFor(locale): EN-контент подключён, дневной — из того же пула', () => {
  it('en → LEVELS_EN, ru → LEVELS (наборы разные)', () => {
    expect(levelsFor('en')).toBe(LEVELS_EN);
    expect(levelsFor('ru')).toBe(LEVELS);
    expect(levelsFor('en')).not.toBe(levelsFor('ru'));
  });

  it('ядро с EN-набором играет английский уровень, дневной берётся из EN-пула', () => {
    const game = new CoreGame({ storage: new MemStorage(), levels: levelsFor('en') });
    expect(game.getTotalLevels()).toBe(LEVELS_EN.length); // dailySeedIndex() % 12
    expect(game.getLevelData().base).toBe('GARDEN');
    // Дневной режим: уровень idx из EN-пула, кампания в снимке.
    expect(game.startDaily(9)).toBe(true);
    expect(game.getLevelData().base).toBe(LEVELS_EN[9].base); // THUNDER
    game.exitDaily();
    expect(game.getLevelData().base).toBe('GARDEN');
  });
});
