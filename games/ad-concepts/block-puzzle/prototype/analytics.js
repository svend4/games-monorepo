/* =============================================================================
 * Block Surge — АНАЛИТИЧЕСКИЙ ДАШБОРД (Проход В)
 * -----------------------------------------------------------------------------
 * Живые KPI монетизации ТЕКУЩЕЙ СЕССИИ против целей главы 09. Данные —
 * из window.Monetize (реальные события сессии: показы по форматам, ad/IAP
 * revenue, воронка rewarded, недопоказы interstitial). Ничего не симулирует
 * сам — только читает и считает производные метрики (доли, ARPDAU-оценка,
 * impressions/DAU) и красит их относительно целей 09 §4.
 *
 * Модель прочтения: «сессия = 1 симулированный DAU за день». Тогда счётчики
 * показов сессии = impressions/DAU, а ad revenue сессии ≈ ad ARPDAU (оба
 * масштабируются на одного игрока). IAP-часть так не читается (один плательщик
 * ≠ среднее по всем DAU) — она показана как «выручка этого игрока» с явной
 * пометкой, цель $0.045 — популяционная (нужно ~7–8% плательщиков среди DAU).
 *
 * Подключается ПОСЛЕ monetize.js и ПЕРЕД game.js. window.Dashboard.refresh()
 * дёргается монетизацией после каждого события — дашборд «живой».
 * ========================================================================== */
'use strict';

