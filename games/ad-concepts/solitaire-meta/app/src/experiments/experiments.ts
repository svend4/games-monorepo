/**
 * Soft-launch эксперименты Orchard Peaks (Проход Е.3, порт experiments.js
 * Прохода Г). Три блока поверх симулятора (src/sim):
 *   1) A/B-фреймворк — пул из 3 экспериментов прототипа 1:1, ДЕТЕРМИНИРОВАННОЕ
 *      назначение варианта FNV-1a-хешем персистентного session-id
 *      (arm = hash(sessionId + ':' + key) % число_арм, [09] §9.6);
 *   2) панель тюнинга ручек (E(n), заказы, eCPM, earn-rate) с localStorage и
 *      сбросом «к значениям книги» (приложение 12 / главы 05–06); тюнингу
 *      подлежат ТОЛЬКО ручки панели — чужие ключи отбрасываются белым списком;
 *   3) гейты go/iterate/kill ([09] §9.5): три сценария юнит-экономики +
 *      экономическая готовность из симулятора; без прогона GO НЕВОЗМОЖЕН.
 *
 * КЛЮЧИ ХРАНИЛИЩА — ТЕ ЖЕ, что у прототипа (совместимость без миграции):
 *   orchardPeaks.tuning    — JSON-объект оверрайдов ручек;
 *   orchardPeaks.abSession — session-id СЫРОЙ строкой (не JSON);
 *   orchardPeaks.softScen  — id сценария гейтов сырой строкой.
 *
 * Кокпит — офлайн-инструмент прод-команды: в игру НЕ вмешивается, ядро/
 * экономику/монетизацию/сейвы игры не трогает; пишет только свои ключи.
 * Math.random/Date.now встречаются ТОЛЬКО в первой генерации session-id
 * (дальше он персистентен) — все прогоны воспроизводимы.
 */
import { fnv1a32 } from '../core/rng';
import { defaultStorage, type KeyValueStorage } from '../economy/store';
import { BOOK, run, type SimBook, type SimRunResult } from '../sim/sim';

/* ============================ КЛЮЧИ ХРАНИЛИЩА ============================ */

export const K_TUNING = 'orchardPeaks.tuning'; // ручные оверрайды параметров книги
export const K_SESSION = 'orchardPeaks.abSession'; // session-id для A/B-хеша
export const K_SCENARIO = 'orchardPeaks.softScen'; // выбранный сценарий гейтов

/* ============================ ТЮНИНГ-РУЧКИ ============================ */

/** Белый список ручек панели (ключи BOOK симулятора), 1:1 с KNOBS прототипа. */
export const KNOB_KEYS = [
  'entryBase',
  'entryGrowth',
  'wrPlateau',
  'orderCostMult',
  'missionMult',
  'rw6Grant',
  'rw3HarvestMult',
  'ecpmRewarded',
  'ecpmInt',
  'iapArpdau'
] as const;

export type KnobKey = (typeof KNOB_KEYS)[number];

/** Оверрайды поверх книги: только числовые ручки панели. */
export type TuneOverrides = Partial<Record<KnobKey, number>>;

export interface KnobDef {
  key: KnobKey;
  label: string;
  step: number;
  min: number;
  max: number;
  help: string;
}

