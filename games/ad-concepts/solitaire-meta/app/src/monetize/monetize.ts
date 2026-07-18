/**
 * MonetizeController — слой монетизации (Проход Е.2, порт window.Monetize из
 * прототипа monetize.js). Решает, КОГДА показывать рекламу (капы 06 §6.3,
 * карта плейсментов 06 §6.2) и что делать с наградой/покупкой; сами показы и
 * платежи — за интерфейсами AdProvider / PurchaseProvider (в проде: AppLovin
 * MAX и StoreKit/Play Billing, здесь — симуляторы).
 *
 * ЧИСТАЯ логика без DOM: UI подписывается на onToast/onChanged; время — только
 * через инжектируемый Clock (капы тестируются детерминированно). Выручка
 * показов приходит impression-колбэком провайдера (прод-схема: OnAdRevenuePaid
 * из MAX) и копится в счётчиках сессии и lifetime-сейва.
 *
 * ЗАМОК adInFlight (урок Block Surge): капы проверяются ДО await показа, а
 * флаги/награды ставятся ПОСЛЕ — без замка два конкурентных вызова (двойной
 * тап по кнопке оффера, пока прод-SDK ещё не открыл ролик) оба проходят
 * проверку капа и удваивают награду. Симулятор прикрывает экран оверлеем
 * синхронно, но контракт AdProvider этого не гарантирует — замок обязателен.
 */
import type { AdImpression, AdProvider } from '../ads/provider';
import { GEO_LABELS, GEO_ORDER, ecpmFor, type AdFormat, type GeoTier } from '../ads/ecpm';
import type { Analytics } from '../economy/analytics';
import { ECON } from '../economy/econ';
import type { Economy } from '../economy/economy';
import type { Store } from '../economy/store';
import { DAY_MS, dateStr } from '../meta/dates';
import { systemClock, type Clock } from './clock';
import { MON, PLACEMENTS, RW_ORDER, findIap, type IapSku, type PlacementId } from './config';
import type { PurchaseProvider } from './purchase';
import type { MonetizeStore } from './store';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function bump(obj: Record<string, number>, key: string): void {
  obj[key] = (obj[key] ?? 0) + 1;
}

function addRev(obj: Record<string, number>, key: string, v: number): void {
  obj[key] = (obj[key] ?? 0) + v;
}

function sumVals(obj: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(obj)) s += obj[k];
  return s;
}

function sumRW(map: Record<string, number>): number {
  let s = 0;
  for (const pid of RW_ORDER) s += map[pid] ?? 0;
  return s;
}

/** Счётчики ТЕКУЩЕЙ СЕССИИ (порт freshSession прототипа 1:1). */
export interface MonetizeSessionStats {
  adRevenue: number;
  iapRevenue: number;
  imps: Record<string, number>;
  rev: Record<string, number>;
  offers: Record<string, number>;
  opps: Record<string, number>;
  /** Причина блокировки → сколько раз (аудит правил 06 §6.3). */
  blocks: Record<string, number>;
  started: number;
  completed: number;
  failed: number;
  purchases: number;
  ecpmSum: Record<AdFormat, number>;
  ecpmN: Record<AdFormat, number>;
  lastIntTs: number;
  intSession: number;
  levelsSinceInt: number;
  lastRewardedCloseTs: number;
  startTs: number;
}

function freshSession(startTs: number): MonetizeSessionStats {
  return {
    adRevenue: 0,
    iapRevenue: 0,
    imps: {},
    rev: {},
    offers: {},
    opps: {},
    blocks: {},
    started: 0,
    completed: 0,
    failed: 0,
    purchases: 0,
    ecpmSum: { rewarded: 0, interstitial: 0 },
    ecpmN: { rewarded: 0, interstitial: 0 },
    lastIntTs: 0,
    intSession: 0,
    levelsSinceInt: 99,
    lastRewardedCloseTs: 0,
    startTs
  };
}

