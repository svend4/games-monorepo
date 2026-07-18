/**
 * Симулятор экономики WordGrove (Проход Е.3, порт prototype/sim.js 1:1).
 * Реализация офлайн-инструмента приложения 12-economy-sim.md: N виртуальных
 * игроков сетки беглость×вовлечённость (12 §2.1) × 30 дней: прохождение
 * уровней по кривой сложности 03 §6.2, монеты sources/sinks (05 §2), лестница
 * подсказок (перемешать → RV-1 → платная, 03 §3), копилка жёлудей, окно
 * конверсии D15–D30. На выходе — баланс по дням против таблицы 05 §4, доля
 * выручки реклама/подписка/IAP против цели 65/22/13 (06 §1), ARPDAU,
 * подсказки/день (M-5), rewarded/DAU (M-6).
 *
 * ДЕТЕРМИНИЗМ (INV-S2): seeded-RNG mulberry32 из src/core/rng, сид игрока =
 * fnv1a32('wordgrove:econsim:v1:{runId}:{playerId}') — та же схема, что у
 * генератора уровней (11 §1). НИКАКИХ Math.random / Date.now в расчётах —
 * seed приходит параметром (runId). Порядок вызовов RNG сохранён 1:1 с
 * прототипом: `npm run sim -- seed42 200` печатает БИТ-В-БИТ тот же текст,
 * что `node ../prototype/sim.js seed42 200` (проверяется diff'ом).
 *
 * ДВА ВХОДА — ОДИН МОДУЛЬ: браузер (CockpitUi через experiments) и headless
 * CLI (src/sim/cli.ts) вызывают этот же код.
 *
 * РЕЖИМЫ (12 §5): REF — детерминированный EV-твин MEDIAN×CORE (survivor,
 * трекает таблицу 05 §4); MC — Монте-Карло по всей сетке §2.1; COHORT — MC ×
 * кривая удержания R(t)=0,42·t^(−0,435) (09 §4.2): метрики на DAU.
 */
import { fnv1a32, mulberry32 } from '../core/rng';
import type { Rng } from '../core/types';

/* ========================= НОМИНАЛЫ (INV-S1, 12 §3) ====================
 * Зеркало 05 §2 / 06 §3, §5. ЕДИНСТВЕННОЕ место этих чисел в симуляторе;
 * симулятор их НЕ калибрует. */

export const PRICES = {
  lamp: 100, scope: 150, rocket: 350, // подсказки, 05 §2.1 = 03 §2.4
  streakFreeze: 500, // 05 §2.1
  eventCatchup: 300, // догон дня тематической недели, 05 §2.1
  wheelSpin3: 200 // повтор колеса (3-й спин), 05 §2.1
} as const;

export const EARN = {
  levelBase: 20, brilliantBonus: 5, // 05 §2.1 = 03 §2.5 («20–25 монет»)
  daily: 40, // daily-кроссворд, 1/день с D2
  wheelEV: 60, wheelRange: [25, 500] as readonly [number, number], // колесо, EV ≈ 60
  dailyMissionEach: [30, 60] as readonly [number, number], dailyMissionNominalPerDay: 120, // 3 миссии
  weeklyNominal: 550, // weekly-миссии суммарно ~550/нед, 05 §2.1
  streakMilestones: { 3: 50, 7: 120, 14: 250, 30: 600 } as Readonly<Record<number, number>>, // 05 §2.1
  regionAlbum: 300, // раз в регион, 05 §2.1
  eventWeekEV: [200, 500] as readonly [number, number], // ивенты, EV за неделю
  acornPerBonusWord: 2, piggyCap: 200, piggyOpenAt: 150, // 05 §2.2, 06 §3.1 (RV-5)
  startCoins: 300, ftueLamps: 2, // старт 300; 2 Лампы на ур. 7 (05 §3)
  subCoinBonus: 0.2 // +20% монет у подписчиков (06 §5.1) — сценарий S2
} as const;

export const CAPS = {
  hintStack: 99, freezes: 3, // 05 §1
  rv1PerLevel: 1, rv1PerDay: 4, rv3PerDay: 1, // 06 §3.1
  piggy: 200
} as const;

/* Базовая вероятность застревания за уровень по баккету (12 §2.2). */
export const P_STUCK: Readonly<Record<number, number>> = { 1: 0.05, 2: 0.1, 3: 0.18, 4: 0.28, 5: 0.45 };
export const PEAK_MULT = 1.6; // каждый 10-й уровень — пик (03 §6.2)

/* ===================== СЕГМЕНТЫ ИГРОКА (12 §2) ========================= */

export type SkillTier = 'STRUGGLER' | 'MEDIAN' | 'FLUENT';
export type FreqTier = 'DAILY' | 'CORE' | 'POWER';

export interface FluencyDef {
  stuckMult: number;
  solveMult: number;
  bonusPerLevel: number;
  brilliantShare: number;
}

export interface EngagementDef {
  levelsPerDay: (d: number) => number;
  sessionsPerDay: number;
  doesDailyP: number;
  missionP: number;
  weeklyP: number;
  skipDayP: number;
}

// Беглость (skill), 12 §2.2. MEDIAN: 20 + 0.40×5 = 22 монеты/уровень (05 §4).
export const FLUENCY: Readonly<Record<SkillTier, FluencyDef>> = {
  STRUGGLER: { stuckMult: 1.5, solveMult: 1.35, bonusPerLevel: 1.5, brilliantShare: 0.15 },
  MEDIAN: { stuckMult: 1.0, solveMult: 1.0, bonusPerLevel: 3.0, brilliantShare: 0.4 },
  FLUENT: { stuckMult: 0.55, solveMult: 0.75, bonusPerLevel: 5.0, brilliantShare: 0.65 }
};

// Вовлечённость (frequency), 12 §2.3. CORE.missionP = 0.70 — допущение 05 §4.
export const ENGAGEMENT: Readonly<Record<FreqTier, EngagementDef>> = {
  DAILY: {
    levelsPerDay: () => 1,
    sessionsPerDay: 1.2, doesDailyP: 0.95, missionP: 0.4, weeklyP: 0.05, skipDayP: 0.25
  },
  CORE: {
    levelsPerDay: (d) => coreLevels(d),
    sessionsPerDay: 2.5, doesDailyP: 0.9, missionP: 0.7, weeklyP: 0.25, skipDayP: 0.06
  },
  POWER: {
    levelsPerDay: (d) => Math.min(20, coreLevels(d) + 12),
    sessionsPerDay: 3.5, doesDailyP: 0.95, missionP: 0.95, weeklyP: 0.8, skipDayP: 0.02
  }
};

// Расписание CORE уровней/день (05 §4): d1:12, d2–3:9, d4–7:8, d8–14:7, d15–30:6.
export function coreLevels(d: number): number {
  if (d <= 1) return 12;
  if (d <= 3) return 9;
  if (d <= 7) return 8;
  if (d <= 14) return 7;
  return 6;
}

// Доли популяции (12 §2.1). Σ = 1.00; проверяется assertShares().
export const SHARES: Readonly<Record<SkillTier, Readonly<Record<FreqTier, number>>>> = {
  STRUGGLER: { DAILY: 0.08, CORE: 0.15, POWER: 0.02 }, // Σ 0.25
  MEDIAN: { DAILY: 0.12, CORE: 0.3, POWER: 0.08 }, // Σ 0.50
  FLUENT: { DAILY: 0.05, CORE: 0.15, POWER: 0.05 } // Σ 0.25
};