/** Ключевые ручки remote config (§12.6 «вход в тюнинг до soft launch»), 1:1. */
export const KNOBS: readonly KnobDef[] = [
  { key: 'entryBase', label: 'E(n): база взноса', step: 10, min: 100, max: 800, help: 'E(n) = база·рост ([05] §5.2)' },
  { key: 'entryGrowth', label: 'E(n): множитель роста', step: 0.001, min: 1.005, max: 1.02, help: 'A/B #4: 1.010 / 1.012 / 1.015' },
  { key: 'wrPlateau', label: 'WR: плато сложности', step: 0.01, min: 0.45, max: 0.62, help: 'W(n)=плато+0.35·e^(−n/25) ([11] §11.5)' },
  { key: 'orderCostMult', label: 'Сад: стоимость заказов ×', step: 0.05, min: 0.6, max: 1.4, help: 'рычаг Ф4 (темп заказов [04] §4.2)' },
  { key: 'missionMult', label: 'Миссии: номинал ×', step: 0.05, min: 0.6, max: 1.4, help: 'рычаг Ф2 (высота карусели)' },
  { key: 'rw6Grant', label: 'RW6: грант ×E(n)', step: 0.1, min: 0.4, max: 1.2, help: 'A/B #5: 0.6 / 0.8 / 1.0 ([06] §6.2)' },
  { key: 'rw3HarvestMult', label: 'RW3-лукошко: урожай ×', step: 1, min: 1, max: 3, help: 'A/B «rewarded-урожай ×2»' },
  { key: 'ecpmRewarded', label: 'eCPM rewarded, $', step: 0.5, min: 3, max: 25, help: 'Tier-1 $16 / Tier-2-3 ~$5 ([06] §6.7)' },
  { key: 'ecpmInt', label: 'eCPM interstitial, $', step: 0.5, min: 2, max: 18, help: 'Tier-1 $12 ([06] §6.7)' },
  { key: 'iapArpdau', label: 'IAP ARPDAU (допущение), $', step: 0.01, min: 0, max: 0.4, help: 'не симулируется — вход гейтов [09] §9.3' }
];

/* ============================ ПУЛ A/B ([09] §9.6) ============================ */

export interface ExperimentArm {
  label: string;
  patch: TuneOverrides;
}

export interface ExperimentDef {
  key: string;
  name: string;
  metric: string;
  guard: string;
  ref: string;
  arms: readonly ExperimentArm[];
}

/** Пул прототипа 1:1: наклон взноса, стоимость заказов, rewarded-урожай. */
export const EXPERIMENTS: readonly ExperimentDef[] = [
  {
    key: 'entry',
    name: 'Наклон взноса E(n)',
    metric: 'ARPDAU D30',
    guard: 'D14 retention',
    ref: '[09] §9.6 #4',
    arms: [
      { label: '1.010', patch: { entryGrowth: 1.01 } },
      { label: '1.012 · книга', patch: { entryGrowth: 1.012 } }
    ]
  },
  {
    key: 'order',
    name: 'Стоимость заказов сада ±20%',
    metric: 'заказов/день · LTV',
    guard: 'темп меты [04] §4.2',
    ref: '§12.4',
    arms: [
      { label: '−20%', patch: { orderCostMult: 0.8 } },
      { label: 'книга', patch: { orderCostMult: 1.0 } },
      { label: '+20%', patch: { orderCostMult: 1.2 } }
    ]
  },
  {
    key: 'rwh',
    name: 'Rewarded-урожай ×2 (RW3-лукошко)',
    metric: 'заказов/день · RW3-показы',
    guard: 'sink/source ≤ 1.2',
    ref: '[06] §6.2',
    arms: [
      { label: '×1 · выкл', patch: { rw3HarvestMult: 1 } },
      { label: '×2 · книга', patch: { rw3HarvestMult: 2 } }
    ]
  }
];

/* ============================ СЦЕНАРИИ [09] §9.5 / §9.3 ============================ */

export type ScenarioId = 'pess' | 'base' | 'opt';

export interface Scenario {
  name: string;
  d1: number;
  d7: number;
  d30: number;
  arpdau: number;
  adArpdau: number;
  iapArpdau: number;
  cpi: number;
}

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = {
  pess: { name: 'Пессимист', d1: 0.35, d7: 0.12, d30: 0.055, arpdau: 0.12, adArpdau: 0.05, iapArpdau: 0.07, cpi: 2.6 },
  base: { name: 'База', d1: 0.42, d7: 0.18, d30: 0.09, arpdau: 0.22, adArpdau: 0.1, iapArpdau: 0.12, cpi: 2.3 },
  opt: { name: 'Оптимист', d1: 0.48, d7: 0.23, d30: 0.13, arpdau: 0.32, adArpdau: 0.13, iapArpdau: 0.19, cpi: 2.0 }
};

