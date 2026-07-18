/**
 * MonetizeController — слой монетизации WordGrove (Проход Е.2, порт
 * window.Monetize из прототипа monetize.js). Решает, КОГДА показывать рекламу
 * (капы 06 §4, карта плейсментов 06 §3) и что делать с наградой/покупкой;
 * сами показы и платежи — за интерфейсами AdProvider / PurchaseProvider
 * (в проде: AppLovin MAX и StoreKit/Play Billing, здесь — симуляторы).
 *
 * ЧИСТАЯ логика: ни Phaser, ни DOM. UI подписывается на onToast/onChanged;
 * время — только через инжектируемый Clock (капы тестируются детерминированно);
 * ядро — за мостом MonetizeBridge (порт связки window.WG). Выручка показов
 * приходит impression-колбэком провайдера (прод-схема: OnAdRevenuePaid из MAX)
 * и копится в счётчиках сессии и lifetime-сейва.
 *
 * Урок Block Surge: капы rewarded проверяются ДО await показа, а флаги
 * ставятся ПОСЛЕ — без замка adInFlight два конкурентных вызова (двойной тап
 * по кнопке оффера, пока прод-SDK ещё не открыл ролик) оба проходят проверку
 * капа и удваивают награду. Все промис-цепочки вызывающих закрываются .catch
 * или `void` с обработкой внутри — незакрытых reject нет.
 *
 * Модель дашборда: «сессия = 1 симулированный DAU за день» — счётчики показов
 * сессии читаются как impressions/DAU, ad-выручка сессии ≈ ad ARPDAU (09 §3).
 */
import type { AdFormat, AdImpression, AdProvider, RewardedResult } from '../ads/provider';
import { GEO_LABELS, GEO_ORDER, ecpmFor, type GeoTier } from '../ads/ecpm';
import type { Analytics } from '../economy/analytics';
import type { Economy } from '../economy/economy';
import { t } from '../i18n';
import { planLabel, skuTitle } from '../i18n/labels';
import { parseDate, todayStr } from '../meta/dates';
import { systemClock, type Clock } from './clock';
import { MONETIZE, findSku, type IapSku, type SubPlan } from './config';
import { InterstitialPolicy, type IntBlockReason } from './interstitial';
import type { PurchaseProvider } from './purchase';
import type { MonetizeStore } from './store';

/** Мост к ядру и UI-рендеру (порт связки window.WG из прототипа). */
export interface MonetizeBridge {
  /** Прогресс кампании (FTUE-гейты interstitial/баннера, ключ уровня RV-1). */
  getCampaignLevel(): number;
  /** Сейчас дневной кроссворд (INT/BAN выключены, свои капы RV-1). */
  isDailyMode(): boolean;
  getCoins(): number;
  /** Начислить монеты через ядро (владелец монет — CoreGame). */
  addCoins(n: number, source?: string): void;
  /**
   * Открыть случайную букву БЕСПЛАТНО (RV-1 / клубный безлимит) — с рендером
   * на стороне UI. false — открывать нечего (уровень почти решён).
   */
  revealFreeLetter(): boolean;
}

/** Счётчики ТЕКУЩЕЙ СЕССИИ (сброс при перезагрузке/кнопке дашборда). */
export interface MonetizeSessionStats {
  startedAt: number;
  imp: Record<AdFormat, number>;
  revByFormat: Record<AdFormat, number>;
  adRev: number;
  iapRev: number;
  subRev: number;
  iapCount: number;
  offers: { shown: number; accepted: number };
  /** Недопоказы interstitial из-за капов (09 §1.3 ad_capped). */
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
    subRev: 0,
    iapCount: 0,
    offers: { shown: 0, accepted: 0 },
    intCapped: 0,
    lastCapRule: ''
  };
}

export interface MonetizeDeps {
  monStore: MonetizeStore;
  economy: Economy;
  analytics: Analytics;
  bridge: MonetizeBridge;
  adProvider: AdProvider;
  purchaseProvider: PurchaseProvider;
  /** Инжектируемые часы; по умолчанию — системные. */
  clock?: Clock;
}

/** Итог открытия копилки через RV-5. */
export interface PiggyOpenResult {
  /** Монет конвертировано (0 — копилка пуста или ролик не досмотрен). */
  coins: number;
  /** Открыто через rewarded (false — бесплатное открытие подписчика/Remove Ads). */
  viaAd: boolean;
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

