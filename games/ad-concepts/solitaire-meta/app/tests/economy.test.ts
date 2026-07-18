/**
 * Тесты экономики (Проход Е.1) — две валюты, формулы E/W/M (05 §5.2),
 * бустеры/ундо, схема сейва orchardPeaks.meta: санитайзинг, deepMerge,
 * миграция legacy-монет Прохода А и ФИКСТУРА сейва прототипа (совместимость
 * без миграции — обязательное требование порта).
 */
import { describe, expect, it } from 'vitest';
import { ECON, entryCostFor, fmt, round10, winMultFor, winRewardFor } from '../src/economy/econ';
import { defaults, deepMerge, sanitize } from '../src/economy/save';
import { Store } from '../src/economy/store';
import { BASE_MS, MemStorage, makeWorld } from './helpers';
import { weekKeyOf } from '../src/meta/dates';

/* ==================== ФОРМУЛЫ E(n) / M(n) / W(n) ==================== */

describe('формулы экономики 05 §5.2', () => {
  it('взнос E(n) = 350·1.012ⁿ с округлением до 10', () => {
    expect(entryCostFor(1)).toBe(350);
    expect(entryCostFor(10)).toBe(390);
    expect(entryCostFor(60)).toBe(720);
    expect(entryCostFor(100)).toBe(1150); // контрольная точка из 05 §5.6
  });

  it('множитель M(n) = 2.2 − 0.7·min(1, n/60): плато 1.5 после колена', () => {
    expect(winMultFor(0)).toBeCloseTo(2.2, 10);
    expect(winMultFor(30)).toBeCloseTo(1.85, 10);
    expect(winMultFor(60)).toBeCloseTo(1.5, 10); // float 2.2−0.7, как в прототипе
    expect(winMultFor(500)).toBeCloseTo(1.5, 10);
  });

  it('выигрыш W(n) = M(n)·E(n): всегда больше взноса (победа в плюс)', () => {
    expect(winRewardFor(1)).toBe(770);
    expect(winRewardFor(100)).toBe(1730); // ≈1725 из 05 §5.6 с округлением до 10
    for (const n of [1, 20, 60, 150, 300]) {
      expect(winRewardFor(n)).toBeGreaterThan(entryCostFor(n));
    }
  });

  it('round10 и формат «42.1K» (05 §5.5)', () => {
    expect(round10(354.2)).toBe(350);
    expect(round10(716.6)).toBe(720);
    expect(fmt(9999)).toBe('9999');
    expect(fmt(42130)).toBe('42.1K');
    expect(fmt(2500000)).toBe('2.50M');
    expect(fmt(-500)).toBe('-500');
  });
});

/* ==================== ВАЛЮТЫ / БУСТЕРЫ / УНДО ==================== */

