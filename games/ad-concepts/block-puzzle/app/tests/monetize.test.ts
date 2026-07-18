/**
 * Тесты слоя монетизации (Проход Е.2) — чистая логика без Phaser/DOM.
 * Проверяются: капы interstitial 06 §3 (каждое правило, время — через
 * инжектируемый Clock), rewarded-капы 06 §2.2 + reward-once (дельта-начисление
 * конца партии при RW-1), eCPM-модель (порядок величин, инжектированный RNG),
 * санитайзинг сейва blocksurge_monetize, полка IAP 1:1 и выбор провайдера
 * фабрикой.
 */
import { describe, expect, it } from 'vitest';
import type { AdImpression, AdProvider, InterstitialResult, RewardedResult } from '../src/ads/provider';
import { ECPM, ecpmFor, genRevenue } from '../src/ads/ecpm';
import { SimAdProvider } from '../src/ads/simProvider';
import { MaxAdProvider } from '../src/ads/maxProvider.stub';
import { createAdProvider, resolveAdProviderKind } from '../src/ads/index';
import type { Clock } from '../src/monetize/clock';
import { IAP_SHELF, MONETIZE, findSku } from '../src/monetize/config';
import { monetizeDefaults, sanitizeMonetize } from '../src/monetize/save';
import { MonetizeStore } from '../src/monetize/store';
import { MonetizeController } from '../src/monetize/monetize';
import { SimPurchaseProvider } from '../src/monetize/purchase';
import { reviveBoard } from '../src/monetize/revive';
import { Store, type KeyValueStorage } from '../src/economy/store';
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';
import { Meta } from '../src/meta/meta';
import { createGame } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';

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

