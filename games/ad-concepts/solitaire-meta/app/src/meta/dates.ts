/**
 * Календарные утилиты меты (порт dateStr/today/weekKey из prototype/meta.js):
 * локальные 'YYYY-MM-DD'. Чистые функции от миллисекунд — стрик и суточный
 * сброс миссий тестируются без реального времени (Clock инжектируется в Meta).
 */

export const DAY_MS = 86400000;

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Момент времени → локальный 'YYYY-MM-DD' (1:1 c dateStr прототипа). */
export function dateStr(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Номер недели: floor(ms / 7 суток) (1:1 c weekKey прототипа). */
export function weekKeyOf(ms: number): number {
  return Math.floor(ms / (7 * DAY_MS));
}
