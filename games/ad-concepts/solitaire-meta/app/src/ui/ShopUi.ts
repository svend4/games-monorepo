/**
 * Магазин 💎 (Проход Е.2) — DOM-оверлей, порт полки-экрана из прототипа
 * monetize.js (ensureStoreDom/renderStore) 1:1: rewarded-офферы, подписка и
 * remove-ads, копилка, монеты и наборы. Все «покупки» и «показы» — СИМУЛЯЦИЯ
 * (баннер прямо в разметке). Контейнер #store-screen создаётся лениво;
 * стили — src/style.css (порт прототипа). Клики — делегированием, как MetaUi.
 */
import { MON, IAP_SHELF, findIap, type IapSku, type PlacementId } from '../monetize/config';
import type { MonetizeController } from '../monetize/monetize';
import { t, tDyn } from '../i18n';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Переводы полки IAP (лейбл/примечание) с фолбэком на строку конфига. */
function iapLabel(item: IapSku): string {
  return tDyn('iap.' + item.sku + '.label', item.label);
}

function iapNote(item: IapSku): string {
  return tDyn('iap.' + item.sku + '.note', item.note);
}

export class ShopUi {
  /** Возврат в игру (TableUi обновляет HUD). */
  onClose: (() => void) | null = null;

  private screenEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(private readonly monetize: MonetizeController) {}

  /* ============================ DOM ============================ */

