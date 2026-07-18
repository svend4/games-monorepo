/**
 * Симулятор экономики Block Surge (Проход Е.3, порт sim.js Прохода Г).
 * Реализация офлайн-инструмента приложения 12-economy-sim.md: N виртуальных
 * игроков сегментов скилл×частота × 30 дней агрегатной move-цепью партии
 * (комбо/Прилив, 11 §5), транзакционная модель монет sources/sinks (05 §2),
 * бустеры (инвентарь + покупка = sink), continue, pity (11 §3.5), капы
 * rewarded (06 §2.2). На выходе — баланс монет по дням против опорной кривой
 * 05 §4 (отклонение в %), чекпоинты калибровки, earn/spend ratio, ad-ARPDAU,
 * доля sinks, красные флаги дизайна.
 *
 * ДЕТЕРМИНИЗМ (INV-E2): seeded-RNG mulberry32 из src/core/rng, сид игрока =
 * fnv1a32('blocksurge:econsim:v1:{runId}:{playerId}'). НИКАКИХ Math.random /
 * Date.now в расчётах — seed приходит параметром (runId). Один и тот же runId
 * даёт бит-в-бит один и тот же результат в браузере и в node (порядок вызовов
 * RNG сохранён 1:1 с прототипом).
 *
 * ДВА ВХОДА — ОДИН МОДУЛЬ: браузер (CockpitUi через experiments) и headless
 * CLI (src/sim/cli.ts, `npm run sim -- [runId] [N]`) вызывают этот же код.
 */
import { fnv1a32, mulberry32 } from '../core/rng';
import type { Rng } from '../core/types';
import {
  BALANCE_05,
  BOOK_TUNE,
  CAPS,
  CHECKPOINTS,
  EARN,
  FAIL_CORRIDORS,
  FREQ,
  LEVEL_SEGMENTS,
  PITY_RELIEF,
  PRICES,
  PROP,
  SHARES,
  SKILL,
  SKILL_ORDER,
  FREQ_ORDER,
  assertShares,
  type FreqDef,
  type FreqTier,
  type LevelSegment,
  type SkillDef,
  type SkillTier,
  type Tune,
  type TuneOverrides
} from './constants';

/* ============================ ТИПЫ ПРОГОНА =============================== */

export type SimMode = 'SURVIVOR' | 'COHORT';
export type GameMode = 'journey' | 'classic' | 'field';

export interface SimOptions {
  N?: number;
  days?: number;
  runId?: string;
  mode?: SimMode;
  tune?: TuneOverrides;
}

export interface DayRow {
  day: number;
  balanceMedianBaseCore: number;
  balanceP10: number;
  balanceP50: number;
  balanceP90: number;
  target05: number;
  devPct: number;
  earnMean: number;
  spendMean: number;
  ratio: number;
  deficitShare: number;
  deepDeficitShare: number;
  hoardShare: number;
  rwPerDau: number;
  surgeGamesPct: number;
  deniedPerDau: number;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
}

export interface Checkpoint {
  day: number;
  sim: number;
  target: number;
  devPct: number;
}

export interface SimSummary {
  meta: { runId: string; N: number; days: number; mode: SimMode; tune: Tune; sharesOk: boolean };
  byDay: DayRow[];
  checkpoints: Checkpoint[];
  calibration: {
    maxAbsDevPct: number;
    checkpointsWithin10: number;
    checkpointsTotal: number;
    pass: boolean;
  };
  aggregates: {
    ratioMean: number;
    rwPerDauMean: number;
    surgeGamesPct: number;
    adArpdau: number;
    deficitShareD30: number;
    deepDeficitShareD30: number;
    hoardShareD30: number;
    failRate: Record<LevelSegment, number>;
    failCorridors: typeof FAIL_CORRIDORS;
  };
  flags: string[];
}

interface Player {
  id: number;
  skillTier: SkillTier;
  freqTier: FreqTier;
  skill: SkillDef;
  freq: FreqDef;
  coins: number;
  boosters: { hammer: number; swap: number; undo: number };
  tickets: number;
  streakDay: number;
  streakCount: number;
  levelMax: number;
  pity: number;
  fieldFreeUsed: boolean;
  rng: Rng;
  aliveUntil: number;
}

interface DayLog {
  day: number;
  earn: number;
  spend: number;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
  denied: Record<string, number>;
  games: number;
  fails: number;
  continues: number;
  rwViews: number;
  crystalGames: number;
  rw1UsedThisGame: boolean;
  rw2Used: number;
  rw4Used: number;
  segAttempt: Partial<Record<LevelSegment, number>>;
  segFail: Partial<Record<LevelSegment, number>>;
  skipped: boolean;
  balanceEOD: number;
}

interface GameResult {
  coins: number;
  lines: number;
  crystals: number;
  moves: number;
  mode: GameMode;
}

