/**
 * Bag-генератор с режиссёром сложности (03 §4.1, §5.2; 11 §3.1/3.3) —
 * объём Прохода А (без pity и стресс-индекса), логика и константы 1:1 из прототипа:
 *  - «Классика»: w_hard растёт с очками, dEff = (w_hard − 0.10) / 0.45;
 *  - антифрустрация: fill > 70% → вес SMALL ×1.5;
 *  - тройка без возврата, ≤1 фигуры с H=5;
 *  - выдача: SOLVENCY-CHECK + reroll ≤3 + форс-замена спасательной + деградация.
 */
import type { Bag, Board, PieceId, Rng } from './types';
import { CATALOG, DEF, RESCUE_ORDER, SUM_W0_EASY, SUM_W0_HARD } from './catalog';
import { fillRatio } from './board';
import { solveTriple } from './solver';

/* --- Баланс «Классики» (03 §5.2; 11 §3.1) — значения 1:1 из прототипа --- */
export const W_HARD_START = 0.19; // стартовый w_hard (эквивалент D = 0.20)
export const W_HARD_STEP = 0.03;  // +0.03 за каждые SCORE_STEP очков
export const W_HARD_CAP = 0.55;   // потолок Классики
export const SCORE_STEP = 500;
export const FILL_BOOST_AT = 0.70; // антифрустрация: порог заполненности
export const SMALL_BOOST = 1.5;    // множитель веса SMALL (size ≤ 3)
export const REROLLS = 3;          // reroll'ов солвенси-проверки (03 §4.1 шаг 4)

/** Эффективная сложность Классики от набранных очков (03 §5.2). */
export function currentDEff(score: number): number {
  const wHard = Math.min(W_HARD_CAP, W_HARD_START + W_HARD_STEP * Math.floor(score / SCORE_STEP));
  return (wHard - 0.10) / 0.45;
}

/** Взвешенный мешок: HARD-доля по dEff, внутри группы — пропорционально w0 (11 §3.1). */
export function buildBag(board: Board, dEff: number): Bag {
  const hardShare = Math.min(0.55, Math.max(0.10, 0.10 + 0.45 * dEff));
  const fill = fillRatio(board);
  const bag: Bag = new Map();
  for (const p of CATALOG) {
    const groupShare = p.H >= 4 ? hardShare : 1 - hardShare;
    const groupSum = p.H >= 4 ? SUM_W0_HARD : SUM_W0_EASY;
    let w = (groupShare * p.w0) / groupSum;
    if (fill > FILL_BOOST_AT && p.size <= 3) w *= SMALL_BOOST; // антифрустрация (G-70)
    bag.set(p.id, w);
  }
  return bag;
}

/** Взвешенная вытяжка; возврат последнего id — защита от накопления погрешности float. */
export function weightedDraw(bag: ReadonlyMap<PieceId, number>, rng: Rng): PieceId {
  let sum = 0;
  for (const w of bag.values()) sum += w;
  let roll = rng() * sum;
  let last: PieceId = 'MONO';
  for (const [id, w] of bag) {
    last = id;
    roll -= w;
    if (roll <= 0) return id;
  }
  return last;
}

/** Три вытяжки без возврата; ≤1 фигуры с H=5 в тройке (G-H5, 11 §3.3). */
export function drawTriple(bag: Bag, rng: Rng): PieceId[] {
  const pool = new Map(bag);
  const triple: PieceId[] = [];
  let h5 = 0;
  while (triple.length < 3) {
    let id = weightedDraw(pool, rng);
    if (DEF[id].H === 5 && h5 >= 1) {
      // Вторая H5 — перевытяжка из EASY-остатка пула (лимит «не более 1 H=5»)
      const easy = new Map<PieceId, number>();
      for (const [k, v] of pool) {
        if (DEF[k].H <= 3) easy.set(k, v);
      }
      id = easy.size > 0 ? weightedDraw(easy, rng) : 'MONO';
    }
    if (DEF[id].H === 5) h5++;
    triple.push(id);
    pool.delete(id);
  }
  return triple;
}

/**
 * Полный цикл выдачи тройки (03 §4.1 шаги 1–6; 11 §3.3, INV-G1):
 * reroll ≤3 → форс-замена самой неудобной (по H) фигуры на спасательную →
 * деградация до предела [спасательная, MONO, MONO]. Если и это нерешаемо —
 * поле практически полное: выдаём [MONO×3], честный game over зафиксирует INV-G2.
 */
export function dealTriple(board: Board, score: number, rng: Rng): PieceId[] {
  const dEff = currentDEff(score);
  let triple: PieceId[] = [];
  for (let attempt = 0; attempt <= REROLLS; attempt++) {
    triple = drawTriple(buildBag(board, dEff), rng);
    if (solveTriple(board, triple)) return triple;
  }
  // Форс-замена: худшая по H фигура → спасательная
  let worst = 0;
  for (let i = 1; i < 3; i++) {
    if (DEF[triple[i]].H > DEF[triple[worst]].H) worst = i;
  }
  for (const rescue of RESCUE_ORDER) {
    const cand = triple.slice();
    cand[worst] = rescue;
    if (solveTriple(board, cand)) return cand;
  }
  // Деградация до предела
  for (const rescue of RESCUE_ORDER) {
    const degraded: PieceId[] = [rescue, 'MONO', 'MONO'];
    if (solveTriple(board, degraded)) return degraded;
  }
  return ['MONO', 'MONO', 'MONO'];
}
