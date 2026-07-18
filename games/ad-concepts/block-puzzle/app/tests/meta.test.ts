/**
 * Тесты слоя экономики и меты (Проход Е.2) — чистая логика без Phaser/DOM.
 * Проверяются: схема/санитайзинг сейва blocksurge_meta (совместимость с
 * прототипом), sources/sinks монет (05 §2), детерминированная ротация миссий,
 * стрик 7 дней (04 §3), карта «Путешествия» (04 §2), дельта-начисление конца
 * партии (защита от двойного начисления) и бустеры в партии.
 */
import { describe, expect, it } from 'vitest';
import { ECON } from '../src/economy/econ';
import { deepMerge, defaults } from '../src/economy/save';
import { Store, type KeyValueStorage } from '../src/economy/store';
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';
import { Meta } from '../src/meta/meta';
import { BoosterController } from '../src/meta/boosters';
import { rollMissions, missionDef } from '../src/meta/missions';
import { MAP_NODES, MISSION_POOL, STREAK_REWARDS } from '../src/meta/config';
import { daysBetween, parseYMD, ymd } from '../src/meta/dates';
import { createGame, placePiece } from '../src/core/game';
import { BOARD_N, canPlace, cloneBoard } from '../src/core/board';
import { DEF } from '../src/core/catalog';
import { solveTriple } from '../src/core/solver';
import type { PieceId } from '../src/core/types';

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

/** Мир меты с in-memory сейвом и замороженными часами (18.07.2026). */
function makeWorld(rawSave?: string, base = new Date(2026, 6, 18)) {
  const storage = new MemStorage();
  if (rawSave !== undefined) storage.setItem(ECON.STORAGE_KEY, rawSave);
  const store = new Store(storage);
  const analytics = new Analytics(true);
  const economy = new Economy(store, analytics);
  const meta = new Meta(store, economy, analytics, () => new Date(base.getTime()));
  return { storage, store, analytics, economy, meta };
}

/** Сейв в формате, который писал прототип (economy.js/meta.js), 1:1 по ключам. */
function prototypeSave(): string {
  return JSON.stringify({
    v: 2,
    economy: { coins: 735, boosters: { undo: 1, swap: 0, hammer: 2 } },
    meta: {
      totalStars: 9,
      mapClaimed: [1, 2],
      streak: { day: 3, count: 5, lastClaim: '2026-07-17' },
      missions: {
        date: '2026-07-18',
        set: ['lines20', 'combo3', 'games2'],
        progress: { lines20: 12 },
        done: ['games2'],
        bonusClaimed: false
      },
      simOffset: 0
    },
    stats: { gamesPlayed: 14 },
    _fresh: false
  });
}

/* ==================== СХЕМА СЕЙВА И САНИТАЙЗИНГ ==================== */

