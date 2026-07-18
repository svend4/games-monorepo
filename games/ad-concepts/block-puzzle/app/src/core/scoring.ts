/**
 * Очки (03 §2.2), комбо-автомат ×2/×3/×5 с «прощением» (11 §5.1),
 * шкала «Прилива» (11 §5.2) и очки кристальной бомбы 3×3 (11 §5.3).
 * Константы и семантика 1:1 из прототипа.
 */
import type { ComboState, SurgeState } from './types';

/* --- Номиналы 03 §2.2–2.3 --- */
/** Очки за 0/1/2/3/4+ линий за ход. */
export const LINE_PTS: readonly number[] = [0, 10, 30, 60, 100];
/** «Чистое поле»: фикс, множителем комбо НЕ умножается. */
export const CLEAN_BONUS = 300;
/** Взрыв кристалла: 40 + 1 очко за клетку; не умножается. */
export const BOMB_BASE_PTS = 40;
/** Ёмкость шкалы Прилива. */
export const SURGE_MAX = 100;
/** Заряд за чистящий ход = 10 × множитель. */
export const SURGE_PER_MULT = 10;

/** Множитель комбо по длине цепи: 2 → ×2, 3 → ×3, 4+ → ×5 (потолок). */
export function multFor(chain: number): 1 | 2 | 3 | 5 {
  return chain >= 4 ? 5 : chain === 3 ? 3 : chain === 2 ? 2 : 1;
}

/**
 * Автомат комбо (11 §5.1), мутирует combo. Очистка растит цепь; ход без
 * очистки рвёт её, КРОМЕ первого хода новой тройки при взведённом «прощении»
 * (окно планирования: цепь не рвётся, но и не растёт). Возвращает множитель,
 * применяемый к очкам линий ТЕКУЩЕГО хода.
 */
export function comboAdvance(combo: ComboState, cleared: boolean, wasFirstMoveOfHand: boolean): 1 | 2 | 3 | 5 {
  if (cleared) {
    combo.chain += 1;
    combo.graceArmed = true; // прощение взводится заново каждой очисткой
  } else if (wasFirstMoveOfHand && combo.graceArmed) {
    combo.graceArmed = false; // цепь не рвётся, но и не растёт
  } else {
    combo.chain = 0;
    combo.graceArmed = false;
  }
  return multFor(combo.chain);
}

/**
 * Заряд шкалы за чистящий ход (11 §5.2), мутирует surge. При готовой бомбе
 * заряд заморожен (второй кристалл в очередь не встаёт). Возвращает true,
 * если шкала заполнилась этим ходом (бомба приходит в док).
 */
export function surgeOnClear(surge: SurgeState, lines: number, mult: number, bombReady: boolean): boolean {
  if (lines === 0 || bombReady) return false;
  surge.charge = Math.min(SURGE_MAX, surge.charge + SURGE_PER_MULT * mult);
  return surge.charge >= SURGE_MAX;
}

/**
 * Очки хода-постановки (порядок начисления 11 §5.4):
 * постановка (1/клетку) + mult × очки линий + «чистое поле» (без множителя).
 */
export function movePoints(pieceSize: number, lineCount: number, mult: number, clean: boolean): number {
  const linePts = LINE_PTS[Math.min(lineCount, 4)];
  return pieceSize + mult * linePts + (clean ? CLEAN_BONUS : 0);
}

/** Очки взрыва бомбы: 40 + 1/клетку (+300 при «чистом поле»); не умножается. */
export function bombPoints(removed: number, clean: boolean): number {
  return BOMB_BASE_PTS + removed + (clean ? CLEAN_BONUS : 0);
}
