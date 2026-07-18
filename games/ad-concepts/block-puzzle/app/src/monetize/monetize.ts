/**
 * MonetizeController — слой монетизации (Проход Е.2, порт window.Monetize из
 * прототипа monetize.js). Решает, КОГДА показывать рекламу (капы 06 §3, карта
 * плейсментов 06 §2) и что делать с наградой/покупкой; сами показы и платежи —
 * за интерфейсами AdProvider / PurchaseProvider (в проде: AppLovin MAX и
 * StoreKit/Play Billing, здесь — симуляторы).
 *
 * ЧИСТАЯ логика: ни Phaser, ни DOM. UI подписывается на onToast/onChanged;
 * время — только через инжектируемый Clock (капы тестируются детерминированно).
 * Выручка показов приходит impression-колбэком провайдера (прод-схема:
 * OnAdRevenuePaid из MAX) и копится в счётчиках сессии и lifetime-сейва.
 *
 * Модель дашборда: «сессия = 1 симулированный DAU за день» — счётчики показов
 * сессии читаются как impressions/DAU, ad-выручка сессии ≈ ad ARPDAU (09 §4).
 */
import type {
  AdFormat,
  AdImpression,
  AdProvider,
  InterstitialResult,
  RewardedResult
} from '../ads/provider';
import { GEO_LABELS, GEO_ORDER, ecpmFor, type GeoTier } from '../ads/ecpm';
import type { Analytics } from '../economy/analytics';
import type { Economy } from '../economy/economy';
import type { Store } from '../economy/store';
import type { GameState } from '../core/types';
import type { BoosterId } from '../economy/econ';
import { ymd } from '../meta/dates';
import { t } from '../i18n';
import { systemClock, type Clock } from './clock';
import { MONETIZE, SUB_DAILY_COINS, findSku, type IapSku } from './config';
import { InterstitialPolicy, type IntBlockReason } from './interstitial';
import type { PurchaseProvider } from './purchase';
import { reviveBoard } from './revive';
import type { MonetizeStore } from './store';

/** Счётчики ТЕКУЩЕЙ СЕССИИ (сброс при перезагрузке/кнопке дашборда). */
export interface MonetizeSessionStats {
  startedAt: number;
  imp: Record<AdFormat, number>;
  revByFormat: Record<AdFormat, number>;
  adRev: number;
  iapRev: number;
  iapCount: number;
  offers: { shown: number; accepted: number };
  /** Недопоказы interstitial из-за капов (09 §2.3 ad_capped). */
  intCapped: number;
  lastCapRule: string;
}

function freshSession(startedAt: number): MonetizeSessionStats {
  return {
    startedAt,
    imp: { int: 0, rw: 0, banner: 0 },
    revByFormat: { int: 0, rw: 0, banner: 0 },
    adRev: 0,
    iapRev: 0,
    iapCount: 0,
    offers: { shown: 0, accepted: 0 },
    intCapped: 0,
    lastCapRule: ''
  };
}

export interface MonetizeDeps {
  monStore: MonetizeStore;
  /** Store меты: gamesPlayed (FTUE/частотный кап) + simOffset («Новый день (тест)»). */
  metaStore: Store;
  economy: Economy;
  analytics: Analytics;
  adProvider: AdProvider;
  purchaseProvider: PurchaseProvider;
  /** Инжектируемые часы; по умолчанию — системные. */
  clock?: Clock;
}

export class MonetizeController {
  /** Подписка UI: всплывающее сообщение. */
  onToast: ((msg: string) => void) | null = null;
  /** Подписка UI: состояние монетизации изменилось (перерисовать экраны). */
  onChanged: (() => void) | null = null;
  /** Гео сменилось (main.ts прокидывает в SimAdProvider.setGeo). */
  onGeoChanged: ((tier: GeoTier) => void) | null = null;

  private readonly clock: Clock;
  private readonly policy: InterstitialPolicy;
  private session: MonetizeSessionStats;

  /* Пер-партийные флаги rewarded (сброс при старте новой партии). */
  private revivedThisGame = false;
  private rw2UsedThisGame = false;

