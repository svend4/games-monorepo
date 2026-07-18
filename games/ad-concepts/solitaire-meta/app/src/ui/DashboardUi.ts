/**
 * Аналитический дашборд 📊 (Проход Е.2) — DOM-оверлей, порт analytics.js
 * (Проход В) 1:1: живые KPI монетизации ТЕКУЩЕЙ СЕССИИ против целей главы 09
 * (§9.1 дерево событий, §9.2 воронки, §9.3 KPI-цели, §9.7 дашборды).
 * Светлая тема и крупные шрифты — ЦА 45+ (стили прототипа в src/style.css).
 *
 * Дашборд ничего не симулирует сам: данные — из MonetizeController.getStats(),
 * лента последних событий — подписка Analytics.onTrack. DAU прототипа = 1
 * (текущий игрок за «сегодня»), поэтому per-DAU метрики = суммам сессии —
 * это явно подписано на экране.
 */
import type { Analytics, AnalyticsParams } from '../economy/analytics';
import { PLACEMENT_ORDER } from '../monetize/config';
import type { MonetizeController } from '../monetize/monetize';

/* ---- Цели базового сценария (09 §9.3) + здоровые полосы (06 §6.9) ---- */
const TARGET = {
  rwPerDau: 4.0, // Rewarded показов/DAU (база)
  intPerDau: 2.5, // Interstitial/DAU (база)
  ecpmRw: 16.0, // eCPM rewarded blended, $ (Tier-1)
  ecpmInt: 12.0, // eCPM interstitial blended, $ (Tier-1)
  adArpdau: 0.1, // Ad ARPDAU, $
  iapArpdau: 0.12, // IAP ARPDAU, $
  blended: 0.22, // ARPDAU blended, $
  adShare: [0.42, 0.52] as const, // доля рекламы в выручке (06 §6.9)
  rwRevShare: [0.65, 0.7] as const // rewarded в ad-выручке (06 §6.1/§6.9)
};

interface EvLogEntry {
  ev: string;
  p: AnalyticsParams;
}

