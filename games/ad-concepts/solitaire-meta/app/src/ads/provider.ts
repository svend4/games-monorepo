/**
 * Контракт рекламного слоя Orchard Peaks (Проход Е.2).
 *
 * AdProvider — ЕДИНСТВЕННАЯ точка, через которую игра говорит с рекламой.
 * Слой монетизации (src/monetize) решает, КОГДА показывать (капы 06 §6.3,
 * карта плейсментов 06 §6.2) и что делать с наградой; провайдер отвечает
 * только за сам показ и его выручку.
 *
 * В прод-сборке за интерфейсом встанет AppLovin MAX (медиация, 06 §6.8):
 *  - init()             → AppLovinMAX.initialize(SDK_KEY) + прелоад ad unit'ов;
 *  - isRewardedReady()  → AppLovinMAX.isRewardedAdReady(adUnitId) — fill есть;
 *  - showRewarded()     → showAd + колбэки onRewardedAdReceivedReward /
 *                         onRewardedAdHidden → RewardedResult;
 *  - showInterstitial() → то же для interstitial-юнита; eCPM-floor запроса
 *                         (06 §6.3 п.8) в проде задаётся в MAX-дашборде —
 *                         дешёвый показ приходит как no-fill;
 *  - onImpression       → OnAdRevenuePaid (impression-level revenue API MAX) —
 *                         источник ad-выручки для LTV-модели (09 §9.7).
 *
 * В веб-сборке работает SimAdProvider (СИМУЛЯЦИЯ, никаких SDK) — выбор
 * делает фабрика src/ads/index.ts по флагу окружения.
 */
import type { AdFormat } from './ecpm';

export type { AdFormat } from './ecpm';

/** Итог показа rewarded-ролика. */
export interface RewardedResult {
  /**
   * Ролик досмотрен до конца → вызывающий выдаёт награду.
   * «Не загрузилось» (fill < 100%) или закрытие без досмотра — completed:false,
   * награды нет (reject — только программные ошибки).
   */
  completed: boolean;
  /** Выручка показа, $ (impression-level; 0 — показа не было). */
  revenueUsd: number;
  /** eCPM показа, $/1000 — для события ad_completed (09 §9.1). */
  ecpmUsd: number;
}

/** Причина «показа не было» у interstitial. */
export type InterstitialNoFill =
  | 'eCPM-floor' // ставка ниже floor запроса (06 §6.3 п.8) — оверлей не открывался
  | 'no_fill'; // «не загрузилось» (fill < 100%) — экран ошибки показан

/** Итог показа interstitial. */
export interface InterstitialResult {
  /** Показ состоялся (был fill и ставка выше floor). */
  shown: boolean;
  /** Выручка показа, $ (0 — показа не было). */
  revenueUsd: number;
  /** eCPM ставки запроса, $/1000 (заполнен и при отказе — для аудита floor). */
  ecpmUsd: number;
  /** Причина отказа (только при shown:false). */
  noFillReason?: InterstitialNoFill;
}

/** Impression-level событие показа (аналог OnAdRevenuePaid из MAX). */
export interface AdImpression {
  format: AdFormat;
  /** Плейсмент из карты 06 §6.2: 'RW1'…'RW6', 'INT1'. */
  placement: string;
  /** Выручка этого показа, $. */
  revenueUsd: number;
  /** eCPM показа, $/1000 — для события ad_impression (09 §9.1). */
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
   * это completed:false.
   */
  showRewarded(placement: string): Promise<RewardedResult>;

  /** Показ interstitial. Promise резолвится после закрытия; отказ → shown:false. */
  showInterstitial(placement: string): Promise<InterstitialResult>;

  /**
   * Колбэк КАЖДОГО состоявшегося показа — учёт выручки в слое монетизации.
   * Подписчик один: MonetizeController.
   */
  onImpression: ((imp: AdImpression) => void) | null;
}
