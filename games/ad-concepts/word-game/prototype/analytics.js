/* =============================================================================
 * WordGrove — АНАЛИТИЧЕСКИЙ ДАШБОРД (Проход В)
 * -----------------------------------------------------------------------------
 * Живые KPI монетизации ТЕКУЩЕЙ СЕССИИ против целей главы 09 (§3) и структуры
 * выручки главы 06 (сплит 65/22/13). Данные — из window.Monetize (реальные события
 * сессии: показы по форматам, ad/sub/iap revenue, воронка rewarded, недопоказы
 * interstitial). Сам ничего НЕ симулирует — только читает и считает производные
 * метрики (доли, ARPDAU-оценка, impressions/DAU) и красит их относительно целей.
 *
 * Модель прочтения: «сессия = 1 симулированный DAU за день». Тогда счётчики показов
 * сессии = impressions/DAU, а ad revenue сессии ≈ ad ARPDAU. Подписка/IAP так не
 * читаются (один плательщик ≠ среднее по всем DAU): показаны как «выручка этого
 * игрока» с явной пометкой; целевой сплит 65/22/13 — популяционный ориентир из книги.
 *
 * Подключается ПОСЛЕ monetize.js. window.Dashboard.refresh() дёргается монетизацией
 * после каждого события — дашборд «живой».
 * ========================================================================== */
'use strict';