function usd(v: number): string {
  return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function n1(v: number): string {
  return v.toFixed(1);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Статус для «больше — лучше» с полосой здоровья. */
function stHigher(v: number, target: number): string {
  return v >= target ? 'ok' : v >= 0.6 * target ? 'warn' : 'bad';
}

/** Статус для метрики-полосы [lo,hi]: ok внутри, warn рядом, bad далеко. */
function stBand(v: number, lo: number, hi: number): string {
  if (v >= lo && v <= hi) return 'ok';
  if (v >= lo * 0.8 && v <= hi * 1.2) return 'warn';
  return 'bad';
}

/** Interstitial/DAU: и мало плохо (офферы не видны), и много плохо (чёрн 45+). */
function stInt(v: number): string {
  if (v >= 2.0 && v <= 3.2) return 'ok';
  if ((v >= 1.0 && v < 2.0) || (v > 3.2 && v <= 3.6)) return 'warn';
  return 'bad';
}

export class DashboardUi {
  /** Кнопка «💎 Магазин» из контролов дашборда (main.ts связывает с ShopUi). */
  onOpenStore: (() => void) | null = null;
  /** Возврат в игру. */
  onClose: (() => void) | null = null;

  private screenEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private readonly evlog: EvLogEntry[] = [];
  private renderScheduled = false;

  constructor(
    private readonly monetize: MonetizeController,
    private readonly analytics: Analytics
  ) {}

  /* ============================ DOM ============================ */

  mount(): void {
    if (this.screenEl !== null || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'dash-screen';
    el.className = 'hidden';
    el.innerHTML =
      '<header id="dash-top">' +
      '<button id="dash-back" type="button">← Играть</button>' +
      '<div class="dash-title">📊 KPI сессии</div>' +
      '<div class="dash-geo" id="dash-geo"></div>' +
      '</header>' +
      '<main id="dash-body"></main>';
    document.body.appendChild(el);
    this.screenEl = el;
    this.bodyEl = document.getElementById('dash-body');

    const back = document.getElementById('dash-back');
    if (back !== null) back.addEventListener('click', () => this.close());
    this.bodyEl?.addEventListener('click', (ev) => this.onBodyClick(ev));

    // Лента последних событий трекинга (09 §9.1), кап 40, показ последних 14.
    this.analytics.onTrack = (ev, params) => {
      this.evlog.push({ ev, p: params ?? {} });
      if (this.evlog.length > 40) this.evlog.shift();
      this.scheduleRender();
    };
  }

  private onBodyClick(ev: Event): void {
    const b = (ev.target as HTMLElement).closest('[data-act]');
    if (b === null) return;
    const act = b.getAttribute('data-act');
    if (act === 'geo1') this.monetize.setGeo('tier1');
    else if (act === 'geo23') this.monetize.setGeo('tier23');
    else if (act === 'event') this.monetize.setEvent(!this.monetize.isEventWeekend());
    else if (act === 'reset') this.monetize.resetSession();
    else if (act === 'store') {
      this.close();
      this.onOpenStore?.();
      return;
    }
    this.render();
  }

  isOpen(): boolean {
    return this.screenEl !== null && !this.screenEl.classList.contains('hidden');
  }

  open(): void {
    this.mount();
    if (this.screenEl === null) return;
    this.screenEl.classList.remove('hidden');
    document.body.classList.add('meta-open');
    this.render();
    this.analytics.track('screen_open', { screen: 'dash' });
  }

  close(): void {
    if (this.screenEl === null) return;
    this.screenEl.classList.add('hidden');
    document.body.classList.remove('meta-open');
    this.onClose?.();
  }

  /** «Живой» дашборд: перерисовка с дебаунсом (порт scheduleRender). */
  refresh(): void {
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (!this.isOpen() || this.renderScheduled || typeof window === 'undefined') return;
    this.renderScheduled = true;
    window.setTimeout(() => {
      this.renderScheduled = false;
      this.render();
    }, 120);
  }

  /* ============================ ВИДЖЕТЫ ============================ */

  private tile(label: string, value: string, sub: string, cls: string): string {
    return (
      '<div class="dash-tile ' + cls + '">' +
      '<div class="tile-val">' + value + '</div>' +
      '<div class="tile-lab">' + esc(label) + '</div>' +
      '<div class="tile-sub">' + esc(sub) + '</div></div>'
    );
  }

  private kpiRow(label: string, factStr: string, targetStr: string, status: string): string {
    return (
      '<tr><td><span class="kpi-dot ' + status + '"></span>' + esc(label) + '</td>' +
      '<td class="kpi-fact">' + factStr + '</td>' +
      '<td class="kpi-tgt">' + esc(targetStr) + '</td></tr>'
    );
  }

  /** Гейт доли рекламы 50/50: полоса 0–100% с целевой зоной 42–52% и маркером. */
  private shareGauge(share: number): string {
    const p = Math.max(0, Math.min(1, share)) * 100;
    return (
      '<div class="gauge">' +
      '<div class="gauge-band" style="left:42%;width:10%"></div>' +
      '<div class="gauge-mark" style="left:' + p.toFixed(1) + '%"></div>' +
      '<div class="gauge-mid" style="left:50%"></div>' +
      '</div>' +
      '<div class="gauge-legend"><span>0% реклама</span><span>цель 42–52%</span><span>100%</span></div>'
    );
  }

  private funStep(label: string, val: number): string {
    return '<div class="fun-step"><div class="fun-val">' + val + '</div><div class="fun-lab">' + esc(label) + '</div></div>';
  }

  private evParams(p: AnalyticsParams): string {
    const keys = ['placement_id', 'sku', 'block_reason', 'ecpm_usd', 'price_usd', 'eligible', 'source_id', 'amount', 'result', 'state'];
    const out: string[] = [];
    for (const k of keys) {
      const v = p[k];
      if (v !== undefined && v !== null) out.push(k + '=' + String(v));
    }
    return out.slice(0, 3).join(' ');
  }

  /* ============================ РЕНДЕР (порт 1:1) ============================ */

  render(): void {
    if (!this.isOpen() || this.bodyEl === null) return;
    const s = this.monetize.getStats();

    const geoEl = document.getElementById('dash-geo');
    if (geoEl !== null) geoEl.textContent = '🌍 ' + (s.geo === 'tier1' ? 'Tier-1' : 'Tier-2/3');

    let html = '';

    /* --- Контролы: гео-переключатель, ивент, сброс, магазин --- */
    html += '<div class="dash-ctrl">';
    html +=
      '<div class="ctrl-group"><span class="ctrl-lab">🌍 Гео (eCPM 06 §6.7):</span>' +
      '<button class="ctrl-btn ' + (s.geo === 'tier1' ? 'on' : '') + '" data-act="geo1">Tier-1</button>' +
      '<button class="ctrl-btn ' + (s.geo === 'tier23' ? 'on' : '') + '" data-act="geo23">Tier-2/3</button></div>';
    html +=
      '<div class="ctrl-group"><span class="ctrl-lab">🎪 Ивент пт–вс:</span>' +
      '<button class="ctrl-btn ' + (s.event ? 'on' : '') + '" data-act="event">' + (s.event ? 'ВКЛ' : 'выкл') + '</button></div>';
    html +=
      '<div class="ctrl-group">' +
      '<button class="ctrl-btn" data-act="store">💎 Магазин</button>' +
      '<button class="ctrl-btn" data-act="reset">↺ Сброс KPI</button></div>';
    html += '</div>';

    html +=
      '<div class="sim-banner">⚠ СИМУЛЯЦИЯ: цифры сгенерированы локально по eCPM главы 06. ' +
      'DAU прототипа = 1 игрок, поэтому per-DAU метрики = суммам сессии.</div>';

    /* --- Крупные плитки выручки (ARPDAU сессии) --- */
    html += '<div class="dash-tiles">';
    html += this.tile('Ad ARPDAU', usd(s.adRev), s.totalImps + ' показов', 'ad');
    html += this.tile('IAP ARPDAU', usd(s.iapRev), s.purchases + ' покупок', 'iap');
    html += this.tile('Blended ARPDAU', usd(s.blended), 'цель $' + TARGET.blended.toFixed(2), 'sum');
    html += '</div>';

    /* --- Гейт 50/50 --- */
    html += '<div class="dash-card">';
    html +=
      '<div class="dash-h">⚖ Доля рекламы в выручке ' +
      '<span class="hl ' + stBand(s.adShare, TARGET.adShare[0], TARGET.adShare[1]) + '">' +
      (s.blended > 0 ? pct(s.adShare) : '—') + '</span> ' +
      '<span class="dash-small">(здоровый гибрид 42–52%, 06 §6.9)</span></div>';
    html += this.shareGauge(s.blended > 0 ? s.adShare : 0.5);
    if (s.blended > 0 && s.adShare > 0.6) {
      html += '<p class="dash-hint">Доля рекламы высока — полка/офферы недожаты. Симулируйте покупку в 💎 Магазине, чтобы вернуть баланс к 50/50.</p>';
    }
    html += '</div>';

    /* --- KPI против целей 09 §9.3 --- */
    html += '<div class="dash-card"><div class="dash-h">🎯 KPI сессии против целей (база, 09 §9.3)</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Метрика</th><th>Факт</th><th>Цель</th></tr></thead><tbody>';
    html += this.kpiRow('Rewarded показов/DAU', n1(s.rewardedImps), n1(TARGET.rwPerDau), stHigher(s.rewardedImps, TARGET.rwPerDau));
    html += this.kpiRow('Interstitial/DAU', n1(s.intImps), n1(TARGET.intPerDau), stInt(s.intImps));
    html += this.kpiRow('eCPM rewarded', s.ecpmRw > 0 ? usd(s.ecpmRw) : '—', usd(TARGET.ecpmRw), s.ecpmRw > 0 ? stHigher(s.ecpmRw, TARGET.ecpmRw) : 'warn');
    html += this.kpiRow('eCPM interstitial', s.ecpmInt > 0 ? usd(s.ecpmInt) : '—', usd(TARGET.ecpmInt), s.ecpmInt > 0 ? stHigher(s.ecpmInt, TARGET.ecpmInt) : 'warn');
    html += this.kpiRow('Ad ARPDAU', usd(s.adRev), usd(TARGET.adArpdau), stHigher(s.adRev, TARGET.adArpdau));
    html += this.kpiRow('IAP ARPDAU', usd(s.iapRev), usd(TARGET.iapArpdau), stHigher(s.iapRev, TARGET.iapArpdau));
    html += this.kpiRow('ARPDAU blended', usd(s.blended), usd(TARGET.blended), stHigher(s.blended, TARGET.blended));
    html += this.kpiRow('Доля рекламы', s.blended > 0 ? pct(s.adShare) : '—', '42–52%', s.blended > 0 ? stBand(s.adShare, TARGET.adShare[0], TARGET.adShare[1]) : 'warn');
    html += this.kpiRow('Rewarded в ad-выручке', s.adRev > 0 ? pct(s.rewardedRevShare) : '—', '65–70%', s.adRev > 0 ? stBand(s.rewardedRevShare, TARGET.rwRevShare[0], TARGET.rwRevShare[1]) : 'warn');
    html += '</tbody></table></div>';
    html +=
      '<p class="dash-small">Полосы: <span class="kpi-dot ok"></span>цель достигнута · <span class="kpi-dot warn"></span>близко · <span class="kpi-dot bad"></span>далеко. ' +
      'Ранняя сессия закономерно «жёлтая/красная» — метрики растут по мере показов/покупок.</p>';
    html += '</div>';

    /* --- Показы по плейсментам (06 §6.2) --- */
    html += '<div class="dash-card"><div class="dash-h">📺 Показы по плейсментам</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table plc"><thead><tr><th>Плейсмент</th><th>Показы</th><th>Выручка</th><th>eCPM*</th></tr></thead><tbody>';
    for (const pid of PLACEMENT_ORDER) {
      const imps = s.imps[pid] ?? 0;
      const rev = s.rev[pid] ?? 0;
      const ecpm = imps > 0 ? (rev / imps) * 1000 : 0;
      html +=
        '<tr' + (imps > 0 ? ' class="has"' : '') + '><td><b>' + pid + '</b> ' + esc(this.monetize.placementName(pid)) + '</td>' +
        '<td>' + imps + '</td><td>' + (rev > 0 ? usd(rev) : '—') + '</td>' +
        '<td>' + (ecpm > 0 ? usd(ecpm) : '—') + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="dash-small">* реализованный eCPM показа (выручка/показы×1000). Rewarded — доминанта по выручке (цель 65–70%).</p>';
    html += '</div>';

    /* --- Воронка рекламы (09 §9.2) --- */
    html += '<div class="dash-card"><div class="dash-h">🔻 Воронка рекламы (09 §9.2)</div>';
    html +=
      '<div class="funnel">' +
      this.funStep('Возможности', s.opps) +
      this.funStep('Офферы', s.offers) +
      this.funStep('Старты', s.started) +
      this.funStep('Досмотры', s.completed) +
      '</div>';
    html +=
      '<div class="dash-small">Отказов (ad_failed): <b>' + s.failed + '</b>. Completion: <b>' +
      (s.started > 0 ? pct(s.completed / s.started) : '—') + '</b> (бенчмарк rewarded 80–90%).</div>';
    const blkKeys = Object.keys(s.blocks);
    if (blkKeys.length > 0) {
      html += '<div class="blk-wrap"><div class="dash-small">Пропуски показов (правила 06 §6.3):</div>';
      for (const k of blkKeys) html += '<span class="blk-chip">' + esc(k) + ': ' + s.blocks[k] + '</span>';
      html += '</div>';
    }
    html += '</div>';

    /* --- IAP / статусы плательщика --- */
    html += '<div class="dash-card"><div class="dash-h">💳 IAP и статусы</div>';
    html +=
      '<div class="stat-line">Покупок за сессию: <b>' + s.purchases + '</b> · ' +
      'ARPPU (плательщик): <b>' + (s.purchases > 0 ? usd(s.arppu) : '—') + '</b> · ' +
      'Плательщик: <b>' + (s.payer ? 'да' : 'нет') + '</b></div>';
    html +=
      '<div class="stat-line">Remove-ads: <b>' + (s.removeAds ? 'куплен ✓' : 'нет') + '</b> · ' +
      'Подписка: <b>' + (s.sub ? 'активна (мес ' + s.subMonth + ') ✓' : 'нет') + '</b> · ' +
      'Копилка: <b>' + (s.piggy.owned ? Math.round(s.piggy.balance) + ' 💰' : 'нет') + '</b></div>';
    html +=
      '<div class="stat-line dash-small">Lifetime (все сессии): реклама ' + usd(s.life.adRevenue) +
      ' · IAP ' + usd(s.life.iapRevenue) + '</div>';
    html += '</div>';

    /* --- Лента последних событий (§9.1) --- */
    html += '<div class="dash-card"><div class="dash-h">📜 Последние события трекинга</div><div class="evlog">';
    if (this.evlog.length === 0) {
      html += '<div class="dash-small">Пока пусто — сыграйте раздачу, посмотрите rewarded или откройте 💎 Магазин.</div>';
    } else {
      for (let i = this.evlog.length - 1; i >= 0 && i >= this.evlog.length - 14; i--) {
        const e = this.evlog[i];
        html +=
          '<div class="ev-row"><span class="ev-name">' + esc(e.ev) + '</span>' +
          '<span class="ev-p">' + esc(this.evParams(e.p)) + '</span></div>';
      }
    }
    html += '</div></div>';

    html += '<p class="dash-foot">СИМУЛЯЦИЯ · Проход Е.2 · события 09 §9.1, KPI 09 §9.3, дашборд 09 §9.7.</p>';

    this.bodyEl.innerHTML = html;
  }
}
