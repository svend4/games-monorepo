/**
 * Константы симулятора экономики (Проход Е.3, порт sim.js Прохода Г).
 * ЧИСЛА 1:1 С ПРОТОТИПОМ: приложение 12 (§2 сегменты, §3 номиналы),
 * глава 05 (§2 sources/sinks, §4 опорная кривая), глава 06 (§2.2 капы,
 * §4 eCPM), глава 09 (§4 цели, §5.1 удержание), глава 03 (§5.2 коридоры).
 *
 * Номиналы (цены, награды, капы) НЕ тюнятся (INV-E1) — решения глав 05/06.
 * BOOK_TUNE — калиброванный baseline свободных EV (12 §8.2): единственный
 * слой, который кокпит (experiments) может переопределять.
 */

/* ========================= НОМИНАЛЫ (INV-E1) ============================ */

export const PRICES = {
  hammer: 150,
  swap: 120,
  undo: 80, // бустеры, 05 §5
  continue1: 200,
  continue2: 400, // 05 §5
  streakRestore: 100,
  fieldTicket: 150, // 05 §2.1, §2.3
  skinMin: 1000 // нижняя граница витрины, 05 §2.1
} as const;

export const EARN = {
  linePerMult: 1, // 1 монета × множитель за линию, 05 §2.1
  levelWin: [25, 50] as readonly [number, number],
  star3First: 20, // 05 §2.1
  bossRewardMult: 2, // каждый 10-й уровень, 05 §2.1
  streakRamp: [30, 45, 60, 80, 100, 120, 150] as readonly number[], // цикл 7 дней (05 §2.1)
  chestAmortPerDay: 12, // сундуки глав 100–400, амортизировано
  startGrant: 200 // FTUE-подарок 05 §3 (учтён в дне 1 таблицы 05 §4)
} as const;

export const CAPS = {
  rw1PerParty: 1,
  rw2PerDay: 3,
  rw3PerDay: 1,
  rw4PerDay: 2, // 06 §2.2
  tickets: 3 // 05 §1
} as const;

/** Эффект pity на fail (11 §3.5, 12 §4.2), индекс = счётчик pity 0..2. */
export const PITY_RELIEF: readonly [number, number, number] = [1.0, 0.85, 0.7];

/* ===================== СЕГМЕНТЫ ИГРОКА (12 §2) ========================== */

export type SkillTier = 'NOVICE' | 'BASE' | 'SKILLED';
export type FreqTier = 'LIGHT' | 'CORE' | 'HEAVY';

export interface SkillDef {
  pClear: number;
  failMult: number;
  linesDist: readonly number[];
  crystalAim: number;
}

export interface ModeMix {
  journey: number;
  classic: number;
  field: number;
}

export interface FreqDef {
  sessionsPerDay: number;
  gamesPerSession: number;
  modeMix: ModeMix;
  skipDayP: number;
}

export const SKILL: Readonly<Record<SkillTier, SkillDef>> = {
  NOVICE: { pClear: 0.3, failMult: 1.4, linesDist: [0.78, 0.18, 0.035, 0.005], crystalAim: 0.05 },
  BASE: { pClear: 0.35, failMult: 1.0, linesDist: [0.78, 0.18, 0.035, 0.005], crystalAim: 0.15 },
  SKILLED: { pClear: 0.42, failMult: 0.4, linesDist: [0.7, 0.24, 0.05, 0.01], crystalAim: 0.25 }
};

export const FREQ: Readonly<Record<FreqTier, FreqDef>> = {
  LIGHT: { sessionsPerDay: 2.0, gamesPerSession: 1.0, modeMix: { journey: 0.75, classic: 0.1, field: 0.15 }, skipDayP: 0.2 },
  CORE: { sessionsPerDay: 3.0, gamesPerSession: 1.0, modeMix: { journey: 0.65, classic: 0.2, field: 0.15 }, skipDayP: 0.05 },
  HEAVY: { sessionsPerDay: 4.5, gamesPerSession: 1.0, modeMix: { journey: 0.55, classic: 0.35, field: 0.1 }, skipDayP: 0.01 }
};

