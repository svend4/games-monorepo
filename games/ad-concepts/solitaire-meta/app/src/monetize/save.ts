/**
 * Схема сейва 'orchardPeaks.monetize' и её защита (Проход Е.2, порт
 * defaults()/sanitize() из прототипа monetize.js). СХЕМА 1:1 С ПРОТОТИПОМ:
 * те же ключи и вложенность — состояние монетизации из прототипа
 * подхватывается прод-билдом без миграции.
 *
 * Санитизация — как в прототипе: валидный, но повреждённый JSON
 * (adRevenue:"x", monthNo:1e400→Infinity, piggy.balance:-5) не должен дать
 * NaN/Infinity в выручке дашборда или сломать счётчики капов. Числа приводятся
 * к конечным (счётчики — к целым ≥ 0), флаги — к boolean, неизвестное гео —
 * к дефолтному, баланс копилки — в [0..PIGGY_CAP].
 */
import { DEFAULT_GEO, GEO_ORDER, type GeoTier } from '../ads/ecpm';
import { MON } from './config';

/* ============================ ТИПЫ СХЕМЫ ================================= */

export interface SubSave {
  active: boolean;
  /** Номер месяца подписки (для sub_state start/renew). */
  monthNo: number;
  startTs: number;
}

export interface PiggySave {
  owned: boolean;
  balance: number;
}

export interface PayerSave {
  /** Была ли хоть одна покупка (is_first_purchase). */
  first: boolean;
  /** Время последней покупки, мс — окно покоя 72 ч (06 §6.3.7). */
  lastPurchaseTs: number;
}

/** Суточные капы (переживают перезагрузку). */
export interface DailySave {
  /** Дата 'YYYY-MM-DD'; несовпадение с «сегодня» → сброс счётчиков. */
  date: string;
  /** Показов INT1 сегодня (кап ≤ 8, 06 §6.3.3). */
  int: number;
  /** Плейсмент → показов rewarded сегодня (капы MON.RW_DAILY_CAP). */
  rw: Record<string, number>;
}

export interface LifetimeSave {
  adRevenue: number;
  iapRevenue: number;
  /** Плейсмент → показов за всё время. */
  imps: Record<string, number>;
  /** Плейсмент → выручка, $. */
  rev: Record<string, number>;
  /** SKU → число покупок (для once-SKU). */
  purchases: Record<string, number>;
}

/** Полный документ состояния монетизации (один ключ — атомарное сохранение). */
export interface MonetizeSave {
  v: number;
  geoTier: GeoTier;
  /** Симуляция ивента пт–вс (для RW5). */
  eventWeekend: boolean;
  removeAds: boolean;
  sub: SubSave;
  /** «Дата установки», мс (для правила ≥ 24 ч, 06 §6.3.1). */
  installTs: number;
  piggy: PiggySave;
  club: { lastGrantDate: string };
  payer: PayerSave;
  daily: DailySave;
  life: LifetimeSave;
}

/* ============================= ДЕФОЛТЫ =================================== */

export function monetizeDefaults(): MonetizeSave {
  return {
    v: 1,
    geoTier: DEFAULT_GEO,
    eventWeekend: false,
    removeAds: false,
    sub: { active: false, monthNo: 0, startTs: 0 },
    installTs: 0,
    piggy: { owned: false, balance: 0 },
    club: { lastGrantDate: '' },
    payer: { first: false, lastPurchaseTs: 0 },
    daily: { date: '', int: 0, rw: {} },
    life: { adRevenue: 0, iapRevenue: 0, imps: {}, rev: {}, purchases: {} }
  };
}

/* ============================ САНИТИЗАЦИЯ ================================ */

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asObj(v: unknown): PlainObject {
  return isPlainObject(v) ? v : {};
}

/** Конечное число или дефолт (1:1 с fin() прототипа: без парсинга строк). */
function fin(v: unknown, dflt: number): number {
  return typeof v === 'number' && isFinite(v) ? v : dflt;
}

function numGE0(v: unknown): number {
  return Math.max(0, fin(v, 0));
}

function intGE0(v: unknown): number {
  return Math.max(0, Math.floor(fin(v, 0)));
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Флаг по правилам прототипа (!!v — truthy достаточно). */
function toBool(v: unknown): boolean {
  return Boolean(v);
}

/** Числовая карта «ключ → счётчик» (целые ≥ 0). */
function intMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) out[k] = intGE0(v[k]);
  }
  return out;
}

/** Числовая карта «ключ → сумма $» (конечные ≥ 0). */
function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) out[k] = numGE0(v[k]);
  }
  return out;
}

/** Привести распарсенный JSON к строгой типизированной схеме MonetizeSave. */
export function sanitizeMonetize(raw: unknown): MonetizeSave {
  const d = monetizeDefaults();
  if (!isPlainObject(raw)) return d;
  const sub = asObj(raw.sub);
  const piggy = asObj(raw.piggy);
  const club = asObj(raw.club);
  const payer = asObj(raw.payer);
  const daily = asObj(raw.daily);
  const life = asObj(raw.life);

  const geoRaw = toStr(raw.geoTier) as GeoTier;
  const geoTier: GeoTier = GEO_ORDER.indexOf(geoRaw) === -1 ? DEFAULT_GEO : geoRaw;

  return {
    v: Math.max(1, Math.floor(fin(raw.v, 1))),
    geoTier,
    eventWeekend: toBool(raw.eventWeekend),
    removeAds: toBool(raw.removeAds),
    sub: {
      active: toBool(sub.active),
      monthNo: intGE0(sub.monthNo),
      startTs: numGE0(sub.startTs)
    },
    installTs: numGE0(raw.installTs),
    piggy: {
      owned: toBool(piggy.owned),
      balance: Math.min(MON.PIGGY_CAP, numGE0(piggy.balance))
    },
    club: { lastGrantDate: toStr(club.lastGrantDate) },
    payer: {
      first: toBool(payer.first),
      lastPurchaseTs: numGE0(payer.lastPurchaseTs)
    },
    daily: {
      date: toStr(daily.date),
      int: intGE0(daily.int),
      rw: intMap(daily.rw)
    },
    life: {
      adRevenue: numGE0(life.adRevenue),
      iapRevenue: numGE0(life.iapRevenue),
      imps: intMap(life.imps),
      rev: numMap(life.rev),
      purchases: intMap(life.purchases)
    }
  };
}
