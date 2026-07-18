/**
 * Аналитический дашборд (📊) — DOM-оверлей, порт analytics.js (Проход В)
 * в архитектуре Е.1. Живые KPI монетизации ТЕКУЩЕЙ СЕССИИ против целей
 * главы 09 §4; данные — из MonetizeController, дашборд ничего не симулирует
 * сам, только читает и считает производные (доли, ARPDAU-оценка).
 *
 * Модель прочтения: «сессия = 1 симулированный DAU за день» — счётчики
 * показов сессии = impressions/DAU, ad revenue сессии ≈ ad ARPDAU. IAP-часть
 * так не читается (один плательщик ≠ среднее по всем DAU) — показана как
 * «выручка этого игрока» с явной пометкой.
 */
import { GEO_LABELS, GEO_ORDER, type GeoTier } from '../ads/ecpm';
import type { MonetizeController } from '../monetize/monetize';

function money(v: number): string {
  return '$' + (v || 0).toFixed(v >= 1 ? 2 : 4);
}

export class DashboardUi {
  constructor(private readonly monetize: MonetizeController) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('DashboardUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  mount(): void {
    this.el('dashboardScreen').innerHTML =
      '<div class="metaInner">' +
      '<div class="metaHeader">' +
      '<button id="dashCloseBtn" type="button" class="metaClose">← В игру</button>' +
      '<button id="dashResetBtn" type="button" class="ghostBtn">Сбросить счётчики</button>' +
      '</div>' +
      '<section class="metaSection"><h3>📊 Дашборд монетизации (СИМУЛЯЦИЯ)</h3>' +
      '<p class="metaNote">Сессия = 1 симулированный DAU · цели — 09 §4.</p>' +
      '<div id="dashGeo"></div>' +
      '<div id="dashBody"></div>' +
      '</section></div>';

    this.el('dashCloseBtn').addEventListener('click', () => this.close());
    this.el('dashResetBtn').addEventListener('click', () => {
      this.monetize.resetSession();
      this.render();
    });
    // Гео-переключатель (делегирование — кнопки перерисовываются).
    this.el('dashGeo').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.geoBtn');
      if (btn) {
        const geo = btn.getAttribute('data-geo') as GeoTier | null;
        if (geo) {
          this.monetize.setGeo(geo);
          this.render();
        }
      }
    });
  }

  open(): void {
    this.el('dashboardScreen').classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.el('dashboardScreen').classList.add('hidden');
  }

  /** Обновить, только если экран открыт («живой» дашборд, из onChanged). */
  refresh(): void {
    const sc = document.getElementById('dashboardScreen');
    if (sc && !sc.classList.contains('hidden')) this.render();
  }

  /* ------------------------- Разметка (порт 1:1) ------------------------- */

  /** Статус-чип относительно цели: hit — на цели/выше, near — 60–100%, low — ниже. */
  private chip(value: number, target: number, higherBetter = true): string {
    const ratio = target > 0 ? value / target : 0;
    let cls: string;
    let txt: string;
    if (!higherBetter) {
      // «меньше — лучше» (недопоказы): просто нейтрально
      cls = value > 0 ? 'near' : 'hit';
      txt = value > 0 ? '⚠' : 'ok';
    } else if (ratio >= 1) {
      cls = 'hit';
      txt = '✓ на цели';
    } else if (ratio >= 0.6) {
      cls = 'near';
      txt = Math.round(ratio * 100) + '%';
    } else {
      cls = 'low';
      txt = Math.round(ratio * 100) + '%';
    }
    return '<span class="kchip ' + cls + '">' + txt + '</span>';
  }

  private row(label: string, value: string | number, targetTxt: string, chipHtml: string, note?: string): string {
    return (
      '<div class="kRow">' +
      '<div class="kLabel">' + label + (note !== undefined ? '<span class="kNote">' + note + '</span>' : '') + '</div>' +
      '<div class="kVal">' + value + '</div>' +
      '<div class="kTgt">' + targetTxt + '</div>' +
      '<div class="kStat">' + chipHtml + '</div>' +
      '</div>'
    );
  }

  private geoSwitch(): string {
    const cur = this.monetize.getGeo();
    let h = '<div class="geoSwitch"><span class="geoCap">Гео / eCPM:</span>';
    for (const g of GEO_ORDER) {
      h +=
        '<button type="button" class="geoBtn' + (g === cur ? ' active' : '') +
        '" data-geo="' + g + '">' + GEO_LABELS[g] + '</button>';
    }
    h += '</div>';
    return h;
  }

  private render(): void {
    const mon = this.monetize;
    const s = mon.getSession();
    const store = mon.getState();
    const T = mon.getTargets();

    const totalRev = s.adRev + s.iapRev;
    const adSharePlayer = totalRev > 0 ? (s.adRev / totalRev) * 100 : 0;
    const iapSharePlayer = totalRev > 0 ? (s.iapRev / totalRev) * 100 : 0;
    const mins = Math.max(1, Math.round((mon.nowMs() - s.startedAt) / 60000));
    const accRate = s.offers.shown > 0 ? Math.round((s.offers.accepted / s.offers.shown) * 100) : 0;

    let h = '';

    // Гео-переключатель + текущие eCPM.
    this.el('dashGeo').innerHTML = this.geoSwitch();

    // --- Блок 1: показы по форматам (impressions/DAU) ---
    h += '<div class="kSection"><h4>Показы по форматам · impressions/DAU (09 §4)</h4>';
    h += '<div class="kHead"><span>Формат</span><span>Сессия</span><span>Цель</span><span></span></div>';
    h += this.row('Interstitial', s.imp.int, T.intPerDau.toFixed(1), this.chip(s.imp.int, T.intPerDau));
    h += this.row('Rewarded', s.imp.rw, T.rwPerDau.toFixed(1), this.chip(s.imp.rw, T.rwPerDau));
    h += this.row('Banner', s.imp.banner, String(T.bannerPerDau), this.chip(s.imp.banner, T.bannerPerDau));
    h += '<div class="kMini">Недопоказы interstitial (капы 06 §3): <b>' + s.intCapped + '</b>' +
      (s.lastCapRule !== '' ? ' · последний: ' + s.lastCapRule : '') + '</div>';
    h += '</div>';

    // --- Блок 2: выручка и ARPDAU ---
    h += '<div class="kSection"><h4>Выручка сессии · ARPDAU-оценка (09 §4)</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += this.row('Ad ARPDAU', money(s.adRev), money(T.adArpdau), this.chip(s.adRev, T.adArpdau),
      'реклама/DAU — сравнимо');
    h += this.row('IAP (этот игрок)', money(s.iapRev), money(T.iapArpdau), '',
      'плательщик ≠ среднее DAU');
    h += this.row('Blended (сессия)', money(totalRev), money(T.blendedArpdau), this.chip(s.adRev, T.adArpdau),
      'ad-часть на цели → ок');
    h += '<div class="kMini">Разбивка ad-выручки: INT ' + money(s.revByFormat.int) +
      ' · RW ' + money(s.revByFormat.rw) + ' · BAN ' + money(s.revByFormat.banner) + '</div>';
    h += '</div>';

    // --- Блок 3: структура выручки (доля ad/IAP) ---
    h += '<div class="kSection"><h4>Структура выручки · доля Ad/IAP (цель 70/30 → 60/40)</h4>';
    h += '<div class="shareBar">' +
      '<div class="shareAd" style="width:' + adSharePlayer.toFixed(0) + '%">Ad ' + adSharePlayer.toFixed(0) + '%</div>' +
      '<div class="shareIap" style="width:' + iapSharePlayer.toFixed(0) + '%">IAP ' + iapSharePlayer.toFixed(0) + '%</div>' +
      '</div>';
    h += '<div class="kMini">Доля этого игрока (одна IAP-покупка искажает популяционные 70/30). ' +
      'Покупок: <b>' + s.iapCount + '</b> · lifetime IAP: ' + money(store.lifetime.iapRev) + '</div>';
    h += '</div>';

    // --- Блок 4: воронка rewarded + текущие eCPM ---
    h += '<div class="kSection"><h4>Rewarded-воронка + текущие eCPM</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += this.row('Офферы показаны', s.offers.shown, '', '');
    h += this.row('Приняты', s.offers.accepted, '', '');
    h += this.row('Accept rate', accRate + '%', '30–35%', this.chip(accRate, 30));
    h += '<div class="kMini">eCPM (' + mon.geoLabel() + '): ' +
      'RW $' + mon.ecpmFor('rw').toFixed(2) + ' (цель $' + T.ecpm.rw + ') · ' +
      'INT $' + mon.ecpmFor('int').toFixed(2) + ' (цель $' + T.ecpm.int + ') · ' +
      'BAN $' + mon.ecpmFor('banner').toFixed(2) + ' (цель $' + T.ecpm.banner + ')</div>';
    h += '</div>';

    // --- Блок 5: состояние монетизации ---
    h += '<div class="kSection"><h4>Состояние</h4>';
    h += '<div class="kMini">' +
      (mon.adsRemoved()
        ? '🚫 INT+BAN отключены (' + (store.subscription.active ? 'подписка' : 'Remove Ads') + ')'
        : '📺 Реклама включена') +
      ' · время сессии ~' + mins + ' мин' +
      ' · lifetime ad-выручка ' + money(store.lifetime.adRev) +
      '</div>';
    h += '<div class="kMini kDis">СИМУЛЯЦИЯ: цифры выручки — модельные (eCPM×jitter/1000 и прайс SKU), ' +
      'не реальные деньги. Impression-level revenue в проде — из MAX API (06 §8).</div>';
    h += '</div>';

    this.el('dashBody').innerHTML = h;
  }
}