/* ==================== ДЕТЕРМИНИРОВАННЫЙ СИД (INV-E2) ==================== */

/** Сид игрока: та же схема, что в прототипе — воспроизводимо между средами. */
export function seedOf(runId: string, playerId: number): number {
  return fnv1a32('blocksurge:econsim:v1:' + runId + ':' + playerId);
}

/* ============================ УТИЛИТЫ ==================================== */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function randRange(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}
function randInt(rng: Rng, a: number, b: number): number {
  return Math.floor(a + (b - a + 1) * rng());
}
function gauss(rng: Rng, meanV: number, sd: number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return meanV + z * sd;
}
function median(arr: readonly number[]): number {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}
function quantile(arr: readonly number[], q: number): number {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = a[base] as number;
  const hi = a[base + 1];
  return hi !== undefined ? lo + rest * (hi - lo) : lo;
}
function mean(arr: readonly number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/** Сборка мердж-конфига: книга + переопределения кокпита. ecpm собирается
 * СВЕЖИМ объектом с частичным слиянием — правка одного под-ключа eCPM не
 * обнуляет остальные (иначе adArpdau = NaN; см. INV-E1/§8 прототипа). */
export function mergeTune(over?: TuneOverrides): Tune {
  const b = BOOK_TUNE;
  const o: TuneOverrides = over ?? {};
  return {
    missionsEV: o.missionsEV ?? b.missionsEV,
    weeklyBundleEV: o.weeklyBundleEV ?? b.weeklyBundleEV,
    wheelWeightsLow: o.wheelWeightsLow ?? b.wheelWeightsLow,
    noveltyAmp: o.noveltyAmp ?? b.noveltyAmp,
    engageDecay: o.engageDecay ?? b.engageDecay,
    boosterScale: o.boosterScale ?? b.boosterScale,
    stressFloor: o.stressFloor ?? b.stressFloor,
    stressSlope: o.stressSlope ?? b.stressSlope,
    stressCap: o.stressCap ?? b.stressCap,
    bossStress: o.bossStress ?? b.bossStress,
    continueScale: o.continueScale ?? b.continueScale,
    W_HARD: o.W_HARD ?? b.W_HARD,
    winP: o.winP ?? b.winP,
    rw2Mult: o.rw2Mult ?? b.rw2Mult,
    intPerDau: o.intPerDau ?? b.intPerDau,
    bannerPerDau: o.bannerPerDau ?? b.bannerPerDau,
    ecpm: {
      rw: o.ecpm?.rw ?? b.ecpm.rw,
      int: o.ecpm?.int ?? b.ecpm.int,
      banner: o.ecpm?.banner ?? b.ecpm.banner
    },
    startGrant: o.startGrant ?? b.startGrant,
    rw2Cap: o.rw2Cap ?? b.rw2Cap,
    intCap: o.intCap ?? b.intCap
  };
}

/* ==================== КОРИДОРЫ И STRESS (03 §5.2) ======================= */

export function levelSegment(level: number): LevelSegment {
  if (level <= 5) return 's1_5';
  if (level <= 20) return 's6_20';
  if (level <= 60) return 's21_60';
  return 's60p';
}

/** Целевой fail для уровня (без учёта скилла/pity). Босс — до 0.30 (05 §7 п.1). */
function failTarget(level: number, boss: boolean, tune: Tune): number {
  if (boss) return 0.3;
  const seg = levelSegment(level);
  if (seg === 's1_5') return 0.01;
  if (seg === 's6_20') return 0.075;
  if (seg === 's21_60') return 0.15 * tune.W_HARD; // ручка сложности hard-сегмента
  return 0.215 * tune.W_HARD;
}

/** Спрос на бустеры растёт со сложностью (05 §7 п.1): гладкая функция уровня
 * с плато к D20+; босс — отдельный пик; W_HARD ускоряет наклон (09 §6 №7). */
function stressAt(level: number, boss: boolean, tune: Tune): number {
  if (boss) return tune.bossStress;
  const s = tune.stressFloor + (level - 1) * tune.stressSlope * tune.W_HARD;
  return clamp(s, tune.stressFloor, tune.stressCap);
}

function novelty(t: number, tune: Tune): number {
  return 1 + tune.noveltyAmp * Math.exp(-t / 4);
}

/* ===================== АВТОМАТЫ КОМБО/ПРИЛИВ (11 §5) ==================== */

function comboMult(chain: number): number {
  if (chain >= 6) return 5;
  if (chain >= 4) return 3;
  if (chain >= 2) return 2;
  return 1;
}

function sampleLines(dist: readonly number[], rng: Rng): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < dist.length; i++) {
    acc += dist[i] as number;
    if (r < acc) return i + 1;
  }
  return 1;
}

