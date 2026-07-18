/**
 * WordGrove — офлайн-генератор EN-уровней (Проход Ж.2; приложение 11 §2–3).
 *
 * Запуск:  npx tsx tools/gen-levels.ts            — канонический пакет из PACK_SPEC
 *          npx tsx tools/gen-levels.ts --explore WORD [--words N] [--pack N]
 *                                                  — подбор раскладок для базы WORD
 *
 * Пайплайн на уровень (11 §3):
 *   1) база 6–7 букв из курируемого словаря (§3.1; здесь база фиксирована
 *      слотом PACK_SPEC — «полуручной» режим курирования, как daily в 03 §5.3);
 *   2) кандидаты по мультимножеству букв базы (§3.2, INV-W1 конструктивно);
 *   3) жадный отбор слов сетки со скорингом частотность/пересечения/длина и
 *      джиттером (§3.3; веса откалиброваны под курируемый словарь);
 *   4) укладка: якорь горизонтально по центру 9×9, остальные по убыванию длины,
 *      backtracking с жадным порядком по скорингу компактности
 *      10·crossings − ΔbboxArea − 2·|w−h| и бюджетом K_MAX=500 итераций (§3.4);
 *   5) отбраковка: R-2 (бюджет/нет укладки → другой отбор, до 8 попыток),
 *      R-4 (fillRatio < 0.30), R-5 (аспект bbox > 2:1), R-8 (бонусов < 2);
 *   6) бонус-кэш: все слова словаря, составимые из букв базы и не попавшие
 *      в сетку (§3.6), сортировка по алфавиту;
 *   7) сид уровня — fnv1a32('wordgrove:levelgen:v1:en:{dictVersion}:{pack}:{slot}')
 *      → mulberry32; генерация детерминирована бит-в-бит (INV-W4).
 *
 * Словарь (§2): курируемый встроенный EN-словарь ~490 частотных слов 3–7 букв
 * без имён собственных, аббревиатур и обсценной лексики (F-2/F-3/F-4); слова
 * чувствительных тем (GREY, F-5) не включены вовсе. «Валидация щедрая,
 * генерация строгая» (03 §5.1): BONUS_ONLY_WORDS принимаются как бонусы, но
 * в сетку не кладутся. Коридор объёма словаря проверяется assert'ом (§2.6).
 *
 * Каждый сгенерированный уровень прогоняется через validateLevel (INV-W1/W2,
 * страховочный R-6) — тот же валидатор, что гоняют тесты на RU-уровнях.
 */
import { fnv1a32, mulberry32 } from '../src/core/rng';
import type { Dir, LevelData, PlacedWord, Rng } from '../src/core/types';
import { validateLevel } from '../src/core/validate';

/* ==================== КОНСТАНТЫ ГЕНЕРАТОРА (11 §3) ==================== */

/** Версия словаря — пиннится в сиде уровня (INV-W4). */
export const DICT_VERSION = '1.0.0';
/** Канонический индекс пакета для LEVELS_EN (src/core/levelsEn.ts). */
export const EN_PACK_INDEX = 0;

const BOARD = 9; // поле укладки 9×9 (03 §2.1)
const K_MAX = 500; // бюджет итераций backtracking (§3.4)
const MAX_SELECT_ATTEMPTS = 8; // R-2: попыток другого отбора слов
const MIN_FILL_RATIO = 0.3; // R-4: плотность букв в bbox
const MAX_ASPECT_RATIO = 2; // R-5: аспект bbox не более 2:1
const MIN_BONUS_WORDS = 2; // R-8: уровень кормит копилку жёлудей
const DICT_MIN = 300; // §2.6: коридор объёма курируемого словаря
const DICT_MAX = 500;

/** Веса жадного отбора слов сетки (§3.3; калибровка под курируемый словарь:
 * длина важнее ранга — каркас сетки из длинных слов, как в RU-наборе). */
const W_RANK = 0.2;
const W_CROSS = 0.35;
const W_LEN = 0.45;
const BASE_JITTER = 0.05;

/* ==================== КУРИРУЕМЫЙ EN-СЛОВАРЬ (11 §2) ==================== */