/** Сводка для дашборда (порт getStats прототипа 1:1). */
export interface MonetizeStats {
  adRev: number;
  iapRev: number;
  blended: number;
  rewardedImps: number;
  intImps: number;
  totalImps: number;
  rewardedRev: number;
  intRev: number;
  adShare: number;
  rewardedRevShare: number;
  ecpmRw: number;
  ecpmInt: number;
  opps: number;
  offers: number;
  started: number;
  completed: number;
  failed: number;
  blocks: Record<string, number>;
  imps: Record<string, number>;
  rev: Record<string, number>;
  purchases: number;
  payer: boolean;
  arppu: number;
  minutes: number;
  geo: GeoTier;
  event: boolean;
  removeAds: boolean;
  sub: boolean;
  subMonth: number;
  piggy: { owned: boolean; balance: number };
  life: {
    adRevenue: number;
    iapRevenue: number;
    imps: Record<string, number>;
    rev: Record<string, number>;
    purchases: Record<string, number>;
  };
}

export interface MonetizeDeps {
  monStore: MonetizeStore;
  /** Store меты: simDayOffset («Новый день (тест)») сбрасывает и капы рекламы. */
  metaStore: Store;
  economy: Economy;
  analytics: Analytics;
  adProvider: AdProvider;
  purchaseProvider: PurchaseProvider;
  /** Инжектируемые часы; по умолчанию — системные. */
  clock?: Clock;
  /** RNG наград (колесо RW4, выбор бустера RW3); по умолчанию Math.random. */
  rng?: () => number;
}

export class MonetizeController {
  /** Подписка UI: всплывающее сообщение. */
  onToast: ((msg: string) => void) | null = null;
  /** Подписка UI: состояние монетизации изменилось (перерисовать экраны). */
  onChanged: (() => void) | null = null;
  /** Гео сменилось (main.ts прокидывает в SimAdProvider.setGeo). */
  onGeoChanged: ((tier: GeoTier) => void) | null = null;

  private readonly clock: Clock;
  private readonly rng: () => number;
  private session: MonetizeSessionStats;

  /**
   * Показ рекламы уже идёт — замок против гонки check-then-act
   * (см. шапку файла). Второй конкурентный вызов сразу получает false.
   */
  private adInFlight = false;

  constructor(private readonly deps: MonetizeDeps) {
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.session = freshSession(this.clock.now());
    // Единственный подписчик impression-событий провайдера — учёт выручки.
    deps.adProvider.onImpression = (imp) => this.onAdImpression(imp);
    // Порт init() прототипа: фиксация «даты установки», актуализация дня,
    // дневной грант подписчику.
    const st = this.deps.monStore.state;
    if (st.installTs === 0) {
      st.installTs = this.clock.now();
      this.deps.monStore.save();
    }
    this.refreshDaily();
    this.grantClubDailyIfDue();
  }

  /* ============================ УТИЛИТЫ ============================ */

  private toast(msg: string): void {
    this.onToast?.(msg);
  }

  private changed(): void {
    this.onChanged?.();
  }

  /** Текущее время слоя (для дашборда — «время сессии»). */
  nowRawMs(): number {
    return this.clock.now();
  }

  private simOffset(): number {
    return this.deps.metaStore.state.stats.simDayOffset || 0;
  }

  /** «Сейчас» с учётом кнопки «Новый день (тест)» (порт nowMs прототипа). */
  private nowMs(): number {
    return this.clock.now() + this.simOffset() * DAY_MS;
  }

  private today(): string {
    return dateStr(this.nowMs());
  }

  /** Смена даты → сброс дневных счётчиков капов (порт refreshDaily). */
  refreshDaily(): void {
    const t = this.today();
    const st = this.deps.monStore.state;
    if (st.daily.date !== t) {
      st.daily = { date: t, int: 0, rw: {} };
      this.deps.monStore.save();
    }
  }

  /* ============================ ГЕО / ИВЕНТ ============================ */

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

