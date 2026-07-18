/**
 * Тесты ядра (src/core) — чистая логика без Phaser/DOM.
 * Проверяются константы 1:1 с прототипом и книгой (03 §2, 11 §2–5)
 * и инварианты INV-G1/G2/G3, G-H5.
 */
import { describe, expect, it } from 'vitest';
import type { Board, GameState, PieceId } from '../src/core/types';
import { fnv1a32, mulberry32 } from '../src/core/rng';
import { CATALOG, DEF, RESCUE_ORDER, SUM_W0_EASY, SUM_W0_HARD } from '../src/core/catalog';
import {
  BOARD_N,
  boardEmpty,
  canPlace,
  canPlaceAnywhere,
  cloneBoard,
  explode3x3,
  fillRatio,
  findFullLines,
  lineCells,
  newBoard,
  previewLines,
  removeCells
} from '../src/core/board';
import { buildBag, currentDEff, dealTriple, drawTriple } from '../src/core/bag';
import { solveTriple } from '../src/core/solver';
import {
  CLEAN_BONUS,
  bombPoints,
  comboAdvance,
  movePoints,
  multFor,
  surgeOnClear
} from '../src/core/scoring';
import { createGame, dropBomb, placePiece, refreshPlaceable } from '../src/core/game';

/** Поле, заполненное единицами всюду, кроме перечисленных пустых клеток. */
function fullBoardExcept(empty: ReadonlyArray<readonly [number, number]>): Board {
  const b = newBoard();
  for (let r = 0; r < BOARD_N; r++) {
    for (let c = 0; c < BOARD_N; c++) b[r][c] = 1;
  }
  for (const [r, c] of empty) b[r][c] = 0;
  return b;
}

describe('каталог (11 §2)', () => {
  it('14 форм, суммы весов групп 56/17', () => {
    expect(CATALOG.length).toBe(14);
    expect(SUM_W0_EASY).toBe(56);
    expect(SUM_W0_HARD).toBe(17);
  });

  it('производные поля согласованы с cells', () => {
    for (const p of CATALOG) {
      expect(p.size).toBe(p.cells.length);
      expect(Math.max(...p.cells.map((rc) => rc[0])) + 1).toBe(p.h);
      expect(Math.max(...p.cells.map((rc) => rc[1])) + 1).toBe(p.w);
    }
    expect(DEF.MONO.size).toBe(1);
    expect(DEF.PENT_I5.w).toBe(5);
    expect(DEF.PENT_X.H).toBe(5);
  });

  it('спасательные фигуры — домино и моно', () => {
    expect(RESCUE_ORDER).toEqual(['DOMINO_H', 'DOMINO_V', 'MONO']);
  });
});

describe('rng (INV-G3)', () => {
  it('mulberry32 детерминирован и в [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('fnv1a32 стабилен и различает строки', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('blocksurge:field:v1:2026-07-18')).toBe(fnv1a32('blocksurge:field:v1:2026-07-18'));
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });
});

describe('поле (11 §4)', () => {
  it('canPlace: границы и пересечения', () => {
    const b = newBoard();
    expect(canPlace(b, DEF.PENT_I5, 0, 3)).toBe(true);
    expect(canPlace(b, DEF.PENT_I5, 0, 4)).toBe(false); // ширина 5 не влезает
    b[0][3] = 1;
    expect(canPlace(b, DEF.PENT_I5, 0, 3)).toBe(false); // занято
    expect(canPlace(b, DEF.MONO, -1, 0)).toBe(false);
  });

  it('findFullLines: строки и столбцы одновременно, пересечение один раз', () => {
    const b = newBoard();
    for (let c = 0; c < BOARD_N; c++) b[3][c] = 1;
    for (let r = 0; r < BOARD_N; r++) b[r][5] = 1;
    const lines = findFullLines(b);
    expect(lines.rows).toEqual([3]);
    expect(lines.cols).toEqual([5]);
    const cells = lineCells(lines.rows, lines.cols);
    expect(cells.length).toBe(BOARD_N + BOARD_N - 1); // 15: (3,5) — один раз
  });

  it('removeCells возвращает цвета и чистит поле', () => {
    const b = newBoard();
    b[1][1] = 4; // colorIdx 3
    const cleared = removeCells(b, [[1, 1]]);
    expect(cleared).toEqual([{ r: 1, c: 1, colorIdx: 3 }]);
    expect(boardEmpty(b)).toBe(true);
    expect(fillRatio(b)).toBe(0);
  });

  it('explode3x3 клипуется границами поля', () => {
    const b = fullBoardExcept([]);
    const cleared = explode3x3(b, 0, 0);
    expect(cleared.length).toBe(4); // угол: 2×2
    expect(b[0][0]).toBe(0);
    expect(b[1][1]).toBe(0);
    expect(b[2][2]).toBe(1);
  });

  it('previewLines показывает будущие линии без мутации поля', () => {
    const b = newBoard();
    for (let c = 0; c < 5; c++) b[0][c] = 1; // осталось 3 в ряду 0
    const copy = cloneBoard(b);
    const lines = previewLines(b, DEF.TRIO_I, 0, 5);
    expect(lines.rows).toEqual([0]);
    expect(b).toEqual(copy);
  });
});