  /**
   * Показ рекламы уже идёт. Капы проверяются ДО await показа, а флаги
   * ставятся ПОСЛЕ — без этого замка два конкурентных вызова (двойной тап по
   * кнопке оффера, пока прод-SDK ещё не открыл ролик) оба проходят проверку
   * капа и удваивают награду. Симулятор прикрывает канвас оверлеем синхронно,
   * но контракт AdProvider этого не гарантирует — замок обязателен.
   */
  private adInFlight = false;

  /* Экран итога (канвас) виден — баннер под ним не «крутится» (порт
   * mainScreenActive; DOM-оверлеи проверяет предикат в main.ts). */
  private resultOverlayVisible = false;

  constructor(private readonly deps: MonetizeDeps) {
    this.clock = deps.clock ?? systemClock;
    this.session = freshSession(this.clock.now());
    this.policy = new InterstitialPolicy({
      clock: this.clock,
      gamesPlayed: () => this.deps.metaStore.state.stats.gamesPlayed,
      adsRemoved: () => this.adsRemoved(),
      dayIntShown: () => this.deps.monStore.state.day.int
    });
    // Единственный подписчик impression-событий провайдера — учёт выручки.
    deps.adProvider.onImpression = (imp) => this.onAdImpression(imp);
    this.ensureDay();
    this.grantDailyPerks(false);
  }

  /* ============================ УТИЛИТЫ ============================ */

  private toast(msg: string): void {
    this.onToast?.(msg);
  }

  private changed(): void {
    this.onChanged?.();
  }

  /** Текущее время слоя (для дашборда — «время сессии»). */
  nowMs(): number {
    return this.clock.now();
  }

  /**
   * «Сегодня» с учётом тестового сдвига дней Прохода Б (кнопка «Новый день
   * (тест)») — так «новый день» сбрасывает и дневные капы рекламы.
   */
  private today(): string {
    const off = this.deps.metaStore.state.meta.simOffset || 0;
    const d = new Date(this.clock.now());
    d.setDate(d.getDate() + off);
    return ymd(d);
  }

  /** Смена даты → сброс дневных счётчиков капов. */
  ensureDay(): void {
    const t = this.today();
    const s = this.deps.monStore.state;
    if (s.day.date !== t) {
      s.day = { date: t, int: 0, rw2: 0, rw3: 0, rw4: 0 };
      this.deps.monStore.save();
    }
  }

  /** Remove Ads / подписка: INT + BAN отключены, rewarded остаётся (06 §3.8). */
  adsRemoved(): boolean {
    const s = this.deps.monStore.state;
    return s.removeAds || s.subscription.active;
  }

  /* ============================ ГЕО / eCPM ========================= */

  getGeo(): GeoTier {
    return this.deps.monStore.state.geoTier;
  }

  setGeo(tier: GeoTier): void {
    if (GEO_ORDER.indexOf(tier) === -1) return;
    this.deps.monStore.state.geoTier = tier;
    this.deps.monStore.save();
    this.onGeoChanged?.(tier);
    this.changed();
  }

  geoLabel(): string {
    return GEO_LABELS[this.getGeo()];
  }

  /** Бенчмарк eCPM формата в текущем гео (для дашборда/шапок). */
  ecpmFor(format: AdFormat): number {
    return ecpmFor(format, this.getGeo());
  }

  /* ========================= УЧЁТ ПОКАЗОВ ========================== */

  /** Impression-колбэк провайдера: выручка показа → сессия + lifetime + событие. */
  private onAdImpression(imp: AdImpression): void {
    const s = this.deps.monStore.state;
    this.session.imp[imp.format]++;
    this.session.revByFormat[imp.format] += imp.revenueUsd;
    this.session.adRev += imp.revenueUsd;
    s.lifetime.imp[imp.format]++;
    s.lifetime.adRev += imp.revenueUsd;
    this.deps.monStore.save();
    this.deps.analytics.track('ad_impression', {
      format: imp.format,
      placement: imp.placement,
      network: 'applovin_max',
      ecpm: imp.ecpmUsd,
      watched_pct: 100
    });
    this.changed();
  }