describe('сейв blocksurge_meta: схема и санитайзинг (порт economy.js)', () => {
  it('свежая установка: дефолты, FTUE-бонус 200, ключ прототипа', () => {
    const { storage, store, economy } = makeWorld();
    expect(store.isFreshInstall()).toBe(true);
    expect(economy.getCoins()).toBe(200);
    expect(economy.getBooster('undo')).toBe(0);
    // Economy при fresh install сразу сохраняет — под тем же ключом, что прототип
    const raw = storage.getItem('blocksurge_meta');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(parsed.v).toBe(2);
    expect(parsed).toHaveProperty('economy');
    expect(parsed).toHaveProperty('meta');
    expect(parsed).toHaveProperty('stats');
  });

  it('сейв прототипа подхватывается 1:1 без миграции', () => {
    const { store, economy, meta } = makeWorld(prototypeSave());
    expect(store.isFreshInstall()).toBe(false);
    expect(economy.getCoins()).toBe(735);
    expect(economy.getBooster('undo')).toBe(1);
    expect(economy.getBooster('hammer')).toBe(2);
    const m = meta.metaState;
    expect(m.totalStars).toBe(9);
    expect(m.mapClaimed).toEqual([1, 2]);
    expect(m.streak).toEqual({ day: 3, count: 5, lastClaim: '2026-07-17' });
    // Дата набора совпадает с «сегодня» → ротация НЕ переехала прогресс
    expect(m.missions.set).toEqual(['lines20', 'combo3', 'games2']);
    expect(m.missions.progress.lines20).toBe(12);
    expect(m.missions.done).toEqual(['games2']);
    expect(store.state.stats.gamesPlayed).toBe(14);
  });

  it('обратная совместимость: порт пишет ту же структуру ключей', () => {
    const { storage, economy } = makeWorld(prototypeSave());
    economy.addCoins(10, 'test');
    const parsed = JSON.parse(storage.getItem('blocksurge_meta') as string) as {
      economy: { coins: number; boosters: Record<string, number> };
      meta: { streak: Record<string, unknown>; missions: Record<string, unknown> };
    };
    expect(parsed.economy.coins).toBe(745);
    expect(Object.keys(parsed.economy.boosters).sort()).toEqual(['hammer', 'swap', 'undo']);
    expect(Object.keys(parsed.meta.missions).sort()).toEqual(
      ['bonusClaimed', 'date', 'done', 'progress', 'set'].sort()
    );
  });

  it('битый JSON → чистый старт без краша', () => {
    const { store, economy } = makeWorld('{oops не json');
    expect(store.isFreshInstall()).toBe(true);
    expect(economy.getCoins()).toBe(ECON.START_COINS);
  });

  it('санитайзинг: NaN/Infinity/строки → конечные неотрицательные целые', () => {
    const broken = JSON.stringify({
      v: 2,
      economy: {
        coins: 'abc', // NaN → дефолт 200
        boosters: { undo: '2', swap: 1e400, hammer: -3 } // строка → 2; Infinity → 0; отрицательное → 0
      },
      meta: {
        totalStars: 'x', // NaN → 0
        mapClaimed: 'foo', // не массив → []
        streak: { day: 99, count: -5, lastClaim: 123 }, // клампы и типы
        missions: {
          date: '2026-07-18', // валидная «сегодняшняя» дата — ротация не переедет прогресс
          set: 'bad',
          progress: { lines20: '7.5', combo3: {} }, // 7.5 → 7; объект → 0
          done: {},
          bonusClaimed: 'yes'
        },
        simOffset: '1e999' // Infinity → 0
      },
      stats: { gamesPlayed: 1e400 },
      _fresh: false
    });
    const { store, economy, meta } = makeWorld(broken);
    expect(economy.getCoins()).toBe(200);
    expect(economy.getBooster('undo')).toBe(2);
    expect(economy.getBooster('swap')).toBe(0);
    expect(economy.getBooster('hammer')).toBe(0);
    const m = meta.metaState;
    expect(m.totalStars).toBe(0);
    expect(m.mapClaimed).toEqual([]);
    expect(m.streak.day).toBe(7); // кламп max 7
    expect(m.streak.count).toBe(0);
    expect(m.streak.lastClaim).toBe('');
    expect(m.missions.progress).toEqual({ lines20: 7, combo3: 0 });
    expect(m.missions.set).toEqual([]); // не-массив → []; дата сегодняшняя — без ротации
    expect(m.missions.done).toEqual([]);
    expect(m.missions.bonusClaimed).toBe(true); // truthy-строка → true (как !! в прототипе)
    expect(m.simOffset).toBe(0);
    expect(store.state.stats.gamesPlayed).toBe(0);
  });

  it('deepMerge: частичный сейв дополняется дефолтами', () => {
    const merged = deepMerge(defaults(), { economy: { coins: 50 } }) as {
      economy: { coins: number; boosters: { undo: number } };
      meta: { streak: { day: number } };
      v: number;
    };
    expect(merged.economy.coins).toBe(50);
    expect(merged.economy.boosters.undo).toBe(0); // из дефолтов
    expect(merged.meta.streak.day).toBe(0);
    expect(merged.v).toBe(2);
  });
});

/* ============================ ЭКОНОМИКА ============================ */