/** Агрегатная move-цепь партии (12 §4.1): комбо ×2/×3/×5, шкала Прилива
 * (заряд 10×mult, шкала 100), кристалл. Взрыв кристалла — очки, НЕ монеты. */
function simulateGame(pl: Player, mode: GameMode, rng: Rng, _tune: Tune): GameResult {
  let moves: number;
  if (mode === 'classic') moves = Math.round(clamp(Math.exp(gauss(rng, Math.log(75), 0.35)), 20, 220));
  else moves = Math.round(clamp(gauss(rng, 42, 8), 12, 90)); // journey/field, 12 §4.1

  let chain = 0;
  let charge = 0;
  let crystalPending = false;
  let crystalOnBoard = false;
  let coins = 0;
  let lines = 0;
  let crystals = 0;
  const sk = pl.skill;

  for (let m = 0; m < moves; m++) {
    const firstOfHand = m % 3 === 0; // рука = 3 фигуры (03 §2.1)
    if (crystalPending && firstOfHand) {
      crystalPending = false;
      crystalOnBoard = true;
    }

    const cleared = rng() < sk.pClear;
    // Автомат комбо 11 §5.1: цепь копится на очистках подряд, рвётся на промахе.
    if (cleared) chain++;
    else chain = 0;
    const mult = comboMult(chain);

    if (cleared) {
      const n = sampleLines(sk.linesDist, rng);
      lines += n;
      coins += n * mult * EARN.linePerMult; // монеты за линии, 05 §2.1
      charge += 10 * mult; // заряд Прилива, 11 §5.2
      if (charge >= 100) {
        charge = 100;
        crystalPending = true;
      }
    }
    if (crystalOnBoard) {
      const explodes = cleared && rng() < clamp01(sk.pClear + sk.crystalAim);
      if (explodes) {
        crystals++;
        crystalOnBoard = false;
        charge = 0; // взрыв: очки, НЕ монеты (11 §5.3)
      } else if (!cleared && rng() < 0.1) {
        crystalOnBoard = false;
        charge = 0;
      }
    }
  }
  return { coins, lines, crystals, moves, mode };
}

/* ===================== РАСХОД / ПРИХОД (транзакции) ===================== */

function earnTx(pl: Player, log: DayLog, amount: number, source: string): void {
  amount = Math.round(amount);
  if (amount <= 0) return;
  pl.coins += amount;
  log.earn += amount;
  log.earnBySource[source] = (log.earnBySource[source] ?? 0) + amount;
}

/** INV-E4: sink гейтится проверкой баланса; отказ пишется в denied. */
function spendTx(pl: Player, log: DayLog, amount: number, sink: string): boolean {
  amount = Math.round(amount);
  if (amount <= 0) return true;
  if (pl.coins < amount) {
    log.denied[sink] = (log.denied[sink] ?? 0) + 1;
    return false;
  }
  pl.coins -= amount;
  log.spend += amount;
  log.spendBySink[sink] = (log.spendBySink[sink] ?? 0) + amount;
  return true;
}

/** Использование бустеров за партию (12 §4.2): интенсивность × stress; сначала
 * инвентарь (подарки/RW-3), при пустом — покупка = sink (INV-E4). */
function useBoosters(pl: Player, level: number, boss: boolean, rng: Rng, tune: Tune, log: DayLog): void {
  const stress = stressAt(level, boss, tune);
  const order = ['hammer', 'swap', 'undo'] as const;
  for (const b of order) {
    const p = clamp(PROP.boosterIntensity[b] * stress * tune.boosterScale, 0, 0.95);
    if (rng() < p) {
      if (pl.boosters[b] > 0) pl.boosters[b]--; // из инвентаря — бесплатно
      else spendTx(pl, log, PRICES[b], 'booster_' + b); // иначе покупка = sink
    }
  }
}

/** Исход journey-партии: fail-коридор × скилл × pity → continue → награда.
 * Монеты линий начисляются ЗДЕСЬ: провальная партия обрывается раньше бюджета
 * (§9 «второй шанс не даёт монет»), поэтому линий на провале — доля coins. */
