/**
 * Константы монетизации Orchard Peaks (Проход Е.2, порт MON из прототипа
 * monetize.js 1:1). Числа — из главы 06 (§6.2 карта плейсментов, §6.3 правила
 * interstitial, §6.4 полка IAP, §6.5 подписка/remove-ads); менять только
 * синхронно со спекой. eCPM-модель живёт в src/ads/ecpm.ts (свойство
 * рекламного слоя).
 */
import type { AdFormat } from '../ads/ecpm';
import type { BoosterId } from '../economy/econ';

/** Идентификаторы плейсментов (06 §6.2). */
export type PlacementId = 'RW1' | 'RW2' | 'RW3' | 'RW4' | 'RW5' | 'RW6' | 'INT1';

export interface PlacementDef {
  readonly name: string;
  readonly format: AdFormat;
  readonly desc: string;
}

/** Карта плейсментов (06 §6.2). name/desc — для оверлея и полки, 1:1. */
export const PLACEMENTS: Readonly<Record<PlacementId, PlacementDef>> = {
  RW1: { name: 'Второй шанс', format: 'rewarded', desc: 'Продолжить уровень из тупика (стол ≥ 60% чист)' },
  RW2: { name: 'Удвоить награду', format: 'rewarded', desc: '×2 монеты за пройденный уровень' },
  RW3: { name: 'Бустер до уровня', format: 'rewarded', desc: 'Бесплатный бустер в раздачу' },
  RW4: { name: 'Колесо ярмарки', format: 'rewarded', desc: 'Крутить колесо за бонус монет' },
  RW5: { name: '×2 жетоны ярмарки', format: 'rewarded', desc: 'Удвоить жетоны ивента (пт–вс)' },
  RW6: { name: 'Кошелёк садовода', format: 'rewarded', desc: 'Пополнить монеты, когда баланс мал' },
  INT1: { name: 'Межуровневый', format: 'interstitial', desc: 'Возврат на карту сада после победы' }
};

export const RW_ORDER: readonly PlacementId[] = ['RW1', 'RW2', 'RW3', 'RW4', 'RW5', 'RW6'];
export const PLACEMENT_ORDER: readonly PlacementId[] = [...RW_ORDER, 'INT1'];

export const MON = {
  /** Тот же ключ localStorage, что у прототипа, — сейв подхватывается 1:1. */
  STORE_KEY: 'orchardPeaks.monetize',

  /* --- Правила interstitial INT1 (06 §6.3). Все — remote config в проде. --- */
  INT_START_LEVEL: 12, // §6.3.1: пройден уровень ≥ 12
  INT_INSTALL_AGE_H: 24, // §6.3.1: игрок в игре ≥ 24 ч (день 1 — святое)
  INT_MIN_INTERVAL_S: 180, // §6.3.2: ≥ 3 минуты с прошлого INT
  INT_MIN_LEVELS: 2, // §6.3.2: ≥ 2 завершённых уровня с прошлого INT
  INT_DAILY_CAP: 8, // §6.3.3: ≤ 8 показов/день
  INT_SESSION_CAP: 3, // §6.3.3: ≤ 3 показа в одной сессии
  REWARDED_FATIGUE_S: 60, // §6.3.6: не в течение 60 c после rewarded
  PAYER_REST_H: 72, // §6.3.7: окно «покоя плательщика» после IAP

  /* --- Капы rewarded (06 §6.2). RW1/RW2 — по уровню (в TableUi), без дн.капа. --- */
  RW_DAILY_CAP: { RW3: 2, RW4: 1, RW5: 3, RW6: 3 } as Readonly<
    Partial<Record<PlacementId, number>>
  >,

  /* --- Длительность оверлея-симуляции, c (задание: 3–5 c). --- */
  AD_SECONDS: { rewarded: 5, interstitial: 3 } as Readonly<Record<AdFormat, number>>,

  /* --- Тюнинг наград rewarded --- */
  RW6_GRANT_FACTOR: 0.8, // §6.2: грант 0.8·E(n) монет
  RW4_WHEEL: [100, 200, 300, 500, 800, 1200] as readonly number[], // сектора колеса
  RW3_BOOSTERS: ['basket', 'joker'] as readonly BoosterId[], // что даёт бесплатный бустер
  RW5_TOKENS_COINS: 400, // ×2 жетоны ≈ бонус монет (жетонов в прототипе нет)

  /* --- Подписка «Клуб садовода» и remove-ads (06 §6.4/§6.5) --- */
  CLUB_DAILY_COINS: 500, // 500 монет/день на входе
  CLUB_HARVEST_BONUS: 0.5, // +50% урожая

  /* --- Копилка piggy_greenhouse (06 §6.4) --- */
  PIGGY_RATE: 0.05, // копит 5% от выигрышей монет
  PIGGY_UNLOCK: 4000, // вскрытие от 4 000 монет
  PIGGY_CAP: 15000 // cap 15 000
} as const;