describe('экономика: монеты и бустеры (05 §2)', () => {
  it('addCoins округляет и не даёт отрицательный приход', () => {
    const { economy } = makeWorld();
    expect(economy.addCoins(10.6, 'test')).toBe(11);
    expect(economy.getCoins()).toBe(211);
    expect(economy.addCoins(-5, 'test')).toBe(0);
    expect(economy.getCoins()).toBe(211);
  });

  it('spendCoins: недостаток средств не тратит баланс', () => {
    const { economy } = makeWorld();
    expect(economy.spendCoins(1000, 'test')).toBe(false);
    expect(economy.getCoins()).toBe(200);
    expect(economy.spendCoins(80, 'test')).toBe(true);
    expect(economy.getCoins()).toBe(120);
  });

  it('прайсинг бустеров 1:1 со спекой: Отмена 80 / Обмен 120 / Молот 150', () => {
    expect(ECON.BOOSTERS.undo.price).toBe(80);
    expect(ECON.BOOSTERS.swap.price).toBe(120);
    expect(ECON.BOOSTERS.hammer.price).toBe(150);
  });

  it('buyBooster: списывает цену и кладёт в инвентарь; без денег — отказ', () => {
    const { economy } = makeWorld();
    expect(economy.buyBooster('swap')).toBe(true); // 200 − 120
    expect(economy.getCoins()).toBe(80);
    expect(economy.getBooster('swap')).toBe(1);
    expect(economy.buyBooster('hammer')).toBe(false); // 80 < 150
    expect(economy.getBooster('hammer')).toBe(0);
    expect(economy.getCoins()).toBe(80);
  });

  it('consumeBooster: при нуле — false, иначе списывает одну штуку', () => {
    const { economy } = makeWorld();
    expect(economy.consumeBooster('undo')).toBe(false);
    economy.addBooster('undo', 2, 'test');
    expect(economy.consumeBooster('undo')).toBe(true);
    expect(economy.getBooster('undo')).toBe(1);
  });

  it('earnedThisGame копит только внутриигровые начисления', () => {
    const { economy } = makeWorld();
    economy.addCoins(30, 'level', true);
    economy.addCoins(40, 'mission'); // мета-награда — не в счёт партии
    expect(economy.getEarnedThisGame()).toBe(30);
    economy.resetEarnedThisGame();
    expect(economy.getEarnedThisGame()).toBe(0);
  });
});

/* ============================ МИССИИ ============================ */

