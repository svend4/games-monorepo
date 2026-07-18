/**
 * PRNG ядра: mulberry32 + FNV-1a сид из строки (тот же слой, что в Block Surge).
 * Только uint32-арифметика → бит-в-бит одинаков на iOS/Android/JS.
 * В логике партии НЕТ Math.random — rng инжектируется в генератор раскладов.
 */
import type { Rng } from './types';

/** mulberry32: детерминированный PRNG от 32-битного сида. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32 бит: сид из строки — для «раздач дня» и headless-симулятора. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Случайный сид новой партии (вне реплеев). */
export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
