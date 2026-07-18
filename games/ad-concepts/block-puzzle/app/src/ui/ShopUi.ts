/**
 * Магазин IAP (🛒) — DOM-оверлей в духе Е.1 (порт renderShelf/openIap из
 * прототипа monetize.js). Полка 06 §5 целиком (11 SKU, витрина в проде
 * сегментируется ≤6). Все «покупки» — СИМУЛЯЦИЯ через PurchaseProvider.
 *
 * Контейнер #shopScreen и стили — в index.html; класс наполняет его и
 * слушает клики (делегирование, как MetaUi).
 */
import { IAP_SHELF } from '../monetize/config';
import type { MonetizeController } from '../monetize/monetize';
import type { Economy } from '../economy/economy';
import { t } from '../i18n';

export class ShopUi {
  constructor(
    private readonly monetize: MonetizeController,
    private readonly economy: Economy
  ) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('ShopUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  mount(): void {
    this.el('shopScreen').innerHTML =
      '<div class="metaInner">' +
      '<div class="metaHeader">' +
      '<button id="shopCloseBtn" type="button" class="metaClose">' + t('meta.close') + '</button>' +
      '<div class="metaTotals"><span>🪙 <b id="shopCoins">0</b></span></div>' +
      '</div>' +
      '<section class="metaSection"><h3>' + t('shop.title') + '</h3>' +
      '<p class="metaNote">' + t('shop.note') + '</p>' +
      '<p class="metaNote" id="shopStatus"></p>' +
      '<div id="iapList" class="iapList"></div></section>' +
      '</div>';

    this.el('shopCloseBtn').addEventListener('click', () => this.close());

    // Делегирование покупок на полке.
    this.el('iapList').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.iapBuy');
      if (btn instanceof HTMLButtonElement && !btn.disabled) {
        const id = btn.getAttribute('data-sku');
        if (id) void this.monetize.purchase(id);
      }
    });
  }

  open(): void {
    this.monetize.onShopOpened(); // актуализация дня + дневные перки подписки
    this.el('shopScreen').classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.el('shopScreen').classList.add('hidden');
  }

  /** Перерисовать, только если экран открыт (дёргается из onChanged). */
  refresh(): void {
    const sc = document.getElementById('shopScreen');
    if (sc && !sc.classList.contains('hidden')) this.render();
  }

  private render(): void {
    const s = this.monetize.getState();

    let html = '';
    for (const sku of IAP_SHELF) {
      const owned = this.monetize.isSkuOwned(sku);
      const cls =
        'iapCard' + (sku.highlight === true ? ' hot' : '') + (owned ? ' owned' : '');
      html += '<div class="' + cls + '">';
      html += '<div class="iapTop"><span class="iapTitle">' + t(sku.titleKey) + '</span>';
      if (sku.badgeKey !== undefined) html += '<span class="iapBadge">' + t(sku.badgeKey) + '</span>';
      html += '</div>';
      html += '<div class="iapDesc">' + t(sku.descKey) + '</div>';
      if (owned) {
        html += '<button type="button" class="iapBuy done" disabled>' + t('shop.active') + '</button>';
      } else {
        html +=
          '<button type="button" class="iapBuy" data-sku="' + sku.id + '">$' +
          sku.price.toFixed(2) + '</button>';
      }
      html += '</div>';
    }
    this.el('iapList').innerHTML = html;

    const bits: string[] = [];
    bits.push(s.removeAds ? t('shop.status.adsRemoved') : t('shop.status.adsOn'));
    bits.push(s.subscription.active ? t('shop.status.subActive') : t('shop.status.subNone'));
    if (s.skins.length > 0) bits.push(t('shop.status.skins', { n: s.skins.length }));
    this.el('shopStatus').textContent = t('shop.status.sim') + ' · ' + bits.join(' · ');
    this.el('shopCoins').textContent = String(this.economy.getCoins());
  }
}