describe('ежедневные миссии: детерминированная ротация (04 §4.1)', () => {
  it('rollMissions: один день → один и тот же валидный набор из 3', () => {
    const a = rollMissions('2026-07-18');
    const b = rollMissions('2026-07-18');
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    expect(new Set(a).size).toBe(3);
    const poolIds = new Set(MISSION_POOL.map((m) => m.id));
    for (const id of a) expect(poolIds.has(id)).toBe(true);
  });

  it('ротация по датам действительно меняет наборы', () => {
    const sets = new Set<string>();
    for (let d = 1; d <= 10; d++) {
      sets.add(JSON.stringify(rollMissions('2026-07-' + (d < 10 ? '0' + d : d))));
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  it('simNextDay: новая дата → новый набор, прогресс обнулён', () => {
    const { store, meta } = makeWorld();
    const mi = store.state.meta.missions;
    expect(mi.date).toBe('2026-07-18');
    mi.progress[mi.set[0]] = 5;
    meta.simNextDay();
    expect(mi.date).toBe('2026-07-19');
    expect(mi.set).toEqual(rollMissions('2026-07-19'));
    expect(mi.progress).toEqual({});
    expect(mi.done).toEqual([]);
    expect(mi.bonusClaimed).toBe(false);
  });

  it('прогресс add/max, награды и бонус-сундук «все 3»', () => {
    const { store, economy, meta } = makeWorld();
    const mi = store.state.meta.missions;
    mi.set = ['lines20', 'combo3', 'clean1'];
    mi.progress = {};
    mi.done = [];
    mi.bonusClaimed = false;

    meta.onMove(5, 1, false); // +5 монет за линии; lines20: 5
    expect(economy.getCoins()).toBe(205);
    expect(mi.progress.lines20).toBe(5);

    meta.onMove(15, 2, false); // +30 монет (15 × ×2); lines20 → 20 → +40
    expect(mi.done).toContain('lines20');
    expect(economy.getCoins()).toBe(275);
    expect(mi.progress.combo3).toBe(2); // 'max' от множителя

    meta.onMove(1, 3, false); // +3 монеты; combo3 → 3 → +60
    expect(mi.done).toContain('combo3');
    expect(economy.getCoins()).toBe(338);

    meta.onMove(1, 1, true); // +1 линия, +15 чистое поле; clean1 → +50; бонус +60
    expect(mi.done).toContain('clean1');
    expect(mi.bonusClaimed).toBe(true);
    expect(economy.getCoins()).toBe(464);

    // Повторный «чистый» ход не даёт наград по уже закрытым миссиям
    meta.onMove(1, 1, true);
    expect(economy.getCoins()).toBe(480); // только 1 + 15 из ядра экономики
    expect(mi.done.length).toBe(3);
  });

  it('missionDef: известные id из пула, null для чужих', () => {
    expect(missionDef('lines20')?.target).toBe(20);
    expect(missionDef('score25')?.reward).toBe(60);
    expect(missionDef('nope')).toBeNull();
  });
});

/* ====================== КАРТА «ПУТЕШЕСТВИЯ» ====================== */

describe('карта «Путешествия» (04 §2)', () => {
  it('12 узлов, финал на 50★, боссы на 5/9/12', () => {
    expect(MAP_NODES.length).toBe(12);
    expect(MAP_NODES[MAP_NODES.length - 1].stars).toBe(50);
    expect(MAP_NODES.filter((n) => n.boss).map((n) => n.id)).toEqual([5, 9, 12]);
  });

  it('claimNode: залоченный узел не выдаёт награду, готовый — один раз', () => {
    const { store, economy, meta } = makeWorld();
    meta.claimNode(1); // 0★ — рано
    expect(economy.getCoins()).toBe(200);
    store.state.meta.totalStars = 5;
    meta.claimNode(1); // +50
    expect(economy.getCoins()).toBe(250);
    meta.claimNode(1); // повторно — нет
    expect(economy.getCoins()).toBe(250);
    meta.claimNode(3); // узел 3 — бустер «Отмена»
    expect(economy.getBooster('undo')).toBe(1);
    expect(store.state.meta.mapClaimed).toEqual([1, 3]);
  });
});

/* ============================ СТРИК ============================ */

describe('стрик дней (04 §3): 7-дневный цикл, награды 30–150 + Молот', () => {
  it('таблица наград 1:1 со спекой', () => {
    expect(STREAK_REWARDS.map((r) => r.coins)).toEqual([30, 40, 50, 60, 80, 100, 150]);
    expect(STREAK_REWARDS[6].booster).toBe('hammer');
  });

  it('день 1 → 2, повторный забор в тот же день невозможен', () => {
    const { store, economy, meta } = makeWorld();
    expect(meta.streakClaimable()).toBe(true);
    meta.claimStreak(); // день 1: +30
    expect(economy.getCoins()).toBe(230);
    expect(store.state.meta.streak.day).toBe(1);
    expect(meta.streakClaimable()).toBe(false);
    meta.claimStreak(); // не даёт второй раз
    expect(economy.getCoins()).toBe(230);
    meta.simNextDay();
    meta.claimStreak(); // день 2: +40
    expect(store.state.meta.streak).toMatchObject({ day: 2, count: 2 });
    expect(economy.getCoins()).toBe(270);
  });

  it('пропуск 2+ дней сбрасывает цикл на день 1', () => {
    const { store, meta } = makeWorld();
    meta.claimStreak();
    meta.simNextDay();
    meta.simNextDay(); // gap = 2
    meta.claimStreak();
    expect(store.state.meta.streak).toMatchObject({ day: 1, count: 1 });
  });

  it('день 7 даёт 150 монет + Молот, затем цикл заворачивается на день 1', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.streak = { day: 6, count: 6, lastClaim: '2026-07-17' };
    const before = economy.getCoins();
    meta.claimStreak(); // день 7
    expect(store.state.meta.streak.day).toBe(7);
    expect(economy.getCoins()).toBe(before + 150);
    expect(economy.getBooster('hammer')).toBe(1);
    meta.simNextDay();
    meta.claimStreak(); // цикл: снова день 1
    expect(store.state.meta.streak).toMatchObject({ day: 1, count: 8 });
  });
});

/* ================ КОНЕЦ ПАРТИИ: ДЕЛЬТА-НАЧИСЛЕНИЕ ================ */

describe('onGameEnd: звёзды/монеты дельтой — оживление не удваивает (порт meta.js)', () => {
  it('пороги звёзд 800/2000/4000 и монеты floor(score/100)', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.missions.set = []; // изолируем от наград миссий
    meta.onNewGame();
    const end = meta.onGameEnd(2500);
    expect(end.stars).toBe(2);
    expect(store.state.meta.totalStars).toBe(2);
    expect(economy.getEarnedThisGame()).toBe(25); // floor(2500/100)
    expect(store.state.stats.gamesPlayed).toBe(1);
  });

  it('повторный onGameEnd той же партии добирает только прирост', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.missions.set = [];
    meta.onNewGame();
    meta.onGameEnd(2500); // 2★, 25 монет
    meta.onGameEnd(4200); // финал выше: 3★ → дельта 1★; монеты 42 → дельта 17
    expect(store.state.meta.totalStars).toBe(3); // НЕ 2 + 3
    expect(economy.getEarnedThisGame()).toBe(42); // НЕ 25 + 42
    expect(store.state.stats.gamesPlayed).toBe(1); // партия засчитана один раз
  });

  it('повторный вызов с МЕНЬШИМ счётом ничего не отнимает и не добавляет', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.missions.set = [];
    meta.onNewGame();
    meta.onGameEnd(2500);
    meta.onGameEnd(1000); // хуже прежнего — дельты нулевые
    expect(store.state.meta.totalStars).toBe(2);
    expect(economy.getEarnedThisGame()).toBe(25);
  });

  it('onNewGame сбрасывает защиту: новая партия начисляется полностью', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.missions.set = [];
    meta.onNewGame();
    meta.onGameEnd(2500);
    meta.onNewGame();
    expect(economy.getEarnedThisGame()).toBe(0);
    meta.onGameEnd(900); // 1★
    expect(store.state.meta.totalStars).toBe(3); // 2 + 1
    expect(store.state.stats.gamesPlayed).toBe(2);
  });

  it('кап монет конца партии: floor(score/100) не выше 100', () => {
    const { store, economy, meta } = makeWorld();
    store.state.meta.missions.set = [];
    meta.onNewGame();
    const end = meta.onGameEnd(50000);
    expect(end.stars).toBe(3);
    expect(economy.getEarnedThisGame()).toBe(100);
  });

  it('миссия «Набери 2500 очков» закрывается по концу партии (mode max)', () => {
    const { store, economy, meta } = makeWorld();
    const mi = store.state.meta.missions;
    mi.set = ['score25'];
    mi.progress = {};
    mi.done = [];
    mi.bonusClaimed = false;
    meta.onNewGame();
    meta.onGameEnd(2600);
    expect(mi.done).toContain('score25');
    // 26 (конец партии) + 60 (миссия) + 60 (бонус «все из набора»)
    expect(economy.getCoins()).toBe(200 + 26 + 60 + 60);
  });
});

