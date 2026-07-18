/**
 * Календарные даты меты (порт из meta.js): локальные 'YYYY-MM-DD'.
 * Чистые функции — стрик и ротация миссий тестируются без реального времени.
 */

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Дата → локальный 'YYYY-MM-DD'. */
export function ymd(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 'YYYY-MM-DD' → локальная полночь этого дня. */
export function parseYMD(s: string): Date {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** Целых дней между датами (b − a); пустая строка → 999 («давно»). */
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 999;
  return Math.round((parseYMD(b).getTime() - parseYMD(a).getTime()) / 86400000);
}
