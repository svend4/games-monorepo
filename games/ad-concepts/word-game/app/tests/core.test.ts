/**
 * Тесты ядра WordGrove (Проход Е.1) — чистая логика без Phaser/DOM.
 * Проверяются: инварианты всех 10 уровней (node-валидатор Прохода А:
 * составимость/пересечения/связность/раны/бонус-правила), модель сетки,
 * порядок проверки слова 11 §4.1, награда 20+5 с защитой от двойной выдачи,
 * детерминированная подсказка (инжектированный RNG), дневной режим со
 * снимком кампании, схема/санитайзинг сейва wordgrove.save.v1 (фикстура
 * прототипа подхватывается без миграции).
 */
import { describe, expect, it } from 'vitest';
import { HINT_COST, PERFECT_BONUS, START_COINS, WIN_REWARD } from '../src/core/config';
import { CoreGame, type SubmitOutcome, type WinInfo } from '../src/core/game';
import { buildGrid, cellKey } from '../src/core/grid';
import { LEVELS } from '../src/core/levels';
import { fnv1a32, mulberry32 } from '../src/core/rng';
import { sanitizeCoreSave } from '../src/core/save';
import type { KeyValueStorage } from '../src/core/storage';
import type { LevelData } from '../src/core/types';
import { canCompose, validateLevel } from '../src/core/validate';
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';

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

interface World {
  storage: MemStorage;
  economy: Economy;
  game: CoreGame;
  events: Array<{ type: string; payload: unknown }>;
}

function makeWorld(rawCoreSave?: string, seed = 42): World {
  const storage = new MemStorage();
  if (rawCoreSave !== undefined) storage.setItem('wordgrove.save.v1', rawCoreSave);
  const economy = new Economy(storage, new Analytics(true));
  const events: Array<{ type: string; payload: unknown }> = [];
  const game = new CoreGame({
    storage,
    rng: mulberry32(seed),
    acorns: economy,
    hooks: {
      onBonusWord: (word) => events.push({ type: 'bonus_word', payload: word }),
      onLevelComplete: (index, perfect) => events.push({ type: 'level_complete', payload: { index, perfect } })
    }
  });
  return { storage, economy, game, events };
}

/** Решить текущий уровень вводом всех слов сетки; вернуть последний исход. */
function solveLevel(game: CoreGame): SubmitOutcome {
  let last: SubmitOutcome = { kind: 'empty' };
  for (const pw of game.getLevelData().words) {
    last = game.submitWord(pw.w);
  }
  return last;
}

function winOf(outcome: SubmitOutcome): WinInfo {
  expect(outcome.kind).toBe('gridHit');
  const win = outcome.kind === 'gridHit' ? outcome.win : null;
  expect(win).not.toBeNull();
  return win as WinInfo;
}

/* ==================== ВАЛИДАТОР УРОВНЕЙ (Проход А) ==================== */

describe('валидатор уровней: инварианты INV-W1/INV-W2 на всех 10 уровнях', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    it(`уровень ${i + 1} («${LEVELS[i].base}») валиден`, () => {
      expect(validateLevel(LEVELS[i])).toEqual([]);
    });
  }

  it('мультимножество: слово из повторяющихся букв ловится', () => {
    expect(canCompose('МОНЕТА', LEVELS[0].wheel)).toBe(true);
    expect(canCompose('ММА', LEVELS[0].wheel)).toBe(false); // «М» в колесе одна
    expect(canCompose('ЛАПА', LEVELS[1].wheel)).toBe(true); // две «А» есть
  });

  it('сломанные уровни детектируются', () => {
    // Слово не из букв колеса
    const badCompose: LevelData = {
      base: 'ТЕСТ',
      wheel: ['А', 'Б', 'В'],
      size: { w: 5, h: 5 },
      words: [{ w: 'ГДЕ', r: 0, c: 0, d: 'H' }],
      bonus: []
    };
    expect(validateLevel(badCompose).length).toBeGreaterThan(0);

    // Конфликт буквы на пересечении
    const badCross: LevelData = {
      base: 'МОНЕТА',
      wheel: LEVELS[0].wheel,
      size: { w: 6, h: 4 },
      words: [
        { w: 'МОНЕТА', r: 3, c: 0, d: 'H' },
        { w: 'НОТА', r: 0, c: 0, d: 'V' } // (3,0): «А» vs «М» у МОНЕТА
      ],
      bonus: []
    };
    expect(validateLevel(badCross).some((e) => e.includes('пересечения'))).toBe(true);

    // Несвязная сетка (слова не пересекаются)
    const badConnect: LevelData = {
      base: 'МОНЕТА',
      wheel: LEVELS[0].wheel,
      size: { w: 6, h: 6 },
      words: [
        { w: 'ТОМ', r: 0, c: 0, d: 'H' },
        { w: 'ТОН', r: 5, c: 0, d: 'H' }
      ],
      bonus: []
    };
    expect(validateLevel(badConnect).some((e) => e.includes('несвязна'))).toBe(true);

    // Бонус совпадает со словом сетки
    const badBonus: LevelData = { ...LEVELS[0], bonus: ['АТОМ'] };
    expect(validateLevel(badBonus).some((e) => e.includes('совпадает со словом сетки'))).toBe(true);
  });
});