window.Dashboard = (function () {

  function el(id) { return document.getElementById(id); }
  function money(v) { v = v || 0; return '$' + v.toFixed(v >= 1 ? 2 : 4); }
  function M() { return window.Monetize; }

  /* Статус-чип относительно цели (больше — лучше). */
  function chip(value, target) {
    var ratio = target > 0 ? value / target : 0;
    var cls, txt;
    if (ratio >= 1) { cls = 'hit'; txt = '✓ на цели'; }
    else if (ratio >= 0.6) { cls = 'near'; txt = Math.round(ratio * 100) + '%'; }
    else { cls = 'low'; txt = Math.round(ratio * 100) + '%'; }
    return '<span class="kchip ' + cls + '">' + txt + '</span>';
  }

  function row(label, value, targetTxt, chipHtml, note) {
    return '<div class="kRow">'
      + '<div class="kLabel">' + label + (note ? '<span class="kNote">' + note + '</span>' : '') + '</div>'
      + '<div class="kVal">' + value + '</div>'
      + '<div class="kTgt">' + (targetTxt || '') + '</div>'
      + '<div class="kStat">' + (chipHtml || '') + '</div>'
      + '</div>';
  }

  function geoSwitch() {
    var mon = M(); if (!mon) return '';
    var cur = mon.getGeo();
    var order = mon.MON.GEO_ORDER;
    var labels = mon.MON.GEO_LABELS;
    var h = '<div class="geoSwitch"><span class="geoCap">Гео / eCPM:</span>';
    for (var i = 0; i < order.length; i++) {
      var g = order[i];
      h += '<button type="button" class="geoBtn' + (g === cur ? ' active' : '') + '" data-geo="' + g + '">'
        + labels[g] + '</button>';
    }
    return h + '</div>';
  }

  function pct(part, total) { return total > 0 ? (part / total * 100) : 0; }

  function render() {
    var body = el('dashBody');
    var mon = M();
    if (!body || !mon) return;

    var s = mon.getSession();
    var store = mon.getStore();
    var T = mon.getTargets();

    var totalRev = s.adRev + s.subRev + s.iapRev;
    var mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    var accRate = s.offers.shown > 0 ? Math.round(s.offers.accepted / s.offers.shown * 100) : 0;

    // Гео-переключатель.
    if (el('dashGeo')) el('dashGeo').innerHTML = geoSwitch();

    var h = '';

    // --- Блок 0: назначенные A/B-варианты (Проход Г, 09 §1.2 ab_groups[]) ---
    if (window.Experiments && typeof window.Experiments.getAssignments === 'function') {
      var asg = window.Experiments.getAssignments();
      h += '<div class="kSection"><h4>A/B-группы этой сессии (Проход Г, 09 §1.2)</h4>';
      h += '<div class="kMini">Детерминированное назначение по хешу session-id (fnv1a32). '
        + 'В проде эти <code>ab_groups[]</code> уходят в каждое событие трекинга.</div>';
      h += '<div class="abStrip">';
      asg.forEach(function (a) {
        h += '<span class="abChip"><b>' + a.exp + '</b> = ' + a.variant + '<span class="abChipLbl">' + a.label + '</span></span>';
      });
      h += '</div>';
      h += '<div class="kMini">Открыть 🚀 <b>Soft-launch cockpit</b> — симулятор экономики, панель тюнинга и '
        + 'гейты go/iterate/kill.</div>';
      h += '</div>';
    }

    // --- Блок 1: показы по форматам (impressions/DAU) ---
    h += '<div class="kSection"><h4>Показы по форматам · impressions/DAU (09 §3)</h4>';
    h += '<div class="kHead"><span>Формат</span><span>Сессия</span><span>Цель</span><span></span></div>';
    h += row('Interstitial (I-1)', s.imp.int, T.intPerDau.toFixed(1), chip(s.imp.int, T.intPerDau));
    h += row('Rewarded (RV-1/2/5/6)', s.imp.rw, T.rwPerDau.toFixed(1), chip(s.imp.rw, T.rwPerDau));
    h += row('Banner (B-1)', s.imp.banner, String(T.bannerPerDau), chip(s.imp.banner, T.bannerPerDau));
    h += '<div class="kMini">Недопоказы interstitial (капы 06 §4): <b>' + s.intCapped + '</b>'
      + (s.lastCapRule ? ' · последний: ' + s.lastCapRule : '') + '</div>';
    h += '</div>';

    // --- Блок 2: выручка и ARPDAU ---
    h += '<div class="kSection"><h4>Выручка сессии · ARPDAU-оценка (06 §8.3)</h4>';
    h += '<div class="kHead"><span>Компонент</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += row('Реклама (ad ARPDAU)', money(s.adRev), money(T.adArpdau), chip(s.adRev, T.adArpdau),
      'реклама/DAU — сравнимо');
    h += row('Подписка (net/день)', money(s.subRev), money(T.subArpdau), '',
      'амортизация подписчика ≠ среднее DAU');
    h += row('IAP (этот игрок)', money(s.iapRev), money(T.iapArpdau), '',
      'плательщик ≠ среднее DAU');
    h += row('Blended (сессия)', money(totalRev), money(T.blendedArpdau), chip(s.adRev, T.adArpdau),
      'ad-часть на цели → ок');
    h += '<div class="kMini">Разбивка ad-выручки: INT ' + money(s.revByFormat.int)
      + ' · RW ' + money(s.revByFormat.rw) + ' · BAN ' + money(s.revByFormat.banner) + '</div>';
    h += '</div>';

    // --- Блок 3: структура выручки (доля ad/sub/iap) vs цель 65/22/13 ---
    var adP = pct(s.adRev, totalRev), subP = pct(s.subRev, totalRev), iapP = pct(s.iapRev, totalRev);
    h += '<div class="kSection"><h4>Структура выручки · Реклама/Подписка/IAP (цель 65/22/13, 06 §8.3)</h4>';
    h += '<div class="shareCap">Цель (книга):</div>';
    h += '<div class="shareBar">'
      + '<div class="shareAd" style="width:' + T.revSplit.ad + '%">Реклама ' + T.revSplit.ad + '%</div>'
      + '<div class="shareSub" style="width:' + T.revSplit.sub + '%">Подписка ' + T.revSplit.sub + '%</div>'
      + '<div class="shareIap" style="width:' + T.revSplit.iap + '%">IAP ' + T.revSplit.iap + '%</div>'
      + '</div>';
    h += '<div class="shareCap">Этот игрок (сессия):</div>';
    if (totalRev > 0) {
      h += '<div class="shareBar">'
        + '<div class="shareAd" style="width:' + adP.toFixed(1) + '%">' + (adP >= 8 ? 'Реклама ' + adP.toFixed(0) + '%' : '') + '</div>'
        + '<div class="shareSub" style="width:' + subP.toFixed(1) + '%">' + (subP >= 8 ? 'Подписка ' + subP.toFixed(0) + '%' : '') + '</div>'
        + '<div class="shareIap" style="width:' + iapP.toFixed(1) + '%">' + (iapP >= 8 ? 'IAP ' + iapP.toFixed(0) + '%' : '') + '</div>'
        + '</div>';
    } else {
      h += '<div class="kMini">Выручки ещё нет — досмотри рекламу / оформи подписку / купи набор.</div>';
    }
    h += '<div class="kMini">Реклама ' + money(s.adRev) + ' · Подписка ' + money(s.subRev)
      + ' · IAP ' + money(s.iapRev) + ' (покупок: <b>' + s.iapCount + '</b>). '
      + 'Одна покупка/подписка искажает популяционные 65/22/13 — целевой сплит достигается на массе DAU.</div>';
    h += '</div>';

    // --- Блок 4: rewarded-воронка + текущие eCPM ---
    h += '<div class="kSection"><h4>Rewarded-воронка + текущие eCPM (гео: ' + mon.geoLabel() + ')</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += row('Офферы показаны', s.offers.shown, '', '');
    h += row('Приняты (досмотр)', s.offers.accepted, '', '');
    h += row('Accept rate', accRate + '%', '30–35%', chip(accRate, 30));
    h += '<div class="kMini">eCPM (' + mon.geoLabel() + '): '
      + 'RW $' + mon.ecpmFor('rw').toFixed(2) + ' (US-цель $' + T.ecpm.rw + ') · '
      + 'INT $' + mon.ecpmFor('int').toFixed(2) + ' (цель $' + T.ecpm.int + ') · '
      + 'BAN $' + mon.ecpmFor('banner').toFixed(2) + ' (цель $' + T.ecpm.banner + ')</div>';
    h += '</div>';

    // --- Блок 5: состояние монетизации ---
    h += '<div class="kSection"><h4>Состояние</h4>';
    h += '<div class="kMini">'
      + (mon.adsRemoved()
          ? '🚫 INT+BAN отключены (' + (mon.subscribed() ? '👑 подписка WordGrove Club' : 'Remove Ads') + ')'
          : '📺 Реклама включена')
      + ' · время сессии ~' + mins + ' мин'
      + ' · lifetime: ad ' + money(store.lifetime.adRev)
      + ' · sub ' + money(store.lifetime.subRev)
      + ' · iap ' + money(store.lifetime.iapRev)
      + '</div>';
    h += '<div class="kMini kDis">СИМУЛЯЦИЯ: выручка — модельная (eCPM×jitter/1000 и прайс SKU/подписки), '
      + 'не реальные деньги. Impression-level revenue в проде — из AppLovin MAX API (06 §6, §8).</div>';
    h += '</div>';

    body.innerHTML = h;
  }

  function refresh() {
    var sc = el('dashboardScreen');
    if (sc && !sc.classList.contains('hidden')) render();
  }

  function open() {
    var sc = el('dashboardScreen');
    if (sc) sc.classList.remove('hidden');
    if (M()) { try { M().closeShop(); } catch (e) { /* no-op */ } }
    render();
  }
  function close() {
    var sc = el('dashboardScreen');
    if (sc) sc.classList.add('hidden');
  }

  function bind() {
    var openBtn = el('btn-dash'); if (openBtn) openBtn.addEventListener('click', open);
    var closeBtn = el('dashCloseBtn'); if (closeBtn) closeBtn.addEventListener('click', close);
    var resetBtn = el('dashResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (M()) M().resetSession();
      render();
    });
    // Гео-переключатель (делегирование — кнопки перерисовываются).
    var geo = el('dashGeo');
    if (geo) geo.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('.geoBtn') : null;
      if (btn && M()) { M().setGeo(btn.getAttribute('data-geo')); render(); }
    });
  }

  bind();

  return { open: open, close: close, render: render, refresh: refresh };
})();