function resolveOutcome(pl: Player, g: GameResult, mode: GameMode, rng: Rng, tune: Tune, log: DayLog): void {
  if (mode !== 'journey') {
    // classic/field: монеты линий уже начислены
    useBoosters(pl, pl.levelMax, false, rng, tune, log);
    return;
  }
  const boss = pl.levelMax % 10 === 0 && pl.levelMax > 0;
  useBoosters(pl, pl.levelMax, boss, rng, tune, log);

  // Учёт попыток/провалов по сегментам (для fail-коридоров M3):
  const seg = levelSegment(pl.levelMax);
  log.segAttempt[seg] = (log.segAttempt[seg] ?? 0) + 1;

  const pityIdx = Math.min(pl.pity, 2);
  const failP = failTarget(pl.levelMax, boss, tune) * pl.skill.failMult * (PITY_RELIEF[pityIdx] as number);
  let failed = rng() < clamp01(failP);
  if (failed) log.segFail[seg] = (log.segFail[seg] ?? 0) + 1;

  if (failed) {
    log.fails++;
    const progress = 0.5 + 0.5 * rng(); // прокси прогресса партии
    const saved = tryContinue(pl, progress, rng, tune, log);
    if (saved && rng() < tune.winP) failed = false; // continue конвертирует провал
  }
  // Монеты линий journey: полные на победе, урезанные на провале (партия короче).
  earnTx(pl, log, g.coins * (failed ? 0.55 : 1.0), 'lines');
  if (!failed) {
    let reward = randInt(rng, EARN.levelWin[0], EARN.levelWin[1]) * (boss ? EARN.bossRewardMult : 1);
    if (rng() < 0.35) reward += EARN.star3First; // первое 3★
    if (log.rw2Used < tune.rw2Cap && rng() < PROP.rwAccept.rw2) {
      reward *= tune.rw2Mult; // RW-2 «×множитель монеты»
      log.rw2Used++;
      log.rwViews++;
    }
    earnTx(pl, log, reward, 'level_win');
    pl.levelMax++;
    pl.pity = 0; // сброс счётчика на победе (11 §3.5)
  } else {
    pl.pity = Math.min(pl.pity + 1, 2); // эскалация pity
  }
}

function tryContinue(pl: Player, progress: number, rng: Rng, tune: Tune, log: DayLog): boolean {
  // Приоритет: RW-1 (бесплатно, 1/партию) → монеты 200 (12 §2.4, 03 §6).
  if (!log.rw1UsedThisGame && rng() < PROP.rwAccept.rw1) {
    log.rw1UsedThisGame = true;
    log.rwViews++;
    log.continues++;
    return true;
  }
  const pCoins = PROP.continueBaseP * tune.continueScale * (progress >= 0.8 ? 2 : 1);
  if (pl.coins >= PRICES.continue1 && rng() < pCoins) {
    if (spendTx(pl, log, PRICES.continue1, 'continue1')) {
      log.continues++;
      return true;
    }
  }
  return false;
}

/* ============================ МОДЕЛЬ ДНЯ (12 §5) ======================== */

function weightedWheel(rng: Rng): number {
  const v = [30, 45, 60, 80, 100, 120, 150];
  const w = [0.6, 0.2, 0.1, 0.05, 0.03, 0.015, 0.005]; // взвешено к нижним, EV ≈ 42
  const r = rng();
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    acc += w[i] as number;
    if (r < acc) return v[i] as number;
  }
  return v[0] as number;
}

function pickMode(pl: Player, rng: Rng): GameMode {
  const mm = pl.freq.modeMix;
  const r = rng();
  if (r < mm.journey) return 'journey';
  if (r < mm.journey + mm.classic) return 'classic';
  return 'field';
}

function onSkippedDay(pl: Player, rng: Rng, log: DayLog): void {
  // Пропуск дня: стрик теряется; с P — восстановление (100 монет или RW-4).
  if (pl.streakCount >= 6) {
    const pRestore = PROP.restoreStreakP;
    if (rng() < pRestore) {
      if (rng() < PROP.rwAccept.rw4 && log.rw4Used < CAPS.rw4PerDay) {
        log.rw4Used++;
        log.rwViews++; // спас серию рекламой (RW-4)
      } else {
        spendTx(pl, log, PRICES.streakRestore, 'streak_restore');
      }
    } else {
      pl.streakCount = 0;
      pl.streakDay = 0;
    }
  } else {
    pl.streakCount = 0;
    pl.streakDay = 0;
  }
  log.skipped = true;
  log.balanceEOD = pl.coins;
}

function streakTick(pl: Player, log: DayLog): void {
  pl.streakDay = (pl.streakDay % 7) + 1;
  pl.streakCount++;
  earnTx(pl, log, EARN.streakRamp[pl.streakDay - 1] as number, 'streak');
}

function shopDecisions(pl: Player, rng: Rng, log: DayLog): void {
  // Скин: покупка при балансе > 1.2 × цены (05 §6, амортизация редких покупок).
  if (pl.coins > 1.2 * PRICES.skinMin && rng() < PROP.buySkinP) {
    spendTx(pl, log, PRICES.skinMin, 'skin');
  }
  // Билет Поля: при балансе > 600 и не полном стеке (05 §2.3).
  if (pl.coins > 600 && pl.tickets < CAPS.tickets && rng() < PROP.buyTicketP) {
    if (spendTx(pl, log, PRICES.fieldTicket, 'field_ticket')) pl.tickets = Math.min(pl.tickets + 1, CAPS.tickets);
  }
}