/* ============================== ПОЛКА IAP ================================ */

export type IapKind = 'coins' | 'bundle' | 'piggy' | 'remove_ads' | 'sub';

export interface IapSku {
  readonly sku: string;
  /** Цена, $ США (СИМУЛЯЦИЯ — деньги не списываются; в проде — tier стора). */
  readonly price: number;
  readonly kind: IapKind;
  readonly label: string;
  readonly coins?: number;
  readonly joker?: number;
  readonly basket?: number;
  /** Карточки гербария (ресурс Прохода Б, garden.cards). */
  readonly card?: number;
  /** Разовый SKU (стартовый набор). */
  readonly once?: boolean;
  readonly note: string;
}

/**
 * Полка IAP (06 §6.4), 12 SKU 1:1 из прототипа. Содержимое спеки, где нет
 * прямого аналога, отражено монетами/бустерами/карточками гербария.
 */
export const IAP_SHELF: readonly IapSku[] = [
  { sku: 'coins_s', price: 0.99, kind: 'coins', label: 'Горсть монет', coins: 800, note: 'Порог входа, импульс' },
  { sku: 'starter_pack', price: 2.99, kind: 'bundle', label: 'Стартовый набор', coins: 2500, joker: 3, basket: 2, card: 1, once: true, note: 'Разово, окно D3–D21 · главный конвертер 1-го платежа' },
  { sku: 'piggy_greenhouse', price: 3.99, kind: 'piggy', label: 'Теплица-копилка', note: 'Копит 5% выигрышей · вскрытие от 4000 · cap 15000' },
  { sku: 'coins_m', price: 4.99, kind: 'bundle', label: 'Кошель монет', coins: 4500, joker: 1, note: 'Рабочая лошадка' },
  { sku: 'remove_ads', price: 6.99, kind: 'remove_ads', label: 'Убрать рекламу', coins: 500, note: 'Навсегда · убирает interstitial (rewarded остаются) +500💰' },
  { sku: 'club_month', price: 7.99, kind: 'sub', label: 'Клуб садовода', note: 'Подписка/мес · без INT · +50% урожая · 500💰/день' },
  { sku: 'coins_l', price: 9.99, kind: 'bundle', label: 'Сундук монет', coins: 10000, joker: 3, basket: 3, note: 'Основной объём выручки' },
  { sku: 'almanac_premium', price: 7.99, kind: 'bundle', label: 'Premium-альманах', coins: 3000, card: 2, note: 'Сезонный трек альманаха' },
  { sku: 'coins_xl', price: 19.99, kind: 'bundle', label: 'Кит-лайт', coins: 22000, joker: 6, basket: 4, card: 1, note: '' },
  { sku: 'event_bundle', price: 12.99, kind: 'bundle', label: 'Ивентовый набор', coins: 9000, basket: 2, note: 'Ротация номиналов по E(n)' },
  { sku: 'coins_xxl', price: 49.99, kind: 'bundle', label: 'Кит', coins: 60000, joker: 9, basket: 9, card: 2, note: '' },
  { sku: 'coins_max', price: 99.99, kind: 'bundle', label: 'Топ-кит «Фонтан Марты»', coins: 130000, joker: 9, basket: 9, card: 3, note: 'Статус в лиге' }
];

export function findIap(sku: string): IapSku | null {
  for (const item of IAP_SHELF) {
    if (item.sku === sku) return item;
  }
  return null;
}