/* ============================ МОДЕЛЬ СЕТКИ ============================ */

describe('модель сетки (buildGrid)', () => {
  it('уровень 1: клетки и раскладка слов', () => {
    const grid = buildGrid(LEVELS[0]);
    // МОНЕТА(6) + АТОМ(4-1) + ТЕМА(4-1) + НОТА(4-1) = 15 уникальных клеток
    expect(grid.cellKeys.length).toBe(15);
    expect(grid.wordCells.get('МОНЕТА')).toEqual(['3,0', '3,1', '3,2', '3,3', '3,4', '3,5']);
    expect(grid.cells.get(cellKey(3, 0))?.letter).toBe('М');
    expect(grid.gridWords.has('АТОМ')).toBe(true);
    expect(grid.bonusWords.has('ТОМ')).toBe(true);
    expect(grid.bonusWords.has('АТОМ')).toBe(false);
  });
});

/* ==================== ПРОВЕРКА СЛОВА (11 §4.1) ==================== */

describe('submitWord: порядок длина → сетка → дубликат → бонус → невалидно', () => {
  it('короткое / невалидное / слово сетки / дубликат', () => {
    const { game } = makeWorld();
    expect(game.submitWord('').kind).toBe('empty');
    expect(game.submitWord('МА').kind).toBe('tooShort');
    expect(game.submitWord('МОН').kind).toBe('invalid'); // нет ни в сетке, ни в бонусах

    const hit = game.submitWord('АТОМ');
    expect(hit.kind).toBe('gridHit');
    expect(game.isRevealed('0,0')).toBe(true);
    expect(game.wordCompleted('АТОМ')).toBe(true);
    expect(game.submitWord('АТОМ').kind).toBe('duplicate'); // нейтрально, без наград
  });

  it('бонусное слово: +2 жёлудя, событие меты, повтор — дубликат', () => {
    const { game, economy, events } = makeWorld();
    const res = game.submitWord('ТОМ');
    expect(res.kind).toBe('bonus');
    if (res.kind === 'bonus') expect(res.acorns.added).toBe(2);
    expect(economy.getAcorns()).toBe(2);
    expect(events).toEqual([{ type: 'bonus_word', payload: 'ТОМ' }]);
    expect(game.submitWord('ТОМ').kind).toBe('duplicate');
    expect(economy.getAcorns()).toBe(2); // без повторного начисления (антифарм)
    expect(game.getFoundBonus()).toEqual(['ТОМ']);
  });
});

/* ==================== ПОБЕДА / НАГРАДА / ПЕРЕХОДЫ ==================== */