function emptyLog(t: number): DayLog {
  return {
    day: t,
    earn: 0,
    spend: 0,
    earnBySource: {},
    spendBySink: {},
    denied: {},
    games: 0,
    fails: 0,
    continues: 0,
    rwViews: 0,
    crystalGames: 0,
    rw1UsedThisGame: false,
    rw2Used: 0,
    rw4Used: 0,
    segAttempt: {},
    segFail: {},
    skipped: false,
    balanceEOD: 0
  };
}

function simulateDay(pl: Player, t: number, rng: Rng, tune: Tune): DayLog {
  const log = emptyLog(t);
  // Капы rewarded сбрасываются на границе дня (12 §9).
  if (rng() < pl.freq.skipDayP) {
    onSkippedDay(pl, rng, log);
    return log;
  }

  let wheel = weightedWheel(rng);
  if (log.rw4Used < CAPS.rw4PerDay && rng() < PROP.rwAccept.rw4) {
    wheel *= 2;
    log.rw4Used++;
    log.rwViews++;
  }
  earnTx(pl, log, wheel, 'wheel');

  streakTick(pl, log);

  const engage = 1 - tune.engageDecay * Math.min(t, 30) / 30; // зрелость игрока (спад earn)
  const games = Math.max(1, Math.round(pl.freq.sessionsPerDay * pl.freq.gamesPerSession * novelty(t, tune) * engage));
  pl.fieldFreeUsed = false;
  for (let gi = 0; gi < games; gi++) {
    log.rw1UsedThisGame = false;
    let mode = pickMode(pl, rng);
    if (mode === 'field') {
      if (!pl.fieldFreeUsed) {
        pl.fieldFreeUsed = true; // 1 бесплатный запуск/день
      } else if (pl.tickets > 0) {
        pl.tickets--; // 2-й+ = билет
      } else if (rng() < PROP.rwAccept.rw4 && log.rw4Used < CAPS.rw4PerDay) {
        log.rw4Used++;
        log.rwViews++;
      } else {
        mode = 'classic'; // нет билета/рекламы → обычная партия
      }
    }
    const res = simulateGame(pl, mode, rng, tune);
    if (mode !== 'journey') earnTx(pl, log, res.coins, 'lines'); // journey — внутри resolveOutcome
    log.games++;
    if (res.crystals > 0) log.crystalGames++;
    resolveOutcome(pl, res, mode, rng, tune, log);
  }

  // Daily-миссии (частичное закрытие вокруг EV).
  earnTx(pl, log, tune.missionsEV * randRange(rng, 0.6, 1.4), 'missions');
  // Недельный всплеск (weekly-миссии + турнир).
  if (t % 7 === 0) earnTx(pl, log, tune.weeklyBundleEV * randRange(rng, 0.7, 1.3), 'weekly');
  earnTx(pl, log, EARN.chestAmortPerDay, 'chests');
  // RW-3 «бесплатный бустер» в инвентарь (1/день); условие 1:1 с прототипом.
  if (log.rwViews >= 0 && rng() < PROP.rwAccept.rw3) {
    pl.boosters.hammer++;
    log.rwViews++;
  }
  shopDecisions(pl, rng, log);

  log.balanceEOD = pl.coins;
  return log;
}

/* ==================== СПАВН ИГРОКА / КОГОРТЫ ============================ */

interface SegmentRow {
  skill: SkillTier;
  freq: FreqTier;
  share: number;
}

/** Сегменты в детерминированном порядке (для распределения по долям). */
export function segmentTable(): SegmentRow[] {
  const rows: SegmentRow[] = [];
  for (const sk of SKILL_ORDER) for (const fq of FREQ_ORDER) rows.push({ skill: sk, freq: fq, share: SHARES[sk][fq] });
  return rows;
}

function spawnPlayer(id: number, runId: string, tune: Tune, N: number): Player {
  // Детерминированное назначение сегмента по позиции игрока в популяции.
  const rows = segmentTable();
  const frac = (id + 0.5) / N; // равномерная раскладка по долям
  let acc = 0;
  let chosen = rows[rows.length - 1] as SegmentRow;
  for (const row of rows) {
    acc += row.share;
    if (frac < acc) {
      chosen = row;
      break;
    }
  }
  return {
    id,
    skillTier: chosen.skill,
    freqTier: chosen.freq,
    skill: SKILL[chosen.skill],
    freq: FREQ[chosen.freq],
    coins: tune.startGrant, // старт = FTUE-грант (05 §3)
    boosters: { hammer: 0, swap: 0, undo: 0 },
    tickets: 1, // 05 §3: билет дня 2 в подарок (упрощ. — на старте)
    streakDay: 0,
    streakCount: 0,
    levelMax: 1,
    pity: 0,
    fieldFreeUsed: false,
    rng: mulberry32(seedOf(runId, id)),
    aliveUntil: Infinity
  };
}