export const SKILL_ORDER: readonly SkillTier[] = ['STRUGGLER', 'MEDIAN', 'FLUENT'];
export const FREQ_ORDER: readonly FreqTier[] = ['DAILY', 'CORE', 'POWER'];

// Поведенческие склонности ячейки MEDIAN×CORE (12 §2.4).
export const PROP = {
  rvAccept: { rv1: 0.3, rv2: 0.08, rv3: 0.55, rv5: 0.85, rv6: 0.5, rv7: 0.4 },
  hintLadder: { shuffleResolveP: 0.6, lampP: 0.55, scopeP: 0.18, rocketPeakP: 0.35 },
  wheelSpin3P: 0.1, freezeBuyP: 0.4, eventCatchupP: 0.1
} as const;

// Распределение платной подсказки при застревании (03 §3).
const SCOPE_SPLIT = 0.3; // доля не-пиковых платных застреваний → Прицел (05 §8)
const PEAK_ROCKET_P = 0.85; // на пике при доступном балансе покупается Ракета (05 §7 п.1)
const HINT_CEIL = 2.0; // потолок платных подсказок/уровень (03 §3, лестница)

/* ============== КАЛИБРОВОЧНЫЕ РУЧКИ (12 §8, свободные параметры) ======== */

export interface EcpmTune {
  rw: number;
  int: number;
  banner: number;
}

export interface Tune {
  spendScale: number;
  hintCeil: number;
  stressD1_3: number;
  stressD7: number;
  stressD14: number;
  stressD20: number;
  stressD30: number;
  missionEV: number;
  weeklyEV: number;
  eventEV: number;
  rv2Mult: number;
  intPerDau: number;
  bannerPerDau: number;
  ecpm: EcpmTune;
  startCoins: number;
  rv1DayCap: number;
  intCap: number;
  lampPrice: number;
  rocketPrice: number;
  /** Проносится A/B sub_trial (кокпит); самим симулятором не используется. */
  trialDays?: number;
}

/** Частичные переопределения ручек (кокпит/A/B). */
export interface TuneOverrides {
  spendScale?: number;
  hintCeil?: number;
  stressD1_3?: number;
  stressD7?: number;
  stressD14?: number;
  stressD20?: number;
  stressD30?: number;
  missionEV?: number;
  weeklyEV?: number;
  eventEV?: number;
  rv2Mult?: number;
  intPerDau?: number;
  bannerPerDau?: number;
  ecpm?: Partial<EcpmTune>;
  startCoins?: number;
  rv1DayCap?: number;
  intCap?: number;
  lampPrice?: number;
  rocketPrice?: number;
  trialDays?: number;
}

/** Калиброванный baseline «книги» (12 §8): REF трекает 05 §4. */
export const BOOK_TUNE: Tune = {
  // Форма spendStress(d) (§8.3 шаг 1) × spendScale — подобраны покоординатным
  // спуском так, чтобы баланс REF трекал таблицу 05 §4 (6/6 чекпоинтов ±12%).
  spendScale: 5.0,
  hintCeil: 1.2,
  stressD1_3: 0.35, stressD7: 0.7, stressD14: 1.1, stressD20: 1.1, stressD30: 1.0,
  // Свободные EV источников (12 §8, ячейка MEDIAN×CORE):
  missionEV: 84, // daily-миссии: 120 × missionP(0.70) = 84 (05 §4)
  weeklyEV: 550, // weekly-миссии суммарно ~550/нед (05 §2.1) — только MC
  eventEV: 350, // ивент-неделя EV (05 §2.1, [200..500]) — только MC
  // Монетизация (для ad-ARPDAU и гейтов, 06 §8 / 09 §3):
  rv2Mult: 2, // множитель RV-2 «×2 монеты уровня» (сценарий S4)
  intPerDau: 3.2, // interstitial/DAU (09 §3, 06 §3.2)
  bannerPerDau: 9.0, // banner/DAU (09 §3)
  // eCPM по умолчанию — БЛЕНД 60/40 T1/T2-3 (06 §8.2), как DEFAULT_GEO:
  ecpm: { rw: 13.0, int: 10.0, banner: 0.4 },
  startCoins: 300, // стартовый грант (05 §3)
  rv1DayCap: 4, intCap: 12, // дневные капы rewarded/INT (06 §3.1/§4)
  // НОМИНАЛ-сценарии A/B (05 §10 / приложение 12 S3) — вне панели тюнинга:
  lampPrice: 100, // цена Лампы (S: 100 vs 80, только вниз — 05 §10)
  rocketPrice: 350 // цена Ракеты (S3: 350 vs 300/400)
};

/* ============ ОПОРНЫЕ ДАННЫЕ 05 §4 (цели калибровки, INV-S4) ============ */

export const EARN_05: Readonly<Record<number, number>> = {
  1: 264, 2: 298, 3: 382, 4: 360, 5: 360, 6: 360, 7: 480, 8: 338, 9: 338, 10: 338,
  11: 338, 12: 338, 13: 338, 14: 588, 15: 316, 16: 316, 17: 316, 18: 316, 19: 316, 20: 316,
  21: 316, 22: 316, 23: 316, 24: 316, 25: 316, 26: 316, 27: 316, 28: 316, 29: 316, 30: 916
};
export const SPEND_05: Readonly<Record<number, number>> = {
  1: 0, 2: 100, 3: 100, 4: 200, 5: 250, 6: 250, 7: 250, 8: 300, 9: 300, 10: 450,
  11: 300, 12: 350, 13: 350, 14: 400, 15: 400, 16: 350, 17: 400, 18: 400, 19: 450, 20: 500,
  21: 400, 22: 450, 23: 400, 24: 450, 25: 450, 26: 400, 27: 450, 28: 450, 29: 400, 30: 450
};
export const BALANCE_05: Readonly<Record<number, number>> = {
  1: 564, 2: 762, 3: 1044, 4: 1204, 5: 1314, 6: 1424, 7: 1654, 8: 1692, 9: 1730, 10: 1618,
  11: 1656, 12: 1644, 13: 1632, 14: 1820, 15: 1736, 16: 1702, 17: 1618, 18: 1534, 19: 1400, 20: 1216,
  21: 1132, 22: 998, 23: 914, 24: 780, 25: 646, 26: 562, 27: 428, 28: 294, 29: 210, 30: 676
};
// Чекпоинты калибровки: профит-недели, структурный дефицит, первое «дно», D30.
export const CHECKPOINTS: readonly number[] = [1, 7, 14, 21, 27, 30];

// Кривая удержания базового сценария (09 §4.2): R(t) = D1 · t^(−β).
const RET_D1 = 0.42;
const RET_BETA = 0.435;

/** Целевые частоты подсказок D14+ (M-5, 05 §2.1). */
export const HINT_TARGETS = { lamp: 1.1, scope: 0.4, rocket: 0.15 } as const;
/** Целевые rewarded показы/DAU по плейсментам (M-6, 06 §3.1). */
export const RW_TARGETS = { rv1: 0.3, rv2: 0.55, rv3: 0.2, rv5: 0.35, rv6: 0.03, rv7: 0.02 } as const;

/* ============================ ТИПЫ ПРОГОНА ============================== */

export type SimMode = 'REF' | 'MC' | 'COHORT';

export interface SimOptions {
  N?: number;
  days?: number;
  runId?: string;
  mode?: SimMode;
  tune?: TuneOverrides;
}

type RwKey = 'rv1' | 'rv2' | 'rv3' | 'rv5' | 'rv6' | 'rv7';
const RW_KEYS: readonly RwKey[] = ['rv1', 'rv2', 'rv3', 'rv5', 'rv6', 'rv7'];