/** Доли популяции (12 §2.1). Σ = 1.00; проверяется assertShares(). */
export const SHARES: Readonly<Record<SkillTier, Readonly<Record<FreqTier, number>>>> = {
  NOVICE: { LIGHT: 0.14, CORE: 0.12, HEAVY: 0.04 },
  BASE: { LIGHT: 0.12, CORE: 0.26, HEAVY: 0.12 },
  SKILLED: { LIGHT: 0.04, CORE: 0.12, HEAVY: 0.04 }
};

/** Базовые склонности ячейки BASE×CORE (12 §2.4). Прочие сегменты берут те же
 * с поправкой на failMult/skill через stress и winrate — упрощение модели §1. */
export const PROP = {
  rwAccept: { rw1: 0.45, rw2: 0.4, rw3: 0.3, rw4: 0.25 },
  continueBaseP: 0.25,
  boosterIntensity: { hammer: 0.17, swap: 0.15, undo: 0.27 },
  buySkinP: 0.03,
  buyTicketP: 0.15,
  restoreStreakP: 0.4,
  restoreStreakLoP: 0.05
} as const;

/* ============== КАЛИБРОВОЧНЫЕ РУЧКИ (12 §8, свободные EV) =============== */

export interface EcpmTune {
  rw: number;
  int: number;
  banner: number;
}

/** TUNE-слой: калиброванный baseline (econ-sim.baseline, 12 §8.2). Всё, что
 * здесь — НЕ номинал (INV-E1), а поведенческая модель/допущение (§8.3). */
export interface Tune {
  /** Свободные источники (EV/день, ячейка BASE×CORE). */
  missionsEV: number;
  weeklyBundleEV: number;
  wheelWeightsLow: boolean;
  noveltyAmp: number;
  engageDecay: number;
  /** Форма расхода (спрос на бустеры = intensity × stress(level) × scale). */
  boosterScale: number;
  stressFloor: number;
  stressSlope: number;
  stressCap: number;
  bossStress: number;
  continueScale: number;
  /** Сложность сегмента 21–60 (09 §6 тест №7): ×fail в hard. */
  W_HARD: number;
  /** P(continue конвертирует провал в победу) — 12 §4.2. */
  winP: number;
  /** Монетизация (для ad-ARPDAU и гейтов, 06 §4 / 09 §4). */
  rw2Mult: number;
  intPerDau: number;
  bannerPerDau: number;
  ecpm: EcpmTune;
  /** Стартовый грант (09 §6-подобный тест: 200 vs 300). */
  startGrant: number;
  /** Дневные капы rewarded (тюнинг/эксперименты). */
  rw2Cap: number;
  intCap: number;
}

/** Частичные переопределения кокпита поверх книги (ecpm — тоже частично). */
export interface TuneOverrides extends Partial<Omit<Tune, 'ecpm'>> {
  ecpm?: Partial<EcpmTune>;
}

export const BOOK_TUNE: Readonly<Tune> = {
  missionsEV: 10, // daily-миссии: калибровка ужала EV (12 §8.4)
  weeklyBundleEV: 150, // недельный всплеск = weekly-миссии + турнир (12 §5)
  wheelWeightsLow: true, // колесо взвешено к нижним секторам, EV ≈ 42
  noveltyAmp: 0.3, // novelty(t) = 1 + amp·e^(−t/4): энтузиазм первых дней (12 §5.1)
  engageDecay: 0.1, // мягкий спад числа партий за лайфтайм (зрелость игрока)
  boosterScale: 1.3, // общий множитель спроса на бустеры (калибровка §8.2 п.3)
  stressFloor: 0.4, // stress при низком уровне (ранние траты «учимся», 05 §4)
  stressSlope: 0.065, // рост stress с уровнем (форма кривой расхода)
  stressCap: 1.85, // потолок stress (плато расхода к D20+, 05 §4)
  bossStress: 2.2, // stress на боссе (пик спроса, 05 §7 п.1)
  continueScale: 1.0, // множитель к continueBaseP
  W_HARD: 1.0,
  winP: 0.75,
  rw2Mult: 2, // множитель RW-2 «×2 монеты» (09 §6 тест №6: ×2 vs ×3)
  intPerDau: 7.0, // interstitial/DAU (не влияет на монеты, 09 §4)
  bannerPerDau: 35, // banner/DAU (09 §4)
  ecpm: { rw: 16.0, int: 14.0, banner: 0.5 }, // T1-прокси soft-launch (06 §4)
  startGrant: 200,
  rw2Cap: 3,
  intCap: 7
};