  /** Бенчмарк eCPM формата в текущем гео (для шапок дашборда). */
  ecpmFor(format: AdFormat): number {
    return ecpmFor(format, this.getGeo());
  }

  setEvent(on: boolean): void {
    this.deps.monStore.state.eventWeekend = on === true;
    this.deps.monStore.save();
    this.changed();
  }

  isEventWeekend(): boolean {
    return this.deps.monStore.state.eventWeekend;
  }

  /* ========================= УЧЁТ ПОКАЗОВ ========================== */

  /** Impression-колбэк провайдера (порт bookImpression 1:1). */
  private onAdImpression(imp: AdImpression): void {
    const st = this.deps.monStore.state;
    this.session.adRevenue += imp.revenueUsd;
    bump(this.session.imps, imp.placement);
    addRev(this.session.rev, imp.placement, imp.revenueUsd);
    this.session.ecpmSum[imp.format] += imp.ecpmUsd;
    this.session.ecpmN[imp.format] += 1;
    st.life.adRevenue += imp.revenueUsd;
    bump(st.life.imps, imp.placement);
    addRev(st.life.rev, imp.placement, imp.revenueUsd);
    this.deps.monStore.save();
    this.deps.analytics.track('ad_impression', {
      placement_id: imp.placement,
      format: imp.format,
      network: 'sim',
      ecpm_usd: round2(imp.ecpmUsd)
    });
  }

  private trackOpportunity(pid: PlacementId, eligible: boolean, reason: string | null): void {
    bump(this.session.opps, pid);
    if (!eligible) bump(this.session.blocks, reason ?? '?');
    const params: Record<string, string | number | boolean> = {
      placement_id: pid,
      eligible
    };
    if (reason !== null) params.block_reason = reason;
    this.deps.analytics.track('ad_opportunity', params);
  }

  /* ========================= REWARDED (06 §6.2) ==================== */

  rwUsedToday(pid: PlacementId): number {
    this.refreshDaily();
    return this.deps.monStore.state.daily.rw[pid] ?? 0;
  }

  private bumpDaily(pid: PlacementId): void {
    this.refreshDaily();
    const rw = this.deps.monStore.state.daily.rw;
    rw[pid] = (rw[pid] ?? 0) + 1;
    this.deps.monStore.save();
  }

  /** Разрешён ли rewarded по дневному капу/условиям (RW1/RW2 — по уровню в UI). */
  rewardedAllowed(pid: PlacementId): boolean {
    if (pid === 'RW1' || pid === 'RW2') return true;
    if (pid === 'RW5' && !this.isEventWeekend()) return false;
    const cap = MON.RW_DAILY_CAP[pid];
    if (cap === undefined) return true;
    return this.rwUsedToday(pid) < cap;
  }

  /**
   * Базовый показ rewarded (порт showRewarded): проверка капа → оффер →
   * показ → onReward при досмотре. true — награда выдана. Капы проверяются
   * ДО await, награда/флаги — ПОСЛЕ; конкурентный второй вызов гасится
   * замком adInFlight (см. шапку файла).
   */
  async showRewarded(pid: PlacementId, onReward?: () => void): Promise<boolean> {
    if (this.adInFlight) return false;
    if (!this.rewardedAllowed(pid)) {
      this.trackOpportunity(pid, false, 'cap');
      this.toast('Лимит этой награды на сегодня исчерпан');
      return false;
    }
    this.trackOpportunity(pid, true, null);
    this.adInFlight = true;
    bump(this.session.offers, pid);
    this.deps.analytics.track('ad_offer_shown', { placement_id: pid });
    this.session.started++;
    this.deps.analytics.track('ad_started', { placement_id: pid, network: 'sim' });
    let completed = false;
    let ecpmUsd = 0;
    try {
      const res = await this.deps.adProvider.showRewarded(pid);
      completed = res.completed;
      ecpmUsd = res.ecpmUsd;
    } finally {
      this.adInFlight = false;
    }
    if (!completed) {
      this.session.failed++;
      this.deps.analytics.track('ad_failed', { placement_id: pid, network: 'sim' });
      this.changed();
      return false;
    }
    this.session.completed++;
    this.deps.analytics.track('ad_completed', {
      placement_id: pid,
      network: 'sim',
      ecpm_usd: round2(ecpmUsd)
    });
    this.session.lastRewardedCloseTs = this.clock.now(); // усталость-rw (06 §6.3.6)
    if (MON.RW_DAILY_CAP[pid] !== undefined) this.bumpDaily(pid);
    onReward?.();
    this.changed();
    return true;
  }