describe('победа: награда 20+5, защита от двойной выдачи, переходы', () => {
  it('блестящий проход: +25, rewardGiven не даёт начислить дважды', () => {
    const { game, storage } = makeWorld();
    const win = winOf(solveLevel(game));
    expect(win.perfect).toBe(true);
    expect(win.granted).toBe(WIN_REWARD + PERFECT_BONUS);
    expect(game.getCoins()).toBe(START_COINS + 25);

    // Перезагрузка на экране победы: награда уже выдана (rewardGiven)
    const reloaded = new CoreGame({ storage });
    expect(reloaded.allCompleted()).toBe(true);
    expect(reloaded.getCoins()).toBe(START_COINS + 25);
    const again = reloaded.currentWin();
    expect(again?.granted).toBe(0);
  });

  it('с подсказкой: только 20, perfect=false', () => {
    const { game } = makeWorld();
    const hint = game.useHint();
    expect(hint.ok).toBe(true);
    const win = winOf(solveLevel(game));
    expect(win.perfect).toBe(false);
    expect(win.granted).toBe(WIN_REWARD);
    expect(game.getCoins()).toBe(START_COINS - HINT_COST + WIN_REWARD);
  });

  it('nextLevel: событие level_complete ПОСЛЕ инкремента, рестарт хранит бонусы', () => {
    const { game, events } = makeWorld();
    game.submitWord('ТОМ'); // бонус остаётся при рестарте
    solveLevel(game);
    expect(game.nextLevel()).toBe('next');
    expect(game.getLevelIndex()).toBe(1);
    expect(events).toContainEqual({ type: 'level_complete', payload: { index: 0, perfect: true } });
    // Рестарт уровня 2: revealed чистится
    game.submitWord('ПЛОТ');
    expect(game.isRevealed('0,1')).toBe(true);
    expect(game.restartLevel()).toBe(true);
    expect(game.isRevealed('0,1')).toBe(false);
  });
});

/* ==================== ПОДСКАЗКА «ЛАМПА» ==================== */

describe('подсказка: инжектированный RNG, списание 100, детерминизм', () => {
  it('списывает 100, ставит метку 2, usedHint', () => {
    const { game } = makeWorld();
    const res = game.useHint();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(game.getRevealed()[res.key]).toBe(2);
    }
    expect(game.getCoins()).toBe(START_COINS - HINT_COST);
    expect(game.usedHintThisLevel()).toBe(true);
  });

  it('детерминизм: одинаковый сид → та же клетка', () => {
    const a = makeWorld(undefined, 123);
    const b = makeWorld(undefined, 123);
    const ra = a.game.useHint();
    const rb = b.game.useHint();
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) expect(ra.key).toBe(rb.key);
  });

  it('не хватает монет → noCoins, монеты не трогаются', () => {
    const { game } = makeWorld();
    game.useHint();
    game.useHint();
    game.useHint(); // 300 → 0
    expect(game.getCoins()).toBe(0);
    const res = game.useHint();
    expect(res).toEqual({ ok: false, reason: 'noCoins' });
    expect(game.getCoins()).toBe(0);
  });

  it('mulberry32/fnv1a32 стабильны (бит-в-бит)', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(fnv1a32('wordgrove:econsim:v1:seed42:0')).toBe(fnv1a32('wordgrove:econsim:v1:seed42:0'));
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });
});

/* ==================== ДНЕВНОЙ РЕЖИМ (снимок кампании) ==================== */

describe('дневной кроссворд: изоляция от сейва кампании', () => {
  it('дневные клетки не попадают в сейв кампании; выход восстанавливает', () => {
    const { game, storage } = makeWorld();
    game.submitWord('АТОМ'); // прогресс кампании
    const savedBefore = JSON.parse(storage.getItem('wordgrove.save.v1') as string) as Record<string, unknown>;

    expect(game.startDaily(3)).toBe(true);
    expect(game.isDailyMode()).toBe(true);
    expect(game.getLevelIndex()).toBe(3);
    expect(game.allCompleted()).toBe(false);
    expect(game.getCampaignLevel()).toBe(0); // прогресс кампании из снимка

    const win = winOf(solveLevel(game));
    expect(win.daily).toBe(true);
    expect(win.granted).toBe(0); // монеты дневного выдаёт Meta, не ядро

    // Сейв кампании не перезаписан дневными клетками
    const savedAfter = JSON.parse(storage.getItem('wordgrove.save.v1') as string) as Record<string, unknown>;
    expect(savedAfter.level).toEqual(savedBefore.level);
    expect(savedAfter.revealed).toEqual(savedBefore.revealed);

    game.exitDaily();
    expect(game.isDailyMode()).toBe(false);
    expect(game.getLevelIndex()).toBe(0);
    expect(game.isRevealed('0,0')).toBe(true); // АТОМ кампании на месте
    expect(game.allCompleted()).toBe(false);
  });

  it('повторный вход в дневной заблокирован, кривой индекс → 0', () => {
    const { game } = makeWorld();
    expect(game.startDaily(99)).toBe(true);
    expect(game.getLevelIndex()).toBe(0); // вне пула → 0
    expect(game.startDaily(1)).toBe(false); // уже в дневном
    game.exitDaily();
  });
});

