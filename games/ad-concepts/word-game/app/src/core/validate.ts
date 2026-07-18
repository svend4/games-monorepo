/**
 * Валидатор уровней — порт node-валидатора Прохода А (инварианты INV-W1/INV-W2
 * из шапки prototype/levels.js + правила бонус-слов 03 §2.1):
 *  - составимость: каждое слово сетки и каждый бонус собираются из
 *    МУЛЬТИМНОЖЕСТВА букв колеса (буква используется не чаще, чем есть);
 *  - пересечения: общие клетки двух слов несут одну и ту же букву;
 *  - связность: все слова сетки образуют один связный кроссворд;
 *  - раны: каждый максимальный горизонтальный/вертикальный ран >= 2 клеток —
 *    ровно одно целевое слово (нет «случайных» слов и слов вне списка);
 *  - bbox: все клетки в пределах size (<= 9x9);
 *  - бонусы: длина >= 3, без дублей, не пересекаются со словами сетки.
 *
 * Запускается в тестах на всех 10 уровнях; в проде — этап CI-пайплайна
 * генерации контента (10-production.md).
 */
import { MIN_WORD_LEN } from './config';
import type { LevelData, PlacedWord } from './types';
import { cellKey } from './grid';

/** Мультимножество букв: буква -> количество. */
export function letterCounts(letters: Iterable<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of letters) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

/** INV-W1: слово составимо из мультимножества букв колеса. */
export function canCompose(word: string, wheel: readonly string[]): boolean {
  const pool = letterCounts(wheel);
  for (const ch of word) {
    const left = pool.get(ch) ?? 0;
    if (left <= 0) return false;
    pool.set(ch, left - 1);
  }
  return true;
}

/** Идентификатор рана/слова для сверки укладки: d:r:c:len. */
function runId(d: 'H' | 'V', r: number, c: number, len: number): string {
  return d + ':' + r + ':' + c + ':' + len;
}

function wordRunId(pw: PlacedWord): string {
  return runId(pw.d, pw.r, pw.c, pw.w.length);
}

/**
 * Проверить уровень; возвращает список ошибок (пустой — уровень валиден).
 * Сообщения на русском — валидатор используется и как CI-репортер.
 */
export function validateLevel(level: LevelData): string[] {
  const errors: string[] = [];

  // --- Составимость (INV-W1) ---
  for (const pw of level.words) {
    if (!canCompose(pw.w, level.wheel)) {
      errors.push(`слово сетки «${pw.w}» не составимо из букв колеса`);
    }
  }
  for (const b of level.bonus) {
    if (!canCompose(b, level.wheel)) {
      errors.push(`бонус «${b}» не составим из букв колеса`);
    }
  }

  // --- Дубликаты слов сетки ---
  const gridWords = new Set<string>();
  for (const pw of level.words) {
    if (gridWords.has(pw.w)) errors.push(`слово сетки «${pw.w}» дублируется`);
    gridWords.add(pw.w);
  }

  // --- Пересечения и bbox ---
  const cellLetter = new Map<string, string>();
  for (const pw of level.words) {
    const dr = pw.d === 'V' ? 1 : 0;
    const dc = pw.d === 'H' ? 1 : 0;
    for (let k = 0; k < pw.w.length; k++) {
      const r = pw.r + dr * k;
      const c = pw.c + dc * k;
      if (r < 0 || c < 0 || r >= level.size.h || c >= level.size.w) {
        errors.push(`слово «${pw.w}»: клетка (${r},${c}) вне сетки ${level.size.w}x${level.size.h}`);
        continue;
      }
      const key = cellKey(r, c);
      const prev = cellLetter.get(key);
      const ch = pw.w.charAt(k);
      if (prev !== undefined && prev !== ch) {
        errors.push(`конфликт пересечения в (${r},${c}): «${prev}» vs «${ch}» (слово «${pw.w}»)`);
      }
      if (prev === undefined) cellLetter.set(key, ch);
    }
  }

  // --- Связность: BFS по графу слов (ребро = общая клетка) ---
  if (level.words.length > 1) {
    const wordKeys: string[][] = level.words.map((pw) => {
      const dr = pw.d === 'V' ? 1 : 0;
      const dc = pw.d === 'H' ? 1 : 0;
      const keys: string[] = [];
      for (let k = 0; k < pw.w.length; k++) keys.push(cellKey(pw.r + dr * k, pw.c + dc * k));
      return keys;
    });
    const visited = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const i = queue.pop() as number;
      const set = new Set(wordKeys[i]);
      for (let j = 0; j < wordKeys.length; j++) {
        if (visited.has(j)) continue;
        if (wordKeys[j].some((k) => set.has(k))) {
          visited.add(j);
          queue.push(j);
        }
      }
    }
    if (visited.size !== level.words.length) {
      errors.push(`сетка несвязна: достижимо ${visited.size} слов из ${level.words.length}`);
    }
  }

  // --- Раны (INV-W2): максимальные раны >= 2 клеток == слова сетки, 1:1 ---
  const occupied = new Set(cellLetter.keys());
  const runs = new Set<string>();
  for (let r = 0; r < level.size.h; r++) {
    let c = 0;
    while (c < level.size.w) {
      if (!occupied.has(cellKey(r, c))) {
        c++;
        continue;
      }
      let end = c;
      while (end < level.size.w && occupied.has(cellKey(r, end))) end++;
      if (end - c >= 2) runs.add(runId('H', r, c, end - c));
      c = end;
    }
  }
  for (let c = 0; c < level.size.w; c++) {
    let r = 0;
    while (r < level.size.h) {
      if (!occupied.has(cellKey(r, c))) {
        r++;
        continue;
      }
      let end = r;
      while (end < level.size.h && occupied.has(cellKey(end, c))) end++;
      if (end - r >= 2) runs.add(runId('V', r, c, end - r));
      r = end;
    }
  }
  const wordRuns = new Set(level.words.map(wordRunId));
  for (const id of runs) {
    if (!wordRuns.has(id)) errors.push(`ран ${id} не является целевым словом (INV-W2)`);
  }
  for (const id of wordRuns) {
    if (!runs.has(id)) errors.push(`слово ${id} не образует максимального рана (слипание с соседями)`);
  }

  // --- Бонус-слова: длина, дубли, непересечение со словами сетки ---
  const seenBonus = new Set<string>();
  for (const b of level.bonus) {
    if (b.length < MIN_WORD_LEN) errors.push(`бонус «${b}» короче ${MIN_WORD_LEN} букв`);
    if (seenBonus.has(b)) errors.push(`бонус «${b}» дублируется`);
    seenBonus.add(b);
    if (gridWords.has(b)) errors.push(`бонус «${b}» совпадает со словом сетки`);
  }

  return errors;
}
