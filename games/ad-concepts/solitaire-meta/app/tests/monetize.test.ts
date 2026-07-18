/**
 * Тесты слоя монетизации (Проход Е.2) — чистая логика без DOM.
 * Проверяются: правила interstitial 06 §6.3 (каждое, время — через
 * инжектируемый Clock), дневные капы rewarded 06 §6.2, reward-once при гонке
 * (замок adInFlight), eCPM-модель (инжектированный RNG), IAP-полка 1:1
 * (12 SKU, разовые, подписка, копилка, окно покоя 72 ч), санитайзинг сейва
 * orchardPeaks.monetize + фикстура прототипа (совместимость без миграции),
 * выбор провайдера фабрикой.
 */
import { describe, expect, it } from 'vitest';
import type {
  AdImpression,
  AdProvider,
  InterstitialResult,
  RewardedResult
} from '../src/ads/provider';
import { ECPM, ECPM_FLOOR, ecpmFor, rollEcpm } from '../src/ads/ecpm';
import { SimAdProvider } from '../src/ads/simProvider';
import { MaxAdProvider } from '../src/ads/maxProvider.stub';
import { createAdProvider, resolveAdProviderKind } from '../src/ads/index';
import type { Clock } from '../src/monetize/clock';
import { IAP_SHELF, MON, findIap } from '../src/monetize/config';
import { monetizeDefaults, sanitizeMonetize } from '../src/monetize/save';
import { MonetizeStore } from '../src/monetize/store';
import { MonetizeController } from '../src/monetize/monetize';
import { SimPurchaseProvider } from '../src/monetize/purchase';
import { Store } from '../src/economy/store';
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';
import { Meta } from '../src/meta/meta';
import { BASE_MS, MemStorage } from './helpers';

/* ============================ ХЕЛПЕРЫ ============================ */

/** Управляемые часы: правила interstitial тестируются без реального времени. */
class FakeClock implements Clock {
  constructor(public t: number = BASE_MS) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Провайдер-заглушка: показы мгновенны, выручка фиксированная. */
class FakeAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;
  rewardedCompleted = true;
  intResult: InterstitialResult | null = null; // null → штатный показ
  rwCalls: string[] = [];
  intCalls = 0;

  async init(): Promise<void> {}

  isRewardedReady(_placement: string): boolean {
    return true;
  }

  async showRewarded(placement: string): Promise<RewardedResult> {
    this.rwCalls.push(placement);
    if (!this.rewardedCompleted) return { completed: false, revenueUsd: 0, ecpmUsd: 16 };
    this.onImpression?.({ format: 'rewarded', placement, revenueUsd: 0.016, ecpmUsd: 16 });
    return { completed: true, revenueUsd: 0.016, ecpmUsd: 16 };
  }

  async showInterstitial(placement: string): Promise<InterstitialResult> {
    this.intCalls++;
    if (this.intResult !== null) return this.intResult;
    this.onImpression?.({ format: 'interstitial', placement, revenueUsd: 0.012, ecpmUsd: 12 });
    return { shown: true, revenueUsd: 0.012, ecpmUsd: 12 };
  }
}

/** Отложенный провайдер: резолв показа контролируется тестом (гонки). */
class DeferredAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;
  pending: ((r: RewardedResult) => void)[] = [];

  async init(): Promise<void> {}

  isRewardedReady(_placement: string): boolean {
    return true;
  }

  showRewarded(placement: string): Promise<RewardedResult> {
    return new Promise((resolve) => {
      this.pending.push((r) => {
        if (r.completed) {
          this.onImpression?.({ format: 'rewarded', placement, revenueUsd: r.revenueUsd, ecpmUsd: r.ecpmUsd });
        }
        resolve(r);
      });
    });
  }

  async showInterstitial(_placement: string): Promise<InterstitialResult> {
    return { shown: true, revenueUsd: 0.012, ecpmUsd: 12 };
  }
}

interface MonWorldOpts {
  level?: number;
  installedHoursAgo?: number;
  monRaw?: string;
  provider?: AdProvider;
  rng?: () => number;
}

