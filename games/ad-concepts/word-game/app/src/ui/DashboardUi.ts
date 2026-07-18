/**
 * ВНУТРЕННИЙ ИНСТРУМЕНТ, НЕ ДЛЯ ИГРОКОВ: сознательно НЕ локализован
 * (Проход Ж.1 — i18n покрывает только игровой UI). Русские строки ниже —
 * осознанный скоуп, не переводить.
 *
 * Аналитический дашборд (📊) — DOM-оверлей, порт analytics.js (Проход В)
 * в архитектуре Е. Живые KPI монетизации ТЕКУЩЕЙ СЕССИИ против целей главы 09
 * (§3) и структуры выручки главы 06 (сплит 65/22/13). Данные — из
 * MonetizeController (реальные события сессии); блок A/B-групп — из
 * Experiments (Проход Е.3). Дашборд сам ничего НЕ симулирует — только читает
 * и считает производные метрики (доли, ARPDAU-оценка, impressions/DAU).
 *
 * Модель прочтения: «сессия = 1 симулированный DAU за день»: счётчики показов
 * сессии = impressions/DAU, ad revenue сессии ≈ ad ARPDAU. Подписка/IAP так
 * не читаются (один плательщик ≠ среднее по всем DAU) — показаны как «выручка
 * этого игрока» с явной пометкой; целевой сплит 65/22/13 — популяционный.
 */
import { GEO_LABELS, GEO_ORDER, type GeoTier } from '../ads/ecpm';
import type { Experiments } from '../experiments/experiments';
import type { MonetizeController } from '../monetize/monetize';

function money(v: number): string {
  const n = v || 0;
  return '$' + n.toFixed(n >= 1 ? 2 : 4);
}

