/**
 * Работа с датами (порт секции «ДАТЫ» prototype/meta.js).
 * Локальный календарный день 'YYYY-MM-DD' — дневной кроссворд и стрик.
 */

function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** 'YYYY-MM-DD' локальной даты. */
export function todayStr(d: Date = new Date()): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function parseDate(str: string | null): Date | null {
  if (typeof str !== 'string') return null;
  const m = str.split('-');
  if (m.length !== 3) return null;
  const d = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]));
  return isNaN(d.getTime()) ? null : d;
}

/** true, если prevStr — календарный день перед curStr. */
export function isYesterday(prevStr: string | null, curStr: string): boolean {
  const p = parseDate(prevStr);
  const c = parseDate(curStr);
  if (p === null || c === null) return false;
  const y = new Date(c.getTime());
  y.setDate(y.getDate() - 1);
  return todayStr(y) === prevStr;
}

/** День года (для ротации тем дня). */
export function dayOfYear(d: Date = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}