  /* ======================= INTERSTITIAL (06 §3) ==================== */

  /**
   * Interstitial INT-2 на рестарте с экрана итога. Показывает, если ни один
   * кап не блокирует; недопоказ по «настоящему» капу — событие ad_capped
   * с причиной (FTUE/no-ads — не диагностика, а норма). true — показ был.
   */
  async showInterstitialIfAllowed(): Promise<boolean> {
    if (this.adInFlight) return false; // повторный вход во время показа — не кап
    this.ensureDay();
    const reason = this.policy.blockReason();
    if (reason === null) {
      this.adInFlight = true;
      let res: InterstitialResult;
      try {
        res = await this.deps.adProvider.showInterstitial('INT-2');
      } finally {
        this.adInFlight = false;
      }
      if (res.shown) {
        this.policy.noteShown();
        this.deps.monStore.state.day.int++;
        this.deps.monStore.save();
        this.toast(t('mon.toast.intCounted', { rev: res.revenueUsd.toFixed(4) }));
        this.changed();
      }
      return res.shown;
    }
    if (reason !== 'ftue_games' && reason !== 'ftue_time' && reason !== 'remove_ads') {
      this.session.intCapped++;
      this.session.lastCapRule = reason;
      this.deps.analytics.track('ad_capped', { placement: 'INT-2', cap_rule: reason });
      this.changed();
    }
    return false;
  }

  /** Причина блокировки interstitial сейчас (для отладки/тестов). */
  interstitialBlockReason(): IntBlockReason | null {
    this.ensureDay();
    return this.policy.blockReason();
  }

  /* ========================= REWARDED (06 §2.2) ==================== */

  /**
   * Общий прогон rewarded: оффер принят → показ → (досмотрел) награда.
   * Возвращает true, если награда выдана. Замок adInFlight гасит конкурентный
   * второй вызов (двойной тап до открытия ролика) — капы «1/партию» и «N/день»
   * проверяются вызывающими ДО await и без замка сработали бы дважды.
   */
  private async playRewarded(placement: string, onReward: () => void): Promise<boolean> {
    if (this.adInFlight) return false;
    this.adInFlight = true;
    this.session.offers.accepted++;
    this.deps.analytics.track('ad_offer', { placement, shown: true, accepted: true });
    let res: RewardedResult;
    try {
      res = await this.deps.adProvider.showRewarded(placement);
    } finally {
      this.adInFlight = false;
    }
    if (!res.completed) {
      this.changed();
      return false;
    }
    this.policy.noteRewarded(); // 60 c льготы от interstitial (06 §3.4)
    onReward();
    this.changed();
    return true;
  }

  /* --- RW-1 «Второй шанс» (1/партию) --- */

  canRevive(): boolean {
    return !this.revivedThisGame;
  }

  /**
   * RW-1 на экране итога: досмотрел → освобождаем 2 строки + 2 столбца и
   * продолжаем ТУ ЖЕ партию. Награды конца партии не дублируются: Meta
   * начисляет дельтой (повторный onGameEnd добирает только прирост).
   */
  async offerRevive(state: GameState): Promise<boolean> {
    if (!state.gameOver) {
      this.toast(t('mon.toast.gameRunning'));
      return false;
    }
    if (!this.canRevive()) {
      this.toast(t('mon.toast.reviveUsed'));
      return false;
    }
    return this.playRewarded('RW-1', () => {
      reviveBoard(state);
      this.revivedThisGame = true;
      this.toast(t('mon.toast.revived'));
    });
  }

  /* --- RW-2 «×2 монеты за партию» (1/партию, 3/день) --- */

  canDoubleCoins(): boolean {
    this.ensureDay();
    const day = this.deps.monStore.state.day;
    return (
      !this.rw2UsedThisGame &&
      day.rw2 < MONETIZE.RW.RW2_DAILY_CAP &&
      this.deps.economy.getEarnedThisGame() > 0
    );
  }