  /* --- Самодостаточные rewarded-действия (награда внутри контроллера) --- */

  /** RW6 «Кошелёк садовода»: грант 0.8·E(n), округление до 10. */
  walletGrant(): number {
    const n = this.deps.economy.getLevel();
    return Math.round((MON.RW6_GRANT_FACTOR * this.deps.economy.entryCost(n)) / 10) * 10;
  }

  async rwWallet(): Promise<boolean> {
    const grant = this.walletGrant();
    return this.showRewarded('RW6', () => {
      this.deps.economy.addCoins(grant, 'rw6');
      this.toast('Кошелёк садовода: +' + grant + ' 💰');
    });
  }

  /** RW3 «Бустер до уровня»: бесплатный джокер или лукошко. */
  async rwBooster(): Promise<boolean> {
    return this.showRewarded('RW3', () => {
      const list = MON.RW3_BOOSTERS;
      const id = list[Math.floor(this.rng() * list.length)];
      const def = ECON.BOOSTERS[id];
      this.deps.economy.addBooster(id, 1, 'rw3');
      this.toast('Бустер за рекламу: +1 ' + def.emoji + ' ' + def.name);
    });
  }

  /** RW4 «Колесо ярмарки»: случайный сектор монет. */
  async rwWheel(): Promise<boolean> {
    return this.showRewarded('RW4', () => {
      const wheel = MON.RW4_WHEEL;
      const v = wheel[Math.floor(this.rng() * wheel.length)];
      this.deps.economy.addCoins(v, 'rw4_wheel');
      this.toast('🎡 Колесо ярмарки: +' + v + ' 💰');
    });
  }

  /** RW5 «×2 жетоны ярмарки» (ивент пт–вс). */
  async rwEventTokens(): Promise<boolean> {
    return this.showRewarded('RW5', () => {
      this.deps.economy.addCoins(MON.RW5_TOKENS_COINS, 'rw5_tokens');
      this.toast('×2 жетоны ярмарки: +' + MON.RW5_TOKENS_COINS + ' 💰');
    });
  }

  /* ======================= INTERSTITIAL (06 §6.3) ==================== */

  private installAgeOk(): boolean {
    if (this.simOffset() >= 1) return true; // «Новый день (тест)» снимает гейт дня 1
    const st = this.deps.monStore.state;
    return st.installTs > 0 && this.clock.now() - st.installTs >= MON.INT_INSTALL_AGE_H * 3600000;
  }

  private payerRestActive(): boolean {
    const p = this.deps.monStore.state.payer;
    return p.lastPurchaseTs > 0 && this.clock.now() - p.lastPurchaseTs < MON.PAYER_REST_H * 3600000;
  }