describe('мешок и выдача (03 §4.1, 11 §3)', () => {
  it('currentDEff: старт 0.2, шаг по 500 очков, потолок', () => {
    expect(currentDEff(0)).toBeCloseTo((0.19 - 0.10) / 0.45, 10);
    expect(currentDEff(499)).toBeCloseTo(currentDEff(0), 10);
    expect(currentDEff(500)).toBeCloseTo((0.22 - 0.10) / 0.45, 10);
    expect(currentDEff(1_000_000)).toBeCloseTo(1, 10); // w_hard упёрся в 0.55
  });

  it('buildBag: сумма весов 1 на пустом поле; антифрустрация растит SMALL', () => {
    const empty = newBoard();
    const bag = buildBag(empty, currentDEff(0));
    let sum = 0;
    for (const w of bag.values()) sum += w;
    expect(sum).toBeCloseTo(1, 10);

    // fill > 70% → вес SMALL ×1.5
    const crowded = fullBoardExcept([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0]]);
    expect(fillRatio(crowded)).toBeGreaterThan(0.7);
    const boosted = buildBag(crowded, currentDEff(0));
    expect(boosted.get('MONO')).toBeCloseTo((bag.get('MONO') ?? 0) * 1.5, 10);
    expect(boosted.get('PENT_I5')).toBeCloseTo(bag.get('PENT_I5') ?? 0, 10);
  });

  it('drawTriple: без повторов и ≤1 фигуры с H=5 (G-H5)', () => {
    const rng = mulberry32(7);
    const bag = buildBag(newBoard(), 1); // максимум HARD — жёстче проверка H5
    for (let i = 0; i < 300; i++) {
      const triple = drawTriple(bag, rng);
      expect(triple.length).toBe(3);
      expect(new Set(triple).size).toBe(3);
      expect(triple.filter((id) => DEF[id].H === 5).length).toBeLessThanOrEqual(1);
    }
  });

  it('dealTriple выдаёт решаемую тройку (INV-G1), включая тесное поле', () => {
    const rng = mulberry32(11);
    expect(solveTriple(newBoard(), dealTriple(newBoard(), 0, rng))).toBe(true);

    // Поле с единственной пустой клеткой: MONO закрывает ряд и столбец → место освобождается
    const tight = fullBoardExcept([[0, 0]]);
    const triple = dealTriple(tight, 0, rng);
    expect(solveTriple(tight, triple)).toBe(true);
  });
});

describe('солвер (11 §3.4)', () => {
  it('пустое поле решаемо для любой тройки', () => {
    expect(solveTriple(newBoard(), ['PENT_I5', 'PENT_X', 'TET_S'])).toBe(true);
  });

  it('нерешаемая тройка обнаруживается', () => {
    // Шахматная заливка: PENT_I5 некуда поставить в принципе
    const b = newBoard();
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        if ((r + c) % 2 === 0) b[r][c] = 1;
      }
    }
    expect(solveTriple(b, ['PENT_I5', 'MONO', 'MONO'])).toBe(false);
  });

  it('симуляция хода учитывает очистку линий (иначе ложное «нерешаемо»)', () => {
    // Всё занято, кроме трёх клеток ряда 0: TRIO_I закрывает ВСЁ поле → каскад очистки
    const b = fullBoardExcept([[0, 5], [0, 6], [0, 7]]);
    expect(solveTriple(b, ['TRIO_I', 'MONO', 'MONO'])).toBe(true);
  });
});

