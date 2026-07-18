/**
 * Orchard Peaks — СИМУЛЯТОР ЭКОНОМИКИ (Проход Е.3, порт prototype/sim.js 1:1).
 *
 * Исполняемая реализация приложения [12-economy-sim.md]: агентная симуляция
 * 30 дней жизни медианного неплатящего игрока (персона «45–70», §12.2).
 * Отвечает на три вопроса главы 12: переход профицит→дефицит с точкой
 * «Кошелька» в окне дня 12–16 (§12.6 гейт К3), коридоры контрольного дашборда
 * (§12.5) и чувствительность экономики к смещению WR / темпа взноса / rewarded.
 *
 * Числа — из таблиц [05] §5.2, [06] §6.2, [11] §11.5/§11.7. Локальных констант
 * баланса нет: всё в объекте BOOK, каждое поле помечено источником.
 *
 * ДЕТЕРМИНИЗМ (инвариант I-E1): весь случай — через seeded-PRNG (mulberry32),
 * seed = base + 7·i на игрока (§12.1). НИ ОДНОГО обращения к Math.random /
 * Date.now в расчётах — прогон воспроизводим бит-в-бит по seed. Формулы,
 * порядок потребления RNG и ФОРМАТ СВОДКИ (formatSummary) портированы
 * ВЕРБАТИМ: вывод CLI обязан совпадать с `node prototype/sim.js` бит-в-бит.
 *
 * ДВА ВХОДА (один модуль): браузерный кокпит (CockpitUi → Experiments.runSim)
 * и headless CLI (src/sim/cli.ts, `npm run sim -- [seed] [N]`).
 */

/* ============================ ПАРАМЕТРЫ КНИГИ ============================ */

/** Бустеры симуляции (цены-sinks, [05] §5.2/§5.6). */
export interface SimBoosters {
  joker: number;
  plus5: number;
  basket: number;
  undoPaid: number;
}

export type SimBoosterKind = 'joker' | 'plus5' | 'basket';

/** Единственный источник номиналов симуляции (порт BOOK 1:1). */
export interface SimBook {
  /* Монетный контур, [05] §5.2 */
  entryBase: number;
  entryGrowth: number;
  winMHi: number;
  winMDrop: number;
  winMKnee: number;
  /* Кривая WR, [11] §11.5 */
  wrPlateau: number;
  wrSpan: number;
  wrDecay: number;
  stoneDip: number;
  /* Бонус за остаток стока */
  stockBonusPerCard: number;
  stockLeft: number[];
  /* Бустеры */
  boosters: SimBoosters;
  /* Прочие sources */
  wheelEV: number;
  streak7: number[];
  missionDaily: { count: number; lo: number; hi: number; minAttempts: number };
  missionWeekly: { count: number; lo: number; hi: number };
  missionMult: number;
  chestTiers: number[][];
  /* Rewarded «Кошелёк» RW6, [06] §6.2 */
  rw6Grant: number;
  rw6CapDay: number;
  rw6OfferAt: number;
  rw2DoubleP: number;
  rw1RescueP: number;
  rw3StoneP: number;
  /* Стартовые запасы, [05] §5.3 */
  start: { coins: number; harvest: number; freeUndo: number; joker: number };
  /* Сад, §12.4 */
  goldenBedDays: number[];
  orderCostMult: number;
  harvestLo: number;
  harvestHi: number;
  rw3HarvestMult: number;
  zoneOrderCosts: number[][];
  /* eCPM для ad-ARPDAU симкогорты, [09] §9.3 / [06] §6.7 */
  ecpmRewarded: number;
  ecpmInt: number;
  intStartLevel: number;
  intDailyCap: number;
  intMinLevels: number;
  /* Допущение IAP-ARPDAU (не симулируется: персона неплатящая) */
  iapArpdau: number;
}