  mount(): void {
    if (this.screenEl !== null || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'store-screen';
    el.className = 'hidden';
    el.innerHTML =
      '<header id="store-top">' +
      '<button id="store-back" type="button">' + t('store.back') + '</button>' +
      '<div class="store-title">' + t('store.title') + '</div>' +
      '<div class="store-geo" id="store-geo"></div>' +
      '</header>' +
      '<main id="store-body"></main>';
    document.body.appendChild(el);
    this.screenEl = el;
    this.bodyEl = document.getElementById('store-body');

    const back = document.getElementById('store-back');
    if (back !== null) back.addEventListener('click', () => this.close());
    this.bodyEl?.addEventListener('click', (ev) => this.onBodyClick(ev));
  }

  isOpen(): boolean {
    return this.screenEl !== null && !this.screenEl.classList.contains('hidden');
  }

  open(): void {
    this.mount();
    if (this.screenEl === null) return;
    this.monetize.onShopOpened(); // актуализация дня + дневной грант подписки
    this.render();
    this.screenEl.classList.remove('hidden');
    document.body.classList.add('meta-open');
  }

  close(): void {
    if (this.screenEl === null) return;
    this.screenEl.classList.add('hidden');
    document.body.classList.remove('meta-open');
    this.onClose?.();
  }

  /** Перерисовать, только если экран открыт (дёргается из onChanged). */
  refresh(): void {
    if (this.isOpen()) this.render();
  }

  /* ============================ ДЕЙСТВИЯ ============================ */

  private onBodyClick(ev: Event): void {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (b === null || b.disabled) return;
    const act = b.getAttribute('data-act');
    // Rewarded-действия асинхронны: перерисовка приедет через onChanged.
    // .catch: показ/покупка упали (прод-SDK) → без награды, UI не «зависает».
    if (act === 'buy') {
      void this.monetize.buyIAP(b.getAttribute('data-sku') ?? '').catch(() => false);
    } else if (act === 'rw-wallet') void this.monetize.rwWallet().catch(() => false);
    else if (act === 'rw-booster') void this.monetize.rwBooster().catch(() => false);
    else if (act === 'rw-wheel') void this.monetize.rwWheel().catch(() => false);
    else if (act === 'rw-event') void this.monetize.rwEventTokens().catch(() => false);
    else if (act === 'sub-cancel') this.monetize.cancelSub();
    else if (act === 'piggy-break') this.monetize.piggyBreak();
    this.render();
  }

  /* ============================ РЕНДЕР (порт 1:1) ============================ */

  private rwOfferCard(pid: PlacementId, action: string, cta: string): string {
    const cap = MON.RW_DAILY_CAP[pid];
    const left = cap !== undefined ? Math.max(0, cap - this.monetize.rwUsedToday(pid)) : null;
    const disabled = !this.monetize.rewardedAllowed(pid);
    const capNote =
      cap !== undefined
        ? t('store.capLeft', { left: left ?? 0, cap })
        : t('store.capNone');
    return (
      '<div class="offer-item">' +
      '<div class="offer-ico">📺</div>' +
      '<div class="offer-info"><div class="offer-name">' +
      esc(tDyn('placement.' + pid + '.name', this.monetize.placementName(pid))) +
      ' <span class="rw-tag">' + pid + '</span></div>' +
      '<div class="offer-hint">' +
      esc(tDyn('placement.' + pid + '.desc', this.monetize.placementDesc(pid))) +
      ' · ' + capNote + '</div></div>' +
      '<button class="offer-btn" data-act="' + action + '" ' + (disabled ? 'disabled' : '') + '>' +
      (disabled ? t('store.limit') : esc(cta)) + '</button></div>'
    );
  }

  private render(): void {
    if (this.bodyEl === null) return;
    const st = this.monetize.getState();
    const geoEl = document.getElementById('store-geo');
    if (geoEl !== null) geoEl.textContent = '🌍 ' + this.monetize.geoLabel();

    let html = '';
    html += '<div class="sim-banner">' + t('store.simBanner') + '</div>';

    /* --- Бесплатно за рекламу (rewarded-офферы RW3/RW4/RW6/RW5) --- */
    html += '<h3 class="store-h">' + t('store.h.rewarded') + '</h3>';
    html += '<p class="store-sub">' + t('store.sub.rewarded') + '</p>';
    html += this.rwOfferCard('RW6', 'rw-wallet', t('store.cta.watch'));
    html += this.rwOfferCard('RW3', 'rw-booster', t('store.cta.watch'));
    html += this.rwOfferCard('RW4', 'rw-wheel', t('store.cta.spin'));
    if (st.eventWeekend) html += this.rwOfferCard('RW5', 'rw-event', t('store.cta.watch'));

    /* --- Подписка и remove-ads (06 §6.5) --- */
    html += '<h3 class="store-h">' + t('store.h.noads') + '</h3>';
    const ra = findIap('remove_ads') as IapSku;
    html +=
      '<div class="iap-item hi">' +
      '<div class="iap-ico">🚫</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(iapLabel(ra)) + '</div>' +
      '<div class="iap-note">' + esc(iapNote(ra)) + '</div></div>' +
      (st.removeAds
        ? '<button class="iap-btn owned" disabled>' + t('store.owned') + '</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="remove_ads">$' + ra.price.toFixed(2) + '</button>') +
      '</div>';
    const cm = findIap('club_month') as IapSku;
    html +=
      '<div class="iap-item hi">' +
      '<div class="iap-ico">🌿</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(iapLabel(cm)) +
      (st.sub.active
        ? ' <span class="rw-tag">' + t('store.sub.month', { n: st.sub.monthNo }) + '</span>'
        : '') + '</div>' +
      '<div class="iap-note">' + esc(iapNote(cm)) + '</div></div>' +
      (st.sub.active
        ? '<button class="iap-btn ghost" data-act="sub-cancel">' + t('store.cancel') + '</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="club_month">$' + cm.price.toFixed(2) +
          t('store.perMonth') + '</button>') +
      '</div>';

    /* --- Копилка (06 §6.4) --- */
    const pg = findIap('piggy_greenhouse') as IapSku;
    html += '<h3 class="store-h">' + t('store.h.piggy') + '</h3>';
    html +=
      '<div class="iap-item">' +
      '<div class="iap-ico">🪟</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(iapLabel(pg)) +
      (st.piggy.owned ? ' <span class="rw-tag">' + Math.round(st.piggy.balance) + '/' + MON.PIGGY_CAP + '</span>' : '') +
      '</div>' +
      '<div class="iap-note">' + esc(iapNote(pg)) + '</div></div>';
    if (!st.piggy.owned) {
      html += '<button class="iap-btn" data-act="buy" data-sku="piggy_greenhouse">$' + pg.price.toFixed(2) + '</button>';
    } else if (st.piggy.balance >= MON.PIGGY_UNLOCK) {
      html += '<button class="iap-btn" data-act="piggy-break">' + t('store.piggy.break') + '</button>';
    } else {
      html += '<button class="iap-btn owned" disabled>' + t('store.piggy.from', { n: MON.PIGGY_UNLOCK }) + '</button>';
    }
    html += '</div>';

    /* --- Монеты и наборы (06 §6.4) --- */
    html += '<h3 class="store-h">' + t('store.h.coins') + '</h3>';
    html += '<p class="store-sub">' + t('store.sub.coins') + '</p>';
    for (const item of IAP_SHELF) {
      if (item.kind === 'remove_ads' || item.kind === 'sub' || item.kind === 'piggy') continue;
      const bought = st.life.purchases[item.sku] ?? 0;
      const lock = item.once === true && bought > 0;
      const note = iapNote(item);
      html +=
        '<div class="iap-item">' +
        '<div class="iap-ico">' + (item.price >= 49 ? '👑' : item.price >= 19 ? '💰' : item.price >= 9 ? '🧰' : '🪙') + '</div>' +
        '<div class="iap-info"><div class="iap-name">' + esc(iapLabel(item)) +
        (item.once === true ? ' <span class="rw-tag">' + t('store.once') + '</span>' : '') + '</div>' +
        '<div class="iap-note">' + this.iapContents(item) + (note !== '' ? ' · ' + esc(note) : '') + '</div></div>' +
        (lock
          ? '<button class="iap-btn owned" disabled>' + t('store.owned') + '</button>'
          : '<button class="iap-btn" data-act="buy" data-sku="' + item.sku + '">$' + item.price.toFixed(2) + '</button>') +
        '</div>';
    }

    html += '<p class="store-foot">' + t('store.foot') + '</p>';
    this.bodyEl.innerHTML = html;
  }

  private iapContents(item: IapSku): string {
    const parts: string[] = [];
    if (item.coins !== undefined) parts.push('💰 ' + item.coins);
    if (item.joker !== undefined) parts.push('🃏 ' + item.joker);
    if (item.basket !== undefined) parts.push('🧺 ' + item.basket);
    if (item.card !== undefined) parts.push('🃟 ' + t('store.contents.cards', { n: item.card }));
    return parts.length > 0 ? parts.join(' + ') : '—';
  }
}
