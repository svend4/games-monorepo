/**
 * SOLVENCY-CHECK (11 §3.4, INV-G1): существует ли хотя бы ОДНА последовательность
 * размещения всех фигур тройки на текущем поле.
 *
 * Реализация Прохода А 1:1 из прототипа: вместо beam-поиска — DFS с ранним выходом
 * и потолком узлов; для поля 8×8 достаточно (< 2 мс на практике). Симуляция хода
 * ОБЯЗАНА выполнять очистку линий — иначе ложные «нерешаемо» (11 §3.4).
 */
import type { Board, PieceId } from './types';
import { DEF } from './catalog';
import { BOARD_N, canPlace, cloneBoard, findFullLines, lineCells, stampPiece } from './board';

/** Потолок узлов DFS; при превышении — fail-open: считаем решаемым, не блокируем выдачу. */
export const SOLVER_NODE_CAP = 30000;

export function solveTriple(srcBoard: Board, ids: readonly PieceId[]): boolean {
  let nodes = 0;

  /** Симуляция хода: постановка + очистка линий (освобождение места). */
  const applySim = (b: Board, id: PieceId, r: number, c: number): Board => {
    const nb = cloneBoard(b);
    stampPiece(nb, DEF[id], r, c, 1);
    const lines = findFullLines(nb);
    for (const [cr, cc] of lineCells(lines.rows, lines.cols)) nb[cr][cc] = 0;
    return nb;
  };

  const dfs = (b: Board, left: readonly PieceId[]): boolean => {
    if (left.length === 0) return true;
    if (++nodes > SOLVER_NODE_CAP) return true; // fail-open
    const tried = new Set<PieceId>();
    for (let i = 0; i < left.length; i++) {
      const id = left[i];
      if (tried.has(id)) continue; // дубликаты фигур в тройке не перебираем дважды
      tried.add(id);
      const p = DEF[id];
      for (let r = 0; r <= BOARD_N - p.h; r++) {
        for (let c = 0; c <= BOARD_N - p.w; c++) {
          if (!canPlace(b, p, r, c)) continue;
          const rest = left.slice(0, i).concat(left.slice(i + 1));
          if (dfs(applySim(b, id, r, c), rest)) return true;
        }
      }
    }
    return false;
  };

  return dfs(cloneBoard(srcBoard), ids);
}
