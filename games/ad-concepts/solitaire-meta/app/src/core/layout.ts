/**
 * Раскладка «3 пика» (порт buildLayout из prototype/game.js 1:1):
 * ряды 3/6/9/10 = 28 карт, граф перекрытий coveredBy — карта открыта,
 * когда все закрывающие её карты ряда ниже убраны (03 п. 3.2).
 */
import type { Slot } from './types';

/** Построить 28 слотов с графом перекрытий (детерминированная геометрия). */
export function buildLayout(): Slot[] {
  const rowCols: readonly (readonly number[])[] = [
    [1.5, 4.5, 7.5], // ряд 0 — вершины пиков
    [1, 2, 4, 5, 7, 8], // ряд 1
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], // ряд 2
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] // ряд 3 — нижний, открытый
  ];
  interface MutableSlot {
    id: number;
    row: number;
    col: number;
    coveredBy: number[];
  }
  const slots: MutableSlot[] = [];
  rowCols.forEach((cols, row) => {
    for (const col of cols) {
      slots.push({ id: slots.length, row, col, coveredBy: [] });
    }
  });
  for (const s of slots) {
    for (const t of slots) {
      if (t.row === s.row + 1 && Math.abs(t.col - s.col) === 0.5) {
        s.coveredBy.push(t.id);
      }
    }
  }
  return slots;
}

/** Слоты стола (константа модуля — геометрия неизменна). */
export const SLOTS: readonly Slot[] = buildLayout();

/** Размер стола = 28 карт. */
export const TABLE_SIZE = SLOTS.length;

/** Номер пика (0..2) по колонке слота — для баланса карт урожая (Q3). */
export function peakOf(slot: Slot): number {
  return slot.col < 3 ? 0 : slot.col < 6 ? 1 : 2;
}