/**
 * Словарь генерации: частотные слова 3–7 букв в порядке убывания «частотного
 * яруса» (ранг = позиция). Только a–z, без имён собственных, аббревиатур,
 * обсценики и GREY-тем (алкоголь, анатомия, религия, оружие) — фильтры
 * F-2..F-6 применены при курировании.
 */
const GEN_WORDS_RAW = `
  ace act age air ale and ant arm art ash
  ask ate bag bat bet big box bus buy can
  cap car cat cup cut day den dig dry due
  ear eat egg end era fan far fit fix fly
  fox fun gap gas get hat hay hen hit hut
  ice ink jar jet job joy key kid kit lad
  lap law led leg let lid lie log lot low
  man map mat may men met mix nap net new
  now nut oak oil old one out owl own pad
  pan pat pay pea pen pet pie pig pin pit
  pot put rag ran rat raw red rip row rug
  run sad sat saw say sea see set sit six
  sky son sun tab tag tan tap tar tea ten
  tie tin tip toe top toy try tub two use
  van way web wet win yes zoo
  ache aged arch bake base beat best cane cape care
  cart chat chin clan dare deal dear dune each earn
  east gate gear hate hear heat herd here hike hint
  hunt hurt inch isle itch kite knit lace land lane
  late lead lean leap lens line list mast mate meat
  near neat neck nest nice pace pain pair pale pane
  part path pear pine plan race rage rain rang rate
  read rent rest ripe rude sake same sang seat sent
  site star stem take tale tame tape task team tear
  tend term then thin tick tile trap trip tune turn
  atom away back ball band bank barn bath bean bear
  bird blue boat bone book bowl burn cake calm camp
  card cave coat coin cold come cook cool core corn
  dark dawn deep deer desk dish door down draw drop
  duck dust face fact fair fall farm fast fear fire
  fish five flag flat flow food foot form four free
  agent anger beast chart cheat cheer clean crate dance earth
  grade grand grant grate great heart inlet paint panel patch
  peach perch petal plane plant plate print range reach skate
  smart stage stake stare steak steam stern teach thick three
  trace train trend under
  apple bacon beach berry black board brain bread break brick
  brown brush cabin candy catch chair charm chase check chest
  child claim class clock cloud coast color count court cover
  craft crash cream cross crowd crown curve dream dress drive
  eagle early eight empty event fancy fence field final flame
  float floor flour fresh fruit glass grape grass green group
  basket candle create danger enlist garden heater hunter listen master
  planet silent stream tender
  animal autumn banana banner bottle branch breeze bridge bright bronze
  bucket butter button camera carpet carrot castle cherry circle coffee
  corner cotton couple cousin dinner doctor dollar donkey double dragon
  chapter kitchen painter strange teacher thunder
  blanket cabinet cartoon century channel chimney classic cottage
  crystal curtain diamond evening feather harvest journey library
`;

/** «Щедрая валидация» (03 §5.1): служебные слова принимаются как бонусы,
 * но сетку не строят — эквивалент двусловарности INV-W3. */
const BONUS_ONLY_WORDS_RAW = `
  are had has her him his how its she the
  they this was were who you
`;

/* ==================== СЛОВАРЬ: СТРУКТУРЫ И СБОРКА ==================== */

interface DictEntry {
  readonly word: string;
  /** 1..N — позиция в курируемом списке (аппроксимация частотного ранга). */
  readonly rank: number;
  readonly counts: ReadonlyMap<string, number>;
  /** false — только валидация бонусов (BONUS_ONLY_WORDS). */
  readonly gridEligible: boolean;
}

function splitWords(raw: string): string[] {
  return raw.trim().split(/\s+/);
}

/** Мультимножество букв слова: буква → количество. */
function letterCounts(word: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of word) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

/** INV-W1: каждая буква inner используется не чаще её кратности в outer. */
function fitsMultiset(inner: ReadonlyMap<string, number>, outer: ReadonlyMap<string, number>): boolean {
  for (const [ch, n] of inner) {
    if ((outer.get(ch) ?? 0) < n) return false;
  }
  return true;
}

