/**
 * Базовые типы ядра WordGrove (Проход Е.1, порт прототипа game.js/levels.js).
 * Ядро — ЧИСТАЯ логика: ни Phaser, ни DOM, ни Math.random в расчётах
 * (RNG инжектируется, см. rng.ts).
 */

/** Направление слова в сетке: горизонталь / вертикаль. */
export type Dir = 'H' | 'V';

/** Слово сетки: координаты первой буквы (нумерация с нуля) + направление. */
export interface PlacedWord {
  readonly w: string;
  readonly r: number;
  readonly c: number;
  readonly d: Dir;
}

/** Габариты сетки уровня (bbox <= 9x9 по INV-W2). */
export interface LevelSize {
  readonly w: number;
  readonly h: number;
}

/**
 * Уровень = чистые данные (03 §7): колесо, слова сетки, бонус-словарь.
 * Формат 1:1 с prototype/levels.js.
 */
export interface LevelData {
  /** Базовое слово, из букв которого собран уровень. */
  readonly base: string;
  /** Буквы колеса (перемешаны, чтобы не читалось базовое слово). */
  readonly wheel: readonly string[];
  readonly size: LevelSize;
  readonly words: readonly PlacedWord[];
  /** Валидные словарные слова из букв колеса, НЕ входящие в сетку. */
  readonly bonus: readonly string[];
}

/** Инжектируемый PRNG: () => [0..1). В ядре НЕТ Math.random. */
export type Rng = () => number;

/** Метка открытой клетки: 1 — открыта словом, 2 — подсказкой (золотая). */
export type Revealed = 1 | 2;
