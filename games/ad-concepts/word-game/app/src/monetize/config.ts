/**
 * Константы монетизации WordGrove (Проход Е.2, порт WGMON из прототипа
 * monetize.js 1:1). Числа — из главы 06; менять только синхронно со спекой.
 * eCPM-модель живёт в src/ads/ecpm.ts (свойство рекламного слоя).
 */

export const MONETIZE = {
  /** Тот же ключ localStorage, что у прототипа, — сейв подхватывается 1:1. */
  STORAGE_KEY: 'wordgrove.monetize.v1',

  /* --- Правила interstitial I-1 (06 §4), зашиты кодом ---
   * Прототипные величины ниже проды (быстрее тестировать); прод — в примечаниях. */
  INT: {
    /** Не раньше 3-го уровня (прод: индекс 5 = уровень 6, 06 §4 п.2). */
    MIN_LEVEL_INDEX: 2,
    /** ≥45 сек между показами (прод: 180 сек T1 / 120 T2-3, 06 §4 п.3). */
    MIN_INTERVAL_MS: 45000,
    /** Не в течение 30 сек после rewarded (06 §4 п.4). */
    AFTER_RW_MS: 30000,
    /** Дневной кап 12 — жёсткий (06 §4 п.10). */
    SESSION_CAP: 12
  },

  /* --- Rewarded (06 §3.1) --- */
  RW: {
    /** «Бесплатная Лампа»: 1/уровень, ≤4/день (RV-1). */
    RV1_DAILY_CAP: 4,
    /** «Заморозка стрика»: серия ≤1/нед — в прототипе 1/день (RV-6). */
    RV6_DAILY_CAP: 1
  },

  BANNER: {
    /** B-1 с уровня 2 (прод: с уровня 11 в T1 / 6 в T2-3, 06 §3.3/§7). */
    MIN_LEVEL_INDEX: 1
  },

  /* --- Подписка WordGrove Club (06 §5.1) — ГЛАВНЫЙ платный продукт --- */
  SUB: {
    monthly: { id: 'sub_month', price: 8.99, days: 30, label: 'Месяц' },
    yearly: { id: 'sub_year', price: 49.99, days: 365, label: 'Год (−54%)' },
    /** 7 дней бесплатного триала. */
    trialDays: 7,
    /** −30% стора (net; 06 §5.1). */
    storeCut: 0.3,
    /** +20% монет со всех наград (06 §5.1, перк 5). */
    coinBonusPct: 0.2,
    perks: [
      'Ноль interstitial и баннеров',
      'Ежедневный премиум-кроссворд 9×9 с темой',
      'Безлимит Ламп (подсказки бесплатно)',
      'Автооткрытие копилки жёлудей',
      '+20% монет со всех наград',
      'Авто-заморозка стрика · архив daily 7 дней'
    ]
  },

  /* --- Remove Ads (06 §5.2) — разовая --- */
  REMOVE_ADS: { id: 'remove_ads', price: 9.99 },

  /* --- Цели KPI (09 §3, 06 §8) для сравнения в дашборде --- */
  TARGETS: {
    intPerDau: 3.2,
    rwPerDau: 1.5,
    bannerPerDau: 9.0, // показы/DAU (09 §3)
    adArpdau: 0.055,
    subArpdau: 0.019,
    iapArpdau: 0.011, // ARPDAU-компоненты (06 §8.3)
    blendedArpdau: 0.085,
    ecpm: { rw: 17.8, int: 14.0, banner: 0.55 }, // eCPM US (06 §8.1)
    revSplit: { ad: 65, sub: 22, iap: 13 } // целевой сплит выручки (06 §1, §8.3)
  }
} as const;

export type SubPlan = 'monthly' | 'yearly';

/* ============================== ПОЛКА IAP ================================ */

/** Косметическая часть выдачи SKU (у экономики WordGrove нет инвентаря бустеров). */
export interface IapCosmetic {
  skin?: string;
  frame?: boolean;
  badge?: boolean;
}

export interface IapSku {
  readonly id: string;
  /** Локализованная tier-цена стора, $US (06 §5.3). */
  readonly price: number;
  readonly title: string;
  /** Монет к выдаче (реально начисляются через мост ядра). */
  readonly coins: number;
  readonly desc: string;
  /** Одноразовый SKU (стартовый набор). */
  readonly once?: boolean;
  readonly highlight?: boolean;
  readonly badge?: string;
  readonly cosmetic?: IapCosmetic;
}

/** Полка монет (06 §5.3), 7 SKU 1:1 из прототипа. */
export const IAP_SHELF: readonly IapSku[] = [
  { id: 'coins_handful', price: 0.99, title: 'Горсть монет', coins: 600,
    desc: '600 🪙 · импульсная первая покупка', badge: 'СТАРТ' },
  { id: 'coins_starter', price: 2.99, title: 'Стартовый набор', coins: 1800, once: true,
    desc: '1800 🪙 + 3 Лампы + 2 Прицела + бейдж · 1 раз', badge: 'ЛУЧШИЙ СТАРТ', cosmetic: { badge: true } },
  { id: 'coins_pouch', price: 4.99, title: 'Кошель', coins: 3500,
    desc: '3500 🪙 · стандарт' },
  { id: 'coins_chest', price: 9.99, title: 'Сундук', coins: 8000,
    desc: '8000 🪙 + 5 Ракет · основной объём', highlight: true },
  { id: 'coins_chest_t', price: 19.99, title: 'Сундук + тема', coins: 18000,
    desc: '18 000 🪙 + 12 Ракет + тема оформления', cosmetic: { skin: 'chest_theme' } },
  { id: 'coins_region', price: 49.99, title: 'Ларец региона', coins: 50000,
    desc: '50 000 🪙 + 30 Ракет + эксклюзивная открытка', cosmetic: { skin: 'region_card' } },
  { id: 'coins_master', price: 99.99, title: 'Мешок мастера', coins: 120000,
    desc: '120 000 🪙 + все бустеры ×20 + рамка профиля', badge: 'ЯКОРЬ', cosmetic: { frame: true } }
];

export function findSku(id: string): IapSku | null {
  for (const sku of IAP_SHELF) {
    if (sku.id === id) return sku;
  }
  return null;
}

/**
 * Любой платный продукт по id (полка + Remove Ads + планы подписки) —
 * для платёжного провайдера: цена подтверждается «стором» (симулятором).
 */
export function findProduct(id: string): { id: string; price: number } | null {
  const sku = findSku(id);
  if (sku) return { id: sku.id, price: sku.price };
  if (id === MONETIZE.REMOVE_ADS.id) return { id, price: MONETIZE.REMOVE_ADS.price };
  if (id === MONETIZE.SUB.monthly.id) return { id, price: MONETIZE.SUB.monthly.price };
  if (id === MONETIZE.SUB.yearly.id) return { id, price: MONETIZE.SUB.yearly.price };
  return null;
}
