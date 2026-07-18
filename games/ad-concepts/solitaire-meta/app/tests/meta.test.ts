/**
 * Тесты меты (Проход Е.1) — сад 4 зоны × 4 заказа (04 §4.2), стрик «Утренняя
 * лейка» и миссии (04 §4.4). Часы инжектированы — время двигается тестами
 * (клетка now.ms) и кнопкой «Новый день (тест)» (simDayOffset, как в прототипе).
 */
import { describe, expect, it } from 'vitest';
import { ECON } from '../src/economy/econ';
import { FLAT, TOTAL_ORDERS, ZONES, zoneCompleteBonus } from '../src/meta/config';
import { streakRewardFor } from '../src/meta/meta';
import { DAY_MS } from '../src/meta/dates';
import { makeWorld } from './helpers';

/* ==================== ДАННЫЕ САДА ==================== */

describe('конфиг сада 04 §4.2', () => {
  it('4 зоны × 4 заказа = 16, зоны индексируются подряд', () => {
    expect(ZONES).toHaveLength(4);
    expect(TOTAL_ORDERS).toBe(16);
    expect(FLAT).toHaveLength(16);
    expect(ZONES[0].startIndex).toBe(0);
    expect(ZONES[0].endIndex).toBe(4);
    expect(ZONES[3].endIndex).toBe(16);
    expect(FLAT[4].zoneIdx).toBe(1);
    expect(FLAT[15].zoneIdx).toBe(3);
  });

  it('бонус завершения зоны растёт: 1000 + 500·индекс', () => {
    expect(zoneCompleteBonus(0)).toBe(1000);
    expect(zoneCompleteBonus(3)).toBe(2500);
  });
});

/* ==================== ЗАКАЗЫ ==================== */

describe('заказы сада: списание урожая/монет, награды, зоны', () => {
  it('заказ недоступен без урожая; после добора — списывает и награждает', () => {
    const w = makeWorld(); // старт: 1000 💰, 20 🍎; первый заказ стоит 40 🍎
    expect(w.meta.canComplete(w.meta.activeOrder())).toBe(false);
    expect(w.meta.completeActiveOrder()).toBeNull();

    w.economy.addHarvest(20, 'cards'); // теперь 40
    const res = w.meta.completeActiveOrder();
    expect(res).not.toBeNull();
    expect(res?.zoneCompleted).toBeNull();
    expect(w.economy.getHarvest()).toBe(0); // 40 списано
    expect(w.economy.getCoins()).toBe(1120); // +120 награда
    expect(w.meta.gardenCompleted()).toBe(1);
    expect(w.meta.almanacPoints()).toBe(10);
  });

  it('4-й заказ закрывает зону: крупный бонус + карточка гербария', () => {
    const w = makeWorld();
    w.economy.addHarvest(1000, 'test');
    w.economy.addCoins(1000, 'test'); // на costC заказа «Починить скамейку»
    let zoneBonus: number | null = null;
    for (let i = 0; i < 4; i++) {
      const res = w.meta.completeActiveOrder();
      expect(res).not.toBeNull();
      if (res?.zoneCompleted) zoneBonus = res.zoneCompleted.bonus;
    }
    expect(zoneBonus).toBe(1000); // зона 0
    expect(w.meta.herbCards()).toBe(1);
    expect(w.meta.gardenCompleted()).toBe(4);
    expect(w.meta.currentChapter()).toBe(2); // активный заказ — «Клумбы»
  });

  it('глава = зоне активного заказа; пройденный сад держит последнюю', () => {
    const w = makeWorld();
    expect(w.meta.currentChapter()).toBe(1);
    w.store.state.garden.completed = TOTAL_ORDERS;
    expect(w.meta.currentChapter()).toBe(ZONES.length);
    expect(w.meta.activeOrder()).toBeNull();
  });
});

/* ==================== СТРИК «УТРЕННЯЯ ЛЕЙКА» ==================== */

