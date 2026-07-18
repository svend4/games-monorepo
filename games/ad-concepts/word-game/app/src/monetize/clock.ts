/**
 * Инжектируемые часы (Проход Е.2, урок Block Surge). Правила капов
 * interstitial (06 §4) — временные («≥45 c между показами», «≥30 c после
 * rewarded»), поэтому в логике правил НЕТ прямых Date.now(): время приходит
 * через Clock, а тесты двигают его детерминированно.
 */

export interface Clock {
  /** Текущее время, мс (epoch — как Date.now()). */
  now(): number;
}

/** Прод-часы: системное время. */
export const systemClock: Clock = { now: () => Date.now() };