  /**
   * Причина, по которой INT1 показывать НЕЛЬЗЯ (или null — можно).
   * Порядок проверок и строки причин 1:1 с прототипом (видны в дашборде).
   */
  interstitialBlockReason(): string | null {
    const st = this.deps.monStore.state;
    const s = this.session;
    if (st.removeAds) return 'remove_ads'; // §6.3.7
    if (st.sub.active) return 'subscriber'; // §6.3.7
    const lvl = this.deps.economy.getLevel();
    if (lvl < MON.INT_START_LEVEL) return 'уровень<' + MON.INT_START_LEVEL; // §6.3.1
    if (!this.installAgeOk()) return 'установка<24ч'; // §6.3.1
    if (s.levelsSinceInt < MON.INT_MIN_LEVELS) return 'уровней<' + MON.INT_MIN_LEVELS; // §6.3.2
    if (s.lastIntTs > 0 && (this.clock.now() - s.lastIntTs) / 1000 < MON.INT_MIN_INTERVAL_S) {
      return 'интервал<180c'; // §6.3.2
    }
    this.refreshDaily();
    if (st.daily.int >= MON.INT_DAILY_CAP) return 'дн.кап'; // §6.3.3
    if (s.intSession >= MON.INT_SESSION_CAP) return 'сессия-кап'; // §6.3.3
    if (
      s.lastRewardedCloseTs > 0 &&
      (this.clock.now() - s.lastRewardedCloseTs) / 1000 < MON.REWARDED_FATIGUE_S
    ) {
      return 'усталость-rw'; // §6.3.6
    }
    if (this.payerRestActive()) return 'покой-плательщика'; // §6.3.7
    return null;
  }

  /**
   * INT1 на возврате к саду после победы (06 §6.2). Тихо пропускается при
   * любом нарушении правил §6.3 — onDone вызывается в любом случае.
   */
  async maybeInterstitial(onDone?: () => void): Promise<boolean> {
    if (this.adInFlight) {
      onDone?.();
      return false;
    }
    const reason = this.interstitialBlockReason();
    if (reason !== null) {
      this.trackOpportunity('INT1', false, reason);
      onDone?.();
      return false;
    }
    this.adInFlight = true;
    let shown = false;
    let noFill: string | null = null;
    let ecpmUsd = 0;
    try {
      const res = await this.deps.adProvider.showInterstitial('INT1');
      shown = res.shown;
      noFill = res.noFillReason ?? null;
      ecpmUsd = res.ecpmUsd;
    } finally {
      this.adInFlight = false;
    }
    if (!shown && noFill === 'eCPM-floor') {
      // §6.3.8: ставка ниже floor — «возможность» была, показ не выгоден.
      this.trackOpportunity('INT1', false, 'eCPM-floor');
      this.changed();
      onDone?.();
      return false;
    }
    this.trackOpportunity('INT1', true, null);
    bump(this.session.offers, 'INT1');
    this.deps.analytics.track('ad_offer_shown', { placement_id: 'INT1' });
    this.session.started++;
    this.deps.analytics.track('ad_started', { placement_id: 'INT1', network: 'sim' });
    if (!shown) {
      this.session.failed++;
      this.deps.analytics.track('ad_failed', { placement_id: 'INT1', network: 'sim' });
      this.changed();
      onDone?.();
      return false;
    }
    this.session.completed++;
    this.deps.analytics.track('ad_completed', {
      placement_id: 'INT1',
      network: 'sim',
      ecpm_usd: round2(ecpmUsd)
    });
    this.session.lastIntTs = this.clock.now();
    this.session.intSession++;
    this.session.levelsSinceInt = 0;
    this.refreshDaily();
    this.deps.monStore.state.daily.int++;
    this.deps.monStore.save();
    this.changed();
    onDone?.();
    return true;
  }

  /* ==================== IAP / ПОДПИСКА (06 §6.4/§6.5) ==================== */

  private applyGrant(item: IapSku): void {
    const st = this.deps.monStore.state;
    if (item.coins !== undefined) this.deps.economy.addCoins(item.coins, 'iap');
    if (item.joker !== undefined) this.deps.economy.addBooster('joker', item.joker, 'iap');
    if (item.basket !== undefined) this.deps.economy.addBooster('basket', item.basket, 'iap');
    if (item.card !== undefined) {
      this.deps.metaStore.state.garden.cards += item.card;
      this.deps.metaStore.save();
    }
    if (item.kind === 'remove_ads') {
      st.removeAds = true;
      this.deps.analytics.track('remove_ads_purchased', {});
    }
    if (item.kind === 'sub') {
      st.sub.active = true;
      st.sub.monthNo = st.sub.monthNo + 1;
      st.sub.startTs = this.clock.now();
      this.deps.analytics.track('sub_state', {
        state: st.sub.monthNo > 1 ? 'renew' : 'start',
        month_no: st.sub.monthNo
      });
      this.grantClubDailyIfDue();
    }
    if (item.kind === 'piggy') st.piggy.owned = true;
  }