function buildDict(): readonly DictEntry[] {
  const seen = new Set<string>();
  const entries: DictEntry[] = [];
  const push = (word: string, gridEligible: boolean): void => {
    if (!/^[a-z]{3,7}$/.test(word)) throw new Error(`словарь: слово вне формата 3–7 букв a-z: «${word}» (F-1/F-2)`);
    if (seen.has(word)) throw new Error(`словарь: дубль «${word}»`);
    seen.add(word);
    entries.push({ word, rank: entries.length + 1, counts: letterCounts(word), gridEligible });
  };
  for (const w of splitWords(GEN_WORDS_RAW)) push(w, true);
  for (const w of splitWords(BONUS_ONLY_WORDS_RAW)) push(w, false);
  if (entries.length < DICT_MIN || entries.length > DICT_MAX) {
    throw new Error(`словарь: объём ${entries.length} вне коридора ${DICT_MIN}–${DICT_MAX} (11 §2.6)`);
  }
  return entries;
}

const DICT: readonly DictEntry[] = buildDict();

function dictEntry(word: string): DictEntry {
  for (const e of DICT) {
    if (e.word === word) return e;
  }
  throw new Error(`словарь: нет слова «${word}»`);
}

/* ==================== КАНДИДАТЫ И ОТБОР СЛОВ СЕТКИ (11 §3.2–3.3) ==================== */

/** Все слова словаря, составимые из мультимножества букв базы (кроме неё самой). */
function enumerateCandidates(base: DictEntry): readonly DictEntry[] {
  return DICT.filter((e) => e.word !== base.word && fitsMultiset(e.counts, base.counts));
}

/** Псевдолемма (аналог lemmaId, 03 §5.2 шаг 3): «cart»/«carts» вместе в сетку не кладём. */
function pseudoLemma(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Строгий префикс: pain/paint. Вложенная пара в сетке допустима (прецедент
 * RU-набора: СТОЛ+СТОЛИК), но не более ОДНОЙ на уровень — цепочки вида
 * pain/paint/painter выглядят мусорно (курационное правило Ж.2). */
function isProperPrefix(a: string, b: string): boolean {
  return a.length < b.length && b.startsWith(a);
}

function prefixPairsWith(word: string, chosen: readonly DictEntry[]): number {
  let n = 0;
  for (const e of chosen) {
    if (isProperPrefix(e.word, word) || isProperPrefix(word, e.word)) n++;
  }
  return n;
}

/** Число РАЗНЫХ букв кандидата, встречающихся в уже выбранных словах. */
function crossPotential(c: DictEntry, chosenLetters: ReadonlySet<string>): number {
  let n = 0;
  for (const ch of c.counts.keys()) {
    if (chosenLetters.has(ch)) n++;
  }
  return n;
}

/** Жадный отбор слов сетки со скорингом и джиттером (§3.3). */
function selectGridWords(base: DictEntry, pool: readonly DictEntry[], target: number, rng: Rng, jitter: number): DictEntry[] {
  const chosen: DictEntry[] = [base];
  const lemmas = new Set<string>([pseudoLemma(base.word)]);
  const chosenLetters = new Set<string>(base.word);
  let prefixPairs = 0;
  while (chosen.length < target) {
    let best: DictEntry | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      if (!c.gridEligible || lemmas.has(pseudoLemma(c.word))) continue;
      if (prefixPairs + prefixPairsWith(c.word, chosen) > 1) continue; // не более 1 вложенной пары
      const cross = crossPotential(c, chosenLetters);
      if (cross === 0) continue; // 03 §5.2 шаг 4: пересечение обязательно
      const s =
        W_RANK * (1 - c.rank / (DICT.length + 1)) +
        W_CROSS * (cross / 8) +
        W_LEN * (c.word.length / 8) +
        jitter * rng();
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best === null) break;
    prefixPairs += prefixPairsWith(best.word, chosen);
    chosen.push(best);
    lemmas.add(pseudoLemma(best.word));
  }
  return chosen;
}

/* ==================== УКЛАДКА: BACKTRACKING + КОМПАКТНОСТЬ (11 §3.4) ==================== */

interface Placement {
  readonly word: string;
  readonly r: number;
  readonly c: number;
  readonly d: Dir;
}

type Cells = (string | null)[];

function cellAt(cells: Cells, r: number, c: number): string | null {
  if (r < 0 || c < 0 || r >= BOARD || c >= BOARD) return null;
  return cells[r * BOARD + c];
}

