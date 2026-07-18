/**
 * Схема сейва 'blocksurge_meta' и её защита (Проход Е.2, порт economy.js).
 *
 * СХЕМА 1:1 С ПРОТОТИПОМ: те же ключи и вложенность, что писал economy.js —
 * прогресс из прототипа подхватывается прод-билдом без миграции (v: 2).
 *
 * Двухступенчатая загрузка, как в прототипе после ревью:
 *  1) deepMerge(defaults, parsed) — поля, которых нет в сохранённом объекте,
 *     берутся из дефолтов (старые/частичные сейвы не ломают новые механики);
 *  2) sanitize(...) — приведение ТИПОВ значений: deepMerge сохраняет структуру,
 *     но валидный повреждённый JSON (coins:null, totalStars:"x", 1e400→Infinity)
 *     прошёл бы насквозь и дал бы NaN/Infinity в HUD или краш на mapClaimed.push.
 *     Числа приводятся к конечным неотрицательным целым, контейнеры — к
 *     массивам/объектам ожидаемой формы.
 */
import { ECON } from './econ';

/* ============================ ТИПЫ СХЕМЫ ================================= */

export interface BoosterInventory {
  undo: number;
  swap: number;
  hammer: number;
}

export interface EconomySave {
  coins: number;
  boosters: BoosterInventory;
}

export interface StreakSave {
  /** День цикла 0..7 (0 — награда ещё ни разу не забиралась). */
  day: number;
  /** Суммарная длина серии (для бейджей). */
  count: number;
  /** Дата последнего забора 'YYYY-MM-DD' ('' — никогда). */
  lastClaim: string;
}

export interface MissionsSave {
  /** Дата набора 'YYYY-MM-DD'; несовпадение с «сегодня» → ротация. */
  date: string;
  /** id трёх миссий дня. */
  set: string[];
  /** id миссии → прогресс. */
  progress: Record<string, number>;
  /** id выполненных миссий. */
  done: string[];
  /** Бонус-сундук «все 3» уже выдан. */
  bonusClaimed: boolean;
}

export interface MetaSave {
  totalStars: number;
  /** id забранных узлов карты. */
  mapClaimed: number[];
  streak: StreakSave;
  missions: MissionsSave;
  /** Сдвиг «сегодня» для кнопки «Новый день (тест)». */
  simOffset: number;
}

export interface StatsSave {
  gamesPlayed: number;
}

/** Полный документ мета-состояния (один ключ — атомарное сохранение). */
export interface SaveState {
  /** Версия схемы (для будущих миграций). */
  v: number;
  economy: EconomySave;
  meta: MetaSave;
  stats: StatsSave;
  /** Помечает совсем новый сейв (для FTUE-события). */
  _fresh: boolean;
}

/* ============================= ДЕФОЛТЫ =================================== */

export function defaults(): SaveState {
  return {
    v: 2,
    economy: {
      coins: ECON.START_COINS,
      boosters: { undo: 0, swap: 0, hammer: 0 }
    },
    meta: {
      totalStars: 0,
      mapClaimed: [],
      streak: { day: 0, count: 0, lastClaim: '' },
      missions: { date: '', set: [], progress: {}, done: [], bonusClaimed: false },
      simOffset: 0
    },
    stats: { gamesPlayed: 0 },
    _fresh: true
  };
}

/* ============================ deepMerge ================================== */

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Глубокое слияние (1:1 с прототипом): поля, которых нет в сохранённом
 * объекте, берутся из дефолтов; совпадающие объекты сливаются рекурсивно.
 */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (over === null || over === undefined) return base;
  if (typeof base !== 'object' || Array.isArray(base) || base === null) {
    return over;
  }
  const b = base as PlainObject;
  const out: PlainObject = { ...b };
  if (typeof over !== 'object') return out; // примитив поверх объекта: свойств нет
  const o = over as PlainObject;
  for (const k of Object.keys(o)) {
    const bv = b[k];
    const ov = o[k];
    if (k in b && isPlainObject(bv) && isPlainObject(ov)) {
      out[k] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[k] = ov;
    }
  }
  return out;
}

/* ============================ САНИТИЗАЦИЯ ================================ */

/** Конечное неотрицательное целое из чего угодно (1:1 с прототипом). */
function toInt(v: unknown, def: number, min?: number, max?: number): number {
  let n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) n = def;
  n = Math.floor(n);
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Массив конечных чисел; не-массив/чужие элементы отбрасываются. */
function toNumArr(v: unknown): number[] {
  return Array.isArray(v)
    ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    : [];
}

/** Массив строк; не-массив/чужие элементы отбрасываются. */
function toStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asObj(v: unknown): PlainObject {
  return typeof v === 'object' && v !== null ? (v as PlainObject) : {};
}

/** Привести слитый объект к строгой типизированной схеме SaveState. */
export function sanitize(raw: unknown): SaveState {
  if (!raw || typeof raw !== 'object') return defaults();
  const s = raw as PlainObject;

  const e = asObj(s.economy);
  const b = asObj(e.boosters);
  const economy: EconomySave = {
    coins: toInt(e.coins, ECON.START_COINS, 0),
    boosters: {
      undo: toInt(b.undo, 0, 0),
      swap: toInt(b.swap, 0, 0),
      hammer: toInt(b.hammer, 0, 0)
    }
  };

  const m = asObj(s.meta);
  const st = asObj(m.streak);
  const mi = asObj(m.missions);
  const progress: Record<string, number> = {};
  if (isPlainObject(mi.progress)) {
    for (const k of Object.keys(mi.progress)) {
      progress[k] = toInt(mi.progress[k], 0, 0);
    }
  }
  const meta: MetaSave = {
    totalStars: toInt(m.totalStars, 0, 0),
    mapClaimed: toNumArr(m.mapClaimed),
    streak: {
      day: toInt(st.day, 0, 0, 7),
      count: toInt(st.count, 0, 0),
      lastClaim: toStr(st.lastClaim)
    },
    missions: {
      date: toStr(mi.date),
      set: toStrArr(mi.set),
      progress,
      done: toStrArr(mi.done),
      bonusClaimed: !!mi.bonusClaimed
    },
    simOffset: toInt(m.simOffset, 0, 0)
  };

  const stt = asObj(s.stats);
  return {
    v: toInt(s.v, 2, 1),
    economy,
    meta,
    stats: { gamesPlayed: toInt(stt.gamesPlayed, 0, 0) },
    _fresh: s._fresh === true
  };
}