interface HintCounts {
  lamp: number;
  scope: number;
  rocket: number;
}

interface DayLog {
  day: number;
  earn: number;
  spend: number;
  quits: number;
  softPaywall: number;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
  denied: Record<string, number>;
  hints: HintCounts;
  rw: Record<RwKey, number>;
  lastLevelReward: number;
  balanceEOD: number;
  skipped: boolean;
  levels: number;
}

interface Player {
  id: number;
  skillTier: SkillTier;
  freqTier: FreqTier;
  flu: FluencyDef;
  eng: EngagementDef;
  coins: number;
  piggy: number;
  piggyBurned: number;
  streak: number;
  freezes: number;
  level: number;
  day: number;
  rv1DayUsed: number;
  hintsUsedThisLevel: boolean;
  lastLevelReward: number;
  sub: boolean;
  firstDeficitDay: number;
  firstPressureDay: number;
  rng: Rng;
  aliveUntil: number;
}

export interface RefDayRow {
  day: number;
  balance: number;
  earn: number;
  spend: number;
  target05: number;
  earn05: number;
  spend05: number;
  devPct: number;
  earnDevPct: number;
  spendDevPct: number;
  hints: HintCounts;
  firstDeficitDay: number;
}

export interface RefCheckpoint {
  day: number;
  sim: number;
  target: number;
  devPct: number;
}

export interface RefReport {
  earnExact: boolean;
  maxEarnDevPct: number;
  maxSpendDevPct: number;
  maxBalDevPct: number;
  checkpoints: RefCheckpoint[];
  checkpointsWithin8: number;
  checkpointsWithin12: number;
  checkpointsTotal: number;
  d30: number;
  d30Target: number;
  d30Ok: boolean;
  firstDeficitDay: number;
  t1Pass: boolean;
  t2Pass: boolean;
}

export interface McDayRow {
  day: number;
  balanceMedianCore: number;
  balP10: number;
  balP50: number;
  balP90: number;
  target05: number;
  devPct: number;
  earnMean: number;
  spendMean: number;
  ratio: number;
  deficitShare: number;
  pressureShare: number;
  lampsPerDau: number;
  scopesPerDau: number;
  rocketsPerDau: number;
  rwByPlacement: Record<RwKey, number>;
  activeCount: number;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
  dailyEarn: number;
  powerEarn: number;
  powerSpend: number;
  mcLampPer: number;
  mcScopePer: number;
  mcRocketPer: number;
}

export interface McAggregates {
  firstDeficitMedian: number;
  deficitShareD30: number;
  balanceD30Median: number;
  windowShifted: boolean;
  hintsD14: HintCounts;
  hintTargets: typeof HINT_TARGETS;
  rwPerPlacement: Record<RwKey, number>;
  rwTargets: typeof RW_TARGETS;
  rwTotal: number;
  adArpdau: number;
  ratioMean: number;
  dailyEarnD14: number;
  powerEarnD14: number;
  powerSpendD14: number;
}

export interface SimMeta {
  runId: string;
  mode: SimMode;
  days: number;
  N?: number;
  tune: Tune;
  sharesOk: boolean;
}

/** Сводка прогона: REF несёт byDay+ref, MC/COHORT — byDay+aggregates+flags. */
export interface SimSummary {
  meta: SimMeta;
  byDay: RefDayRow[] | McDayRow[];
  ref?: RefReport;
  aggregates?: McAggregates;
  flags?: string[];
}

export interface RefSummary extends SimSummary {
  byDay: RefDayRow[];
  ref: RefReport;
}

export interface McSummary extends SimSummary {
  byDay: McDayRow[];
  aggregates: McAggregates;
  flags: string[];
}

/* ============================ УТИЛИТЫ ================================== */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function randInt(rng: Rng, a: number, b: number): number {
  return Math.floor(a + (b - a + 1) * rng());
}
function median(arr: readonly number[]): number {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}
function quantile(arr: readonly number[], q: number): number {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return a[base + 1] !== undefined
    ? (a[base] as number) + rest * ((a[base + 1] as number) - (a[base] as number))
    : (a[base] as number);
}
function mean(arr: readonly number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] as number;
  return s / arr.length;
}

export function assertShares(): boolean {
  let sum = 0;
  for (const sk of SKILL_ORDER) for (const fq of FREQ_ORDER) sum += SHARES[sk][fq];
  return Math.abs(sum - 1) < 1e-9;
}

/** Сид игрока — та же схема, что в прототипе (11 §1). */
export function seedOf(runId: string, playerId: number): number {
  return fnv1a32('wordgrove:econsim:v1:' + runId + ':' + playerId);
}

/** Сборка мердж-конфига: книга + переопределения кокпита. */
export function mergeTune(over?: TuneOverrides): Tune {
  const t: Tune = { ...BOOK_TUNE, ecpm: { ...BOOK_TUNE.ecpm } };
  if (over) {
    const { ecpm, ...rest } = over;
    for (const k of Object.keys(rest) as Array<keyof typeof rest>) {
      const v = rest[k];
      if (v !== undefined) (t as unknown as Record<string, number>)[k] = v;
    }
    if (ecpm) {
      t.ecpm = {
        rw: ecpm.rw ?? BOOK_TUNE.ecpm.rw,
        int: ecpm.int ?? BOOK_TUNE.ecpm.int,
        banner: ecpm.banner ?? BOOK_TUNE.ecpm.banner
      };
    }
  }
  return t;
}

/* ==================== КРИВАЯ СЛОЖНОСТИ (03 §6.2) ====================== */

const SAWTOOTH: readonly number[] = [-1, 0, 0, 1, 0, -1, 0, 1, 0, 2];

function diffToBucket(diff: number): number {
  if (diff < 0.25) return 1;
  if (diff < 0.45) return 2;
  if (diff < 0.6) return 3;
  if (diff < 0.75) return 4;
  return 5;
}

export function bucketForLevel(n: number): { bucket: number; isPeak: boolean } {
  const diff = 0.1 + (0.62 - 0.1) * (1 - Math.exp(-n / 120));
  const base = diffToBucket(diff);
  const pos = (((n - 1) % 10) + 10) % 10; // 0..9
  const bucket = clamp(base + (SAWTOOTH[pos] as number), 1, 5);
  return { bucket, isPeak: pos === 9 }; // пик = каждый 10-й уровень
}

/* ==================== spendStress(d) (§8.3 шаг 1) ===================== */

export function spendStress(d: number, tune: Tune): number {
  const s7 = tune.stressD7 !== undefined ? tune.stressD7 : (tune.stressD1_3 + tune.stressD14) / 2;
  let s: number;
  if (d <= 3) s = tune.stressD1_3;
  else if (d <= 7) s = tune.stressD1_3 + ((s7 - tune.stressD1_3) * (d - 3)) / (7 - 3);
  else if (d <= 14) s = s7 + ((tune.stressD14 - s7) * (d - 7)) / (14 - 7);
  else if (d <= 20) s = tune.stressD14 + ((tune.stressD20 - tune.stressD14) * (d - 14)) / (20 - 14);
  else s = tune.stressD20 + ((tune.stressD30 - tune.stressD20) * (d - 20)) / (30 - 20);
  return s * tune.spendScale;
}

/* ==================== ТРАНЗАКЦИИ (монеты; INV-S3) ===================== */

function earn(pl: Player, log: DayLog, amount: number, source: string): void {
  amount = Math.round(amount * (pl.sub ? 1 + EARN.subCoinBonus : 1));
  if (amount <= 0) return;
  pl.coins += amount;
  log.earn += amount;
  log.earnBySource[source] = (log.earnBySource[source] ?? 0) + amount;
}

