/**
 * Оркестратор состояния партии «Классики» (Проход А): ходы, кристальная бомба,
 * выдача троек, честный game over (INV-G2), рестарт = createGame с новым сидом.
 * Порядок операций хода 1:1 из прототипа (game.js placePieceFromSlot/dropBomb).
 * Чистая логика: ни Phaser, ни DOM — используется сценой, тестами и ботом.
 */
import type { BombResult, GameState, MoveResult } from './types';
import { DEF } from './catalog';
import {
  boardEmpty,
  canPlace,
  canPlaceAnywhere,
  explode3x3,
  findFullLines,
  lineCells,
  newBoard,
  removeCells,
  stampPiece
} from './board';
import { dealTriple } from './bag';
import { bombPoints, comboAdvance, movePoints, surgeOnClear } from './scoring';
import { mulberry32 } from './rng';

/** Новая партия от сида (INV-G3): поле пусто, первая тройка выдана. */
export function createGame(seed: number): GameState {
  const state: GameState = {
    board: newBoard(),
    hand: [null, null, null],
    handPlaceable: [false, false, false],
    handMovesMade: 0,
    score: 0,
    combo: { chain: 0, graceArmed: false },
    surge: { charge: 0 },
    bombReady: false,
    gameOver: false,
    rng: mulberry32(seed)
  };
  dealHand(state);
  return state;
}

/** Выдача новой тройки (INV-G1 внутри dealTriple) + сброс счётчика «прощения». */
function dealHand(state: GameState): void {
  state.hand = dealTriple(state.board, state.score, state.rng);
  state.handMovesMade = 0;
  refreshPlaceable(state);
}

/**
 * Публичная выдача новой тройки взамен текущей — бустер «Обмен» (Проход Б,
 * 05 §2.2). Та же dealHand, что и при опустевшей руке: тройка решаема (INV-G1).
 */
export function redealHand(state: GameState): void {
  dealHand(state);
}

/** Обновить кэш размещаемости фигур руки (для HUD-приглушения и game over). */
export function refreshPlaceable(state: GameState): void {
  for (let i = 0; i < 3; i++) {
    const id = state.hand[i];
    state.handPlaceable[i] = id !== null && canPlaceAnywhere(state.board, DEF[id]);
  }
}

/** Честный проигрыш (INV-G2): только когда ни одна фигура руки не размещаема. */
function checkGameOver(state: GameState): void {
  if (state.gameOver) return;
  if (state.bombReady) return; // бомба ставится всегда — мёртвого состояния нет
  for (let i = 0; i < 3; i++) {
    if (state.handPlaceable[i]) return;
  }
  state.gameOver = true;
}

/**
 * Ход-постановка фигуры из гнезда slot в (r, c). Возвращает null, если ход
 * невалиден (пустое гнездо, game over, клетки заняты) — состояние не меняется.
 * Порядок разрешения хода — 11 §4.2 (1:1 с прототипом).
 */
export function placePiece(state: GameState, slot: number, r: number, c: number): MoveResult | null {
  const id = state.hand[slot];
  if (id === null || state.gameOver) return null;
  const p = DEF[id];
  if (!canPlace(state.board, p, r, c)) return null;

  const wasFirstMove = state.handMovesMade === 0;
  state.handMovesMade++;

  stampPiece(state.board, p, r, c, p.colorIdx + 1);

  // 1. Полные линии — одновременно строки и столбцы, до удаления
  const lines = findFullLines(state.board);
  const lineCount = lines.rows.length + lines.cols.length;
  const cells = lineCells(lines.rows, lines.cols);

  // 2. Комбо и шкала Прилива
  const mult = comboAdvance(state.combo, lineCount > 0, wasFirstMove);
  const bombBecameReady = surgeOnClear(state.surge, lineCount, mult, state.bombReady);
  if (bombBecameReady) state.bombReady = true;

  // 3. Удаление клеток (цвета возвращаются для FX вида)
  const clearedCells = removeCells(state.board, cells);

  // 4. Очки: постановка + mult × линии + «чистое поле» (без множителя)
  const cleanBoard = boardEmpty(state.board);
  const points = movePoints(p.size, lineCount, mult, cleanBoard);
  state.score += points;

  // 5. Слот пустеет; пустая рука → новая тройка
  state.hand[slot] = null;
  let newHandDealt = false;
  if (state.hand.every((x) => x === null)) {
    dealHand(state);
    newHandDealt = true;
  }
  refreshPlaceable(state);

  // 6. Контроль fail state (INV-G2)
  checkGameOver(state);

  return {
    placed: { id, r, c },
    lineCount,
    mult,
    points,
    cleanBoard,
    clearedCells,
    bombBecameReady,
    newHandDealt,
    gameOver: state.gameOver
  };
}

/**
 * Кристальная бомба из дока: очищает 3×3 вокруг (r, c). НЕ ход (аналог правил
 * бустеров 11 §4.3): комбо не двигается, «прощение» не тратится; шкала
 * сбрасывается (11 §5.2). Возвращает null, если бомбы нет или game over.
 */
export function dropBomb(state: GameState, r: number, c: number): BombResult | null {
  if (!state.bombReady || state.gameOver) return null;

  const clearedCells = explode3x3(state.board, r, c);
  const removed = clearedCells.length;
  const cleanBoard = boardEmpty(state.board);
  const points = bombPoints(removed, cleanBoard);
  state.score += points;

  state.bombReady = false;
  state.surge.charge = 0;
  refreshPlaceable(state);
  checkGameOver(state);

  return { removed, points, cleanBoard, clearedCells, gameOver: state.gameOver };
}