export const SCENARIO_IDS: readonly ScenarioId[] = ['pess', 'base', 'opt'];

/** Решающие правила soft launch ([09] §9.5), 1:1 с прототипом. */
export const GO_RULE = { d1: 0.4, d7: 0.16, arpdau: 0.17, roasD30: 0.45 } as const;
export const KILL_RULE = { d7: 0.12, arpdau: 0.12 } as const;

/* ============================ ЮНИТ-ЭКОНОМИКА [09] §9.4 ============================ */

export function bFromRet(d1: number, d7: number): number {
  return Math.log(d1 / d7) / Math.log(7);
}

/** A(T) = 1 + a/(1−b)·(T^(1−b) − 1) — активные дни за горизонт T. */
export function activeDays(T: number, d1: number, d7: number): number {
  const a = d1;
  const b = bFromRet(d1, d7);
  if (Math.abs(1 - b) < 1e-6) return 1 + a * Math.log(T);
  return 1 + (a / (1 - b)) * (Math.pow(T, 1 - b) - 1);
}

export function ltv(T: number, sc: Scenario): number {
  return activeDays(T, sc.d1, sc.d7) * sc.arpdau;
}

/** min t: LTV(t) ≥ CPI (или null — «нет, стоп UA»). */
export function paybackDay(sc: Scenario): number | null {
  for (let t = 1; t <= 400; t++) {
    if (ltv(t, sc) >= sc.cpi) return t;
  }
  return null;
}

/* ============================ ВЕРДИКТ ГЕЙТОВ ============================ */

export type VerdictClass = 'go' | 'iter' | 'kill';

