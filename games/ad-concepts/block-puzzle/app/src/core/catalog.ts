/**
 * Каталог фигур: 14 форм (11 §2, 03 §4.1). Константы 1:1 из прототипа
 * (cells / H / w0 / colorIdx). Вращений у игрока нет — каждая ориентация
 * была бы отдельной записью каталога.
 *
 * Группы: EASY = H ≤ 3 (Σw0 = 56), HARD = H ≥ 4 (Σw0 = 17),
 * SMALL = size ≤ 3 — цель антифрустрационного буста (03 §4.1 шаг 6).
 */
import type { PieceDef, PieceId } from './types';

interface CatalogEntry {
  id: PieceId;
  cells: ReadonlyArray<readonly [number, number]>;
  H: 1 | 2 | 3 | 4 | 5;
  w0: number;
  colorIdx: number;
}

/* Данные 1:1 из прототипа (game.js, CATALOG). */
const RAW: readonly CatalogEntry[] = [
  { id: 'MONO',     cells: [[0, 0]],                                          H: 1, w0: 6, colorIdx: 2 },
  { id: 'DOMINO_H', cells: [[0, 0], [0, 1]],                                  H: 1, w0: 5, colorIdx: 1 },
  { id: 'DOMINO_V', cells: [[0, 0], [1, 0]],                                  H: 1, w0: 5, colorIdx: 1 },
  { id: 'TRIO_I',   cells: [[0, 0], [0, 1], [0, 2]],                          H: 2, w0: 7, colorIdx: 5 },
  { id: 'TRIO_L',   cells: [[0, 0], [1, 0], [1, 1]],                          H: 2, w0: 7, colorIdx: 6 },
  { id: 'TET_I',    cells: [[0, 0], [0, 1], [0, 2], [0, 3]],                  H: 3, w0: 6, colorIdx: 4 },
  { id: 'TET_O',    cells: [[0, 0], [0, 1], [1, 0], [1, 1]],                  H: 2, w0: 8, colorIdx: 2 },
  { id: 'TET_L',    cells: [[0, 0], [1, 0], [2, 0], [2, 1]],                  H: 3, w0: 6, colorIdx: 1 },
  { id: 'TET_S',    cells: [[0, 1], [0, 2], [1, 0], [1, 1]],                  H: 4, w0: 4, colorIdx: 0 },
  { id: 'TET_T',    cells: [[0, 0], [0, 1], [0, 2], [1, 1]],                  H: 3, w0: 6, colorIdx: 6 },
  { id: 'PENT_P',   cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],          H: 4, w0: 4, colorIdx: 7 },
  { id: 'PENT_L',   cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],          H: 4, w0: 4, colorIdx: 3 },
  { id: 'PENT_X',   cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],          H: 5, w0: 2, colorIdx: 0 },
  { id: 'PENT_I5',  cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],          H: 5, w0: 3, colorIdx: 4 }
];

/** Производные поля bbox/size — как в прототипе (вычисляются из cells). */
function derive(e: CatalogEntry): PieceDef {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of e.cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return { ...e, h: maxR + 1, w: maxC + 1, size: e.cells.length };
}

export const CATALOG: readonly PieceDef[] = RAW.map(derive);

/** id → определение (быстрый доступ). */
export const DEF: Readonly<Record<PieceId, PieceDef>> = (() => {
  const map = {} as Record<PieceId, PieceDef>;
  for (const p of CATALOG) map[p.id] = p;
  return map;
})();

/** Σw0 группы EASY (H ≤ 3) — по 11 §2 равно 56. */
export const SUM_W0_EASY: number = CATALOG.filter((p) => p.H <= 3).reduce((s, p) => s + p.w0, 0);

/** Σw0 группы HARD (H ≥ 4) — по 11 §2 равно 17. */
export const SUM_W0_HARD: number = CATALOG.filter((p) => p.H >= 4).reduce((s, p) => s + p.w0, 0);

/** «Спасательные» фигуры форс-замены, порядок проб 1:1 из прототипа (11 §2). */
export const RESCUE_ORDER: readonly PieceId[] = ['DOMINO_H', 'DOMINO_V', 'MONO'];
