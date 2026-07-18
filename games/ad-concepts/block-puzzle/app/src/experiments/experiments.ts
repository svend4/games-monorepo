/**
 * Soft-launch эксперименты Block Surge (Проход Е.3, порт experiments.js
 * Прохода Г). Три блока поверх симулятора (src/sim):
 *   1) A/B-фреймворк — пул из 3 экспериментов прототипа 1:1, ДЕТЕРМИНИРОВАННОЕ
 *      назначение варианта fnv1a32-хешем персистентного session-id;
 *   2) панель тюнинга ручек (W_HARD, ad-капы, earn-rate, eCPM) с localStorage
 *      (ключ 'blocksurge_softlaunch', схема прототипа) и сбросом к книге;
 *      номиналы 05/06 НЕ тюнятся (INV-E1);
 *   3) гейты go/iterate/kill (09 §5.4): D1/D7/ad-ARPDAU/D7 ROAS против
 *      kill/scale-порогов 1:1, сценарии удержания, счётчик iterate ≤2 (10 P7).
 *
 * Кокпит — офлайн-инструмент прод-команды: в игру НЕ вмешивается, ядро/
 * экономику/монетизацию/сейвы игры не трогает; пишет только свой ключ.
 * Расчёты детерминированы: runId привязан к session-id, Math.random/Date.now
 * встречаются ТОЛЬКО в первой генерации session-id (дальше он персистентен).
 */
import { fnv1a32 } from '../core/rng';
import { defaultStorage, type KeyValueStorage } from '../economy/store';
import { BOOK_TUNE, type TuneOverrides } from '../sim/constants';
import { runSim, type SimSummary } from '../sim/sim';
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
 * «Книга» — калиброванный baseline, к которому возвращает «сброс». */
export const KNOBS: readonly KnobDef[] = [
  { key: 'W_HARD', group: 'Сложность', label: 'W_HARD (сложность hard-сегмента 21–60)',
    min: 0.6, max: 1.4, step: 0.05, hint: '×fail в сегменте 21–60 (09 §6 тест №7)' },
  { key: 'intPerDau', group: 'Реклама: капы', label: 'INT-кап / DAU (interstitial)',
    min: 3, max: 10, step: 0.5, hint: 'показы interstitial на DAU (09 §4, cap 06 §3)' },
  { key: 'bannerPerDau', group: 'Реклама: капы', label: 'Banner / DAU',
    min: 10, max: 50, step: 1, hint: 'показы баннера на DAU (09 §4)' },
  { key: 'rw2Cap', group: 'Реклама: капы', label: 'RW-2 cap / день',
    min: 1, max: 5, step: 1, hint: 'дневной кап «×2 монеты» (06 §2.2)' },
  { key: 'missionsEV', group: 'Earn-rate (COIN_*)', label: 'COIN миссии EV / день',
    min: 0, max: 80, step: 5, hint: 'свободный EV daily-миссий (12 §5.2)' },
  { key: 'weeklyBundleEV', group: 'Earn-rate (COIN_*)', label: 'COIN недельный бандл EV',
    min: 60, max: 260, step: 10, hint: 'weekly + турнир, всплеск дни 7/14/21/28' },
  { key: 'boosterScale', group: 'Earn-rate (COIN_*)', label: 'Спрос на бустеры (sink scale)',
    min: 0.6, max: 2.4, step: 0.05, hint: 'общий множитель расхода на бустеры' },
  { key: 'rw2Mult', group: 'Earn-rate (COIN_*)', label: 'RW-2 множитель монет',
    min: 1.5, max: 3.5, step: 0.5, hint: '«×2 монеты» — множитель награды (09 §6 №6)' },
  { key: 'startGrant', group: 'Earn-rate (COIN_*)', label: 'COIN стартовый грант',
    min: 100, max: 400, step: 50, hint: 'FTUE-баланс на старте (05 §3)' },
  { key: 'ecpm.rw', group: 'eCPM (06 §4)', label: 'eCPM rewarded, $',
    min: 4, max: 20, step: 0.5, hint: 'rewarded, $ за 1000 показов' },
  { key: 'ecpm.int', group: 'eCPM (06 §4)', label: 'eCPM interstitial, $',
    min: 3, max: 18, step: 0.5, hint: 'interstitial, $ за 1000 показов' },
  { key: 'ecpm.banner', group: 'eCPM (06 §4)', label: 'eCPM banner, $',
    min: 0.1, max: 1.0, step: 0.05, hint: 'banner, $ за 1000 показов' }
];

/* ============================ ПУЛ A/B (09 §6) =========================== */

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