export interface VerdictResult {
  verdict: 'GO GLOBAL' | 'ITERATE' | 'KILL / PIVOT';
  cls: VerdictClass;
  headline: string;
  /** Причины «экономика не готова» (для плашки предупреждения). */
  reasons: string[];
  econOk: boolean;
  goMet: boolean;
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function usd(v: number): string {
  return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
}

/**
 * Чистая оценка вердикта (порт renderVerdict 1:1, тестируемо без DOM).
 * Экономическая готовность из симулятора — ПРЕДУСЛОВИЕ GO: без прогона
 * (run=null) готовность не подтверждена → econOk=false, GO невозможен
 * (ложного GO не бывает — падаем в ITERATE).
 */
export function evaluateVerdict(
  sc: Scenario,
  roasD30: number,
  run: SimRunResult | null,
  cyclesSpent: number
): VerdictResult {
  const reasons: string[] = [];
  let econOk = run !== null;
  if (run !== null) {
    if (!run.wallet.inWindow) {
      econOk = false;
      reasons.push('точка дефицита вне окна 12–16 (день ' + run.wallet.median + ')');
    }
    if (!(run.sinkSourceD14 >= 1.0 && run.sinkSourceD14 <= 1.2)) {
      econOk = false;
      reasons.push('sink/source вне [1.0–1.20] (' + run.sinkSourceD14.toFixed(2) + ')');
    }
  } else {
    reasons.push('симулятор не прогнан — экономическая готовность не проверена');
  }
  const goMet =
    sc.d1 >= GO_RULE.d1 && sc.d7 >= GO_RULE.d7 && sc.arpdau >= GO_RULE.arpdau && roasD30 >= GO_RULE.roasD30;
  const killMet = sc.d7 < KILL_RULE.d7 && sc.arpdau < KILL_RULE.arpdau; // прямой kill
  // «Застряли в iterate»: не дотягиваем до GO и сидим у пола iterate.
  const stuckIterate = !goMet && sc.d7 <= GO_RULE.d7 && sc.arpdau <= GO_RULE.arpdau;

  if (killMet || (stuckIterate && cyclesSpent >= 3)) {
    return {
      verdict: 'KILL / PIVOT',
      cls: 'kill',
      headline: killMet
        ? 'D7 ' + pct(sc.d7) + ' < 12% при ARPDAU ' + usd(sc.arpdau) + ' < $0.12 — пессимистический сценарий подтверждён.'
        : '3 балансных цикла исчерпаны, сценарий не вышел из iterate-зоны (D7 ' + pct(sc.d7) +
          ', ARPDAU ' + usd(sc.arpdau) + ') — проект не масштабируется ([09] §9.5).',
      reasons,
      econOk,
      goMet
    };
  }
  if (goMet && econOk) {
    return {
      verdict: 'GO GLOBAL',
      cls: 'go',
      headline: 'Все пороги пройдены и экономика готова — масштабируем UA.',
      reasons,
      econOk,
      goMet
    };
  }
  const miss: string[] = [];
  if (sc.d1 < GO_RULE.d1) miss.push('D1 ' + pct(sc.d1) + ' < 40%');
  if (sc.d7 < GO_RULE.d7) miss.push('D7 ' + pct(sc.d7) + ' < 16%');
  if (sc.arpdau < GO_RULE.arpdau) miss.push('ARPDAU ' + usd(sc.arpdau) + ' < $0.17');
  if (roasD30 < GO_RULE.roasD30) miss.push('ROAS D30 ' + pct(roasD30) + ' < 45%');
  if (goMet && !econOk) miss.push('экономика не готова (см. ниже)');
  return {
    verdict: 'ITERATE',
    cls: 'iter',
    headline:
      (miss.length > 0 ? 'Не дотягивают: ' + miss.join(', ') + '. ' : '') +
      'Цикл ' + (cyclesSpent + 1) + ' из 3 — тюнинг Ф2/Ф4, затем ре-тест (kill после 3).',
    reasons,
    econOk,
    goMet
  };
}

/* ============================ A/B-НАЗНАЧЕНИЕ ============================ */

/** Индекс арма эксперимента по хешу (session-id + ключ) — детерминирован. */
export function armIndex(sid: string, exp: ExperimentDef): number {
  return fnv1a32(sid + ':' + exp.key) % exp.arms.length;
}

export interface Assignment {
  patch: TuneOverrides;
  arms: Record<string, { idx: number; arm: ExperimentArm }>;
}

/** Собирает патч параметров из назначенных арм всех экспериментов. */
export function assignment(sid: string): Assignment {
  const out: Assignment = { patch: {}, arms: {} };
  for (const exp of EXPERIMENTS) {
    const idx = armIndex(sid, exp);
    const arm = exp.arms[idx];
    out.arms[exp.key] = { idx, arm };
    Object.assign(out.patch, arm.patch);
  }
  return out;
}

/** Стабильный session-id: единственная точка «случайности» — ПЕРВАЯ генерация. */
export function genSessionId(): string {
  return 'sess-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

/* ============================ КОНТРОЛЛЕР ============================ */

/** Санитизация тюнинга: белый список ручек + только конечные числа. */
export function sanitizeTuning(raw: unknown): TuneOverrides {
  const out: TuneOverrides = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of KNOB_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && isFinite(v)) out[key] = v;
  }
  return out;
}

export class Experiments {
  /** Кэш последнего прогона (для гейтов); null — прогона ещё не было. */
  lastRun: SimRunResult | null = null;
  /** Длительность последнего прогона, мс (для подписи в кокпите). */
  lastElapsedMs = 0;
  /** Пройдено iterate-циклов soft launch (kill после 3, §9.5) — in-memory. */
  cyclesSpent = 0;

  constructor(
    private readonly storage: KeyValueStorage = defaultStorage(),
    private readonly genId: () => string = genSessionId
  ) {}

  /* --------------------------- хранилище --------------------------- */

  private lsGet(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private lsSet(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      /* приватный режим / переполнение — кокпит продолжает работать */
    }
  }

  /* --------------------------- session-id --------------------------- */

  getSessionId(): string {
    let sid = this.lsGet(K_SESSION);
    if (sid === null || sid === '') {
      sid = this.genId();
      this.lsSet(K_SESSION, sid);
    }
    return sid;
  }