  /** Возвращает бонус монет (0 — награды не было). */
  async offerDoubleCoins(): Promise<number> {
    this.ensureDay();
    const day = this.deps.monStore.state.day;
    if (this.rw2UsedThisGame || day.rw2 >= MONETIZE.RW.RW2_DAILY_CAP) {
      this.toast(t('mon.toast.rw2Limit'));
      return 0;
    }
    const earned = this.deps.economy.getEarnedThisGame();
    let bonus = 0;
    await this.playRewarded('RW-2', () => {
      bonus = earned > 0 ? earned : 20; // подстраховка, если партия без монет
      this.deps.economy.addCoins(bonus, 'rw2', false);
      this.rw2UsedThisGame = true;
      day.rw2++;
      this.deps.monStore.save();
      this.toast(t('mon.toast.rw2Done', { bonus }));
    });
    return bonus;
  }

  /* --- RW-3 «Бесплатный бустер» (Молот, 2/день) --- */

  canFreeBooster(): boolean {
    this.ensureDay();
    return this.deps.monStore.state.day.rw3 < MONETIZE.RW.RW3_DAILY_CAP;
  }

  async offerFreeBooster(): Promise<boolean> {
    if (!this.canFreeBooster()) {
      this.toast(t('mon.toast.rw3Limit'));
      return false;
    }
    return this.playRewarded('RW-3', () => {
      this.deps.economy.addBooster('hammer', 1, 'rw');
      this.deps.monStore.state.day.rw3++;
      this.deps.monStore.save();
      this.toast(t('mon.toast.rw3Done'));
    });
  }

  /* --- RW-4 «×2 награда дня» (+100🪙, 2/день) --- */

  canDoubleStreak(): boolean {
    this.ensureDay();
    return this.deps.monStore.state.day.rw4 < MONETIZE.RW.RW4_DAILY_CAP;
  }

  async offerDoubleStreak(): Promise<boolean> {
    if (!this.canDoubleStreak()) {
      this.toast(t('mon.toast.rw4Limit'));
      return false;
    }
    return this.playRewarded('RW-4', () => {
      this.deps.economy.addCoins(MONETIZE.RW.RW4_BONUS_COINS, 'rw', false);
      this.deps.monStore.state.day.rw4++;
      this.deps.monStore.save();
      this.toast(t('mon.toast.rw4Done', { bonus: MONETIZE.RW.RW4_BONUS_COINS }));
    });
  }

  /* --- Воронка офферов (09 §3): «показан» при появлении экрана --- */

  /** Экран итога показан: офферы RW-1 + RW-2 видны. */
  noteGameOverOffersShown(): void {
    this.session.offers.shown += 2;
    this.deps.analytics.track('ad_offer', { placement: 'RW-1', shown: true });
    this.deps.analytics.track('ad_offer', { placement: 'RW-2', shown: true });
    this.changed();
  }

  /** Мета-экран показан: офферы RW-3 + RW-4 видны. */
  noteMetaOffersShown(): void {
    this.session.offers.shown += 2;
    this.changed();
  }

  /** Строка статуса rewarded для мета-экрана (порт updateMetaAdStatus). */
  metaAdStatusLine(): string {
    this.ensureDay();
    const d = this.deps.monStore.state.day;
    return (
      t('mon.status.rewarded', {
        rw3: d.rw3,
        rw3cap: MONETIZE.RW.RW3_DAILY_CAP,
        rw4: d.rw4,
        rw4cap: MONETIZE.RW.RW4_DAILY_CAP
      }) + (this.adsRemoved() ? t('mon.status.noAds') : '')
    );
  }

  /* ============================ ПАРТИЯ ============================= */

  /** Рестарт партии: пер-партийные флаги rewarded снова доступны. */
  onNewGame(): void {
    this.revivedThisGame = false;
    this.rw2UsedThisGame = false;
  }

  /** Экран итога (в канвасе) виден — для паузы баннера под ним. */
  setResultOverlayVisible(visible: boolean): void {
    this.resultOverlayVisible = visible;
  }

  isResultOverlayVisible(): boolean {
    return this.resultOverlayVisible;
  }

  /* ============================ БАННЕР ============================= */

