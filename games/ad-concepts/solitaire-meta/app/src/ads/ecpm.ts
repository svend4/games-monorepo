/**
 * eCPM-модель СИМУЛЯЦИИ показов (Проход Е.2, числа 1:1 из прототипа
 * monetize.js MON.ECPM / MON.ECPM_FLOOR / MON.ECPM_SPREAD; источник — 06 §6.7).
 *
 * Чистые функции без DOM: ставка показа тестируется с инжектированным RNG.
 * tier1 — blended Tier-1 микс (rewarded $16 / interstitial $12); tier23 —
 * середины полос rewarded $3–7 и interstitial $2–5 (06 §6.7).
 */

/** Формат рекламы Orchard Peaks (06 §6.2): rewarded и interstitial (баннеров нет). */
export type AdFormat = 'rewarded' | 'interstitial';

/** Гео-корзина симуляции (06 §6.6): переключатель Tier-1 / Tier-2-3. */
export type GeoTier = 'tier1' | 'tier23';

/** eCPM-бенчмарки, $ за 1000 показов (06 §6.7), 1:1 из прототипа. */
export const ECPM: Readonly<Record<GeoTier, Readonly<Record<AdFormat, number>>>> = {
  tier1: { rewarded: 16.0, interstitial: 12.0 },
  tier23: { rewarded: 5.0, interstitial: 3.5 }
};

/** eCPM-floor запроса (06 §6.6 / §6.3 п.8): дешёвый показ не стоит риска. */
export const ECPM_FLOOR: Readonly<Record<GeoTier, Readonly<Record<AdFormat, number>>>> = {
  tier1: { rewarded: 10.0, interstitial: 6.0 },
  tier23: { rewarded: 1.5, interstitial: 2.0 }
};

/** ± разброс ставки вокруг бенчмарка (реализм аукциона). */
export const ECPM_SPREAD = 0.35;

/** Доля «не загрузилось» (fill < 100%), 1:1 с MON.FAIL_RATE. */
export const FAIL_RATE: Readonly<Record<AdFormat, number>> = {
  rewarded: 0.0,
  interstitial: 0.03
};

export const GEO_LABELS: Readonly<Record<GeoTier, string>> = {
  tier1: 'Tier-1',
  tier23: 'Tier-2/3'
};

export const GEO_ORDER: readonly GeoTier[] = ['tier1', 'tier23'];

/** Гео по умолчанию — как в прототипе (defaults().geoTier = 'tier1'). */
export const DEFAULT_GEO: GeoTier = 'tier1';

/** Бенчмарк eCPM формата в гео, $/1000. */
export function ecpmFor(format: AdFormat, geo: GeoTier): number {
  return ECPM[geo][format];
}

/** Floor формата в гео, $/1000 (interstitial ниже floor не показываем, §6.3 п.8). */
export function ecpmFloor(format: AdFormat, geo: GeoTier): number {
  return ECPM_FLOOR[geo][format];
}

/**
 * Случайная ставка вокруг бенчмарка выбранного гео (порт rollEcpm 1:1).
 * Rewarded «заполняется» не ниже floor (высокий fill); interstitial возвращает
 * сырую ставку — floor проверяется отдельно правилом 6.3 п.8.
 * rng инжектируется (детерминизм в тестах); rng()=0.5 → ровно бенчмарк.
 */
export function rollEcpm(format: AdFormat, geo: GeoTier, rng: () => number): number {
  const base = ECPM[geo][format];
  let v = base * (1 + (rng() * 2 - 1) * ECPM_SPREAD);
  if (format === 'rewarded') v = Math.max(ECPM_FLOOR[geo].rewarded, v);
  return Math.max(0, v);
}