  setSessionId(sid: string): void {
    const v = sid.trim();
    this.lsSet(K_SESSION, v !== '' ? v : this.genId());
    this.lastRun = null; // назначение A/B сменилось — прошлый прогон недействителен
  }

  newSessionId(): string {
    const sid = this.genId();
    this.lsSet(K_SESSION, sid);
    this.lastRun = null;
    return sid;
  }

  currentAssignment(): Assignment {
    return assignment(this.getSessionId());
  }

  /* --------------------------- тюнинг --------------------------- */

  loadTuning(): TuneOverrides {
    const raw = this.lsGet(K_TUNING);
    if (raw === null) return {};
    try {
      return sanitizeTuning(JSON.parse(raw));
    } catch {
      return {}; // повреждённый JSON → без тюнинга, без краша
    }
  }

  /**
   * Сохранить набор ручек: значения, равные книге, НЕ хранятся (как в
   * прототипе saveKnobsFromDom). Прошлый прогон сбрасывается.
   */
  saveTuning(values: Partial<Record<KnobKey, number>>): void {
    const t = this.loadTuning();
    for (const key of KNOB_KEYS) {
      const v = values[key];
      if (v === undefined || !isFinite(v)) continue;
      if (v === BOOK[key]) delete t[key];
      else t[key] = v;
    }
    this.lsSet(K_TUNING, JSON.stringify(t));
    this.lastRun = null;
  }

  /** «Сброс к значениям книги» (приложение 12 / главы 05–06). */
  resetTuning(): void {
    this.lsSet(K_TUNING, JSON.stringify({}));
    this.lastRun = null;
  }

  knobValue(key: KnobKey): number {
    const t = this.loadTuning();
    const v = t[key];
    return v !== undefined ? v : BOOK[key];
  }

  bookValue(key: KnobKey): number {
    return BOOK[key];
  }

  isKnobEdited(key: KnobKey): boolean {
    const t = this.loadTuning();
    return t[key] !== undefined && t[key] !== BOOK[key];
  }

  /* ------------- эффективные параметры: книга → A/B → тюнинг ------------- */

  /**
   * Итоговые оверрайды прогона: патч A/B выбранного session-id → ручной
   * тюнинг. Ручной тюнинг ПОБЕЖДАЕТ вариант A/B (сознательное переопределение
   * оператором), 1:1 с effectiveParams прототипа.
   */
  effectiveParams(applyAB: boolean): Partial<SimBook> {
    const over: TuneOverrides = {};
    if (applyAB) Object.assign(over, this.currentAssignment().patch);
    Object.assign(over, this.loadTuning());
    return over;
  }

  /** Источник значения ключа для чипов «Активные оверрайды»: тюнинг или A/B. */
  overrideSource(key: KnobKey): 'тюнинг' | 'A/B' {
    return this.loadTuning()[key] !== undefined ? 'тюнинг' : 'A/B';
  }

  /* --------------------------- прогон --------------------------- */

  /** Прогон когорты с A/B-патчем и тюнингом (детерминирован по seed). */
  runSim(N: number, seed: number): SimRunResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const res = run({ N, days: 30, seed, params: this.effectiveParams(true) });
    this.lastElapsedMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    this.lastRun = res;
    return res;
  }

  /* --------------------------- сценарий гейтов --------------------------- */

  getScenario(): ScenarioId {
    const raw = this.lsGet(K_SCENARIO);
    return raw !== null && (SCENARIO_IDS as readonly string[]).includes(raw) ? (raw as ScenarioId) : 'base';
  }

  setScenario(id: ScenarioId): void {
    this.lsSet(K_SCENARIO, id);
  }

  setCycles(n: number): void {
    this.cyclesSpent = Math.max(0, Math.min(3, Math.floor(isFinite(n) ? n : 0)));
  }

  /** Вердикт по текущему сценарию и последнему прогону (без DOM). */
  verdict(): VerdictResult {
    const sc = SCENARIOS[this.getScenario()];
    const roasD30 = ltv(30, sc) / sc.cpi;
    return evaluateVerdict(sc, roasD30, this.lastRun, this.cyclesSpent);
  }
}
