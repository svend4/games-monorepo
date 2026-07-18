/**
 * Soft-launch эксперименты WordGrove (Проход Е.3, порт experiments.js
 * Прохода Г). Три блока поверх симулятора (src/sim):
 *   1) A/B-фреймворк — пул из 3 экспериментов прототипа 1:1 (цена подсказки /
 *      длина триала / INT-кап), ДЕТЕРМИНИРОВАННОЕ назначение варианта
 *      fnv1a32-хешем персистентного session-id;
 *   2) панель тюнинга ручек (spendStress, earn-rate EV, ad-капы, eCPM) с
 *      localStorage (ключ 'wordgrove_softlaunch', схема прототипа) и сбросом
 *      к книге; НОМИНАЛЫ 05/06 не тюнятся (INV-S1) — их правят A/B-сценарии;
 *   3) гейты go/iterate/kill (09 §4.3): D1 / ARPDAU / ROAS(365) / ROAS(7) /
 *      подписочная доля против kill/scale-порогов 1:1, LTV(365) с подписочным
 *      компонентом + виджет чувствительности (обвал триала → обвал LTV),
 *      счётчик iterate ≤2.
 *
 * Кокпит — офлайн-инструмент прод-команды: в игру НЕ вмешивается, ядро/
 * экономику/монетизацию/сейвы игры не трогает; пишет только свой ключ.
 * Расчёты детерминированы: runId привязан к session-id; Math.random/Date.now
 * встречаются ТОЛЬКО в первой генерации session-id (дальше он персистентен).
 */
import { fnv1a32 } from '../core/rng';
import { defaultStorage, type KeyValueStorage } from '../core/storage';
import { BOOK_TUNE, runSim, type McSummary, type RefSummary, type TuneOverrides } from '../sim/sim';
import {
  SOFTLAUNCH_KEY,
  sanitizeSoftlaunch,
  softlaunchDefaults,
  type EcpmSubKey,
  type RetScenarioId,
  type SoftlaunchState,
  type TuneNumericKey
} from './save';

/* ========================= РУЧКИ ТЮНИНГА (панель) ======================= */

export type KnobKey = TuneNumericKey | 'ecpm.rw' | 'ecpm.int' | 'ecpm.banner';

