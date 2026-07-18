/**
 * Тесты экономики и меты (Проход Е.1) — чистая логика без Phaser/DOM.
 * Проверяются: жёлуди/копилка (кап 200, сгорание, конвертация 1:1),
 * дневной кроссворд по сид-дате + стрик с вехами (04 §3.3), миссии,
 * регионы атласа (04 §3.1) с миграцией, санитайзинг и совместимость
 * сейвов wordgrove.economy.v1 / wordgrove.meta.v1 с прототипом.
 */
import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../src/core/storage';
import { Analytics } from '../src/economy/analytics';
import { ECON } from '../src/economy/econ';
import { Economy, sanitizeEconomySave } from '../src/economy/economy';
import { MISSIONS, REGIONS } from '../src/meta/config';
import { dayOfYear, isYesterday, todayStr } from '../src/meta/dates';
import { Meta, sanitizeMetaSave, type MetaBridge } from '../src/meta/meta';

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

/** Мост-заглушка вместо CoreGame (порт window.WG). */
class MockBridge implements MetaBridge {
  coins = 0;
  level = 0;
  earns: Array<{ n: number; source: string | undefined }> = [];
  getCoins(): number {
    return this.coins;
  }
  addCoins(n: number, source?: string): void {
    this.coins += n;
    this.earns.push({ n, source });
  }
  getCampaignLevel(): number {
    return this.level;
  }
  getTotalLevels(): number {
    return 10;
  }
}

interface World {
  storage: MemStorage;
  economy: Economy;
  meta: Meta;
  bridge: MockBridge;
}

/** Мир меты с in-memory сейвом и замороженными часами (18.07.2026). */
function makeWorld(opts: { metaSave?: string; econSave?: string; date?: Date; level?: number } = {}): World {
  const storage = new MemStorage();
  if (opts.metaSave !== undefined) storage.setItem('wordgrove.meta.v1', opts.metaSave);
  if (opts.econSave !== undefined) storage.setItem('wordgrove.economy.v1', opts.econSave);
  const base = opts.date ?? new Date(2026, 6, 18);
  const economy = new Economy(storage, new Analytics(true));
  const meta = new Meta(economy, new Analytics(true), storage, () => new Date(base.getTime()));
  const bridge = new MockBridge();
  bridge.level = opts.level ?? 0;
  meta.bridge = bridge;
  return { storage, economy, meta, bridge };
}

/* ============================ ЭКОНОМИКА: ЖЁЛУДИ ============================ */

describe('экономика: копилка жёлудей (кап 200, сгорание, конвертация 1:1)', () => {
  it('addAcorns: кап, сгорание, lifetime', () => {
    const { economy } = makeWorld();
    expect(economy.addAcorns(150)).toEqual({ added: 150, burned: 0, full: false });
    expect(economy.addAcorns(100)).toEqual({ added: 50, burned: 50, full: true });
    expect(economy.getAcorns()).toBe(ECON.ACORN_CAP);
    expect(economy.isPiggyFull()).toBe(true);
    expect(economy.getState().acornsLifetime).toBe(200);
    expect(economy.getState().burned).toBe(50);
  });

  it('бонусное слово: +2 (ACORN_PER_BONUS)', () => {
    const { economy } = makeWorld();
    expect(economy.addBonusAcorns().added).toBe(ECON.ACORN_PER_BONUS);
    expect(economy.getAcorns()).toBe(2);
  });

  it('openPiggy: конвертация 1:1 через мост, повторное открытие пустой — 0', () => {
    const { economy } = makeWorld();
    const bridge = new MockBridge();
    economy.coinBridge = bridge;
    economy.addAcorns(80);
    expect(economy.openPiggy()).toBe(80);
    expect(bridge.coins).toBe(80); // 1:1
    expect(economy.getAcorns()).toBe(0);
    expect(economy.getState().piggyOpens).toBe(1);
    expect(economy.openPiggy()).toBe(0);
    expect(economy.getState().piggyOpens).toBe(1);
  });

  it('сейв wordgrove.economy.v1: схема прототипа + санитайзинг', () => {
    const { economy, storage } = makeWorld();
    economy.addAcorns(7);
    const parsed = JSON.parse(storage.getItem('wordgrove.economy.v1') as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['acorns', 'acornsLifetime', 'burned', 'piggyOpens']);
    expect(parsed.acorns).toBe(7);

    // Фикстура прототипа подхватывается
    const w2 = makeWorld({ econSave: JSON.stringify({ acorns: 150, acornsLifetime: 300, piggyOpens: 2, burned: 10 }) });
    expect(w2.economy.getAcorns()).toBe(150);
    expect(w2.economy.getState().piggyOpens).toBe(2);

    // Санитайзинг мусора
    const s = sanitizeEconomySave({ acorns: 999, acornsLifetime: Infinity, piggyOpens: 'abc', burned: -5 });
    expect(s.acorns).toBe(ECON.ACORN_CAP); // клип к капу
    expect(s.acornsLifetime).toBe(0);
    expect(s.piggyOpens).toBe(0);
    expect(s.burned).toBe(0);

    const w3 = makeWorld({ econSave: '{{{не json' });
    expect(w3.economy.getAcorns()).toBe(0);
  });
});

