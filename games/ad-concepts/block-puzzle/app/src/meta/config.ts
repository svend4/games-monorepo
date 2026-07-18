/**
 * Конфиг мета-прогрессии (Проход Е.2 — порт констант meta.js 1:1).
 * Источники: 04 §2 (карта и звёзды), 04 §3 (стрик), 04 §4.1 (миссии).
 */
import type { BoosterId } from '../economy/econ';

/** Звёзды за партию по очкам (04 §2): score ≥ порога → 1 / 2 / 3 ★. */
export const STAR_THRESHOLDS: readonly number[] = [800, 2000, 4000];

/** Награда узла карты: монеты и/или бустер. */
export interface NodeReward {
  coins?: number;
  booster?: BoosterId;
}

/** Узел карты «Путешествия» (линейный трек, прогресс по суммарным ★). */
export interface MapNode {
  id: number;
  /** Требуемые суммарные звёзды. */
  stars: number;
  reward: NodeReward;
  /** «Босс»-узел (04 §2) — усиленная награда. */
  boss?: boolean;
}

/** Карта «Путешествия» (04 §2): 12 узлов, значения 1:1 из прототипа. */
export const MAP_NODES: readonly MapNode[] = [
  { id: 1, stars: 1, reward: { coins: 50 } },
  { id: 2, stars: 3, reward: { coins: 40 } },
  { id: 3, stars: 5, reward: { booster: 'undo' } },
  { id: 4, stars: 8, reward: { coins: 60 } },
  { id: 5, stars: 12, reward: { booster: 'swap' }, boss: true },
  { id: 6, stars: 16, reward: { coins: 80 } },
  { id: 7, stars: 20, reward: { booster: 'hammer' } },
  { id: 8, stars: 25, reward: { coins: 100 } },
  { id: 9, stars: 30, reward: { coins: 200 }, boss: true }, // босс ×2
  { id: 10, stars: 36, reward: { booster: 'hammer' } },
  { id: 11, stars: 42, reward: { coins: 150 } },
  { id: 12, stars: 50, reward: { coins: 300, booster: 'hammer' }, boss: true }
];

/** Награда дня стрика. */
export interface StreakReward {
  coins: number;
  booster?: BoosterId;
}

/** Стрик дней (04 §3): 7-дневный цикл, награды нарастают; день 7 + Молот. */
export const STREAK_REWARDS: readonly StreakReward[] = [
  { coins: 30 },
  { coins: 40 },
  { coins: 50 },
  { coins: 60 },
  { coins: 80 },
  { coins: 100 },
  { coins: 150, booster: 'hammer' }
];

/** Тип миссии → как считаем прогресс (см. Meta.advanceMissions). */
export type MissionType = 'lines' | 'combo' | 'games' | 'score' | 'clean';

export interface MissionDef {
  id: string;
  type: MissionType;
  target: number;
  /** Награда в монетах. */
  reward: number;
  text: string;
}

/** Пул ежедневных миссий (04 §4.1: 3 шт., ротация), значения 1:1 из прототипа. */
export const MISSION_POOL: readonly MissionDef[] = [
  { id: 'lines20', type: 'lines', target: 20, reward: 40, text: 'Очисти 20 линий' },
  { id: 'lines35', type: 'lines', target: 35, reward: 50, text: 'Очисти 35 линий' },
  { id: 'combo3', type: 'combo', target: 3, reward: 60, text: 'Собери комбо ×3' },
  { id: 'games2', type: 'games', target: 2, reward: 40, text: 'Сыграй 2 партии' },
  { id: 'score25', type: 'score', target: 2500, reward: 60, text: 'Набери 2500 очков за партию' },
  { id: 'clean1', type: 'clean', target: 1, reward: 50, text: 'Собери «чистое поле»' }
];

/** 04 §4.1: все 3 закрыты → бонус-сундук 60 монет. */
export const MISSION_BONUS = 60;
