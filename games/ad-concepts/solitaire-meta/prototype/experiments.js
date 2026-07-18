/* =============================================================================
 * Orchard Peaks — SOFT-LAUNCH COCKPIT (Проход Г): A/B + тюнинг + гейты go/no-go
 * -----------------------------------------------------------------------------
 * Слой поверх Проходов А+Б+В. Ничего не переписывает — добавляет кокпит soft launch
 * над детерминированным симулятором экономики (sim.js, приложение [12]). Три вкладки:
 *
 *   1) СИМУЛЯТОР   — прогон когорты (кап N ~400 в браузере, < 1 c) с рендером
 *                    монетного контура по дням, точки «Кошелька» и гейтов К1–К8 (§12.6).
 *   2) A/B + ТЮНИНГ— детерминированное назначение варианта по хешу session-id
 *                    ([09] §9.6); панель ручек (E(n), заказы, eCPM, earn-rate) с
 *                    сохранением в localStorage и сбросом «к значениям книги».
 *   3) ГЕЙТЫ       — вердикт go/iterate/kill по трём сценариям [09] §9.5:
 *                    коридор ARPDAU/LTV, точка дефицита в срок, ad-доля ~гибрид.
 *
 * Подключается в index.html ПОСЛЕ sim.js и analytics.js, ПЕРЕД game.js.
 * Крупные шрифты — ЦА 45+. Состояние — localStorage под префиксом orchardPeaks.*.
 * ========================================================================== */
'use strict';

