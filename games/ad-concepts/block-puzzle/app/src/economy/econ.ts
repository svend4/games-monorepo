/**
 * Константы экономики Block Surge (Проход Е.2 — порт слоя Прохода Б).
 * Числа и имена 1:1 из прототипа (economy.js, ECON) и главы 05 §2.1–§5.
 * Менять номинал — только синхронно со спекой (05 §5, 06 §5, 09 §5).
 */

/** Идентификаторы бустеров-инвентаря (05 §2.2). */
export type BoosterId = 'undo' | 'swap' | 'hammer';

/** Определение бустера для магазина/бара (имя, цена в монетах, подсказка). */
export interface BoosterDef {
  readonly name: string;
  readonly price: number;
  readonly emoji: string;
  readonly hint: string;
}

export const ECON = {
  /** Тот же ключ localStorage, что и в прототипе — сейв подхватывается без миграции. */
  STORAGE_KEY: 'blocksurge_meta',

  /** 05 §3: стартовый баланс (FTUE-подарок), 200 разово. */
  START_COINS: 200,

  /* Sources монет в партии (05 §2.1): */
  /** «Очистка линии = 1» × множитель комбо. */
  COIN_PER_LINE: 1,
  /** Бонус за «чистое поле» (тюнинг прототипа в рамках earn-rate 05 §4). */
  COIN_CLEAN_BOARD: 15,
  /** Конец партии: floor(score/100) — аналог «Победа 25–50». */
  COIN_ENDGAME_DIV: 100,
  /** Защита от runaway при рекордной партии. */
  COIN_ENDGAME_MAX: 100,

  /** Бустеры-инвентарь (05 §2.2 + прайсинг 05 §5). */
  BOOSTERS: {
    undo: { name: 'Отмена', price: 80, emoji: '↩️', hint: 'Отменить последний ход' },
    swap: { name: 'Обмен', price: 120, emoji: '🔁', hint: 'Новая тройка фигур' },
    hammer: { name: 'Молот', price: 150, emoji: '🔨', hint: 'Убрать одну клетку поля' }
  } as Readonly<Record<BoosterId, BoosterDef>>,

  /** Порядок отображения в баре/магазине (по возрастанию цены, как в прототипе). */
  BOOSTER_ORDER: ['undo', 'swap', 'hammer'] as readonly BoosterId[]
} as const;