/** Мир монетизации с in-memory сейвами и замороженными часами. */
function makeMonWorld(opts: MonWorldOpts = {}) {
  const metaStorage = new MemStorage();
  const monStorage = new MemStorage();
  const clock = new FakeClock(BASE_MS);
  if (opts.monRaw !== undefined) {
    monStorage.setItem(MON.STORE_KEY, opts.monRaw);
  } else if (opts.installedHoursAgo !== undefined) {
    monStorage.setItem(
      MON.STORE_KEY,
      JSON.stringify({ installTs: BASE_MS - opts.installedHoursAgo * 3600000 })
    );
  }
  const metaStore = new Store(metaStorage);
  if (opts.level !== undefined) metaStore.state.economy.level = opts.level;
  const analytics = new Analytics(true);
  const economy = new Economy(metaStore, analytics);
  const meta = new Meta(metaStore, economy, analytics, () => clock.now());
  const monStore = new MonetizeStore(monStorage);
  const adProvider = opts.provider ?? new FakeAdProvider();
  const deps = {
    monStore,
    metaStore,
    economy,
    analytics,
    adProvider,
    purchaseProvider: new SimPurchaseProvider(),
    clock
  };
  const monetize = new MonetizeController(opts.rng !== undefined ? { ...deps, rng: opts.rng } : deps);
  return { metaStorage, monStorage, metaStore, monStore, analytics, economy, meta, clock, adProvider, monetize };
}

/** Мир, в котором ВСЕ правила INT1 пройдены (уровень 20, установка > 24 ч). */
function makeIntWorld(opts: MonWorldOpts = {}) {
  return makeMonWorld({ level: 20, installedHoursAgo: 25, ...opts });
}

/* ============================ eCPM-МОДЕЛЬ ============================ */

describe('eCPM-модель (06 §6.7, числа 1:1 с прототипом)', () => {
  it('бенчмарки и floor: tier1 rw $16/int $12, tier23 rw $5/int $3.5', () => {
    expect(ecpmFor('rewarded', 'tier1')).toBe(16.0);
    expect(ecpmFor('interstitial', 'tier1')).toBe(12.0);
    expect(ecpmFor('rewarded', 'tier23')).toBe(5.0);
    expect(ecpmFor('interstitial', 'tier23')).toBe(3.5);
    expect(ECPM_FLOOR.tier1.rewarded).toBe(10.0);
    expect(ECPM.tier23.rewarded).toBe(5.0);
  });

  it('rollEcpm: rng=0.5 → ровно бенчмарк; края — в пределах ±35%', () => {
    expect(rollEcpm('rewarded', 'tier1', () => 0.5)).toBeCloseTo(16.0, 9);
    expect(rollEcpm('interstitial', 'tier23', () => 0.5)).toBeCloseTo(3.5, 9);
    expect(rollEcpm('interstitial', 'tier1', () => 0)).toBeCloseTo(12 * 0.65, 9);
    expect(rollEcpm('interstitial', 'tier1', () => 0.999999)).toBeLessThanOrEqual(12 * 1.35 + 1e-6);
  });

  it('rewarded «заполняется» не ниже floor (высокий fill)', () => {
    // tier23: 5 × 0.65 = 3.25 ≥ floor 1.5 — floor не срезает; но клип есть в коде:
    expect(rollEcpm('rewarded', 'tier23', () => 0)).toBeCloseTo(3.25, 9);
    expect(rollEcpm('rewarded', 'tier1', () => 0)).toBeGreaterThanOrEqual(ECPM_FLOOR.tier1.rewarded);
  });
});

describe('SimAdProvider (headless, инжектированный RNG)', () => {
  it('rewarded: досмотр → impression с revenue = eCPM/1000', async () => {
    const p = new SimAdProvider({ rng: () => 0.5 });
    const imps: AdImpression[] = [];
    p.onImpression = (i) => imps.push(i);
    const res = await p.showRewarded('RW4');
    expect(res.completed).toBe(true);
    expect(res.ecpmUsd).toBeCloseTo(16.0, 9);
    expect(res.revenueUsd).toBeCloseTo(0.016, 9);
    expect(imps).toHaveLength(1);
    expect(imps[0].placement).toBe('RW4');
  });

  it('interstitial: «не загрузилось» (3% fill) → shown:false, награды/выручки нет', async () => {
    // rng: 1-й вызов — ставка (0.5 → бенчмарк), 2-й — фейл-ролл (0.001 < 0.03).
    const seq = [0.5, 0.001];
    const p = new SimAdProvider({ rng: () => seq.shift() ?? 0.5 });
    const imps: AdImpression[] = [];
    p.onImpression = (i) => imps.push(i);
    const res = await p.showInterstitial('INT1');
    expect(res.shown).toBe(false);
    expect(res.noFillReason).toBe('no_fill');
    expect(imps).toHaveLength(0);
  });

  it('interstitial: штатный показ → impression', async () => {
    const seq = [0.5, 0.9];
    const p = new SimAdProvider({ rng: () => seq.shift() ?? 0.5 });
    const imps: AdImpression[] = [];
    p.onImpression = (i) => imps.push(i);
    const res = await p.showInterstitial('INT1');
    expect(res.shown).toBe(true);
    expect(res.revenueUsd).toBeCloseTo(0.012, 9);
    expect(imps).toHaveLength(1);
  });
});