function spend(pl: Player, log: DayLog, amount: number, sink: string): boolean {
  amount = Math.round(amount);
  if (amount <= 0) return true;
  if (pl.coins < amount) {
    log.denied[sink] = (log.denied[sink] ?? 0) + 1;
    log.softPaywall++;
    return false;
  }
  pl.coins -= amount;
  log.spend += amount;
  log.spendBySink[sink] = (log.spendBySink[sink] ?? 0) + amount;
  return true;
}

function priceOf(kind: 'lamp' | 'rocket' | 'scope', tune: Tune): number {
  if (kind === 'lamp') return tune.lampPrice;
  if (kind === 'rocket') return tune.rocketPrice;
  return PRICES.scope;
}

/* ==================== ЖЁЛУДИ / КОПИЛКА (05 §2.2) ===================== */

function addAcorns(pl: Player, n: number): void {
  n = Math.max(0, Math.round(n));
  const space = Math.max(0, EARN.piggyCap - pl.piggy);
  const added = Math.min(n, space);
  pl.piggy += added;
  pl.piggyBurned += n - added; // переполнение сгорает (INV-S3)
}

/* ==================== ЛЕСТНИЦА ПОДСКАЗОК (03 §3, 12 §4) ==============
 * Порядок вызовов RNG внутри 1:1 с прототипом (short-circuit сохранён). */

function playLevel(pl: Player, rng: Rng, tune: Tune, log: DayLog): void {
  const n = pl.level;
  const lvl = bucketForLevel(n);
  pl.hintsUsedThisLevel = false;
  const s = spendStress(pl.day, tune);
  const load = clamp(
    (P_STUCK[lvl.bucket] as number) * pl.flu.stuckMult * (lvl.isPeak ? PEAK_MULT : 1) * s * (1 - PROP.hintLadder.shuffleResolveP),
    0,
    tune.hintCeil || HINT_CEIL
  );
  const nHelp = Math.floor(load) + (rng() < load - Math.floor(load) ? 1 : 0);
  let needed = false;
  let unsolved = false;
  for (let h = 0; h < nHelp; h++) {
    needed = true;
    // RV-1 (бесплатная Лампа за просмотр) — 1/уровень, ≤4/день (06 §3.1).
    if (h === 0 && pl.rv1DayUsed < tune.rv1DayCap && rng() < PROP.rvAccept.rv1) {
      log.rw.rv1++;
      pl.rv1DayUsed++;
      pl.hintsUsedThisLevel = true;
      continue;
    }
    let bought = false;
    if (h === 0 && lvl.isPeak && pl.coins >= priceOf('rocket', tune) && rng() < PEAK_ROCKET_P) {
      if (spend(pl, log, priceOf('rocket', tune), 'rocket')) {
        log.hints.rocket++;
        bought = true;
      }
    } else if (h === 0 && !lvl.isPeak && rng() < SCOPE_SPLIT && pl.coins >= priceOf('scope', tune)) {
      if (spend(pl, log, priceOf('scope', tune), 'scope')) {
        log.hints.scope++;
        bought = true;
      }
    } else if (pl.coins >= priceOf('lamp', tune)) {
      if (spend(pl, log, priceOf('lamp', tune), 'lamp')) {
        log.hints.lamp++;
        bought = true;
      }
    }
    if (bought) pl.hintsUsedThisLevel = true;
    else unsolved = true;
  }
  if (needed && unsolved && rng() < 0.06) {
    // редкий выход (не хватило монет/помощи)
    log.quits++;
    pl.level++;
    return;
  }

  const brilliant = !pl.hintsUsedThisLevel && rng() < pl.flu.brilliantShare;
  const reward = EARN.levelBase + (brilliant ? EARN.brilliantBonus : 0);
  earn(pl, log, reward, 'level');
  log.lastLevelReward = reward;
  if (rng() < PROP.rvAccept.rv2) {
    log.rw.rv2++;
    earn(pl, log, reward * (tune.rv2Mult - 1), 'level_rv2');
  }
  addAcorns(pl, Math.round(pl.flu.bonusPerLevel) * EARN.acornPerBonusWord);
  pl.level++;
}

/* ==================== КОЛЕСО / МИССИИ / СТРИК ======================== */

function wheelPrize(rng: Rng): number {
  // EV ≈ 60, диапазон [25..500], взвешено к нижним секторам.
  const v = [25, 40, 60, 90, 150, 300, 500];
  const w = [0.34, 0.26, 0.18, 0.12, 0.06, 0.028, 0.012];
  const r = rng();
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    acc += w[i] as number;
    if (r < acc) return v[i] as number;
  }
  return v[0] as number;
}

function grantStreakMilestone(pl: Player, log: DayLog): void {
  const m = EARN.streakMilestones[pl.streak];
  if (m) earn(pl, log, m, 'streak_milestone');
}

function handleMissedDay(pl: Player, rng: Rng, _tune: Tune, log: DayLog): void {
  if (pl.streak >= 7) {
    // горячая точка (05 §7 п.3)
    if (pl.freezes > 0) {
      pl.freezes--;
      log.balanceEOD = pl.coins;
      return;
    }
    if (rng() < PROP.rvAccept.rv6) {
      log.rw.rv6++;
      log.balanceEOD = pl.coins;
      return; // RV-6 серия
    }
    if (pl.coins >= PRICES.streakFreeze && rng() < PROP.freezeBuyP) {
      if (spend(pl, log, PRICES.streakFreeze, 'freeze')) {
        log.balanceEOD = pl.coins;
        return;
      }
    }
  }
  pl.streak = 0;
  log.balanceEOD = pl.coins;
}

/* ============================ МОДЕЛЬ ДНЯ (12 §4) ====================== */

function emptyLog(d: number): DayLog {
  return {
    day: d, earn: 0, spend: 0, quits: 0, softPaywall: 0,
    earnBySource: {}, spendBySink: {}, denied: {},
    hints: { lamp: 0, scope: 0, rocket: 0 },
    rw: { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 },
    lastLevelReward: 20, balanceEOD: 0, skipped: false, levels: 0
  };
}

// MC/COHORT-день (сэмплирование). REF — детерминированный EV-твин (refDay ниже).
function simulateDay(pl: Player, d: number, rng: Rng, tune: Tune, _mode: SimMode): DayLog {
  const log = emptyLog(d);
  pl.day = d;
  pl.rv1DayUsed = 0;
  if (rng() < pl.eng.skipDayP) {
    log.skipped = true;
    handleMissedDay(pl, rng, tune, log);
    return log;
  }

  // --- 1. Daily-кроссворд и колесо (с D2) ---
  if (d >= 2 && rng() < pl.eng.doesDailyP) {
    earn(pl, log, EARN.daily, 'daily');
    pl.streak++;
    grantStreakMilestone(pl, log);
    earn(pl, log, wheelPrize(rng), 'wheel');
    if (rng() < PROP.rvAccept.rv3) {
      log.rw.rv3++;
      earn(pl, log, wheelPrize(rng), 'wheel_rv3');
    }
    if (rng() < PROP.wheelSpin3P && pl.coins > 500) {
      if (spend(pl, log, PRICES.wheelSpin3, 'wheel_spin3')) earn(pl, log, wheelPrize(rng), 'wheel_spin3');
    }
  }

  // --- 2. Daily-миссии (с D3; открытие на ур. 12) ---
  if (d >= 3) {
    for (let m = 0; m < 3; m++) if (rng() < pl.eng.missionP) earn(pl, log, randInt(rng, 30, 60), 'mission_daily');
  }

  // --- 3. Уровни атласа ---
  const nLevels = pl.eng.levelsPerDay(d);
  for (let i = 0; i < nLevels; i++) {
    playLevel(pl, rng, tune, log);
    log.levels++;
  }

  // --- 4. Копилка жёлудей (RV-5) ---
  if (pl.piggy >= EARN.piggyOpenAt && rng() < PROP.rvAccept.rv5) {
    log.rw.rv5++;
    earn(pl, log, pl.piggy, 'piggy');
    pl.piggy = 0;
  }

  // --- 5. Weekly-миссии и ивенты ---
  if (d % 7 === 0 && rng() < pl.eng.weeklyP) earn(pl, log, tune.weeklyEV, 'mission_weekly');
  if (isEventWeek(d)) {
    if (rng() < PROP.rvAccept.rv7) log.rw.rv7++;
    if (rng() < PROP.eventCatchupP && pl.coins >= PRICES.eventCatchup) spend(pl, log, PRICES.eventCatchup, 'event_catchup');
    earn(pl, log, tune.eventEV / 7, 'event');
  }

  // --- 6. Давление пейволла (окно конверсии, 06 §5.1) ---
  if (d >= 15 && pl.coins < 300 && !pl.firstPressureDay) pl.firstPressureDay = d;
  if (pl.coins < 300 && !pl.firstDeficitDay) pl.firstDeficitDay = d;

  log.balanceEOD = pl.coins;
  return log;
}

