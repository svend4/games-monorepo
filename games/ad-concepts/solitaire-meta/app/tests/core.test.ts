/**
 * Тесты ядра TriPeaks (Проход Е.1) — чистая логика без DOM.
 * Проверяются: раскладка 3/6/9/10 с графом перекрытий, правило ±1 с
 * зацикливанием A↔K, множитель серии (кап ×3), детерминизм сид-RNG и
 * генератора, инварианты генерации (сток, урожай, стартовые ходы),
 * сценарная партия до победы/поражения, ундо и джокер.
 */
import { describe, expect, it } from 'vitest';
import { CORE_CFG } from '../src/core/config';
import { SLOTS, TABLE_SIZE, peakOf } from '../src/core/layout';
import { RANK_LABELS, SUITS, isAdjacent, multiplierFor } from '../src/core/rules';
import { dealQuality, generateLevel } from '../src/core/generator';
import {
  anyMoves,
  createGame,
  drawStock,
  firstPlayable,
  isOpen,
  isPlayable,
  playCard,
  stockLeft,
  undoLast
} from '../src/core/game';
import { fnv1a32, mulberry32 } from '../src/core/rng';
import { makeDeal } from './helpers';
import type { Deal } from '../src/core/types';

/* ==================== РАСКЛАДКА (3 пика, 28 карт) ==================== */

describe('раскладка «3 пика»', () => {
  it('28 слотов рядами 3/6/9/10', () => {
    expect(TABLE_SIZE).toBe(28);
    const rows = [0, 1, 2, 3].map((r) => SLOTS.filter((s) => s.row === r).length);
    expect(rows).toEqual([3, 6, 9, 10]);
  });

  it('граф перекрытий: нижний ряд открыт, остальные закрыты ровно двумя', () => {
    for (const s of SLOTS) {
      if (s.row === 3) {
        expect(s.coveredBy).toHaveLength(0);
      } else {
        expect(s.coveredBy).toHaveLength(2);
        for (const c of s.coveredBy) expect(SLOTS[c].row).toBe(s.row + 1);
      }
    }
  });

  it('пики: по вершине на пик, колонки делят стол на трети', () => {
    const peaks = SLOTS.filter((s) => s.row === 0).map((s) => peakOf(s));
    expect(peaks).toEqual([0, 1, 2]);
  });
});

/* ==================== ПРАВИЛА (±1, множитель серии) ==================== */

describe('правило ±1 с зацикливанием A↔K', () => {
  it('соседние ранги играбельны', () => {
    expect(isAdjacent(5, 6)).toBe(true);
    expect(isAdjacent(5, 4)).toBe(true);
  });

  it('Туз и Король — соседи (в обе стороны)', () => {
    expect(isAdjacent(1, 13)).toBe(true);
    expect(isAdjacent(13, 1)).toBe(true);
  });

  it('прочие пары — нет', () => {
    expect(isAdjacent(5, 7)).toBe(false);
    expect(isAdjacent(5, 5)).toBe(false);
    expect(isAdjacent(2, 13)).toBe(false);
  });
});

describe('множитель серии ×1 → +0.1 → кап ×3', () => {
  it('первая карта ×1, далее +0.1 за карту', () => {
    expect(multiplierFor(0)).toBe(1.0);
    expect(multiplierFor(1)).toBe(1.0);
    expect(multiplierFor(2)).toBeCloseTo(1.1, 10);
    expect(multiplierFor(5)).toBeCloseTo(1.4, 10);
  });

  it('кап ×3 с 21-й карты серии', () => {
    expect(multiplierFor(21)).toBe(3.0);
    expect(multiplierFor(50)).toBe(3.0);
  });
});

/* ==================== ДЕТЕРМИНИЗМ RNG И ГЕНЕРАТОРА ==================== */