function putWord(cells: Cells, p: Placement): string[] {
  const dr = p.d === 'V' ? 1 : 0;
  const dc = p.d === 'H' ? 1 : 0;
  const added: string[] = [];
  for (let k = 0; k < p.word.length; k++) {
    const idx = (p.r + dr * k) * BOARD + (p.c + dc * k);
    if (cells[idx] === null) {
      cells[idx] = p.word.charAt(k);
      added.push(String(idx));
    }
  }
  return added;
}

function removeCells(cells: Cells, added: readonly string[]): void {
  for (const s of added) cells[Number(s)] = null;
}

interface Bbox {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
  filled: number;
}

function bboxOf(cells: Cells): Bbox {
  let minR = BOARD, maxR = -1, minC = BOARD, maxC = -1, filled = 0;
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (cells[r * BOARD + c] === null) continue;
      filled++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  return { minR, maxR, minC, maxC, filled };
}

/**
 * Классические правила легальности кроссворда (§3.4 isLegal):
 * пересечения совпадают по буквам; непересечения — на пустых клетках без
 * боковых касаний; клетки до и после слова пусты; всё в пределах 9×9.
 * Возвращает число пересечений или -1 (нелегально).
 */
function legalCrossings(cells: Cells, word: string, r: number, c: number, d: Dir): number {
  const dr = d === 'V' ? 1 : 0;
  const dc = d === 'H' ? 1 : 0;
  const endR = r + dr * (word.length - 1);
  const endC = c + dc * (word.length - 1);
  if (r < 0 || c < 0 || endR >= BOARD || endC >= BOARD) return -1;
  if (cellAt(cells, r - dr, c - dc) !== null) return -1; // клетка до
  if (cellAt(cells, endR + dr, endC + dc) !== null) return -1; // клетка после
  let crossings = 0;
  for (let k = 0; k < word.length; k++) {
    const rr = r + dr * k;
    const cc = c + dc * k;
    const cur = cellAt(cells, rr, cc);
    if (cur !== null) {
      if (cur !== word.charAt(k)) return -1; // конфликт пересечения
      crossings++;
    } else if (cellAt(cells, rr + dc, cc + dr) !== null || cellAt(cells, rr - dc, cc - dr) !== null) {
      return -1; // боковое касание → случайный ран (INV-W2)
    }
  }
  // Без пересечений слово висит в воздухе; полное наложение — не размещение.
  return crossings === 0 || crossings === word.length ? -1 : crossings;
}

/** Скоринг компактности размещения (§3.4): 10·crossings − ΔS(bbox) − 2·|w−h|. */
function compactScore(before: Bbox, p: Placement, crossings: number): number {
  const endR = p.r + (p.d === 'V' ? p.word.length - 1 : 0);
  const endC = p.c + (p.d === 'H' ? p.word.length - 1 : 0);
  const minR = Math.min(before.minR, p.r);
  const maxR = Math.max(before.maxR, endR);
  const minC = Math.min(before.minC, p.c);
  const maxC = Math.max(before.maxC, endC);
  const areaBefore = (before.maxR - before.minR + 1) * (before.maxC - before.minC + 1);
  const w = maxC - minC + 1;
  const h = maxR - minR + 1;
  return 10 * crossings - (w * h - areaBefore) - 2 * Math.abs(w - h);
}

/**
 * Укладка §3.4: якорь (words[0]) горизонтально по центру, остальные по
 * убыванию длины; на каждом шаге кандидаты в порядке убывания компактности,
 * поиск с возвратом, бюджет K_MAX итераций (исчерпан → null, R-2).
 */