/* ==================== СЕЙВ: СХЕМА ПРОТОТИПА И САНИТАЙЗИНГ ==================== */

describe('сейв wordgrove.save.v1: совместимость с прототипом', () => {
  it('фикстура прототипа подхватывается 1:1 без миграции', () => {
    // Уровень 3 (ГИТАРА): '3,0' — открыто словом, '0,5' — подсказкой
    const fixture = JSON.stringify({
      level: 2,
      coins: 415,
      revealed: { '3,0': 1, '0,5': 2, '9,9': 1 },
      foundBonus: { ТИР: true },
      usedHint: true,
      rewardGiven: false
    });
    const { game } = makeWorld(fixture);
    expect(game.getLevelIndex()).toBe(2);
    expect(game.getLevelData().base).toBe('ГИТАРА');
    expect(game.getCoins()).toBe(415);
    expect(game.isRevealed('3,0')).toBe(true);
    expect(game.getRevealed()['0,5']).toBe(2);
    expect(game.isRevealed('9,9')).toBe(false); // чужой ключ вычищен buildLevel
    expect(game.getFoundBonus()).toEqual(['ТИР']);
    expect(game.usedHintThisLevel()).toBe(true);
  });

  it('порт пишет ту же структуру ключей, что прототип', () => {
    const { game, storage } = makeWorld();
    game.addCoins(10, 'test');
    const parsed = JSON.parse(storage.getItem('wordgrove.save.v1') as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['coins', 'foundBonus', 'level', 'revealed', 'rewardGiven', 'usedHint'].sort()
    );
    expect(parsed.coins).toBe(START_COINS + 10);
  });

  it('санитайзинг: битый JSON и мусорные значения → дефолты', () => {
    const { game } = makeWorld('{{{не json');
    expect(game.getCoins()).toBe(START_COINS);
    expect(game.getLevelIndex()).toBe(0);

    const s = sanitizeCoreSave({
      level: 99, // вне пула → дефолт 0
      coins: 'abc', // не число → дефолт
      revealed: { '0,0': 'да', '1,1': 2 },
      foundBonus: { ТОМ: 1, ЛОЖЬ: 0 },
      usedHint: 'истина',
      rewardGiven: 0
    });
    expect(s.level).toBe(0);
    expect(s.coins).toBe(START_COINS);
    expect(s.revealed['0,0']).toBe(1); // truthy → «открыто словом»
    expect(s.revealed['1,1']).toBe(2);
    expect(s.foundBonus['ТОМ']).toBe(true);
    expect(s.foundBonus['ЛОЖЬ']).toBeUndefined();
    expect(s.usedHint).toBe(true);
    expect(s.rewardGiven).toBe(false);

    const neg = sanitizeCoreSave({ coins: -5, level: -1 });
    expect(neg.coins).toBe(START_COINS);
    expect(neg.level).toBe(0);
  });

  it('spendCoins: отказ при нехватке, списание с персистом', () => {
    const { game, storage } = makeWorld();
    expect(game.spendCoins(1000)).toBe(false);
    expect(game.spendCoins(-1)).toBe(false);
    expect(game.spendCoins(50, 'freeze')).toBe(true);
    const parsed = JSON.parse(storage.getItem('wordgrove.save.v1') as string) as { coins: number };
    expect(parsed.coins).toBe(START_COINS - 50);
  });
});