/* ============= ОПОРНЫЕ ДАННЫЕ ГЛАВ (цели калибровки, 12 §8.1) =========== */

/** Медиана баланса на конец дня, 05 §4. */
export const BALANCE_05: Readonly<Record<number, number>> = {
  1: 450, 2: 650, 3: 790, 4: 890, 5: 960, 6: 1000, 7: 1160, 8: 1170, 9: 1170, 10: 1155,
  11: 1135, 12: 1105, 13: 1070, 14: 1180, 15: 1130, 16: 1075, 17: 1010, 18: 945, 19: 870, 20: 790,
  21: 860, 22: 775, 23: 685, 24: 590, 25: 490, 26: 390, 27: 285, 28: 325, 29: 215, 30: 100
};

export const EARN_05: Readonly<Record<number, number>> = {
  1: 550, 2: 380, 3: 360, 4: 350, 5: 350, 6: 340, 7: 480, 8: 330, 9: 330, 10: 325,
  11: 320, 12: 320, 13: 315, 14: 470, 15: 310, 16: 310, 17: 305, 18: 305, 19: 300, 20: 300,
  21: 450, 22: 295, 23: 295, 24: 290, 25: 290, 26: 290, 27: 285, 28: 435, 29: 285, 30: 285
};

export const SPEND_05: Readonly<Record<number, number>> = {
  1: 100, 2: 180, 3: 220, 4: 250, 5: 280, 6: 300, 7: 320, 8: 320, 9: 330, 10: 340,
  11: 340, 12: 350, 13: 350, 14: 360, 15: 360, 16: 365, 17: 370, 18: 370, 19: 375, 20: 380,
  21: 380, 22: 380, 23: 385, 24: 385, 25: 390, 26: 390, 27: 390, 28: 395, 29: 395, 30: 400
};

/** Чекпоинты калибровки M1 (12 §8.1). */
export const CHECKPOINTS: readonly number[] = [1, 7, 8, 14, 21, 25, 30];

/** Кривая удержания (09 §5.1) для COHORT-режима и LT/ROAS в гейтах. */
export const RETENTION: Readonly<Record<number, number>> = {
  1: 38, 2: 30, 3: 25, 4: 22, 5: 19, 6: 17, 7: 15, 14: 10.5, 30: 6, 60: 4, 90: 3
};

export type LevelSegment = 's1_5' | 's6_20' | 's21_60' | 's60p';

/** Fail-коридоры сегментов уровней (03 §5.2 / 12 §7 M3), в долях. */
export const FAIL_CORRIDORS: Readonly<Record<LevelSegment, readonly [number, number]>> = {
  s1_5: [0.0, 0.02],
  s6_20: [0.05, 0.1],
  s21_60: [0.12, 0.18],
  s60p: [0.18, 0.25]
};

/** Порядок сегментов — детерминированная раскладка популяции (12 §2.1). */
export const SKILL_ORDER: readonly SkillTier[] = ['NOVICE', 'BASE', 'SKILLED'];
export const FREQ_ORDER: readonly FreqTier[] = ['LIGHT', 'CORE', 'HEAVY'];
export const LEVEL_SEGMENTS: readonly LevelSegment[] = ['s1_5', 's6_20', 's21_60', 's60p'];

/** Σ долей популяции = 1.00 (12 §2.1). */
export function assertShares(): boolean {
  let sum = 0;
  for (const sk of SKILL_ORDER) for (const fq of FREQ_ORDER) sum += SHARES[sk][fq];
  return Math.abs(sum - 1) < 1e-9;
}
