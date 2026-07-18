/**
 * MaxAdProvider — типизированный СКЕЛЕТ прод-провайдера AppLovin MAX (06 §6.8).
 *
 * ⚠️ В веб-сборке НЕ используется (фабрика src/ads/index.ts по умолчанию берёт
 * SimAdProvider). Файл компилируется strict-TS и фиксирует прод-контракт:
 * когда появится Capacitor-обвязка, реализация ложится в эти методы без
 * изменения вызывающего кода (MonetizeController говорит только с AdProvider).
 *
 * ПЛАН ИНТЕГРАЦИИ (когда дойдём до прод-сборки, 10 §2):
 *  1. Плагин: официальный AppLovin MAX плагин для Capacitor/Cordova
 *     (fallback-план 06 §6.8 — AdMob Mediation, если MAX-плагин покажет
 *     критические баги в WebView).
 *  2. Ключи: SDK_KEY AppLovin + ad unit id на формат/платформу (rewarded,
 *     interstitial × iOS/Android) — из конфига сборки, не из кода.
 *  3. Сети-бидеры v1: AppLovin Exchange, AdMob, Mintegral, Unity Ads, Liftoff.
 *  4. Consent-флоу ДО init: ATT (iOS) + UMP/GDPR — без него сети режут eCPM.
 *  5. eCPM-floor запроса (06 §6.3 п.8) настраивается в MAX-дашборде; дешёвый
 *     показ приходит как no-fill → InterstitialResult.noFillReason.
 *  6. onImpression ← событие OnAdRevenuePaid (impression-level revenue API):
 *     формат, плейсмент, revenue, network → в Adjust/AppsFlyer + BI (09 §9.7).
 */
import type { AdImpression, AdProvider, InterstitialResult, RewardedResult } from './provider';

/** Сообщение-заглушка: методы скелета не должны вызываться в веб-сборке. */
const NOT_WIRED =
  'MaxAdProvider: реальный SDK не подключён. Веб-сборка использует SimAdProvider ' +
  '(фабрика src/ads/index.ts); интеграция MAX — задача прод-сборки (06 §6.8, 10 §2).';

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
    // TODO(prod): revenueUsd/ecpmUsd — из OnAdRevenuePaid этого показа.
    throw new Error(NOT_WIRED);
  }

  async showInterstitial(_placement: string): Promise<InterstitialResult> {
    // TODO(prod): if (!AppLovinMAX.isInterstitialReady(id))
    //             return { shown:false, revenueUsd:0, ecpmUsd:0, noFillReason:'no_fill' };
    // TODO(prod): AppLovinMAX.showInterstitial(id, placement); резолв на onInterstitialHidden.
    throw new Error(NOT_WIRED);
  }
}
