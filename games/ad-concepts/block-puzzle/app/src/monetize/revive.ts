/**
 * «Второй шанс» RW-1 (Проход Е.2, порт reviveBoard из прототипа monetize.js;
 * спека — 06 §2.2 RW-1 «+2 ряда + 2 столбца»).
 *
 * Освобождение места: чистим 2 САМЫЕ ЗАПОЛНЕННЫЕ строки и 2 столбца, снимаем
 * gameOver и раздаём свежую гарантированно разрешимую тройку (redealHand ядра,
 * INV-G1). Награды конца партии при этом НЕ дублируются: Meta.onGameEnd
 * начисляет дельтой (см. meta.ts) — повторный game over в той же партии
 * добирает только прирост звёзд/монет, а gamesPlayed засчитан один раз.
 */
import type { GameState } from '../core/types';
import { redealHand } from '../core/game';

export function reviveBoard(state: GameState): void {
  const b = state.board;
  const n = b.length;
  if (n === 0) return;

  const rowFill = (i: number): number => {
    let k = 0;
    for (let j = 0; j < n; j++) if (b[i][j] !== 0) k++;
    return k;
  };
  const colFill = (j: number): number => {
    let k = 0;
    for (let i = 0; i < n; i++) if (b[i][j] !== 0) k++;
    return k;
  };

  const rows: Array<{ i: number; f: number }> = [];
  const cols: Array<{ i: number; f: number }> = [];
  for (let r = 0; r < n; r++) rows.push({ i: r, f: rowFill(r) });
  for (let c = 0; c < n; c++) cols.push({ i: c, f: colFill(c) });
  rows.sort((a, z) => z.f - a.f);
  cols.sort((a, z) => z.f - a.f);

  for (let k = 0; k < 2 && k < rows.length; k++) {
    const rr = rows[k].i;
    for (let c = 0; c < n; c++) b[rr][c] = 0;
  }
  for (let k = 0; k < 2 && k < cols.length; k++) {
    const cc = cols[k].i;
    for (let r = 0; r < n; r++) b[r][cc] = 0;
  }

  state.gameOver = false;
  redealHand(state); // свежая разрешимая тройка + refreshPlaceable внутри
}
