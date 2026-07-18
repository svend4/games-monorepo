/**
 * Операции над полем 8×8 (11 §4.1–4.2 в объёме Прохода А, логика 1:1 из прототипа):
 * постановка, одновременный поиск полных строк И столбцов, очистка с дедупликацией
 * пересечений, «чистое поле», взрыв бомбы 3×3 с клипом границами.
 */
import type { Board, ClearedCell, Lines, PieceDef } from './types';

/** Размер поля (03 §2.1). Маски 9×9 «Фигурных полей» — вне Прохода А. */
export const BOARD_N = 8;

/** Новое пустое поле N×N. */
export function newBoard(): Board {
  const b: Board = [];
  for (let r = 0; r < BOARD_N; r++) {
    const row: number[] = [];
    for (let c = 0; c < BOARD_N; c++) row.push(0);
    b.push(row);
  }
  return b;
}

export function cloneBoard(b: Board): Board {
  return b.map((row) => row.slice());
}

/** Фигура целиком на свободных клетках в границах поля (03 §2.1 п.3). */
export function canPlace(b: Board, p: PieceDef, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r + p.h > BOARD_N || c + p.w > BOARD_N) return false;
  for (const [dr, dc] of p.cells) {
    if (b[r + dr][c + dc] !== 0) return false;
  }
  return true;
}

/** Впечатать фигуру значением val (colorIdx + 1; в симуляциях — 1). */
export function stampPiece(b: Board, p: PieceDef, r: number, c: number, val: number): void {
  for (const [dr, dc] of p.cells) {
    b[r + dr][c + dc] = val;
  }
}

/** Есть ли хоть одна валидная позиция (ранний выход — 11 §4.1). */
export function canPlaceAnywhere(b: Board, p: PieceDef): boolean {
  for (let r = 0; r <= BOARD_N - p.h; r++) {
    for (let c = 0; c <= BOARD_N - p.w; c++) {
      if (canPlace(b, p, r, c)) return true;
    }
  }
  return false;
}

/** Полные строки И столбцы одновременно — ДО удаления (11 §4.2 шаг 1). */
export function findFullLines(b: Board): Lines {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < BOARD_N; r++) {
    let full = true;
    for (let c = 0; c < BOARD_N; c++) {
      if (b[r][c] === 0) { full = false; break; }
    }
    if (full) rows.push(r);
  }
  for (let c = 0; c < BOARD_N; c++) {
    let full = true;
    for (let r = 0; r < BOARD_N; r++) {
      if (b[r][c] === 0) { full = false; break; }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/** Клетки линий; пересечения строки и столбца — один раз (11 §4.3). */
export function lineCells(rows: readonly number[], cols: readonly number[]): Array<[number, number]> {
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const r of rows) {
    for (let c = 0; c < BOARD_N; c++) {
      const key = r * BOARD_N + c;
      if (!seen.has(key)) { seen.add(key); out.push([r, c]); }
    }
  }
  for (const c of cols) {
    for (let r = 0; r < BOARD_N; r++) {
      const key = r * BOARD_N + c;
      if (!seen.has(key)) { seen.add(key); out.push([r, c]); }
    }
  }
  return out;
}

/** Обнулить клетки, вернув их прежние цвета (для FX вида). */
export function removeCells(b: Board, cells: ReadonlyArray<readonly [number, number]>): ClearedCell[] {
  const out: ClearedCell[] = [];
  for (const [r, c] of cells) {
    const v = b[r][c];
    if (v !== 0) out.push({ r, c, colorIdx: v - 1 });
    b[r][c] = 0;
  }
  return out;
}

/** Доля занятых клеток 0..1 (вход антифрустрации мешка, 03 §4.1 шаг 6). */
export function fillRatio(b: Board): number {
  let n = 0;
  for (let r = 0; r < BOARD_N; r++) {
    for (let c = 0; c < BOARD_N; c++) {
      if (b[r][c] !== 0) n++;
    }
  }
  return n / (BOARD_N * BOARD_N);
}

/** «Чистое поле» — все клетки пусты (бонус 300, 03 §2.2). */
export function boardEmpty(b: Board): boolean {
  for (let r = 0; r < BOARD_N; r++) {
    for (let c = 0; c < BOARD_N; c++) {
      if (b[r][c] !== 0) return false;
    }
  }
  return true;
}

/**
 * Взрыв кристальной бомбы: очистка области 3×3 вокруг (r, c) с клипом
 * границами поля (11 §5.3). Мутирует поле, возвращает удалённые клетки.
 */
export function explode3x3(b: Board, r: number, c: number): ClearedCell[] {
  const out: ClearedCell[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const tr = r + dr;
      const tc = c + dc;
      if (tr < 0 || tc < 0 || tr >= BOARD_N || tc >= BOARD_N) continue;
      const v = b[tr][tc];
      if (v !== 0) {
        out.push({ r: tr, c: tc, colorIdx: v - 1 });
        b[tr][tc] = 0;
      }
    }
  }
  return out;
}

/** Линии, которые соберутся, если поставить фигуру сюда (для ghost-подсветки, 03 §3). */
export function previewLines(b: Board, p: PieceDef, r: number, c: number): Lines {
  const sim = cloneBoard(b);
  stampPiece(sim, p, r, c, 1);
  return findFullLines(sim);
}
