/**
 * Контракт платёжного слоя (Проход Е.2, по образцу порта Block Surge).
 *
 * PurchaseProvider — единственная точка, через которую игра говорит с платёжной
 * системой. В проде за интерфейсом встанут StoreKit (iOS) / Google Play Billing
 * (Android) через Capacitor-плагин (10 §2):
 *  - init() → подключение к стору + восстановление покупок (restore);
 *  - buy()  → покупка продукта (SKU полки / Remove Ads / план подписки);
 *             чек валидируется СЕРВЕРОМ до выдачи товара (иначе — фрод),
 *             Promise резолвится после подтверждения.
 *
 * SimPurchaseProvider — СИМУЛЯЦИЯ: «покупка» = мгновенный успех без денег
 * и платёжных провайдеров (1:1 с прототипом monetize.js). Выдачу товара
 * делает MonetizeController.
 */
import { findProduct } from './config';

export interface PurchaseResult {
  /** Покупка подтверждена (в проде — после валидации чека). */
  ok: boolean;
  productId: string;
  /** Цена продукта, $ (0 — покупки не было). */
  priceUsd: number;
}

export interface PurchaseProvider {
  /** Инициализация биллинга. Вызывается один раз на старте приложения. */
  init(): Promise<void>;
  /** Покупка продукта (06 §5). Неизвестный id → ok:false (не reject). */
  buy(productId: string): Promise<PurchaseResult>;
}

/** Симулятор покупок: мгновенный успех, цена — из каталога 06 §5 (1:1). */
export class SimPurchaseProvider implements PurchaseProvider {
  async init(): Promise<void> {
    /* симулятору нечего подключать */
  }

  async buy(productId: string): Promise<PurchaseResult> {
    const product = findProduct(productId);
    if (!product) return { ok: false, productId, priceUsd: 0 };
    return { ok: true, productId, priceUsd: product.price };
  }
}