/** Управляемые часы: капы interstitial тестируются без реального времени. */
class FakeClock implements Clock {
  t = 0;
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
    const revenueUsd = 0.016;
    this.onImpression?.({ format: 'rw', placement, revenueUsd, ecpmUsd: 16 });
    return { completed: true, revenueUsd };
  }

  async showInterstitial(placement: string): Promise<InterstitialResult> {
    this.intShown++;
    const revenueUsd = 0.014;
    this.onImpression?.({ format: 'int', placement, revenueUsd, ecpmUsd: 14 });
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
function makeWorld(opts: { gamesPlayed?: number; monRaw?: string } = {}) {
  const metaStorage = new MemStorage();
  const monStorage = new MemStorage();
  if (opts.monRaw !== undefined) monStorage.setItem(MONETIZE.STORAGE_KEY, opts.monRaw);
  const metaStore = new Store(metaStorage);
  metaStore.state.stats.gamesPlayed = opts.gamesPlayed ?? 5; // FTUE-порог партий пройден
  const analytics = new Analytics(true);
  const economy = new Economy(metaStore, analytics);
  const meta = new Meta(metaStore, economy, analytics, () => new Date(2026, 6, 18));
  const monStore = new MonetizeStore(monStorage);
  const clock = new FakeClock();
  const adProvider = new FakeAdProvider();
  const purchaseProvider = new SimPurchaseProvider();
  const monetize = new MonetizeController({
    monStore,
    metaStore,
    economy,
    analytics,
    adProvider,
    purchaseProvider,
    clock
  });
  return { metaStore, monStore, monStorage, analytics, economy, meta, clock, adProvider, monetize };
}

/* ===================== КАПЫ INTERSTITIAL (06 §3) ===================== */

describe('interstitial INT-2: капы 06 §3 (инжектируемый Clock)', () => {
  it('FTUE: < 2 партий — показа нет и это НЕ ad_capped', async () => {
    const w = makeWorld({ gamesPlayed: 0 });
    w.clock.advance(60000); // время FTUE прошло, партии — нет
    expect(w.monetize.interstitialBlockReason()).toBe('ftue_games');
    expect(await w.monetize.showInterstitialIfAllowed()).toBe(false);
    expect(w.adProvider.intShown).toBe(0);
    expect(w.monetize.getSession().intCapped).toBe(0); // FTUE — норма, не диагностика
  });

  it('FTUE: первые 30 сек сессии — показа нет', async () => {
    const w = makeWorld();
    w.clock.advance(29999);
    expect(w.monetize.interstitialBlockReason()).toBe('ftue_time');
    expect(await w.monetize.showInterstitialIfAllowed()).toBe(false);
    expect(w.monetize.getSession().intCapped).toBe(0);
  });

  it('после FTUE показ идёт: выручка учтена, дневной счётчик растёт', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
    expect(await w.monetize.showInterstitialIfAllowed()).toBe(true);
    expect(w.adProvider.intShown).toBe(1);
    expect(w.monStore.state.day.int).toBe(1);
    const s = w.monetize.getSession();
    expect(s.imp.int).toBe(1);
    expect(s.adRev).toBeCloseTo(0.014, 6);
    expect(w.monStore.state.lifetime.imp.int).toBe(1);
  });

  it('частотный кап: без новой партии второй показ блокируется (ad_capped)', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    await w.monetize.showInterstitialIfAllowed();
    w.clock.advance(500000); // интервал давно прошёл — держит именно частота
    expect(await w.monetize.showInterstitialIfAllowed()).toBe(false);
    const s = w.monetize.getSession();
    expect(s.intCapped).toBe(1);
    expect(s.lastCapRule).toBe('frequency');
    expect(w.analytics.tally['ad_capped']).toBe(1);
  });

  it('интервал ≥90 сек между показами', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    await w.monetize.showInterstitialIfAllowed();
    w.metaStore.state.stats.gamesPlayed++; // партия сыграна — частота отпустила
    w.clock.advance(89999);
    expect(w.monetize.interstitialBlockReason()).toBe('interval');
    w.clock.advance(1);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('≥60 сек после rewarded (пользователь «оплатил» отдых рекламой)', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    await w.monetize.offerFreeBooster(); // rewarded показан
    expect(w.monetize.interstitialBlockReason()).toBe('after_rw');
    w.clock.advance(59999);
    expect(w.monetize.interstitialBlockReason()).toBe('after_rw');
    w.clock.advance(1);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('после IAP-покупки — льгота на сутки', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    expect(await w.monetize.purchase('coins_s')).toBe(true);
    expect(w.monetize.interstitialBlockReason()).toBe('after_iap');
    w.clock.advance(24 * 3600 * 1000);
    expect(w.monetize.interstitialBlockReason()).toBeNull();
  });

  it('дневной кап ≤10 показов', () => {
    const w = makeWorld();
    w.clock.advance(31000);
    w.monStore.state.day.date = ''; // ensureDay пересоздаст день
    w.monetize.ensureDay();
    w.monStore.state.day.int = MONETIZE.INT.SESSION_CAP;
    expect(w.monetize.interstitialBlockReason()).toBe('session_cap');
  });

  it('Remove Ads / подписка выключают interstitial (и это не ad_capped)', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    w.monStore.state.removeAds = true;
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(await w.monetize.showInterstitialIfAllowed()).toBe(false);
    expect(w.monetize.getSession().intCapped).toBe(0);
  });
});

/* ==================== REWARDED: КАПЫ И REWARD-ONCE ==================== */