/** Числа 1:1 из prototype/sim.js (источники — в комментариях прототипа). */
export const BOOK: SimBook = {
  entryBase: 350,
  entryGrowth: 1.012,
  winMHi: 2.2,
  winMDrop: 0.7,
  winMKnee: 60,

  wrPlateau: 0.55,
  wrSpan: 0.35,
  wrDecay: 25,
  stoneDip: -0.15,

  stockBonusPerCard: 25,
  stockLeft: [2, 3],

  boosters: { joker: 1200, plus5: 900, basket: 800, undoPaid: 150 },

  wheelEV: 350,
  streak7: [200, 300, 400, 500, 600, 800, 1500],
  missionDaily: { count: 3, lo: 150, hi: 400, minAttempts: 4 },
  missionWeekly: { count: 3, lo: 800, hi: 1500 },
  missionMult: 1.0,
  chestTiers: [
    [5, 300],
    [10, 700],
    [15, 1500]
  ],

  rw6Grant: 0.8,
  rw6CapDay: 3,
  rw6OfferAt: 2.0,
  rw2DoubleP: 0.08,
  rw1RescueP: 0.48,
  rw3StoneP: 0.5,

  start: { coins: 1000, harvest: 20, freeUndo: 2, joker: 1 },

  goldenBedDays: [9, 23],
  orderCostMult: 1.0,
  harvestLo: 10,
  harvestHi: 14,
  rw3HarvestMult: 2,
  zoneOrderCosts: [
    [40, 60, 80, 90, 100, 110, 130, 140],
    [40, 70, 100, 120, 130, 150, 160, 170, 180, 180],
    [40, 70, 90, 110, 120, 130, 140, 150, 150, 150, 150, 140]
  ],

  ecpmRewarded: 16.0,
  ecpmInt: 12.0,
  intStartLevel: 12,
  intDailyCap: 8,
  intMinLevels: 2,

  iapArpdau: 0.12
};

/* ============================ SEEDED-PRNG ============================ */

/** mulberry32 — тот же PRNG-контракт, что I6 в [11]: seed → один поток чисел. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimRng {
  f: () => number;
  u: (a: number, b: number) => number;
  iInc: (a: number, b: number) => number;
  gauss: (mean: number, sd: number) => number;
  tri: (a: number, c: number, b: number) => number;
}

function makeRng(seed: number): SimRng {
  const r = mulberry32(seed);
  return {
    f: r,
    u: (a, b) => a + (b - a) * r(),
    iInc: (a, b) => Math.floor(a + (b - a + 1) * r()), // целое [a,b]
    gauss: (mean, sd) => {
      const u = 1 - r();
      const v = r();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // Треугольное распределение с модой c на [a,b] (день адопции rewarded, §12.2)
    tri: (a, c, b) => {
      const u = r();
      const fc = (c - a) / (b - a);
      return u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
    }
  };
}

/* ============================ ФОРМУЛЫ ЭКОНОМИКИ ============================ */

function round10(x: number): number {
  return Math.round(x / 10) * 10;
}

/** Взнос E(n) = base·growthⁿ, округление до 10 ([05] §5.2). */
export function E(n: number, P: SimBook): number {
  return round10(P.entryBase * Math.pow(P.entryGrowth, n));
}

/** Множитель выигрыша M(n). */
export function M(n: number, P: SimBook): number {
  return P.winMHi - P.winMDrop * Math.min(1, n / P.winMKnee);
}

export function isStone(n: number): boolean {
  return n >= 10 && n % 10 === 0;
}

/** Кривая WR W(n) = плато + span·e^(−n/decay) + Osc на «камнях». */
export function W(n: number, P: SimBook): number {
  const base = P.wrPlateau + P.wrSpan * Math.exp(-n / P.wrDecay);
  return base + (isStone(n) ? P.stoneDip : 0);
}

export function chapterOf(n: number): number {
  return Math.max(1, Math.min(12, Math.ceil(n / 20))); // глава ≈ 20 ур.
}

function attemptsBase(t: number): number {
  if (t <= 1) return 14;
  if (t === 2) return 12;
  if (t === 3) return 11;
  if (t <= 7) return 10;
  if (t <= 20) return 9;
  return 8;
}

function aggro(t: number): number {
  if (t <= 2) return 0.35;
  if (t <= 5) return 0.55;
  if (t <= 10) return 1.05;
  return 1.8;
}

