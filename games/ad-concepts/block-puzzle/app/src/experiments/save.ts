/**
 * Схема сейва 'blocksurge_softlaunch' и её защита (Проход Е.3, порт state из
 * experiments.js Прохода Г). СХЕМА 1:1 С ПРОТОТИПОМ: те же ключи — настройки
 * кокпита из прототипа подхватываются прод-билдом без миграции.
 *
 * Санитизация — в духе save.ts/monetize/save.ts: повреждённый JSON (cpi:"x",
 * simN:1e400, iterateCount:-3, retScenario:'weird') не роняет кокпит и не даёт
 * NaN в гейтах. tune-переопределения фильтруются ПО БЕЛОМУ СПИСКУ ручек панели
 * (KNOB-ключи + ecpm.*): чужие ключи отбрасываются — тюнингу подлежит только
 * TUNE-слой, номиналы 05/06 не тюнятся (INV-E1).
 */
import type { TuneOverrides } from '../sim/constants';

/* ============================ ТИПЫ СХЕМЫ ================================= */

export type RetScenarioId = 'pess' | 'base' | 'optim';

/** Полный документ состояния кокпита (один ключ — атомарное сохранение). */
export interface SoftlaunchState {
  v: number;
  /** Стабильный per-install session-id — база детерминизма A/B. */
  sessionId: string;
  /** Переопределения ручек поверх калиброванного baseline (12 §8). */
  tune: TuneOverrides;
  retScenario: RetScenarioId;
  /** CPI, $ (09 §5.2 база 0.90). */
  cpi: number;
  /** IAP-ARPDAU, $ (09 §4). */
  iapArpdau: number;
  /** Сколько iterate-циклов уже пройдено (10 P7, лимит 2). */
  iterateCount: number;
  /** N игроков браузерного прогона (кап 100–400, прогон <1 с). */
  simN: number;
  /** Применять ли назначенные A/B-варианты к главному прогону. */
  applyAB: boolean;
}

export const SOFTLAUNCH_KEY = 'blocksurge_softlaunch';

export const RET_SCENARIO_IDS: readonly RetScenarioId[] = ['pess', 'base', 'optim'];

/** Числовые ручки панели тюнинга (белый список tune-переопределений). */
export const TUNE_NUMERIC_KEYS = [
  'W_HARD',
  'intPerDau',
  'bannerPerDau',
  'rw2Cap',
  'missionsEV',
  'weeklyBundleEV',
  'boosterScale',
  'rw2Mult',
  'startGrant'
] as const;

export type TuneNumericKey = (typeof TUNE_NUMERIC_KEYS)[number];
export type EcpmSubKey = 'rw' | 'int' | 'banner';
export const ECPM_SUB_KEYS: readonly EcpmSubKey[] = ['rw', 'int', 'banner'];

/* ============================= ДЕФОЛТЫ =================================== */

export function softlaunchDefaults(): SoftlaunchState {
  return {
    v: 1,
    sessionId: '',
    tune: {},
    retScenario: 'base',
    cpi: 0.9, // 09 §5.2 база
    iapArpdau: 0.045, // 09 §4
    iterateCount: 0,
    simN: 300,
    applyAB: false // главная таблица по умолчанию валидирует чистый baseline vs 05 §4
  };
}

/* ============================ САНИТИЗАЦИЯ ================================ */

type PlainObject = Record<string, unknown>;

function asObj(v: unknown): PlainObject {
  return typeof v === 'object' && v !== null ? (v as PlainObject) : {};
}

/** Конечное число или undefined (для необязательных tune-переопределений). */
function toFiniteOpt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** Конечное число с дефолтом и клипом (для обязательных полей). */
function toNum(v: unknown, def: number, min?: number, max?: number): number {
  let n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) n = def;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

function toInt(v: unknown, def: number, min?: number, max?: number): number {
  return Math.floor(toNum(v, def, min, max));
}

/** tune-переопределения: только ручки панели (белый список) + ecpm.*. */
export function sanitizeTuneOverrides(raw: unknown): TuneOverrides {
  const src = asObj(raw);
  const out: TuneOverrides = {};
  for (const key of TUNE_NUMERIC_KEYS) {
    const n = toFiniteOpt(src[key]);
    if (n !== undefined) out[key] = n;
  }
  const ecpmSrc = asObj(src.ecpm);
  const ecpm: Partial<Record<EcpmSubKey, number>> = {};
  let hasEcpm = false;
  for (const sub of ECPM_SUB_KEYS) {
    const n = toFiniteOpt(ecpmSrc[sub]);
    if (n !== undefined) {
      ecpm[sub] = n;
      hasEcpm = true;
    }
  }
  if (hasEcpm) out.ecpm = ecpm;
  return out;
}

/** Привести распарсенный JSON к строгой схеме SoftlaunchState. */
export function sanitizeSoftlaunch(raw: unknown): SoftlaunchState {
  const d = softlaunchDefaults();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw as PlainObject;

  const scenarioRaw = typeof s.retScenario === 'string' ? s.retScenario : '';
  const retScenario: RetScenarioId = (RET_SCENARIO_IDS as readonly string[]).includes(scenarioRaw)
    ? (scenarioRaw as RetScenarioId)
    : d.retScenario;

  return {
    v: toInt(s.v, d.v, 1),
    sessionId: typeof s.sessionId === 'string' ? s.sessionId : '',
    tune: sanitizeTuneOverrides(s.tune),
    retScenario,
    cpi: toNum(s.cpi, d.cpi, 0.01),
    iapArpdau: toNum(s.iapArpdau, d.iapArpdau, 0),
    iterateCount: toInt(s.iterateCount, 0, 0),
    simN: toInt(s.simN, d.simN, 100, 400),
    applyAB: s.applyAB === true
  };
}