describe('Economy: монеты, урожай, бустеры', () => {
  it('стартовый баланс 05 §5.3: 1000 💰, 20 🍎, джокер, 2 ундо', () => {
    const w = makeWorld();
    expect(w.economy.getCoins()).toBe(ECON.START_COINS);
    expect(w.economy.getHarvest()).toBe(ECON.START_HARVEST);
    expect(w.economy.getLevel()).toBe(1);
    expect(w.economy.getBooster('joker')).toBe(ECON.START_JOKER);
    expect(w.economy.getBooster('basket')).toBe(0);
    expect(w.economy.getFreeUndos()).toBe(ECON.START_UNDO);
    expect(w.store.isFreshInstall()).toBe(true);
  });

  it('addCoins/spendCoins: приход, недостаток средств, earned-счётчик уровня', () => {
    const w = makeWorld();
    w.economy.addCoins(500, 'win', true);
    expect(w.economy.getCoins()).toBe(1500);
    expect(w.economy.getEarnedThisLevel()).toBe(500);
    expect(w.economy.spendCoins(9999, 'entry')).toBe(false);
    expect(w.economy.spendCoins(1500, 'entry')).toBe(true);
    expect(w.economy.getCoins()).toBe(0);
    w.economy.resetEarnedThisLevel();
    expect(w.economy.getEarnedThisLevel()).toBe(0);
  });

  it('урожай: банкуется и тратится только при достатке', () => {
    const w = makeWorld();
    w.economy.addHarvest(8, 'cards');
    expect(w.economy.getHarvest()).toBe(28);
    expect(w.economy.spendHarvest(100)).toBe(false);
    expect(w.economy.spendHarvest(28)).toBe(true);
    expect(w.economy.getHarvest()).toBe(0);
  });

  it('бустеры: покупка за монеты, кап инвентаря 9 (05 §5.5)', () => {
    const w = makeWorld();
    expect(w.economy.buyBooster('joker')).toBe(false); // 1200 > 1000
    w.economy.addCoins(5000, 'test');
    expect(w.economy.buyBooster('basket')).toBe(true); // 800
    expect(w.economy.getBooster('basket')).toBe(1);
    w.economy.addBooster('basket', 99, 'test');
    expect(w.economy.getBooster('basket')).toBe(ECON.BOOSTERS.basket.cap); // кап 9
    expect(w.economy.buyBooster('basket')).toBe(false); // инвентарь полон
    expect(w.economy.consumeBooster('basket')).toBe(true);
    expect(w.economy.getBooster('basket')).toBe(8);
  });

  it('ундо: 2 бесплатных → платное за 150 → отказ без монет', () => {
    const w = makeWorld();
    expect(w.economy.useUndo()).toBe('free');
    expect(w.economy.useUndo()).toBe('free');
    expect(w.economy.useUndo()).toBe('paid'); // −150 из 1000
    expect(w.economy.getCoins()).toBe(1000 - ECON.UNDO_PRICE);
    w.economy.spendCoins(850, 'test');
    expect(w.economy.getCoins()).toBe(0);
    expect(w.economy.useUndo()).toBeNull();
  });

  it('бонус за сток: 25 × номер главы за карту (глава = зона активного заказа + 1)', () => {
    const w = makeWorld();
    expect(w.economy.stockBonus(4)).toBe(100); // глава 1
    w.store.state.garden.completed = 4; // активный заказ — зона «Клумбы»
    expect(w.economy.stockBonus(4)).toBe(200); // глава 2
    expect(w.economy.stockBonus(-3)).toBe(0);
  });
});

/* ==================== СХЕМА СЕЙВА / САНИТАЙЗИНГ ==================== */

describe('сейв orchardPeaks.meta: deepMerge + sanitize', () => {
  it('частичный сейв дополняется дефолтами (без потери новых механик)', () => {
    const st = sanitize(deepMerge(defaults(), { economy: { coins: 500 } }));
    expect(st.economy.coins).toBe(500);
    expect(st.economy.harvest).toBe(ECON.START_HARVEST);
    expect(st.economy.boosters.joker).toBe(ECON.START_JOKER);
    expect(st.garden.completed).toBe(0);
  });

  it('повреждённые значения гасятся: типы, границы, Infinity', () => {
    const st = sanitize(
      deepMerge(defaults(), {
        economy: {
          coins: 'abc', // не число → дефолт
          harvest: -50, // отрицательное → 0
          level: 0, // ниже минимума → 1
          boosters: { joker: 99, basket: -2 }, // кап 9 / минимум 0
          freeUndos: 2.9 // дробное → целое
        },
        garden: { completed: 2.5, cards: '7' }, // индекс FLAT только целый
        almanac: Number.POSITIVE_INFINITY, // 1e400 из JSON → не конечное
        streak: { day: 12, lastClaim: 42 }, // день ≤ 7, дата — строка
        missions: { prog: [1, 2], claimed: 'x' } // контейнеры — объекты
      })
    );
    expect(st.economy.coins).toBe(ECON.START_COINS);
    expect(st.economy.harvest).toBe(0);
    expect(st.economy.level).toBe(1);
    expect(st.economy.boosters.joker).toBe(9);
    expect(st.economy.boosters.basket).toBe(0);
    expect(st.economy.freeUndos).toBe(2);
    expect(st.garden.completed).toBe(2);
    expect(st.garden.cards).toBe(0);
    expect(st.almanac).toBe(0);
    expect(st.streak.day).toBe(7);
    expect(st.streak.lastClaim).toBe('');
    expect(st.missions.prog).toEqual({});
    expect(st.missions.claimed).toEqual({});
  });

  it('битый JSON в ключе → чистый старт без краша', () => {
    const storage = new MemStorage();
    storage.setItem(ECON.META_KEY, '{оборванный json');
    const store = new Store(storage);
    expect(store.state.economy.coins).toBe(ECON.START_COINS);
  });
});

