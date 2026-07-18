/**
 * MaxAdProvider — типизированный СКЕЛЕТ прод-провайдера AppLovin MAX (06 §6, §8).
 *
 * ⚠️ В веб-сборке НЕ используется (фабрика src/ads/index.ts по умолчанию берёт
 * SimAdProvider). Файл компилируется strict-TS и фиксирует прод-контракт:
 * когда появится Capacitor-обвязка, реализация ложится в эти методы без
 * изменения вызывающего кода (MonetizeController говорит только с AdProvider).
 *
 * ПЛАН ИНТЕГРАЦИИ (прод-сборка, 10 §2):
 *  1. Плагин: официальный AppLovin MAX плагин для Capacitor/Cordova
 *     (fallback-план 06 §6 — AdMob Mediation, если MAX-плагин покажет
 *     критические баги в WebView).
 *  2. Ключи: SDK_KEY AppLovin + ad unit id на формат/платформу (rewarded,
 *     interstitial, banner × iOS/Android) — из конфига сборки, не из кода.
 *  3. Сети-бидеры v1: AppLovin Exchange, AdMob, Mintegral, Unity Ads, Liftoff
 *     (адаптеры ставятся вместе с плагином).
 *  4. Consent-флоу ДО init: ATT (iOS) + UMP/GDPR — без него сети режут eCPM.
 *  5. Ретраи загрузки: exponential backoff (2^n сек, cap 64) на onAdLoadFailed.
 *  6. onImpression ← событие OnAdRevenuePaid (impression-level revenue API):
 *     формат, плейсмент, revenue, network → в Adjust/AppsFlyer + BI (09 §1).
 */
import type { AdImpression, AdProvider, InterstitialResult, RewardedResult } from './provider';

/** Сообщение-заглушка: методы скелета не должны вызываться в веб-сборке. */
const NOT_WIRED =
  'MaxAdProvider: реальный SDK не подключён. Веб-сборка использует SimAdProvider ' +
  '(фабрика src/ads/index.ts); интеграция MAX — задача прод-сборки (06 §6, 10 §2).';

export class MaxAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;

  async init(): Promise<void> {
    // TODO(prod): await AppLovinMAX.initialize(SDK_KEY);
    // TODO(prod): AppLovinMAX.setHasUserConsent(...) после consent-флоу (шаг 4);
    // TODO(prod): прелоад rewarded + interstitial юнитов (loadRewardedAd/loadInterstitial);
    // TODO(prod): подписка на OnAdRevenuePaid → this.onImpression?.({ ... }).
    throw new Error(NOT_WIRED);
  }

  isRewardedReady(_placement: string): boolean {
    // TODO(prod): return AppLovinMAX.isRewardedAdReady(REWARDED_AD_UNIT_ID);
    return false;
  }

  async showRewarded(_placement: string): Promise<RewardedResult> {
    // TODO(prod): AppLovinMAX.showRewardedAd(REWARDED_AD_UNIT_ID, placement);
    // TODO(prod): completed = пришёл onRewardedAdReceivedReward до onRewardedAdHidden;
    // TODO(prod): revenueUsd — из OnAdRevenuePaid этого показа (сшивка по creativeId).
    throw new Error(NOT_WIRED);
  }

  async showInterstitial(_placement: string): Promise<InterstitialResult> {
    // TODO(prod): if (!AppLovinMAX.isInterstitialReady(id)) return { shown:false, revenueUsd:0 };
    // TODO(prod): AppLovinMAX.showInterstitial(id, placement); резолв на onInterstitialHidden.
    throw new Error(NOT_WIRED);
  }

  showBanner(): void {
    // TODO(prod): AppLovinMAX.createBanner(BANNER_AD_UNIT_ID, 'bottom_center');
    // TODO(prod): AppLovinMAX.showBanner(BANNER_AD_UNIT_ID) — adaptive, рефреш 45 c (06 §3.3).
    throw new Error(NOT_WIRED);
  }

  hideBanner(): void {
    // TODO(prod): AppLovinMAX.hideBanner(BANNER_AD_UNIT_ID) — Remove Ads/подписка (06 §5).
    throw new Error(NOT_WIRED);
  }
}