/** Пул прототипа 1:1: int_cap 7/5, rw2_mult ×2/×3, start_grant 200/300. */
export const EXPERIMENTS: readonly ExperimentDef[] = [
  {
    id: 'int_cap',
    name: 'Стартовый interstitial-кап',
    primary: 'ad-ARPDAU',
    guardrail: 'D7 retention (−1.5 п.п. max)',
    variants: [
      { id: 'A', label: '7 / день (контроль)', over: { intPerDau: 7 } },
      { id: 'B', label: '5 / день', over: { intPerDau: 5 } }
    ]
  },
  {
    id: 'rw2_mult',
    name: 'RW-2 множитель монет',
    primary: 'RW-охват + инфляция',
    guardrail: 'earn/spend коридор 0.95–1.15',
    variants: [
      { id: 'A', label: '×2 (контроль)', over: { rw2Mult: 2 } },
      { id: 'B', label: '×3', over: { rw2Mult: 3 } }
    ]
  },
  {
    id: 'start_grant',
    name: 'Стартовый баланс',
    primary: 'D1 / ранняя воронка трат',
    guardrail: 'инфляция баланса D30',
    variants: [
      { id: 'A', label: '200 монет (контроль)', over: { startGrant: 200 } },
      { id: 'B', label: '300 монет', over: { startGrant: 300 } }
    ]
  }
];

/* ==================== СЦЕНАРИИ УДЕРЖАНИЯ (09 §5.2) ====================== */

export interface RetScenario {
  label: string;
  /** Дневные D1..D7, % — для LT7 гейтов. */
  daily: readonly number[];
  d1: number;
  d7: number;
}

/** base — кривая 09 §5.1 (LT7 = 2.66). */
export const RET_SCENARIOS: Readonly<Record<RetScenarioId, RetScenario>> = {
  pess: { label: 'Пессимист', daily: [32, 26, 22, 19, 16, 13, 11], d1: 32, d7: 11 },
  base: { label: 'База', daily: [38, 30, 25, 22, 19, 17, 15], d1: 38, d7: 15 },
  optim: { label: 'Оптимист', daily: [45, 37, 31, 27, 24, 22, 20], d1: 45, d7: 20 }
};

/* ======================= ГЕЙТЫ (09 §5.4, 1:1) =========================== */

export type GateKey = 'd1' | 'd7' | 'adArpdau' | 'roas7';
export type GateBand = 'kill' | 'iterate' | 'scale';

export interface GateDef {
  kill: number;
  scale: number;
  unit: '%' | '$';
  label: string;
}

/** Kill/iterate/scale-пороги (09 §5.4), 1:1 с прототипом. */
export const GATES: Readonly<Record<GateKey, GateDef>> = {
  d1: { kill: 30, scale: 38, unit: '%', label: 'D1 retention' },
  d7: { kill: 9, scale: 15, unit: '%', label: 'D7 retention' },
  adArpdau: { kill: 0.06, scale: 0.1, unit: '$', label: 'Ad ARPDAU (T1-когорты)' },
  roas7: { kill: 20, scale: 40, unit: '%', label: 'D7 ROAS' }
};

export const GATE_KEYS: readonly GateKey[] = ['d1', 'd7', 'adArpdau', 'roas7'];

/** 10 P7: не более двух iterate-циклов. */
export const MAX_ITERATE = 2;

export interface GateResult {
  scenario: RetScenario;
  lt7: number;
  adArpdau: number;
  blended: number;
  ltv7: number;
  cpi: number;
  roas7: number;
  metrics: Record<GateKey, number>;
  verdicts: Record<GateKey, GateBand>;
  verdict: GateBand;
  flags: string[];
  iterateCount: number;
  iterateLimit: number;
}

export interface GateInput {
  scenario: RetScenario;
  /** ad-ARPDAU симулированной COHORT-когорты; 0 = прогона не было. */
  adArpdau: number;
  iapArpdau: number;
  cpi: number;
  /** Красные флаги дизайна симулятора (12 §8.4) — удерживают от scale. */
  flags: readonly string[];
  iterateCount: number;
}

/** Чистая оценка гейтов (тестируемо без DOM/localStorage). Нулевой прогон
 * (adArpdau=0) НЕ даёт ложный GO: ad-ARPDAU ниже kill-порога → вердикт kill. */