describe('сид-RNG (mulberry32 + fnv1a32)', () => {
  it('один сид → одна последовательность', () => {
    const a = mulberry32(123456);
    const b = mulberry32(123456);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('значения в [0, 1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('fnv1a32 стабилен (реплеи/раздачи дня)', () => {
    expect(fnv1a32('orchard')).toBe(303730620);
    expect(fnv1a32('orchard')).toBe(fnv1a32('orchard'));
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });
});

function dealFingerprint(d: Deal): string {
  return JSON.stringify({
    t: d.tableRanks,
    s: d.tableSuits,
    st: d.stockRanks,
    ss: d.stockSuits,
    w: d.startWaste,
    ws: d.startWasteSuit,
    h: [...d.harvest].sort((a, b) => a - b)
  });
}

describe('генератор раскладов', () => {
  it('детерминизм: один сид → бит-в-бит одна раздача', () => {
    const d1 = generateLevel(mulberry32(fnv1a32('gen:seed:1')));
    const d2 = generateLevel(mulberry32(fnv1a32('gen:seed:1')));
    expect(dealFingerprint(d1)).toBe(dealFingerprint(d2));
  });

  it('разные сиды → разные раздачи', () => {
    const d1 = generateLevel(mulberry32(fnv1a32('gen:seed:1')));
    const d2 = generateLevel(mulberry32(fnv1a32('gen:seed:2')));
    expect(dealFingerprint(d1)).not.toBe(dealFingerprint(d2));
  });

  it('инварианты раздачи: 28 карт стола, сток 20, ранги 1..13, масти 0..3', () => {
    const d = generateLevel(mulberry32(fnv1a32('gen:seed:3')));
    expect(d.tableRanks).toHaveLength(TABLE_SIZE);
    expect(d.stockRanks).toHaveLength(CORE_CFG.STOCK_SIZE);
    for (const r of [...d.tableRanks, ...d.stockRanks, d.startWaste]) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(13);
      expect(Number.isInteger(r)).toBe(true);
    }
    for (const s of [...d.tableSuits, ...d.stockSuits, d.startWasteSuit]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(SUITS.length);
    }
  });

  it('урожай: ровно HARVEST_COUNT карт 🍎, баланс по пикам ≤ 2 (Q3)', () => {
    for (const seed of ['h:1', 'h:2', 'h:3']) {
      const d = generateLevel(mulberry32(fnv1a32(seed)));
      expect(d.harvest.size).toBe(CORE_CFG.HARVEST_COUNT);
      const perPeak = [0, 0, 0];
      for (const id of d.harvest) perPeak[peakOf(SLOTS[id])]++;
      expect(Math.max(...perPeak) - Math.min(...perPeak)).toBeLessThanOrEqual(2);
    }
  });

  it('на старте есть минимум MIN_START_MOVES ходов в нижнем ряду (I3)', () => {
    for (const seed of ['m:1', 'm:2', 'm:3', 'm:4']) {
      const d = generateLevel(mulberry32(fnv1a32(seed)));
      const moves = SLOTS.filter(
        (s) => s.row === 3 && isAdjacent(d.tableRanks[s.id], d.startWaste)
      ).length;
      expect(moves).toBeGreaterThanOrEqual(CORE_CFG.MIN_START_MOVES);
    }
  });

  it('отбор по плейаутам: у сгенерированного расклада есть «живость»', () => {
    const rng = mulberry32(fnv1a32('q:1'));
    const d = generateLevel(rng);
    const q = dealQuality(d, rng);
    expect(q.bestClear).toBeGreaterThan(0.3); // случайные линии добираются глубоко
  });
});

/* ==================== СЦЕНАРНАЯ ПАРТИЯ (победа 1:1) ==================== */

/** Раздача-«лесенка»: снятие рядами снизу вверх даёт цепочку +1 на всю партию. */
function ladderDeal(): { deal: Deal; order: number[] } {
  const order = [
    ...SLOTS.filter((s) => s.row === 3).map((s) => s.id),
    ...SLOTS.filter((s) => s.row === 2).map((s) => s.id),
    ...SLOTS.filter((s) => s.row === 1).map((s) => s.id),
    ...SLOTS.filter((s) => s.row === 0).map((s) => s.id)
  ];
  const startWaste = 5;
  const deal = makeDeal({ startWaste, stockRanks: [2, 9, 4], stockSuits: [0, 1, 2] });
  order.forEach((id, k) => {
    deal.tableRanks[id] = ((startWaste - 1 + k + 1) % 13) + 1; // +1 на каждом шаге
  });
  deal.harvest = new Set([order[0], order[10], order[27]]);
  return { deal, order };
}

