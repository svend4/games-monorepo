/**
 * Тесты слоя монетизации (Проход Е.2) — чистая логика без Phaser/DOM.
 * Проверяются: капы interstitial I-1 06 §4 (каждое правило, время — через
 * инжектируемый Clock), rewarded-капы 06 §3.1 (RV-1/RV-2/RV-5/RV-6) +
 * reward-once при гонке (замок adInFlight — урок Block Surge), подписка
 * WordGrove Club (триал → активна по календарю, перки, отмена), Remove Ads,
 * полка 7 SKU 1:1, eCPM-модель, санитайзинг сейва wordgrove.monetize.v1
 * (фикстура прототипа подхватывается без миграции) и фабрика провайдеров.
 */
import { describe, expect, it } from 'vitest';
import type { AdImpression, AdProvider, InterstitialResult, RewardedResult } from '../src/ads/provider';
import { ECPM, ecpmFor, genRevenue } from '../src/ads/ecpm';
import { SimAdProvider } from '../src/ads/simProvider';
import { MaxAdProvider } from '../src/ads/maxProvider.stub';
import { createAdProvider, resolveAdProviderKind } from '../src/ads/index';
import type { KeyValueStorage } from '../src/core/storage';
import { mulberry32 } from '../src/core/rng';
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';
import type { Clock } from '../src/monetize/clock';
import { IAP_SHELF, MONETIZE, findProduct, findSku } from '../src/monetize/config';
import { monetizeDefaults, sanitizeMonetize } from '../src/monetize/save';
import { MonetizeStore } from '../src/monetize/store';
import { MonetizeController, type MonetizeBridge } from '../src/monetize/monetize';
import { SimPurchaseProvider } from '../src/monetize/purchase';

/* ============================ ХЕЛПЕРЫ ============================ */

class MemStorage implements KeyValueStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

/** Управляемые часы: капы interstitial и календарь триала — без реального времени. */
class FakeClock implements Clock {
  /** Старт — фиксированная локальная дата (июль: без сюрпризов DST). */
  t = new Date(2026, 6, 18, 12, 0, 0).getTime();
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceDays(days: number): void {
    this.t += days * 86400000;
  }
}

/** Мост-заглушка вместо связки CoreGame+GridUi. */
class FakeBridge implements MonetizeBridge {
  level = 5;
  daily = false;
  coins = 0;
  revealOk = true;
  revealCount = 0;
  getCampaignLevel(): number {
    return this.level;
  }
  isDailyMode(): boolean {
    return this.daily;
  }
  getCoins(): number {
    return this.coins;
  }
  addCoins(n: number): void {
    this.coins += Math.floor(n);
  }
  revealFreeLetter(): boolean {
    if (!this.revealOk) return false;
    this.revealCount++;
    return true;
  }
}

/** Провайдер-заглушка: показы мгновенны, выручка фиксированная. */
class FakeAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;
  rewardedCompleted = true;
  intShown = 0;
  rwPlacements: string[] = [];
  bannerOn = false;

  async init(): Promise<void> {}

  isRewardedReady(_placement: string): boolean {
    return true;
  }

  async showRewarded(placement: string): Promise<RewardedResult> {
    this.rwPlacements.push(placement);
    if (!this.rewardedCompleted) return { completed: false, revenueUsd: 0 };
    const revenueUsd = 0.013;
    this.onImpression?.({ format: 'rw', placement, revenueUsd, ecpmUsd: 13 });
    return { completed: true, revenueUsd };
  }

  async showInterstitial(placement: string): Promise<InterstitialResult> {
    this.intShown++;
    const revenueUsd = 0.01;
    this.onImpression?.({ format: 'int', placement, revenueUsd, ecpmUsd: 10 });
    return { shown: true, revenueUsd };
  }

  showBanner(): void {
    this.bannerOn = true;
  }

  hideBanner(): void {
    this.bannerOn = false;
  }
}