export interface KnobDef {
  key: KnobKey;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

/** key совпадает с ключом tune симулятора (BOOK_TUNE); ecpm.* — вложенные.
 * «Книга» — калиброванный baseline (12 §8), к которому возвращает «сброс». */
export const KNOBS: readonly KnobDef[] = [
  { key: 'spendScale', group: 'Сложность / earn-rate', label: 'spendStress-масштаб (интенсивность трат)',
    min: 3, max: 9, step: 0.25, hint: 'общий множитель лестницы подсказок (§8.3); ↑ = быстрее дно' },
  { key: 'missionEV', group: 'Сложность / earn-rate', label: 'Daily-миссии EV / день',
    min: 40, max: 130, step: 6, hint: '120×выполняемость; книга 84 (05 §4)' },
  { key: 'weeklyEV', group: 'Сложность / earn-rate', label: 'Weekly-миссии EV / нед',
    min: 300, max: 700, step: 25, hint: 'суммарно ~550/нед (05 §2.1); компенсатор M-12' },
  { key: 'rv2Mult', group: 'Сложность / earn-rate', label: 'RV-2 множитель монет (×2 / ×2.5)',
    min: 2, max: 3, step: 0.5, hint: 'сценарий S4 (12 §6); guardrail медиана D30 ≤ 900' },
  { key: 'startCoins', group: 'Сложность / earn-rate', label: 'Стартовый баланс монет',
    min: 200, max: 500, step: 50, hint: 'старт 300 (05 §3)' },
  { key: 'intPerDau', group: 'Реклама: капы', label: 'INT-кап / DAU (interstitial)',
    min: 2.5, max: 5, step: 0.1, hint: 'показы interstitial на DAU (09 §3, кап 06 §4)' },
  { key: 'bannerPerDau', group: 'Реклама: капы', label: 'Banner / DAU',
    min: 6, max: 12, step: 0.5, hint: 'показы баннера на DAU (09 §3)' },
  { key: 'rv1DayCap', group: 'Реклама: капы', label: 'RV-1 «Бесплатная Лампа» кап / день',
    min: 1, max: 6, step: 1, hint: 'дневной кап RV-1 (06 §3.1: ≤4/день)' },
  { key: 'ecpm.rw', group: 'eCPM (06 §8.1)', label: 'eCPM rewarded, $',
    min: 4, max: 20, step: 0.5, hint: 'rewarded, $ за 1000 показов (US $17,8 / бленд $13)' },
  { key: 'ecpm.int', group: 'eCPM (06 §8.1)', label: 'eCPM interstitial, $',
    min: 3, max: 16, step: 0.5, hint: 'interstitial, $ за 1000 показов' },
  { key: 'ecpm.banner', group: 'eCPM (06 §8.1)', label: 'eCPM banner, $',
    min: 0.1, max: 1.0, step: 0.05, hint: 'banner, $ за 1000 показов' }
];

/* ============================ ПУЛ A/B (09 §6, 05 §10) =================== */

export interface ExperimentVariant {
  id: string;
  label: string;
  over: TuneOverrides;
}

export interface ExperimentDef {
  id: string;
  name: string;
  /** Первичная метрика эксперимента. */
  primary: string;
  /** Guardrail-метрика (сторож). */
  guardrail: string;
  /** variants[0] — контроль. */
  variants: readonly ExperimentVariant[];
}

/** Пул прототипа 1:1: цена Лампы 100/80, триал 7/3 дней, INT-кап 3.2/4.0.
 * Эти A/B меняют НОМИНАЛ/продукт — решения экономиста/прода (05 §10), не
 * калибровку (INV-S1). */
export const EXPERIMENTS: readonly ExperimentDef[] = [
  {
    id: 'hint_price',
    name: 'Цена Лампы (подсказка)',
    primary: 'окно конверсии / расход',
    guardrail: 'инфляция баланса D30 (05 §10: цена только вниз)',
    variants: [
      { id: 'A', label: '100 монет (контроль)', over: { lampPrice: 100 } },
      { id: 'B', label: '80 монет (−20%)', over: { lampPrice: 80 } }
    ]
  },
  {
    id: 'sub_trial',
    name: 'Длина триала подписки',
    primary: 'триал→платная / sub-ARPDAU',
    guardrail: 'D7 retention',
    variants: [
      { id: 'A', label: '7 дней (контроль)', over: { trialDays: 7 } },
      { id: 'B', label: '3 дня', over: { trialDays: 3 } }
    ]
  },
  {
    id: 'int_cap',
    name: 'INT-кап interstitial / DAU',
    primary: 'ad-ARPDAU',
    guardrail: 'D7 отток (−1 п.п. max)',
    variants: [
      { id: 'A', label: '3.2 / DAU (контроль)', over: { intPerDau: 3.2 } },
      { id: 'B', label: '4.0 / DAU', over: { intPerDau: 4.0 } }
    ]
  }
];

/* ==================== СЦЕНАРИИ УДЕРЖАНИЯ (09 §4.2) ====================== */

export interface RetScenario {
  label: string;
  d1: number;
  d7: number;
  d30: number;
  beta: number;
  lt7: number;
  lt365: number;
}

/** D1/D7/D30, β, LT(7)/LT(365) — из таблицы «Три сценария» 09 §4.2. */
export const RET_SCENARIOS: Readonly<Record<RetScenarioId, RetScenario>> = {
  pess: { label: 'Пессимист', d1: 35, d7: 12, d30: 5.4, beta: 0.55, lt7: 2.3, lt365: 11.5 },
  base: { label: 'База', d1: 42, d7: 18, d30: 8.0, beta: 0.435, lt7: 2.8, lt365: 21.3 },
  optim: { label: 'Оптимист', d1: 48, d7: 23, d30: 12.0, beta: 0.378, lt7: 3.2, lt365: 30.8 }
};

/** Подписочная модель (06 §5.1, §8.3) — для sub-ARPDAU и LTV. */
export const SUB_MODEL = {
  trialRate: 0.026,
  trialConv: 0.55,
  lifetimeMo: 4.2,
  monthly: 8.99,
  storeCut: 0.3,
  yearlyUpliftPct: 0.06
} as const;

/** Длина триала → конверсия триал→платная (книга: 7 дней = 55%, 09 §4.2). */
export const TRIAL_CONV: Readonly<Record<number, number>> = { 7: 0.55, 3: 0.62 };

/* ======================= ГЕЙТЫ (09 §4.3, 1:1) =========================== */

export type GateKey = 'd1' | 'arpdau' | 'roas365' | 'roas7' | 'subShare';
export type GateBand = 'kill' | 'iterate' | 'scale';

export interface GateDef {
  kill: number;
  scale: number;
  unit: '%' | '$';
  label: string;
}

/** Kill/iterate/scale-пороги (09 §4.3), 1:1 с прототипом. */
export const GATES: Readonly<Record<GateKey, GateDef>> = {
  d1: { kill: 37, scale: 40, unit: '%', label: 'D1 retention (kill <37, 09 §4.3)' },
  arpdau: { kill: 0.055, scale: 0.085, unit: '$', label: 'ARPDAU blended (kill <$0.055)' },
  roas365: { kill: 80, scale: 151, unit: '%', label: 'ROAS D365 (kill <80%, 09 §4.3)' },
  roas7: { kill: 12, scale: 18, unit: '%', label: 'ROAS D7 (scale ≥18%, 09 §4.3)' },
  subShare: { kill: 12, scale: 22, unit: '%', label: 'Подписочная доля выручки (цель 22%, 06 §1)' }
};

export const GATE_KEYS: readonly GateKey[] = ['d1', 'arpdau', 'roas365', 'roas7', 'subShare'];

/** 09 §4.3: не более двух iterate-циклов. */
export const MAX_ITERATE = 2;

export interface GateSensitivity {
  roas365Half: number;
  roas365NoSub: number;
  blendedHalf: number;
  blendedNoSub: number;
  killPct: number;
}

export interface GateResult {
  scn: RetScenario;
  adArpdau: number;
  subArpdau: number;
  iapArpdau: number;
  blended: number;
  adShare: number;
  subShare: number;
  iapShare: number;
  trialConv: number;
  trialRate: number;
  cpi: number;
  ltv7: number;
  ltv365: number;
  roas7: number;
  roas365: number;
  metrics: Record<GateKey, number>;
  verdicts: Record<GateKey, GateBand>;
  verdict: GateBand;
  flags: string[];
  iterateCount: number;
  iterateLimit: number;
  sens: GateSensitivity;
}

export interface GateInput {
  scn: RetScenario;
  /** ad-ARPDAU симулированной COHORT-когорты; 0 = прогона не было. */
  adArpdau: number;
  trialConv: number;
  trialRate: number;
  iapArpdau: number;
  cpi: number;
  /** Находки-дизайн симулятора (M-9/M-12) — удерживают от scale (12 §8.4). */
  flags: readonly string[];
  iterateCount: number;
}

/** sub-ARPDAU = trialRate × trialConv × lifetimeMo × monthly × (1−cut) × (1+uplift) / LT365. */
export function subArpdauFor(scn: RetScenario, trialConv: number, trialRate: number): number {
  const perInstall =
    trialRate * trialConv * SUB_MODEL.lifetimeMo * SUB_MODEL.monthly * (1 - SUB_MODEL.storeCut) * (1 + SUB_MODEL.yearlyUpliftPct);
  return perInstall / scn.lt365;
}

/** Чистая оценка гейтов (тестируемо без DOM/localStorage). Нулевой прогон
 * (adArpdau=0) НЕ даёт ложный GO — ARPDAU падает ниже kill-порога. */
export function evaluateGates(input: GateInput): GateResult {
  const scn = input.scn;
  const adArpdau = input.adArpdau;
  const subArpdau = subArpdauFor(scn, input.trialConv, input.trialRate);
  const iapArpdau = input.iapArpdau;
  const blended = adArpdau + subArpdau + iapArpdau;
  const subShare = blended > 0 ? (subArpdau / blended) * 100 : 0;
  const adShare = blended > 0 ? (adArpdau / blended) * 100 : 0;
  const iapShare = blended > 0 ? (iapArpdau / blended) * 100 : 0;

  const cpi = input.cpi;
  const ltv7 = scn.lt7 * blended;
  const ltv365 = scn.lt365 * blended;
  const roas7 = cpi > 0 ? (ltv7 / cpi) * 100 : 0;
  const roas365 = cpi > 0 ? (ltv365 / cpi) * 100 : 0;

  const metrics: Record<GateKey, number> = {
    d1: scn.d1,
    arpdau: blended,
    roas365,
    roas7,
    subShare
  };
  const verdicts = {} as Record<GateKey, GateBand>;
  let worst: GateBand = 'scale';
  const rank: Record<GateBand, number> = { scale: 0, iterate: 1, kill: 2 };
  for (const key of GATE_KEYS) {
    const g = GATES[key];
    const v = metrics[key];
    let band: GateBand;
    if (v < g.kill) band = 'kill';
    else if (v < g.scale) band = 'iterate';
    else band = 'scale';
    verdicts[key] = band;
    if (rank[band] > rank[worst]) worst = band;
  }
  // Находки-дизайн симулятора (M-9/M-12) удерживают от scale (12 §8.4).
  const flags = [...input.flags];
  if (worst === 'scale' && flags.length) worst = 'iterate';

  // Чувствительность подписки: LTV/ROAS при обвале триал-конверсии вдвое.
  const subHalf = subArpdauFor(scn, input.trialConv * 0.5, input.trialRate);
  const blendedHalf = adArpdau + subHalf + iapArpdau;
  const roas365Half = cpi > 0 ? ((scn.lt365 * blendedHalf) / cpi) * 100 : 0;
  const noSub = adArpdau + iapArpdau; // подписки нет вовсе
  const roas365NoSub = cpi > 0 ? ((scn.lt365 * noSub) / cpi) * 100 : 0;

  return {
    scn, adArpdau, subArpdau, iapArpdau, blended,
    adShare, subShare, iapShare,
    trialConv: input.trialConv, trialRate: input.trialRate,
    cpi, ltv7, ltv365, roas7, roas365,
    metrics, verdicts, verdict: worst, flags,
    iterateCount: input.iterateCount, iterateLimit: MAX_ITERATE,
    sens: {
      roas365Half,
      roas365NoSub,
      blendedHalf,
      blendedNoSub: noSub,
      killPct: ((roas365 - roas365Half) / (roas365 || 1)) * 100
    }
  };
}

/* ========================= A/B-НАЗНАЧЕНИЕ =============================== */

/** variant = fnv1a32(sessionId + ':' + expId) % nVariants — детерминировано. */
export function variantIndexFor(sessionId: string, expId: string, nVariants: number): number {
  return fnv1a32(sessionId + ':' + expId) % nVariants;
}

/** Наложение частичных переопределений (ecpm — слиянием под-ключей). */
export function applyOver(dst: TuneOverrides, src: TuneOverrides | undefined): void {
  if (!src) return;
  const { ecpm, ...rest } = src;
  Object.assign(dst, rest);
  if (ecpm) dst.ecpm = { ...dst.ecpm, ...ecpm };
}

/** Стабильный per-install id: единственная точка «случайности» — ПЕРВАЯ
 * генерация; дальше он в localStorage, поэтому A/B детерминирован (09 §1.2). */
export function genSessionId(): string {
  const t = Date.now();
  const r = Math.floor(Math.random() * 1e9);
  return 's' + t.toString(36) + r.toString(36);
}

export interface Assignment {
  exp: string;
  name: string;
  variant: string;
  label: string;
}

export interface CompareRow {
  id: string;
  label: string;
  adArpdau: number;
  subArpdau: number;
  blended: number;
  roas365: number;
  balD30: number;
  deficitD30: number;
}

export interface CompareResult {
  exp: ExperimentDef;
  rows: CompareRow[];
  /** Δ первичной метрики (B−A), %. */
  deltaPrimaryPct: number;
}

/* ============================ КОНТРОЛЛЕР ================================ */

export class Experiments {
  private state: SoftlaunchState;

