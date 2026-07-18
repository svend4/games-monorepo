/**
 * eCPM-модель СИМУЛЯЦИИ показов (Проход Е.2, числа 1:1 из прототипа
 * monetize.js MON.ECPM / MON.ECPM_JITTER; источник — 06 §4).
 *
 * Чистые функции без DOM: выручка показа тестируется с инжектированным RNG.
 * tier1 — точки США/Tier-1 (rewarded ~$16, interstitial ~$14, banner ~$0.5);
 * tier23 = tier1 × 0.4; blend — столбец «Blend 60/40» 06 §4, к нему привязаны
 * цели KPI главы 09.
 */
import type { AdFormat } from './provider';

/** Гео-корзина симуляции (06 §6). */
export type GeoTier = 'tier1' | 'blend' | 'tier23';

/** eCPM-бенчмарки, $ за 1000 показов (06 §4), 1:1 из прототипа. */
export const ECPM: Readonly<Record<AdFormat, Readonly<Record<GeoTier, number>>>> = {
  rw: { tier1: 16.0, blend: 13.0, tier23: 6.4 },
  int: { tier1: 14.0, blend: 10.0, tier23: 5.6 },
  banner: { tier1: 0.5, blend: 0.4, tier23: 0.2 }
};

/** ±25% случайный разброс выручки вокруг бенчмарка. */
export const ECPM_JITTER = 0.25;

export const GEO_LABELS: Readonly<Record<GeoTier, string>> = {
  tier1: 'Tier-1 (US/JP/DE/UK)',
  blend: 'Бленд 60/40',
  tier23: 'Tier-2/3'
};

export const GEO_ORDER: readonly GeoTier[] = ['tier1', 'blend', 'tier23'];

/** Бленд по умолчанию — чтобы KPI совпадали с целями 09 (blended). */
export const DEFAULT_GEO: GeoTier = 'blend';

/** Бенчмарк eCPM формата в гео, $/1000. */
export function ecpmFor(format: AdFormat, geo: GeoTier): number {
  return ECPM[format][geo];
}

/**
 * Выручка ОДНОГО показа: eCPM × (1 ± jitter) / 1000.
 * rng инжектируется (детерминизм в тестах); rng()=0.5 → ровно бенчмарк.
 */
export function genRevenue(format: AdFormat, geo: GeoTier, rng: () => number): number {
  const jitter = 1 + (rng() * 2 - 1) * ECPM_JITTER;
  return (ecpmFor(format, geo) * jitter) / 1000;
}