function wealthMult(t: number): number {
  return t <= 5 ? 8 : t <= 10 ? 6 : 4;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/* ============================ ПЕРСОНА ИГРОКА (§12.2) ============================ */

interface Profile {
  skillOffset: number;
  attemptsMult: number;
  rwAdoptDay: number;
  spendAffinity: number;
}

function makeProfile(rng: SimRng): Profile {
  return {
    skillOffset: clamp(rng.gauss(0, 0.04), -0.08, 0.08), // сдвиг WR ±8 п.п.
    attemptsMult: clamp(rng.gauss(1, 0.12), 0.7, 1.3), // частота попыток
    rwAdoptDay: Math.round(rng.tri(10, 14, 21)), // «без rewarded до дня 10»
    spendAffinity: rng.u(0.85, 1.15) // склонность тратить
  };
}

interface PlayerState {
  coins: number;
  harvest: number;
  level: number;
  lossStreakOnLevel: number;
  freeUndoLeft: number;
  joker: number;
  profile: Profile;
  zone: number;
  orderIdx: number;
  levelsSinceInt: number;
  intToday: number;
}

function initState(P: SimBook, profile: Profile): PlayerState {
  return {
    coins: P.start.coins,
    harvest: P.start.harvest,
    level: 1,
    lossStreakOnLevel: 0,
    freeUndoLeft: P.start.freeUndo,
    joker: P.start.joker,
    profile,
    zone: 0,
    orderIdx: 0,
    levelsSinceInt: 99,
    intToday: 0
  };
}

/* ============================ ПОЛИТИКИ ПОВЕДЕНИЯ (§12.2) ============================ */

// «Кошелёк» RW6: добор монет до входа при реальной нужде (coins < E), кап 3/день.
function policyWallet(
  st: PlayerState,
  t: number,
  e: number,
  viewsToday: number,
  P: SimBook,
  rng: SimRng
): boolean {
  return t >= st.profile.rwAdoptDay && st.coins < e && viewsToday < P.rw6CapDay && rng.f() < 0.75;
}

// Спасение в тупике: сперва RW1 (бесплатно), затем монеты 0.9·E.
function policyRescue(st: PlayerState, t: number, e: number, P: SimBook, rng: SimRng): string {
  const aff = st.profile.spendAffinity;
  const ag = aggro(t);
  if (t >= st.profile.rwAdoptDay && rng.f() < P.rw1RescueP) return 'RW1';
  const gate = t >= st.profile.rwAdoptDay ? 1.5 : 3.0;
  if (st.coins > gate * e && rng.f() < Math.min(0.9, 0.65 * aff * ag)) return 'PAY';
  return 'DECLINE';
}

interface BoosterBuy {
  kind: SimBoosterKind;
  paid: boolean;
  ad?: boolean;
}

// Pre-level бустер: на «камне» — бесплатный RW3-лукошко или «+5 карт»; вне
// камня — спонтанная покупка выше порога/гейта («обучение богатством», §12.2).
function policyBooster(
  st: PlayerState,
  t: number,
  e: number,
  stone: boolean,
  P: SimBook,
  rng: SimRng
): BoosterBuy | null {
  const aff = st.profile.spendAffinity;
  const ag = aggro(t);
  if (stone) {
    if (t >= st.profile.rwAdoptDay && rng.f() < P.rw3StoneP) {
      return { kind: 'basket', paid: false, ad: true }; // RW3 бесплатно, ×2 урожай
    }
    if (st.coins > 2 * e && rng.f() < Math.min(0.85, 0.6 * aff * ag)) {
      return { kind: 'plus5', paid: true };
    }
    return null;
  }
  const gate = (t >= st.profile.rwAdoptDay ? 1.5 : wealthMult(t)) * e;
  if (st.coins <= gate) return null;
  const rich = st.coins / e;
  const richK = rich > 15 ? 5.8 : rich > 10 ? 3.0 : rich > 7 ? 1.5 : 1.0;
  if (rng.f() < Math.min(0.64, 0.078 * aff * ag * richK)) {
    // Лукошко — «любимый бустер неплательщика» ([05] §5.6): чаще прочих.
    const r = rng.f();
    const kind: SimBoosterKind = r < 0.3 ? 'joker' : r < 0.55 ? 'plus5' : 'basket';
    return { kind, paid: true };
  }
  return null;
}

/* ============================ УРОЖАЙ / САД (§12.4) ============================ */

function harvestYield(buy: BoosterBuy | null, t: number, P: SimBook, day: DayLog): number {
  let h = P.harvestLo + Math.floor(day.rngH() * (P.harvestHi - P.harvestLo + 1)); // U_int(10,14)
  if (buy !== null && buy.kind === 'basket') h *= buy.ad === true ? P.rw3HarvestMult : 2;
  if (P.goldenBedDays.indexOf(t) >= 0) h *= 2; // «Золотая грядка»
  return h;
}

function orderCost(zone: number, idx: number, P: SimBook): number | undefined {
  const band = P.zoneOrderCosts[Math.min(zone, P.zoneOrderCosts.length - 1)];
  if (idx >= band.length) return undefined;
  return Math.round(band[idx] * P.orderCostMult);
}

function settleGardenOrders(st: PlayerState, day: DayLog, P: SimBook): void {
  for (;;) {
    const cost = orderCost(st.zone, st.orderIdx, P);
    if (cost === undefined) {
      st.zone++;
      st.orderIdx = 0;
      day.zoneClosed = st.zone;
      continue;
    }
    if (st.harvest < cost) break;
    st.harvest -= cost;
    st.orderIdx++;
    day.orders++;
  }
}

/* ============================ ДЕНЬ (§12.3) ============================ */

interface DayLog {
  sources: number;
  rwIncome: number;
  sinks: number;
  wins: number;
  attempts: number;
  boostAttempts: number;
  rw6Views: number;
  rwImps: number;
  intImps: number;
  orders: number;
  zoneClosed: number;
  harvestNominal: number;
  harvestReal: number;
  /** Номинал урожая — из того же seeded-потока игрока (алиас rng.f). */
  rngH: () => number;
}

function newDayLog(rng: SimRng): DayLog {
  return {
    sources: 0,
    rwIncome: 0,
    sinks: 0,
    wins: 0,
    attempts: 0,
    boostAttempts: 0,
    rw6Views: 0,
    rwImps: 0,
    intImps: 0,
    orders: 0,
    zoneClosed: -1,
    harvestNominal: 0,
    harvestReal: 0,
    rngH: rng.f
  };
}

function earn(st: PlayerState, amount: number, day: DayLog): void {
  amount = Math.round(amount);
  st.coins += amount;
  day.sources += amount;
}

function grantRW(st: PlayerState, amount: number, day: DayLog): void {
  amount = Math.round(amount);
  st.coins += amount;
  day.rwIncome += amount;
}

function pay(st: PlayerState, amount: number, day: DayLog): void {
  amount = Math.round(amount);
  st.coins -= amount;
  day.sinks += amount;
}

/** Один день игрока (порт simulateDay 1:1 — порядок потребления RNG сохранён). */
function simulateDay(st: PlayerState, t: number, P: SimBook, rng: SimRng): DayLog {
  const day = newDayLog(rng);

  earn(st, P.streak7[(t - 1) % 7], day); // «Утренняя лейка», без пропусков дней
  if (rng.f() < 0.9) earn(st, P.wheelEV, day); // колесо ярмарки, 1/день

  st.intToday = 0; // суточный INT-кап
  const A = Math.round(attemptsBase(t) * st.profile.attemptsMult);

  for (let i = 0; i < A; i++) {
    const n = st.level;
    const e = E(n, P);

    while (policyWallet(st, t, e, day.rw6Views, P, rng)) {
      // RW6: добор монет до входа
      grantRW(st, round10(P.rw6Grant * e), day);
      day.rw6Views++;
      day.rwImps++;
    }
    if (st.coins < e) break; // банкротство дня — инвариант I-E3
    pay(st, e, day);
    day.attempts++; // взнос ([05] §5.2)

    const buy = policyBooster(st, t, e, isStone(n), P, rng); // денежный поток, WR не трогаем (I-E2)
    if (buy !== null) {
      day.boostAttempts++;
      if (buy.paid) pay(st, P.boosters[buy.kind], day);
      else day.rwImps++; // RW3 — rewarded-показ
    }
    if (st.freeUndoLeft > 0) st.freeUndoLeft--; // стартовые ундо гасят первые платные
    else if (rng.f() < 0.12 * aggro(t)) pay(st, P.boosters.undoPaid, day);

    const pity = st.lossStreakOnLevel >= 5 ? 0.09 : st.lossStreakOnLevel >= 3 ? 0.05 : 0;
    const p = clamp(W(n, P) + st.profile.skillOffset + pity, 0.02, 0.995);
    const win = rng.f() < p;

    if (rng.f() < (1 - p) * 0.9) {
      // тупик со столом ≥ 60% — оффер спасения
      const r = policyRescue(st, t, e, P, rng);
      if (r === 'RW1') day.rwImps++; // бесплатный второй шанс — rewarded-показ
      else if (r === 'PAY') {
        pay(st, round10(0.9 * e), day); // конверсия уже в W(n) — только деньги
        if (st.coins > 2 * e && rng.f() < 0.42) pay(st, round10(1.2 * e), day); // повторное спасение
      }
    }

    if (win) {
      let gain =
        round10(M(n, P) * e) +
        P.stockBonusPerCard *
          chapterOf(n) *
          (P.stockLeft[0] + Math.floor(rng.f() * (P.stockLeft[1] - P.stockLeft[0] + 1)));
      if (t >= st.profile.rwAdoptDay && rng.f() < P.rw2DoubleP) {
        // RW2 «удвоить» — редкая привычка
        const dbl = round10(M(n, P) * e);
        grantRW(st, dbl, day);
        gain += dbl;
        day.rwImps++;
      }
      earn(st, gain, day);
      const yld = harvestYield(buy, t, P, day);
      st.harvest += yld;
      day.harvestNominal += yld;
      day.harvestReal += yld;
      day.wins++;
      st.level++;
      st.lossStreakOnLevel = 0;

      // INT1 на возврате в сад после победы ([06] §6.3): уровень ≥ 12, день ≥ 2,
      // ≥ 2 уровня с прошлого INT, дневной кап 8. Персона неплатящая → без remove-ads.
      st.levelsSinceInt++;
      if (
        n >= P.intStartLevel &&
        t >= 2 &&
        st.levelsSinceInt >= P.intMinLevels &&
        st.intToday < P.intDailyCap
      ) {
        day.intImps++;
        st.intToday++;
        st.levelsSinceInt = 0;
      }
    } else {
      const yl = harvestYield(buy, t, P, day);
      const realized = Math.round(yl * rng.u(0.45, 0.65)); // пол поражения ≥ 50% ([11] Q4)
      st.harvest += realized;
      day.harvestNominal += yl;
      day.harvestReal += realized;
      st.lossStreakOnLevel++;
      st.levelsSinceInt++;
    }
  }

  if (day.attempts >= P.missionDaily.minAttempts) {
    // daily-миссии закрываются игрой
    for (let m = 0; m < P.missionDaily.count; m++) {
      if (rng.f() < 0.85) earn(st, round10(P.missionMult * rng.u(P.missionDaily.lo, P.missionDaily.hi)), day);
    }
  }
  if (t % 7 === 0) {
    // weekly-миссии
    for (let w = 0; w < P.missionWeekly.count; w++) {
      if (rng.f() < 0.8) earn(st, round10(P.missionMult * rng.u(P.missionWeekly.lo, P.missionWeekly.hi)), day);
    }
  }
  for (let c = 0; c < P.chestTiers.length; c++) {
    // сундук тёти Марты
    if (day.wins >= P.chestTiers[c][0]) earn(st, P.chestTiers[c][1], day);
  }

  settleGardenOrders(st, day, P);
  return day;
}

/* ============================ СТАТИСТИКА ============================ */

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const idx = clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1);
  return a[idx];
}