describe('rewarded-плейсменты RW-1…RW-4: капы 06 §2.2', () => {
  it('RW-1 «Второй шанс»: 1/партию; новая партия возвращает право', async () => {
    const w = makeWorld();
    const state = createGame(42);
    state.gameOver = true;
    expect(w.monetize.canRevive()).toBe(true);
    expect(await w.monetize.offerRevive(state)).toBe(true);
    expect(state.gameOver).toBe(false); // партия оживлена
    expect(w.monetize.canRevive()).toBe(false);
    state.gameOver = true;
    expect(await w.monetize.offerRevive(state)).toBe(false); // второй раз — нет
    expect(w.adProvider.rwPlacements).toEqual(['RW-1']); // показа не было
    w.monetize.onNewGame();
    expect(w.monetize.canRevive()).toBe(true);
  });

  it('RW-1 не идёт, пока партия не окончена', async () => {
    const w = makeWorld();
    const state = createGame(7);
    expect(await w.monetize.offerRevive(state)).toBe(false);
    expect(w.adProvider.rwPlacements).toEqual([]);
  });

  it('reviveBoard: чистит 2 строки + 2 столбца и раздаёт разрешимую тройку', () => {
    const state = createGame(1);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) state.board[r][c] = 1;
    state.gameOver = true;
    reviveBoard(state);
    let empty = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.board[r][c] === 0) empty++;
    expect(empty).toBe(28); // 2×8 + 2×8 − 4 пересечения
    expect(state.gameOver).toBe(false);
    expect(state.hand.every((id) => id !== null)).toBe(true);
  });

  it('reward-once: оживление НЕ дублирует награды конца партии (дельта в Meta)', async () => {
    const w = makeWorld();
    const gamesBefore = w.metaStore.state.stats.gamesPlayed;
    const coinsBefore = w.economy.getCoins();
    w.meta.onNewGame();
    w.meta.onGameEnd(500); // конец партии: +5 монет (500/100), партия засчитана
    expect(w.economy.getCoins()).toBe(coinsBefore + 5);
    // RW-1 → та же партия продолжилась и закончилась с бОльшим счётом:
    w.meta.onGameEnd(900); // дельта: 9 − 5 = +4, а не +9
    expect(w.economy.getCoins()).toBe(coinsBefore + 9);
    expect(w.metaStore.state.stats.gamesPlayed).toBe(gamesBefore + 1); // одна партия
  });

  it('RW-2 «×2 монеты»: 1/партию и 3/день; бонус = заработанному', async () => {
    const w = makeWorld();
    w.economy.resetEarnedThisGame();
    w.economy.addCoins(30, 'level', true); // заработано в партии
    const before = w.economy.getCoins();
    expect(await w.monetize.offerDoubleCoins()).toBe(30);
    expect(w.economy.getCoins()).toBe(before + 30);
    expect(w.monStore.state.day.rw2).toBe(1);
    // Второй раз в той же партии — нет.
    expect(await w.monetize.offerDoubleCoins()).toBe(0);
    // Партии 2 и 3 — дневной кап 3 исчерпан, 4-я попытка глохнет.
    w.monetize.onNewGame();
    w.economy.resetEarnedThisGame(); // новая партия без заработка
    expect(await w.monetize.offerDoubleCoins()).toBe(20); // партия без монет → подстраховка 20
    w.monetize.onNewGame();
    await w.monetize.offerDoubleCoins();
    w.monetize.onNewGame();
    expect(w.monStore.state.day.rw2).toBe(3);
    expect(await w.monetize.offerDoubleCoins()).toBe(0);
  });

  it('RW-3 «бустер Молот»: 2/день', async () => {
    const w = makeWorld();
    const before = w.economy.getBooster('hammer');
    expect(await w.monetize.offerFreeBooster()).toBe(true);
    expect(await w.monetize.offerFreeBooster()).toBe(true);
    expect(w.economy.getBooster('hammer')).toBe(before + 2);
    expect(w.monetize.canFreeBooster()).toBe(false);
    expect(await w.monetize.offerFreeBooster()).toBe(false); // кап дня
    expect(w.adProvider.rwPlacements.filter((p) => p === 'RW-3')).toHaveLength(2);
  });

  it('RW-4 «×2 награда дня»: +100🪙, 2/день', async () => {
    const w = makeWorld();
    const before = w.economy.getCoins();
    expect(await w.monetize.offerDoubleStreak()).toBe(true);
    expect(await w.monetize.offerDoubleStreak()).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 200);
    expect(await w.monetize.offerDoubleStreak()).toBe(false);
    expect(w.monStore.state.day.rw4).toBe(2);
  });

  it('новый день (simOffset меты) сбрасывает дневные капы', async () => {
    const w = makeWorld();
    await w.monetize.offerFreeBooster();
    await w.monetize.offerFreeBooster();
    expect(w.monetize.canFreeBooster()).toBe(false);
    w.metaStore.state.meta.simOffset = 1; // «Новый день (тест)» Прохода Б
    expect(w.monetize.canFreeBooster()).toBe(true);
    expect(w.monStore.state.day.rw3).toBe(0); // счётчики пересозданы
  });

  it('воронка офферов: shown/accepted и выручка rewarded в сессии', async () => {
    const w = makeWorld();
    w.monetize.noteGameOverOffersShown(); // RW-1 + RW-2 видны
    w.monetize.noteMetaOffersShown();     // RW-3 + RW-4 видны
    await w.monetize.offerFreeBooster();
    const s = w.monetize.getSession();
    expect(s.offers.shown).toBe(4);
    expect(s.offers.accepted).toBe(1);
    expect(s.imp.rw).toBe(1);
    expect(s.revByFormat.rw).toBeCloseTo(0.016, 6);
  });

  it('rewarded не досмотрен → награды нет', async () => {
    const w = makeWorld();
    w.adProvider.rewardedCompleted = false;
    const before = w.economy.getBooster('hammer');
    expect(await w.monetize.offerFreeBooster()).toBe(false);
    expect(w.economy.getBooster('hammer')).toBe(before);
    expect(w.monStore.state.day.rw3).toBe(0); // кап не потрачен
  });

  it('reward-once при гонке: двойной вызов оффера до конца показа — награда одна', async () => {
    // Капы проверяются ДО await показа: без замка adInFlight двойной тап по
    // кнопке оффера (пока прод-SDK ещё не открыл ролик) удваивал бы награду.
    const w = makeWorld();
    w.economy.resetEarnedThisGame();
    w.economy.addCoins(40, 'level', true);
    const before = w.economy.getCoins();
    const [a, b] = await Promise.all([
      w.monetize.offerDoubleCoins(),
      w.monetize.offerDoubleCoins()
    ]);
    expect(w.economy.getCoins()).toBe(before + 40); // не +80
    expect([a, b].sort((x, y) => x - y)).toEqual([0, 40]);
    expect(w.monStore.state.day.rw2).toBe(1);

    // RW-1: конкурентное оживление — поле оживает один раз, показ один.
    const state = createGame(7);
    state.gameOver = true;
    const shownBefore = w.adProvider.rwPlacements.length;
    const [r1, r2] = await Promise.all([
      w.monetize.offerRevive(state),
      w.monetize.offerRevive(state)
    ]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect(w.adProvider.rwPlacements.length).toBe(shownBefore + 1);
  });
});