/* ==================== СОВМЕСТИМОСТЬ С ПРОТОТИПОМ ==================== */

/** Сейв в формате, который писал прототип (economy.js), 1:1 по ключам. */
function prototypeSave(): string {
  return JSON.stringify({
    v: 1,
    economy: {
      coins: 4321,
      harvest: 87,
      level: 12,
      boosters: { joker: 2, basket: 1 },
      freeUndos: 1
    },
    garden: { completed: 5, cards: 2 },
    almanac: 50,
    streak: { day: 3, lastClaim: '2026-07-17' },
    missions: {
      day: '2026-07-18',
      week: weekKeyOf(BASE_MS),
      prog: { d_harvest: 10, w_wins: 4 },
      claimed: { d_chain: true }
    },
    stats: { simDayOffset: 0 },
    _fresh: false
  });
}

describe('фикстура сейва прототипа (те же ключи, БЕЗ миграции)', () => {
  it('весь прогресс прототипа подхватывается прод-портом', () => {
    const w = makeWorld(prototypeSave());
    expect(w.economy.getCoins()).toBe(4321);
    expect(w.economy.getHarvest()).toBe(87);
    expect(w.economy.getLevel()).toBe(12);
    expect(w.economy.getBooster('joker')).toBe(2);
    expect(w.economy.getBooster('basket')).toBe(1);
    expect(w.economy.getFreeUndos()).toBe(1);
    expect(w.meta.gardenCompleted()).toBe(5);
    expect(w.meta.herbCards()).toBe(2);
    expect(w.meta.almanacPoints()).toBe(50);
    expect(w.store.isFreshInstall()).toBe(false);
    // Зона активного заказа — «Клумбы» (заказы 4..7) → глава 2.
    expect(w.meta.currentChapter()).toBe(2);
    // Стрик: вчера забран день 3 → сегодня доступен день 4.
    expect(w.meta.streakStatus()).toEqual({ claimable: true, day: 4 });
    // Миссии сегодняшнего дня не сброшены конструктором.
    expect(w.meta.missionProgress('d_harvest')).toBe(10);
    expect(w.meta.missionProgress('w_wins')).toBe(4);
    expect(w.meta.missionClaimed('d_chain')).toBe(true);
  });

  it('save() пишет тот же ключ + дублирует монеты в legacy-ключ Прохода А', () => {
    const w = makeWorld(prototypeSave());
    w.economy.addCoins(79, 'test');
    const raw = w.storage.getItem(ECON.META_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { economy: { coins: number } };
    expect(parsed.economy.coins).toBe(4400);
    expect(w.storage.getItem(ECON.LEGACY_COINS)).toBe('4400');
  });

  it('миграция Прохода А: только orchardPeaks.coins → монеты переносятся', () => {
    const storage = new MemStorage();
    storage.setItem(ECON.LEGACY_COINS, '7777');
    const store = new Store(storage);
    expect(store.state.economy.coins).toBe(7777);
    expect(store.state.economy.harvest).toBe(ECON.START_HARVEST); // остальное — дефолты
    expect(store.isFreshInstall()).toBe(false); // не совсем новый игрок
  });

  it('roundtrip: изменённое состояние читается новым Store бит-в-бит', () => {
    const storage = new MemStorage();
    const w1 = (() => {
      const store = new Store(storage);
      store.state.economy.coins = 999;
      store.state.garden.completed = 7;
      store.state.streak.day = 5;
      store.save();
      return store.state;
    })();
    const store2 = new Store(storage);
    expect(store2.state.economy.coins).toBe(w1.economy.coins);
    expect(store2.state.garden.completed).toBe(7);
    expect(store2.state.streak.day).toBe(5);
    expect(store2.isFreshInstall()).toBe(false);
  });
});