describe('фабрика провайдера (src/ads/index.ts)', () => {
  it('всё, кроме "max", — симулятор; kind прокидывается явно', () => {
    expect(resolveAdProviderKind('max')).toBe('max');
    expect(resolveAdProviderKind('sim')).toBe('sim');
    expect(resolveAdProviderKind(undefined)).toBe('sim');
    expect(createAdProvider({ kind: 'sim' })).toBeInstanceOf(SimAdProvider);
    expect(createAdProvider({ kind: 'max' })).toBeInstanceOf(MaxAdProvider);
  });

  it('скелет MaxAdProvider не притворяется рабочим: методы бросают NOT_WIRED', async () => {
    const p = new MaxAdProvider();
    await expect(p.init()).rejects.toThrow(/SimAdProvider/);
    expect(p.isRewardedReady('RW1')).toBe(false);
  });
});

/* ===================== ПРАВИЛА INTERSTITIAL (06 §6.3) ===================== */

describe('interstitial INT1: правила 06 §6.3 (инжектируемый Clock)', () => {
  it('§6.3.1: уровень < 12 → «уровень<12»', () => {
    const w = makeMonWorld({ installedHoursAgo: 25 });
    expect(w.monetize.interstitialBlockReason()).toBe('уровень<12');
  });

  it('§6.3.1: установка < 24 ч → «установка<24ч»; «Новый день (тест)» снимает гейт', async () => {
    const w = makeMonWorld({ level: 20 });
    expect(w.monetize.interstitialBlockReason()).toBe('установка<24ч');
    w.meta.newDay(); // simDayOffset ≥ 1 — гейт дня 1 снят (как в прототипе)
    expect(w.monetize.interstitialBlockReason()).toBeNull();
    expect(await w.monetize.maybeInterstitial()).toBe(true);
  });

  it('успешный показ: дневной счётчик, сессия, выручка impression', async () => {
    const w = makeIntWorld();
    expect(w.monetize.interstitialBlockReason()).toBeNull();
    const shown = await w.monetize.maybeInterstitial();
    expect(shown).toBe(true);
    expect(w.monStore.state.daily.int).toBe(1);
    const s = w.monetize.getStats();
    expect(s.intImps).toBe(1);
    expect(s.adRev).toBeCloseTo(0.012, 9);
    expect(s.completed).toBe(1);
  });

  it('§6.3.2: < 2 уровней с прошлого INT → «уровней<2», затем «интервал<180c»', async () => {
    const w = makeIntWorld();
    await w.monetize.maybeInterstitial();
    expect(w.monetize.interstitialBlockReason()).toBe('уровней<2');
    w.monetize.onLevelFinished();
    w.monetize.onLevelFinished();
    expect(w.monetize.interstitialBlockReason()).toBe('интервал<180c');
    w.clock.advance(MON.INT_MIN_INTERVAL_S * 1000);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('§6.3.3: капы — 3/сессию и 8/день (дневной переживает сброс сессии)', async () => {
    const w = makeIntWorld();
    const showOnce = async (): Promise<void> => {
      expect(await w.monetize.maybeInterstitial()).toBe(true);
      w.monetize.onLevelFinished();
      w.monetize.onLevelFinished();
      w.clock.advance(MON.INT_MIN_INTERVAL_S * 1000);
    };
    await showOnce();
    await showOnce();
    await showOnce();
    expect(w.monetize.interstitialBlockReason()).toBe('сессия-кап');
    w.monetize.resetSession(); // новая «сессия-DAU» — дневной счётчик остаётся
    await showOnce();
    await showOnce();
    await showOnce();
    w.monetize.resetSession();
    await showOnce();
    await showOnce();
    expect(w.monStore.state.daily.int).toBe(8);
    expect(w.monetize.interstitialBlockReason()).toBe('дн.кап');
    const before = w.monStore.state.daily.int;
    expect(await w.monetize.maybeInterstitial()).toBe(false);
    expect(w.monStore.state.daily.int).toBe(before);
    expect(w.monetize.getStats().blocks['дн.кап']).toBe(1);
  });

  it('§6.3.6: 60 c «усталости» после rewarded', async () => {
    const w = makeIntWorld();
    await w.monetize.showRewarded('RW4');
    expect(w.monetize.interstitialBlockReason()).toBe('усталость-rw');
    w.clock.advance(MON.REWARDED_FATIGUE_S * 1000);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('§6.3.7: окно покоя плательщика 72 ч после покупки', async () => {
    const w = makeIntWorld();
    expect(await w.monetize.buyIAP('coins_s')).toBe(true);
    expect(w.monetize.interstitialBlockReason()).toBe('покой-плательщика');
    w.clock.advance(MON.PAYER_REST_H * 3600000);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('§6.3.7: remove_ads и подписка выключают INT (rewarded остаётся)', async () => {
    const w = makeIntWorld();
    await w.monetize.buyIAP('remove_ads');
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(await w.monetize.showRewarded('RW4')).toBe(true); // rewarded не убирается

    const w2 = makeIntWorld();
    await w2.monetize.buyIAP('club_month');
    expect(w2.monetize.interstitialBlockReason()).toBe('subscriber');
  });

  it('§6.3.8: отказ провайдера «eCPM-floor» — блок-чип без старта показа', async () => {
    const provider = new FakeAdProvider();
    provider.intResult = { shown: false, revenueUsd: 0, ecpmUsd: 1.9, noFillReason: 'eCPM-floor' };
    const w = makeIntWorld({ provider });
    let done = false;
    expect(await w.monetize.maybeInterstitial(() => (done = true))).toBe(false);
    expect(done).toBe(true); // onDone вызывается в любом случае
    const s = w.monetize.getStats();
    expect(s.blocks['eCPM-floor']).toBe(1);
    expect(s.started).toBe(0);
    expect(w.monStore.state.daily.int).toBe(0);
  });
});

/* ========================= REWARDED (06 §6.2) ========================= */

describe('rewarded: дневные капы и награды', () => {
  it('RW4 «Колесо ярмарки»: кап 1/день; блок с причиной «cap»', async () => {
    const w = makeMonWorld({ rng: () => 0 }); // сектор колеса = RW4_WHEEL[0] = 100
    const before = w.economy.getCoins();
    expect(await w.monetize.rwWheel()).toBe(true);
    expect(w.economy.getCoins()).toBe(before + MON.RW4_WHEEL[0]);
    expect(w.monStore.state.daily.rw.RW4).toBe(1);
    expect(await w.monetize.rwWheel()).toBe(false);
    expect(w.monetize.getStats().blocks.cap).toBe(1);
  });

  it('RW6 «Кошелёк садовода»: грант 0.8·E(n) до 10, кап 3/день', async () => {
    const w = makeMonWorld();
    expect(w.monetize.walletGrant()).toBe(280); // E(1)=350 → round(0.8·350/10)·10
    const before = w.economy.getCoins();
    expect(await w.monetize.rwWallet()).toBe(true);
    expect(await w.monetize.rwWallet()).toBe(true);
    expect(await w.monetize.rwWallet()).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 3 * 280);
    expect(await w.monetize.rwWallet()).toBe(false); // кап 3/день исчерпан
    expect(w.monetize.rewardedAllowed('RW6')).toBe(false);
  });

  it('RW5 «×2 жетоны»: только в ивент-уикенд (кап 3/день)', async () => {
    const w = makeMonWorld();
    expect(await w.monetize.rwEventTokens()).toBe(false);
    w.monetize.setEvent(true);
    const before = w.economy.getCoins();
    expect(await w.monetize.rwEventTokens()).toBe(true);
    expect(w.economy.getCoins()).toBe(before + MON.RW5_TOKENS_COINS);
  });

  it('RW3 «Бустер до уровня»: кап 2/день, бустер приходит в инвентарь', async () => {
    const w = makeMonWorld({ rng: () => 0 }); // RW3_BOOSTERS[0] = basket
    const before = w.economy.getBooster('basket');
    expect(await w.monetize.rwBooster()).toBe(true);
    expect(w.economy.getBooster('basket')).toBe(before + 1);
    expect(await w.monetize.rwBooster()).toBe(true);
    expect(await w.monetize.rwBooster()).toBe(false); // кап RW3 = 2
  });

  it('RW1/RW2 без дневного капа (лимит 1/уровень — на стороне TableUi)', () => {
    const w = makeMonWorld();
    expect(w.monetize.rewardedAllowed('RW1')).toBe(true);
    expect(w.monetize.rewardedAllowed('RW2')).toBe(true);
  });

  it('«не досмотрел» (fill/закрытие) → награды нет, кап не тратится', async () => {
    const provider = new FakeAdProvider();
    provider.rewardedCompleted = false;
    const w = makeMonWorld({ provider });
    let rewarded = 0;
    expect(await w.monetize.showRewarded('RW4', () => rewarded++)).toBe(false);
    expect(rewarded).toBe(0);
    expect(w.monStore.state.daily.rw.RW4 ?? 0).toBe(0);
    expect(w.monetize.getStats().failed).toBe(1);
  });

  it('ГОНКА (урок Block Surge): двойной вызов до открытия ролика → награда одна', async () => {
    const provider = new DeferredAdProvider();
    const w = makeMonWorld({ provider });
    let rewards = 0;
    // Оба вызова стартуют ДО резолва показа — оба прошли бы проверку капа
    // «RW4 ≤ 1/день» без замка adInFlight (check-then-act).
    const p1 = w.monetize.showRewarded('RW4', () => rewards++);
    const p2 = w.monetize.showRewarded('RW4', () => rewards++);
    expect(await p2).toBe(false); // второй вызов отбит замком сразу
    expect(provider.pending).toHaveLength(1); // до провайдера дошёл ровно один показ
    provider.pending[0]({ completed: true, revenueUsd: 0.016, ecpmUsd: 16 });
    expect(await p1).toBe(true);
    expect(rewards).toBe(1);
    expect(w.monStore.state.daily.rw.RW4).toBe(1);
  });
});

/* ==================== IAP / ПОДПИСКА / КОПИЛКА (06 §6.4/§6.5) ==================== */

describe('IAP-полка 06 §6.4 (СИМУЛЯЦИЯ)', () => {
  it('полка 1:1: 12 SKU, цены прототипа', () => {
    expect(IAP_SHELF).toHaveLength(12);
    expect(findIap('remove_ads')?.price).toBe(6.99);
    expect(findIap('club_month')?.kind).toBe('sub');
    expect(findIap('coins_max')?.coins).toBe(130000);
    expect(findIap('nope')).toBeNull();
  });

  it('coins_s: грант монет, выручка сессии/lifetime, статус плательщика', async () => {
    const w = makeMonWorld();
    const before = w.economy.getCoins();
    expect(await w.monetize.buyIAP('coins_s')).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 800);
    const s = w.monetize.getStats();
    expect(s.iapRev).toBeCloseTo(0.99, 9);
    expect(s.payer).toBe(true);
    expect(w.monStore.state.life.purchases.coins_s).toBe(1);
    expect(w.monStore.state.payer.lastPurchaseTs).toBe(w.clock.now());
  });

  it('starter_pack — разовый: вторая покупка отклоняется', async () => {
    const w = makeMonWorld();
    expect(await w.monetize.buyIAP('starter_pack')).toBe(true);
    expect(w.metaStore.state.garden.cards).toBe(1); // карточка гербария из набора
    expect(await w.monetize.buyIAP('starter_pack')).toBe(false);
    expect(w.monStore.state.life.purchases.starter_pack).toBe(1);
  });

  it('remove_ads: +500 монет, повторная покупка отклоняется', async () => {
    const w = makeMonWorld();
    const before = w.economy.getCoins();
    expect(await w.monetize.buyIAP('remove_ads')).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 500);
    expect(w.monetize.isAdsRemoved()).toBe(true);
    expect(await w.monetize.buyIAP('remove_ads')).toBe(false);
  });

  it('подписка «Клуб садовода»: 500/день один раз, +50% урожая, отмена и renew', async () => {
    const w = makeMonWorld();
    const before = w.economy.getCoins();
    expect(await w.monetize.buyIAP('club_month')).toBe(true);
    expect(w.economy.getCoins()).toBe(before + MON.CLUB_DAILY_COINS); // дневной грант
    w.monetize.onShopOpened(); // тот же день — без повторного гранта
    expect(w.economy.getCoins()).toBe(before + MON.CLUB_DAILY_COINS);
    expect(w.monetize.harvestMultiplier()).toBeCloseTo(1.5, 9);
    expect(w.monStore.state.sub.monthNo).toBe(1);

    w.meta.newDay(); // «Новый день (тест)» двигает и день монетизации
    w.monetize.onShopOpened();
    expect(w.economy.getCoins()).toBe(before + 2 * MON.CLUB_DAILY_COINS);

    w.monetize.cancelSub();
    expect(w.monetize.isSubscriber()).toBe(false);
    expect(w.monetize.harvestMultiplier()).toBe(1);
    await w.monetize.buyIAP('club_month'); // renew
    expect(w.monStore.state.sub.monthNo).toBe(2);
  });

  it('копилка: 5% выигрышей, вскрытие от 4000, cap 15000', async () => {
    const w = makeMonWorld();
    w.monetize.onCoinsWon(1000);
    expect(w.monStore.state.piggy.balance).toBe(0); // копилка ещё не куплена
    await w.monetize.buyIAP('piggy_greenhouse');
    w.monetize.onCoinsWon(1000);
    expect(w.monStore.state.piggy.balance).toBe(50);
    expect(w.monetize.piggyBreak()).toBe(false); // < 4000 — рано
    for (let i = 0; i < 100; i++) w.monetize.onCoinsWon(1000);
    expect(w.monStore.state.piggy.balance).toBe(5050);
    const before = w.economy.getCoins();
    expect(w.monetize.piggyBreak()).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 5050);
    expect(w.monStore.state.piggy.balance).toBe(0);
    // cap 15000
    for (let i = 0; i < 1000; i++) w.monetize.onCoinsWon(10000);
    expect(w.monStore.state.piggy.balance).toBe(MON.PIGGY_CAP);
    expect(await w.monetize.buyIAP('piggy_greenhouse')).toBe(false); // уже активна
  });

  it('кнопка «Кошелёк»: видна только при нужде (< 2·E) и свободном капе', async () => {
    const w = makeMonWorld();
    expect(w.monetize.walletOfferVisible()).toBe(false); // 1000 ≥ 2·350
    w.economy.spendCoins(500, 'test'); // 500 < 700 — нужда
    expect(w.monetize.walletOfferVisible()).toBe(true);
    await w.monetize.rwWallet();
    await w.monetize.rwWallet();
    w.economy.spendCoins(800, 'test');
    await w.monetize.rwWallet();
    expect(w.monetize.walletOfferVisible()).toBe(false); // кап 3/день исчерпан
  });
});

/* ==================== СЕЙВ orchardPeaks.monetize ==================== */

describe('сейв orchardPeaks.monetize: схема прототипа и санитайзинг', () => {
  it('фикстура прототипа подхватывается без миграции (тот же ключ и поля)', () => {
    const fixture = {
      v: 1,
      geoTier: 'tier23',
      eventWeekend: true,
      removeAds: true,
      sub: { active: true, monthNo: 2, startTs: 123 },
      installTs: 456,
      piggy: { owned: true, balance: 5000 },
      club: { lastGrantDate: '2026-07-17' },
      payer: { first: true, lastPurchaseTs: 789 },
      daily: { date: '2026-07-18', int: 3, rw: { RW4: 1, RW6: 2 } },
      life: {
        adRevenue: 1.23,
        iapRevenue: 9.99,
        imps: { RW1: 5, INT1: 7 },
        rev: { RW1: 0.08 },
        purchases: { coins_s: 2, starter_pack: 1 }
      }
    };
    const w = makeMonWorld({ monRaw: JSON.stringify(fixture) });
    const st = w.monStore.state;
    expect(st.geoTier).toBe('tier23');
    expect(st.removeAds).toBe(true);
    expect(st.sub).toEqual({ active: true, monthNo: 2, startTs: 123 });
    expect(st.piggy).toEqual({ owned: true, balance: 5000 });
    expect(st.daily.rw.RW6).toBe(2);
    expect(st.life.imps.INT1).toBe(7);
    expect(st.life.purchases.starter_pack).toBe(1);
    // Дневные капы продолжаются от сейва прототипа: RW6 2/3 → остался один.
    expect(w.monetize.rwUsedToday('RW6')).toBe(2);
    expect(w.monetize.rewardedAllowed('RW6')).toBe(true);
    expect(w.monetize.rwUsedToday('RW4')).toBe(1);
    expect(w.monetize.rewardedAllowed('RW4')).toBe(false); // кап RW4 = 1
    // starter_pack уже куплен в прототипе — разовый SKU заперт и здесь.
    expect(w.monetize.getStats().payer).toBe(true);
  });

  it('повреждённый JSON → дефолты без краша', () => {
    const w = makeMonWorld({ monRaw: '{{{нет' });
    expect(w.monStore.state.removeAds).toBe(false);
    expect(w.monStore.state.geoTier).toBe('tier1');
  });

  it('санитайзинг: битые типы/границы приводятся к безопасным', () => {
    const st = sanitizeMonetize({
      geoTier: 'weird',
      removeAds: 'yes',
      sub: { active: 1, monthNo: Infinity, startTs: -5 },
      piggy: { owned: true, balance: 1e9 },
      daily: { date: 7, int: '5', rw: { RW4: 2.9, RW6: 'x' } },
      life: { adRevenue: 'abc', iapRevenue: -3, imps: { RW1: 1.7 }, rev: null, purchases: [1, 2] }
    });
    expect(st.geoTier).toBe('tier1');
    expect(st.removeAds).toBe(true); // truthy → boolean (как !! прототипа)
    expect(st.sub.monthNo).toBe(0); // Infinity → дефолт
    expect(st.sub.startTs).toBe(0);
    expect(st.piggy.balance).toBe(MON.PIGGY_CAP); // клип к капу
    expect(st.daily.date).toBe('');
    expect(st.daily.int).toBe(0); // строка — не число (fin прототипа)
    expect(st.daily.rw.RW4).toBe(2); // целое
    expect(st.daily.rw.RW6).toBe(0);
    expect(st.life.adRevenue).toBe(0);
    expect(st.life.iapRevenue).toBe(0);
    expect(st.life.imps.RW1).toBe(1);
    expect(st.life.purchases).toEqual({});
    expect(sanitizeMonetize(null)).toEqual(monetizeDefaults());
  });

  it('состояние переживает перезагрузку (тот же storage → тот же state)', async () => {
    const w = makeMonWorld();
    await w.monetize.buyIAP('remove_ads');
    w.monetize.setGeo('tier23');
    const reloaded = new MonetizeStore(w.monStorage);
    expect(reloaded.state.removeAds).toBe(true);
    expect(reloaded.state.geoTier).toBe('tier23');
    expect(reloaded.state.life.iapRevenue).toBeCloseTo(6.99, 9);
  });
});

/* ==================== СТАТИСТИКА ДЛЯ ДАШБОРДА ==================== */

describe('getStats: сводка для дашборда 📊 (порт 1:1)', () => {
  it('доли и eCPM считаются от сессии; сброс сессии не трогает lifetime', async () => {
    const w = makeIntWorld();
    await w.monetize.showRewarded('RW4');
    w.clock.advance(61000);
    await w.monetize.maybeInterstitial();
    await w.monetize.buyIAP('coins_s');
    const s = w.monetize.getStats();
    expect(s.rewardedImps).toBe(1);
    expect(s.intImps).toBe(1);
    expect(s.adRev).toBeCloseTo(0.028, 9);
    expect(s.blended).toBeCloseTo(0.028 + 0.99, 9);
    expect(s.adShare).toBeCloseTo(0.028 / (0.028 + 0.99), 9);
    expect(s.rewardedRevShare).toBeCloseTo(0.016 / 0.028, 9);
    expect(s.ecpmRw).toBeCloseTo(16, 9);
    expect(s.ecpmInt).toBeCloseTo(12, 9);
    w.monetize.resetSession();
    const s2 = w.monetize.getStats();
    expect(s2.adRev).toBe(0);
    expect(s2.life.adRevenue).toBeCloseTo(0.028, 9); // lifetime остался
    expect(s2.life.iapRevenue).toBeCloseTo(0.99, 9);
  });
});