/** COHORT: удержание дня по кривой 09 §5.1 (кусочно-линейная интерполяция). */
export function retentionAt(day: number): number {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [1, 38], [2, 30], [3, 25], [4, 22], [5, 19], [6, 17], [7, 15], [14, 10.5], [30, 6]
  ];
  if (day <= 1) return 38;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i] as readonly [number, number];
    if (day <= b[0]) {
      const a = pts[i - 1] as readonly [number, number];
      const f = (day - a[0]) / (b[0] - a[0]);
      return (a[1] + f * (b[1] - a[1])) / 100;
    }
  }
  return 0.06;
}

function churnDay(rng: Rng): number {
  // Инвертируем кривую: игрок «жив» до дня d, если u < retention(d).
  const u = rng();
  for (let d = 1; d <= 30; d++) {
    if (u > retentionAt(d)) return d - 1;
  }
  return 30;
}

/* ============================ ПРОГОН ===================================== */

interface DayAcc {
  balancesBaseCore: number[];
  balancesAll: number[];
  earnSum: number;
  spendSum: number;
  activeCount: number;
  rwViewsSum: number;
  gamesSum: number;
  crystalGamesSum: number;
  deficit: number;
  deepDeficit: number;
  hoard: number;
  segAttempt: Partial<Record<LevelSegment, number>>;
  segFail: Partial<Record<LevelSegment, number>>;
  earnBySource: Record<string, number>;
  spendBySink: Record<string, number>;
  deniedSum: number;
}

export function runSim(opts: SimOptions = {}): SimSummary {
  const tune = mergeTune(opts.tune);
  const N = opts.N ?? 300;
  const days = opts.days ?? 30;
  const runId = opts.runId ?? 'default';
  const simMode: SimMode = opts.mode ?? 'SURVIVOR'; // SURVIVOR (калибровка) | COHORT (метрики на DAU)

  const players: Player[] = [];
  for (let i = 0; i < N; i++) {
    const p = spawnPlayer(i, runId, tune, N);
    if (simMode === 'COHORT') p.aliveUntil = churnDay(p.rng);
    players.push(p);
  }

  const perDay: DayAcc[] = [];
  for (let d = 1; d <= days; d++) {
    const acc: DayAcc = {
      balancesBaseCore: [],
      balancesAll: [],
      earnSum: 0,
      spendSum: 0,
      activeCount: 0,
      rwViewsSum: 0,
      gamesSum: 0,
      crystalGamesSum: 0,
      deficit: 0,
      deepDeficit: 0,
      hoard: 0,
      segAttempt: {},
      segFail: {},
      earnBySource: {},
      spendBySink: {},
      deniedSum: 0
    };
    for (const pl of players) {
      if (simMode === 'COHORT' && d > pl.aliveUntil) continue;
      const log = simulateDay(pl, d, pl.rng, tune);
      acc.activeCount++;
      acc.earnSum += log.earn;
      acc.spendSum += log.spend;
      acc.rwViewsSum += log.rwViews;
      acc.gamesSum += log.games;
      acc.crystalGamesSum += log.crystalGames;
      acc.balancesAll.push(pl.coins);
      if (pl.skillTier === 'BASE' && pl.freqTier === 'CORE') acc.balancesBaseCore.push(pl.coins);
      if (pl.coins < 200) acc.deficit++;
      if (pl.coins < 400) acc.deepDeficit++;
      if (pl.coins > 5000) acc.hoard++;
      for (const k of LEVEL_SEGMENTS) {
        const av = log.segAttempt[k];
        if (av !== undefined) acc.segAttempt[k] = (acc.segAttempt[k] ?? 0) + av;
        const fv = log.segFail[k];
        if (fv !== undefined) acc.segFail[k] = (acc.segFail[k] ?? 0) + fv;
      }
      for (const k of Object.keys(log.earnBySource)) {
        acc.earnBySource[k] = (acc.earnBySource[k] ?? 0) + (log.earnBySource[k] as number);
      }
      for (const k of Object.keys(log.spendBySink)) {
        acc.spendBySink[k] = (acc.spendBySink[k] ?? 0) + (log.spendBySink[k] as number);
      }
      for (const k of Object.keys(log.denied)) acc.deniedSum += log.denied[k] as number;
    }
    perDay.push(acc);
  }

  return summarize(perDay, days, simMode, tune, runId, N);
}

/* ============================ СВОДКА ===================================== */

