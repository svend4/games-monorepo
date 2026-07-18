/**
 * Магазин 💎 (Проход Е.2) — DOM-оверлей, порт полки-экрана из прототипа
 * monetize.js (ensureStoreDom/renderStore) 1:1: rewarded-офферы, подписка и
 * remove-ads, копилка, монеты и наборы. Все «покупки» и «показы» — СИМУЛЯЦИЯ
 * (баннер прямо в разметке). Контейнер #store-screen создаётся лениво;
 * стили — src/style.css (порт прототипа). Клики — делегированием, как MetaUi.
 */
import { MON, IAP_SHELF, findIap, type IapSku, type PlacementId } from '../monetize/config';
import type { MonetizeController } from '../monetize/monetize';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
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
      '<button id="store-back" type="button">← Играть</button>' +
      '<div class="store-title">💎 Магазин</div>' +
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
    const capNote = cap !== undefined ? 'осталось сегодня: ' + left + '/' + cap : 'без дневного лимита';
    return (
      '<div class="offer-item">' +
      '<div class="offer-ico">📺</div>' +
      '<div class="offer-info"><div class="offer-name">' + esc(this.monetize.placementName(pid)) +
      ' <span class="rw-tag">' + pid + '</span></div>' +
      '<div class="offer-hint">' + esc(this.monetize.placementDesc(pid)) + ' · ' + capNote + '</div></div>' +
      '<button class="offer-btn" data-act="' + action + '" ' + (disabled ? 'disabled' : '') + '>' +
      (disabled ? 'Лимит' : esc(cta)) + '</button></div>'
    );
  }

  private render(): void {
    if (this.bodyEl === null) return;
    const st = this.monetize.getState();
    const geoEl = document.getElementById('store-geo');
    if (geoEl !== null) geoEl.textContent = '🌍 ' + this.monetize.geoLabel();

    let html = '';
    html +=
      '<div class="sim-banner">⚠ СИМУЛЯЦИЯ: рекламные сети и биллинг НЕ подключены. ' +
      'Покупки не списывают денег, «показ рекламы» — экранная заглушка. В проде — AppLovin MAX / AdMob и сторы.</div>';

    /* --- Бесплатно за рекламу (rewarded-офферы RW3/RW4/RW6/RW5) --- */
    html += '<h3 class="store-h">🎁 Бесплатно за рекламу (rewarded)</h3>';
    html +=
      '<p class="store-sub">Rewarded — доминанта модели (цель 65–70% рекламной выручки, 06 §6.1). ' +
      'Это бонусы по желанию: подписка и remove-ads их НЕ убирают.</p>';
    html += this.rwOfferCard('RW6', 'rw-wallet', 'Смотреть');
    html += this.rwOfferCard('RW3', 'rw-booster', 'Смотреть');
    html += this.rwOfferCard('RW4', 'rw-wheel', 'Крутить');
    if (st.eventWeekend) html += this.rwOfferCard('RW5', 'rw-event', 'Смотреть');

    /* --- Подписка и remove-ads (06 §6.5) --- */
    html += '<h3 class="store-h">🚫 Без рекламы и подписка</h3>';
    const ra = findIap('remove_ads') as IapSku;
    html +=
      '<div class="iap-item hi">' +
      '<div class="iap-ico">🚫</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(ra.label) + '</div>' +
      '<div class="iap-note">' + esc(ra.note) + '</div></div>' +
      (st.removeAds
        ? '<button class="iap-btn owned" disabled>Куплено ✓</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="remove_ads">$' + ra.price.toFixed(2) + '</button>') +
      '</div>';
    const cm = findIap('club_month') as IapSku;
    html +=
      '<div class="iap-item hi">' +
      '<div class="iap-ico">🌿</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(cm.label) +
      (st.sub.active ? ' <span class="rw-tag">мес ' + st.sub.monthNo + '</span>' : '') + '</div>' +
      '<div class="iap-note">' + esc(cm.note) + '</div></div>' +
      (st.sub.active
        ? '<button class="iap-btn ghost" data-act="sub-cancel">Отменить</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="club_month">$' + cm.price.toFixed(2) + '/мес</button>') +
      '</div>';

    /* --- Копилка (06 §6.4) --- */
    const pg = findIap('piggy_greenhouse') as IapSku;
    html += '<h3 class="store-h">🐷 Копилка</h3>';
    html +=
      '<div class="iap-item">' +
      '<div class="iap-ico">🪟</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(pg.label) +
      (st.piggy.owned ? ' <span class="rw-tag">' + Math.round(st.piggy.balance) + '/' + MON.PIGGY_CAP + '</span>' : '') +
      '</div>' +
      '<div class="iap-note">' + esc(pg.note) + '</div></div>';
    if (!st.piggy.owned) {
      html += '<button class="iap-btn" data-act="buy" data-sku="piggy_greenhouse">$' + pg.price.toFixed(2) + '</button>';
    } else if (st.piggy.balance >= MON.PIGGY_UNLOCK) {
      html += '<button class="iap-btn" data-act="piggy-break">Вскрыть 💰</button>';
    } else {
      html += '<button class="iap-btn owned" disabled>от ' + MON.PIGGY_UNLOCK + '</button>';
    }
    html += '</div>';

    /* --- Монеты и наборы (06 §6.4) --- */
    html += '<h3 class="store-h">🪙 Монеты и наборы</h3>';
    html +=
      '<p class="store-sub">Персонализация номиналов — по E(n) игрока (06 §6.4). Цены США; в проде локализуются по матрице сторов.</p>';
    for (const item of IAP_SHELF) {
      if (item.kind === 'remove_ads' || item.kind === 'sub' || item.kind === 'piggy') continue;
      const bought = st.life.purchases[item.sku] ?? 0;
      const lock = item.once === true && bought > 0;
      html +=
        '<div class="iap-item">' +
        '<div class="iap-ico">' + (item.price >= 49 ? '👑' : item.price >= 19 ? '💰' : item.price >= 9 ? '🧰' : '🪙') + '</div>' +
        '<div class="iap-info"><div class="iap-name">' + esc(item.label) +
        (item.once === true ? ' <span class="rw-tag">разово</span>' : '') + '</div>' +
        '<div class="iap-note">' + this.iapContents(item) + (item.note !== '' ? ' · ' + esc(item.note) : '') + '</div></div>' +
        (lock
          ? '<button class="iap-btn owned" disabled>Куплено ✓</button>'
          : '<button class="iap-btn" data-act="buy" data-sku="' + item.sku + '">$' + item.price.toFixed(2) + '</button>') +
        '</div>';
    }

    html += '<p class="store-foot">СИМУЛЯЦИЯ · Проход Е.2 · выручка каждого показа/покупки уходит в дашборд «📊 KPI».</p>';
    this.bodyEl.innerHTML = html;
  }

  private iapContents(item: IapSku): string {
    const parts: string[] = [];
    if (item.coins !== undefined) parts.push('💰 ' + item.coins);
    if (item.joker !== undefined) parts.push('🃏 ' + item.joker);
    if (item.basket !== undefined) parts.push('🧺 ' + item.basket);
    if (item.card !== undefined) parts.push('🃟 ' + item.card + ' карт.');
    return parts.length > 0 ? parts.join(' + ') : '—';
  }
}