describe('очки, комбо, Прилив (03 §2.2–2.3, 11 §5)', () => {
  it('multFor: пороги ×2/×3/×5', () => {
    expect([0, 1, 2, 3, 4, 9].map(multFor)).toEqual([1, 1, 2, 3, 5, 5]);
  });

  it('комбо растёт по чистящим ходам: множители 1, 2, 3, 5', () => {
    const combo = { chain: 0, graceArmed: false };
    const mults = [1, 2, 3, 4].map(() => comboAdvance(combo, true, false));
    expect(mults).toEqual([1, 2, 3, 5]);
    expect(combo.chain).toBe(4);
  });

  it('«прощение»: первый ход тройки не рвёт цепь, второй промах — рвёт', () => {
    const combo = { chain: 2, graceArmed: true };
    // первый ход новой тройки без очистки — цепь живёт, но не растёт
    expect(comboAdvance(combo, false, true)).toBe(2);
    expect(combo.chain).toBe(2);
    expect(combo.graceArmed).toBe(false);
    // следующий промах (даже первым ходом) — сброс
    expect(comboAdvance(combo, false, true)).toBe(1);
    expect(combo.chain).toBe(0);
  });

  it('промах не первым ходом рвёт цепь даже при взведённом прощении', () => {
    const combo = { chain: 3, graceArmed: true };
    expect(comboAdvance(combo, false, false)).toBe(1);
    expect(combo.chain).toBe(0);
  });

  it('шкала Прилива: заряд 10 × mult, потолок 100, заморозка при бомбе', () => {
    const surge = { charge: 0 };
    expect(surgeOnClear(surge, 1, 2, false)).toBe(false);
    expect(surge.charge).toBe(20);
    expect(surgeOnClear(surge, 0, 5, false)).toBe(false); // без очистки заряда нет
    expect(surge.charge).toBe(20);
    surge.charge = 95;
    expect(surgeOnClear(surge, 2, 5, false)).toBe(true);  // переполнение → бомба
    expect(surge.charge).toBe(100);
    surge.charge = 50;
    expect(surgeOnClear(surge, 1, 1, true)).toBe(false);  // бомба в доке → заморожен
    expect(surge.charge).toBe(50);
  });

  it('очки хода: таблица 03 §2.2, «чистое поле» без множителя', () => {
    expect(movePoints(4, 0, 1, false)).toBe(4);
    expect(movePoints(4, 1, 1, false)).toBe(14);
    expect(movePoints(4, 2, 3, false)).toBe(4 + 3 * 30);
    expect(movePoints(2, 5, 5, false)).toBe(2 + 5 * 100); // 4+ линий = 100
    expect(movePoints(1, 1, 2, true)).toBe(1 + 2 * 10 + CLEAN_BONUS);
  });

  it('очки бомбы: 40 + 1/клетку, не умножается', () => {
    expect(bombPoints(6, false)).toBe(46);
    expect(bombPoints(9, true)).toBe(49 + CLEAN_BONUS);
  });
});