function layoutCrossword(words: readonly string[]): Placement[] | null {
  const cells: Cells = new Array<string | null>(BOARD * BOARD).fill(null);
  const anchorWord = words[0];
  const anchor: Placement = {
    word: anchorWord,
    r: Math.floor(BOARD / 2),
    c: Math.floor((BOARD - anchorWord.length) / 2),
    d: 'H'
  };
  putWord(cells, anchor);
  const rest = [...words.slice(1)].sort((a, b) => b.length - a.length);
  const placements: Placement[] = [anchor];
  let iters = 0;
  let aborted = false;

  const place = (i: number): boolean => {
    if (i === rest.length) return true;
    const word = rest[i];
    const seen = new Set<string>();
    const cands: Array<{ p: Placement; score: number }> = [];
    const before = bboxOf(cells);
    for (let r = 0; r < BOARD; r++) {
      for (let c = 0; c < BOARD; c++) {
        const letter = cellAt(cells, r, c);
        if (letter === null) continue;
        for (let k = 0; k < word.length; k++) {
          if (word.charAt(k) !== letter) continue;
          for (const d of ['H', 'V'] as const) {
            const pr = d === 'V' ? r - k : r;
            const pc = d === 'H' ? c - k : c;
            const id = d + ':' + pr + ':' + pc;
            if (seen.has(id)) continue;
            seen.add(id);
            const crossings = legalCrossings(cells, word, pr, pc, d);
            if (crossings < 0) continue;
            const p: Placement = { word, r: pr, c: pc, d };
            cands.push({ p, score: compactScore(before, p, crossings) });
          }
        }
      }
    }
    cands.sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.p.r !== b.p.r
          ? a.p.r - b.p.r
          : a.p.c !== b.p.c
            ? a.p.c - b.p.c
            : a.p.d < b.p.d
              ? -1
              : 1
    );
    for (const cand of cands) {
      if (++iters > K_MAX) {
        aborted = true;
        return false;
      }
      const added = putWord(cells, cand.p);
      placements.push(cand.p);
      if (place(i + 1)) return true;
      placements.pop();
      removeCells(cells, added);
      if (aborted) return false;
    }
    return false;
  };

  return place(0) && !aborted ? placements : null;
}

/* ==================== СБОРКА УРОВНЯ (11 §3.5–3.7) ==================== */

export interface SlotSpec {
  /** Базовое слово слота (курируемый выбор, 6–7 букв). */
  readonly base: string;
  /** Целевое число слов сетки, включая базу (3..9). */
  readonly words: number;
}

/**
 * Канонический пакет из 12 EN-уровней прогрессирующей сложности:
 * колесо 6 → 7 букв, слова сетки 4 → 8 (полосы баккетов D1..D4, §3.1).
 */
export const PACK_SPEC: readonly SlotSpec[] = [
  { base: 'garden', words: 4 },
  { base: 'planet', words: 4 },
  { base: 'candle', words: 5 },
  { base: 'master', words: 5 },
  { base: 'basket', words: 5 },
  { base: 'silent', words: 6 },
  { base: 'painter', words: 6 },
  { base: 'kitchen', words: 6 },
  { base: 'teacher', words: 7 },
  { base: 'thunder', words: 7 },
  { base: 'chapter', words: 7 },
  { base: 'strange', words: 8 }
];

/** Детерминированное перемешивание букв базы для колеса (Fisher–Yates). */
function makeWheel(base: string, rng: Rng): string[] {
  const letters = base.toUpperCase().split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = letters[i];
    letters[i] = letters[j];
    letters[j] = tmp;
  }
  // Колесо не должно читаться как база (03 §5.2 шаг 1) — иначе сдвиг на 1.
  if (letters.join('') === base.toUpperCase()) {
    const first = letters.shift();
    if (first !== undefined) letters.push(first);
  }
  return letters;
}

/** Бонус-кэш (§3.6): все слова словаря из букв базы, не попавшие в сетку. */
function bonusFor(base: DictEntry, gridWords: ReadonlySet<string>): string[] {
  return DICT.filter((e) => e.word !== base.word && !gridWords.has(e.word) && fitsMultiset(e.counts, base.counts))
    .map((e) => e.word.toUpperCase())
    .sort();
}

interface BuiltLevel {
  readonly level: LevelData;
  readonly fillRatio: number;
  readonly difficulty: number;
}