/* ============================ ДАТЫ ============================ */

describe('даты (порт meta.js)', () => {
  it('todayStr / isYesterday / dayOfYear', () => {
    expect(todayStr(new Date(2026, 6, 18))).toBe('2026-07-18');
    expect(isYesterday('2026-07-17', '2026-07-18')).toBe(true);
    expect(isYesterday('2026-06-30', '2026-07-01')).toBe(true); // граница месяца
    expect(isYesterday('2026-07-16', '2026-07-18')).toBe(false);
    expect(isYesterday(null, '2026-07-18')).toBe(false);
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
  });
});

/* ==================== ДНЕВНОЙ КРОССВОРД + СТРИК (04 §3.3) ==================== */

describe('дневной кроссворд: сид-дата, стрик, вехи, идемпотентность', () => {
  it('dailySeedIndex детерминирован и совпадает с формулой прототипа', () => {
    const { meta } = makeWorld();
    const ref = (d: string, total: number): number => {
      let h = 0;
      for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
      return h % total;
    };
    expect(meta.dailySeedIndex()).toBe(ref('2026-07-18', 10));
    expect(meta.dailySeedIndex()).toBe(meta.dailySeedIndex());
    expect(meta.dailySeedIndex()).toBeGreaterThanOrEqual(0);
    expect(meta.dailySeedIndex()).toBeLessThan(10);
  });

  it('первое прохождение: +40, стрик 1; повтор в тот же день — already', () => {
    const { meta, bridge } = makeWorld();
    const res = meta.onDailyComplete();
    expect(res).toEqual({ already: false, coins: ECON.DAILY_COINS, streak: 1, milestone: 0 });
    expect(bridge.coins).toBe(ECON.DAILY_COINS);
    expect(meta.isDailyDoneToday()).toBe(true);
    const again = meta.onDailyComplete();
    expect(again.already).toBe(true);
    expect(bridge.coins).toBe(ECON.DAILY_COINS); // без двойной награды
  });

  it('вчера пройден → стрик +1, веха 3 дня даёт +50', () => {
    const { meta, bridge } = makeWorld({
      metaSave: JSON.stringify({
        daily: { lastDate: '2026-07-17', streak: 2, longest: 2 },
        missions: { date: null, list: [] },
        regions: { claimed: {} },
        stats: { bonusTotal: 0, dailyTotal: 4 }
      })
    });
    const res = meta.onDailyComplete();
    expect(res.streak).toBe(3);
    expect(res.milestone).toBe(ECON.STREAK_MILESTONES[3]);
    expect(res.coins).toBe(ECON.DAILY_COINS + 50);
    expect(bridge.coins).toBe(90);
    expect(meta.state.daily.longest).toBe(3);
    expect(meta.state.stats.dailyTotal).toBe(5);
  });

  it('пропуск дня → стрик сбрасывается в 1, longest сохраняется', () => {
    const { meta } = makeWorld({
      metaSave: JSON.stringify({
        daily: { lastDate: '2026-07-15', streak: 6, longest: 6 },
        missions: { date: null, list: [] },
        regions: { claimed: {} },
        stats: { bonusTotal: 0, dailyTotal: 0 }
      })
    });
    const res = meta.onDailyComplete();
    expect(res.streak).toBe(1);
    expect(res.milestone).toBe(0);
    expect(meta.state.daily.longest).toBe(6);
    expect(meta.nextMilestone(1)).toBe(3);
    expect(meta.nextMilestone(30)).toBeNull();
  });
});