/* ========================= eCPM: ПОРЯДОК ВЕЛИЧИН ========================= */

describe('eCPM-модель (06 §4): порядок величин, инжектированный RNG', () => {
  it('rng=0.5 → ровно бенчмарк: rewarded Tier-1 = $0.016/показ', () => {
    expect(genRevenue('rw', 'tier1', () => 0.5)).toBeCloseTo(0.016, 10);
    expect(genRevenue('int', 'tier1', () => 0.5)).toBeCloseTo(0.014, 10);
    expect(genRevenue('banner', 'blend', () => 0.5)).toBeCloseTo(0.0004, 10);
  });

  it('джиттер ±25%: края диапазона', () => {
    expect(genRevenue('rw', 'tier1', () => 1)).toBeCloseTo(0.02, 10); // 16 × 1.25 / 1000
    expect(genRevenue('rw', 'tier1', () => 0)).toBeCloseTo(0.012, 10); // 16 × 0.75 / 1000
  });

  it('случайные показы остаются в коридоре ±25% вокруг бенчмарка', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 50; i++) {
      const rev = genRevenue('rw', 'tier1', rng);
      expect(rev).toBeGreaterThanOrEqual(0.012);
      expect(rev).toBeLessThanOrEqual(0.02);
    }
  });

  it('порядок форматов и гео: RW > INT > BAN; tier1 > blend > tier23', () => {
    expect(ecpmFor('rw', 'blend')).toBeGreaterThan(ecpmFor('int', 'blend'));
    expect(ecpmFor('int', 'blend')).toBeGreaterThan(ecpmFor('banner', 'blend'));
    expect(ECPM.rw.tier1).toBeGreaterThan(ECPM.rw.blend);
    expect(ECPM.rw.blend).toBeGreaterThan(ECPM.rw.tier23);
    // Значения 1:1 из прототипа/06 §4:
    expect(ECPM.rw).toEqual({ tier1: 16.0, blend: 13.0, tier23: 6.4 });
    expect(ECPM.int).toEqual({ tier1: 14.0, blend: 10.0, tier23: 5.6 });
    expect(ECPM.banner).toEqual({ tier1: 0.5, blend: 0.4, tier23: 0.2 });
  });

  it('SimAdProvider: показ без DOM резолвится и шлёт impression с выручкой', async () => {
    const sim = new SimAdProvider({ rng: () => 0.5 });
    sim.setGeo('tier1');
    const impressions: AdImpression[] = [];
    sim.onImpression = (imp) => impressions.push(imp);
    const res = await sim.showRewarded('RW-2');
    expect(res.completed).toBe(true);
    expect(res.revenueUsd).toBeCloseTo(0.016, 10);
    expect(impressions).toHaveLength(1);
    expect(impressions[0].format).toBe('rw');
    expect(impressions[0].ecpmUsd).toBe(16);
  });
});