/* ====================== БУСТЕРЫ В ПАРТИИ ====================== */

/** Первый валидный ход текущей руки (слот и позиция). */
function findFirstMove(state: ReturnType<typeof createGame>) {
  for (let slot = 0; slot < 3; slot++) {
    const id = state.hand[slot];
    if (id === null) continue;
    const p = DEF[id];
    for (let r = 0; r <= BOARD_N - p.h; r++) {
      for (let c = 0; c <= BOARD_N - p.w; c++) {
        if (canPlace(state.board, p, r, c)) return { slot, r, c };
      }
    }
  }
  throw new Error('нет валидного хода');
}

describe('бустеры в партии (порт meta.js поверх GameState)', () => {
  it('«Отмена»: снимок восстанавливает поле/руку/счёт, один уровень отмены', () => {
    const { economy } = makeWorld();
    const bc = new BoosterController(economy);
    const s = createGame(42);
    economy.addBooster('undo', 1, 'test');

    const mv = findFirstMove(s);
    bc.snapshot(s);
    const boardBefore = cloneBoard(s.board);
    const handBefore = s.hand.slice();
    expect(placePiece(s, mv.slot, mv.r, mv.c)).not.toBeNull();
    expect(s.board).not.toEqual(boardBefore);

    expect(bc.useUndo(s)).toBe(true);
    expect(s.board).toEqual(boardBefore);
    expect(s.hand).toEqual(handBefore);
    expect(s.score).toBe(0);
    expect(economy.getBooster('undo')).toBe(0);
    expect(bc.useUndo(s)).toBe(false); // снимка больше нет и бустеров ноль
  });

  it('«Обмен»: новая решаемая тройка, счётчик прощения сброшен', () => {
    const { economy } = makeWorld();
    const bc = new BoosterController(economy);
    const s = createGame(7);
    economy.addBooster('swap', 1, 'test');

    expect(bc.useSwap(s)).toBe(true);
    expect(economy.getBooster('swap')).toBe(0);
    expect(s.handMovesMade).toBe(0);
    expect(s.hand.every((id) => id !== null)).toBe(true);
    expect(solveTriple(s.board, s.hand as PieceId[])).toBe(true); // INV-G1
    expect(bc.useSwap(s)).toBe(false); // инвентарь пуст
  });

  it('«Молот»: взводится, пустую клетку не тратит, занятую снимает и разряжается', () => {
    const { economy } = makeWorld();
    const bc = new BoosterController(economy);
    const s = createGame(9);
    economy.addBooster('hammer', 1, 'test');

    expect(bc.isHammerArmed()).toBe(false);
    bc.toggleHammer(s);
    expect(bc.isHammerArmed()).toBe(true);

    expect(bc.hammerAt(s, 0, 0)).toBe(false); // поле пустое — клетка пустая
    expect(bc.isHammerArmed()).toBe(true);
    expect(economy.getBooster('hammer')).toBe(1);

    s.board[3][4] = 2;
    expect(bc.hammerAt(s, 3, 4)).toBe(true);
    expect(s.board[3][4]).toBe(0);
    expect(economy.getBooster('hammer')).toBe(0);
    expect(bc.isHammerArmed()).toBe(false);
  });

  it('после game over бустеры не работают', () => {
    const { economy } = makeWorld();
    const bc = new BoosterController(economy);
    const s = createGame(3);
    economy.addBooster('undo', 1, 'test');
    economy.addBooster('swap', 1, 'test');
    economy.addBooster('hammer', 1, 'test');
    bc.snapshot(s);
    s.gameOver = true;
    expect(bc.useUndo(s)).toBe(false);
    expect(bc.useSwap(s)).toBe(false);
    bc.toggleHammer(s);
    expect(bc.isHammerArmed()).toBe(false);
    expect(economy.getBooster('undo')).toBe(1); // ничего не потрачено
  });
});

/* ============================ ДАТЫ ============================ */

describe('календарь меты (dates.ts)', () => {
  it('ymd/parseYMD симметричны, daysBetween считает целые дни', () => {
    expect(ymd(new Date(2026, 6, 18))).toBe('2026-07-18');
    expect(ymd(parseYMD('2026-01-05'))).toBe('2026-01-05');
    expect(daysBetween('2026-07-17', '2026-07-18')).toBe(1);
    expect(daysBetween('2026-06-30', '2026-07-02')).toBe(2); // через границу месяца
    expect(daysBetween('', '2026-07-18')).toBe(999);
  });
});