  /**
   * СИМУЛЯЦИЯ покупки: провайдер подтверждает мгновенно, без денег/биллинга.
   * Товар выдаётся, выручка идёт в модель, плательщик помечается
   * (окно покоя §6.3.7). true — покупка прошла.
   */
  async buyIAP(sku: string): Promise<boolean> {
    const item = findIap(sku);
    if (item === null) return false;
    const st = this.deps.monStore.state;
    if (item.once === true && (st.life.purchases[sku] ?? 0) > 0) {
      this.toast('Набор уже куплен (разовый)');
      return false;
    }
    if (item.kind === 'remove_ads' && st.removeAds) {
      this.toast('Реклама уже убрана');
      return false;
    }
    if (item.kind === 'piggy' && st.piggy.owned) {
      this.toast('Копилка уже активна');
      return false;
    }

    const firstNow = !st.payer.first;
    this.deps.analytics.track('iap_initiated', {
      sku,
      price_usd: item.price,
      is_first_purchase: firstNow
    });
    const res = await this.deps.purchaseProvider.buy(sku);
    if (!res.ok) return false;

    this.applyGrant(item);
    this.session.iapRevenue += item.price;
    this.session.purchases++;
    st.life.iapRevenue += item.price;
    bump(st.life.purchases, sku);
    st.payer.first = true;
    st.payer.lastPurchaseTs = this.clock.now();
    this.deps.analytics.track('iap_success', {
      sku,
      price_usd: item.price,
      is_first_purchase: firstNow
    });
    this.deps.monStore.save();
    this.toast('СИМУЛЯЦИЯ покупки: ' + item.label + ' ($' + item.price.toFixed(2) + ')');
    this.changed();
    return true;
  }

  cancelSub(): void {
    const st = this.deps.monStore.state;
    if (!st.sub.active) return;
    st.sub.active = false; // §6.5: декор остаётся, бонусы на паузу
    this.deps.analytics.track('sub_state', { state: 'cancel', month_no: st.sub.monthNo });
    this.deps.monStore.save();
    this.toast('Подписка отменена (декор сохранён)');
    this.changed();
  }

  /** 500 монет/день подписчику «Клуба садовода» (06 §6.5), 1 раз в день. */
  grantClubDailyIfDue(): void {
    const st = this.deps.monStore.state;
    if (!st.sub.active) return;
    const t = this.today();
    if (st.club.lastGrantDate === t) return;
    this.deps.economy.addCoins(MON.CLUB_DAILY_COINS, 'club');
    st.club.lastGrantDate = t;
    this.deps.monStore.save();
  }

  /** Вскрытие копилки (от PIGGY_UNLOCK монет). true — монеты выданы. */
  piggyBreak(): boolean {
    const st = this.deps.monStore.state;
    if (!st.piggy.owned || st.piggy.balance < MON.PIGGY_UNLOCK) return false;
    const amt = Math.round(st.piggy.balance);
    this.deps.economy.addCoins(amt, 'piggy');
    st.piggy.balance = 0;
    this.deps.monStore.save();
    this.toast('Копилка вскрыта: +' + amt + ' 💰');
    this.changed();
    return true;
  }

  /* ============================ ХУКИ ИЗ ЯДРА ============================ */

  /** Копилка копит 5% выигрышей монет (06 §6.4). */
  onCoinsWon(amount: number): void {
    const st = this.deps.monStore.state;
    if (!st.piggy.owned || st.piggy.balance >= MON.PIGGY_CAP) return;
    const add = Math.round(Math.max(0, amount) * MON.PIGGY_RATE);
    if (add <= 0) return;
    st.piggy.balance = Math.min(MON.PIGGY_CAP, st.piggy.balance + add);
    this.deps.monStore.save();
    this.changed();
  }

