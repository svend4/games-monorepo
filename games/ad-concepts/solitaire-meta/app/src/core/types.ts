/**
 * Типы ядра Orchard Peaks (Проход Е.1, порт prototype/game.js).
 * Чистая логика: ни DOM, ни Phaser — типы используются генератором,
 * состоянием партии, тестами и симулятором.
 */

/** Инжектируемый PRNG: () => [0..1). В ядре НЕТ Math.random. */
export type Rng = () => number;

/** Слот раскладки «3 пика»: позиция и список закрывающих слотов. */
export interface Slot {
  readonly id: number;
  readonly row: number;
  /** Колонка в пол-шагах карт (дробная — карты рядов перекрываются). */
  readonly col: number;
  /** id слотов ряда ниже, закрывающих этот (карта открыта, когда все убраны). */
  readonly coveredBy: readonly number[];
}

/** Сгенерированная раздача: стол 28 карт + сток + стартовый сброс + карты 🍎. */
export interface Deal {
  tableRanks: number[];
  tableSuits: number[];
  stockRanks: number[];
  stockSuits: number[];
  startWaste: number;
  startWasteSuit: number;
  /** id слотов с картами урожая (🍎). */
  harvest: Set<number>;
}

/** Снимок для отмены хода (порт pushHistory прототипа 1:1). */
export interface Snapshot {
  removed: number[];
  stockIdx: number;
  waste: number;
  wasteSuit: number;
  chain: number;
  score: number;
  harvestGot: number;
  /** Ход был сделан джокером — при отмене джокер возвращается в инвентарь. */
  jokerRefund: boolean;
}

/** Состояние партии (порт объекта G прототипа, только core-поля). */
export interface GameState {
  deal: Deal;
  removed: Set<number>;
  stockIdx: number;
  waste: number;
  wasteSuit: number;
  chain: number;
  score: number;
  /** Собрано карт 🍎 в этой раздаче (урожай банкуется в конце уровня). */
  harvestGot: number;
  history: Snapshot[];
  over: boolean;
}

/** Итог хода-уборки карты (для хуков меты/аналитики в UI-слое). */
export interface MoveResult {
  /** Карта была с 🍎 (прогресс дневной миссии «собрать урожай»). */
  harvest: boolean;
  /** Длина серии после хода (chain === CHAIN_MISSION → миссия «серия из 5»). */
  chain: number;
  /** Множитель серии этого хода. */
  mult: number;
  /** Начислено очков за ход. */
  points: number;
  /** Партия завершилась этим ходом. */
  finished: 'win' | 'lose' | null;
}

/** Итог добора из колоды. */
export interface DrawResult {
  finished: 'lose' | null;
}

/** Оценка «живости» расклада генератором (по случайным плейаутам). */
export interface DealQuality {
  /** Доля плейаутов, очистивших стол целиком. */
  winShare: number;
  /** Лучшая доля очистки среди плейаутов. */
  bestClear: number;
}
