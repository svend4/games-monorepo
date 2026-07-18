/**
 * Магазин (🛒) — DOM-оверлей, порт renderShop/openShop из прототипа
 * monetize.js (Проход Е.2). Структура 06 §5: ПОДПИСКА WordGrove Club — герой
 * с апселлом (главный платный продукт), Remove Ads, витрина RV-6 rewarded,
 * полка монет (7 SKU). Все «покупки» — СИМУЛЯЦИЯ через PurchaseProvider.
 *
 * Контейнер #shopScreen и стили — в index.html; класс наполняет его и
 * слушает клики (делегирование, как MetaUi).
 */
import { t } from '../i18n';
import { planLabel, skuBadge, skuDesc, skuTitle, subPerks } from '../i18n/labels';
import { IAP_SHELF, MONETIZE } from '../monetize/config';
import type { MonetizeController } from '../monetize/monetize';

export class ShopUi {
  constructor(private readonly monetize: MonetizeController) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('ShopUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  mount(): void {
    this.el('shopScreen').innerHTML =
      '<div class="monInner">' +
      '<div class="monHeader">' +
      '<button id="shopCloseBtn" type="button" class="mon-close">' + t('shop.close') + '</button>' +
      '<div class="monTotals"><span>🪙 <b id="shopCoins">0</b></span></div>' +
      '</div>' +
      '<h3 class="monTitle">' + t('shop.title') + ' <span class="simTag">' + t('shop.simTag') + '</span></h3>' +
      '<p class="monNote">' + t('shop.note') + '</p>' +
      '<div id="subCard" class="subCard"></div>' +
      '<div id="removeAdsCard" class="removeAdsCard"></div>' +
      '<section class="rvShowcase">' +
      '<h4>' + t('shop.rvHeader') + ' <span class="simTag">' + t('shop.rvTag') + '</span></h4>' +
      '<p class="monNote">' + t('shop.rvNote') + '</p>' +
      '<button id="rv6Btn" type="button" class="rvBtn">' + t('shop.rv6Btn') +
      '<span class="rvSub">' + t('shop.rv6Sub') + '</span></button>' +
      '<div id="rv6Status" class="rvStatus"></div>' +
      '</section>' +
      '<section class="shelfSection">' +
      '<h4>' + t('shop.shelfHeader') + '</h4>' +
      '<div id="shopStatus" class="shopStatus"></div>' +
      '<div id="iapList" class="iapList"></div>' +
      '</section>' +
      '</div>';

    this.el('shopCloseBtn').addEventListener('click', () => this.close());
    this.el('rv6Btn').addEventListener('click', () => {
      void this.monetize.offerFreezeStreak().catch(() => undefined);
    });

    // Делегирование: подписка / remove-ads / полка (кнопки перерисовываются).
    this.el('shopScreen').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const monBtn = t.closest('[data-mon]');
      if (monBtn instanceof HTMLButtonElement && !monBtn.disabled) {
        const a = monBtn.getAttribute('data-mon');
        if (a === 'sub-trial') void this.monetize.subscribe('monthly', true).catch(() => undefined);
        else if (a === 'sub-year') void this.monetize.subscribe('yearly', false).catch(() => undefined);
        else if (a === 'sub-cancel') this.monetize.cancelSubscription();
        else if (a === 'remove-ads') void this.monetize.buyRemoveAds().catch(() => undefined);
        return;
      }
      const buy = t.closest('.iapBuy');
      if (buy instanceof HTMLButtonElement && !buy.disabled) {
        const id = buy.getAttribute('data-sku');
        if (id) void this.monetize.purchaseIap(id).catch(() => undefined);
      }
    });
  }

  open(): void {
    this.monetize.noteShopOpened(); // актуализация дня + RV-6 виден (воронка)
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

  /* ------------------------- Разметка (порт 1:1) ------------------------- */

  private render(): void {
    const s = this.monetize.getState();

    // Шапка: баланс монет.
    this.el('shopCoins').textContent = String(this.monetize.getCoins());

    // --- Подписка WordGrove Club (герой, апселл) ---
    const m = MONETIZE.SUB.monthly;
    const y = MONETIZE.SUB.yearly;
    let perks = '';
    for (const p of subPerks()) perks += '<li>' + p + '</li>';
    let subHtml =
      '<div class="sub-badge">' + t('shop.subBadge') + '</div>' +
      '<h3 class="sub-title">' + t('shop.subTitle') + '</h3>' +
      '<ul class="sub-perks">' + perks + '</ul>';
    if (this.monetize.subscribed()) {
      const plan = s.subscription.plan === 'yearly' ? 'yearly' : 'monthly';
      subHtml +=
        '<div class="sub-active">' +
        t('shop.subActive', {
          trial: s.subscription.trial ? t('shop.subTrialSuffix') : '',
          plan: planLabel(plan)
        }) +
        '</div>' +
        '<button type="button" class="sub-cancel" data-mon="sub-cancel">' + t('shop.subCancel') + '</button>';
    } else {
      subHtml +=
        '<div class="sub-prices">' +
        '<button type="button" class="sub-buy trial" data-mon="sub-trial">' + t('shop.subTrialBtn') +
        '<span class="sub-sub">' +
        t('shop.subTrialSub', { label: planLabel('monthly'), price: m.price.toFixed(2) }) +
        '</span></button>' +
        '<button type="button" class="sub-buy year" data-mon="sub-year">' +
        t('shop.subYearBtn', { price: y.price.toFixed(2) }) +
        '<span class="sub-sub">' + t('shop.subYearSub', { label: planLabel('yearly') }) + '</span></button>' +
        '</div>';
    }
    this.el('subCard').innerHTML = subHtml;

    // --- Remove Ads ---
    this.el('removeAdsCard').innerHTML =
      '<div class="ra-top"><span class="ra-title">' + t('shop.raTitle') + '</span>' +
      '<span class="ra-sub">' + t('shop.raSub') + '</span></div>' +
      (s.removeAds
        ? '<button type="button" class="ra-buy done" disabled>' + t('shop.owned') + '</button>'
        : '<button type="button" class="ra-buy" data-mon="remove-ads">$' + MONETIZE.REMOVE_ADS.price.toFixed(2) + '</button>');

    // --- RV-6 rewarded в магазине ---
    this.el('rv6Status').innerHTML =
      t('shop.rv6Status', { n: s.freezeTokens, used: s.day.rv6, cap: MONETIZE.RW.RV6_DAILY_CAP });
    (this.el('rv6Btn') as HTMLButtonElement).disabled = !this.monetize.rv6Available();

    // --- Полка монет ---
    let h = '';
    for (const sku of IAP_SHELF) {
      const owned = this.monetize.isSkuOwned(sku);
      const cls = 'iapCard' + (sku.highlight === true ? ' hot' : '') + (owned ? ' owned' : '');
      h += '<div class="' + cls + '">';
      h += '<div class="iapTop"><span class="iapTitle">' + skuTitle(sku) + '</span>';
      if (sku.badge !== undefined) h += '<span class="iapBadge">' + skuBadge(sku.badge) + '</span>';
      h += '</div>';
      h += '<div class="iapDesc">' + skuDesc(sku) + '</div>';
      if (owned) h += '<button type="button" class="iapBuy done" disabled>' + t('shop.owned') + '</button>';
      else h += '<button type="button" class="iapBuy" data-sku="' + sku.id + '">$' + sku.price.toFixed(2) + '</button>';
      h += '</div>';
    }
    this.el('iapList').innerHTML = h;

    const bits: string[] = [];
    bits.push(this.monetize.adsRemoved() ? t('shop.adsOff') : t('shop.adsOn'));
    bits.push(this.monetize.subscribed() ? t('shop.clubActive') : t('shop.noSub'));
    if (s.removeAds) bits.push('Remove Ads ✓');
    this.el('shopStatus').innerHTML = t('shop.simTag') + ' · ' + bits.join(' · ');
  }
}
