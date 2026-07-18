/**
 * Генератор раскладов (порт prototype/game.js 1:1, алгоритм не тронут):
 *  1) randomDeal — случайные ранги/масти стола и стока;
 *  2) ensureFirstMoves — минимум MIN_START_MOVES ходов в нижнем ряду (I3);
 *  3) dealQuality — отбор по случайным плейаутам (≥10% выигрышных линий);
 *  4) assignHarvest — 8 карт 🍎 с балансом по пикам (Q2/Q3).
 * Отличие от прототипа: PRNG инжектируется (Rng) — Math.random в ядре нет,
 * один сид → бит-в-бит одна раздача (детерминизм для тестов и «раздач дня»).
 */
import { CORE_CFG } from './config';
import { SLOTS, TABLE_SIZE, peakOf } from './layout';
import { SUITS, isAdjacent } from './rules';
import type { Deal, DealQuality, Rng } from './types';

const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n);
const randRank = (rng: Rng): number => 1 + randInt(rng, 13);
const randSuit = (rng: Rng): number => randInt(rng, SUITS.length);

/** Тасование Фишера–Йетса на инжектируемом rng (копия массива). */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Случайная раздача: стол 28 карт + сток + стартовая карта сброса. */
export function randomDeal(rng: Rng): Deal {
  const tableRanks: number[] = [];
  const tableSuits: number[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    tableRanks.push(randRank(rng));
    tableSuits.push(randSuit(rng));
  }
  const stockRanks: number[] = [];
  const stockSuits: number[] = [];
  for (let i = 0; i < CORE_CFG.STOCK_SIZE; i++) {
    stockRanks.push(randRank(rng));
    stockSuits.push(randSuit(rng));
  }
  return {
    tableRanks,
    tableSuits,
    stockRanks,
    stockSuits,
    startWaste: randRank(rng),
    startWasteSuit: randSuit(rng),
    harvest: new Set<number>()
  };
}

/** Гарантировать ≥ MIN_START_MOVES ходов в нижнем ряду на старте (I3). */
export function ensureFirstMoves(deal: Deal, rng: Rng): void {
  const bottom = SLOTS.filter((s) => s.row === 3);
  const countMoves = (): number =>
    bottom.filter((s) => isAdjacent(deal.tableRanks[s.id], deal.startWaste)).length;

  let guard = 0;
  while (countMoves() < CORE_CFG.MIN_START_MOVES && guard++ < 20) {
    const nonMoving = shuffle(
      bottom.filter((s) => !isAdjacent(deal.tableRanks[s.id], deal.startWaste)),
      rng
    );
    if (nonMoving.length === 0) break;
    const target = nonMoving[0];
    const donors = shuffle(
      SLOTS.filter((s) => s.row < 3 && isAdjacent(deal.tableRanks[s.id], deal.startWaste)),
      rng
    );
    if (donors.length > 0) {
      const d = donors[0];
      [deal.tableRanks[target.id], deal.tableRanks[d.id]] = [
        deal.tableRanks[d.id],
        deal.tableRanks[target.id]
      ];
      [deal.tableSuits[target.id], deal.tableSuits[d.id]] = [
        deal.tableSuits[d.id],
        deal.tableSuits[target.id]
      ];
    } else {
      const dir = rng() < 0.5 ? 1 : -1;
      deal.tableRanks[target.id] = ((deal.startWaste - 1 + dir + 13) % 13) + 1;
    }
  }
}

/** Один случайный плейаут: доля очищенного стола (0..1). */
export function playoutClearRatio(deal: Deal, rng: Rng): number {
  const removed = new Set<number>();
  let waste = deal.startWaste;
  let stockIdx = 0;
  while (removed.size < TABLE_SIZE) {
    const moves: number[] = [];
    for (const s of SLOTS) {
      if (removed.has(s.id)) continue;
      if (!s.coveredBy.every((c) => removed.has(c))) continue;
      if (isAdjacent(deal.tableRanks[s.id], waste)) moves.push(s.id);
    }
    if (moves.length > 0) {
      const id = moves[randInt(rng, moves.length)];
      removed.add(id);
      waste = deal.tableRanks[id];
    } else if (stockIdx < deal.stockRanks.length) {
      waste = deal.stockRanks[stockIdx];
      stockIdx++;
    } else {
      break;
    }
  }
  return removed.size / TABLE_SIZE;
}

/** Оценка «живости» расклада по GEN_PLAYOUTS случайным плейаутам. */
export function dealQuality(deal: Deal, rng: Rng): DealQuality {
  let wins = 0;
  let bestClear = 0;
  for (let k = 0; k < CORE_CFG.GEN_PLAYOUTS; k++) {
    const r = playoutClearRatio(deal, rng);
    bestClear = Math.max(bestClear, r);
    if (r >= 1) wins++;
  }
  return { winShare: wins / CORE_CFG.GEN_PLAYOUTS, bestClear };
}

/** Разметить HARVEST_COUNT карт 🍎: мелко 4, ≤1 на вершинах (Q2), баланс пиков (Q3). */
export function assignHarvest(deal: Deal, rng: Rng): void {
  let marks = new Set<number>();
  for (let attempt = 0; attempt < 30; attempt++) {
    marks = new Set<number>();
    const rowIds = (r: number): number[] => SLOTS.filter((s) => s.row === r).map((s) => s.id);
    const shallowPool = shuffle(rowIds(3).concat(rowIds(2)), rng); // глубина 0–1
    const midPool = shuffle(rowIds(1).concat(rowIds(2)), rng); // середина
    const peakPool = shuffle(rowIds(0), rng); // вершины

    for (let i = 0; i < 4 && i < shallowPool.length; i++) marks.add(shallowPool[i]);
    if (rng() < 0.5) marks.add(peakPool[0]); // Q2: ≤ 1 на вершинах
    for (const id of midPool) {
      if (marks.size >= CORE_CFG.HARVEST_COUNT) break;
      marks.add(id);
    }

    const perPeak = [0, 0, 0];
    for (const id of marks) perPeak[peakOf(SLOTS[id])]++;
    if (Math.max(...perPeak) - Math.min(...perPeak) <= 2) break; // Q3 выполнена
  }
  deal.harvest = marks;
}

/** Полный цикл генерации уровня: GEN_DEALS попыток, отбор лучшего расклада. */
export function generateLevel(rng: Rng): Deal {
  let bestDeal: Deal | null = null;
  let bestScoreQ = -1;
  for (let i = 0; i < CORE_CFG.GEN_DEALS; i++) {
    const deal = randomDeal(rng);
    ensureFirstMoves(deal, rng);
    const q = dealQuality(deal, rng);
    const scoreQ = q.winShare * 100 + q.bestClear;
    if (scoreQ > bestScoreQ) {
      bestScoreQ = scoreQ;
      bestDeal = deal;
    }
    if (q.winShare >= CORE_CFG.GEN_MIN_WIN_SHARE) break;
  }
  if (bestDeal === null) throw new Error('generateLevel: GEN_DEALS должен быть ≥ 1');
  assignHarvest(bestDeal, rng);
  return bestDeal;
}