function summarize(perDay: DayAcc[], days: number, simMode: SimMode, tune: Tune, runId: string, N: number): SimSummary {
  const byDay: DayRow[] = [];
  for (let d = 1; d <= days; d++) {
    const a = perDay[d - 1] as DayAcc;
    const active = Math.max(1, a.activeCount);
    const medBC = median(a.balancesBaseCore);
    const target = BALANCE_05[d] ?? 0;
    byDay.push({
      day: d,
      balanceMedianBaseCore: Math.round(medBC),
      balanceP10: Math.round(quantile(a.balancesAll, 0.1)),
      balanceP50: Math.round(quantile(a.balancesAll, 0.5)),
      balanceP90: Math.round(quantile(a.balancesAll, 0.9)),
      target05: target,
      devPct: target > 0 ? ((medBC - target) / target) * 100 : 0,
      earnMean: a.earnSum / active,
      spendMean: a.spendSum / active,
      ratio: a.spendSum > 0 ? a.earnSum / a.spendSum : 0,
      deficitShare: a.deficit / active,
      deepDeficitShare: a.deepDeficit / active,
      hoardShare: a.hoard / active,
      rwPerDau: a.rwViewsSum / active,
      surgeGamesPct: a.gamesSum > 0 ? a.crystalGamesSum / a.gamesSum : 0,
      deniedPerDau: a.deniedSum / active,
      earnBySource: a.earnBySource,
      spendBySink: a.spendBySink
    });
  }

  // Отклонения на чекпоинтах (12 §8.2 критерий M1 ±10%); короткие прогоны
  // (days < 30, тесты) оценивают только доступные чекпоинты.
  const reachable = CHECKPOINTS.filter((d) => d <= days);
  const checkpoints: Checkpoint[] = reachable.map((d) => {
    const row = byDay[d - 1] as DayRow;
    return { day: d, sim: row.balanceMedianBaseCore, target: row.target05, devPct: row.devPct };
  });
  let maxAbsDev = 0;
  let cpWithin10 = 0;
  for (const c of checkpoints) {
    const ad = Math.abs(c.devPct);
    if (ad > maxAbsDev) maxAbsDev = ad;
    if (ad <= 10) cpWithin10++;
  }

  // Fail-коридоры по сегментам (усреднение за все дни).
  const segAtt: Partial<Record<LevelSegment, number>> = {};
  const segFail: Partial<Record<LevelSegment, number>> = {};
  for (const aa of perDay) {
    for (const kk of LEVEL_SEGMENTS) {
      const av = aa.segAttempt[kk];
      if (av !== undefined) segAtt[kk] = (segAtt[kk] ?? 0) + av;
      const fv = aa.segFail[kk];
      if (fv !== undefined) segFail[kk] = (segFail[kk] ?? 0) + fv;
    }
  }
  const failRate = {} as Record<LevelSegment, number>;
  for (const sname of LEVEL_SEGMENTS) {
    const att = segAtt[sname] ?? 0;
    failRate[sname] = att > 0 ? (segFail[sname] ?? 0) / att : 0;
  }

  // Итоговые агрегаты (усреднение по «стабильной» части D14–D30 где уместно).
  const d14_30 = byDay.filter((r) => r.day >= 14);
  const ratioMean = mean(d14_30.map((r) => r.ratio));
  const rwPerDauMean = mean(byDay.map((r) => r.rwPerDau));
  const surgeMean = mean(byDay.map((r) => r.surgeGamesPct));
  const last = byDay[byDay.length - 1] as DayRow;

  // ad-ARPDAU: interstitial+banner (допущения 09 §4) + rewarded (симулируется).
  const e = tune.ecpm;
  const adArpdau = (tune.intPerDau * e.int + rwPerDauMean * e.rw + tune.bannerPerDau * e.banner) / 1000;

  // Красные флаги дизайна (12 §8.4).
  const flags: string[] = [];
  if (ratioMean < 0.95) flags.push('M2 < 0.95 после D14: sinks агрессивнее плана — дефицит до окна офферов (12 §8.4)');
  if (ratioMean > 1.15) flags.push('M2 > 1.15 после D14: инфляция прихода — earn завышен (05 §6)');
  if (last.deficitShare < 0.2) flags.push('M8 < 20% к D30: окно дефицита 05 §7 п.2 не открывается (12 §8.4)');
  if (last.hoardShare > 0.05) flags.push('M10 > 5% к D30: риск ветеранов-накопителей недооценён (12 §8.4)');
  if (surgeMean < 0.4) flags.push('M7 < 40%: Прилив мёртв для медианы — сверить pClear/заряд (12 §8.4)');

  return {
    meta: { runId, N, days, mode: simMode, tune, sharesOk: assertShares() },
    byDay,
    checkpoints,
    calibration: {
      maxAbsDevPct: maxAbsDev,
      checkpointsWithin10: cpWithin10,
      checkpointsTotal: reachable.length,
      pass: cpWithin10 === reachable.length && ratioMean >= 0.95 && ratioMean <= 1.15
    },
    aggregates: {
      ratioMean,
      rwPerDauMean,
      surgeGamesPct: surgeMean,
      adArpdau,
      deficitShareD30: last.deficitShare,
      deepDeficitShareD30: last.deepDeficitShare,
      hoardShareD30: last.hoardShare,
      failRate,
      failCorridors: FAIL_CORRIDORS
    },
    flags
  };
}

