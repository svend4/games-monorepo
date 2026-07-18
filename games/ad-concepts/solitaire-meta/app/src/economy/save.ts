/**
 * Схема сейва 'orchardPeaks.meta' и её защита (порт из prototype/economy.js).
 *
 * СХЕМА 1:1 С ПРОТОТИПОМ: те же ключи и вложенность, что писал economy.js —
 * прогресс из прототипа подхватывается прод-билдом БЕЗ миграции (v: 1).
 *
 * Двухступенчатая загрузка, как в прототипе:
 *  1) deepMerge(defaults, parsed) — поля, которых нет в сохранённом объекте,
 *     берутся из дефолтов (старые/частичные сейвы не ломают новые механики);
 *  2) sanitize(...) — приведение ТИПОВ значений: валидный по JSON, но
 *     повреждённый сейв (coins:"abc", level:0, completed:2.5, 1e400→Infinity)
 *     дал бы "abc100" в HUD, NaN во взносе E(n) или чтение FLAT[2.5].zoneIdx.
 *     Балансы — конечные ≥ 0, уровень/инвентарь/прогресс сада — целые в
 *     допустимых границах (кап бустеров, стрик ≤ 7).
 */
import { ECON } from './econ';

/* ============================ ТИПЫ СХЕМЫ ================================= */

export interface BoosterInventory {
  joker: number;
  basket: number;
}

export interface EconomySave {
  coins: number;
  harvest: number;
  /** Текущий уровень n (для E(n)/W(n)). */
  level: number;
  boosters: BoosterInventory;
  freeUndos: number;
}

export interface GardenSave {
  /** Сколько заказов выполнено (линейная цепочка, индекс в FLAT). */
  completed: number;
  /** Карточки гербария (флейвор наград зон). */
  cards: number;
}

export interface StreakSave {
  /** День цикла 0..7 (0 — награда ещё ни разу не забиралась). */
  day: number;
  /** Дата последнего забора 'YYYY-MM-DD' ('' — никогда). */
  lastClaim: string;
}

export interface MissionsSave {
  /** Дата дневного набора 'YYYY-MM-DD'; несовпадение с «сегодня» → сброс daily. */
  day: string;
  /** Номер недели (floor(nowMs / 7 суток)); несовпадение → сброс weekly. */
  week: number;
  /** id миссии → прогресс. */
  prog: Record<string, number>;
  /** id миссии → награда забрана. */
  claimed: Record<string, boolean>;
}

export interface StatsSave {
  /** Сдвиг «сегодня» для кнопки «Новый день (тест)». */
  simDayOffset: number;
}

/** Полный документ мета-состояния (один ключ — атомарное сохранение). */
export interface SaveState {
  /** Версия схемы (для будущих миграций). */
  v: number;
  economy: EconomySave;
  garden: GardenSave;
  /** Очки альманаха (05 §5.1) — лёгкий счётчик. */
  almanac: number;
  streak: StreakSave;
  missions: MissionsSave;
  stats: StatsSave;
  /** Помечает совсем новый сейв (для FTUE-события). */
  _fresh: boolean;
}

/* ============================= ДЕФОЛТЫ =================================== */

export function defaults(): SaveState {
  return {
    v: 1,
    economy: {
      coins: ECON.START_COINS,
      harvest: ECON.START_HARVEST,
      level: 1,
      boosters: { joker: ECON.START_JOKER, basket: 0 },
      freeUndos: ECON.START_UNDO
    },
    garden: { completed: 0, cards: 0 },
    almanac: 0,
    streak: { day: 0, lastClaim: '' },
    missions: { day: '', week: 0, prog: {}, claimed: {} },
    stats: { simDayOffset: 0 },
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

/** Конечное число или дефолт (1:1 с fin() прототипа: без парсинга строк). */
function fin(v: unknown, dflt: number): number {
  return typeof v === 'number' && isFinite(v) ? v : dflt;
}

/** Целое ≥ min (1:1 с intGE() прототипа). */
function intGE(v: unknown, min: number, dflt: number): number {
  const n = Math.floor(fin(v, dflt));
  return n < min ? min : n;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asObj(v: unknown): PlainObject {
  return isPlainObject(v) ? v : {};
}

/** Привести слитый объект к строгой типизированной схеме SaveState. */
export function sanitize(raw: unknown): SaveState {
  if (!isPlainObject(raw)) return defaults();
  const d = defaults();

  const e = asObj(raw.economy);
  const b = asObj(e.boosters);
  const boosters: BoosterInventory = { joker: 0, basket: 0 };
  for (const bid of ECON.BOOSTER_ORDER) {
    boosters[bid] = Math.min(ECON.BOOSTERS[bid].cap, intGE(b[bid], 0, 0));
  }
  const economy: EconomySave = {
    coins: Math.max(0, fin(e.coins, d.economy.coins)),
    harvest: Math.max(0, fin(e.harvest, d.economy.harvest)),
    level: intGE(e.level, 1, 1),
    boosters,
    freeUndos: intGE(e.freeUndos, 0, 0)
  };

  const g = asObj(raw.garden);
  const garden: GardenSave = {
    completed: intGE(g.completed, 0, 0), // индекс FLAT — только целый ≥ 0
    cards: intGE(g.cards, 0, 0)
  };

  const st = asObj(raw.streak);
  const streak: StreakSave = {
    day: Math.min(7, intGE(st.day, 0, 0)),
    lastClaim: toStr(st.lastClaim)
  };

  const mi = asObj(raw.missions);
  const prog: Record<string, number> = {};
  if (isPlainObject(mi.prog)) {
    for (const k of Object.keys(mi.prog)) prog[k] = intGE(mi.prog[k], 0, 0);
  }
  const claimed: Record<string, boolean> = {};
  if (isPlainObject(mi.claimed)) {
    for (const k of Object.keys(mi.claimed)) {
      if (mi.claimed[k]) claimed[k] = true;
    }
  }
  const missions: MissionsSave = {
    day: toStr(mi.day),
    week: intGE(mi.week, 0, 0),
    prog,
    claimed
  };

  const stt = asObj(raw.stats);
  return {
    v: intGE(raw.v, 1, 1),
    economy,
    garden,
    almanac: Math.max(0, fin(raw.almanac, 0)),
    streak,
    missions,
    stats: { simDayOffset: intGE(stt.simDayOffset, 0, 0) },
    _fresh: raw._fresh === true
  };
}