window.Dashboard = (function () {

  function el(id) { return document.getElementById(id); }
  function money(v) { return '$' + (v || 0).toFixed(v >= 1 ? 2 : 4); }
  function esc(s) { return String(s); }

  function M() { return window.Monetize; }

  /* Статус-чип относительно цели: hit — на цели/выше, near — 60–100%, low — ниже. */
  function chip(value, target, higherBetter) {
    var ratio = target > 0 ? value / target : 0;
    var cls, txt;
    if (higherBetter === false) {
      // «меньше — лучше» (недопоказы): просто нейтрально
      cls = value > 0 ? 'near' : 'hit';
      txt = value > 0 ? '⚠' : 'ok';
    } else if (ratio >= 1) { cls = 'hit'; txt = '✓ на цели'; }
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
    h += '</div>';
    return h;
  }

  function render() {
    var body = el('dashBody');
    var mon = M();
    if (!body || !mon) return;

    var s = mon.getSession();
    var store = mon.getStore();
    var T = mon.getTargets();

    var totalRev = s.adRev + s.iapRev;
    var adSharePlayer = totalRev > 0 ? (s.adRev / totalRev * 100) : 0;
    var iapSharePlayer = totalRev > 0 ? (s.iapRev / totalRev * 100) : 0;
    var mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    var accRate = s.offers.shown > 0 ? Math.round(s.offers.accepted / s.offers.shown * 100) : 0;

    var h = '';

    // Гео-переключатель + текущие eCPM.
    el('dashGeo').innerHTML = geoSwitch();

    // --- Блок 1: показы по форматам (impressions/DAU) ---
    h += '<div class="kSection"><h4>Показы по форматам · impressions/DAU (09 §4)</h4>';
    h += '<div class="kHead"><span>Формат</span><span>Сессия</span><span>Цель</span><span></span></div>';
    h += row('Interstitial', s.imp.int, T.intPerDau.toFixed(1), chip(s.imp.int, T.intPerDau));
    h += row('Rewarded', s.imp.rw, T.rwPerDau.toFixed(1), chip(s.imp.rw, T.rwPerDau));
    h += row('Banner', s.imp.banner, String(T.bannerPerDau), chip(s.imp.banner, T.bannerPerDau));
    h += '<div class="kMini">Недопоказы interstitial (капы 06 §3): <b>' + s.intCapped + '</b>'
      + (s.lastCapRule ? ' · последний: ' + s.lastCapRule : '') + '</div>';
    h += '</div>';

    // --- Блок 2: выручка и ARPDAU ---
    h += '<div class="kSection"><h4>Выручка сессии · ARPDAU-оценка (09 §4)</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += row('Ad ARPDAU', money(s.adRev), money(T.adArpdau), chip(s.adRev, T.adArpdau),
      'реклама/DAU — сравнимо');
    h += row('IAP (этот игрок)', money(s.iapRev), money(T.iapArpdau), '',
      'плательщик ≠ среднее DAU');
    h += row('Blended (сессия)', money(totalRev), money(T.blendedArpdau), chip(s.adRev, T.adArpdau),
      'ad-часть на цели → ок');
    h += '<div class="kMini">Разбивка ad-выручки: INT ' + money(s.revByFormat.int)
      + ' · RW ' + money(s.revByFormat.rw) + ' · BAN ' + money(s.revByFormat.banner) + '</div>';
    h += '</div>';

    // --- Блок 3: структура выручки (доля ad/IAP) ---
    h += '<div class="kSection"><h4>Структура выручки · доля Ad/IAP (цель 70/30 → 60/40)</h4>';
    h += '<div class="shareBar">'
      + '<div class="shareAd" style="width:' + adSharePlayer.toFixed(0) + '%">Ad ' + adSharePlayer.toFixed(0) + '%</div>'
      + '<div class="shareIap" style="width:' + iapSharePlayer.toFixed(0) + '%">IAP ' + iapSharePlayer.toFixed(0) + '%</div>'
      + '</div>';
    h += '<div class="kMini">Доля этого игрока (одна IAP-покупка искажает популяционные 70/30). '
      + 'Покупок: <b>' + s.iapCount + '</b> · lifetime IAP: ' + money(store.lifetime.iapRev) + '</div>';
    h += '</div>';

    // --- Блок 4: воронка rewarded + текущие eCPM ---
    h += '<div class="kSection"><h4>Rewarded-воронка + текущие eCPM</h4>';
    h += '<div class="kHead"><span>Метрика</span><span>Значение</span><span>Цель</span><span></span></div>';
    h += row('Офферы показаны', s.offers.shown, '', '');
    h += row('Приняты', s.offers.accepted, '', '');
    h += row('Accept rate', accRate + '%', '30–35%', chip(accRate, 30));
    h += '<div class="kMini">eCPM (' + mon.geoLabel() + '): '
      + 'RW $' + mon.ecpmFor('rw').toFixed(2) + ' (цель $' + T.ecpm.rw + ') · '
      + 'INT $' + mon.ecpmFor('int').toFixed(2) + ' (цель $' + T.ecpm.int + ') · '
      + 'BAN $' + mon.ecpmFor('banner').toFixed(2) + ' (цель $' + T.ecpm.banner + ')</div>';
    h += '</div>';

    // --- Блок 5: состояние монетизации ---
    h += '<div class="kSection"><h4>Состояние</h4>';
    h += '<div class="kMini">'
      + (mon.adsRemoved() ? '🚫 INT+BAN отключены (' + (store.subscription.active ? 'подписка' : 'Remove Ads') + ')'
        : '📺 Реклама включена')
      + ' · время сессии ~' + mins + ' мин'
      + ' · lifetime ad-выручка ' + money(store.lifetime.adRev)
      + '</div>';
    h += '<div class="kMini kDis">СИМУЛЯЦИЯ: цифры выручки — модельные (eCPM×jitter/1000 и прайс SKU), '
      + 'не реальные деньги. Impression-level revenue в проде — из MAX API (06 §8).</div>';
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
    if (M() && M().adsRemoved) { /* обновим видимость баннера через монетизацию */ }
    render();
  }
  function close() {
    var sc = el('dashboardScreen');
    if (sc) sc.classList.add('hidden');
  }

  function bind() {
    var openBtn = el('openDashBtn'); if (openBtn) openBtn.addEventListener('click', open);
    var metaDash = el('metaDashBtn'); if (metaDash) metaDash.addEventListener('click', open);
    var closeBtn = el('dashCloseBtn'); if (closeBtn) closeBtn.addEventListener('click', close);
    var resetBtn = el('dashResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (M()) M().resetSession();
      render();
    });
    // Гео-переключатель (делегирование, т.к. кнопки перерисовываются).
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