  /** Счётчик уровней для правила «≥ 2 уровня между INT» (06 §6.3.2). */
  onLevelFinished(): void {
    this.session.levelsSinceInt++;
  }

  /** Подписка «Клуб садовода»: +50% урожая (06 §6.5). */
  harvestMultiplier(): number {
    return this.deps.monStore.state.sub.active ? 1 + MON.CLUB_HARVEST_BONUS : 1;
  }

  isAdsRemoved(): boolean {
    return this.deps.monStore.state.removeAds;
  }

  isSubscriber(): boolean {
    return this.deps.monStore.state.sub.active;
  }

  /**
   * RW6 «Кошелёк садовода» — контекстная кнопка: видна, только когда баланс
   * < 2·E(n) (06 §6.2 «нужда») и дневной кап не исчерпан (порт updateBarButtons).
   */
  walletOfferVisible(): boolean {
    const n = this.deps.economy.getLevel();
    const need = this.deps.economy.getCoins() < 2 * this.deps.economy.entryCost(n);
    return need && this.rewardedAllowed('RW6');
  }

  /** Открытие магазина: актуализировать день и дневной грант подписки. */
  onShopOpened(): void {
    this.refreshDaily();
    this.grantClubDailyIfDue();
    this.deps.analytics.track('shop_open', { source: 'button' });
  }

  /* ==================== СТАТИСТИКА ДЛЯ ДАШБОРДА ==================== */

  getStats(): MonetizeStats {
    const s = this.session;
    const st = this.deps.monStore.state;
    const total = s.adRevenue + s.iapRevenue;
    const rwImps = sumRW(s.imps);
    const intImps = s.imps.INT1 ?? 0;
    const rwRev = sumRW(s.rev);
    const intRev = s.rev.INT1 ?? 0;
    return {
      adRev: s.adRevenue,
      iapRev: s.iapRevenue,
      blended: total,
      rewardedImps: rwImps,
      intImps,
      totalImps: rwImps + intImps,
      rewardedRev: rwRev,
      intRev,
      adShare: total > 0 ? s.adRevenue / total : 0,
      rewardedRevShare: s.adRevenue > 0 ? rwRev / s.adRevenue : 0,
      ecpmRw: s.ecpmN.rewarded > 0 ? s.ecpmSum.rewarded / s.ecpmN.rewarded : 0,
      ecpmInt: s.ecpmN.interstitial > 0 ? s.ecpmSum.interstitial / s.ecpmN.interstitial : 0,
      opps: sumVals(s.opps),
      offers: sumVals(s.offers),
      started: s.started,
      completed: s.completed,
      failed: s.failed,
      blocks: s.blocks,
      imps: s.imps,
      rev: s.rev,
      purchases: s.purchases,
      payer: st.payer.first,
      arppu: s.purchases > 0 ? s.iapRevenue : 0,
      minutes: (this.clock.now() - s.startTs) / 60000,
      geo: st.geoTier,
      event: st.eventWeekend,
      removeAds: st.removeAds,
      sub: st.sub.active,
      subMonth: st.sub.monthNo,
      piggy: { owned: st.piggy.owned, balance: st.piggy.balance },
      life: st.life
    };
  }

  getSession(): MonetizeSessionStats {
    return this.session;
  }

  getState() {
    return this.deps.monStore.state;
  }

  /** Имя плейсмента для таблиц дашборда/полки. */
  placementName(pid: PlacementId): string {
    return PLACEMENTS[pid].name;
  }

  placementDesc(pid: PlacementId): string {
    return PLACEMENTS[pid].desc;
  }

  /** «Сброс KPI» в дашборде: новая «сессия-DAU». */
  resetSession(): void {
    this.session = freshSession(this.clock.now());
    this.changed();
  }
}