/** Мир монетизации с in-memory сейвами и замороженными часами. */
function makeWorld(opts: { level?: number; monRaw?: string } = {}) {
  const storage = new MemStorage();
  if (opts.monRaw !== undefined) storage.setItem(MONETIZE.STORAGE_KEY, opts.monRaw);
  const analytics = new Analytics(true);
  const economy = new Economy(storage, analytics);
  const bridge = new FakeBridge();
  bridge.level = opts.level ?? 5;
  economy.coinBridge = bridge; // конвертация копилки 1:1 в монеты моста
  const monStore = new MonetizeStore(storage);
  const clock = new FakeClock();
  const adProvider = new FakeAdProvider();
  const purchaseProvider = new SimPurchaseProvider();
  const monetize = new MonetizeController({
    monStore,
    economy,
    analytics,
    bridge,
    adProvider,
    purchaseProvider,
    clock
  });
  return { storage, analytics, economy, bridge, monStore, clock, adProvider, monetize };
}

/* ===================== КАПЫ INTERSTITIAL I-1 (06 §4) ===================== */

describe('interstitial I-1: капы 06 §4 (инжектируемый Clock)', () => {
  it('FTUE: раньше 3-го уровня показа нет и это НЕ ad_capped', async () => {
    const w = makeWorld({ level: 1 });
    expect(w.monetize.interstitialBlockReason()).toBe('ftue_level');
    expect(await w.monetize.maybeShowInterstitial()).toBe(false);
    expect(w.adProvider.intShown).toBe(0);
    expect(w.monetize.getSession().intCapped).toBe(0); // FTUE — норма, не диагностика
  });

  it('на дневном кроссворде interstitial не показывается (06 §4 п.5)', async () => {
    const w = makeWorld();
    w.bridge.daily = true;
    expect(w.monetize.interstitialBlockReason()).toBe('daily');
    expect(await w.monetize.maybeShowInterstitial()).toBe(false);
    expect(w.monetize.getSession().intCapped).toBe(0);
  });

  it('с 3-го уровня показ идёт: выручка учтена, дневной счётчик растёт', async () => {
    const w = makeWorld();
    expect(w.monetize.interstitialBlockReason()).toBeNull();
    expect(await w.monetize.maybeShowInterstitial()).toBe(true);
    expect(w.adProvider.intShown).toBe(1);
    expect(w.monStore.state.day.int).toBe(1);
    const s = w.monetize.getSession();
    expect(s.imp.int).toBe(1);
    expect(s.adRev).toBeCloseTo(0.01, 6);
    expect(w.monStore.state.lifetime.imp.int).toBe(1);
  });

  it('интервал ≥45 сек между показами (ad_capped: interval)', async () => {
    const w = makeWorld();
    await w.monetize.maybeShowInterstitial();
    w.clock.advance(44999);
    expect(w.monetize.interstitialBlockReason()).toBe('interval');
    expect(await w.monetize.maybeShowInterstitial()).toBe(false);
    const s = w.monetize.getSession();
    expect(s.intCapped).toBe(1);
    expect(s.lastCapRule).toBe('interval');
    expect(w.analytics.tally['ad_capped']).toBe(1);
    w.clock.advance(1);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('≥30 сек после rewarded (пользователь «оплатил» отдых рекламой)', async () => {
    const w = makeWorld();
    await w.monetize.offerFreezeStreak(); // rewarded показан
    expect(w.monetize.interstitialBlockReason()).toBe('after_rw');
    w.clock.advance(29999);
    expect(w.monetize.interstitialBlockReason()).toBe('after_rw');
    w.clock.advance(1);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('дневной кап ≤12 показов — жёсткий (06 §4 п.10)', () => {
    const w = makeWorld();
    w.monetize.ensureDay();
    w.monStore.state.day.int = MONETIZE.INT.SESSION_CAP;
    expect(w.monetize.interstitialBlockReason()).toBe('session_cap');
  });

  it('смена даты сбрасывает дневные счётчики капов', async () => {
    const w = makeWorld();
    await w.monetize.maybeShowInterstitial();
    expect(w.monStore.state.day.int).toBe(1);
    w.clock.advanceDays(1);
    w.monetize.ensureDay();
    expect(w.monStore.state.day.int).toBe(0); // день пересоздан
  });

  it('Remove Ads / подписка выключают interstitial (и это не ad_capped)', async () => {
    const w = makeWorld();
    w.monStore.state.removeAds = true;
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(await w.monetize.maybeShowInterstitial()).toBe(false);
    expect(w.monetize.getSession().intCapped).toBe(0);
  });
});

/* ==================== REWARDED: КАПЫ И REWARD-ONCE ==================== */

describe('rewarded RV-1/RV-2/RV-5/RV-6: капы 06 §3.1', () => {
  it('RV-1 «Бесплатная Лампа»: 1/уровень, ≤4/день', async () => {
    const w = makeWorld();
    expect(w.monetize.rv1Available()).toBe(true);
    expect(await w.monetize.offerFreeLamp()).toBe(true);
    expect(w.bridge.revealCount).toBe(1);
    expect(w.monStore.state.day.rv1).toBe(1);
    // Тот же уровень — второй раз нельзя (показа нет).
    expect(w.monetize.rv1Available()).toBe(false);
    expect(await w.monetize.offerFreeLamp()).toBe(false);
    expect(w.adProvider.rwPlacements).toEqual(['RV-1']);
    // Следующий уровень — можно; дневной кап 4 в сумме.
    w.bridge.level = 6;
    expect(await w.monetize.offerFreeLamp()).toBe(true);
    w.bridge.level = 7;
    expect(await w.monetize.offerFreeLamp()).toBe(true);
    w.bridge.level = 8;
    expect(await w.monetize.offerFreeLamp()).toBe(true);
    expect(w.monStore.state.day.rv1).toBe(4);
    w.bridge.level = 9;
    expect(w.monetize.rv1Available()).toBe(false); // кап дня
    expect(await w.monetize.offerFreeLamp()).toBe(false);
  });

  it('RV-1 в дневном режиме: пер-уровневый замок не мешает, кап только дневной', async () => {
    const w = makeWorld();
    w.bridge.daily = true;
    expect(await w.monetize.offerFreeLamp()).toBe(true);
    expect(await w.monetize.offerFreeLamp()).toBe(true); // тот же «уровень», но дневной
    expect(w.monStore.state.day.rv1).toBe(2);
  });

  it('RV-1: открывать нечего → кап дня НЕ тратится', async () => {
    const w = makeWorld();
    w.bridge.revealOk = false;
    expect(await w.monetize.offerFreeLamp()).toBe(true); // показ был (досмотрен)
    expect(w.monStore.state.day.rv1).toBe(0); // но Лампа не выдана — кап цел
  });

  it('RV-2 «×2 монеты»: +ещё reward, одноразово на уровень', async () => {
    const w = makeWorld();
    expect(await w.monetize.offerDoubleCoins(25)).toBe(25);
    expect(w.bridge.coins).toBe(25);
    expect(await w.monetize.offerDoubleCoins(25)).toBe(0); // кнопка одноразовая
    w.bridge.level = 6; // следующий уровень — снова доступно
    expect(await w.monetize.offerDoubleCoins(20)).toBe(20);
  });

  it('RV-5 «Открыть копилку»: конвертация после досмотра; подписчику — бесплатно', async () => {
    const w = makeWorld();
    w.economy.addAcorns(50);
    const res = await w.monetize.openPiggy();
    expect(res).toEqual({ coins: 50, viaAd: true });
    expect(w.bridge.coins).toBe(50); // конвертация 1:1 через мост
    expect(w.adProvider.rwPlacements).toEqual(['RV-5']);
    // Пустая копилка — рекламу не крутим.
    const empty = await w.monetize.openPiggy();
    expect(empty).toEqual({ coins: 0, viaAd: false });
    expect(w.adProvider.rwPlacements).toHaveLength(1);
    // Подписка: автооткрытие без рекламы (06 §5.1, перк 4).
    await w.monetize.subscribe('monthly', true);
    w.economy.addAcorns(30);
    const sub = await w.monetize.openPiggy();
    expect(sub.viaAd).toBe(false);
    expect(sub.coins).toBe(30);
    expect(w.adProvider.rwPlacements).toHaveLength(1); // показа не было
  });

  it('RV-6 «Заморозка стрика»: 1/день, выдаёт жетон', async () => {
    const w = makeWorld();
    expect(w.monetize.rv6Available()).toBe(true);
    expect(await w.monetize.offerFreezeStreak()).toBe(true);
    expect(w.monStore.state.freezeTokens).toBe(1);
    expect(w.monStore.state.day.rv6).toBe(1);
    expect(await w.monetize.offerFreezeStreak()).toBe(false); // кап дня
    w.clock.advanceDays(1);
    expect(w.monetize.rv6Available()).toBe(true); // новый день
  });

  it('rewarded не досмотрен → награды нет, капы целы', async () => {
    const w = makeWorld();
    w.adProvider.rewardedCompleted = false;
    expect(await w.monetize.offerFreeLamp()).toBe(false);
    expect(w.bridge.revealCount).toBe(0);
    expect(w.monStore.state.day.rv1).toBe(0);
    expect(await w.monetize.offerDoubleCoins(25)).toBe(0);
    expect(w.bridge.coins).toBe(0);
  });

  it('reward-once при гонке: двойной вызов до конца показа — награда одна', async () => {
    // Капы проверяются ДО await показа: без замка adInFlight двойной тап по
    // кнопке оффера (пока прод-SDK ещё не открыл ролик) удваивал бы награду.
    const w = makeWorld();
    const [a, b] = await Promise.all([
      w.monetize.offerDoubleCoins(40),
      w.monetize.offerDoubleCoins(40)
    ]);
    expect(w.bridge.coins).toBe(40); // не +80
    expect([a, b].sort((x, y) => x - y)).toEqual([0, 40]);

    // RV-1: конкурентный вызов — буква открыта один раз, показ один.
    const shownBefore = w.adProvider.rwPlacements.length;
    const [r1, r2] = await Promise.all([w.monetize.offerFreeLamp(), w.monetize.offerFreeLamp()]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect(w.bridge.revealCount).toBe(1);
    expect(w.monStore.state.day.rv1).toBe(1);
    expect(w.adProvider.rwPlacements.length).toBe(shownBefore + 1);
  });

  it('воронка офферов: shown/accepted и выручка rewarded в сессии', async () => {
    const w = makeWorld();
    w.monetize.noteRv2Shown(); // кнопка RV-2 вставлена в оверлей
    w.monetize.noteShopOpened(); // RV-6 виден в магазине
    await w.monetize.offerFreeLamp(); // shown+accepted+показ
    const s = w.monetize.getSession();
    expect(s.offers.shown).toBe(3);
    expect(s.offers.accepted).toBe(1);
    expect(s.imp.rw).toBe(1);
    expect(s.revByFormat.rw).toBeCloseTo(0.013, 6);
  });
});

/* ==================== ПОДПИСКА WordGrove Club (06 §5.1) ==================== */

describe('подписка WordGrove Club: триал, конверсия, перки, отмена', () => {
  it('триал 7 дней: активна сразу, выручки нет до конверсии', async () => {
    const w = makeWorld();
    expect(await w.monetize.subscribe('monthly', true)).toBe(true);
    const sub = w.monStore.state.subscription;
    expect(sub.active).toBe(true);
    expect(sub.trial).toBe(true);
    expect(sub.plan).toBe('monthly');
    expect(sub.since).not.toBe('');
    expect(w.monetize.getSession().subRev).toBe(0);
    expect(w.monStore.state.lifetime.subRev).toBe(0);
    expect(w.analytics.tally['trial_start']).toBe(1);
  });

  it('конец триала (7 календарных дней) → конверсия: sub_convert + net/день', async () => {
    const w = makeWorld();
    await w.monetize.subscribe('monthly', true);
    w.clock.advanceDays(6);
    w.monetize.ensureDay();
    expect(w.monStore.state.subscription.trial).toBe(true); // ещё триал
    w.clock.advanceDays(1);
    w.monetize.ensureDay();
    const sub = w.monStore.state.subscription;
    expect(sub.trial).toBe(false); // конвертирован
    expect(sub.active).toBe(true);
    expect(w.analytics.tally['sub_convert']).toBe(1);
    // Амортизированный net за день = 8.99 × (1−0.30) / 30.
    expect(w.monStore.state.lifetime.subRev).toBeCloseTo((8.99 * 0.7) / 30, 9);
  });

  it('годовая без триала: net/день книжится сразу', async () => {
    const w = makeWorld();
    expect(await w.monetize.subscribe('yearly', false)).toBe(true);
    expect(w.monStore.state.subscription.trial).toBe(false);
    expect(w.monetize.getSession().subRev).toBeCloseTo((49.99 * 0.7) / 365, 9);
  });

  it('перки: +20% монет (RV-2), безлимит бесплатной Лампы, INT+BAN отключены', async () => {
    const w = makeWorld();
    w.monetize.updateBanner();
    expect(w.adProvider.bannerOn).toBe(true);
    await w.monetize.subscribe('monthly', true);
    // INT + баннер выключены, rewarded остаётся.
    expect(w.monetize.adsRemoved()).toBe(true);
    expect(w.adProvider.bannerOn).toBe(false);
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(w.monetize.bannerAllowed()).toBe(false);
    // +20% монет со всех наград слоя монетизации: 25 → 30 (06 §5.1, перк 5).
    expect(await w.monetize.offerDoubleCoins(25)).toBe(30);
  });

  it('отмена: подписка гаснет, баннер возвращается', async () => {
    const w = makeWorld();
    await w.monetize.subscribe('monthly', true);
    expect(w.adProvider.bannerOn).toBe(false);
    w.monetize.cancelSubscription();
    expect(w.monStore.state.subscription.active).toBe(false);
    expect(w.monStore.state.subscription.trial).toBe(false);
    expect(w.analytics.tally['sub_cancel']).toBe(1);
    expect(w.monetize.bannerAllowed()).toBe(true);
    expect(w.adProvider.bannerOn).toBe(true); // updateBanner вернул полосу
  });
});

/* ==================== БАННЕР B-1 / REMOVE ADS / ПОЛКА ==================== */

describe('баннер B-1 и платные продукты (06 §3.3, §5.2–5.3)', () => {
  it('баннер: не раньше уровня 2 и не на дневном', () => {
    const w = makeWorld({ level: 0 });
    expect(w.monetize.bannerAllowed()).toBe(false); // FTUE
    w.bridge.level = 1;
    expect(w.monetize.bannerAllowed()).toBe(true);
    w.bridge.daily = true;
    expect(w.monetize.bannerAllowed()).toBe(false); // дневной кроссворд
  });

  it('Remove Ads $9.99: INT+BAN отключены, rewarded остаётся, повторно не купить', async () => {
    const w = makeWorld();
    w.monetize.updateBanner();
    expect(w.adProvider.bannerOn).toBe(true);
    expect(await w.monetize.buyRemoveAds()).toBe(true);
    expect(w.monetize.adsRemoved()).toBe(true);
    expect(w.adProvider.bannerOn).toBe(false);
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(await w.monetize.offerFreezeStreak()).toBe(true); // rewarded работает
    expect(w.monetize.getSession().iapRev).toBeCloseTo(9.99, 6);
    expect(w.monStore.state.lifetime.iapCount).toBe(1);
    expect(await w.monetize.buyRemoveAds()).toBe(false); // уже куплен
  });

  it('полка монет: 7 SKU с ценами прототипа 1:1', () => {
    expect(IAP_SHELF).toHaveLength(7);
    expect(IAP_SHELF.map((s) => s.price)).toEqual([0.99, 2.99, 4.99, 9.99, 19.99, 49.99, 99.99]);
    expect(IAP_SHELF.map((s) => s.coins)).toEqual([600, 1800, 3500, 8000, 18000, 50000, 120000]);
    expect(findSku('coins_starter')?.once).toBe(true);
    expect(findSku('nope')).toBeNull();
    // Каталог платёжного провайдера включает Remove Ads и планы подписки.
    expect(findProduct('remove_ads')?.price).toBe(9.99);
    expect(findProduct('sub_month')?.price).toBe(8.99);
    expect(findProduct('sub_year')?.price).toBe(49.99);
  });

  it('покупка пака: монеты 1:1, косметика, учёт выручки', async () => {
    const w = makeWorld();
    expect(await w.monetize.purchaseIap('coins_handful')).toBe(true);
    expect(w.bridge.coins).toBe(600);
    expect(await w.monetize.purchaseIap('coins_chest_t')).toBe(true);
    expect(w.bridge.coins).toBe(600 + 18000);
    expect(w.monStore.state.skins).toEqual(['chest_theme']);
    expect(w.monStore.state.lifetime.iapRev).toBeCloseTo(0.99 + 19.99, 6);
    expect(w.monStore.state.lifetime.iapCount).toBe(2);
    expect(await w.monetize.purchaseIap('nope')).toBe(false);
  });

  it('стартовый набор — одноразовый (бейдж выдаётся)', async () => {
    const w = makeWorld();
    expect(await w.monetize.purchaseIap('coins_starter')).toBe(true);
    expect(w.monStore.state.starterBought).toBe(true);
    expect(w.monStore.state.badge).toBe(true);
    expect(await w.monetize.purchaseIap('coins_starter')).toBe(false);
    expect(w.monStore.state.lifetime.iapCount).toBe(1);
  });
});

/* ========================= eCPM: ПОРЯДОК ВЕЛИЧИН ========================= */

describe('eCPM-модель (06 §8.1): значения 1:1, инжектированный RNG', () => {
  it('rng=0.5 → ровно бенчмарк: rewarded Tier-1 = $0.0178/показ', () => {
    expect(genRevenue('rw', 'tier1', () => 0.5)).toBeCloseTo(0.0178, 10);
    expect(genRevenue('int', 'tier1', () => 0.5)).toBeCloseTo(0.014, 10);
    expect(genRevenue('banner', 'blend', () => 0.5)).toBeCloseTo(0.0004, 10);
  });

  it('джиттер ±25%: края диапазона', () => {
    expect(genRevenue('rw', 'blend', () => 1)).toBeCloseTo(0.01625, 10); // 13 × 1.25 / 1000
    expect(genRevenue('rw', 'blend', () => 0)).toBeCloseTo(0.00975, 10); // 13 × 0.75 / 1000
  });

  it('случайные показы остаются в коридоре ±25% вокруг бенчмарка', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 50; i++) {
      const rev = genRevenue('rw', 'blend', rng);
      expect(rev).toBeGreaterThanOrEqual(0.00975);
      expect(rev).toBeLessThanOrEqual(0.01625);
    }
  });

  it('матрица 1:1 из прототипа/06 §8.1; порядок RW > INT > BAN', () => {
    expect(ECPM.rw).toEqual({ tier1: 17.8, blend: 13.0, tier23: 6.0 });
    expect(ECPM.int).toEqual({ tier1: 14.0, blend: 10.0, tier23: 4.0 });
    expect(ECPM.banner).toEqual({ tier1: 0.55, blend: 0.4, tier23: 0.15 });
    expect(ecpmFor('rw', 'blend')).toBeGreaterThan(ecpmFor('int', 'blend'));
    expect(ecpmFor('int', 'blend')).toBeGreaterThan(ecpmFor('banner', 'blend'));
  });

  it('SimAdProvider: показ без DOM резолвится и шлёт impression с выручкой', async () => {
    const sim = new SimAdProvider({ rng: () => 0.5 });
    sim.setGeo('tier1');
    const impressions: AdImpression[] = [];
    sim.onImpression = (imp) => impressions.push(imp);
    const res = await sim.showRewarded('RV-2');
    expect(res.completed).toBe(true);
    expect(res.revenueUsd).toBeCloseTo(0.0178, 10);
    expect(impressions).toHaveLength(1);
    expect(impressions[0]?.format).toBe('rw');
    expect(impressions[0]?.ecpmUsd).toBeCloseTo(17.8, 10);
  });
});

/* ==================== САНИТАЙЗИНГ wordgrove.monetize.v1 ==================== */

describe('сейв wordgrove.monetize.v1: схема и санитайзинг (порт WGMonStore)', () => {
  it('null/мусор → дефолты', () => {
    expect(sanitizeMonetize(null)).toEqual(monetizeDefaults());
    expect(sanitizeMonetize('garbage')).toEqual(monetizeDefaults());
    expect(sanitizeMonetize(42)).toEqual(monetizeDefaults());
  });

  it('NaN/Infinity/битые типы приводятся к валидным значениям', () => {
    const s = sanitizeMonetize({
      v: 'x',
      removeAds: 'yes', // truthy-строка → true (как !! прототипа)
      subscription: 'broken',
      geoTier: 'mars',
      freezeTokens: -4,
      skins: 'nope',
      day: { date: 7, int: 'abc', rv1: 3.9, rv6: NaN },
      lifetime: {
        adRev: Number.POSITIVE_INFINITY,
        iapRev: 'abc',
        subRev: -1,
        imp: { int: '7', rw: null, banner: 2.5 },
        iapCount: -3
      }
    });
    expect(s.v).toBe(1);
    expect(s.removeAds).toBe(true);
    expect(s.subscription).toEqual({ active: false, plan: '', trial: false, since: '', lastDaily: '' });
    expect(s.geoTier).toBe('blend'); // неизвестное гео → дефолт
    expect(s.freezeTokens).toBe(0);
    expect(s.skins).toEqual([]);
    expect(s.day).toEqual({ date: '', int: 0, rv1: 3, rv6: 0 });
    expect(s.lifetime.adRev).toBe(0); // Infinity не должна попасть в дашборд
    expect(s.lifetime.iapRev).toBe(0);
    expect(s.lifetime.subRev).toBe(0);
    expect(s.lifetime.imp).toEqual({ int: 7, rw: 0, banner: 2 });
    expect(s.lifetime.iapCount).toBe(0);
  });

  it('сейв прототипа подхватывается 1:1 без миграции (фикстура)', () => {
    // Фикстура — структура, которую пишет прототип monetize.js (WGMonStore).
    const raw = JSON.stringify({
      v: 1,
      removeAds: false,
      subscription: { active: true, plan: 'yearly', trial: true, since: '2026-07-10', lastDaily: '2026-07-17' },
      geoTier: 'tier1',
      freezeTokens: 2,
      skins: ['chest_theme'],
      frame: true,
      badge: true,
      starterBought: true,
      day: { date: '2026-07-17', int: 4, rv1: 2, rv6: 1 },
      lifetime: { adRev: 1.25, iapRev: 12.98, subRev: 0.21, imp: { int: 40, rw: 12, banner: 200 }, iapCount: 3 }
    });
    const storage = new MemStorage();
    storage.setItem(MONETIZE.STORAGE_KEY, raw);
    const store = new MonetizeStore(storage);
    expect(store.state.subscription.active).toBe(true);
    expect(store.state.subscription.plan).toBe('yearly');
    expect(store.state.subscription.trial).toBe(true);
    expect(store.state.geoTier).toBe('tier1');
    expect(store.state.freezeTokens).toBe(2);
    expect(store.state.skins).toEqual(['chest_theme']);
    expect(store.state.starterBought).toBe(true);
    expect(store.state.day).toEqual({ date: '2026-07-17', int: 4, rv1: 2, rv6: 1 });
    expect(store.state.lifetime.iapRev).toBeCloseTo(12.98, 6);
    expect(store.state.lifetime.subRev).toBeCloseTo(0.21, 6);
  });

  it('битый JSON в ключе → чистый старт без краша (контроллер стартует)', () => {
    const w = makeWorld({ monRaw: '{"v":1, СЛОМАНО' });
    expect(w.monStore.state.day.date).not.toBe(''); // ensureDay проставил день
    expect(w.monStore.state.lifetime.adRev).toBe(0);
  });

  it('контроллер пишет ту же структуру ключей, что и прототип', async () => {
    const w = makeWorld();
    await w.monetize.offerFreezeStreak();
    const parsed = JSON.parse(w.storage.getItem(MONETIZE.STORAGE_KEY) as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['v', 'removeAds', 'subscription', 'geoTier', 'freezeTokens', 'skins', 'frame', 'badge', 'starterBought', 'day', 'lifetime'].sort()
    );
    const day = parsed.day as Record<string, unknown>;
    expect(Object.keys(day).sort()).toEqual(['date', 'int', 'rv1', 'rv6'].sort());
    const sub = parsed.subscription as Record<string, unknown>;
    expect(Object.keys(sub).sort()).toEqual(['active', 'plan', 'trial', 'since', 'lastDaily'].sort());
  });
});

/* ======================= ФАБРИКА ПРОВАЙДЕРОВ ======================= */

describe('выбор рекламного провайдера фабрикой (src/ads/index.ts)', () => {
  it('явный kind: sim → SimAdProvider, max → MaxAdProvider', () => {
    expect(createAdProvider({ kind: 'sim' })).toBeInstanceOf(SimAdProvider);
    expect(createAdProvider({ kind: 'max' })).toBeInstanceOf(MaxAdProvider);
  });

  it('без флага окружения — симулятор (веб-сборка)', () => {
    expect(createAdProvider()).toBeInstanceOf(SimAdProvider);
  });

  it('нормализация флага: только "max" включает скелет MAX', () => {
    expect(resolveAdProviderKind('max')).toBe('max');
    expect(resolveAdProviderKind('sim')).toBe('sim');
    expect(resolveAdProviderKind(undefined)).toBe('sim');
    expect(resolveAdProviderKind('garbage')).toBe('sim');
  });
});
