/**
 * Константы монетизации Block Surge (Проход Е.2, порт MON из прототипа
 * monetize.js 1:1). Числа — из главы 06; менять только синхронно со спекой.
 * eCPM-модель живёт в src/ads/ecpm.ts (свойство рекламного слоя).
 */
import type { BoosterId } from '../economy/econ';
import type { TranslationKey } from '../i18n';

export const MONETIZE = {
  /** Тот же ключ localStorage, что у прототипа, — сейв подхватывается 1:1. */
  STORAGE_KEY: 'blocksurge_monetize',

  /** Правила interstitial (06 §3) — зашиты кодом, не конфигом кампаний. */
  INT: {
    /** Не показывать, пока сыграно < N партий (прокси «первых 5 уровней», 06 §3.1). */
    FTUE_GAMES: 2,
    /** И первые N мс сессии (прод: 8 мин lifetime, 06 §3.1). */
    FTUE_MS: 30000,
    /** Не чаще 1 показа на каждые (N+1) партий — частотный кап. */
    MIN_GAMES_BETWEEN: 1,
    /** ≥90 сек между interstitial (06 §3.3). */
    MIN_INTERVAL_MS: 90000,
    /** ≥60 сек после rewarded (06 §3.4). */
    AFTER_RW_MS: 60000,
    /** Не после покупки в сессии (06 §3.6) — сутки. */
    AFTER_IAP_MS: 24 * 3600 * 1000,
    /** ≤10/день (06 §3.1; день 1 — 5, здесь прототипный кап 10). */
    SESSION_CAP: 10
  },

  /** Rewarded (06 §2.2): 4 плейсмента. */
  RW: {
    /** «Второй шанс»: 1/партию (06 §2.2, RW-1). */
    RW1_PER_GAME: 1,
    /** «×2 монеты за партию»: 3/день (RW-2). */
    RW2_DAILY_CAP: 3,
    /** «Бесплатный бустер»: 1/день + 1 на боссе → 2 (RW-3). */
    RW3_DAILY_CAP: 2,
    /** «×2 награда стрика/миссии»: 2/день суммарно (RW-4). */
    RW4_DAILY_CAP: 2,
    /** Альтернатива «спасти серию» — 100 монет (06 §2.2, RW-4). */
    RW4_BONUS_COINS: 100
  },

  /** Цели KPI (09 §4) для сравнения в дашборде. */
  TARGETS: {
    intPerDau: 7.0,
    rwPerDau: 1.8,
    bannerPerDau: 35,
    adArpdau: 0.105,
    iapArpdau: 0.045,
    blendedArpdau: 0.15,
    ecpm: { rw: 13, int: 10, banner: 0.4 },
    adShare: 70
  }
} as const;

/* ============================== ПОЛКА IAP ================================ */

/** Выдача SKU: монеты / бустеры / no-ads / подписка / скин / рамка / пасс. */
export interface IapGrant {
  coins?: number;
  boosters?: Partial<Record<BoosterId, number>>;
  removeAds?: boolean;
  subscription?: boolean;
  skin?: string;
  frame?: boolean;
  pass?: boolean;
}

export interface IapSku {
  readonly id: string;
  /** Локализованная tier-цена стора, $US (06 §5). */
  readonly price: number;
  /** Название/описание/бейдж — ключи i18n (Проход Ж.1), UI берёт через t(). */
  readonly titleKey: TranslationKey;
  readonly descKey: TranslationKey;
  readonly grant: IapGrant;
  readonly highlight?: boolean;
  readonly badgeKey?: TranslationKey;
}

/**
 * Полка IAP (06 §5), 11 SKU 1:1 из прототипа. Витрина в проде сегментируется
 * (≤6 SKU); здесь показываем полный каталог для теста.
 */
export const IAP_SHELF: readonly IapSku[] = [
  { id: 'starter', price: 0.99, titleKey: 'iap.starter.title', descKey: 'iap.starter.desc',
    grant: { coins: 600, boosters: { hammer: 1 } }, badgeKey: 'iap.starter.badge' },
  { id: 'coins_s', price: 1.99, titleKey: 'iap.coins_s.title', descKey: 'iap.coins_s.desc',
    grant: { coins: 1200 } },
  { id: 'piggy', price: 2.99, titleKey: 'iap.piggy.title', descKey: 'iap.piggy.desc',
    grant: { coins: 3000 } },
  { id: 'remove_ads', price: 4.99, titleKey: 'iap.remove_ads.title', descKey: 'iap.remove_ads.desc',
    grant: { removeAds: true }, highlight: true, badgeKey: 'iap.remove_ads.badge' },
  { id: 'season_pass', price: 4.99, titleKey: 'iap.season_pass.title', descKey: 'iap.season_pass.desc',
    grant: { coins: 1000, boosters: { undo: 1, swap: 1, hammer: 1 }, pass: true } },
  { id: 'coins_m', price: 4.99, titleKey: 'iap.coins_m.title', descKey: 'iap.coins_m.desc',
    grant: { coins: 3500, boosters: { swap: 1, hammer: 1 } } },
  { id: 'coins_l', price: 9.99, titleKey: 'iap.coins_l.title', descKey: 'iap.coins_l.desc',
    grant: { coins: 8000, boosters: { undo: 2, swap: 1, hammer: 2 } } },
  { id: 'coins_xl', price: 19.99, titleKey: 'iap.coins_xl.title', descKey: 'iap.coins_xl.desc',
    grant: { coins: 18000, boosters: { undo: 4, swap: 4, hammer: 4 }, skin: 'aurora' } },
  { id: 'coins_xxl', price: 49.99, titleKey: 'iap.coins_xxl.title', descKey: 'iap.coins_xxl.desc',
    grant: { coins: 50000, boosters: { undo: 10, swap: 10, hammer: 10 } } },
  { id: 'mega', price: 99.99, titleKey: 'iap.mega.title', descKey: 'iap.mega.desc',
    grant: { coins: 110000, boosters: { undo: 20, swap: 20, hammer: 20 }, skin: 'season', frame: true },
    badgeKey: 'iap.mega.badge' },
  { id: 'sub', price: 7.99, titleKey: 'iap.sub.title', descKey: 'iap.sub.desc',
    grant: { subscription: true, coins: 200 }, highlight: true, badgeKey: 'iap.sub.badge' }
];

/** Ежедневный бонус подписки, монет (06 §5). */
export const SUB_DAILY_COINS = 200;

export function findSku(id: string): IapSku | null {
  for (const sku of IAP_SHELF) {
    if (sku.id === id) return sku;
  }
  return null;
}