export class DashboardUi {
  constructor(
    private readonly monetize: MonetizeController,
    private readonly experiments: Experiments
  ) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('DashboardUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  mount(): void {
    this.el('dashboardScreen').innerHTML =
      '<div class="monInner">' +
      '<div class="monHeader">' +
      '<button id="dashCloseBtn" type="button" class="mon-close">← В игру</button>' +
      '<div class="dashGeo" id="dashGeo"></div>' +
      '</div>' +
      '<h3 class="monTitle">📊 Дашборд монетизации <span class="simTag">сессия = 1 DAU</span></h3>' +
      '<p class="monNote">Живые KPI сессии против целей главы 09 и структуры выручки 06 (65/22/13). ' +
      'Считаются по реальным событиям сессии (показы, покупки, подписка). Гео-переключатель ' +
      'меняет eCPM будущих показов (06 §8.1).</p>' +
      '<div id="dashBody"></div>' +
      '<button id="dashResetBtn" type="button" class="mon-ghost">↺ Сбросить счётчики сессии</button>' +
      '</div>';

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

  /** Статус-чип относительно цели (больше — лучше). */
  private chip(value: number, target: number): string {
    const ratio = target > 0 ? value / target : 0;
    let cls: string;
    let txt: string;
    if (ratio >= 1) {
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
      h += '<button type="button" class="geoBtn' + (g === cur ? ' active' : '') + '" data-geo="' + g + '">' +
        GEO_LABELS[g] + '</button>';
    }
    h += '</div>';
    return h;
  }

  private pct(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
  }

  private render(): void {
    const mon = this.monetize;
    const s = mon.getSession();
    const store = mon.getState();
    const T = mon.getTargets();

    const totalRev = s.adRev + s.subRev + s.iapRev;
    const mins = Math.max(1, Math.round((mon.nowMs() - s.startedAt) / 60000));
    const accRate = s.offers.shown > 0 ? Math.round((s.offers.accepted / s.offers.shown) * 100) : 0;

    this.el('dashGeo').innerHTML = this.geoSwitch();

    let h = '';

    // --- Блок 0: назначенные A/B-варианты (Проход Е.3, 09 §1.2 ab_groups[]) ---
    h += '<div class="kSection"><h4>A/B-группы этой сессии (09 §1.2)</h4>';
    h += '<div class="kMini">Детерминированное назначение по хешу session-id (fnv1a32). ' +
      'В проде эти <code>ab_groups[]</code> уходят в каждое событие трекинга.</div>';
    h += '<div class="abStrip">';
    for (const a of this.experiments.getAssignments()) {
      h += '<span class="abChip"><b>' + a.exp + '</b> = ' + a.variant + '<span class="abChipLbl">' + a.label + '</span></span>';
    }
    h += '</div>';
    h += '<div class="kMini">Открыть 🚀 <b>Soft-launch cockpit</b> — симулятор экономики, панель тюнинга и ' +
      'гейты go/iterate/kill.</div>';
    h += '</div>';

    // --- Блок 1: показы по форматам (impressions/DAU) ---
    h += '<div class="kSection"><h4>Показы по форматам · impressions/DAU (09 §3)</h4>';
    h += '<div class="kHead"><span>Формат</span><span>Сессия</span><span>Цель</span><span></span></div>';
    h += this.row('Interstitial (I-1)', s.imp.int, T.intPerDau.toFixed(1), this.chip(s.imp.int, T.intPerDau));
    h += this.row('Rewarded (RV-1/2/5/6)', s.imp.rw, T.rwPerDau.toFixed(1), this.chip(s.imp.rw, T.rwPerDau));
    h += this.row('Banner (B-1)', s.imp.banner, String(T.bannerPerDau), this.chip(s.imp.banner, T.bannerPerDau));
    h += '<div class="kMini">Недопоказы interstitial (капы 06 §4): <b>' + s.intCapped + '</b>' +
      (s.lastCapRule !== '' ? ' · последний: ' + s.lastCapRule : '') + '</div>';
    h += '</div>';

    // --- Блок 2: выручка и ARPDAU ---
    h += '<div class="kSection"><h4>Выручка сессии · ARPDAU-оценка (06 §8.3)</h4>';
    h += '<div class="kHead"><span>Компонент</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += this.row('Реклама (ad ARPDAU)', money(s.adRev), money(T.adArpdau), this.chip(s.adRev, T.adArpdau),
      'реклама/DAU — сравнимо');
    h += this.row('Подписка (net/день)', money(s.subRev), money(T.subArpdau), '',
      'амортизация подписчика ≠ среднее DAU');
    h += this.row('IAP (этот игрок)', money(s.iapRev), money(T.iapArpdau), '',
      'плательщик ≠ среднее DAU');
    h += this.row('Blended (сессия)', money(totalRev), money(T.blendedArpdau), this.chip(s.adRev, T.adArpdau),
      'ad-часть на цели → ок');
    h += '<div class="kMini">Разбивка ad-выручки: INT ' + money(s.revByFormat.int) +
      ' · RW ' + money(s.revByFormat.rw) + ' · BAN ' + money(s.revByFormat.banner) + '</div>';
    h += '</div>';

    // --- Блок 3: структура выручки (доля ad/sub/iap) vs цель 65/22/13 ---
    const adP = this.pct(s.adRev, totalRev);
    const subP = this.pct(s.subRev, totalRev);
    const iapP = this.pct(s.iapRev, totalRev);
    h += '<div class="kSection"><h4>Структура выручки · Реклама/Подписка/IAP (цель 65/22/13, 06 §8.3)</h4>';
    h += '<div class="shareCap">Цель (книга):</div>';
    h += '<div class="shareBar">' +
      '<div class="shareAd" style="width:' + T.revSplit.ad + '%">Реклама ' + T.revSplit.ad + '%</div>' +
      '<div class="shareSub" style="width:' + T.revSplit.sub + '%">Подписка ' + T.revSplit.sub + '%</div>' +
      '<div class="shareIap" style="width:' + T.revSplit.iap + '%">IAP ' + T.revSplit.iap + '%</div>' +
      '</div>';
    h += '<div class="shareCap">Этот игрок (сессия):</div>';
    if (totalRev > 0) {
      h += '<div class="shareBar">' +
        '<div class="shareAd" style="width:' + adP.toFixed(1) + '%">' + (adP >= 8 ? 'Реклама ' + adP.toFixed(0) + '%' : '') + '</div>' +
        '<div class="shareSub" style="width:' + subP.toFixed(1) + '%">' + (subP >= 8 ? 'Подписка ' + subP.toFixed(0) + '%' : '') + '</div>' +
        '<div class="shareIap" style="width:' + iapP.toFixed(1) + '%">' + (iapP >= 8 ? 'IAP ' + iapP.toFixed(0) + '%' : '') + '</div>' +
        '</div>';
    } else {
      h += '<div class="kMini">Выручки ещё нет — досмотри рекламу / оформи подписку / купи набор.</div>';
    }
    h += '<div class="kMini">Реклама ' + money(s.adRev) + ' · Подписка ' + money(s.subRev) +
      ' · IAP ' + money(s.iapRev) + ' (покупок: <b>' + s.iapCount + '</b>). ' +
      'Одна покупка/подписка искажает популяционные 65/22/13 — целевой сплит достигается на массе DAU.</div>';
    h += '</div>';

    // --- Блок 4: rewarded-воронка + текущие eCPM ---
    h += '<div class="kSection"><h4>Rewarded-воронка + текущие eCPM (гео: ' + mon.geoLabel() + ')</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += this.row('Офферы показаны', s.offers.shown, '', '');
    h += this.row('Приняты (досмотр)', s.offers.accepted, '', '');
    h += this.row('Accept rate', accRate + '%', '30–35%', this.chip(accRate, 30));
    h += '<div class="kMini">eCPM (' + mon.geoLabel() + '): ' +
      'RW $' + mon.ecpmFor('rw').toFixed(2) + ' (US-цель $' + T.ecpm.rw + ') · ' +
      'INT $' + mon.ecpmFor('int').toFixed(2) + ' (цель $' + T.ecpm.int + ') · ' +
      'BAN $' + mon.ecpmFor('banner').toFixed(2) + ' (цель $' + T.ecpm.banner + ')</div>';
    h += '</div>';

    // --- Блок 5: состояние монетизации ---
    h += '<div class="kSection"><h4>Состояние</h4>';
    h += '<div class="kMini">' +
      (mon.adsRemoved()
        ? '🚫 INT+BAN отключены (' + (mon.subscribed() ? '👑 подписка WordGrove Club' : 'Remove Ads') + ')'
        : '📺 Реклама включена') +
      ' · время сессии ~' + mins + ' мин' +
      ' · lifetime: ad ' + money(store.lifetime.adRev) +
      ' · sub ' + money(store.lifetime.subRev) +
      ' · iap ' + money(store.lifetime.iapRev) +
      '</div>';
    h += '<div class="kMini kDis">СИМУЛЯЦИЯ: выручка — модельная (eCPM×jitter/1000 и прайс SKU/подписки), ' +
      'не реальные деньги. Impression-level revenue в проде — из AppLovin MAX API (06 §6, §8).</div>';
    h += '</div>';

    this.el('dashBody').innerHTML = h;
  }
}