function isEventWeek(d: number): boolean {
  return d >= 8 && Math.floor((d - 1) / 7) % 2 === 1; // через неделю
}

/* ==================== СПАВН ИГРОКА / КОГОРТЫ ========================== */

export interface SegmentRow {
  skill: SkillTier;
  freq: FreqTier;
  share: number;
}

export function segmentTable(): SegmentRow[] {
  const rows: SegmentRow[] = [];
  for (const sk of SKILL_ORDER) {
    for (const fq of FREQ_ORDER) rows.push({ skill: sk, freq: fq, share: SHARES[sk][fq] });
  }
  return rows;
}

function spawnPlayer(id: number, runId: string, tune: Tune, N: number, forceSeg?: SegmentRow): Player {
  let chosen: SegmentRow;
  if (forceSeg) chosen = forceSeg;
  else {
    const rows = segmentTable();
    const frac = (id + 0.5) / N;
    let acc = 0;
    chosen = rows[rows.length - 1] as SegmentRow;
    for (let i = 0; i < rows.length; i++) {
      acc += (rows[i] as SegmentRow).share;
      if (frac < acc) {
        chosen = rows[i] as SegmentRow;
        break;
      }
    }
  }
  return {
    id, skillTier: chosen.skill, freqTier: chosen.freq,
    flu: FLUENCY[chosen.skill], eng: ENGAGEMENT[chosen.freq],
    coins: tune.startCoins,
    piggy: 0, piggyBurned: 0,
    streak: 0, freezes: 0,
    level: 1, day: 0,
    rv1DayUsed: 0, hintsUsedThisLevel: false, lastLevelReward: 20,
    sub: false,
    firstDeficitDay: 0, firstPressureDay: 0,
    rng: mulberry32(seedOf(runId, id)),
    aliveUntil: Infinity
  };
}

// Кривая удержания 09 §4.2: R(t) = D1 · t^(−β).
export function retentionAt(day: number): number {
  if (day <= 1) return RET_D1;
  return RET_D1 * Math.pow(day, -RET_BETA);
}

function churnDay(rng: Rng): number {
  const u = rng();
  for (let d = 1; d <= 30; d++) {
    if (u > retentionAt(d)) return d - 1;
  }
  return 30;
}

/* ======================= REF-ПРОГОН (EV-твин, 12 §5) ================== */

const REF_MILESTONES: Readonly<Record<number, number>> = { 7: 120, 14: 250, 30: 600 };

function refEarnDay(d: number, tune: Tune): number {
  let e = coreLevels(d) * 22; // уровни × (20 + 0.40×5) = 22 (12 §2.2)
  if (d >= 2) e += EARN.daily + EARN.wheelEV; // daily 40 + колесо EV 60
  if (d >= 3) e += tune.missionEV; // daily-миссии EV = 120×0.70 = 84
  if (REF_MILESTONES[d]) e += REF_MILESTONES[d] as number; // вехи стрика 7/14/30
  return e;
}

interface RefPlayer {
  coins: number;
  refLevel: number;
  firstDeficitDay: number;
}

interface RefSpendEv {
  spend: number;
  lamp: number;
  scope: number;
  rocket: number;
}

// EV трат за уровень, усреднённая по 10 фазам пилы (03 §6.2). Гейтится балансом.
function refLevelSpendEV(n: number, s: number, coins: number, tune: Tune): RefSpendEv {
  const diff = 0.1 + (0.62 - 0.1) * (1 - Math.exp(-n / 120));
  const base = diffToBucket(diff);
  const ceil = tune.hintCeil || HINT_CEIL;
  let spendEv = 0;
  let lamp = 0;
  let scope = 0;
  let rocket = 0;
  for (let ph = 0; ph < 10; ph++) {
    const bucket = clamp(base + (SAWTOOTH[ph] as number), 1, 5);
    const isPeak = ph === 9;
    const load = clamp((P_STUCK[bucket] as number) * (isPeak ? PEAK_MULT : 1) * s * (1 - PROP.hintLadder.shuffleResolveP), 0, ceil);
    const first = Math.min(load, 1) / 10;
    const second = Math.max(load - 1, 0) / 10;
    if (isPeak) {
      if (coins >= tune.rocketPrice) {
        spendEv += first * tune.rocketPrice;
        rocket += first;
      } else if (coins >= tune.lampPrice) {
        spendEv += first * tune.lampPrice;
        lamp += first;
      }
    } else {
      const lampShare = first * (1 - SCOPE_SPLIT);
      const scopeShare = first * SCOPE_SPLIT;
      if (coins >= tune.lampPrice) {
        spendEv += lampShare * tune.lampPrice;
        lamp += lampShare;
      }
      if (coins >= PRICES.scope) {
        spendEv += scopeShare * PRICES.scope;
        scope += scopeShare;
      }
    }
    if (second > 0 && coins >= tune.lampPrice) {
      spendEv += second * tune.lampPrice;
      lamp += second;
    }
  }
  return { spend: spendEv, lamp, scope, rocket };
}

function refSpendDay(pl: RefPlayer, d: number, tune: Tune): RefSpendEv {
  if (d === 1) {
    // FTUE: 2 беспл. Лампы (05 §3)
    pl.refLevel += coreLevels(1);
    return { spend: 0, lamp: 0, scope: 0, rocket: 0 };
  }
  const s = spendStress(d, tune);
  const levels = coreLevels(d);
  let spent = 0;
  let lamp = 0;
  let scope = 0;
  let rocket = 0;
  for (let i = 0; i < levels; i++) {
    const ev = refLevelSpendEV(pl.refLevel + i, s, pl.coins, tune);
    spent += ev.spend;
    pl.coins -= ev.spend;
    lamp += ev.lamp;
    scope += ev.scope;
    rocket += ev.rocket;
  }
  pl.refLevel += levels;
  return { spend: spent, lamp, scope, rocket };
}