  /** Ключ уровня, на котором использовали RV-1 (1/уровень, порт rv1LastKey). */
  private rv1LastKey = '';
  /** Ключ уровня, на котором взяли RV-2 «×2 монеты» (кнопка одноразовая). */
  private rv2LastKey = '';

  /**
   * Показ рекламы уже идёт. Капы проверяются ДО await показа, а флаги
   * ставятся ПОСЛЕ — без этого замка два конкурентных вызова оба проходят
   * проверку капа и удваивают награду. Симулятор прикрывает экран оверлеем
   * синхронно, но контракт AdProvider этого не гарантирует — замок обязателен.
   */
  private adInFlight = false;

  constructor(private readonly deps: MonetizeDeps) {
    this.clock = deps.clock ?? systemClock;
    this.session = freshSession(this.clock.now());
    this.policy = new InterstitialPolicy({
      clock: this.clock,
      adsRemoved: () => this.adsRemoved(),
      isDaily: () => this.deps.bridge.isDailyMode(),
      campaignLevel: () => this.deps.bridge.getCampaignLevel(),
      dayIntShown: () => this.deps.monStore.state.day.int
    });
    // Единственный подписчик impression-событий провайдера — учёт выручки.
    deps.adProvider.onImpression = (imp) => this.onAdImpression(imp);
    this.ensureDay();
  }

  /* ============================ УТИЛИТЫ ============================ */

  private toast(msg: string): void {
    this.onToast?.(msg);
  }

  private changed(): void {
    this.onChanged?.();
  }

  private track(event: string, params?: Record<string, string | number | boolean>): void {
    this.deps.analytics.track(event, params);
  }

  /** Текущее время слоя (для дашборда — «время сессии»). */
  nowMs(): number {
    return this.clock.now();
  }

  /** «Сегодня» по инжектируемым часам ('YYYY-MM-DD'). */
  private today(): string {
    return todayStr(new Date(this.clock.now()));
  }

  /** Смена даты → сброс дневных капов + проверка конца триала подписки. */
  ensureDay(): void {
    const t = this.today();
    const s = this.deps.monStore.state;
    if (s.day.date !== t) {
      s.day = { date: t, int: 0, rv1: 0, rv6: 0 };
      this.deps.monStore.save();
    }
    this.maybeConvertTrial();
  }

  /** Ключ уровня для капов «1/уровень» (порт levelKey). */
  private levelKey(): string {
    return this.deps.bridge.isDailyMode()
      ? 'daily:' + this.today()
      : 'c' + this.deps.bridge.getCampaignLevel();
  }

  /** Remove Ads / подписка: INT + BAN отключены, rewarded остаётся (06 §5.2). */
  adsRemoved(): boolean {
    const s = this.deps.monStore.state;
    return s.removeAds || s.subscription.active;
  }

