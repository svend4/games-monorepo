/**
 * Типы ядра Block Surge (Проход Е.1 — порт Прохода А из прототипа).
 * ЧИСТАЯ логика: ни Phaser, ни DOM — модуль переиспользуется тестами
 * и будущим автоплей-ботом/симулятором (11 §3.4, 03 §4.2).
 *
 * Представление поля — 1:1 с прототипом (number[][]), а не битборд из 11 §1:
 * порт обязан сохранять поведение прототипа бит-в-бит; переход на битборды —
 * отдельная оптимизация будущего этапа (масок 9×9 в Проходе А нет).
 */

/** Клетка поля: 0 — пусто, 1..8 — colorIdx + 1 (палитра вида). */
export type CellValue = number;

/** Поле N×N (N = 8, board.ts). Мутируется операциями ядра. */
export type Board = CellValue[][];

/** 14 форм каталога (11 §2, 03 §4.1). Вращений нет. */
export type PieceId =
  | 'MONO' | 'DOMINO_H' | 'DOMINO_V' | 'TRIO_I' | 'TRIO_L'
  | 'TET_I' | 'TET_O' | 'TET_L' | 'TET_S' | 'TET_T'
  | 'PENT_P' | 'PENT_L' | 'PENT_X' | 'PENT_I5';

/** Определение фигуры: константы каталога + производные поля. */
export interface PieceDef {
  readonly id: PieceId;
  /** Клетки, нормализованные к (0,0); [строка, столбец]. */
  readonly cells: ReadonlyArray<readonly [number, number]>;
  /** Индекс неудобства 1–5 (03 §4.1): H ≥ 4 — группа HARD. */
  readonly H: 1 | 2 | 3 | 4 | 5;
  /** Базовый вес внутри своей группы мешка (11 §2). */
  readonly w0: number;
  /** Индекс цвета в палитре вида (0..7). */
  readonly colorIdx: number;
  /** Высота bbox (производное от cells). */
  readonly h: number;
  /** Ширина bbox (производное от cells). */
  readonly w: number;
  /** Число клеток фигуры (1..5); size ≤ 3 — группа SMALL. */
  readonly size: number;
}

/** Инжектируемый PRNG: детерминизм партии от сида (INV-G3, 11 §6.1). */
export type Rng = () => number;

/** Взвешенный мешок генератора: id → вес (порядок = порядок каталога). */
export type Bag = Map<PieceId, number>;

/** Полные линии, найденные ОДНОВРЕМЕННО до удаления (11 §4.2 шаг 1). */
export interface Lines {
  rows: number[];
  cols: number[];
}

/** Автомат комбо ×2/×3/×5 с одним «прощением» (11 §5.1). */
export interface ComboState {
  /** Длина цепи последовательных чистящих ходов. */
  chain: number;
  /** Прощение взведено: первый ход новой тройки без очистки не рвёт цепь. */
  graceArmed: boolean;
}

/** Шкала «Прилива» (11 §5.2): 0..SURGE_MAX. */
export interface SurgeState {
  charge: number;
}

/** Полное состояние партии «Классики» (Проход А). */
export interface GameState {
  board: Board;
  /** Рука: 3 гнезда, null — гнездо пусто. */
  hand: (PieceId | null)[];
  /** Кэш «фигуру i можно поставить хоть куда-то» (для HUD и game over). */
  handPlaceable: boolean[];
  /** Ходов сделано текущей тройкой — для «прощения» комбо. */
  handMovesMade: number;
  score: number;
  combo: ComboState;
  surge: SurgeState;
  /** Кристальная бомба в доке (упрощение Прохода А); заряд шкалы заморожен. */
  bombReady: boolean;
  gameOver: boolean;
  rng: Rng;
}

/** Очищенная клетка (для FX вида: цвет нужен ДО обнуления). */
export interface ClearedCell {
  r: number;
  c: number;
  colorIdx: number;
}

/** Результат хода-постановки (placePiece). */
export interface MoveResult {
  placed: { id: PieceId; r: number; c: number };
  /** Строк + столбцов, очищенных этим ходом. */
  lineCount: number;
  /** Множитель комбо, применённый к очкам линий этого хода. */
  mult: number;
  points: number;
  cleanBoard: boolean;
  clearedCells: ClearedCell[];
  /** Шкала заполнилась этим ходом — бомба пришла в док. */
  bombBecameReady: boolean;
  /** Рука опустела и выдана новая тройка. */
  newHandDealt: boolean;
  gameOver: boolean;
}

/** Результат применения кристальной бомбы (dropBomb). Бомба — не ход. */
export interface BombResult {
  removed: number;
  points: number;
  cleanBoard: boolean;
  clearedCells: ClearedCell[];
  gameOver: boolean;
}