  /** Синхронизировать баннер с состоянием no-ads (вызвать на старте и после IAP). */
  updateBanner(): void {
    if (this.adsRemoved()) this.deps.adProvider.hideBanner();
    else this.deps.adProvider.showBanner();
  }

  /* ============================= IAP (06 §5) ======================= */

  /** SKU уже «куплен навсегда» (Remove Ads / подписка); паки покупаются повторно. */
  isSkuOwned(sku: IapSku): boolean {
    const s = this.deps.monStore.state;
    if (sku.grant.removeAds) return s.removeAds;
    if (sku.grant.subscription) return s.subscription.active;
    return false;
  }

  private setRemoveAds(on: boolean): void {
    this.deps.monStore.state.removeAds = on;
    this.deps.monStore.save();
    this.deps.analytics.track('remove_ads_state', { on });
    this.updateBanner();
  }

  private setSubscription(on: boolean): void {
    const sub = this.deps.monStore.state.subscription;
    sub.active = on;
    if (on && sub.since === '') sub.since = this.today();
    this.deps.monStore.save();
    this.deps.analytics.track('subscription_event', { type: on ? 'start' : 'cancel' });
    this.updateBanner();
  }

  /**
   * Покупка SKU: провайдер подтверждает (в проде — после валидации чека),
   * контроллер выдаёт товар по grant'у. true — покупка прошла.
   */
  async purchase(id: string): Promise<boolean> {
    const sku = findSku(id);
    if (!sku) return false;
    this.deps.analytics.track('iap_initiated', { sku: id, price_usd: sku.price });
    const res = await this.deps.purchaseProvider.buy(id);
    if (!res.ok) return false;

    const s = this.deps.monStore.state;
    const g = sku.grant;
    if (g.coins) this.deps.economy.addCoins(g.coins, 'iap', false);
    if (g.boosters) {
      for (const k of Object.keys(g.boosters) as BoosterId[]) {
        const n = g.boosters[k];
        if (n) this.deps.economy.addBooster(k, n, 'iap');
      }
    }
    if (g.removeAds) this.setRemoveAds(true);
    if (g.subscription) {
      this.setSubscription(true);
      this.grantDailyPerks(true);
    }
    if (g.skin && s.skins.indexOf(g.skin) === -1) s.skins.push(g.skin);
    if (g.frame) s.frame = true;
    if (g.pass) s.pass = true;

    this.session.iapRev += sku.price;
    this.session.iapCount++;
    s.lifetime.iapRev += sku.price;
    s.lifetime.iapCount++;
    this.policy.noteIap(); // льгота от interstitial (06 §3.6)
    this.deps.monStore.save();

    this.deps.analytics.track('iap_completed', { sku: id, price_usd: sku.price });
    this.toast(t('mon.toast.purchased', { title: t(sku.titleKey), price: sku.price.toFixed(2) }));
    this.updateBanner();
    this.changed();
    return true;
  }

  /** Подписка: +200 монет/день (06 §5). Выдаём при покупке и в новый день. */
  grantDailyPerks(force: boolean): void {
    const sub = this.deps.monStore.state.subscription;
    if (!sub.active) return;
    const t = this.today();
    if (!force && sub.lastDaily === t) return;
    sub.lastDaily = t;
    this.deps.monStore.save();
    this.deps.economy.addCoins(SUB_DAILY_COINS, 'subscription', false);
    this.deps.analytics.track('subscription_event', { type: 'daily_grant' });
  }

  /** Открытие магазина: актуализировать день и дневные перки подписки. */
  onShopOpened(): void {
    this.ensureDay();
    this.grantDailyPerks(false);
  }

  /* ========================= ДАННЫЕ ДЛЯ UI ========================= */

  getSession(): MonetizeSessionStats {
    return this.session;
  }

  getState() {
    return this.deps.monStore.state;
  }

  getTargets() {
    return MONETIZE.TARGETS;
  }

  /** «Сбросить счётчики» в дашборде: новая «сессия-DAU». */
  resetSession(): void {
    this.session = freshSession(this.clock.now());
    this.changed();
  }
}