function runRef(tune: Tune, days: number, _runId: string): RefDayRow[] {
  const pl: RefPlayer = { coins: tune.startCoins, refLevel: 1, firstDeficitDay: 0 };
  const byDay: RefDayRow[] = [];
  for (let d = 1; d <= days; d++) {
    const e = refEarnDay(d, tune);
    pl.coins += e;
    const sp = refSpendDay(pl, d, tune);
    if (pl.coins < 300 && !pl.firstDeficitDay) pl.firstDeficitDay = d;
    const target = BALANCE_05[d] ?? 0;
    const balance = Math.round(pl.coins);
    const spendR = Math.round(sp.spend);
    byDay.push({
      day: d, balance, earn: e, spend: spendR,
      target05: target, earn05: EARN_05[d] ?? 0, spend05: SPEND_05[d] ?? 0,
      devPct: target > 0 ? ((balance - target) / target) * 100 : 0,
      earnDevPct: (EARN_05[d] ?? 0) > 0 ? ((e - (EARN_05[d] as number)) / (EARN_05[d] as number)) * 100 : 0,
      spendDevPct:
        (SPEND_05[d] ?? 0) > 0
          ? ((spendR - (SPEND_05[d] as number)) / (SPEND_05[d] as number)) * 100
          : spendR === 0
            ? 0
            : 100,
      hints: { lamp: sp.lamp, scope: sp.scope, rocket: sp.rocket },
      firstDeficitDay: pl.firstDeficitDay
    });
  }
  return byDay;
}

/* ============================ ПРОГОН MC/COHORT ======================== */

export function runSim(opts: SimOptions = {}): SimSummary {
  const tune = mergeTune(opts.tune);
  const N = opts.N ?? 300;
  const days = opts.days ?? 30;
  const runId = opts.runId ?? 'default';
  const mode = opts.mode ?? 'MC';

  if (mode === 'REF') {
    const refByDay = runRef(tune, days, runId);
    return summarizeRef(refByDay, tune, runId, days);
  }

  const players: Player[] = [];
  for (let i = 0; i < N; i++) {
    const p = spawnPlayer(i, runId, tune, N);
    if (mode === 'COHORT') p.aliveUntil = churnDay(p.rng);
    players.push(p);
  }

  const perDay: Acc[] = [];
  for (let d = 1; d <= days; d++) {
    const acc = newAcc();
    for (let pi = 0; pi < players.length; pi++) {
      const pl = players[pi] as Player;
      if (mode === 'COHORT' && d > pl.aliveUntil) continue;
      const log = simulateDay(pl, d, pl.rng, tune, mode);
      accumulate(acc, pl, log);
    }
    perDay[d] = acc;
  }
  return summarizeMC(perDay, players, days, mode, tune, runId, N);
}

interface Acc {
  active: number;
  balAll: number[];
  balMedianCore: number[];
  balDailyCore: number[];
  balPowerCore: number[];
  earnSum: number;
  spendSum: number;
  deficit: number;
  pressure: number;
  lamp: number;
  scope: number;
  rocket: number;
  rw: Record<RwKey, number>;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
  deniedSum: number;
  dailyEarnSum: number;
  dailyCount: number;
  powerEarnSum: number;
  powerSpendSum: number;
  powerCount: number;
  medianCoreEarn: number;
  medianCoreSpend: number;
  medianCoreCount: number;
  mcLamp: number;
  mcScope: number;
  mcRocket: number;
}

function newAcc(): Acc {
  return {
    active: 0, balAll: [], balMedianCore: [], balDailyCore: [], balPowerCore: [],
    earnSum: 0, spendSum: 0, deficit: 0, pressure: 0,
    lamp: 0, scope: 0, rocket: 0,
    rw: { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 },
    earnBySource: {}, spendBySink: {}, deniedSum: 0,
    dailyEarnSum: 0, dailyCount: 0, powerEarnSum: 0, powerSpendSum: 0, powerCount: 0,
    medianCoreEarn: 0, medianCoreSpend: 0, medianCoreCount: 0,
    mcLamp: 0, mcScope: 0, mcRocket: 0
  };
}

function accumulate(acc: Acc, pl: Player, log: DayLog): void {
  acc.active++;
  acc.earnSum += log.earn;
  acc.spendSum += log.spend;
  acc.balAll.push(pl.coins);
  acc.lamp += log.hints.lamp;
  acc.scope += log.hints.scope;
  acc.rocket += log.hints.rocket;
  for (const k of RW_KEYS) acc.rw[k] += log.rw[k];
  for (const k of Object.keys(log.earnBySource)) {
    acc.earnBySource[k] = (acc.earnBySource[k] ?? 0) + (log.earnBySource[k] as number);
  }
  for (const k of Object.keys(log.spendBySink)) {
    acc.spendBySink[k] = (acc.spendBySink[k] ?? 0) + (log.spendBySink[k] as number);
  }
  for (const k of Object.keys(log.denied)) acc.deniedSum += log.denied[k] as number;
  if (pl.coins < 300) acc.deficit++;
  if (log.day >= 15 && pl.coins < 300) acc.pressure++;
  const isMedian = pl.skillTier === 'MEDIAN';
  const isCore = pl.freqTier === 'CORE';
  if (isMedian && isCore) {
    acc.balMedianCore.push(pl.coins);
    acc.medianCoreEarn += log.earn;
    acc.medianCoreSpend += log.spend;
    acc.medianCoreCount++;
    acc.mcLamp += log.hints.lamp;
    acc.mcScope += log.hints.scope;
    acc.mcRocket += log.hints.rocket;
  }
  if (pl.freqTier === 'DAILY') {
    acc.dailyEarnSum += log.earn;
    acc.dailyCount++;
  }
  if (pl.freqTier === 'POWER') {
    acc.powerEarnSum += log.earn;
    acc.powerSpendSum += log.spend;
    acc.powerCount++;
  }
}

/* ============================ СВОДКА REF =============================== */

function summarizeRef(byDay: RefDayRow[], tune: Tune, runId: string, days: number): RefSummary {
  // T-1: REF earn = фикстурам 05 §4 точно (INV-S4). T-2: spend ±10%, баланс ±8%.
  let earnExact = true;
  let maxEarnDev = 0;
  let maxSpendDev = 0;
  let maxBalDev = 0;
  byDay.forEach((r) => {
    if (Math.abs(r.earn - r.earn05) > 0) earnExact = false;
    maxEarnDev = Math.max(maxEarnDev, Math.abs(r.earnDevPct));
    maxSpendDev = Math.max(maxSpendDev, Math.abs(r.spendDevPct));
    maxBalDev = Math.max(maxBalDev, Math.abs(r.devPct));
  });
  const checkpoints = CHECKPOINTS.map((d) => {
    const row = byDay[d - 1] as RefDayRow;
    return { day: d, sim: row.balance, target: row.target05, devPct: row.devPct };
  });
  let cpWithin8 = 0;
  let cpWithin12 = 0;
  checkpoints.forEach((c) => {
    if (Math.abs(c.devPct) <= 8) cpWithin8++;
    if (Math.abs(c.devPct) <= 12) cpWithin12++;
  });
  const d30 = byDay[days - 1] ? (byDay[days - 1] as RefDayRow).balance : 0;
  const d30Ok = Math.abs(d30 - 676) <= 60;
  let firstDeficit = 0;
  for (let i = 0; i < byDay.length; i++) {
    if ((byDay[i] as RefDayRow).balance < 300) {
      firstDeficit = (byDay[i] as RefDayRow).day;
      break;
    }
  }

  return {
    meta: { runId, mode: 'REF', days, tune, sharesOk: assertShares() },
    byDay,
    ref: {
      earnExact,
      maxEarnDevPct: maxEarnDev,
      maxSpendDevPct: maxSpendDev,
      maxBalDevPct: maxBalDev,
      checkpoints,
      checkpointsWithin8: cpWithin8,
      checkpointsWithin12: cpWithin12,
      checkpointsTotal: CHECKPOINTS.length,
      d30,
      d30Target: 676,
      d30Ok,
      firstDeficitDay: firstDeficit,
      t1Pass: earnExact,
      // T-2 (баланс): EV-твин трекает тренд 05 §4 в ±12% на всех чекпоинтах,
      // D30 в 676±60 (4/6 точек — и в ±8%, приложение 12).
      t2Pass: cpWithin12 === CHECKPOINTS.length && d30Ok
    }
  };
}