/* ==================== ТЕКСТОВАЯ СВОДКА (node/консоль) =================== */

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

/** Текстовая сводка 1:1 с прототипом — одна и та же в браузере и в stdout. */
export function toText(sum: SimSummary): string {
  const L: string[] = [];
  L.push('==========================================================================');
  L.push(' Block Surge — симулятор экономики (12-economy-sim.md), Проход Г');
  L.push('==========================================================================');
  L.push(
    ' runId=' + sum.meta.runId + '  N=' + sum.meta.N + '  дней=' + sum.meta.days +
    '  режим=' + sum.meta.mode + '  доли Σ=1: ' + (sum.meta.sharesOk ? 'ok' : 'СБОЙ')
  );
  L.push('');
  L.push(' Медиана баланса BASE×CORE по дням против таблицы 05 §4:');
  L.push(
    ' ' + pad('день', 5) + padL('sim', 7) + padL('05§4', 7) + padL('откл%', 8) +
    padL('earn', 7) + padL('spend', 7) + padL('ratio', 7) + padL('деф<200', 9)
  );
  for (const r of sum.byDay) {
    const mark = Math.abs(r.devPct) > 10 ? ' !' : '';
    L.push(
      ' ' + pad(r.day, 5) + padL(r.balanceMedianBaseCore, 7) + padL(r.target05, 7) +
      padL(r.devPct.toFixed(1), 8) + padL(r.earnMean.toFixed(0), 7) + padL(r.spendMean.toFixed(0), 7) +
      padL(r.ratio.toFixed(2), 7) + padL((r.deficitShare * 100).toFixed(0) + '%', 9) + mark
    );
  }
  L.push('');
  L.push(' Калибровка (M1, чекпоинты ' + CHECKPOINTS.join('/') + '):');
  for (const c of sum.checkpoints) {
    L.push(
      '   день ' + pad(c.day, 3) + ' sim=' + padL(c.sim, 5) + '  цель=' + padL(c.target, 5) +
      '  откл=' + padL(c.devPct.toFixed(1) + '%', 7) + (Math.abs(c.devPct) <= 10 ? '  ok' : '  ВНЕ ±10%')
    );
  }
  L.push(
    '   max|откл| = ' + sum.calibration.maxAbsDevPct.toFixed(1) + '%  ·  в ±10%: ' +
    sum.calibration.checkpointsWithin10 + '/' + sum.calibration.checkpointsTotal +
    '  ·  вердикт калибровки: ' + (sum.calibration.pass ? 'СОШЁЛСЯ' : 'требует тюнинга')
  );
  L.push('');
  L.push(' Агрегаты:');
  const ag = sum.aggregates;
  L.push('   earn/spend ratio (D14–30, цель 0.95–1.15): ' + ag.ratioMean.toFixed(3));
  L.push('   rewarded/DAU (цель ≈1.8): ' + ag.rwPerDauMean.toFixed(2));
  L.push('   % партий с кристаллом / Прилив (M7, цель ≥60%): ' + (ag.surgeGamesPct * 100).toFixed(0) + '%');
  L.push(
    '   ad-ARPDAU (T1-eCPM ' + sum.meta.tune.ecpm.rw + '/' + sum.meta.tune.ecpm.int + '/' +
    sum.meta.tune.ecpm.banner + '): $' + ag.adArpdau.toFixed(4)
  );
  L.push(
    '   доля дефицита D30: <200 = ' + (ag.deficitShareD30 * 100).toFixed(0) + '%  ·  <400 = ' +
    (ag.deepDeficitShareD30 * 100).toFixed(0) + '%  ·  накопители >5000 = ' + (ag.hoardShareD30 * 100).toFixed(1) + '%'
  );
  L.push('   fail-коридоры по сегментам уровней (03 §5.2):');
  for (const sn of LEVEL_SEGMENTS) {
    const cor = ag.failCorridors[sn];
    const fr = ag.failRate[sn] * 100;
    const inC = fr >= cor[0] * 100 - 1 && fr <= cor[1] * 100 + 1;
    L.push(
      '     ' + pad(sn, 8) + ' = ' + padL(fr.toFixed(1) + '%', 7) +
      '  (коридор ' + cor[0] * 100 + '–' + cor[1] * 100 + '%)' + (inC ? '' : '  вне')
    );
  }
  if (sum.flags.length) {
    L.push('');
    L.push(' Красные флаги дизайна (12 §8.4):');
    for (const f of sum.flags) L.push('   • ' + f);
  } else {
    L.push('');
    L.push(' Красных флагов дизайна нет (12 §8.4).');
  }
  L.push('==========================================================================');
  return L.join('\n');
}
