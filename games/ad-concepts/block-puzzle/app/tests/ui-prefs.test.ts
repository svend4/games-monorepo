/**
 * Тесты пользовательских префов UI (Проход Ж.1):
 *  - флаг FTUE blocksurge_ftue — схема прототипа 1:1 (onboarding.js):
 *    отсутствие ключа = показать; сейв прототипа подхватывается; наши
 *    markFtueDone пишут { done: true, v: 1, how, ts };
 *  - тема (контраст-проход): два пресета одинаковой формы, парс сохранённого
 *    значения устойчив к мусору, ключ blocksurge_theme.
 */
import { describe, expect, it } from 'vitest';
import {
  FTUE_KEY,
  isFtueDone,
  markFtueDone,
  resetFtueFlag,
  type KeyValueStorage
} from '../src/ui/ftueFlag';
import { THEMES, THEME_KEY, parseThemeMode } from '../src/ui/theme';

/** In-memory localStorage для node-окружения. */
function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

/* ============================ Флаг FTUE ================================= */

describe('флаг FTUE (blocksurge_ftue, схема прототипа)', () => {
  it('ключ и его отсутствие: свежая установка → показать обучение', () => {
    const s = memStorage();
    expect(FTUE_KEY).toBe('blocksurge_ftue');
    expect(isFtueDone(s)).toBe(false);
  });

  it('markFtueDone пишет схему прототипа { done, v: 1, how, ts }', () => {
    const s = memStorage();
    markFtueDone('complete', s);
    expect(isFtueDone(s)).toBe(true);
    const raw = s.getItem(FTUE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { done: boolean; v: number; how: string; ts: number };
    expect(parsed.done).toBe(true);
    expect(parsed.v).toBe(1);
    expect(parsed.how).toBe('complete');
    expect(parsed.ts).toBeTypeOf('number');
  });

  it('«Пропустить» тоже ставит флаг (how: skip)', () => {
    const s = memStorage();
    markFtueDone('skip', s);
    expect(isFtueDone(s)).toBe(true);
    expect((JSON.parse(s.getItem(FTUE_KEY) as string) as { how: string }).how).toBe('skip');
  });

  it('сейв прототипа подхватывается 1:1 (значение, записанное onboarding.js)', () => {
    const s = memStorage();
    s.setItem(FTUE_KEY, JSON.stringify({ done: true, v: 1, how: 'complete', ts: 1735689600000 }));
    expect(isFtueDone(s)).toBe(true);
  });

  it('resetFtueFlag снимает флаг — обучение всплывёт снова', () => {
    const s = memStorage();
    markFtueDone('complete', s);
    resetFtueFlag(s);
    expect(isFtueDone(s)).toBe(false);
  });

  it('storage === null (недоступен) → «не пройдено», без краша', () => {
    expect(isFtueDone(null)).toBe(false);
    expect(() => markFtueDone('skip', null)).not.toThrow();
  });
});

/* ============================ Тема (контраст) =========================== */

describe('тема (blocksurge_theme): пресеты и парс', () => {
  it('ключ персиста — с префиксом игры', () => {
    expect(THEME_KEY).toBe('blocksurge_theme');
  });

  it('оба пресета имеют одинаковую форму (канвас + CSS-переменные)', () => {
    const darkKeys = Object.keys(THEMES.dark).sort();
    const lightKeys = Object.keys(THEMES.lighter).sort();
    expect(lightKeys).toEqual(darkKeys);
    expect(Object.keys(THEMES.lighter.css).sort()).toEqual(Object.keys(THEMES.dark.css).sort());
  });

  it('«Светлее» действительно светлее «Тёмного» по ключевым поверхностям', () => {
    expect(THEMES.lighter.canvasBg).toBeGreaterThan(THEMES.dark.canvasBg);
    expect(THEMES.lighter.cellEmpty).toBeGreaterThan(THEMES.dark.cellEmpty);
    expect(THEMES.lighter.dockSlot).toBeGreaterThan(THEMES.dark.dockSlot);
  });

  it('контраст-проход: пустая клетка светлее подложки поля в обоих пресетах', () => {
    expect(THEMES.dark.cellEmpty).toBeGreaterThan(THEMES.dark.boardPanel);
    expect(THEMES.lighter.cellEmpty).toBeGreaterThan(THEMES.lighter.boardPanel);
  });

  it('parseThemeMode: валидные значения проходят, мусор → dark', () => {
    expect(parseThemeMode('lighter')).toBe('lighter');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('neon')).toBe('dark');
    expect(parseThemeMode(null)).toBe('dark');
  });
});