describe('стрик 04 §4.4: день 1..7, пропуск сбрасывает', () => {
  it('таблица наград: день 3 даёт ундо, день 7+ — лукошко', () => {
    expect(streakRewardFor(1)).toEqual({ coins: 200 });
    expect(streakRewardFor(3)).toEqual({ coins: 400, undo: 1 });
    expect(streakRewardFor(7)).toEqual({ coins: 1500, basket: 1 });
    expect(streakRewardFor(99).coins).toBe(1500); // ≥7 держится на 7
  });

  it('забор наград три дня подряд: 200 → 300 → 400 (+1 ундо)', () => {
    const w = makeWorld();
    expect(w.meta.streakStatus()).toEqual({ claimable: true, day: 1 });
    expect(w.meta.claimStreak()).toBe(true);
    expect(w.economy.getCoins()).toBe(1200);
    expect(w.meta.claimStreak()).toBe(false); // сегодня уже забрано
    w.now.ms += DAY_MS;
    expect(w.meta.streakStatus()).toEqual({ claimable: true, day: 2 });
    w.meta.claimStreak();
    w.now.ms += DAY_MS;
    expect(w.meta.claimStreak()).toBe(true); // день 3
    expect(w.economy.getCoins()).toBe(1200 + 300 + 400);
    expect(w.economy.getFreeUndos()).toBe(ECON.START_UNDO + 1);
  });

  it('пропуск дня сбрасывает стрик на день 1', () => {
    const w = makeWorld();
    w.meta.claimStreak();
    w.now.ms += 2 * DAY_MS; // день пропущен
    expect(w.meta.streakStatus()).toEqual({ claimable: true, day: 1 });
  });

  it('кнопка «Новый день (тест)» двигает виртуальное «сегодня» (simDayOffset)', () => {
    const w = makeWorld();
    w.meta.claimStreak();
    w.meta.newDay();
    expect(w.store.state.stats.simDayOffset).toBe(1);
    expect(w.meta.streakStatus()).toEqual({ claimable: true, day: 2 });
  });
});

/* ==================== МИССИИ ==================== */

describe('миссии 04 §4.4: прогресс, награды, ротация', () => {
  it('прогресс капится на target и не идёт после забора', () => {
    const w = makeWorld();
    w.meta.track('harvest', 10);
    expect(w.meta.missionProgress('d_harvest')).toBe(10);
    w.meta.track('harvest', 40);
    expect(w.meta.missionProgress('d_harvest')).toBe(25); // target
    expect(w.meta.claimMission('d_harvest')).toBe(true);
    expect(w.economy.getCoins()).toBe(1200); // +200
    expect(w.meta.claimMission('d_harvest')).toBe(false); // повторно нельзя
    w.meta.track('harvest', 5);
    expect(w.meta.missionProgress('d_harvest')).toBe(25); // прогресс заморожен
  });

  it('награда до выполнения не выдаётся; неизвестная миссия — false', () => {
    const w = makeWorld();
    expect(w.meta.claimMission('d_chain')).toBe(false);
    w.meta.track('chain5', 1);
    expect(w.meta.claimMission('d_chain')).toBe(true);
    expect(w.meta.claimMission('no_such_mission')).toBe(false);
  });

  it('недельная миссия даёт карточку гербария', () => {
    const w = makeWorld();
    w.meta.track('wins', 12);
    expect(w.meta.claimMission('w_wins')).toBe(true);
    expect(w.economy.getCoins()).toBe(1000 + 1200);
    expect(w.meta.herbCards()).toBe(1);
  });

  it('смена дня сбрасывает дневные, но хранит недельную в той же неделе', () => {
    const w = makeWorld();
    w.meta.track('harvest', 10);
    w.meta.track('wins', 3);
    w.now.ms += DAY_MS; // базовая дата — середина недели weekKey (helpers)
    w.meta.refreshMissions();
    expect(w.meta.missionProgress('d_harvest')).toBe(0);
    expect(w.meta.missionProgress('w_wins')).toBe(3);
  });

  it('смена недели (＋7 дней) сбрасывает недельную миссию', () => {
    const w = makeWorld();
    w.meta.track('wins', 3);
    w.now.ms += 7 * DAY_MS;
    w.meta.refreshMissions();
    expect(w.meta.missionProgress('w_wins')).toBe(0);
  });

  it('выполнение заказа двигает миссию «Выполните заказ в саду»', () => {
    const w = makeWorld();
    w.economy.addHarvest(20, 'test');
    w.meta.completeActiveOrder();
    expect(w.meta.missionProgress('d_order')).toBe(1);
    expect(w.meta.claimMission('d_order')).toBe(true);
  });
});
