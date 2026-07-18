/* =============================================================================
 * Orchard Peaks — АНАЛИТИЧЕСКИЙ ДАШБОРД (Проход В)   ⚠ ДАННЫЕ — СИМУЛЯЦИЯ ⚠
 * -----------------------------------------------------------------------------
 * Реализует главу 09-analytics-kpi.md (§9.1 дерево событий, §9.2 воронки,
 * §9.3 KPI-цели, §9.7 дашборды) для прототипа. Живые KPI ТЕКУЩЕЙ СЕССИИ считаются
 * по реальным событиям монетизации (monetize.js) и экономики (economy.js) и
 * сравниваются с целями базового сценария главы 09. Крупные шрифты — ЦА 45+.
 *
 * Подключается ПОСЛЕ economy.js/meta.js/monetize.js и ПЕРЕД game.js. Ничего не
 * переписывает: window.Analytics (лёгкий трекер из economy.js) оборачивается для
 * ленты последних событий; счётчики выручки/показов берутся из Monetize.getStats().
 *
 * DAU в прототипе = 1 (текущий игрок за «сегодня»), поэтому per-DAU метрики
 * (ARPDAU, показы/DAU) равны суммам сессии — это явно подписано на экране.
 * ========================================================================== */
'use strict';

window.Dashboard = (function () {

  /* ---- Цели базового сценария (09 §9.3) + здоровые полосы (06 §6.9) ---- */
  var TARGET = {
    rwPerDau:  4.0,     // Rewarded показов/DAU (база)
    intPerDau: 2.5,     // Interstitial/DAU (база)
    ecpmRw:    16.0,    // eCPM rewarded blended, $ (Tier-1)
    ecpmInt:   12.0,    // eCPM interstitial blended, $ (Tier-1)
    adArpdau:  0.10,    // Ad ARPDAU, $
    iapArpdau: 0.12,    // IAP ARPDAU, $
    blended:   0.22,    // ARPDAU blended, $
    adShare:   [0.42, 0.52],   // доля рекламы в выручке (06 §6.9)
    rwRevShare:[0.65, 0.70]    // rewarded в ad-выручке (06 §6.1/§6.9)
  };

  /* ---- Лента последних событий: оборачиваем Analytics.track (§9.1) ---- */
  var EVLOG = [];
  (function wrapTracker() {
    if (!window.Analytics || typeof window.Analytics.track !== 'function') return;
    var orig = window.Analytics.track;
    window.Analytics.track = function (ev, params) {
      try {
        EVLOG.push({ t: Date.now(), ev: ev, p: params || {} });
        if (EVLOG.length > 40) EVLOG.shift();
        scheduleRender();
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  })();

  /* ============================== ФОРМАТ ============================== */
  function usd(v) { return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)); }
  function pct(v) { return (v * 100).toFixed(0) + '%'; }
  function n1(v) { return v.toFixed(1); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* Статус для «больше — лучше» с полосой здоровья. */
  function stHigher(v, target) { return v >= target ? 'ok' : (v >= 0.6 * target ? 'warn' : 'bad'); }
  /* Статус для метрики-полосы [lo,hi]: ok внутри, warn рядом, bad далеко. */
  function stBand(v, lo, hi) {
    if (v >= lo && v <= hi) return 'ok';
    if (v >= lo * 0.8 && v <= hi * 1.2) return 'warn';
    return 'bad';
  }
  /* Interstitial/DAU: и мало плохо (офферы не видны), и много плохо (чёрн 45+). */
  function stInt(v) {
    if (v >= 2.0 && v <= 3.2) return 'ok';
    if ((v >= 1.0 && v < 2.0) || (v > 3.2 && v <= 3.6)) return 'warn';
    return 'bad';
  }
  function dot(status) { return '<span class="kpi-dot ' + status + '"></span>'; }

  /* ============================== DOM ============================== */
  var screenEl, bodyEl, inited = false;

  function ensureDom() {
    if (screenEl) return;
    screenEl = document.createElement('div');
    screenEl.id = 'dash-screen';
    screenEl.className = 'hidden';
    screenEl.innerHTML =
      '<header id="dash-top">' +
        '<button id="dash-back" type="button">← Играть</button>' +
        '<div class="dash-title">📊 KPI сессии</div>' +
        '<div class="dash-geo" id="dash-geo"></div>' +
      '</header>' +
      '<main id="dash-body"></main>';
    document.body.appendChild(screenEl);
    bodyEl = document.getElementById('dash-body');
    document.getElementById('dash-back').addEventListener('click', close);
    bodyEl.addEventListener('click', onBodyClick);
    inited = true;
  }

  function onBodyClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'geo1') window.Monetize.setGeo('tier1');
    else if (act === 'geo23') window.Monetize.setGeo('tier23');
    else if (act === 'event') window.Monetize.setEvent(!window.Monetize.getStats().event);
    else if (act === 'reset') window.Monetize.resetSession();
    else if (act === 'store') { close(); window.Monetize.openStore(); return; }
    render();
  }

  function isOpen() { return screenEl && !screenEl.classList.contains('hidden'); }

  /* ============================== ВИДЖЕТЫ ============================== */
  function tile(label, value, sub, cls) {
    return '<div class="dash-tile ' + (cls || '') + '">' +
      '<div class="tile-val">' + value + '</div>' +
      '<div class="tile-lab">' + esc(label) + '</div>' +
      (sub ? '<div class="tile-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function kpiRow(label, factStr, targetStr, status) {
    return '<tr><td>' + dot(status) + esc(label) + '</td>' +
      '<td class="kpi-fact">' + factStr + '</td>' +
      '<td class="kpi-tgt">' + esc(targetStr) + '</td></tr>';
  }

  /* Гейт доли рекламы 50/50: полоса 0–100% с целевой зоной 42–52% и маркером. */
  function shareGauge(share) {
    var p = Math.max(0, Math.min(1, share)) * 100;
    return '<div class="gauge">' +
      '<div class="gauge-band" style="left:42%;width:10%"></div>' +
      '<div class="gauge-mark" style="left:' + p.toFixed(1) + '%"></div>' +
      '<div class="gauge-mid" style="left:50%"></div>' +
      '</div>' +
      '<div class="gauge-legend"><span>0% реклама</span><span>цель 42–52%</span><span>100%</span></div>';
  }

  /* ============================== РЕНДЕР ============================== */
  function render() {
    if (!isOpen()) return;
    var M = window.Monetize;
    if (!M) { bodyEl.innerHTML = '<p class="dash-note">Модуль монетизации не подключён.</p>'; return; }
    var s = M.getStats();

    var geoEl = document.getElementById('dash-geo');
    if (geoEl) geoEl.textContent = '🌍 ' + (s.geo === 'tier1' ? 'Tier-1' : 'Tier-2/3');

    var html = '';

    /* --- Контролы: гео-переключатель, ивент, сброс, магазин --- */
    html += '<div class="dash-ctrl">';
    html += '<div class="ctrl-group"><span class="ctrl-lab">🌍 Гео (eCPM 06 §6.7):</span>' +
      '<button class="ctrl-btn ' + (s.geo === 'tier1' ? 'on' : '') + '" data-act="geo1">Tier-1</button>' +
      '<button class="ctrl-btn ' + (s.geo === 'tier23' ? 'on' : '') + '" data-act="geo23">Tier-2/3</button></div>';
    html += '<div class="ctrl-group"><span class="ctrl-lab">🎪 Ивент пт–вс:</span>' +
      '<button class="ctrl-btn ' + (s.event ? 'on' : '') + '" data-act="event">' + (s.event ? 'ВКЛ' : 'выкл') + '</button></div>';
    html += '<div class="ctrl-group">' +
      '<button class="ctrl-btn" data-act="store">💎 Магазин</button>' +
      '<button class="ctrl-btn" data-act="reset">↺ Сброс KPI</button></div>';
    html += '</div>';

    html += '<div class="sim-banner">⚠ СИМУЛЯЦИЯ: цифры сгенерированы локально по eCPM главы 06. ' +
            'DAU прототипа = 1 игрок, поэтому per-DAU метрики = суммам сессии.</div>';

    /* --- Крупные плитки выручки (ARPDAU сессии) --- */
    html += '<div class="dash-tiles">';
    html += tile('Ad ARPDAU', usd(s.adRev), s.totalImps + ' показов', 'ad');
    html += tile('IAP ARPDAU', usd(s.iapRev), s.purchases + ' покупок', 'iap');
    html += tile('Blended ARPDAU', usd(s.blended), 'цель $' + TARGET.blended.toFixed(2), 'sum');
    html += '</div>';

    /* --- Гейт 50/50 --- */
    html += '<div class="dash-card">';
    html += '<div class="dash-h">⚖ Доля рекламы в выручке ' +
      '<span class="hl ' + stBand(s.adShare, TARGET.adShare[0], TARGET.adShare[1]) + '">' +
      (s.blended > 0 ? pct(s.adShare) : '—') + '</span> ' +
      '<span class="dash-small">(здоровый гибрид 42–52%, 06 §6.9)</span></div>';
    html += shareGauge(s.blended > 0 ? s.adShare : 0.5);
    if (s.blended > 0 && s.adShare > 0.60) html += '<p class="dash-hint">Доля рекламы высока — полка/офферы недожаты. Симулируйте покупку в 💎 Магазине, чтобы вернуть баланс к 50/50.</p>';
    html += '</div>';

    /* --- KPI против целей 09 §9.3 --- */
    html += '<div class="dash-card"><div class="dash-h">🎯 KPI сессии против целей (база, 09 §9.3)</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Метрика</th><th>Факт</th><th>Цель</th></tr></thead><tbody>';
    html += kpiRow('Rewarded показов/DAU', n1(s.rewardedImps), n1(TARGET.rwPerDau), stHigher(s.rewardedImps, TARGET.rwPerDau));
    html += kpiRow('Interstitial/DAU', n1(s.intImps), n1(TARGET.intPerDau), stInt(s.intImps));
    html += kpiRow('eCPM rewarded', s.ecpmRw > 0 ? usd(s.ecpmRw) : '—', usd(TARGET.ecpmRw), s.ecpmRw > 0 ? stHigher(s.ecpmRw, TARGET.ecpmRw) : 'warn');
    html += kpiRow('eCPM interstitial', s.ecpmInt > 0 ? usd(s.ecpmInt) : '—', usd(TARGET.ecpmInt), s.ecpmInt > 0 ? stHigher(s.ecpmInt, TARGET.ecpmInt) : 'warn');
    html += kpiRow('Ad ARPDAU', usd(s.adRev), usd(TARGET.adArpdau), stHigher(s.adRev, TARGET.adArpdau));
    html += kpiRow('IAP ARPDAU', usd(s.iapRev), usd(TARGET.iapArpdau), stHigher(s.iapRev, TARGET.iapArpdau));
    html += kpiRow('ARPDAU blended', usd(s.blended), usd(TARGET.blended), stHigher(s.blended, TARGET.blended));
    html += kpiRow('Доля рекламы', s.blended > 0 ? pct(s.adShare) : '—', '42–52%', s.blended > 0 ? stBand(s.adShare, TARGET.adShare[0], TARGET.adShare[1]) : 'warn');
    html += kpiRow('Rewarded в ad-выручке', s.adRev > 0 ? pct(s.rewardedRevShare) : '—', '65–70%', s.adRev > 0 ? stBand(s.rewardedRevShare, TARGET.rwRevShare[0], TARGET.rwRevShare[1]) : 'warn');
    html += '</tbody></table></div>';
    html += '<p class="dash-small">Полосы: <span class="kpi-dot ok"></span>цель достигнута · <span class="kpi-dot warn"></span>близко · <span class="kpi-dot bad"></span>далеко. ' +
            'Ранняя сессия закономерно «жёлтая/красная» — метрики растут по мере показов/покупок.</p>';
    html += '</div>';

    /* --- Показы по плейсментам (06 §6.2) --- */
    html += '<div class="dash-card"><div class="dash-h">📺 Показы по плейсментам</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table plc"><thead><tr><th>Плейсмент</th><th>Показы</th><th>Выручка</th><th>eCPM*</th></tr></thead><tbody>';
    ['RW1', 'RW2', 'RW3', 'RW4', 'RW5', 'RW6', 'INT1'].forEach(function (pid) {
      var imps = s.imps[pid] || 0, rev = s.rev[pid] || 0;
      var ecpm = imps > 0 ? (rev / imps) * 1000 : 0;
      var name = M.MON.PLACEMENTS[pid].name;
      html += '<tr' + (imps > 0 ? ' class="has"' : '') + '><td><b>' + pid + '</b> ' + esc(name) + '</td>' +
        '<td>' + imps + '</td><td>' + (rev > 0 ? usd(rev) : '—') + '</td>' +
        '<td>' + (ecpm > 0 ? usd(ecpm) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="dash-small">* реализованный eCPM показа (выручка/показы×1000). Rewarded — доминанта по выручке (цель 65–70%).</p>';
    html += '</div>';

    /* --- Воронка рекламы (09 §9.2) --- */
    html += '<div class="dash-card"><div class="dash-h">🔻 Воронка рекламы (09 §9.2)</div>';
    html += '<div class="funnel">' +
      funStep('Возможности', s.opps) +
      funStep('Офферы', s.offers) +
      funStep('Старты', s.started) +
      funStep('Досмотры', s.completed) +
      '</div>';
    html += '<div class="dash-small">Отказов (ad_failed): <b>' + s.failed + '</b>. Completion: <b>' +
      (s.started > 0 ? pct(s.completed / s.started) : '—') + '</b> (бенчмарк rewarded 80–90%).</div>';
    // Причины блокировки interstitial (аудит правил 06 §6.3)
    var blk = s.blocks, keys = Object.keys(blk);
    if (keys.length) {
      html += '<div class="blk-wrap"><div class="dash-small">Пропуски показов (правила 06 §6.3):</div>';
      keys.forEach(function (k) { html += '<span class="blk-chip">' + esc(k) + ': ' + blk[k] + '</span>'; });
      html += '</div>';
    }
    html += '</div>';

    /* --- IAP / статусы плательщика --- */
    html += '<div class="dash-card"><div class="dash-h">💳 IAP и статусы</div>';
    html += '<div class="stat-line">Покупок за сессию: <b>' + s.purchases + '</b> · ' +
      'ARPPU (плательщик): <b>' + (s.purchases > 0 ? usd(s.arppu) : '—') + '</b> · ' +
      'Плательщик: <b>' + (s.payer ? 'да' : 'нет') + '</b></div>';
    html += '<div class="stat-line">Remove-ads: <b>' + (s.removeAds ? 'куплен ✓' : 'нет') + '</b> · ' +
      'Подписка: <b>' + (s.sub ? ('активна (мес ' + s.subMonth + ') ✓') : 'нет') + '</b> · ' +
      'Копилка: <b>' + (s.piggy.owned ? (Math.round(s.piggy.balance) + ' 💰') : 'нет') + '</b></div>';
    html += '<div class="stat-line dash-small">Lifetime (все сессии): реклама ' + usd(s.life.adRevenue) +
      ' · IAP ' + usd(s.life.iapRevenue) + '</div>';
    html += '</div>';

    /* --- Лента последних событий (§9.1) --- */
    html += '<div class="dash-card"><div class="dash-h">📜 Последние события трекинга</div><div class="evlog">';
    if (!EVLOG.length) {
      html += '<div class="dash-small">Пока пусто — сыграйте раздачу, посмотрите rewarded или откройте 💎 Магазин.</div>';
    } else {
      for (var i = EVLOG.length - 1; i >= 0 && i >= EVLOG.length - 14; i--) {
        var e = EVLOG[i];
        html += '<div class="ev-row"><span class="ev-name">' + esc(e.ev) + '</span>' +
          '<span class="ev-p">' + esc(evParams(e.p)) + '</span></div>';
      }
    }
    html += '</div></div>';

    html += '<p class="dash-foot">СИМУЛЯЦИЯ · Проход В · события 09 §9.1, KPI 09 §9.3, дашборд 09 §9.7.</p>';

    bodyEl.innerHTML = html;
  }

  function funStep(label, val) {
    return '<div class="fun-step"><div class="fun-val">' + val + '</div><div class="fun-lab">' + esc(label) + '</div></div>';
  }

  function evParams(p) {
    var keys = ['placement_id', 'sku', 'block_reason', 'ecpm_usd', 'price_usd', 'eligible', 'source_id', 'amount', 'result', 'state'];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (p[keys[i]] !== undefined && p[keys[i]] !== null) out.push(keys[i] + '=' + p[keys[i]]);
    }
    return out.slice(0, 3).join(' ');
  }

  /* ============================== ЖИВОЕ ОБНОВЛЕНИЕ ============================== */
  var renderScheduled = false;
  function scheduleRender() {
    if (!isOpen() || renderScheduled) return;
    renderScheduled = true;
    setTimeout(function () { renderScheduled = false; render(); }, 120);
  }

  /* ============================== ОТКРЫТИЕ/ЗАКРЫТИЕ ============================== */
  function open() {
    ensureDom();
    screenEl.classList.remove('hidden');
    document.body.classList.add('meta-open');
    render();
  }
  function close() {
    if (!screenEl) return;
    screenEl.classList.add('hidden');
    document.body.classList.remove('meta-open');
    if (window.Game && window.Game.syncHud) window.Game.syncHud();
  }

  function init() {
    ensureDom();
    var b = document.getElementById('btn-dash');
    if (b) b.addEventListener('click', open);
    if (window.Monetize && window.Monetize.subscribe) window.Monetize.subscribe(scheduleRender);
  }

  return { init: init, open: open, close: close, render: render };
})();
