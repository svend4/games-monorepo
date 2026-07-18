/**
 * Схема сейва 'wordgrove.monetize.v1' и её защита (Проход Е.2, порт WGMonStore
 * из прототипа monetize.js). СХЕМА 1:1 С ПРОТОТИПОМ: те же ключи и вложенность —
 * состояние монетизации из прототипа подхватывается прод-билдом без миграции.
 *
 * Санитизация — как в прототипе: валидный, но повреждённый JSON (adRev:"x",
 * int:1e400→Infinity, day:null) не должен дать NaN/Infinity в выручке дашборда
 * или сломать счётчики капов. Числа приводятся к конечным (счётчики — к целым
 * ≥0), строки/флаги — к ожидаемым типам, неизвестное гео — к дефолтному.
 */
import { DEFAULT_GEO, GEO_ORDER, type GeoTier } from '../ads/ecpm';

/* ============================ ТИПЫ СХЕМЫ ================================= */

export interface SubscriptionSave {
  active: boolean;
  /** План: 'monthly' | 'yearly' | '' (не оформлена). */
  plan: string;
  /** Триальный период (7 дней) ещё идёт. */
  trial: boolean;
  /** Дата старта 'YYYY-MM-DD' ('' — не стартовала). */
  since: string;
  /** Дата последней амортизации net-выручки 'YYYY-MM-DD'. */
  lastDaily: string;
}

/** Дневные счётчики капов (сбрасываются при смене даты). */
export interface DayCounters {
  /** Дата 'YYYY-MM-DD'; несовпадение с «сегодня» → сброс счётчиков. */
  date: string;
  /** Показов interstitial сегодня (кап ≤12, 06 §4). */
  int: number;
  /** RV-1 «Бесплатная Лампа» сегодня (кап ≤4). */
  rv1: number;
  /** RV-6 «Заморозка стрика» сегодня (кап ≤1). */
  rv6: number;
}

export interface LifetimeStats {
  /** Модельная ad-выручка за всё время, $. */
  adRev: number;
  /** Модельная IAP-выручка за всё время, $. */
  iapRev: number;
  /** Амортизированная net-выручка подписки, $. */
  subRev: number;
  imp: { int: number; rw: number; banner: number };
  iapCount: number;
}

/** Полный документ состояния монетизации (один ключ — атомарное сохранение). */
export interface MonetizeSave {
  v: number;
  removeAds: boolean;
  subscription: SubscriptionSave;
  geoTier: GeoTier;
  /** Жетоны «Заморозка стрика» (выданы RV-6). */
  freezeTokens: number;
  skins: string[];
  frame: boolean;
  badge: boolean;
  starterBought: boolean;
  day: DayCounters;
  lifetime: LifetimeStats;
}

/* ============================= ДЕФОЛТЫ =================================== */

export function monetizeDefaults(): MonetizeSave {
  return {
    v: 1,
    removeAds: false,
    subscription: { active: false, plan: '', trial: false, since: '', lastDaily: '' },
    geoTier: DEFAULT_GEO,
    freezeTokens: 0,
    skins: [],
    frame: false,
    badge: false,
    starterBought: false,
    day: { date: '', int: 0, rv1: 0, rv6: 0 },
    lifetime: { adRev: 0, iapRev: 0, subRev: 0, imp: { int: 0, rw: 0, banner: 0 }, iapCount: 0 }
  };
}

/* ============================ САНИТИЗАЦИЯ ================================ */

type PlainObject = Record<string, unknown>;

function asObj(v: unknown): PlainObject {
  return typeof v === 'object' && v !== null ? (v as PlainObject) : {};
}

/** Конечное число (1:1 с num прототипа): не-число/NaN/Infinity → def, клип снизу. */
function toNum(v: unknown, def: number, min?: number): number {
  let n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) n = def;
  if (min !== undefined && n < min) n = min;
  return n;
}

/** Целое (счётчики показов/капов). */
function toInt(v: unknown, def: number, min?: number): number {
  return Math.floor(toNum(v, def, min));
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toBool(v: unknown): boolean {
  return !!v;
}

/** Массив строк; чужие элементы отбрасываются (в духе санитайзинга Е.1). */
function toStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Привести распарсенный JSON к строгой типизированной схеме MonetizeSave. */
export function sanitizeMonetize(raw: unknown): MonetizeSave {
  const d = monetizeDefaults();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw as PlainObject;
  const sub = asObj(s.subscription);
  const day = asObj(s.day);
  const lt = asObj(s.lifetime);
  const imp = asObj(lt.imp);

  let geo = toStr(s.geoTier) as GeoTier;
  if (GEO_ORDER.indexOf(geo) === -1) geo = DEFAULT_GEO;

  return {
    v: toInt(s.v, 1, 1),
    removeAds: toBool(s.removeAds),
    subscription: {
      active: toBool(sub.active),
      plan: toStr(sub.plan),
      trial: toBool(sub.trial),
      since: toStr(sub.since),
      lastDaily: toStr(sub.lastDaily)
    },
    geoTier: geo,
    freezeTokens: toInt(s.freezeTokens, 0, 0),
    skins: toStrArr(s.skins),
    frame: toBool(s.frame),
    badge: toBool(s.badge),
    starterBought: toBool(s.starterBought),
    day: {
      date: toStr(day.date),
      int: toInt(day.int, 0, 0),
      rv1: toInt(day.rv1, 0, 0),
      rv6: toInt(day.rv6, 0, 0)
    },
    lifetime: {
      adRev: toNum(lt.adRev, 0, 0),
      iapRev: toNum(lt.iapRev, 0, 0),
      subRev: toNum(lt.subRev, 0, 0),
      imp: {
        int: toInt(imp.int, 0, 0),
        rw: toInt(imp.rw, 0, 0),
        banner: toInt(imp.banner, 0, 0)
      },
      iapCount: toInt(lt.iapCount, 0, 0)
    }
  };
}