/* ============================ МИССИИ (04 §3.5) ============================ */

describe('миссии дня: ротация, прогресс по событиям, забор наград', () => {
  it('ротация по смене даты; вчерашний прогресс не переезжает', () => {
    const { meta } = makeWorld({
      metaSave: JSON.stringify({
        daily: { lastDate: null, streak: 0, longest: 0 },
        missions: {
          date: '2026-07-17',
          list: [{ id: 'bonus5', progress: 4, claimed: false }]
        },
        regions: { claimed: {} },
        stats: { bonusTotal: 0, dailyTotal: 0 }
      })
    });
    meta.ensureMissionsToday();
    expect(meta.state.missions.date).toBe('2026-07-18');
    expect(meta.state.missions.list.length).toBe(MISSIONS.length);
    expect(meta.state.missions.list.every((r) => r.progress === 0 && !r.claimed)).toBe(true);
  });

  it('bonus_word ×5 → миссия bonus5 готова; забор даёт +40 один раз', () => {
    const { meta, bridge } = makeWorld();
    meta.init();
    for (let i = 0; i < 5; i++) meta.emit('bonus_word', { word: 'ТОМ' });
    expect(meta.state.stats.bonusTotal).toBe(5);
    const row = meta.state.missions.list.find((r) => r.id === 'bonus5');
    expect(row?.progress).toBe(5);
    expect(meta.missionsClaimable()).toBe(true);

    expect(meta.claimMission('bonus5')).toBe(true);
    expect(bridge.coins).toBe(40);
    expect(meta.claimMission('bonus5')).toBe(false); // повторный забор
    expect(bridge.coins).toBe(40);
    expect(meta.claimMission('levels3')).toBe(false); // не выполнена
  });

  it('level_complete + perfect → миссии levels3/nohint; nohint даёт монеты И жёлуди', () => {
    const { meta, bridge, economy } = makeWorld();
    meta.init();
    meta.emit('level_complete', { index: 0, perfect: true });
    const rows = meta.state.missions.list;
    expect(rows.find((r) => r.id === 'levels3')?.progress).toBe(1);
    expect(rows.find((r) => r.id === 'nohint')?.progress).toBe(1);
    expect(meta.claimMission('nohint')).toBe(true);
    expect(bridge.earns).toContainEqual({ n: 60, source: 'mission:nohint' });
    expect(economy.getAcorns()).toBe(10);
  });
});

/* ============================ АТЛАС (04 §3.1) ============================ */

describe('атлас: награда региона раз в регион, миграция при init', () => {
  it('регион «grove» закрыт (5 уровней) → +300 один раз', () => {
    const { meta, bridge } = makeWorld({ level: 5 });
    meta.init(); // миграция: молча выдаёт награду
    expect(meta.state.regions.claimed['grove']).toBe(true);
    expect(meta.state.regions.claimed['meadow']).toBeUndefined();
    expect(bridge.earns).toContainEqual({ n: ECON.REGION_REWARD, source: 'region:grove' });

    // Повторная проверка (эмит завершения уровня) не дублирует награду
    bridge.level = 6;
    meta.emit('level_complete', { index: 5, perfect: false });
    const regionEarns = bridge.earns.filter((e) => e.source === 'region:grove');
    expect(regionEarns.length).toBe(1);
  });

  it('вся кампания (10 уровней) → оба региона', () => {
    const { meta, bridge } = makeWorld({ level: 10 });
    meta.init();
    expect(REGIONS.every((r) => meta.state.regions.claimed[r.id])).toBe(true);
    expect(bridge.coins).toBe(ECON.REGION_REWARD * 2);
    expect(meta.regionDone(REGIONS[0])).toBe(true);
  });

  it('регион не закрыт → награды нет', () => {
    const { meta, bridge } = makeWorld({ level: 4 });
    meta.init();
    expect(meta.state.regions.claimed['grove']).toBeUndefined();
    expect(bridge.coins).toBe(0);
  });
});