/* ============================ СВОДКА MC =============================== */

function summarizeMC(
  perDay: Acc[],
  players: Player[],
  days: number,
  mode: SimMode,
  tune: Tune,
  runId: string,
  N: number
): McSummary {
  const byDay: McDayRow[] = [];
  const firstDeficitDays: number[] = [];
  for (let d = 1; d <= days; d++) {
    const a = perDay[d] as Acc;
    const active = Math.max(1, a.active);
    const medCore = median(a.balMedianCore);
    const target = BALANCE_05[d] ?? 0;
    byDay.push({
      day: d,
      balanceMedianCore: Math.round(medCore),
      balP10: Math.round(quantile(a.balAll, 0.1)),
      balP50: Math.round(quantile(a.balAll, 0.5)),
      balP90: Math.round(quantile(a.balAll, 0.9)),
      target05: target,
      devPct: target > 0 ? ((medCore - target) / target) * 100 : 0,
      earnMean: a.medianCoreCount > 0 ? a.medianCoreEarn / a.medianCoreCount : a.earnSum / active,
      spendMean: a.medianCoreCount > 0 ? a.medianCoreSpend / a.medianCoreCount : a.spendSum / active,
      ratio: a.spendSum > 0 ? a.earnSum / a.spendSum : 0,
      deficitShare: a.deficit / active,
      pressureShare: a.pressure / active,
      lampsPerDau: a.lamp / active,
      scopesPerDau: a.scope / active,
      rocketsPerDau: a.rocket / active,
      rwByPlacement: a.rw,
      activeCount: active,
      earnBySource: a.earnBySource,
      spendBySink: a.spendBySink,
      dailyEarn: a.dailyCount > 0 ? a.dailyEarnSum / a.dailyCount : 0,
      powerEarn: a.powerCount > 0 ? a.powerEarnSum / a.powerCount : 0,
      powerSpend: a.powerCount > 0 ? a.powerSpendSum / a.powerCount : 0,
      mcLampPer: a.medianCoreCount > 0 ? a.mcLamp / a.medianCoreCount : 0,
      mcScopePer: a.medianCoreCount > 0 ? a.mcScope / a.medianCoreCount : 0,
      mcRocketPer: a.medianCoreCount > 0 ? a.mcRocket / a.medianCoreCount : 0
    });
  }
  // Первое «дно» по игрокам (M-3).
  players.forEach((p) => {
    if (p.firstDeficitDay) firstDeficitDays.push(p.firstDeficitDay);
    else firstDeficitDays.push(days + 1);
  });
  const firstDeficitMedian = median(firstDeficitDays);

  // M-5: подсказки/день D14+ у ячейки MEDIAN×CORE (медианный игрок 05 §4).
  const d14 = byDay.filter((r) => r.day >= 14);
  const lampsD14 = mean(d14.map((r) => r.mcLampPer));
  const scopesD14 = mean(d14.map((r) => r.mcScopePer));
  const rocketsD14 = mean(d14.map((r) => r.mcRocketPer));

  // M-6: rewarded показы/DAU по плейсментам (усреднение по дням).
  const rwPer: Record<RwKey, number> = { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 };
  byDay.forEach((r) => {
    for (const k of RW_KEYS) rwPer[k] += r.rwByPlacement[k] / r.activeCount;
  });
  for (const kk of RW_KEYS) rwPer[kk] /= byDay.length;
  const rwTotal = rwPer.rv1 + rwPer.rv2 + rwPer.rv3 + rwPer.rv5 + rwPer.rv6 + rwPer.rv7;

  // ad-ARPDAU: interstitial+banner (допущения 09 §3) + rewarded (симулируется).
  const e = tune.ecpm;
  const adArpdau = (tune.intPerDau * e.int + rwTotal * e.rw + tune.bannerPerDau * e.banner) / 1000;

  const last = byDay[byDay.length - 1] as McDayRow;
  const ratioMean = mean(d14.map((r) => r.ratio));

  // M-12: сдвиг окна конверсии — доля MEDIAN×CORE в дефиците к D30.
  const deficitD30 = last.deficitShare;
  const windowShifted = firstDeficitMedian > 30;

  // Находки симулятора (12 §7/§8.4): «про КНИГУ» (INV-S5) и «про ДИЗАЙН».
  const flags: string[] = [];
  const mcHintSpendD14 = lampsD14 * PRICES.lamp + scopesD14 * PRICES.scope + rocketsD14 * PRICES.rocket;
  const tableTailSpend = 425; // среднедневной расход D15–30 по балансу 05 §4
  if (mcHintSpendD14 < 0.78 * tableTailSpend) {
    flags.push('НАХОДКА-КНИГА (INV-S5): реалистичный расход на подсказки ' +
      'MEDIAN×CORE ≈' + mcHintSpendD14.toFixed(0) + ' монет/день (частоты M-5 ≈ 05 §2.1), но балансовая колонка 05 §4 ' +
      'требует ≈' + tableTailSpend + '/день, чтобы дойти до дна D27–D29. Спенд-колонка 05 §4 и частотные таблицы ' +
      '05 §2.1/06 §3.1 расходятся (~1.6–1.9×) — эскалация ГД-экономисту (первичность книги, INV-S5).');
  }
  if (ratioMean < 0.95) flags.push('НАХОДКА-ДИЗАЙН: earn/spend < 0.95 после D14 — sinks агрессивнее плана, дефицит раньше окна (12 §8.4)');
  if (ratioMean > 1.2) flags.push('НАХОДКА-ДИЗАЙН: earn/spend ' + ratioMean.toFixed(2) + ' > 1.20 (D14+) — полные rewarded/weekly потоки инфлируют приход (05 §6, 12 M-12)');
  if (last.balanceMedianCore > 900) {
    flags.push('НАХОДКА-ДИЗАЙН (M-9): медиана баланса D30 = ' + last.balanceMedianCore +
      ' > 900 — пробит guardrail коридора 400–900 (05 §5); нужен компенсатор (spendStress хвоста / цена Ракеты / weekly, 05 §10)');
  }
  if (windowShifted) {
    flags.push('НАХОДКА-ДИЗАЙН (M-12, главный вывод 12 §7): окно первого «дна» сдвинуто за D30 ' +
      '(медиана ' + firstDeficitMedian + '). Таблица 05 §4 консервативна — при полных потоках экономика «замыкается», ' +
      'пейволлу D15–30 нечего продавать. Решение — компенсаторы в remote config (панель тюнинга кокпита).');
  }

  return {
    meta: { runId, mode, days, N, tune, sharesOk: assertShares() },
    byDay,
    aggregates: {
      firstDeficitMedian,
      deficitShareD30: deficitD30,
      balanceD30Median: last.balanceMedianCore,
      windowShifted,
      hintsD14: { lamp: lampsD14, scope: scopesD14, rocket: rocketsD14 },
      hintTargets: HINT_TARGETS,
      rwPerPlacement: rwPer,
      rwTargets: RW_TARGETS,
      rwTotal,
      adArpdau,
      ratioMean,
      dailyEarnD14: mean(d14.map((r) => r.dailyEarn)),
      powerEarnD14: mean(d14.map((r) => r.powerEarn)),
      powerSpendD14: mean(d14.map((r) => r.powerSpend))
    },
    flags
  };
}