  subscribed(): boolean {
    return this.deps.monStore.state.subscription.active;
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

  /* ==================== МОНЕТЫ С КЛУБНЫМ БОНУСОМ =================== */

  /** +20% монет со всех НАГРАД для подписчиков (06 §5.1, перк 5). */
  private rewardCoins(base: number): number {
    return this.subscribed() ? Math.round(base * (1 + MONETIZE.SUB.coinBonusPct)) : Math.round(base);
  }

  /** Начислить награду слоя монетизации (RV-2 и т.п.) с клубным бонусом. */
  private grantCoins(base: number, source: string): number {
    const n = this.rewardCoins(base);
    this.deps.bridge.addCoins(n, source);
    return n;
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
    this.track('ad_revenue', {
      format: imp.format,
      placement: imp.placement,
      network: 'applovin_max',
      ecpm_cents: Math.round(imp.ecpmUsd * 100),
      geo: s.geoTier
    });
    this.changed();
  }

  /* ======================= INTERSTITIAL I-1 (06 §4) ================= */

  /**
   * Interstitial I-1 перед переходом «Дальше ▶». Показывает, если ни один
   * кап не блокирует; недопоказ по «настоящему» капу — событие ad_capped
   * с причиной (FTUE/no-ads/daily — не диагностика, а норма, 1:1 с прототипом).
   * true — показ был.
   */
  async maybeShowInterstitial(): Promise<boolean> {
    if (this.adInFlight) return false; // повторный вход во время показа — не кап
    this.ensureDay();
    const reason = this.policy.blockReason();
    if (reason === null) {
      this.adInFlight = true;
      this.track('ad_offer', { placement: 'I-1' });
      let revenueUsd = 0;
      try {
        const res = await this.deps.adProvider.showInterstitial('I-1');
        if (!res.shown) return false;
        revenueUsd = res.revenueUsd;
      } finally {
        this.adInFlight = false;
      }
      this.policy.noteShown();
      this.ensureDay();
      this.deps.monStore.state.day.int++;
      this.deps.monStore.save();
      this.toast(t('mon.intCounted', { rev: revenueUsd.toFixed(4) }));
      this.changed();
      return true;
    }
    // Диагностика недопоказа (09 §1.3 знаменатель) — только «настоящие» капы.
    if (reason !== 'ftue_level' && reason !== 'remove_ads' && reason !== 'daily') {
      this.session.intCapped++;
      this.session.lastCapRule = reason;
      this.track('ad_capped', { placement: 'I-1', cap_rule: reason });
      this.changed();
    }
    return false;
  }

  /** Причина блокировки interstitial сейчас (для отладки/тестов). */
  interstitialBlockReason(): IntBlockReason | null {
    this.ensureDay();
    return this.policy.blockReason();
  }

  /* ========================== REWARDED (06 §3.1) ====================== */

  /**
   * Общий прогон rewarded: оффер принят → показ → (досмотрел) награда.
   * Возвращает true, если награда выдана. Замок adInFlight гасит конкурентный
   * второй вызов (двойной тап до открытия ролика) — капы «1/уровень» и
   * «N/день» проверяются вызывающими ДО await и без замка сработали бы дважды.
   */
  private async playRewarded(placement: string, onReward: () => void): Promise<boolean> {
    if (this.adInFlight) return false;
    this.adInFlight = true;
    this.session.offers.accepted++;
    this.track('ad_offer', { placement });
    this.track('ad_start', { placement, network: 'applovin_max' });
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
    this.policy.noteRewarded(); // 30 c льготы от interstitial (06 §4 п.4)
    this.track('ad_complete', { placement });
    onReward();
    this.changed();
    return true;
  }

  /* --- RV-1 «Бесплатная Лампа»: буква за просмотр (1/уровень, ≤4/день) --- */

  rv1Available(): boolean {
    this.ensureDay();
    const day = this.deps.monStore.state.day;
    if (this.deps.bridge.isDailyMode()) return day.rv1 < MONETIZE.RW.RV1_DAILY_CAP;
    return day.rv1 < MONETIZE.RW.RV1_DAILY_CAP && this.rv1LastKey !== this.levelKey();
  }

  async offerFreeLamp(): Promise<boolean> {
    this.ensureDay();
    const day = this.deps.monStore.state.day;
    if (day.rv1 >= MONETIZE.RW.RV1_DAILY_CAP) {
      this.toast(t('mon.rv1LimitDay', { n: MONETIZE.RW.RV1_DAILY_CAP }));
      return false;
    }
    if (!this.deps.bridge.isDailyMode() && this.rv1LastKey === this.levelKey()) {
      this.toast(t('mon.rv1PerLevel'));
      return false;
    }
    // RV-1: показ оффера = момент клика по кнопке (нет отдельной карточки).
    this.session.offers.shown++;
    return this.playRewarded('RV-1', () => {
      const ok = this.deps.bridge.revealFreeLetter();
      if (ok) {
        this.ensureDay();
        this.deps.monStore.state.day.rv1++;
        this.rv1LastKey = this.levelKey();
        this.deps.monStore.save();
        this.track('hint_use', { type: 'lamp', source: 'rv' });
        this.toast(t('mon.rv1Done'));
      } else {
        this.toast(t('mon.nothingToReveal'));
      }
    });
  }

  /* --- RV-2 «×2 монеты за уровень» на оверлее победы --- */

  /** Кнопка RV-2 вставлена в оверлей победы — оффер показан (воронка 09 §1.3). */
  noteRv2Shown(): void {
    this.session.offers.shown++;
    this.track('ad_offer', { placement: 'RV-2' });
    this.changed();
  }

  /** Возвращает бонус монет (0 — награды не было). ×2 = +ещё reward, с клубным +20%. */
  async offerDoubleCoins(reward: number): Promise<number> {
    if (this.rv2LastKey === this.levelKey()) return 0; // кнопка одноразовая
    let extra = 0;
    await this.playRewarded('RV-2', () => {
      extra = this.grantCoins(reward, 'rv2');
      this.rv2LastKey = this.levelKey();
      this.toast(t('mon.rv2Done', { n: extra }));
    });
    return extra;
  }

  /* --- RV-5 «Открыть копилку» (гейт открытия копилки меты) --- */

  /**
   * Открытие копилки: подписка/Remove Ads — бесплатно («Автооткрытие копилки»,
   * 06 §5.1 перк 4); иначе — rewarded RV-5, конвертация после досмотра.
   */
  async openPiggy(): Promise<PiggyOpenResult> {
    if (this.adsRemoved()) {
      return { coins: this.deps.economy.openPiggy(), viaAd: false };
    }
    const acorns = this.deps.economy.getAcorns();
    if (acorns <= 0) return { coins: 0, viaAd: false }; // пусто — нечего открывать
    // RV-5: показ оффера = клик по копилке (нет отдельной карточки).
    this.session.offers.shown++;
    let coins = 0;
    await this.playRewarded('RV-5', () => {
      coins = this.deps.economy.openPiggy();
    });
    return { coins, viaAd: true };
  }

  /* --- RV-6 «Продолжить серию» (заморозка стрика) в магазине --- */

  rv6Available(): boolean {
    this.ensureDay();
    return this.deps.monStore.state.day.rv6 < MONETIZE.RW.RV6_DAILY_CAP;
  }

  async offerFreezeStreak(): Promise<boolean> {
    this.ensureDay();
    if (this.deps.monStore.state.day.rv6 >= MONETIZE.RW.RV6_DAILY_CAP) {
      this.toast(t('mon.rv6Limit'));
      return false;
    }
    return this.playRewarded('RV-6', () => {
      const s = this.deps.monStore.state;
      s.freezeTokens++;
      this.ensureDay();
      s.day.rv6++;
      this.deps.monStore.save();
      this.track('streak_saved', { save_source: 'rv' });
      this.toast(t('mon.rv6Done'));
    });
  }

  /** Магазин открыт: RV-6 виден на полке (воронка) + актуализация дня. */
  noteShopOpened(): void {
    this.ensureDay();
    this.session.offers.shown++;
    this.changed();
  }

  /* ============================ БАННЕР B-1 (06 §3.3) ================= */

  /**
   * Баннер разрешён капами (без учёта DOM-оверлеев — их проверяет предикат
   * bannerActive в main.ts): не при no-ads, не на дневном, с уровня 2.
   */
  bannerAllowed(): boolean {
    if (this.adsRemoved()) return false;
    if (this.deps.bridge.isDailyMode()) return false;
    if (this.deps.bridge.getCampaignLevel() < MONETIZE.BANNER.MIN_LEVEL_INDEX) return false;
    return true;
  }

  /** Синхронизировать баннер с состоянием (старты, смена уровня, покупки). */
  updateBanner(): void {
    if (this.bannerAllowed()) this.deps.adProvider.showBanner();
    else this.deps.adProvider.hideBanner();
  }

  /* ==================== ПОДПИСКА WordGrove Club (06 §5.1) ============ */

  /**
   * Оформить подписку. asTrial=true — 7 дней бесплатно (выручка 0 до
   * конверсии); иначе сразу платная. Net-выручка списывается амортизированно
   * за день («ценность одного дня подписчика»), чтобы дашборд не искажался
   * ламповой суммой (1:1 с прототипом).
   */
  async subscribe(plan: SubPlan, asTrial: boolean): Promise<boolean> {
    const p = plan === 'yearly' ? MONETIZE.SUB.yearly : MONETIZE.SUB.monthly;
    if (!asTrial) {
      const res = await this.deps.purchaseProvider.buy(p.id);
      if (!res.ok) return false;
    }
    const s = this.deps.monStore.state;
    s.subscription.active = true;
    s.subscription.plan = plan;
    s.subscription.trial = asTrial;
    if (s.subscription.since === '') s.subscription.since = this.today();
    this.deps.monStore.save();
    if (asTrial) {
      this.track('trial_start', { plan, price_tier: p.price });
      this.toast(t('mon.trialStarted'));
    } else {
      this.track('sub_convert', { plan, price_tier: p.price });
      this.bookSubDay(plan);
      this.toast(t('mon.subStarted', { plan: planLabel(plan) }));
    }
    this.updateBanner();
    this.changed();
    return true;
  }

  /** Амортизированный net за день = цена·(1−стор)/дней плана (06 §8.3). */
  private bookSubDay(plan: SubPlan): void {
    const p = plan === 'yearly' ? MONETIZE.SUB.yearly : MONETIZE.SUB.monthly;
    const net = (p.price * (1 - MONETIZE.SUB.storeCut)) / p.days;
    const s = this.deps.monStore.state;
    this.session.subRev += net;
    s.lifetime.subRev += net;
    s.subscription.lastDaily = this.today();
    this.deps.monStore.save();
  }

  /**
   * Конец триала (7 дней с since) → конверсия в платную: trial=false,
   * событие sub_convert, первый амортизированный день выручки. Вызывается из
   * ensureDay — дата двигается инжектируемыми часами (детерминизм в тестах).
   */
  private maybeConvertTrial(): void {
    const sub = this.deps.monStore.state.subscription;
    if (!sub.active || !sub.trial) return;
    const since = parseDate(sub.since);
    if (since === null) return;
    const now = parseDate(this.today());
    if (now === null) return;
    const daysPassed = Math.floor((now.getTime() - since.getTime()) / 86400000);
    if (daysPassed < MONETIZE.SUB.trialDays) return;
    const plan: SubPlan = sub.plan === 'yearly' ? 'yearly' : 'monthly';
    const p = plan === 'yearly' ? MONETIZE.SUB.yearly : MONETIZE.SUB.monthly;
    sub.trial = false;
    this.deps.monStore.save();
    this.track('sub_convert', { plan, price_tier: p.price });
    this.bookSubDay(plan);
    this.toast(t('mon.trialConverted'));
    this.changed();
  }

  cancelSubscription(): void {
    const s = this.deps.monStore.state;
    s.subscription.active = false;
    s.subscription.trial = false;
    this.deps.monStore.save();
    this.track('sub_cancel', { plan: s.subscription.plan });
    this.updateBanner();
    this.changed();
    this.toast(t('mon.subCancelled'));
  }

  /* ==================== REMOVE ADS / ПОЛКА IAP (06 §5.2–5.3) ========= */

  async buyRemoveAds(): Promise<boolean> {
    const s = this.deps.monStore.state;
    if (s.removeAds) {
      this.toast(t('mon.removeAdsOwned'));
      return false;
    }
    const res = await this.deps.purchaseProvider.buy(MONETIZE.REMOVE_ADS.id);
    if (!res.ok) return false;
    s.removeAds = true;
    const price = MONETIZE.REMOVE_ADS.price;
    this.session.iapRev += price;
    this.session.iapCount++;
    s.lifetime.iapRev += price;
    s.lifetime.iapCount++;
    this.deps.monStore.save();
    this.track('remove_ads_purchase', { price_usd: price });
    this.track('iap_purchase', {
      sku: MONETIZE.REMOVE_ADS.id,
      price_usd: price,
      is_first_purchase: s.lifetime.iapCount === 1
    });
    this.toast(t('mon.removeAdsDone', { price: price.toFixed(2) }));
    this.updateBanner();
    this.changed();
    return true;
  }

  /** SKU полки монет: покупка через провайдера + выдача 1:1 с прототипом. */
  async purchaseIap(id: string): Promise<boolean> {
    const sku = findSku(id);
    if (!sku) return false;
    const s = this.deps.monStore.state;
    if (sku.once === true && sku.id === 'coins_starter' && s.starterBought) {
      this.toast(t('mon.starterOnce'));
      return false;
    }
    const res = await this.deps.purchaseProvider.buy(id);
    if (!res.ok) return false;

    this.track('iap_purchase', {
      sku: id,
      price_usd: sku.price,
      is_first_purchase: s.lifetime.iapCount === 0
    });
    if (sku.coins > 0) this.deps.bridge.addCoins(sku.coins, 'iap');
    const cosmetic = sku.cosmetic;
    if (cosmetic !== undefined) {
      if (cosmetic.skin !== undefined && s.skins.indexOf(cosmetic.skin) === -1) s.skins.push(cosmetic.skin);
      if (cosmetic.frame === true) s.frame = true;
      if (cosmetic.badge === true) s.badge = true;
    }
    if (sku.id === 'coins_starter') s.starterBought = true;

    this.session.iapRev += sku.price;
    this.session.iapCount++;
    s.lifetime.iapRev += sku.price;
    s.lifetime.iapCount++;
    this.deps.monStore.save();
    this.toast(t('mon.iapDone', { title: skuTitle(sku), coins: sku.coins, price: sku.price.toFixed(2) }));
    this.changed();
    return true;
  }

  isSkuOwned(sku: IapSku): boolean {
    return sku.id === 'coins_starter' && this.deps.monStore.state.starterBought;
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

  getCoins(): number {
    return this.deps.bridge.getCoins();
  }

  /** «Сбросить счётчики» в дашборде: новая «сессия-DAU». */
  resetSession(): void {
    this.session = freshSession(this.clock.now());
    this.changed();
  }
}
