/**
 * Конфиг меты (порт MC из prototype/meta.js; спека — 04-meta-progression.md).
 */

/** Ключ сейва меты — ТОТ ЖЕ, что в прототипе. */
export const META_SAVE_KEY = 'wordgrove.meta.v1';

/** Атлас (04 §3.1): 10 уровней прототипа сгруппированы в 2 региона по 5.
 * В проде — локации по 15 уровней и регионы по 60; здесь масштаб адаптирован. */
export interface RegionDef {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly levels: readonly number[];
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'grove', name: 'Зелёная роща', emoji: '🌳', levels: [0, 1, 2, 3, 4] },
  { id: 'meadow', name: 'Солнечный луг', emoji: '🌻', levels: [5, 6, 7, 8, 9] }
];

/** Метрики игровых событий, по которым считаются миссии. */
export type MissionMetric = 'bonus_word' | 'level_complete' | 'level_perfect';

/** Daily-миссии (04 §3.5): 3 шт., 30–60 монет; часть даёт жёлуди (05 §2.2). */
export interface MissionDef {
  readonly id: string;
  readonly text: string;
  readonly emoji: string;
  readonly metric: MissionMetric;
  readonly target: number;
  readonly coins: number;
  readonly acorns: number;
}

export const MISSIONS: readonly MissionDef[] = [
  { id: 'bonus5', text: 'Найди 5 бонусных слов', emoji: '⭐', metric: 'bonus_word', target: 5, coins: 40, acorns: 0 },
  { id: 'levels3', text: 'Пройди 3 уровня', emoji: '🧩', metric: 'level_complete', target: 3, coins: 30, acorns: 0 },
  { id: 'nohint', text: 'Пройди уровень без подсказок', emoji: '💡', metric: 'level_perfect', target: 1, coins: 60, acorns: 10 }
];

export function missionDef(id: string): MissionDef | null {
  for (const m of MISSIONS) {
    if (m.id === id) return m;
  }
  return null;
}

/** Темы дня (04 §3.3) — ротация по дню года. */
export const THEMES: readonly string[] = [
  'Кухня',
  'Осень',
  'Кино 80-х',
  'Природа',
  'Город',
  'Музыка',
  'Путешествия'
];

/** Вехи стрика в днях (04 §3.3; награды — ECON.STREAK_MILESTONES). */
export const STREAK_MILESTONE_DAYS: readonly number[] = [3, 7, 14, 30];
