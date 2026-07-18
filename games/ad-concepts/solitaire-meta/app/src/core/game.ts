/**
 * Оркестратор состояния партии TriPeaks (Проход Е.1, порт логики ходов из
 * prototype/game.js). Чистая логика: ни DOM, ни Phaser — используется UI-слоем
 * (TableUi), тестами и симулятором. Порядок операций хода 1:1 с прототипом
 * (removeCard/onStockClick/doUndo): сначала снимок истории, затем мутация,
 * затем проверка финала. Экономика/мета — снаружи, по MoveResult.
 */
import { CORE_CFG } from './config';
import { SLOTS, TABLE_SIZE } from './layout';
import { isAdjacent, multiplierFor } from './rules';
import type { Deal, DrawResult, GameState, MoveResult } from './types';

/** Новая партия по готовой раздаче (генерация — core/generator.ts). */
export function createGame(deal: Deal): GameState {
  return {
    deal,
    removed: new Set<number>(),
    stockIdx: 0,
    waste: deal.startWaste,
    wasteSuit: deal.startWasteSuit,
    chain: 0,
    score: 0,
    harvestGot: 0,
    history: [],
    over: false
  };
}

/** Осталось карт в колоде добора. */
export function stockLeft(g: GameState): number {
  return g.deal.stockRanks.length - g.stockIdx;
}

/** Карта открыта: все закрывающие её карты убраны. */
export function isOpen(g: GameState, slotId: number): boolean {
  return SLOTS[slotId].coveredBy.every((c) => g.removed.has(c));
}

/** Карта играбельна обычным ходом: на столе, открыта и соседняя по рангу. */
export function isPlayable(g: GameState, slotId: number): boolean {
  return (
    !g.removed.has(slotId) && isOpen(g, slotId) && isAdjacent(g.deal.tableRanks[slotId], g.waste)
  );
}

/** Первый играбельный слот (для автоподсказки) или null. */
export function firstPlayable(g: GameState): number | null {
  for (const s of SLOTS) {
    if (isPlayable(g, s.id)) return s.id;
  }
  return null;
}

/** Есть ли хоть один обычный ход. */
export function anyMoves(g: GameState): boolean {
  return firstPlayable(g) !== null;
}

/** Снимок для отмены (кап истории — как в прототипе). */
function pushHistory(g: GameState, jokerRefund: boolean): void {
  g.history.push({
    removed: Array.from(g.removed),
    stockIdx: g.stockIdx,
    waste: g.waste,
    wasteSuit: g.wasteSuit,
    chain: g.chain,
    score: g.score,
    harvestGot: g.harvestGot,
    jokerRefund
  });
  if (g.history.length > CORE_CFG.HISTORY_CAP) g.history.shift();
}

/**
 * Уборка карты со стола (общий путь обычного хода и джокера).
 * viaJoker=true снимает требование соседства (джокер — «дикая карта»); серия
 * при этом ПРОДОЛЖАЕТСЯ (как в прототипе). Списание джокера из инвентаря —
 * забота вызывающего слоя (Economy.consumeBooster) ДО вызова.
 * Возвращает null, если ход невалиден — состояние не меняется.
 */
export function playCard(g: GameState, slotId: number, viaJoker = false): MoveResult | null {
  if (g.over || g.removed.has(slotId)) return null;
  if (!isOpen(g, slotId)) return null;
  const rank = g.deal.tableRanks[slotId];
  if (!viaJoker && !isAdjacent(rank, g.waste)) return null;

  pushHistory(g, viaJoker);
  g.removed.add(slotId);
  g.chain++;
  const mult = multiplierFor(g.chain);
  const points = Math.round(CORE_CFG.SCORE_BASE * mult);
  g.score += points;

  const harvest = g.deal.harvest.has(slotId);
  if (harvest) g.harvestGot++;

  g.waste = rank;
  g.wasteSuit = g.deal.tableSuits[slotId];

  let finished: MoveResult['finished'] = null;
  if (g.removed.size === TABLE_SIZE) {
    g.over = true;
    finished = 'win';
  } else if (stockLeft(g) === 0 && !anyMoves(g)) {
    g.over = true;
    finished = 'lose';
  }
  return { harvest, chain: g.chain, mult, points, finished };
}

/** Добор из колоды: новая карта сброса, серия обнуляется. null — нельзя. */
export function drawStock(g: GameState): DrawResult | null {
  if (g.over || stockLeft(g) === 0) return null;
  pushHistory(g, false);
  g.waste = g.deal.stockRanks[g.stockIdx];
  g.wasteSuit = g.deal.stockSuits[g.stockIdx];
  g.stockIdx++;
  g.chain = 0;

  if (stockLeft(g) === 0 && !anyMoves(g)) {
    g.over = true;
    return { finished: 'lose' };
  }
  return { finished: null };
}

/**
 * Отмена последнего хода (снимок из истории). Оплата отмены (бесплатные ундо →
 * монеты) — забота вызывающего слоя ДО вызова. Возвращает jokerRefund: ход был
 * джокером — вызывающий слой возвращает джокер в инвентарь. null — нечего отменять.
 */
export function undoLast(g: GameState): { jokerRefund: boolean } | null {
  if (g.over) return null;
  const snap = g.history.pop();
  if (snap === undefined) return null;
  g.removed = new Set(snap.removed);
  g.stockIdx = snap.stockIdx;
  g.waste = snap.waste;
  g.wasteSuit = snap.wasteSuit;
  g.chain = snap.chain;
  g.score = snap.score;
  g.harvestGot = snap.harvestGot;
  return { jokerRefund: snap.jokerRefund };
}

/**
 * Пополнить колоду n картами (RW1 «Второй шанс», 06 §6.2 — подключается в
 * Проходе Е.2) и снять флаг поражения. Ранги/масти передаёт вызывающий слой.
 */
export function extendStock(g: GameState, cards: readonly { rank: number; suit: number }[]): void {
  for (const c of cards) {
    g.deal.stockRanks.push(c.rank);
    g.deal.stockSuits.push(c.suit);
  }
  g.over = false;
}