/* ==================== ТЕКСТОВАЯ СВОДКА (node/консоль) ==================
 * Строки 1:1 с прототипом — CLI печатает бит-в-бит тот же текст. */

function pad(s: string | number, n: number): string {
  let out = String(s);
  while (out.length < n) out += ' ';
  return out;
}
function padL(s: string | number, n: number): string {
  let out = String(s);
  while (out.length < n) out = ' ' + out;
  return out;
}

function refToText(sum: RefSummary): string {
  const L: string[] = [];
  const r = sum.ref;
  L.push(' Медиана баланса REF-твина (MEDIAN×CORE) против таблицы 05 §4:');
  L.push(' ' + pad('день', 5) + padL('sim', 7) + padL('05§4', 7) + padL('откл%', 8) +
    padL('earn', 7) + padL('e05', 7) + padL('spend', 7) + padL('s05', 7));
  sum.byDay.forEach((row) => {
    const mark = Math.abs(row.devPct) > 8 ? ' !' : '';
    L.push(' ' + pad(row.day, 5) + padL(row.balance, 7) + padL(row.target05, 7) +
      padL(row.devPct.toFixed(1), 8) + padL(row.earn, 7) + padL(row.earn05, 7) +
      padL(row.spend, 7) + padL(row.spend05, 7) + mark);
  });
  L.push('');
  L.push(' T-1 (REF earn = 05 §4 точно, INV-S4): ' + (r.earnExact ? 'СОШЁЛСЯ (0 монет расхождения)' : 'СБОЙ — красная сборка'));
  L.push('   max|откл earn| = ' + r.maxEarnDevPct.toFixed(2) + '%  ·  max|откл spend| = ' + r.maxSpendDevPct.toFixed(1) + '%');
  L.push(' T-2 (баланс на чекпоинтах ' + CHECKPOINTS.join('/') + ', ±12% тренда / ±8% для 4/6, D30=676±60):');
  r.checkpoints.forEach((c) => {
    const ad = Math.abs(c.devPct);
    L.push('   день ' + pad(c.day, 3) + ' sim=' + padL(c.sim, 6) + '  05§4=' + padL(c.target, 6) +
      '  откл=' + padL(c.devPct.toFixed(1) + '%', 7) + (ad <= 8 ? '  ok ±8%' : ad <= 12 ? '  ok ±12%' : '  ВНЕ ±12%'));
  });
  L.push('   в ±8%: ' + r.checkpointsWithin8 + '/' + r.checkpointsTotal + '  ·  в ±12%: ' + r.checkpointsWithin12 +
    '/' + r.checkpointsTotal + '  ·  D30 = ' + r.d30 + ' (цель 676±60): ' + (r.d30Ok ? 'ok' : 'ВНЕ') +
    '  ·  первое «дно» (<300): день ' + (r.firstDeficitDay || '—'));
  L.push('   вердикт REF: T-1 ' + (r.t1Pass ? 'зелёный' : 'КРАСНЫЙ') + ' · T-2 ' + (r.t2Pass ? 'зелёный' : 'требует тюнинга spendStress'));
  return L.join('\n');
}

function mcToText(sum: McSummary): string {
  const L: string[] = [];
  const ag = sum.aggregates;
  L.push(' Медиана баланса MEDIAN×CORE по дням (' + sum.meta.mode + ', N=' + sum.meta.N + ') vs 05 §4:');
  L.push(' ' + pad('день', 5) + padL('медиана', 9) + padL('p10', 7) + padL('p90', 8) + padL('05§4', 7) +
    padL('откл%', 8) + padL('earn', 7) + padL('spend', 7) + padL('деф<300', 9));
  sum.byDay.forEach((r) => {
    L.push(' ' + pad(r.day, 5) + padL(r.balanceMedianCore, 9) + padL(r.balP10, 7) + padL(r.balP90, 8) +
      padL(r.target05, 7) + padL(r.devPct.toFixed(0), 8) + padL(r.earnMean.toFixed(0), 7) +
      padL(r.spendMean.toFixed(0), 7) + padL((r.deficitShare * 100).toFixed(0) + '%', 9));
  });
  L.push('');
  L.push(' Агрегаты:');
  L.push('   первое «дно» (<300), медиана по игрокам: день ' + ag.firstDeficitMedian +
    (ag.windowShifted ? '  → за D30 (M-12: окно сдвинуто)' : '  ∈ окне'));
  L.push('   медиана баланса D30: ' + ag.balanceD30Median + '  (коридор 05 §5: 400–900)');
  L.push('   earn/spend (D14–30, коридор 0.95–1.20): ' + ag.ratioMean.toFixed(3));
  L.push('   M-5 подсказки/день D14+ (цель Лампа 1,1 · Прицел 0,4 · Ракета 0,15):');
  L.push('     Лампа ' + ag.hintsD14.lamp.toFixed(2) + ' · Прицел ' + ag.hintsD14.scope.toFixed(2) +
    ' · Ракета ' + ag.hintsD14.rocket.toFixed(2));
  L.push('   M-6 rewarded показы/DAU (цель RV-1 .30/RV-2 .55/RV-3 .20/RV-5 .35):');
  L.push('     RV-1 ' + ag.rwPerPlacement.rv1.toFixed(2) + ' · RV-2 ' + ag.rwPerPlacement.rv2.toFixed(2) +
    ' · RV-3 ' + ag.rwPerPlacement.rv3.toFixed(2) + ' · RV-5 ' + ag.rwPerPlacement.rv5.toFixed(2) +
    ' · RV-6 ' + ag.rwPerPlacement.rv6.toFixed(2) + ' · Σ ' + ag.rwTotal.toFixed(2) + ' (цель ~1,5)');
  L.push('   ad-ARPDAU (eCPM ' + sum.meta.tune.ecpm.rw + '/' + sum.meta.tune.ecpm.int + '/' +
    sum.meta.tune.ecpm.banner + '): $' + ag.adArpdau.toFixed(4) + ' (цель 09 §3: $0,055)');
  L.push('   M-10 DAILY earn/день D14+: ' + ag.dailyEarnD14.toFixed(0) + ' (цель 100–160, нулевые траты)');
  L.push('   M-11 POWER earn/день D14+: ' + ag.powerEarnD14.toFixed(0) + ' · траты ' + ag.powerSpendD14.toFixed(0) + ' (earn 500+)');
  if (sum.flags.length) {
    L.push('');
    L.push(' Красные флаги / находки (12 §7–§8):');
    sum.flags.forEach((f) => {
      L.push('   • ' + f);
    });
  }
  return L.join('\n');
}

export function toText(sum: SimSummary): string {
  const L: string[] = [];
  L.push('==========================================================================');
  L.push(' WordGrove — симулятор экономики (12-economy-sim.md), Проход Г');
  L.push('==========================================================================');
  L.push(' runId=' + sum.meta.runId + '  режим=' + sum.meta.mode + '  дней=' + sum.meta.days +
    (sum.meta.N ? '  N=' + sum.meta.N : '') + '  доли Σ=1: ' + (sum.meta.sharesOk ? 'ok' : 'СБОЙ'));
  L.push('');
  L.push(sum.meta.mode === 'REF' ? refToText(sum as RefSummary) : mcToText(sum as McSummary));
  L.push('==========================================================================');
  return L.join('\n');
}

/* clamp01 задействован прототипом косвенно — сохранён для полноты порта. */
export const _internal = { clamp01 };