/* ==================== СЕЙВ МЕТЫ: ФИКСТУРА И САНИТАЙЗИНГ ==================== */

describe('сейв wordgrove.meta.v1: совместимость с прототипом', () => {
  it('фикстура прототипа подхватывается 1:1 (дата миссий = сегодня)', () => {
    const fixture = JSON.stringify({
      daily: { lastDate: '2026-07-17', streak: 2, longest: 4 },
      missions: {
        date: '2026-07-18',
        list: [
          { id: 'bonus5', progress: 3, claimed: false },
          { id: 'levels3', progress: 3, claimed: true },
          { id: 'nohint', progress: 0, claimed: false }
        ]
      },
      regions: { claimed: { grove: true } },
      stats: { bonusTotal: 12, dailyTotal: 5 }
    });
    const { meta, bridge } = makeWorld({ metaSave: fixture, level: 5 });
    meta.init();
    expect(meta.state.daily).toEqual({ lastDate: '2026-07-17', streak: 2, longest: 4 });
    // Дата набора = «сегодня» → ротация НЕ переехала прогресс
    expect(meta.state.missions.list.find((r) => r.id === 'bonus5')?.progress).toBe(3);
    expect(meta.state.missions.list.find((r) => r.id === 'levels3')?.claimed).toBe(true);
    expect(meta.state.stats).toEqual({ bonusTotal: 12, dailyTotal: 5 });
    // Регион уже забран в прототипе → миграция НЕ выдаёт повторно
    expect(bridge.earns.filter((e) => e.source === 'region:grove').length).toBe(0);
  });

  it('порт пишет ту же структуру ключей, что прототип', () => {
    const { meta, storage } = makeWorld();
    meta.init();
    const parsed = JSON.parse(storage.getItem('wordgrove.meta.v1') as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['daily', 'missions', 'regions', 'stats']);
  });

  it('санитайзинг: мусорные миссии/числа не дают забрать награду', () => {
    const s = sanitizeMetaSave({
      daily: { lastDate: 42, streak: 'abc', longest: -1 },
      missions: {
        date: '2026-07-18',
        list: [
          { id: 'bonus5', progress: 'abc', claimed: 1 }, // progress → 0
          { id: 'levels3', progress: 999, claimed: false }, // клип к target
          { id: 'неизвестная', progress: 5, claimed: false }, // отброшена
          'мусор'
        ]
      },
      regions: { claimed: { grove: 1, meadow: 0 } },
      stats: { bonusTotal: Infinity, dailyTotal: 3.9 }
    });
    expect(s.daily).toEqual({ lastDate: null, streak: 0, longest: 0 });
    expect(s.missions.list.length).toBe(2);
    expect(s.missions.list[0]).toEqual({ id: 'bonus5', progress: 0, claimed: true });
    expect(s.missions.list[1].progress).toBe(3); // target levels3
    expect(s.regions.claimed['grove']).toBe(true);
    expect(s.regions.claimed['meadow']).toBeUndefined();
    expect(s.stats).toEqual({ bonusTotal: 0, dailyTotal: 3 });
  });

  it('битый JSON меты → дефолты без краша', () => {
    const { meta } = makeWorld({ metaSave: '{{{не json' });
    expect(meta.state.daily.streak).toBe(0);
    expect(meta.state.missions.list).toEqual([]);
    expect(meta.anyActionable()).toBe(true); // дневной сегодня не пройден
  });
});