/* ============================ ПРОГОН КОГОРТЫ ============================ */

export function mergeParams(over?: Partial<SimBook> | null): SimBook {
  const P = JSON.parse(JSON.stringify(BOOK)) as SimBook;
  if (over) {
    for (const k of Object.keys(over)) {
      const v = (over as Record<string, unknown>)[k];
      if (v !== undefined) (P as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return P;
}

export interface RunOptions {
  N?: number;
  days?: number;
  seed?: number;
  params?: Partial<SimBook> | null;
}

export interface DayRow {
  day: number;
  medBalance: number;
  medLevel: number;
  medSaldo: number;
  entry: number;
  balInEntries: number;
}

export interface SimRunResult {
  meta: { N: number; days: number; seed: number; params: SimBook };
  byDay: DayRow[];
  peak: { day: number; balance: number };
  firstNegDay: number;
  wallet: { median: number; iqrLo: number; iqrHi: number; inWindow: boolean };
  balD7Entries: number;
  balD30Entries: number;
  sinkSourceD14: number;
  boosterShareD14: number;
  garden: { ordersPerDay: number; zone1ByD7Pct: number };
  harvestRealization: number;
  ad: {
    adArpdau: number;
    rewardedPerDau: number;
    intPerDau: number;
    rw6PerDau: number;
    ecpmRw: number;
    ecpmInt: number;
  };
}

/** Прогон когорты (порт run 1:1): сиды «seed + 7·i», §12.1. */
export function run(opts: RunOptions = {}): SimRunResult {
  const P = mergeParams(opts.params);
  const N = Math.max(1, opts.N ?? 2000);
  const days = opts.days ?? 30;
  const baseSeed = opts.seed !== undefined && opts.seed !== null ? opts.seed | 0 : 1000;

  // Помесячные когортные накопители по дням: баланс, уровень, сальдо.
  const balByDay: number[][] = [];
  const lvlByDay: number[][] = [];
  const saldoByDay: number[][] = [];
  for (let d = 0; d <= days; d++) {
    balByDay[d] = [];
    lvlByDay[d] = [];
    saldoByDay[d] = [];
  }

  const walletPoints: number[] = []; // точка «Кошелька» на игрока
  let zone1ByD7 = 0; // закрыл зону 1 к D7
  let ordersTotal = 0;
  // Накопители коридоров D14+ (дни 15–30) — когортно-агрегатные
  let sinks1530 = 0;
  let sourcesCore1530 = 0;
  let attempts1530 = 0;
  let boost1530 = 0;
  // Ad-ARPDAU
  let rwImpsTot = 0;
  let intImpsTot = 0;
  let rw6ViewsTot = 0;
  let harvestNomTot = 0;
  let harvestRealTot = 0;

  for (let i = 0; i < N; i++) {
    const rng = makeRng(baseSeed + 7 * i);
    const profile = makeProfile(rng);
    const st = initState(P, profile);
    let wp = Infinity;
    let prevBal = st.coins;

    for (let t = 1; t <= days; t++) {
      const day = simulateDay(st, t, P, rng);

      balByDay[t].push(st.coins);
      lvlByDay[t].push(st.level);
      saldoByDay[t].push(st.coins - prevBal);
      prevBal = st.coins;

      // Точка «Кошелька»: первый день, когда игрок не может оплатить попытки
      // без RW6 ЛИБО баланс на конец дня < 2·E(n) ([05] §5.4/§5.7, §12.5).
      if (wp === Infinity && (day.rw6Views > 0 || st.coins < P.rw6OfferAt * E(st.level, P))) wp = t;

      if (t >= 15) {
        sinks1530 += day.sinks;
        sourcesCore1530 += day.sources;
        attempts1530 += day.attempts;
        boost1530 += day.boostAttempts;
      }
      if (t === 7 && st.zone >= 1) zone1ByD7++;

      rwImpsTot += day.rwImps;
      intImpsTot += day.intImps;
      rw6ViewsTot += day.rw6Views;
      ordersTotal += day.orders;
      harvestNomTot += day.harvestNominal;
      harvestRealTot += day.harvestReal;
    }
    walletPoints.push(wp === Infinity ? days + 1 : wp);
  }

  /* ---- Свод по дням ---- */
  const byDay: DayRow[] = [];
  for (let dd = 1; dd <= days; dd++) {
    const mb = median(balByDay[dd]);
    const ml = Math.round(median(lvlByDay[dd]));
    byDay.push({
      day: dd,
      medBalance: Math.round(mb),
      medLevel: ml,
      medSaldo: Math.round(median(saldoByDay[dd])),
      entry: E(ml, P),
      balInEntries: E(ml, P) > 0 ? mb / E(ml, P) : 0
    });
  }

  /* ---- Пик / первый дефицитный день ---- */
  let peak = { day: 1, balance: byDay[0].medBalance };
  for (let q = 1; q < byDay.length; q++) {
    if (byDay[q].medBalance > peak.balance) peak = { day: byDay[q].day, balance: byDay[q].medBalance };
  }
  let firstNeg = 0;
  for (let f = 0; f < byDay.length; f++) {
    if (byDay[f].medSaldo < 0) {
      firstNeg = byDay[f].day;
      break;
    }
  }

  const playerDays = N * days;
  const adRevTotal = (rwImpsTot * P.ecpmRewarded + intImpsTot * P.ecpmInt) / 1000;

  const wpMedian = median(walletPoints);
  const find = (d: number): DayRow => {
    for (let z = 0; z < byDay.length; z++) {
      if (byDay[z].day === d) return byDay[z];
    }
    return byDay[byDay.length - 1];
  };

  return {
    meta: { N, days, seed: baseSeed, params: P },
    byDay,
    peak,
    firstNegDay: firstNeg,
    wallet: {
      median: wpMedian,
      iqrLo: percentile(walletPoints, 0.25),
      iqrHi: percentile(walletPoints, 0.75),
      inWindow: wpMedian >= 12 && wpMedian <= 16
    },
    balD7Entries: find(7).balInEntries,
    balD30Entries: find(days).balInEntries,
    sinkSourceD14: sourcesCore1530 > 0 ? sinks1530 / sourcesCore1530 : 0,
    boosterShareD14: attempts1530 > 0 ? boost1530 / attempts1530 : 0,
    garden: {
      ordersPerDay: ordersTotal / playerDays,
      zone1ByD7Pct: zone1ByD7 / N
    },
    harvestRealization: harvestNomTot > 0 ? harvestRealTot / harvestNomTot : 0,
    ad: {
      adArpdau: adRevTotal / playerDays,
      rewardedPerDau: rwImpsTot / playerDays,
      intPerDau: intImpsTot / playerDays,
      rw6PerDau: rw6ViewsTot / playerDays,
      ecpmRw: P.ecpmRewarded,
      ecpmInt: P.ecpmInt
    }
  };
}

/* ============================ ГЕЙТЫ К1–К8 (§12.6) ============================ */

export interface GateRow {
  id: string;
  name: string;
  target: string;
  fact: string;
  ok: boolean;
}

/** Оценка симкогорты против контрольных точек приёмки (порт checkGates 1:1). */
export function checkGates(res: SimRunResult): GateRow[] {
  const g: GateRow[] = [];
  const add = (id: string, name: string, target: string, fact: string, ok: boolean): void => {
    g.push({ id, name, target, fact, ok });
  };

  add(
    'К1',
    'Пик баланса',
    'день 3–7',
    'день ' + res.peak.day + ' (' + Math.round(res.peak.balance / 1000) + 'K)',
    res.peak.day >= 3 && res.peak.day <= 7
  );
  add('К2', 'Первый отрицательный день', '5 ± 1', 'день ' + res.firstNegDay, res.firstNegDay >= 4 && res.firstNegDay <= 6);
  add(
    'К3',
    'Точка «Кошелька» (профицит→дефицит)',
    'день 12–16',
    'медиана ' + res.wallet.median + ', IQR ' + res.wallet.iqrLo + '–' + res.wallet.iqrHi,
    res.wallet.inWindow
  );
  add('К4', 'Баланс D7 во взносах', '8–15', res.balD7Entries.toFixed(1), res.balD7Entries >= 8 && res.balD7Entries <= 15);
  add('К5', 'Sink/Source D14+ (без RW)', '1.05–1.15', res.sinkSourceD14.toFixed(2), res.sinkSourceD14 >= 1.05 && res.sinkSourceD14 <= 1.15);
  add(
    'К6',
    'Доля уровней с бустером D14+',
    '15–25%',
    (res.boosterShareD14 * 100).toFixed(0) + '%',
    res.boosterShareD14 >= 0.15 && res.boosterShareD14 <= 0.25
  );
  add('К7', 'Баланс D30 во взносах', '1–2 (карусель)', res.balD30Entries.toFixed(1), res.balD30Entries >= 1 && res.balD30Entries <= 2);
  add(
    'К8',
    'Заказов/день; зона 1 к D7',
    '≥ 1; 60%',
    res.garden.ordersPerDay.toFixed(2) + '; ' + (res.garden.zone1ByD7Pct * 100).toFixed(0) + '%',
    res.garden.ordersPerDay >= 1 && res.garden.zone1ByD7Pct >= 0.6
  );
  return g;
}

/* ============================ CLI-СВОДКА ============================ */

function fmt(n: number): string {
  n = Math.round(n);
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 10000) return s + a;
  if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return s + (a / 1000000).toFixed(2) + 'M';
}

function pad(v: number | string, w: number): string {
  let out = String(v);
  while (out.length < w) out = ' ' + out;
  return out;
}

function rpad(v: number | string, w: number): string {
  let out = String(v);
  while (out.length < w) out = out + ' ';
  return out;
}

/** Текстовая сводка (порт formatSummary ВЕРБАТИМ — бит-в-бит с прототипом). */
export function formatSummary(res: SimRunResult): string {
  const P = res.meta.params;
  const L: string[] = [];
  L.push('==============================================================');
  L.push(' Orchard Peaks — СИМУЛЯТОР ЭКОНОМИКИ (Проход Г, приложение 12)');
  L.push('==============================================================');
  L.push(
    ' N=' + res.meta.N + ' игроков · ' + res.meta.days + ' дней · seed=' + res.meta.seed +
      ' · взнос E(n)=' + P.entryBase + '·' + P.entryGrowth + 'ⁿ'
  );
  L.push(
    ' WR(n)=' + P.wrPlateau + '+' + P.wrSpan + '·e^(−n/' + P.wrDecay + ')  ' +
      '(камни ' + P.stoneDip + ') · rw6-грант ' + P.rw6Grant + '·E · заказы ×' + P.orderCostMult
  );
  L.push('');
  L.push(' Монетный контур по дням (медианы когорты):');
  L.push(' ---------------------------------------------------------------');
  L.push('  День |  Ур. |     Баланс |  Сальдо/день |  Бал/E |  Взнос E(n)');
  L.push(' ------+------+------------+--------------+--------+------------');
  const show = [1, 2, 4, 5, 7, 10, 14, 21, 30];
  for (let s = 0; s < res.byDay.length; s++) {
    const r = res.byDay[s];
    if (show.indexOf(r.day) < 0) continue;
    L.push(
      '  ' + pad(r.day, 3) + '  | ' + pad(r.medLevel, 4) + ' | ' + pad(fmt(r.medBalance), 10) +
        ' | ' + pad((r.medSaldo >= 0 ? '+' : '') + fmt(r.medSaldo), 12) +
        ' | ' + pad(r.balInEntries.toFixed(1), 6) + ' | ' + pad(fmt(r.entry), 10)
    );
  }
  L.push('');
  L.push(
    ' Точка «Кошелька» (профицит→дефицит): медиана день ' + res.wallet.median +
      ', IQR ' + res.wallet.iqrLo + '–' + res.wallet.iqrHi +
      '  →  окно 12–16: ' + (res.wallet.inWindow ? 'ПОПАЛИ ✓' : 'мимо ✗')
  );
  L.push(
    ' Пик баланса: день ' + res.peak.day + ' (' + fmt(res.peak.balance) + ')' +
      ' · первый дефицитный день: ' + res.firstNegDay
  );
  L.push('');
  L.push(
    ' Сад: заказов/день ' + res.garden.ordersPerDay.toFixed(2) +
      ' · зона 1 к D7 у ' + (res.garden.zone1ByD7Pct * 100).toFixed(0) + '% когорты' +
      ' · реализация урожая ' + (res.harvestRealization * 100).toFixed(0) + '% номинала'
  );
  L.push(
    ' Реклама: ad-ARPDAU $' + res.ad.adArpdau.toFixed(4) +
      ' · rewarded ' + res.ad.rewardedPerDau.toFixed(2) + '/DAU' +
      ' (RW6 ' + res.ad.rw6PerDau.toFixed(2) + ')' +
      ' · INT ' + res.ad.intPerDau.toFixed(2) + '/DAU'
  );
  L.push('');
  L.push(' Контрольные точки приёмки (§12.6):');
  L.push(' ---------------------------------------------------------------');
  const gates = checkGates(res);
  let passed = 0;
  for (let gi = 0; gi < gates.length; gi++) {
    const gg = gates[gi];
    if (gg.ok) passed++;
    L.push(
      '  ' + gg.id + ' ' + (gg.ok ? '✓' : '✗') + '  ' + rpad(gg.name, 40) +
        ' цель ' + rpad(gg.target, 16) + ' факт ' + gg.fact
    );
  }
  L.push(' ---------------------------------------------------------------');
  L.push('  Пройдено ' + passed + '/' + gates.length + ' контрольных точек.');
  L.push('==============================================================');
  return L.join('\n');
}
