/**
 * Модель кроссвордной сетки (порт buildLevel из prototype/game.js).
 * Чистые структуры: клетки, ключи, раскладка слов по клеткам, множества
 * слов сетки и бонусов. Рендер (DOM) живёт в src/ui/GridUi.ts.
 */
import type { LevelData } from './types';

/** Ключ клетки "r,c" — 1:1 с прототипом (совместимость сейва revealed). */
export function cellKey(r: number, c: number): string {
  return r + ',' + c;
}

export interface GridCell {
  readonly letter: string;
  readonly r: number;
  readonly c: number;
}

export interface GridModel {
  /** "r,c" -> клетка. */
  readonly cells: ReadonlyMap<string, GridCell>;
  /** Все ключи клеток (порядок обхода слов — как в прототипе). */
  readonly cellKeys: readonly string[];
  /** 'СЛОВО' -> ключи клеток по порядку букв. */
  readonly wordCells: ReadonlyMap<string, readonly string[]>;
  /** Слова сетки. */
  readonly gridWords: ReadonlySet<string>;
  /** Бонус-слова уровня («словарь валидации», 03 §2.1). */
  readonly bonusWords: ReadonlySet<string>;
}

/** Построить модель сетки уровня (порт цикла L.words.forEach прототипа). */
export function buildGrid(level: LevelData): GridModel {
  const cells = new Map<string, GridCell>();
  const cellKeys: string[] = [];
  const wordCells = new Map<string, readonly string[]>();
  const gridWords = new Set<string>();
  const bonusWords = new Set<string>();

  for (const pw of level.words) {
    const dr = pw.d === 'V' ? 1 : 0;
    const dc = pw.d === 'H' ? 1 : 0;
    const keys: string[] = [];
    for (let k = 0; k < pw.w.length; k++) {
      const r = pw.r + dr * k;
      const c = pw.c + dc * k;
      const key = cellKey(r, c);
      keys.push(key);
      if (!cells.has(key)) {
        cells.set(key, { letter: pw.w.charAt(k), r, c });
        cellKeys.push(key);
      }
    }
    wordCells.set(pw.w, keys);
    gridWords.add(pw.w);
  }
  for (const b of level.bonus) bonusWords.add(b);

  return { cells, cellKeys, wordCells, gridWords, bonusWords };
}