export function evaluateGates(input: GateInput): GateResult {
  const sc = input.scenario;
  let lt7 = 1;
  for (let i = 0; i < 7; i++) lt7 += (sc.daily[i] as number) / 100; // LT7 = 1 + Σ r(1..7)
  const adArpdau = input.adArpdau;
  const blended = adArpdau + input.iapArpdau;
  const ltv7 = lt7 * blended;
  const cpi = input.cpi;
  const roas7 = cpi > 0 ? (ltv7 / cpi) * 100 : 0;

  const metrics: Record<GateKey, number> = {
    d1: sc.d1,
    d7: sc.d7,
    adArpdau,
    roas7
  };
  const verdicts = {} as Record<GateKey, GateBand>;
  let worst: GateBand = 'scale'; // scale < iterate < kill (по «худшести»)
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
  // Красные флаги дизайна из симулятора могут удержать от scale (12 §8.4).
  const flags = [...input.flags];
  if (worst === 'scale' && flags.length) worst = 'iterate';

  return {
    scenario: sc,
    lt7,
    adArpdau,
    blended,
    ltv7,
    cpi,
    roas7,
    metrics,
    verdicts,
    verdict: worst,
    flags,
    iterateCount: input.iterateCount,
    iterateLimit: MAX_ITERATE
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
 * генерация; дальше он в localStorage, поэтому A/B детерминирован. */
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
  rwPerDau: number;
  ratio: number;
  balD30: number;
  deficitD30: number;
}

export interface CompareResult {
  exp: ExperimentDef;
  rows: CompareRow[];
  /** Δ ad-ARPDAU (B−A), %. */
  deltaArpdauPct: number;
}

/* ============================ КОНТРОЛЛЕР ================================ */

export class Experiments {
  private state: SoftlaunchState;

  private lastSurvivor: SimSummary | null = null;
  private lastCohort: SimSummary | null = null;

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
    this.state.cpi = Number.isFinite(v) && v > 0 ? v : 0.9;
    this.persist();
  }

  setIapArpdau(v: number): void {
    this.state.iapArpdau = Number.isFinite(v) && v >= 0 ? v : 0;
    this.persist();
  }

  /** Зафиксировать iterate-цикл (лимит MAX_ITERATE, 10 P7). */
  incIterate(): void {
    this.state.iterateCount = Math.min(this.state.iterateCount + 1, MAX_ITERATE);
    this.persist();
  }

  resetIterate(): void {
    this.state.iterateCount = 0;
    this.persist();
  }

  /* --------------------------- прогоны ------------------------------- */

  getLastSurvivor(): SimSummary | null {
    return this.lastSurvivor;
  }

  getLastCohort(): SimSummary | null {
    return this.lastCohort;
  }

  /** Прогон обеих когорт: SURVIVOR (таблица баланса) + COHORT (метрики на
   * DAU / гейты). runId привязан к session-id — прогон воспроизводим. */
  runBoth(): SimSummary {
    const over = this.buildOverrides();
    const N = this.state.simN;
    const runId = 'cockpit:' + this.state.sessionId;
    this.lastSurvivor = runSim({ N, days: 30, runId, mode: 'SURVIVOR', tune: over });
    this.lastCohort = runSim({ N, days: 30, runId, mode: 'COHORT', tune: over });
    return this.lastSurvivor;
  }

  /** A/B-сравнение: гоним ОБА варианта эксперимента (свой runId на вариант —
   * детерминировано), база = прочие A/B + ручной тюнинг. */
  compareExperiment(expId: string): CompareResult | null {
    const exp = EXPERIMENTS.find((e) => e.id === expId);
    if (!exp) return null;
    const rows: CompareRow[] = exp.variants.map((vr) => {
      const over: TuneOverrides = {};
      for (const other of EXPERIMENTS) {
        if (other.id === exp.id) continue;
        applyOver(over, this.assignedVariant(other).over);
      }
      applyOver(over, this.state.tune);
      applyOver(over, vr.over);
      const runId = 'ab:' + exp.id + ':' + vr.id;
      const coh = runSim({ N: this.state.simN, days: 30, runId, mode: 'COHORT', tune: over });
      const surv = runSim({ N: this.state.simN, days: 30, runId, mode: 'SURVIVOR', tune: over });
      const balRow = surv.byDay[29];
      return {
        id: vr.id,
        label: vr.label,
        adArpdau: coh.aggregates.adArpdau,
        rwPerDau: coh.aggregates.rwPerDauMean,
        ratio: surv.aggregates.ratioMean,
        balD30: balRow ? balRow.balanceMedianBaseCore : 0,
        deficitD30: surv.aggregates.deficitShareD30
      };
    });
    const a = rows[0] as CompareRow;
    const b = rows[1] as CompareRow;
    const deltaArpdauPct = a.adArpdau > 0 ? ((b.adArpdau - a.adArpdau) / a.adArpdau) * 100 : 0;
    return { exp, rows, deltaArpdauPct };
  }

  /* --------------------------- гейты --------------------------------- */

  /** Гейты по последней COHORT-когорте; без прогона ad-ARPDAU = 0 (вердикт
   * не может стать ложным GO — нулевая метрика ниже kill-порога). */
  computeGates(): GateResult {
    return evaluateGates({
      scenario: RET_SCENARIOS[this.state.retScenario],
      adArpdau: this.lastCohort ? this.lastCohort.aggregates.adArpdau : 0,
      iapArpdau: this.state.iapArpdau,
      cpi: this.state.cpi,
      flags: this.lastSurvivor ? this.lastSurvivor.flags : [],
      iterateCount: this.state.iterateCount
    });
  }
}