/** Частоты букв словаря генерации — для rarity в формуле сложности (§2.3). */
function buildLetterFreq(): ReadonlyMap<string, number> {
  const freq = new Map<string, number>();
  for (const e of DICT) {
    if (!e.gridEligible) continue;
    for (const ch of e.word) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  return freq;
}

const LETTER_FREQ = buildLetterFreq();

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function rarity(ch: string): number {
  let fMax = -Infinity;
  let fMin = Infinity;
  for (const f of LETTER_FREQ.values()) {
    if (f > fMax) fMax = f;
    if (f < fMin) fMin = f;
  }
  const f = LETTER_FREQ.get(ch) ?? fMin;
  return clamp01((Math.log(fMax) - Math.log(f)) / (Math.log(fMax) - Math.log(fMin)));
}

/** Скоринг сложности — дословно 03 §6.1 / 11 §3.7 (для отчёта курирования). */
function computeDifficulty(base: DictEntry, words: readonly DictEntry[]): number {
  const distinct = [...new Set(base.word)];
  const R = distinct.reduce((s, ch) => s + rarity(ch), 0) / distinct.length;
  const F = words.reduce((s, w) => s + w.rank / DICT.length, 0) / words.length;
  const N = clamp01((words.length - 3) / 6);
  const L = clamp01((words.reduce((s, w) => s + w.word.length, 0) / words.length - 3) / 4);
  return 0.35 * R + 0.3 * F + 0.2 * N + 0.15 * L;
}

/**
 * Сгенерировать уровень слота: до MAX_SELECT_ATTEMPTS отборов слов (R-2),
 * критерии R-4/R-5/R-8, финальный validateLevel (страховочный R-6).
 */
function generateLevel(spec: SlotSpec, packIdx: number, slot: number): BuiltLevel {
  const base = dictEntry(spec.base);
  if (base.word.length < 6 || base.word.length > 7) {
    throw new Error(`база «${spec.base}»: длина ${base.word.length} вне полосы 6–7 букв (§3.1)`);
  }
  const seed = fnv1a32(`wordgrove:levelgen:v1:en:${DICT_VERSION}:${packIdx}:${slot}`);
  const rng = mulberry32(seed);
  const pool = enumerateCandidates(base);
  const gridPool = pool.filter((e) => e.gridEligible);
  if (gridPool.length < spec.words - 1 + 2) {
    throw new Error(`база «${spec.base}»: пул кандидатов ${gridPool.length} слишком мал (R-1)`);
  }

  for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
    const jitter = BASE_JITTER * (1 + attempt);
    const chosen = selectGridWords(base, gridPool, spec.words, rng, jitter);
    if (chosen.length !== spec.words) continue;
    const placements = layoutCrossword(chosen.map((e) => e.word));
    if (placements === null) continue; // R-2: другой отбор

    // Кроп к bbox и метрики R-4/R-5.
    const cells: Cells = new Array<string | null>(BOARD * BOARD).fill(null);
    for (const p of placements) putWord(cells, p);
    const bb = bboxOf(cells);
    const w = bb.maxC - bb.minC + 1;
    const h = bb.maxR - bb.minR + 1;
    const fillRatio = bb.filled / (w * h);
    if (fillRatio < MIN_FILL_RATIO) continue; // R-4: «палочная» сетка
    if (Math.max(w, h) > MAX_ASPECT_RATIO * Math.min(w, h)) continue; // R-5

    const gridWordSet = new Set(chosen.map((e) => e.word));
    const bonus = bonusFor(base, gridWordSet);
    if (bonus.length < MIN_BONUS_WORDS) continue; // R-8

    const words: PlacedWord[] = placements.map((p) => ({
      w: p.word.toUpperCase(),
      r: p.r - bb.minR,
      c: p.c - bb.minC,
      d: p.d
    }));
    const level: LevelData = {
      base: base.word.toUpperCase(),
      wheel: makeWheel(base.word, rng),
      size: { w, h },
      words,
      bonus
    };
    const errors = validateLevel(level);
    if (errors.length > 0) {
      // R-6: по построению невозможно — красный assert против регрессий.
      throw new Error(`база «${spec.base}»: инварианты нарушены: ${errors.join('; ')}`);
    }
    return { level, fillRatio, difficulty: computeDifficulty(base, chosen) };
  }
  throw new Error(`база «${spec.base}»: укладка не найдена за ${MAX_SELECT_ATTEMPTS} отборов (R-2)`);
}

/**
 * Канонический EN-пакет: 12 уровней по PACK_SPEC. Детерминирован по packIdx
 * (INV-W4): повторный вызов даёт бит-в-бит тот же результат.
 */
export function generateEnPack(packIdx: number = EN_PACK_INDEX): LevelData[] {
  return PACK_SPEC.map((spec, slot) => generateLevel(spec, packIdx, slot).level);
}