/* ==================== САНИТАЙЗИНГ blocksurge_monetize ==================== */

describe('сейв blocksurge_monetize: схема и санитайзинг (порт MonStore)', () => {
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
      skins: 'nope',
      day: { date: 7, int: 'abc', rw2: 3.9, rw3: -5, rw4: NaN },
      lifetime: {
        adRev: Number.POSITIVE_INFINITY,
        iapRev: 'abc',
        imp: { int: '7', rw: null, banner: 2.5 },
        iapCount: -3
      }
    });
    expect(s.v).toBe(1);
    expect(s.removeAds).toBe(true);
    expect(s.subscription).toEqual({ active: false, since: '', lastDaily: '' });
    expect(s.geoTier).toBe('blend'); // неизвестное гео → дефолт
    expect(s.skins).toEqual([]);
    expect(s.day).toEqual({ date: '', int: 0, rw2: 3, rw3: 0, rw4: 0 });
    expect(s.lifetime.adRev).toBe(0); // Infinity не должна попасть в дашборд
    expect(s.lifetime.iapRev).toBe(0);
    expect(s.lifetime.imp).toEqual({ int: 7, rw: 0, banner: 2 });
    expect(s.lifetime.iapCount).toBe(0);
  });

  it('сейв прототипа подхватывается 1:1 без миграции', () => {
    const raw = JSON.stringify({
      v: 1,
      removeAds: true,
      subscription: { active: true, since: '2026-07-10', lastDaily: '2026-07-17' },
      geoTier: 'tier1',
      skins: ['aurora'],
      frame: false,
      pass: true,
      day: { date: '2026-07-17', int: 4, rw2: 1, rw3: 2, rw4: 0 },
      lifetime: { adRev: 1.25, iapRev: 12.98, imp: { int: 40, rw: 12, banner: 200 }, iapCount: 3 }
    });
    const store = new MonetizeStore(
      new (class implements KeyValueStorage {
        getItem(k: string): string | null {
          return k === MONETIZE.STORAGE_KEY ? raw : null;
        }
        setItem(): void {}
      })()
    );
    expect(store.state.removeAds).toBe(true);
    expect(store.state.subscription.active).toBe(true);
    expect(store.state.geoTier).toBe('tier1');
    expect(store.state.skins).toEqual(['aurora']);
    expect(store.state.pass).toBe(true);
    expect(store.state.day.int).toBe(4);
    expect(store.state.lifetime.iapRev).toBeCloseTo(12.98, 6);
  });

  it('битый JSON в ключе → чистый старт без краша', () => {
    const storage = new MemStorage();
    storage.setItem(MONETIZE.STORAGE_KEY, '{"v":1, СЛОМАНО');
    const store = new MonetizeStore(storage);
    expect(store.state).toEqual(monetizeDefaults());
    // …и контроллер поверх такого сейва стартует (ensureDay проставит дату дня).
    const w = makeWorld({ monRaw: '{"v":1, СЛОМАНО' });
    expect(w.monStore.state.day.date).not.toBe('');
    expect(w.monStore.state.lifetime.adRev).toBe(0);
  });

  it('контроллер пишет ту же структуру ключей, что и прототип', async () => {
    const w = makeWorld();
    await w.monetize.offerFreeBooster();
    const parsed = JSON.parse(w.monStorage.getItem(MONETIZE.STORAGE_KEY) as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['v', 'removeAds', 'subscription', 'geoTier', 'skins', 'frame', 'pass', 'day', 'lifetime'].sort()
    );
    const day = parsed.day as Record<string, unknown>;
    expect(Object.keys(day).sort()).toEqual(['date', 'int', 'rw2', 'rw3', 'rw4'].sort());
  });
});