describe('оркестратор партии (game.ts)', () => {
  it('createGame детерминирован от сида (INV-G3)', () => {
    const a = createGame(123);
    const b = createGame(123);
    expect(a.hand).toEqual(b.hand);
    expect(a.score).toBe(0);
    expect(a.gameOver).toBe(false);
    // INV-G1: сразу после выдачи хотя бы одна фигура размещаема
    expect(a.handPlaceable.some(Boolean)).toBe(true);
  });

  it('невалидные ходы возвращают null и не меняют состояние', () => {
    const s = createGame(1);
    const before = cloneBoard(s.board);
    expect(placePiece(s, 0, BOARD_N, 0)).toBeNull(); // вне поля
    expect(placePiece(s, 0, 0, BOARD_N)).toBeNull();
    expect(dropBomb(s, 3, 3)).toBeNull(); // бомбы нет
    expect(s.board).toEqual(before);
    expect(s.score).toBe(0);
    expect(s.handMovesMade).toBe(0);
  });

  it('ход с очисткой: очки, комбо, освобождение линии', () => {
    const s = createGame(5);
    // Рисуем позицию вручную: ряд 0 без трёх клеток; в руку кладём TRIO_I
    s.board = newBoard();
    for (let c = 0; c < 5; c++) s.board[0][c] = 1;
    s.hand = ['TRIO_I', 'MONO', 'MONO'];
    s.handMovesMade = 0;
    refreshPlaceable(s);

    const res = placePiece(s, 0, 0, 5);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.lineCount).toBe(1);
    expect(res.mult).toBe(1); // первая очистка цепи — ещё ×1
    expect(res.points).toBe(3 + 10 + CLEAN_BONUS); // постановка + линия + чистое поле
    expect(res.cleanBoard).toBe(true);
    expect(res.clearedCells.length).toBe(BOARD_N);
    expect(s.combo.chain).toBe(1);
    expect(s.surge.charge).toBe(10);
    expect(s.hand[0]).toBeNull();
  });

  it('бомба: не ход — комбо не двигается, шкала сбрасывается', () => {
    const s = createGame(9);
    s.board = fullBoardExcept([[7, 7]]);
    s.hand = ['MONO', null, null];
    s.combo = { chain: 3, graceArmed: true };
    s.surge = { charge: 100 };
    s.bombReady = true;
    refreshPlaceable(s);

    const res = dropBomb(s, 1, 1);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.removed).toBe(9);
    expect(res.points).toBe(40 + 9);
    expect(s.combo.chain).toBe(3); // бомба не трогает комбо
    expect(s.surge.charge).toBe(0);
    expect(s.bombReady).toBe(false);
  });

  it('game over честный (INV-G2) и блокируется бомбой в доке', () => {
    const s = createGame(2);
    // Тесное поле, куда PENT_I5 не встаёт ни в одну позицию
    const b = newBoard();
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        if ((r + c) % 2 === 0) b[r][c] = 1;
      }
    }
    s.board = b;
    s.hand = ['PENT_I5', null, null];
    s.bombReady = true;
    refreshPlaceable(s);
    expect(canPlaceAnywhere(s.board, DEF.PENT_I5)).toBe(false);

    // Бомба в доке → мёртвого состояния нет: применяем её — и только потом game over
    const res = dropBomb(s, 0, 0);
    expect(res).not.toBeNull();
    if (!res) return;
    // после взрыва 2×2 угла PENT_I5 всё ещё некуда ставить и бомбы больше нет
    expect(res.gameOver).toBe(true);
    expect(s.gameOver).toBe(true);
    expect(placePiece(s, 0, 0, 0)).toBeNull(); // после конца партии ходов нет
  });

  it('автоплей: детерминизм и инварианты на длинной партии', () => {
    const play = (seed: number): number => {
      const s = createGame(seed);
      for (let move = 0; move < 400 && !s.gameOver; move++) {
        // Политика: первая размещаемая фигура в первую валидную позицию
        let placed = false;
        for (let slot = 0; slot < 3 && !placed; slot++) {
          const id = s.hand[slot];
          if (id === null) continue;
          const p = DEF[id];
          for (let r = 0; r <= BOARD_N - p.h && !placed; r++) {
            for (let c = 0; c <= BOARD_N - p.w && !placed; c++) {
              if (!canPlace(s.board, p, r, c)) continue;
              const res = placePiece(s, slot, r, c);
              expect(res).not.toBeNull();
              placed = true;
            }
          }
        }
        if (!placed) {
          // Некуда ставить: либо game over уже зафиксирован, либо ждёт бомба
          expect(s.gameOver || s.bombReady).toBe(true);
          if (s.bombReady) {
            expect(dropBomb(s, 4, 4)).not.toBeNull();
          } else {
            break;
          }
        }
        // INV-G2: пока партия жива, есть ход или бомба
        if (!s.gameOver) {
          expect(s.handPlaceable.some(Boolean) || s.bombReady).toBe(true);
        }
      }
      expect(s.score).toBeGreaterThan(0);
      if (s.gameOver) {
        // INV-G2: проигрыш только когда действительно некуда ставить и бомбы нет
        expect(s.handPlaceable.some(Boolean)).toBe(false);
        expect(s.bombReady).toBe(false);
      }
      return s.score;
    };

    expect(play(2024)).toBe(play(2024)); // INV-G3: реплей от сида воспроизводится
    expect(play(77)).toBe(play(77));
  });
});

/* Проверка совместимости типа: PieceId руки соответствует каталогу. */
it('типы: рука состоит из id каталога', () => {
  const s: GameState = createGame(3);
  for (const id of s.hand) {
    if (id !== null) {
      const key: PieceId = id;
      expect(DEF[key]).toBeDefined();
    }
  }
});
