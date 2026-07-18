/**
 * Конфиг экономики Orchard Peaks (Проход Е.1, порт ECON из prototype/economy.js
 * 1:1). Числа и имена — из главы 05-economy.md (§5.1–§5.7); менять номинал —
 * только синхронно со спекой. Сейв-ключи ТЕ ЖЕ, что в прототипе:
 * orchardPeaks.meta / orchardPeaks.coins — совместимость без миграции.
 */

export type BoosterId = 'joker' | 'basket';

export interface BoosterDef {
  readonly name: string;
  readonly emoji: string;
  readonly price: number;
  readonly cap: number;
  readonly hint: string;
}

export interface StreakReward {
  readonly coins: number;
  readonly undo?: number;
  readonly joker?: number;
  readonly basket?: number;
}

export type MissionType = 'harvest' | 'chain5' | 'orders' | 'wins';

export interface MissionDef {
  readonly id: string;
  readonly type: MissionType;
  readonly target: number;
  readonly coins: number;
  readonly text: string;
  /** Weekly-миссия дополнительно даёт карточку гербария. */
  readonly card?: boolean;
}

export interface PlanRow {
  readonly day: number;
  readonly level: number;
  readonly saldo: number;
  readonly balance: number;
  readonly note: string;
}

export const ECON = {
  /** Единый JSON мета-документа (ключ прототипа, Проход Б). */
  META_KEY: 'orchardPeaks.meta',
  /** Ключ монет из Прохода А (совместимость: читается при миграции, пишется всегда). */
  LEGACY_COINS: 'orchardPeaks.coins',
  /** Legacy-ключи рекорда/статистики Прохода А (их ведёт TableUi, как game.js). */
  LEGACY_BEST: 'orchardPeaks.bestScore',
  LEGACY_WINS: 'orchardPeaks.wins',
  LEGACY_GAMES: 'orchardPeaks.games',

  /* --- Стартовый баланс, 05 §5.3 --- */
  START_COINS: 1000, // ≈ 3 взноса — буфер на обучение
  START_HARVEST: 20, // первый заказ («расчистить крыльцо», 40) закрывается в 2 уровня
  START_JOKER: 1, // обучающее применение джокера
  START_UNDO: 2, // 2 бесплатных ундо — снять страх ошибки в FTUE

  /* --- Монеты: sources/sinks, 05 §5.2 --- */
  /** Взнос за вход в раздачу (sink): E(n) = 350·1.012ⁿ, округление до 10. */
  ENTRY_BASE: 350,
  ENTRY_GROWTH: 1.012,
  /** Выигрыш (source): W(n) = M(n)·E(n), где M(n) = 2.2 − 0.7·min(1, n/60). */
  WIN_M_HI: 2.2,
  WIN_M_DROP: 0.7,
  WIN_M_KNEE: 60, // после уровня 60 множитель выходит на плато 1.5
  /** Бонус за остаток стока (source): 25 × номер главы за карту (глава = зона+1). */
  STOCK_BONUS_PER_CARD: 25,

  /* --- Урожай: sources/sinks, 05 §5.2 --- */
  HARVEST_PER_CARD: 1, // +1 урожая за карту 🍎 (8–14 на уровень)
  BASKET_MULT: 2, // Золотое лукошко / ивент «Золотая грядка»: ×2 урожай

  /* --- Бустеры: цена и роль, 05 §5.6 --- */
  BOOSTERS: {
    joker: {
      name: 'Джокер',
      emoji: '🃏',
      price: 1200,
      cap: 9,
      hint: 'Убрать любую открытую карту — «страховка» серии'
    },
    basket: {
      name: 'Золотое лукошко',
      emoji: '🧺',
      price: 800,
      cap: 9,
      hint: '×2 урожай за раздачу — растит сад быстрее'
    }
  } as Record<BoosterId, BoosterDef>,
  BOOSTER_ORDER: ['joker', 'basket'] as readonly BoosterId[],
  UNDO_PRICE: 150, // платное ундо после бесплатных (05 §5.2)

  /* --- Стрик «Утренняя лейка», 04 §4.4 (день 1..7, дальше держится на 7) --- */
  STREAK_REWARDS: [
    null, // индекс 0 не используется
    { coins: 200 }, // день 1
    { coins: 300 }, // день 2
    { coins: 400, undo: 1 }, // день 3 (+1 ундо)
    { coins: 500 }, // день 4
    { coins: 600, joker: 1 }, // день 5 (+джокер)
    { coins: 800 }, // день 6
    { coins: 1500, basket: 1 } // день 7+ (+Золотое лукошко)
  ] as readonly (StreakReward | null)[],

  /* --- Миссии, 04 §4.4 (регулятор earn-rate, 05 §5.4) --- */
  DAILY_MISSIONS: [
    { id: 'd_harvest', type: 'harvest', target: 25, coins: 200, text: 'Соберите 25 🍎 урожая' },
    { id: 'd_chain', type: 'chain5', target: 1, coins: 150, text: 'Соберите серию из 5 карт' },
    { id: 'd_order', type: 'orders', target: 1, coins: 300, text: 'Выполните заказ в саду' }
  ] as readonly MissionDef[],
  WEEKLY_MISSIONS: [
    {
      id: 'w_wins',
      type: 'wins',
      target: 12,
      coins: 1200,
      text: 'Выиграйте 12 уровней за неделю',
      card: true
    }
  ] as readonly MissionDef[],

  /* --- Плановый earn-rate по дням (05 §5.4, медианный неплатящий игрок) --- */
  PLAN_5_4: [
    { day: 1, level: 14, saldo: 5600, balance: 6600, note: 'Медовый месяц: профицит по дизайну' },
    { day: 2, level: 26, saldo: 2960, balance: 9560, note: 'Игрок «богат», пробует бустеры' },
    { day: 3, level: 37, saldo: 1610, balance: 11170, note: 'Пик баланса близко' },
    { day: 4, level: 47, saldo: 470, balance: 11640, note: 'Кривая выравнивается' },
    { day: 5, level: 56, saldo: -240, balance: 11400, note: 'Первый дефицитный день' },
    { day: 7, level: 72, saldo: -550, balance: 10400, note: 'Стрик-бонус дня 7 смягчает' },
    { day: 10, level: 97, saldo: -1370, balance: 6900, note: 'Баланс тает — спрос зреет' },
    { day: 14, level: 126, saldo: -2250, balance: 1500, note: 'Точка «Кошелька»: запас < 1 взноса' },
    { day: 21, level: 158, saldo: 580, balance: 3100, note: 'Rewarded-кошелёк вошёл в рутину' },
    { day: 30, level: 196, saldo: 180, balance: 2900, note: 'Стабильная «карусель» микродефицита' }
  ] as readonly PlanRow[]
} as const;

/* ------------------- Чистые формулы экономики (05 §5.2) ------------------- */
/* Вынесены из класса Economy: их используют и Economy, и headless-симулятор,
 * и тесты — без Store/DOM. */

/** Округление номиналов до 10 (как в прототипе). */
export function round10(x: number): number {
  return Math.round(x / 10) * 10;
}

/** Взнос за вход в раздачу уровня n: E(n) = 350·1.012ⁿ, до 10. */
export function entryCostFor(n: number): number {
  return round10(ECON.ENTRY_BASE * Math.pow(ECON.ENTRY_GROWTH, n));
}

/** Множитель выигрыша: M(n) = 2.2 − 0.7·min(1, n/60). */
export function winMultFor(n: number): number {
  return ECON.WIN_M_HI - ECON.WIN_M_DROP * Math.min(1, n / ECON.WIN_M_KNEE);
}

/** Выигрыш за победу: W(n) = M(n)·E(n), до 10. */
export function winRewardFor(n: number): number {
  return round10(winMultFor(n) * entryCostFor(n));
}

/** Форматирование крупных номиналов, 05 §5.5 («42.1K»). */
export function fmt(n: number): string {
  n = Math.round(n);
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 10000) return s + a;
  if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return s + (a / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
}