/* ============================== IAP (06 §5) ============================== */

describe('полка IAP и SimPurchaseProvider (СИМУЛЯЦИЯ)', () => {
  it('11 SKU с ценами прототипа 1:1', () => {
    expect(IAP_SHELF).toHaveLength(11);
    expect(IAP_SHELF.map((s) => s.price)).toEqual([
      0.99, 1.99, 2.99, 4.99, 4.99, 4.99, 9.99, 19.99, 49.99, 99.99, 7.99
    ]);
    expect(findSku('remove_ads')?.grant.removeAds).toBe(true);
    expect(findSku('sub')?.grant.subscription).toBe(true);
    expect(findSku('nope')).toBeNull();
  });

  it('Remove Ads: покупка выключает INT+BAN, rewarded остаётся', async () => {
    const w = makeWorld();
    w.clock.advance(31000);
    w.monetize.updateBanner();
    expect(w.adProvider.bannerOn).toBe(true);
    expect(await w.monetize.purchase('remove_ads')).toBe(true);
    expect(w.monetize.adsRemoved()).toBe(true);
    expect(w.adProvider.bannerOn).toBe(false); // баннер спрятан
    expect(w.monetize.interstitialBlockReason()).toBe('remove_ads');
    expect(await w.monetize.offerFreeBooster()).toBe(true); // rewarded работает
    expect(w.monetize.getSession().iapRev).toBeCloseTo(4.99, 6);
    expect(w.monStore.state.lifetime.iapCount).toBe(1);
  });

  it('подписка: +200🪙 при покупке + 200🪙/день, второй раз в день — нет', async () => {
    const w = makeWorld();
    const before = w.economy.getCoins();
    await w.monetize.purchase('sub');
    // grant.coins 200 + дневной перк 200 (как в прототипе)
    expect(w.economy.getCoins()).toBe(before + 400);
    w.monetize.onShopOpened(); // тот же день — перк не дублируется
    expect(w.economy.getCoins()).toBe(before + 400);
    w.metaStore.state.meta.simOffset = 1; // новый день
    w.monetize.onShopOpened();
    expect(w.economy.getCoins()).toBe(before + 600);
    expect(w.monStore.state.subscription.active).toBe(true);
  });

  it('пак монет: выдача 1:1 и учёт выручки', async () => {
    const w = makeWorld();
    const before = w.economy.getCoins();
    expect(await w.monetize.purchase('coins_l')).toBe(true);
    expect(w.economy.getCoins()).toBe(before + 8000);
    expect(w.economy.getBooster('undo')).toBe(2);
    expect(w.economy.getBooster('hammer')).toBe(2);
    expect(w.monStore.state.lifetime.iapRev).toBeCloseTo(9.99, 6);
    expect(await w.monetize.purchase('nope')).toBe(false);
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
