/**
 * Данные сада (порт ZONES из prototype/meta.js 1:1).
 * Зоны 04 §4.2: Крыльцо → Клумбы → Огород → Теплица (4 зоны на прототип из 12
 * на запуске). В каждой 4 заказа. Заказ потребляет урожай (единственный sink
 * урожая, 05 §5.2) и иногда монеты; даёт награду и открывает следующий.
 */

export interface OrderDef {
  readonly title: string;
  /** Стоимость в урожае (40–400, 04 §4.2). */
  readonly costH: number;
  /** Стоимость в монетах (0 — только урожай). */
  readonly costC: number;
  /** Награда монет за заказ. */
  readonly rc: number;
  /** Эмодзи-декорация, «достраивающая» сцену зоны (визуальный прогресс). */
  readonly decor: string;
}

export interface ZoneDef {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly scene: string;
  readonly orders: readonly OrderDef[];
  /** Глобальный индекс первого заказа зоны (заполняется ниже). */
  startIndex: number;
  /** Индекс за последним заказом зоны (exclusive). */
  endIndex: number;
}

export const ZONES: readonly ZoneDef[] = [
  {
    id: 'porch',
    name: 'Крыльцо',
    emoji: '🏡',
    scene: 'Дощатое крыльцо тётиного дома',
    orders: [
      { title: 'Расчистить дорожку', costH: 40, costC: 0, rc: 120, decor: '🧹' },
      { title: 'Повесить фонарик', costH: 70, costC: 0, rc: 150, decor: '🏮' },
      { title: 'Починить скамейку', costH: 120, costC: 100, rc: 260, decor: '🪑' },
      { title: 'Посадить герань у входа', costH: 160, costC: 0, rc: 220, decor: '🌺' }
    ],
    startIndex: 0,
    endIndex: 0
  },
  {
    id: 'beds',
    name: 'Клумбы',
    emoji: '🌷',
    scene: 'Полоса клумб вдоль забора',
    orders: [
      { title: 'Вскопать клумбу', costH: 120, costC: 0, rc: 200, decor: '🪴' },
      { title: 'Посадить лаванду', costH: 180, costC: 120, rc: 320, decor: '💜' },
      { title: 'Высадить тюльпаны', costH: 220, costC: 0, rc: 300, decor: '🌷' },
      { title: 'Поставить бордюр', costH: 280, costC: 200, rc: 380, decor: '🧱' }
    ],
    startIndex: 0,
    endIndex: 0
  },
  {
    id: 'garden',
    name: 'Огород',
    emoji: '🥕',
    scene: 'Огород за домом',
    orders: [
      { title: 'Разметить грядки', costH: 200, costC: 0, rc: 260, decor: '🌱' },
      { title: 'Посадить морковь', costH: 260, costC: 150, rc: 340, decor: '🥕' },
      { title: 'Посадить томаты', costH: 320, costC: 0, rc: 360, decor: '🍅' },
      { title: 'Собрать первый урожай', costH: 380, costC: 250, rc: 520, decor: '🧺' }
    ],
    startIndex: 0,
    endIndex: 0
  },
  {
    id: 'greenhouse',
    name: 'Теплица',
    emoji: '🪟',
    scene: 'Стеклянная теплица у пруда',
    orders: [
      { title: 'Собрать каркас', costH: 260, costC: 200, rc: 380, decor: '🔩' },
      { title: 'Вставить стёкла', costH: 340, costC: 0, rc: 420, decor: '🪟' },
      { title: 'Высадить рассаду', costH: 400, costC: 0, rc: 440, decor: '🌿' },
      { title: 'Запустить полив', costH: 400, costC: 300, rc: 640, decor: '💧' }
    ],
    startIndex: 0,
    endIndex: 0
  }
];

/** Очки альманаха за заказ (04 §4.5, лёгкий счётчик). */
export const ALMANAC_PER_ORDER = 10;

export interface FlatOrder {
  readonly order: OrderDef;
  readonly zoneIdx: number;
}

/** Плоский список заказов + карта «глобальный индекс → зона». */
export const FLAT: readonly FlatOrder[] = (() => {
  const flat: FlatOrder[] = [];
  ZONES.forEach((z, zi) => {
    z.startIndex = flat.length;
    for (const o of z.orders) flat.push({ order: o, zoneIdx: zi });
    z.endIndex = flat.length; // exclusive
  });
  return flat;
})();

export const TOTAL_ORDERS = FLAT.length;

/** Крупная награда за завершение зоны (04 §4.2/§4.3). */
export function zoneCompleteBonus(zoneIdx: number): number {
  return 1000 + 500 * zoneIdx;
}