describe('партия: победа, серия, очки, урожай', () => {
  it('полная очистка стола → победа, очки с капом множителя ×3', () => {
    const { deal, order } = ladderDeal();
    const g = createGame(deal);
    expect(g.waste).toBe(5);
    expect(stockLeft(g)).toBe(3);

    let expectedScore = 0;
    let harvestSeen = 0;
    for (let k = 0; k < order.length; k++) {
      const res = playCard(g, order[k]);
      expect(res).not.toBeNull();
      if (res === null) continue;
      expect(res.chain).toBe(k + 1);
      expectedScore += Math.round(CORE_CFG.SCORE_BASE * multiplierFor(k + 1));
      if (res.harvest) harvestSeen++;
      expect(res.finished).toBe(k === order.length - 1 ? 'win' : null);
    }
    // 20 карт разгона + 8 карт на капе ×3: 3900 + 2400 = 6300.
    expect(expectedScore).toBe(6300);
    expect(g.score).toBe(6300);
    expect(g.harvestGot).toBe(3);
    expect(harvestSeen).toBe(3);
    expect(g.over).toBe(true);
    expect(stockLeft(g)).toBe(3); // бонус за остаток стока считает экономика
  });

  it('закрытая или несоседняя карта не играется (состояние не меняется)', () => {
    const { deal } = ladderDeal();
    const g = createGame(deal);
    const topPeak = SLOTS.find((s) => s.row === 0)?.id ?? 0;
    expect(isOpen(g, topPeak)).toBe(false);
    expect(playCard(g, topPeak)).toBeNull(); // закрыта
    const farBottom = SLOTS.filter((s) => s.row === 3)[5].id;
    expect(playCard(g, farBottom)).toBeNull(); // открыта, но не ±1
    expect(g.removed.size).toBe(0);
    expect(g.score).toBe(0);
  });

  it('джокер снимает требование ±1, серия продолжается', () => {
    const { deal, order } = ladderDeal();
    const g = createGame(deal);
    const wild = order[5]; // ранг далеко от сброса
    expect(isPlayable(g, wild)).toBe(false);
    const res = playCard(g, wild, true);
    expect(res).not.toBeNull();
    expect(res?.chain).toBe(1);
    expect(g.removed.has(wild)).toBe(true);
  });

  it('добор из колоды обнуляет серию и меняет сброс', () => {
    const { deal, order } = ladderDeal();
    const g = createGame(deal);
    expect(playCard(g, order[0])).not.toBeNull();
    expect(g.chain).toBe(1);
    const res = drawStock(g);
    expect(res).toEqual({ finished: null });
    expect(g.chain).toBe(0);
    expect(g.waste).toBe(2); // первая карта стока
    expect(stockLeft(g)).toBe(2);
  });

  it('ундо восстанавливает снимок (removed/серия/очки/сброс/урожай)', () => {
    const { deal, order } = ladderDeal();
    const g = createGame(deal);
    playCard(g, order[0]);
    playCard(g, order[1]);
    expect(g.removed.size).toBe(2);
    const undone = undoLast(g);
    expect(undone).toEqual({ jokerRefund: false });
    expect(g.removed.size).toBe(1);
    expect(g.chain).toBe(1);
    expect(g.score).toBe(Math.round(CORE_CFG.SCORE_BASE * multiplierFor(1)));
    undoLast(g);
    expect(g.removed.size).toBe(0);
    expect(g.waste).toBe(5);
    expect(g.harvestGot).toBe(0);
    expect(undoLast(g)).toBeNull(); // история пуста
  });

  it('ход джокером помечен в истории для возврата бустера при ундо', () => {
    const { deal, order } = ladderDeal();
    const g = createGame(deal);
    playCard(g, order[5], true);
    expect(undoLast(g)).toEqual({ jokerRefund: true });
  });
});

describe('партия: поражение', () => {
  it('сток пуст и ходов нет после добора → поражение', () => {
    const deal = makeDeal({ startWaste: 5, stockRanks: [9], stockSuits: [0] });
    const g = createGame(deal); // все карты стола ранга 1 — к 9 не соседи
    const res = drawStock(g);
    expect(res).toEqual({ finished: 'lose' });
    expect(g.over).toBe(true);
    expect(drawStock(g)).toBeNull(); // партия окончена
  });

  it('тупик после хода без стока → поражение, урожай в счётчике сохранён', () => {
    const deal = makeDeal({ startWaste: 5 });
    const bottomFirst = SLOTS.filter((s) => s.row === 3)[0].id;
    deal.tableRanks[bottomFirst] = 6; // единственный ход
    deal.harvest = new Set([bottomFirst]);
    const g = createGame(deal);
    const res = playCard(g, bottomFirst);
    expect(res?.finished).toBe('lose');
    expect(res?.harvest).toBe(true);
    expect(g.harvestGot).toBe(1); // банкуется экономикой даже при поражении (03 п. 3.6)
    expect(anyMoves(g)).toBe(false);
    expect(firstPlayable(g)).toBeNull();
  });
});

describe('русские индексы карт', () => {
  it('Т/В/Д/К и ранги 1..13', () => {
    expect(RANK_LABELS[1]).toBe('Т');
    expect(RANK_LABELS[11]).toBe('В');
    expect(RANK_LABELS[12]).toBe('Д');
    expect(RANK_LABELS[13]).toBe('К');
    expect(RANK_LABELS).toHaveLength(14);
  });
});