window.Cockpit = (function () {

  var Sim = window.Sim;   // детерминированный симулятор из sim.js

  /* ============================ КЛЮЧИ ХРАНИЛИЩА ============================ */
  var K_TUNING   = 'orchardPeaks.tuning';    // ручные оверрайды параметров книги
  var K_SESSION  = 'orchardPeaks.abSession'; // session-id для A/B-хеша
  var K_SCENARIO = 'orchardPeaks.softScen';  // выбранный сценарий гейтов

  /* ============================ A/B-ЭКСПЕРИМЕНТЫ ([09] §9.6) ============================ */
  /* Каждый эксперимент — набор арм (вариантов) с патчем параметров симулятора.
   * Назначение арма детерминировано по хешу (session-id + ключ эксперимента). */
  var EXPERIMENTS = [
    { key: 'entry', name: 'Наклон взноса E(n)', metric: 'ARPDAU D30', guard: 'D14 retention', ref: '[09] §9.6 #4',
      arms: [
        { label: '1.010', patch: { entryGrowth: 1.010 } },
        { label: '1.012 · книга', patch: { entryGrowth: 1.012 } }
      ] },
    { key: 'order', name: 'Стоимость заказов сада ±20%', metric: 'заказов/день · LTV', guard: 'темп меты [04] §4.2', ref: '§12.4',
      arms: [
        { label: '−20%', patch: { orderCostMult: 0.8 } },
        { label: 'книга', patch: { orderCostMult: 1.0 } },
        { label: '+20%', patch: { orderCostMult: 1.2 } }
      ] },
    { key: 'rwh', name: 'Rewarded-урожай ×2 (RW3-лукошко)', metric: 'заказов/день · RW3-показы', guard: 'sink/source ≤ 1.2', ref: '[06] §6.2',
      arms: [
        { label: '×1 · выкл', patch: { rw3HarvestMult: 1 } },
        { label: '×2 · книга', patch: { rw3HarvestMult: 2 } }
      ] }
  ];

  /* ============================ ТЮНИНГ-РУЧКИ ============================ */
  /* Ключевые ручки remote config (§12.6 «вход в тюнинг до soft launch»). Значение
   * книги — из Sim.BOOK; редактируемое значение живёт в localStorage. */
  var KNOBS = [
    { key: 'entryBase',     label: 'E(n): база взноса',        step: 10,    min: 100,  max: 800,   help: 'E(n) = база·рост ([05] §5.2)' },
    { key: 'entryGrowth',   label: 'E(n): множитель роста',    step: 0.001, min: 1.005, max: 1.02, help: 'A/B #4: 1.010 / 1.012 / 1.015' },
    { key: 'wrPlateau',     label: 'WR: плато сложности',      step: 0.01,  min: 0.45, max: 0.62,  help: 'W(n)=плато+0.35·e^(−n/25) ([11] §11.5)' },
    { key: 'orderCostMult', label: 'Сад: стоимость заказов ×', step: 0.05,  min: 0.6,  max: 1.4,   help: 'рычаг Ф4 (темп заказов [04] §4.2)' },
    { key: 'missionMult',   label: 'Миссии: номинал ×',        step: 0.05,  min: 0.6,  max: 1.4,   help: 'рычаг Ф2 (высота карусели)' },
    { key: 'rw6Grant',      label: 'RW6: грант ×E(n)',         step: 0.1,   min: 0.4,  max: 1.2,   help: 'A/B #5: 0.6 / 0.8 / 1.0 ([06] §6.2)' },
    { key: 'rw3HarvestMult',label: 'RW3-лукошко: урожай ×',    step: 1,     min: 1,    max: 3,     help: 'A/B «rewarded-урожай ×2»' },
    { key: 'ecpmRewarded',  label: 'eCPM rewarded, $',         step: 0.5,   min: 3,    max: 25,    help: 'Tier-1 $16 / Tier-2-3 ~$5 ([06] §6.7)' },
    { key: 'ecpmInt',       label: 'eCPM interstitial, $',     step: 0.5,   min: 2,    max: 18,    help: 'Tier-1 $12 ([06] §6.7)' },
    { key: 'iapArpdau',     label: 'IAP ARPDAU (допущение), $',step: 0.01,  min: 0,    max: 0.4,   help: 'не симулируется — вход гейтов [09] §9.3' }
  ];

  /* ============================ СЦЕНАРИИ [09] §9.5 / §9.3 ============================ */
  var SCENARIOS = {
    pess: { name: 'Пессимист', d1: 0.35, d7: 0.12, d30: 0.055, arpdau: 0.12, adArpdau: 0.05, iapArpdau: 0.07, cpi: 2.60 },
    base: { name: 'База',      d1: 0.42, d7: 0.18, d30: 0.090, arpdau: 0.22, adArpdau: 0.10, iapArpdau: 0.12, cpi: 2.30 },
    opt:  { name: 'Оптимист',  d1: 0.48, d7: 0.23, d30: 0.130, arpdau: 0.32, adArpdau: 0.13, iapArpdau: 0.19, cpi: 2.00 }
  };
  /* Решающие правила soft launch ([09] §9.5). */
  var GO_RULE   = { d1: 0.40, d7: 0.16, arpdau: 0.17, roasD30: 0.45 };
  var KILL_RULE = { d7: 0.12, arpdau: 0.12 };

  /* ============================ УТИЛИТЫ ============================ */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function fin(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function usd(v) { return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)); }
  function pct(v) { return (v * 100).toFixed(0) + '%'; }
  function fmtCoins(n) {
    n = Math.round(n); var s = n < 0 ? '-' : '', a = Math.abs(n);
    if (a < 10000) return s + a;
    if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return s + (a / 1000000).toFixed(2) + 'M';
  }

  /* --- Хеш строки (FNV-1a 32-bit) для детерминированного назначения A/B --- */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ============================ SESSION-ID + НАЗНАЧЕНИЕ A/B ============================ */
  function getSessionId() {
    var sid = lsGet(K_SESSION);
    if (!sid) { sid = 'sess-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); lsSet(K_SESSION, sid); }
    return sid;
  }
  function setSessionId(sid) { lsSet(K_SESSION, sid || getSessionId()); }

  // Индекс арма эксперимента по хешу (session-id + ключ) → детерминирован и стабилен.
  function armIndex(sid, exp) { return hashStr(sid + ':' + exp.key) % exp.arms.length; }

  // Собирает патч параметров из назначенных арм всех экспериментов.
  function assignment(sid) {
    var out = { patch: {}, arms: {} };
    for (var i = 0; i < EXPERIMENTS.length; i++) {
      var exp = EXPERIMENTS[i], idx = armIndex(sid, exp), arm = exp.arms[idx];
      out.arms[exp.key] = { idx: idx, arm: arm };
      for (var k in arm.patch) if (arm.patch.hasOwnProperty(k)) out.patch[k] = arm.patch[k];
    }
    return out;
  }

  /* ============================ ТЮНИНГ (localStorage) ============================ */
  function loadTuning() {
    var raw = lsGet(K_TUNING);
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function saveTuning(t) { lsSet(K_TUNING, JSON.stringify(t)); }
  function resetTuning() { try { localStorage.removeItem(K_TUNING); } catch (e) { /* no-op */ } }
  function knobValue(key) {
    var t = loadTuning();
    if (t.hasOwnProperty(key)) return t[key];
    return Sim.BOOK[key];
  }

  /* Итоговые параметры прогона: книга → патч A/B выбранного session-id → ручной тюнинг.
   * Ручной тюнинг ПОБЕЖДАЕТ вариант A/B (сознательное переопределение оператором). */
  function effectiveParams(applyAB) {
    var over = {};
    if (applyAB) { var a = assignment(getSessionId()); for (var k in a.patch) over[k] = a.patch[k]; }
    var t = loadTuning();
    for (var k2 in t) if (t.hasOwnProperty(k2)) over[k2] = t[k2];
    return over;
  }

  /* ============================ ЮНИТ-ЭКОНОМИКА [09] §9.4 ============================ */
  function bFromRet(d1, d7) { return Math.log(d1 / d7) / Math.log(7); }
  function activeDays(T, d1, d7) {                       // A(T) = 1 + a/(1−b)·(T^(1−b) − 1)
    var a = d1, b = bFromRet(d1, d7);
    if (Math.abs(1 - b) < 1e-6) return 1 + a * Math.log(T);
    return 1 + a / (1 - b) * (Math.pow(T, 1 - b) - 1);
  }
  function ltv(T, sc) { return activeDays(T, sc.d1, sc.d7) * sc.arpdau; }
  function paybackDay(sc) {                              // min t: LTV(t) ≥ CPI
    for (var t = 1; t <= 400; t++) if (ltv(t, sc) >= sc.cpi) return t;
    return null;
  }

  /* ============================ ПРОГОН СИМУЛЯТОРА ============================ */
  var lastRun = null;         // кэш последнего прогона (для гейтов)
  function runSim(N, seed) {
    var over = effectiveParams(true);
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    var res = Sim.run({ N: N, days: 30, seed: seed, params: over });
    res._elapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
    lastRun = res;
    return res;
  }

  /* ============================ DOM / ЭКРАН ============================ */
  var screenEl, bodyEl, tab = 'sim', inited = false;

  function ensureDom() {
    if (screenEl) return;
    screenEl = document.createElement('div');
    screenEl.id = 'soft-screen';
    screenEl.className = 'hidden';
    screenEl.innerHTML =
      '<header id="soft-top">' +
        '<button id="soft-back" type="button">← Играть</button>' +
        '<div class="soft-title">🚀 Soft Launch · Проход Г</div>' +
        '<div class="soft-sid" id="soft-sid"></div>' +
      '</header>' +
      '<nav id="soft-tabs">' +
        '<button data-t="sim" class="active" type="button">🧮 Симулятор</button>' +
        '<button data-t="ab" type="button">🧪 A/B + тюнинг</button>' +
        '<button data-t="gates" type="button">🚦 Гейты go/no-go</button>' +
      '</nav>' +
      '<main id="soft-body"></main>';
    document.body.appendChild(screenEl);
    bodyEl = document.getElementById('soft-body');

    document.getElementById('soft-back').addEventListener('click', close);
    document.getElementById('soft-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-t]'); if (b) setTab(b.getAttribute('data-t'));
    });
    bodyEl.addEventListener('click', onBodyClick);
    bodyEl.addEventListener('change', onBodyChange);
    inited = true;
  }

  function setTab(name) {
    tab = name;
    var btns = document.querySelectorAll('#soft-tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-t') === tab);
    render();
  }
  function isOpen() { return screenEl && !screenEl.classList.contains('hidden'); }

  /* ============================ РЕНДЕР: ШАПКА SESSION-ID ============================ */
  function renderSidChip() {
    var el = document.getElementById('soft-sid');
    if (el) el.innerHTML = '🆔 ' + esc(getSessionId());
  }

  /* ============================ РЕНДЕР ============================ */
  function render() {
    renderSidChip();
    if (tab === 'sim') bodyEl.innerHTML = renderSimTab();
    else if (tab === 'ab') bodyEl.innerHTML = renderAbTab();
    else if (tab === 'gates') bodyEl.innerHTML = renderGatesTab();
    bodyEl.scrollTop = 0;
  }

  /* ---------------------------- ВКЛАДКА: СИМУЛЯТОР ---------------------------- */
  function renderSimTab() {
    var N = simN, seed = simSeed;
    var html = '';
    html += '<div class="sim-banner">🧮 Детерминированный симулятор экономики (приложение 12): ' +
            'N игроков × 30 дней монетного контура. Тот же seed → тот же результат бит-в-бит (I-E1). ' +
            'Запускается и здесь, и в node (<code>node sim.js</code>).</div>';

    html += '<div class="soft-ctrl">';
    html += '<div class="ctrl-group"><span class="ctrl-lab">👥 Игроков N:</span>' +
      '<input id="sim-n" class="soft-num" type="number" min="50" max="400" step="50" value="' + N + '"> ' +
      '<span class="dash-small">(кап 400 — прогон &lt; 1 c)</span></div>';
    html += '<div class="ctrl-group"><span class="ctrl-lab">🌱 Seed:</span>' +
      '<input id="sim-seed" class="soft-num" type="number" step="1" value="' + seed + '"></div>';
    html += '<div class="ctrl-group"><button class="soft-run" data-act="run-sim">▶ Прогнать когорту</button></div>';
    html += '</div>';

    // Активные оверрайды (A/B + тюнинг), чтобы было видно, что именно считаем.
    html += renderActiveOverrides();

    if (!lastRun) {
      html += '<div class="soft-card"><p class="dash-note">Нажмите «▶ Прогнать когорту» — появятся монетный контур по дням, ' +
              'точка «Кошелька» и контрольные точки К1–К8.</p></div>';
      return html;
    }

    var r = lastRun;
    // Крупные плитки итога.
    html += '<div class="dash-tiles">';
    html += tile(r.wallet.inWindow ? 'sum' : 'warn', 'Точка «Кошелька»', 'день ' + r.wallet.median,
      r.wallet.inWindow ? 'в окне 12–16 ✓' : 'вне окна 12–16');
    html += tile('ad', 'Пик баланса', 'день ' + r.peak.day, fmtCoins(r.peak.balance) + ' монет');
    html += tile(r.sinkSourceD14 >= 1.05 && r.sinkSourceD14 <= 1.15 ? 'sum' : 'warn', 'Sink/Source D14+',
      r.sinkSourceD14.toFixed(2), 'коридор 1.05–1.15');
    html += tile('iap', 'Ad-ARPDAU (сим)', usd(r.ad.adArpdau), r.ad.rewardedPerDau.toFixed(1) + ' rw + ' + r.ad.intPerDau.toFixed(1) + ' int /DAU');
    html += '</div>';

    // График баланса по дням.
    html += renderBalanceChart(r);

    // Таблица монетного контура.
    html += '<div class="soft-card"><div class="dash-h">💰 Монетный контур по дням (медианы когорты)</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr>' +
            '<th>День</th><th>Ур.</th><th>Баланс</th><th>Сальдо/день</th><th>Бал/E</th><th>Взнос E(n)</th></tr></thead><tbody>';
    var show = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 7: 1, 10: 1, 12: 1, 14: 1, 16: 1, 21: 1, 30: 1 };
    for (var i = 0; i < r.byDay.length; i++) {
      var d = r.byDay[i]; if (!show[d.day]) continue;
      var win = d.day >= 12 && d.day <= 16;
      html += '<tr' + (win ? ' class="wallet-win"' : '') + '><td>' + d.day + (win ? ' 🎯' : '') + '</td><td>' + d.medLevel + '</td>' +
        '<td class="kpi-fact">' + fmtCoins(d.medBalance) + '</td>' +
        '<td class="kpi-fact ' + (d.medSaldo >= 0 ? 'pos' : 'neg') + '">' + (d.medSaldo >= 0 ? '+' : '') + fmtCoins(d.medSaldo) + '</td>' +
        '<td class="kpi-fact">' + d.balInEntries.toFixed(1) + '</td><td class="kpi-tgt">' + fmtCoins(d.entry) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="dash-small">🎯 окно дня 12–16 — плановое первое денежное решение ([05] §5.4/§5.7). ' +
            'Сад: заказов/день <b>' + r.garden.ordersPerDay.toFixed(2) + '</b> · зона 1 к D7 у <b>' + pct(r.garden.zone1ByD7Pct) +
            '</b> когорты · реализация урожая <b>' + pct(r.harvestRealization) + '</b> номинала.</p>';
    html += '</div>';

    // Контрольные точки К1–К8.
    html += renderGateChecks(r);

    html += '<p class="dash-foot">Прогон N=' + r.meta.N + ' · seed=' + r.meta.seed +
            (r._elapsed ? ' · ' + Math.round(r._elapsed) + ' мс' : '') + ' · приложение 12 (§12.3 монетный контур, §12.6 валидация).</p>';
    return html;
  }

  function renderActiveOverrides() {
    var over = effectiveParams(true);
    var keys = Object.keys(over);
    if (!keys.length) return '<div class="soft-note">Активны параметры книги (без A/B-патча и тюнинга).</div>';
    var a = assignment(getSessionId());
    var chips = keys.map(function (k) {
      var src = (loadTuning().hasOwnProperty(k)) ? 'тюнинг' : 'A/B';
      return '<span class="ov-chip ' + (src === 'тюнинг' ? 'tune' : 'ab') + '">' + esc(k) + ' = ' + over[k] + ' <i>(' + src + ')</i></span>';
    });
    return '<div class="soft-note"><b>Активные оверрайды:</b> ' + chips.join(' ') + '</div>';
  }

  function renderGateChecks(r) {
    var gates = Sim.checkGates(r);
    var passed = 0, items = [];
    for (var i = 0; i < gates.length; i++) {
      var g = gates[i]; if (g.ok) passed++;
      items.push({ status: g.ok ? 'ok' : 'bad', id: g.id, name: g.name, target: g.target, fact: g.fact });
    }
    var html = '<div class="soft-card"><div class="dash-h">✅ Контрольные точки приёмки К1–К8 (§12.6)</div>';
    html += gateList(items);
    html += '<p class="dash-small">Пройдено <b>' + passed + '/' + gates.length + '</b>. ' +
            'К7 (высота карусели) и К8 (заказы) — известные находки Ф2/Ф4 приложения 12: их адресует тюнинг ' +
            '(миссии −15% ⇒ К7, стоимость заказов −20% ⇒ К8). Меняйте ручки во вкладке «A/B + тюнинг» и прогоняйте снова.</p>';
    html += '</div>';
    return html;
  }

  /* Список гейтов — устойчивый к узкому экрану (факт не уезжает за край, переносится). */
  function gateList(items) {
    var h = '<div class="gate-list">';
    for (var i = 0; i < items.length; i++) {
      var g = items[i];
      h += '<div class="gate-row ' + g.status + '">' +
        '<div class="gate-dot"></div>' +
        '<div class="gate-main"><div class="gate-name">' + (g.id ? ('<b>' + esc(g.id) + '</b> ') : '') + esc(g.name) + '</div>' +
        '<div class="gate-tgt">цель: ' + esc(g.target) + '</div></div>' +
        '<div class="gate-fact">' + esc(g.fact) + '</div></div>';
    }
    return h + '</div>';
  }

  /* График медианного баланса по дням: столбики, знак сальдо цветом, окно 12–16. */
  function renderBalanceChart(r) {
    var maxBal = 1;
    for (var i = 0; i < r.byDay.length; i++) maxBal = Math.max(maxBal, r.byDay[i].medBalance);
    var bars = '';
    for (var j = 0; j < r.byDay.length; j++) {
      var d = r.byDay[j];
      var h = Math.max(2, Math.round((d.medBalance / maxBal) * 150));
      var win = d.day >= 12 && d.day <= 16;
      var cls = 'bal-bar' + (d.medSaldo >= 0 ? ' up' : ' down') + (win ? ' win' : '') + (d.day === r.wallet.median ? ' wp' : '');
      var lab = (d.day === 1 || d.day % 5 === 0 || d.day === r.wallet.median) ? d.day : '';
      bars += '<div class="bal-col" title="день ' + d.day + ': ' + fmtCoins(d.medBalance) + ' (' + (d.medSaldo >= 0 ? '+' : '') + fmtCoins(d.medSaldo) + '/день)">' +
        '<div class="' + cls + '" style="height:' + h + 'px"></div>' +
        '<div class="bal-lab">' + lab + '</div></div>';
    }
    return '<div class="soft-card"><div class="dash-h">📉 Медианный баланс монет по дням (профицит → дефицит)</div>' +
      '<div class="bal-chart-wrap"><div class="bal-chart">' + bars + '</div></div>' +
      '<div class="chart-legend"><span class="lg up">▮ профицит дня</span>' +
      '<span class="lg down">▮ дефицит дня</span>' +
      '<span class="lg win">▮ окно «Кошелька» 12–16</span>' +
      '<span class="lg wp">▮ медианная точка «Кошелька» (день ' + r.wallet.median + ')</span></div></div>';
  }

  /* ---------------------------- ВКЛАДКА: A/B + ТЮНИНГ ---------------------------- */
  function renderAbTab() {
    var sid = getSessionId(), a = assignment(sid);
    var html = '';

    // Session-id + назначение.
    html += '<div class="soft-card"><div class="dash-h">🧪 A/B: назначение по хешу session-id ([09] §9.6)</div>';
    html += '<p class="dash-small">Вариант выбирается детерминированно: <code>arm = hash(session-id + «:» + эксперимент) mod число_арм</code>. ' +
            'Один игрок — стабильно один вариант; вариант виден в дашборде. Не более 3 непересекающихся тестов ([09] §9.6).</p>';
    html += '<div class="ctrl-group"><span class="ctrl-lab">🆔 session-id:</span>' +
      '<input id="ab-sid" class="soft-num wide" type="text" value="' + esc(sid) + '">' +
      '<button class="ctrl-btn" data-act="ab-apply-sid">Применить</button>' +
      '<button class="ctrl-btn" data-act="ab-new-sid">🎲 Новый</button></div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Эксперимент</th><th>Армы</th><th>Назначен</th><th>Метрика / гардрейл</th></tr></thead><tbody>';
    for (var i = 0; i < EXPERIMENTS.length; i++) {
      var exp = EXPERIMENTS[i], asn = a.arms[exp.key];
      var arms = exp.arms.map(function (arm, idx) {
        return '<span class="arm-chip' + (idx === asn.idx ? ' on' : '') + '">' + esc(arm.label) + '</span>';
      }).join(' ');
      html += '<tr><td><b>' + esc(exp.name) + '</b><br><span class="dash-small">' + esc(exp.ref) + '</span></td>' +
        '<td>' + arms + '</td><td class="kpi-fact">' + esc(asn.arm.label) + '</td>' +
        '<td class="dash-small">' + esc(exp.metric) + '<br>гардрейл: ' + esc(exp.guard) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="dash-small">Патч выбранного варианта накладывается на прогон симулятора и гейтов (ручной тюнинг ниже — побеждает).</p>';
    html += '</div>';

    // Тюнинг-панель.
    html += '<div class="soft-card"><div class="dash-h">🎛 Панель тюнинга (remote config)</div>';
    html += '<p class="dash-small">Ручки сохраняются в localStorage (префикс <code>orchardPeaks.</code>) и переопределяют книгу и A/B. ' +
            'Кнопка «сброс к книге» возвращает значения приложения 12 / глав 05–06.</p>';
    var tuning = loadTuning();
    html += '<div class="knob-grid">';
    for (var kk = 0; kk < KNOBS.length; kk++) {
      var kn = KNOBS[kk];
      var bookV = Sim.BOOK[kn.key];
      var curV = tuning.hasOwnProperty(kn.key) ? tuning[kn.key] : bookV;
      var changed = tuning.hasOwnProperty(kn.key) && tuning[kn.key] !== bookV;
      html += '<div class="knob' + (changed ? ' changed' : '') + '">' +
        '<label class="knob-lab" for="knob-' + kn.key + '">' + esc(kn.label) + (changed ? ' <span class="knob-dot">●</span>' : '') + '</label>' +
        '<input id="knob-' + kn.key + '" class="knob-inp" data-knob="' + kn.key + '" type="number" ' +
          'step="' + kn.step + '" min="' + kn.min + '" max="' + kn.max + '" value="' + curV + '">' +
        '<div class="knob-help">' + esc(kn.help) + ' · книга: <b>' + bookV + '</b></div>' +
        '</div>';
    }
    html += '</div>';
    html += '<div class="ctrl-group knob-actions">' +
      '<button class="soft-run" data-act="tune-save">💾 Сохранить тюнинг</button>' +
      '<button class="ctrl-btn" data-act="tune-reset">↺ Сброс к значениям книги</button></div>';
    html += '</div>';
    return html;
  }

  /* ---------------------------- ВКЛАДКА: ГЕЙТЫ ---------------------------- */
  function renderGatesTab() {
    var scen = lsGet(K_SCENARIO) || 'base';
    if (!SCENARIOS[scen]) scen = 'base';
    var sc = SCENARIOS[scen];

    var html = '';
    html += '<div class="sim-banner">🚦 Гейты soft launch ([09] §9.5): вердикт <b>go / iterate / kill</b> по трём сценариям. ' +
            'Симулятор проверяет экономическую готовность (точка дефицита в срок, коридоры), сценарий — юнит-экономику (ARPDAU/LTV/ROAS).</div>';

    // Выбор сценария.
    html += '<div class="soft-ctrl"><div class="ctrl-group"><span class="ctrl-lab">📈 Сценарий 180 дней:</span>';
    for (var key in SCENARIOS) {
      html += '<button class="ctrl-btn ' + (key === scen ? 'on' : '') + '" data-act="scen" data-scen="' + key + '">' + esc(SCENARIOS[key].name) + '</button>';
    }
    html += '</div>';
    // Пройдено iterate-циклов (kill наступает после 3, [09] §9.5).
    html += '<div class="ctrl-group"><span class="ctrl-lab">🔁 Циклов пройдено:</span>';
    for (var cy = 0; cy <= 3; cy++) {
      html += '<button class="ctrl-btn ' + (cy === cyclesSpent ? 'on' : '') + '" data-act="cycles" data-cy="' + cy + '">' + cy + '</button>';
    }
    html += '</div>';
    html += '<div class="ctrl-group"><button class="soft-run" data-act="run-gates">▶ Оценить когорту</button></div></div>';

    // Юнит-экономика сценария ([09] §9.4/§9.5).
    var b = bFromRet(sc.d1, sc.d7);
    var a180 = activeDays(180, sc.d1, sc.d7);
    var ltv180 = ltv(180, sc);
    var ltv30 = ltv(30, sc);
    var roasD7 = ltv(7, sc) / sc.cpi, roasD30 = ltv30 / sc.cpi, roasD180 = ltv180 / sc.cpi;
    var payback = paybackDay(sc);
    var adShare = sc.adArpdau / (sc.adArpdau + sc.iapArpdau);

    html += '<div class="soft-card"><div class="dash-h">💵 Юнит-экономика · сценарий «' + esc(sc.name) + '» (горизонт 180 дней)</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><tbody>';
    html += ueRow('D1 / D7 / D30 retention', pct(sc.d1) + ' / ' + pct(sc.d7) + ' / ' + pct(sc.d30));
    html += ueRow('b (степень кривой)', b.toFixed(3));
    html += ueRow('A(180), активных дней', a180.toFixed(1));
    html += ueRow('ARPDAU blended', usd(sc.arpdau) + '  (ad ' + usd(sc.adArpdau) + ' + IAP ' + usd(sc.iapArpdau) + ')');
    html += ueRow('LTV(30) / LTV(180)', usd(ltv30) + ' / ' + usd(ltv180));
    html += ueRow('LTV/CPI (CPI ' + usd(sc.cpi) + ')', (ltv180 / sc.cpi).toFixed(2));
    html += ueRow('ROAS D7 / D30 / D180', pct(roasD7) + ' / ' + pct(roasD30) + ' / ' + pct(roasD180));
    html += ueRow('Payback day', payback ? ('~D' + payback) : 'нет (стоп UA)');
    html += '</tbody></table></div></div>';

    // Экономическая готовность из симулятора.
    html += renderReadiness(sc, adShare);

    // Вердикт.
    html += renderVerdict(sc, roasD30, adShare);

    // Справка по правилам.
    html += '<div class="soft-card"><div class="dash-h">📖 Решающие правила ([09] §9.5)</div>' +
      '<div class="rule go">GO global: D1 ≥ 40% · D7 ≥ 16% · ARPDAU ≥ $0.17 · ROAS D30 ≥ 45% → масштабируем UA</div>' +
      '<div class="rule iter">ITERATE: D7 12–16% или ARPDAU $0.12–0.17 → 2–3 балансных цикла, ре-тест</div>' +
      '<div class="rule kill">KILL/pivot: D7 &lt; 12% при ARPDAU &lt; $0.12 после 3 циклов → не масштабируем</div>' +
      '</div>';
    return html;
  }

  function ueRow(k, v) { return '<tr><td>' + esc(k) + '</td><td class="kpi-fact">' + v + '</td></tr>'; }

  function renderReadiness(sc, adShare) {
    var r = lastRun;
    var html = '<div class="soft-card"><div class="dash-h">🧮 Экономическая готовность (симкогорта)</div>';
    if (!r) {
      html += '<p class="dash-note">Нажмите «▶ Оценить когорту» — симулятор проверит точку дефицита и коридоры.</p></div>';
      return html;
    }
    var checks = [
      { status: r.wallet.inWindow ? 'ok' : 'warn', name: 'Точка дефицита («Кошелёк») в окне 12–16', target: 'день 12–16', fact: 'день ' + r.wallet.median },
      { status: (r.sinkSourceD14 >= 1.05 && r.sinkSourceD14 <= 1.15) ? 'ok' : 'warn', name: 'Sink/Source D14+ (без RW)', target: '1.05–1.15', fact: r.sinkSourceD14.toFixed(2) },
      { status: (r.balD7Entries >= 8 && r.balD7Entries <= 15) ? 'ok' : 'warn', name: 'Баланс D7 во взносах', target: '8–15', fact: r.balD7Entries.toFixed(1) },
      { status: (adShare >= 0.42 && adShare <= 0.52) ? 'ok' : 'warn', name: 'Ad-доля в выручке ~ гибрид', target: '42–52%', fact: pct(adShare) },
      { status: (r.ad.adArpdau >= 0.05) ? 'ok' : 'warn', name: 'Ad-ARPDAU сим ≥ пол (медианный неплательщик)', target: '≥ $0.05', fact: usd(r.ad.adArpdau) }
    ];
    html += gateList(checks);
    html += '<p class="dash-small">Ad-ARPDAU симулятора ($' + r.ad.adArpdau.toFixed(3) + ') — консервативный пол медианного неплательщика; ' +
            'целевой ad-ARPDAU когорты $0.10 включает все 6 плейсментов, ивенты и вовлечённых игроков ([09] §9.3, находка Ф1).</p></div>';
    return html;
  }

  function renderVerdict(sc, roasD30, adShare) {
    var r = lastRun;
    var reasons = [];
    // Экономическая готовность (из симулятора) — предусловие GO. Без прогона (r == null)
    // готовность НЕ подтверждена → econOk=false, GO невозможен (падаем в ITERATE).
    var econOk = !!r;
    if (r) {
      if (!r.wallet.inWindow) { econOk = false; reasons.push('точка дефицита вне окна 12–16 (день ' + r.wallet.median + ')'); }
      if (!(r.sinkSourceD14 >= 1.0 && r.sinkSourceD14 <= 1.20)) { econOk = false; reasons.push('sink/source вне [1.0–1.20] (' + r.sinkSourceD14.toFixed(2) + ')'); }
    } else {
      reasons.push('симулятор не прогнан — экономическая готовность не проверена');
    }
    var goMet = sc.d1 >= GO_RULE.d1 && sc.d7 >= GO_RULE.d7 && sc.arpdau >= GO_RULE.arpdau && roasD30 >= GO_RULE.roasD30;
    var killMet = sc.d7 < KILL_RULE.d7 && sc.arpdau < KILL_RULE.arpdau;                 // прямой kill
    // «Застряли в iterate»: не дотягиваем до GO и сидим у пола iterate (D7 ≤ 16% и ARPDAU ≤ $0.17).
    var stuckIterate = !goMet && sc.d7 <= GO_RULE.d7 && sc.arpdau <= GO_RULE.arpdau;

    var verdict, cls, headline;
    if (killMet || (stuckIterate && cyclesSpent >= 3)) {
      verdict = 'KILL / PIVOT'; cls = 'kill';
      headline = killMet
        ? ('D7 ' + pct(sc.d7) + ' < 12% при ARPDAU ' + usd(sc.arpdau) + ' < $0.12 — пессимистический сценарий подтверждён.')
        : ('3 балансных цикла исчерпаны, сценарий не вышел из iterate-зоны (D7 ' + pct(sc.d7) + ', ARPDAU ' + usd(sc.arpdau) + ') — проект не масштабируется ([09] §9.5).');
    } else if (goMet && econOk) {
      verdict = 'GO GLOBAL'; cls = 'go';
      headline = 'Все пороги пройдены и экономика готова — масштабируем UA.';
    } else {
      verdict = 'ITERATE'; cls = 'iter';
      var miss = [];
      if (sc.d1 < GO_RULE.d1) miss.push('D1 ' + pct(sc.d1) + ' < 40%');
      if (sc.d7 < GO_RULE.d7) miss.push('D7 ' + pct(sc.d7) + ' < 16%');
      if (sc.arpdau < GO_RULE.arpdau) miss.push('ARPDAU ' + usd(sc.arpdau) + ' < $0.17');
      if (roasD30 < GO_RULE.roasD30) miss.push('ROAS D30 ' + pct(roasD30) + ' < 45%');
      if (goMet && !econOk) miss.push('экономика не готова (см. ниже)');
      headline = (miss.length ? ('Не дотягивают: ' + miss.join(', ') + '. ') : '') +
                 'Цикл ' + (cyclesSpent + 1) + ' из 3 — тюнинг Ф2/Ф4, затем ре-тест (kill после 3).';
    }

    var html = '<div class="verdict ' + cls + '">';
    html += '<div class="verdict-badge">' + verdict + '</div>';
    html += '<div class="verdict-head">Сценарий «' + esc(sc.name) + '»: ' + esc(headline) + '</div>';
    html += '<div class="verdict-grid">' +
      vcell('D1', pct(sc.d1), sc.d1 >= GO_RULE.d1) +
      vcell('D7', pct(sc.d7), sc.d7 >= GO_RULE.d7) +
      vcell('ARPDAU', usd(sc.arpdau), sc.arpdau >= GO_RULE.arpdau) +
      vcell('ROAS D30', pct(roasD30), roasD30 >= GO_RULE.roasD30) +
      vcell('ad-доля', pct(adShare), adShare >= 0.42 && adShare <= 0.52) +
      vcell('дефицит в срок', r ? ('D' + r.wallet.median) : '—', r ? r.wallet.inWindow : false) +
      '</div>';
    if (reasons.length) html += '<div class="verdict-note">⚠ ' + reasons.map(esc).join(' · ') + '</div>';
    html += '</div>';
    return html;
  }

  function vcell(k, v, ok) {
    return '<div class="vcell ' + (ok ? 'ok' : 'no') + '"><div class="vc-k">' + esc(k) + '</div><div class="vc-v">' + esc(v) + '</div></div>';
  }

  /* ============================ ВИДЖЕТЫ ============================ */
  function tile(cls, label, value, sub) {
    return '<div class="dash-tile ' + cls + '"><div class="tile-val">' + value + '</div>' +
      '<div class="tile-lab">' + esc(label) + '</div><div class="tile-sub">' + esc(sub) + '</div></div>';
  }
  function dot(status) { return '<span class="kpi-dot ' + status + '"></span>'; }

  /* ============================ СОСТОЯНИЕ ВКЛАДОК ============================ */
  var simN = 300, simSeed = 1000;
  var cyclesSpent = 0;   // пройдено iterate-циклов soft launch (kill после 3, §9.5)

  /* ============================ СОБЫТИЯ ============================ */
  function onBodyClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');

    if (act === 'run-sim') {
      var nEl = document.getElementById('sim-n'), sEl = document.getElementById('sim-seed');
      simN = Math.max(50, Math.min(400, Math.round(fin(parseFloat(nEl && nEl.value), 300))));
      simSeed = Math.round(fin(parseFloat(sEl && sEl.value), 1000));
      runSim(simN, simSeed);
      render();
    } else if (act === 'tune-save') {
      saveKnobsFromDom();
      render();
    } else if (act === 'tune-reset') {
      resetTuning();
      render();
    } else if (act === 'ab-apply-sid') {
      var el = document.getElementById('ab-sid');
      if (el && el.value.trim()) { setSessionId(el.value.trim()); lastRun = null; render(); }
    } else if (act === 'ab-new-sid') {
      try { localStorage.removeItem(K_SESSION); } catch (e) {}
      getSessionId(); lastRun = null; render();
    } else if (act === 'scen') {
      lsSet(K_SCENARIO, b.getAttribute('data-scen')); render();
    } else if (act === 'cycles') {
      cyclesSpent = Math.max(0, Math.min(3, parseInt(b.getAttribute('data-cy'), 10) || 0)); render();
    } else if (act === 'run-gates') {
      runSim(simN, simSeed); render();
    }
  }

  function onBodyChange(ev) {
    // Живой индикатор «изменено» на ручках (без сохранения — сохранение по кнопке).
    var t = ev.target;
    if (t && t.classList && t.classList.contains('knob-inp')) {
      var knob = t.closest('.knob');
      if (knob) knob.classList.add('changed');
    }
  }

  function saveKnobsFromDom() {
    var t = loadTuning();
    var inputs = document.querySelectorAll('.knob-inp');
    for (var i = 0; i < inputs.length; i++) {
      var key = inputs[i].getAttribute('data-knob');
      var v = parseFloat(inputs[i].value);
      var bookV = Sim.BOOK[key];
      if (!isFinite(v)) { delete t[key]; continue; }
      if (v === bookV) delete t[key];   // равно книге → не храним оверрайд
      else t[key] = v;
    }
    saveTuning(t);
    lastRun = null;   // параметры изменились — прошлый прогон недействителен
  }

  /* ============================ ОТКРЫТИЕ / ЗАКРЫТИЕ ============================ */
  function open() {
    ensureDom();
    screenEl.classList.remove('hidden');
    document.body.classList.add('meta-open');
    render();
    try { if (window.Analytics) window.Analytics.track('screen_open', { screen: 'soft:' + tab }); } catch (e) {}
  }
  function close() {
    if (!screenEl) return;
    screenEl.classList.add('hidden');
    document.body.classList.remove('meta-open');
    if (window.Game && window.Game.syncHud) window.Game.syncHud();
  }

  function init() {
    if (!Sim) { try { console.warn('[cockpit] sim.js не подключён — кокпит недоступен'); } catch (e) {} return; }
    ensureDom();
    var btn = document.getElementById('btn-soft');
    if (btn) btn.addEventListener('click', open);
    getSessionId();   // гарантируем session-id при первом заходе
  }

  return {
    init: init, open: open, close: close,
    /* публично — для отладки/тестов */
    assignment: assignment, effectiveParams: effectiveParams, runSim: runSim,
    SCENARIOS: SCENARIOS, EXPERIMENTS: EXPERIMENTS
  };
})();
