/**
 * eCPM-модель СИМУЛЯЦИИ показов (Проход Е.2, числа 1:1 из прототипа
 * monetize.js WGMON.ECPM / WGMON.ECPM_JITTER; источник — 06 §8.1).
 *
 * Чистые функции без DOM: выручка показа тестируется с инжектированным RNG.
 * tier1 — Tier-1 (US/UK/CA/AU): blended rewarded US ≈ $17,8, interstitial
 * blended US ≈ $14, banner US Android ≈ $0,55. tier23 — модель 06 §8.1.
 * blend — бленд 60% T1 / 40% T2-3 (06 §8.2), к нему привязаны цели KPI 09.
 */
import type { AdFormat } from './provider';

/** Гео-корзина симуляции (06 §7, §8.1). */
export type GeoTier = 'tier1' | 'blend' | 'tier23';

/** eCPM-бенчмарки, $ за 1000 показов (06 §8.1), 1:1 из прототипа. */
export const ECPM: Readonly<Record<AdFormat, Readonly<Record<GeoTier, number>>>> = {
  rw: { tier1: 17.8, blend: 13.0, tier23: 6.0 },
  int: { tier1: 14.0, blend: 10.0, tier23: 4.0 },
  banner: { tier1: 0.55, blend: 0.4, tier23: 0.15 }
};

/** ±25% случайный разброс выручки вокруг бенчмарка. */
export const ECPM_JITTER = 0.25;

export const GEO_LABELS: Readonly<Record<GeoTier, string>> = {
  tier1: 'Tier-1 (US/UK/CA/AU)',
  blend: 'Бленд 60/40',
  tier23: 'Tier-2/3'
};

export const GEO_ORDER: readonly GeoTier[] = ['tier1', 'blend', 'tier23'];

/** Бленд по умолчанию — чтобы KPI сходились с целями 09 (blended). */
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
