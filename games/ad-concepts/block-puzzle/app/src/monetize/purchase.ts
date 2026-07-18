/**
 * Контракт платёжного слоя (Проход Е.2).
 *
 * PurchaseProvider — единственная точка, через которую игра говорит с платёжной
 * системой. В проде за интерфейсом встанут StoreKit (iOS) / Google Play Billing
 * (Android) через Capacitor-плагин (10 §2):
 *  - init() → подключение к стору + восстановление покупок (restore);
 *  - buy()  → покупка SKU; чек валидируется СЕРВЕРОМ до выдачи товара
 *             (иначе — фрод), Promise резолвится после подтверждения.
 *
 * SimPurchaseProvider — СИМУЛЯЦИЯ: «покупка» = мгновенный успех без денег
 * и платёжных провайдеров (1:1 с прототипом monetize.js). Выдачу товара
 * делает MonetizeController по grant'у SKU.
 */
import { findSku } from './config';

export interface PurchaseResult {
  /** Покупка подтверждена (в проде — после валидации чека). */
  ok: boolean;
  skuId: string;
  /** Цена SKU, $ (0 — покупки не было). */
  priceUsd: number;
}

export interface PurchaseProvider {
  /** Инициализация биллинга. Вызывается один раз на старте приложения. */
  init(): Promise<void>;
  /** Покупка SKU из полки 06 §5. Неизвестный SKU → ok:false (не reject). */
  buy(skuId: string): Promise<PurchaseResult>;
}

/** Симулятор покупок: мгновенный успех, цена — из полки IAP_SHELF 1:1. */
export class SimPurchaseProvider implements PurchaseProvider {
  async init(): Promise<void> {
    /* симулятору нечего подключать */
  }

  async buy(skuId: string): Promise<PurchaseResult> {
    const sku = findSku(skuId);
    if (!sku) return { ok: false, skuId, priceUsd: 0 };
    return { ok: true, skuId, priceUsd: sku.price };
  }
}
