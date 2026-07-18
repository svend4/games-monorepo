/**
 * Правила TriPeaks (порт prototype/game.js 1:1): ±1 ранг с зацикливанием
 * A↔K и множитель серии ×1 → +0.1/карта → кап ×3 (03 п. 3.2).
 */
import { CORE_CFG } from './config';

/** Русские индексы карт: Т(уз), В(алет), Д(ама), К(ороль). Ранги 1..13. */
export const RANK_LABELS: readonly string[] = [
  '', 'Т', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К'
];

export interface SuitDef {
  readonly sym: string;
  readonly red: boolean;
}

export const SUITS: readonly SuitDef[] = [
  { sym: '♠', red: false },
  { sym: '♥', red: true },
  { sym: '♣', red: false },
  { sym: '♦', red: true }
];

/** ±1 ранг с зацикливанием A↔K (03-core-gameplay.md п. 3.2). */
export function isAdjacent(a: number, b: number): boolean {
  const d = (a - b + 13) % 13;
  return d === 1 || d === 12;
}

/** Множитель серии: 1-я карта ×1, далее +0.1/карта, кап ×3 (п. 3.2). */
export function multiplierFor(chain: number): number {
  if (chain <= 1) return 1.0;
  return Math.min(CORE_CFG.STREAK_MAX, 1.0 + CORE_CFG.STREAK_STEP * (chain - 1));
}
