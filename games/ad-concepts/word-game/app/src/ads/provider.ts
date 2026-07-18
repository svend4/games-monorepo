/**
 * Контракт рекламного слоя WordGrove (Проход Е.2, по образцу порта Block Surge).
 *
 * AdProvider — ЕДИНСТВЕННАЯ точка, через которую игра говорит с рекламой.
 * Слой монетизации (src/monetize) решает, КОГДА показывать (капы 06 §4,
 * карта плейсментов 06 §3) и что делать с наградой; провайдер отвечает
 * только за сам показ и его выручку.
 *
 * В прод-сборке за интерфейсом встанет AppLovin MAX (медиация, 06 §6, §8):
 *  - init()             → AppLovinMAX.initialize(SDK_KEY) + прелоад ad unit'ов;
 *  - isRewardedReady()  → AppLovinMAX.isRewardedAdReady(adUnitId) — fill есть;
 *  - showRewarded()     → showAd + колбэки onRewardedAdReceivedReward /
 *                         onRewardedAdHidden → RewardedResult;
 *  - showInterstitial() → то же для interstitial-юнита (skippable, 06 §4);
 *  - show/hideBanner()  → createBanner / showBanner / hideBanner
 *                         (adaptive banner 320×50, рефреш 45 c, 06 §3.3);
 *  - onImpression       → OnAdRevenuePaid (impression-level revenue API MAX) —
 *                         источник ad-выручки для LTV-модели (09 §1).
 *
 * В веб-сборке работает SimAdProvider (СИМУЛЯЦИЯ, никаких SDK) — выбор
 * делает фабрика src/ads/index.ts по флагу окружения.
 */

/** Формат рекламы (06 §3): rewarded / interstitial / баннер. */
export type AdFormat = 'rw' | 'int' | 'banner';

/** Итог показа rewarded-ролика. */
export interface RewardedResult {
  /**
   * Ролик досмотрен до конца → вызывающий выдаёт награду.
   * В MAX это колбэк onRewardedAdReceivedReward; закрытие без досмотра
   * (или no-fill) — completed:false, награды нет.
   */
  completed: boolean;
  /** Выручка показа, $ (impression-level; 0 — показа не было). */
  revenueUsd: number;
}

/** Итог показа interstitial. */
export interface InterstitialResult {
  /** Показ состоялся (был fill и показ не упал). */
  shown: boolean;
  /** Выручка показа, $ (0 — показа не было). */
  revenueUsd: number;
}

/** Impression-level событие показа (аналог OnAdRevenuePaid из MAX). */
export interface AdImpression {
  format: AdFormat;
  /** Плейсмент из карты 06 §3: 'I-1', 'RV-1'/'RV-2'/'RV-5'/'RV-6', 'B-1'. */
  placement: string;
  /** Выручка этого показа, $. */
  revenueUsd: number;
  /** eCPM показа, $/1000 — для события ad_revenue (09 §1). */
  ecpmUsd: number;
}

/**
 * Единственная точка контакта игры с рекламными сетями.
 * Реализации: SimAdProvider (веб, симуляция) и MaxAdProvider (прод, скелет).
 */
export interface AdProvider {
  /** Инициализация SDK/симулятора. Вызывается один раз на старте приложения. */
  init(): Promise<void>;

  /**
   * Есть ли готовый rewarded под плейсмент (fill). UI прячет/глушит оффер
   * при false — оффер без инвентаря хуже отсутствия оффера.
   */
  isRewardedReady(placement: string): boolean;

  /**
   * Показ rewarded. Promise резолвится ПОСЛЕ закрытия ролика.
   * Никогда не reject по бизнес-причинам: «не досмотрел»/«нет fill» —
   * это completed:false (reject — только программные ошибки).
   */
  showRewarded(placement: string): Promise<RewardedResult>;

  /** Показ interstitial. Promise резолвится после закрытия; no-fill → shown:false. */
  showInterstitial(placement: string): Promise<InterstitialResult>;

  /** Включить баннер-полосу (B-1). Провайдер сам рефрешит и шлёт impression'ы. */
  showBanner(): void;

  /** Спрятать баннер (Remove Ads / подписка / дневной режим, 06 §3.3, §5). */
  hideBanner(): void;

  /**
   * Колбэк КАЖДОГО показа (rewarded/interstitial/баннер-рефреш) — учёт выручки
   * в слое монетизации. Подписчик один: MonetizeController.
   */
  onImpression: ((imp: AdImpression) => void) | null;
}