  private lastRef: RefSummary | null = null;
  private lastMC: McSummary | null = null;
  private lastCohort: McSummary | null = null;

  constructor(
    private readonly storage: KeyValueStorage = defaultStorage(),
    private readonly genId: () => string = genSessionId
  ) {
    this.state = this.load();
  }

  /* --------------------------- хранилище --------------------------- */

  private load(): SoftlaunchState {
    let s = softlaunchDefaults();
    try {
      const raw = this.storage.getItem(SOFTLAUNCH_KEY);
      if (raw !== null) s = sanitizeSoftlaunch(JSON.parse(raw));
    } catch {
      s = softlaunchDefaults(); // повреждённый JSON → дефолты, без краша
    }
    // Персистим session-id СРАЗУ при первом минте: без этого каждый перезагруз
    // генерировал бы новый id → другой A/B-бакет (инвариант 09 §1.2).
    if (!s.sessionId) {
      s.sessionId = this.genId();
      this.persist(s);
    }
    return s;
  }

  private persist(s?: SoftlaunchState): void {
    try {
      this.storage.setItem(SOFTLAUNCH_KEY, JSON.stringify(s ?? this.state));
    } catch {
      /* приватный режим / переполнение — кокпит продолжает работать */
    }
  }

  getState(): Readonly<SoftlaunchState> {
    return this.state;
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  /* --------------------------- A/B ---------------------------------- */

  assignedVariant(exp: ExperimentDef): ExperimentVariant {
    const idx = variantIndexFor(this.state.sessionId, exp.id, exp.variants.length);
    return exp.variants[idx] as ExperimentVariant;
  }

  getAssignments(): Assignment[] {
    return EXPERIMENTS.map((exp) => {
      const v = this.assignedVariant(exp);
      return { exp: exp.id, name: exp.name, variant: v.id, label: v.label };
    });
  }

  /** Строка ab_groups для дашборда/событий (09 §1.2). */
  abGroupsString(): string {
    return EXPERIMENTS.map((exp) => exp.id + '=' + this.assignedVariant(exp).id).join(', ');
  }

  /* ------------- эффективный tune = книга + A/B + ручной ------------- */

  /** Приоритет: назначенные A/B-варианты → ручной тюнинг (последний важнее). */
  buildOverrides(): TuneOverrides {
    const over: TuneOverrides = {};
    if (this.state.applyAB) {
      for (const exp of EXPERIMENTS) applyOver(over, this.assignedVariant(exp).over);
    }
    applyOver(over, this.state.tune);
    return over;
  }

  /* --------------------------- ручки -------------------------------- */

  knobValue(key: KnobKey): number {
    const over = this.buildOverrides();
    if (key.startsWith('ecpm.')) {
      const sub = key.split('.')[1] as EcpmSubKey;
      return over.ecpm?.[sub] ?? BOOK_TUNE.ecpm[sub];
    }
    const k = key as TuneNumericKey;
    return over[k] ?? BOOK_TUNE[k];
  }

  bookValue(key: KnobKey): number {
    if (key.startsWith('ecpm.')) {
      const sub = key.split('.')[1] as EcpmSubKey;
      return BOOK_TUNE.ecpm[sub];
    }
    return BOOK_TUNE[key as TuneNumericKey];
  }

  /** Записать ручную правку ручки в state.tune (localStorage). */
  setKnob(key: KnobKey, val: number | string): void {
    const n = typeof val === 'number' ? val : parseFloat(val);
    if (!Number.isFinite(n)) return;
    if (key.startsWith('ecpm.')) {
      const sub = key.split('.')[1] as EcpmSubKey;
      this.state.tune.ecpm = { ...this.state.tune.ecpm, [sub]: n };
    } else {
      this.state.tune[key as TuneNumericKey] = n;
    }
    this.persist();
  }

  resetKnob(key: KnobKey): void {
    if (key.startsWith('ecpm.')) {
      const sub = key.split('.')[1] as EcpmSubKey;
      if (this.state.tune.ecpm) delete this.state.tune.ecpm[sub];
    } else {
      delete this.state.tune[key as TuneNumericKey];
    }
    this.persist();
  }

  /** «Сбросить все ручки к книге» (baseline 12 §8). */
  resetAll(): void {
    this.state.tune = {};
    this.persist();
  }

  isKnobEdited(key: KnobKey): boolean {
    if (key.startsWith('ecpm.')) {
      const sub = key.split('.')[1] as EcpmSubKey;
      return this.state.tune.ecpm?.[sub] !== undefined;
    }
    return this.state.tune[key as TuneNumericKey] !== undefined;
  }

  /* --------------------------- настройки ----------------------------- */

  setSimN(n: number): void {
    if (Number.isFinite(n)) {
      this.state.simN = Math.min(400, Math.max(100, Math.floor(n)));
      this.persist();
    }
  }

  setApplyAB(on: boolean): void {
    this.state.applyAB = on;
    this.persist();
  }

  setScenario(id: RetScenarioId): void {
    this.state.retScenario = id;
    this.persist();
  }

  setCpi(v: number): void {
    this.state.cpi = Number.isFinite(v) && v > 0 ? v : 1.2;
    this.persist();
  }

  setIapArpdau(v: number): void {
    this.state.iapArpdau = Number.isFinite(v) && v >= 0 ? v : 0;
    this.persist();
  }

  setTrialRate(v: number): void {
    this.state.trialRate = Number.isFinite(v) && v >= 0 ? v : 0;
    this.persist();
  }

  /** Зафиксировать iterate-цикл (лимит MAX_ITERATE, 09 §4.3). */
  incIterate(): void {
    this.state.iterateCount = Math.min(this.state.iterateCount + 1, MAX_ITERATE);
    this.persist();
  }

  resetIterate(): void {
    this.state.iterateCount = 0;
    this.persist();
  }

  /* --------------------------- прогоны ------------------------------- */

  getLastRef(): RefSummary | null {
    return this.lastRef;
  }

  getLastMC(): McSummary | null {
    return this.lastMC;
  }

  getLastCohort(): McSummary | null {
    return this.lastCohort;
  }

  /** Прогон трёх режимов: REF (таблица vs 05 §4) + MC + COHORT (метрики на
   * DAU / гейты). runId привязан к session-id — прогон воспроизводим (INV-S2). */
  runBoth(): RefSummary {
    const over = this.buildOverrides();
    const N = this.state.simN;
    const runId = 'cockpit:' + this.state.sessionId;
    this.lastRef = runSim({ days: 30, runId, mode: 'REF', tune: over }) as RefSummary;
    this.lastMC = runSim({ N, days: 30, runId, mode: 'MC', tune: over }) as McSummary;
    this.lastCohort = runSim({ N, days: 30, runId, mode: 'COHORT', tune: over }) as McSummary;
    return this.lastRef;
  }

  /** Длина триала (A/B sub_trial) → конверсия триал→платная. */
  trialConvFor(): number {
    const over = this.buildOverrides();
    const td = over.trialDays ?? 7;
    return TRIAL_CONV[td] ?? SUB_MODEL.trialConv;
  }

  /** A/B-сравнение: гоняем ОБА варианта эксперимента (свой runId на вариант —
   * детерминировано), база = прочие A/B + ручной тюнинг. */
  compareExperiment(expId: string): CompareResult | null {
    const exp = EXPERIMENTS.find((e) => e.id === expId);
    if (!exp) return null;
    const scn = RET_SCENARIOS[this.state.retScenario];
    const rows: CompareRow[] = exp.variants.map((vr) => {
      const over: TuneOverrides = {};
      for (const other of EXPERIMENTS) {
        if (other.id === exp.id) continue;
        applyOver(over, this.assignedVariant(other).over);
      }
      applyOver(over, this.state.tune);
      applyOver(over, vr.over);
      const runId = 'ab:' + exp.id + ':' + vr.id;
      const coh = runSim({ N: this.state.simN, days: 30, runId, mode: 'COHORT', tune: over }) as McSummary;
      const mc = runSim({ N: this.state.simN, days: 30, runId, mode: 'MC', tune: over }) as McSummary;
      // sub-ARPDAU для этого варианта (длина триала может отличаться).
      const td = over.trialDays ?? 7;
      const tc = TRIAL_CONV[td] ?? SUB_MODEL.trialConv;
      const subA = subArpdauFor(scn, tc, this.state.trialRate || SUB_MODEL.trialRate);
      const blended = coh.aggregates.adArpdau + subA + (this.state.iapArpdau || 0);
      const balRow = mc.byDay[29];
      return {
        id: vr.id,
        label: vr.label,
        adArpdau: coh.aggregates.adArpdau,
        subArpdau: subA,
        blended,
        roas365: this.state.cpi > 0 ? ((scn.lt365 * blended) / this.state.cpi) * 100 : 0,
        balD30: balRow ? balRow.balanceMedianCore : 0,
        deficitD30: mc.aggregates.deficitShareD30
      };
    });
    const a = rows[0] as CompareRow;
    const b = rows[1] as CompareRow;
    const primaryKey: Record<string, 'balD30' | 'subArpdau' | 'adArpdau'> = {
      hint_price: 'balD30',
      sub_trial: 'subArpdau',
      int_cap: 'adArpdau'
    };
    const pk = primaryKey[exp.id] ?? 'adArpdau';
    const deltaPrimaryPct = a[pk] ? ((b[pk] - a[pk]) / a[pk]) * 100 : 0;
    return { exp, rows, deltaPrimaryPct };
  }

  /* --------------------------- гейты --------------------------------- */

  /** Гейты по последней COHORT-когорте; без прогона ad-ARPDAU = 0 (вердикт
   * не может стать ложным GO — ARPDAU ниже kill-порога). */
  computeGates(): GateResult {
    return evaluateGates({
      scn: RET_SCENARIOS[this.state.retScenario],
      adArpdau: this.lastCohort ? this.lastCohort.aggregates.adArpdau : 0,
      trialConv: this.trialConvFor(),
      trialRate: this.state.trialRate || SUB_MODEL.trialRate,
      iapArpdau: this.state.iapArpdau || 0,
      cpi: this.state.cpi || 1.2,
      flags: this.lastMC ? this.lastMC.flags : [],
      iterateCount: this.state.iterateCount
    });
  }
}