/** Полный отчёт пакета (для CLI-курирования). */
export function generateEnPackReport(packIdx: number = EN_PACK_INDEX): BuiltLevel[] {
  return PACK_SPEC.map((spec, slot) => generateLevel(spec, packIdx, slot));
}

/* ==================== CLI ==================== */

function renderAscii(level: LevelData): string {
  const rows: string[][] = [];
  for (let r = 0; r < level.size.h; r++) rows.push(new Array<string>(level.size.w).fill('·'));
  for (const pw of level.words) {
    const dr = pw.d === 'V' ? 1 : 0;
    const dc = pw.d === 'H' ? 1 : 0;
    for (let k = 0; k < pw.w.length; k++) rows[pw.r + dr * k][pw.c + dc * k] = pw.w.charAt(k);
  }
  return rows.map((row) => '  ' + row.join(' ')).join('\n');
}

function formatLevel(level: LevelData, indent: string): string {
  const q = (s: string): string => `'${s}'`;
  const lines: string[] = [];
  lines.push(indent + '{');
  lines.push(indent + `  base: ${q(level.base)},`);
  lines.push(indent + `  wheel: [${level.wheel.map(q).join(', ')}],`);
  lines.push(indent + `  size: { w: ${level.size.w}, h: ${level.size.h} },`);
  lines.push(indent + '  words: [');
  const wordLines = level.words.map((pw) => indent + `    { w: ${q(pw.w)}, r: ${pw.r}, c: ${pw.c}, d: ${q(pw.d)} }`);
  lines.push(wordLines.join(',\n'));
  lines.push(indent + '  ],');
  lines.push(indent + `  bonus: [${level.bonus.map(q).join(', ')}]`);
  lines.push(indent + '}');
  return lines.join('\n');
}

function bucketOf(d: number): string {
  if (d < 0.25) return 'D1';
  if (d < 0.45) return 'D2';
  if (d < 0.6) return 'D3';
  if (d < 0.75) return 'D4';
  return 'D5';
}

function mainPack(packIdx: number): void {
  const report = generateEnPackReport(packIdx);
  console.log(`// Словарь: ${DICT.length} слов (генерация ${DICT.filter((e) => e.gridEligible).length} + ` +
    `бонус-валидация ${DICT.filter((e) => !e.gridEligible).length}), версия ${DICT_VERSION}, пакет ${packIdx}`);
  console.log('//');
  report.forEach((b, i) => {
    const l = b.level;
    console.log(`// Уровень ${i + 1}: ${l.base} — колесо ${l.wheel.length}, слов ${l.words.length}, ` +
      `бонусов ${l.bonus.length}, bbox ${l.size.w}x${l.size.h}, fill ${b.fillRatio.toFixed(2)}, ` +
      `difficulty ${b.difficulty.toFixed(3)} (${bucketOf(b.difficulty)})`);
    console.log(renderAscii(l).replace(/^/gm, '//'));
    console.log('//');
  });
  console.log('export const LEVELS_EN: readonly LevelData[] = [');
  console.log(report.map((b) => formatLevel(b.level, '  ')).join(',\n'));
  console.log('];');
}

function mainExplore(baseWord: string, wordsTarget: number, packIdx: number): void {
  const spec: SlotSpec = { base: baseWord, words: wordsTarget };
  const built = generateLevel(spec, packIdx, 0);
  console.log(`// explore ${baseWord}: слов ${built.level.words.length}, бонусов ${built.level.bonus.length}, ` +
    `fill ${built.fillRatio.toFixed(2)}, difficulty ${built.difficulty.toFixed(3)} (${bucketOf(built.difficulty)})`);
  console.log(renderAscii(built.level));
  console.log(formatLevel(built.level, ''));
}

function main(): void {
  const args = process.argv.slice(2);
  const readOpt = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const packIdx = Number(readOpt('--pack') ?? EN_PACK_INDEX);
  const explore = readOpt('--explore');
  if (explore !== null) {
    mainExplore(explore.toLowerCase(), Number(readOpt('--words') ?? 5), packIdx);
    return;
  }
  mainPack(packIdx);
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/gen-levels\.[tj]s$/.test(argv1)) main();
