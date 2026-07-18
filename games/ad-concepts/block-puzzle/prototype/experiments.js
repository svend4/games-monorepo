/* =============================================================================
 * Block Surge — SOFT-LAUNCH COCKPIT (Проход Г): A/B + тюнинг + гейты
 * -----------------------------------------------------------------------------
 * Кокпит поверх симулятора экономики (sim.js). Три блока:
 *   1) A/B-фреймворк — пул из 3 экспериментов, ДЕТЕРМИНИРОВАННОЕ назначение
 *      варианта по хешу session-id (тот же fnv1a32, что в sim.js), вариант виден
 *      в кокпите и в дашборде монетизации. Кнопка «сравнить A/B» гоняет оба
 *      варианта и показывает дельту первичной метрики (09 §6-дисциплина).
 *   2) Панель тюнинга ручек — W_HARD-сложность, ad-капы, COIN_*-earn-rate, eCPM;
 *      значения редактируются, сохраняются в localStorage (префикс игры
 *      'blocksurge_softlaunch') и сбрасываются «к значениям книги» (baseline 12).
 *   3) Гейты go/iterate/kill — оценка симулированной когорты против kill/scale-
 *      критериев 09 §5.4 (D1/D7 retention-прокси, ad-ARPDAU, D7 ROAS) с вердиктом
 *      и жёстким лимитом «≤2 iterate-цикла» (10 P7).
 *
 * ⚠️  Кокпит — офлайн-инструмент прод-команды. В саму игру он НЕ вмешивается:
 *     не трогает ядро/экономику/монетизацию/сейв игры, только читает Sim и пишет
 *     свои настройки в отдельный ключ localStorage. Русский UI.
 *
 * Подключается ПОСЛЕ sim.js и ПЕРЕД game.js. Совместим с node --check (весь
 * DOM-код — за guard'ом typeof document).
 * ========================================================================== */
'use strict';

window.Experiments = (function () {

  var Sim = (typeof window !== 'undefined') ? window.Sim : null;
  var STORAGE_KEY = 'blocksurge_softlaunch';

  /* ========================= РУЧКИ ТЮНИНГА (панель) =====================
   * key совпадает с ключом tune симулятора (sim.js BOOK_TUNE); ecpm.* —
   * вложенные. book — «значение книги» (калиброванный baseline), к которому
   * возвращает «сброс». Группы — для вёрстки. */
  var KNOBS = [
    { key: 'W_HARD', group: 'Сложность', label: 'W_HARD (сложность hard-сегмента 21–60)',
      min: 0.6, max: 1.4, step: 0.05, hint: '×fail в сегменте 21–60 (09 §6 тест №7)' },
    { key: 'intPerDau', group: 'Реклама: капы', label: 'INT-кап / DAU (interstitial)',
      min: 3, max: 10, step: 0.5, hint: 'показы interstitial на DAU (09 §4, cap 06 §3)' },
    { key: 'bannerPerDau', group: 'Реклама: капы', label: 'Banner / DAU',
      min: 10, max: 50, step: 1, hint: 'показы баннера на DAU (09 §4)' },
    { key: 'rw2Cap', group: 'Реклама: капы', label: 'RW-2 cap / день',
      min: 1, max: 5, step: 1, hint: 'дневной кап «×2 монеты» (06 §2.2)' },
    { key: 'missionsEV', group: 'Earn-rate (COIN_*)', label: 'COIN миссии EV / день',
      min: 0, max: 80, step: 5, hint: 'свободный EV daily-миссий (12 §5.2)' },
    { key: 'weeklyBundleEV', group: 'Earn-rate (COIN_*)', label: 'COIN недельный бандл EV',
      min: 60, max: 260, step: 10, hint: 'weekly + турнир, всплеск дни 7/14/21/28' },
    { key: 'boosterScale', group: 'Earn-rate (COIN_*)', label: 'Спрос на бустеры (sink scale)',
      min: 0.6, max: 2.4, step: 0.05, hint: 'общий множитель расхода на бустеры' },
    { key: 'rw2Mult', group: 'Earn-rate (COIN_*)', label: 'RW-2 множитель монет',
      min: 1.5, max: 3.5, step: 0.5, hint: '«×2 монеты» — множитель награды (09 §6 №6)' },
    { key: 'startGrant', group: 'Earn-rate (COIN_*)', label: 'COIN стартовый грант',
      min: 100, max: 400, step: 50, hint: 'FTUE-баланс на старте (05 §3)' },
    { key: 'ecpm.rw', group: 'eCPM (06 §4)', label: 'eCPM rewarded, $',
      min: 4, max: 20, step: 0.5, hint: 'rewarded, $ за 1000 показов' },
    { key: 'ecpm.int', group: 'eCPM (06 §4)', label: 'eCPM interstitial, $',
      min: 3, max: 18, step: 0.5, hint: 'interstitial, $ за 1000 показов' },
    { key: 'ecpm.banner', group: 'eCPM (06 §4)', label: 'eCPM banner, $',
      min: 0.1, max: 1.0, step: 0.05, hint: 'banner, $ за 1000 показов' }
  ];

  /* ============================ ПУЛ A/B (09 §6) =========================
   * variants[0] — контроль. over — переопределения ручек симулятора.
   * primary — первичная метрика; guardrail — сторож. */
  var EXPERIMENTS = [
    {
      id: 'int_cap', name: 'Стартовый interstitial-кап',
      primary: 'ad-ARPDAU', guardrail: 'D7 retention (−1.5 п.п. max)',
      variants: [
        { id: 'A', label: '7 / день (контроль)', over: { intPerDau: 7 } },
        { id: 'B', label: '5 / день', over: { intPerDau: 5 } }
      ]
    },
    {
      id: 'rw2_mult', name: 'RW-2 множитель монет',
      primary: 'RW-охват + инфляция', guardrail: 'earn/spend коридор 0.95–1.15',
      variants: [
        { id: 'A', label: '×2 (контроль)', over: { rw2Mult: 2 } },
        { id: 'B', label: '×3', over: { rw2Mult: 3 } }
      ]
    },
    {
      id: 'start_grant', name: 'Стартовый баланс',
      primary: 'D1 / ранняя воронка трат', guardrail: 'инфляция баланса D30',
      variants: [
        { id: 'A', label: '200 монет (контроль)', over: { startGrant: 200 } },
        { id: 'B', label: '300 монет', over: { startGrant: 300 } }
      ]
    }
  ];

  /* ==================== СЦЕНАРИИ УДЕРЖАНИЯ (09 §5.2) ====================
   * Дневные D1..D7 для LT7 гейтов. base — 09 §5.1 (LT7 = 2.66). */
  var RET_SCENARIOS = {
    pess:  { label: 'Пессимист', daily: [32, 26, 22, 19, 16, 13, 11], d1: 32, d7: 11 },
    base:  { label: 'База',      daily: [38, 30, 25, 22, 19, 17, 15], d1: 38, d7: 15 },
    optim: { label: 'Оптимист',  daily: [45, 37, 31, 27, 24, 22, 20], d1: 45, d7: 20 }
  };

  /* Kill/iterate/scale-пороги (09 §5.4). */
  var GATES = {
    d1:       { kill: 30, scale: 38, unit: '%', higher: true, label: 'D1 retention' },
    d7:       { kill: 9,  scale: 15, unit: '%', higher: true, label: 'D7 retention' },
    adArpdau: { kill: 0.06, scale: 0.10, unit: '$', higher: true, label: 'Ad ARPDAU (T1-когорты)' },
    roas7:    { kill: 20, scale: 40, unit: '%', higher: true, label: 'D7 ROAS' }
  };
  var MAX_ITERATE = 2;   // 10 P7: не более двух iterate-циклов

  /* ============================== ХРАНИЛИЩЕ ============================= */

  function defaults() {
    return {
      v: 1,
      sessionId: '',
      tune: {},           // переопределения ручек поверх baseline
      retScenario: 'base',
      cpi: 0.90,          // 09 §5.2 база
      iapArpdau: 0.045,   // 09 §4
      iterateCount: 0,    // сколько iterate-циклов уже пройдено (10 P7)
      simN: 300,
      applyAB: false      // применять ли назначенные A/B-варианты к главному прогону
                          // (по умолчанию нет — главная таблица валидирует чистый baseline vs 05 §4)
    };
  }
  function loadState() {
    var s = defaults();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        for (var k in s) if (p[k] !== undefined) s[k] = p[k];
        if (!p.tune || typeof p.tune !== 'object') s.tune = {};
      }
    } catch (e) { s = defaults(); }
    if (!s.sessionId) s.sessionId = genSessionId();
    return s;
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* no-op */ }
  }
  // Стабильный per-install id. Единственная точка «случайности» — при ПЕРВОЙ
  // генерации; дальше он фиксирован (в localStorage), поэтому A/B детерминирован.
  function genSessionId() {
    var t = (typeof Date !== 'undefined') ? Date.now() : 0;
    var r = (typeof Math !== 'undefined') ? Math.floor(Math.random() * 1e9) : 0;
    return 's' + t.toString(36) + r.toString(36);
  }

  var state = (typeof localStorage !== 'undefined') ? loadState() : defaults();
  if (!state.sessionId) state.sessionId = 'headless';

  /* ============================ A/B-НАЗНАЧЕНИЕ =========================
   * variant = fnv1a32(sessionId + ':' + expId) % nVariants — детерминировано. */
  function hash32(str) {
    if (Sim && Sim.fnv1a32) return Sim.fnv1a32(str);
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function assignedVariant(exp) {
    var idx = hash32(state.sessionId + ':' + exp.id) % exp.variants.length;
    return exp.variants[idx];
  }
  function getAssignments() {
    return EXPERIMENTS.map(function (exp) {
      var v = assignedVariant(exp);
      return { exp: exp.id, name: exp.name, variant: v.id, label: v.label };
    });
  }
  // Строка ab_groups для дашборда/событий (09 §1.2).
  function abGroupsString() {
    return EXPERIMENTS.map(function (exp) { return exp.id + '=' + assignedVariant(exp).id; }).join(', ');
  }

  /* ============ ЭФФЕКТИВНЫЙ TUNE = book + A/B + ручной тюнинг ===========
   * Приоритет: назначенные A/B-варианты → ручной тюнинг (последний важнее). */
  function buildOverrides() {
    var over = {};
    // A/B: применяем назначенные варианты, только если включён тумблер applyAB.
    if (state.applyAB) EXPERIMENTS.forEach(function (exp) {
      applyOver(over, assignedVariant(exp).over);
    });
    // ручной тюнинг поверх.
    applyOver(over, state.tune);
    return over;
  }
  function applyOver(dst, src) {
    if (!src) return;
    for (var k in src) {
      if (k === 'ecpm') { dst.ecpm = dst.ecpm || {}; for (var e in src.ecpm) dst.ecpm[e] = src.ecpm[e]; }
      else dst[k] = src[k];
    }
  }
  // knob key 'ecpm.rw' → значение из объекта overrides/baseline.
  function knobValue(key) {
    var over = buildOverrides();
    var book = Sim ? Sim.BOOK_TUNE : {};
    if (key.indexOf('ecpm.') === 0) {
      var sub = key.split('.')[1];
      var o = over.ecpm || {};
      return (o[sub] !== undefined) ? o[sub] : (book.ecpm ? book.ecpm[sub] : 0);
    }
    return (over[key] !== undefined) ? over[key] : book[key];
  }
  function bookValue(key) {
    var book = Sim ? Sim.BOOK_TUNE : {};
    if (key.indexOf('ecpm.') === 0) { var sub = key.split('.')[1]; return book.ecpm ? book.ecpm[sub] : 0; }
    return book[key];
  }
  // Записать ручную правку ручки в state.tune.
  function setKnob(key, val) {
    val = parseFloat(val);
    if (!isFinite(val)) return;
    if (key.indexOf('ecpm.') === 0) {
      var sub = key.split('.')[1];
      state.tune.ecpm = state.tune.ecpm || {};
      state.tune.ecpm[sub] = val;
    } else state.tune[key] = val;
    saveState();
  }
  function resetKnob(key) {
    if (key.indexOf('ecpm.') === 0) {
      if (state.tune.ecpm) delete state.tune.ecpm[key.split('.')[1]];
    } else delete state.tune[key];
    saveState();
  }
  function resetAll() { state.tune = {}; saveState(); }
  function isKnobEdited(key) {
    if (key.indexOf('ecpm.') === 0) { var sub = key.split('.')[1]; return !!(state.tune.ecpm && state.tune.ecpm[sub] !== undefined); }
    return state.tune[key] !== undefined;
  }

  /* ============================ ПРОГОН СИМУЛЯТОРА ======================= */
  var lastSummary = null;    // SURVIVOR-сводка (для таблицы баланса)
  var lastCohort = null;     // COHORT-сводка (для метрик на DAU / гейтов)

  function runSim() {
    if (!Sim) return null;
    var over = buildOverrides();
    var N = state.simN || 300;
    lastSummary = Sim.run({ N: N, days: 30, runId: 'cockpit:' + state.sessionId, mode: 'SURVIVOR', tune: over });
    lastCohort = Sim.run({ N: N, days: 30, runId: 'cockpit:' + state.sessionId, mode: 'COHORT', tune: over });
    return lastSummary;
  }

  /* ============================ ГЕЙТЫ (09 §5.4) ========================= */

  function computeGates() {
    var sc = RET_SCENARIOS[state.retScenario] || RET_SCENARIOS.base;
    var lt7 = 1; for (var i = 0; i < 7; i++) lt7 += sc.daily[i] / 100;   // LT7 = 1 + Σ r(1..7)
    var adArpdau = lastCohort ? lastCohort.aggregates.adArpdau : 0;
    var blended = adArpdau + (state.iapArpdau || 0);
    var ltv7 = lt7 * blended;
    var cpi = state.cpi || 0.90;
    var roas7 = cpi > 0 ? ltv7 / cpi * 100 : 0;

    var metrics = {
      d1:       { value: sc.d1 },
      d7:       { value: sc.d7 },
      adArpdau: { value: adArpdau },
      roas7:    { value: roas7 }
    };
    var verdicts = {};
    var worst = 'scale';  // scale < iterate < kill (по «худшести»)
    var rank = { scale: 0, iterate: 1, kill: 2 };
    for (var key in GATES) {
      var g = GATES[key], v = metrics[key].value, band;
      if (v < g.kill) band = 'kill';
      else if (v < g.scale) band = 'iterate';
      else band = 'scale';
      verdicts[key] = band;
      if (rank[band] > rank[worst]) worst = band;
    }
    // Красные флаги дизайна из симулятора могут удержать от scale (12 §8.4).
    var flags = lastSummary ? lastSummary.flags : [];
    if (worst === 'scale' && flags.length) worst = 'iterate';

    return {
      scenario: sc, lt7: lt7, adArpdau: adArpdau, blended: blended, ltv7: ltv7, cpi: cpi, roas7: roas7,
      metrics: metrics, verdicts: verdicts, verdict: worst, flags: flags,
      iterateCount: state.iterateCount, iterateLimit: MAX_ITERATE
    };
  }

  /* ================================ РЕНДЕР ============================== */

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(v, d) { return Number(v).toFixed(d === undefined ? 2 : d); }

  function renderAB() {
    var h = '<div class="ckSection"><h4>A/B-эксперименты · session <code>' + esc(state.sessionId) + '</code></h4>';
    h += '<p class="ckNote">Назначение варианта — детерминировано по хешу session-id (fnv1a32). '
      + 'Одна и та же сессия всегда получает те же варианты; они видны и в дашборде монетизации.</p>';
    EXPERIMENTS.forEach(function (exp) {
      var assigned = assignedVariant(exp);
      h += '<div class="ckExp">';
      h += '<div class="ckExpTop"><b>' + esc(exp.name) + '</b>'
        + '<span class="ckExpId">' + esc(exp.id) + '</span></div>';
      h += '<div class="ckExpMeta">Первичная: ' + esc(exp.primary) + ' · Guardrail: ' + esc(exp.guardrail) + '</div>';
      h += '<div class="ckVariants">';
      exp.variants.forEach(function (vr) {
        var on = vr.id === assigned.id;
        h += '<span class="ckVar' + (on ? ' active' : '') + '">' + (on ? '● ' : '○ ')
          + esc(vr.id) + ': ' + esc(vr.label) + '</span>';
      });
      h += '</div>';
      h += '<button type="button" class="ghostBtn ckCompareBtn" data-exp="' + exp.id + '">⚖ Сравнить A/B (гонит оба)</button>';
      h += '<div class="ckCompareOut" id="ckCmp_' + exp.id + '"></div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function renderTuning() {
    var h = '<div class="ckSection"><h4>Панель тюнинга ручек <span class="simTag">localStorage</span></h4>';
    h += '<p class="ckNote">Правки сохраняются локально и применяются к симулятору. «Книга» — калиброванный '
      + 'baseline (12 §8). Изменённые ручки подсвечены; «сброс» возвращает к книге. Номиналы (цены, награды, '
      + 'капы rewarded) НЕ тюнятся — это решения глав 05/06 (INV-E1).</p>';
    var groups = {}; var order = [];
    KNOBS.forEach(function (kn) { if (!groups[kn.group]) { groups[kn.group] = []; order.push(kn.group); } groups[kn.group].push(kn); });
    order.forEach(function (gname) {
      h += '<div class="ckGroup"><div class="ckGroupName">' + esc(gname) + '</div>';
      groups[gname].forEach(function (kn) {
        var val = knobValue(kn.key), book = bookValue(kn.key), edited = isKnobEdited(kn.key);
        h += '<div class="ckKnob' + (edited ? ' edited' : '') + '">';
        h += '<div class="ckKnobLbl">' + esc(kn.label) + '<span class="ckKnobHint">' + esc(kn.hint) + '</span></div>';
        h += '<div class="ckKnobCtl">';
        h += '<input type="range" class="ckRange" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max
          + '" step="' + kn.step + '" value="' + val + '">';
        h += '<input type="number" class="ckNum" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max
          + '" step="' + kn.step + '" value="' + val + '">';
        h += '<span class="ckBook">книга ' + book + '</span>';
        h += '<button type="button" class="ckResetOne" data-knob="' + kn.key + '"' + (edited ? '' : ' disabled') + '>↺</button>';
        h += '</div></div>';
      });
      h += '</div>';
    });
    h += '<button type="button" class="ghostBtn" id="ckResetAll">↺ Сбросить все ручки к книге</button>';
    h += '</div>';
    return h;
  }

  function renderRunControls() {
    var h = '<div class="ckSection"><h4>Прогон симулятора</h4>';
    h += '<p class="ckNote">Браузер: N=' + (state.simN) + ' игроков × 30 дней, <1 c. Node: '
      + '<code>node sim.js</code> печатает ту же сводку в stdout. runId привязан к session-id — прогон воспроизводим.</p>';
    h += '<div class="ckRunRow">';
    h += '<label class="ckNlabel">N игроков: <input type="range" id="ckN" min="100" max="400" step="50" value="' + state.simN + '">'
      + '<b id="ckNval">' + state.simN + '</b></label>';
    h += '<button type="button" id="ckRunBtn" class="ckRunBtn">▶ Прогнать симуляцию</button>';
    h += '</div>';
    h += '<label class="ckNlabel ckAbToggle"><input type="checkbox" id="ckApplyAB"' + (state.applyAB ? ' checked' : '')
      + '> применять назначенные A/B-варианты к прогону (' + esc(abGroupsString()) + ')</label>';
    h += '</div>';
    return h;
  }

  function renderResults() {
    if (!lastSummary) return '<div class="ckSection"><h4>Результаты симуляции</h4>'
      + '<p class="ckNote">Нажми «Прогнать симуляцию» — здесь появится кривая баланса против 05 §4, '
      + 'точки дефицита, ARPDAU и доля sinks.</p></div>';
    var s = lastSummary, ag = s.aggregates, cal = s.calibration;
    var h = '<div class="ckSection"><h4>Баланс BASE×CORE по дням vs таблица 05 §4</h4>';
    h += '<div class="ckTableWrap"><table class="ckTable"><thead><tr>'
      + '<th>день</th><th>sim</th><th>05§4</th><th>откл%</th><th>earn</th><th>spend</th><th>деф&lt;200</th></tr></thead><tbody>';
    s.byDay.forEach(function (r) {
      var cls = Math.abs(r.devPct) <= 10 ? 'ok' : (Math.abs(r.devPct) <= 25 ? 'near' : 'off');
      h += '<tr><td>' + r.day + '</td><td>' + r.balanceMedianBaseCore + '</td><td>' + r.target05 + '</td>'
        + '<td class="' + cls + '">' + r.devPct.toFixed(0) + '%</td>'
        + '<td>' + r.earnMean.toFixed(0) + '</td><td>' + r.spendMean.toFixed(0) + '</td>'
        + '<td>' + (r.deficitShare * 100).toFixed(0) + '%</td></tr>';
    });
    h += '</tbody></table></div>';
    var calCls = cal.pass ? 'ok' : 'near';
    h += '<div class="ckKpiGrid">';
    h += kpi('Калибровка M1', cal.checkpointsWithin10 + '/' + cal.checkpointsTotal + ' в ±10%',
      'max|откл| ' + cal.maxAbsDevPct.toFixed(0) + '%', calCls);
    h += kpi('earn/spend (D14–30)', fmt(ag.ratioMean, 3), 'коридор 0.95–1.15',
      (ag.ratioMean >= 0.95 && ag.ratioMean <= 1.15) ? 'ok' : 'near');
    h += kpi('Прилив M7 (кристалл)', (ag.surgeGamesPct * 100).toFixed(0) + '%', 'цель ≥60%',
      ag.surgeGamesPct >= 0.60 ? 'ok' : 'off');
    h += kpi('rewarded / DAU', fmt(ag.rwPerDauMean, 2), 'цель ≈1.8', ag.rwPerDauMean >= 1.5 ? 'ok' : 'near');
    h += kpi('Дефицит D30 (<200)', (ag.deficitShareD30 * 100).toFixed(0) + '%', 'M8 ≥40%',
      ag.deficitShareD30 >= 0.40 ? 'ok' : 'near');
    h += kpi('Глубокий деф. (<400)', (ag.deepDeficitShareD30 * 100).toFixed(0) + '%', 'M9 растёт', 'near');
    h += kpi('Накопители (>5000)', (ag.hoardShareD30 * 100).toFixed(1) + '%', 'M10 ≤3%',
      ag.hoardShareD30 <= 0.03 ? 'ok' : 'off');
    h += kpi('ad-ARPDAU', '$' + fmt(ag.adArpdau, 4), 'eCPM тюнинга', 'ok');
    h += '</div>';
    // fail-коридоры
    h += '<div class="ckMini"><b>Fail-коридоры (03 §5.2):</b> ';
    var parts = [];
    for (var sn in ag.failCorridors) {
      var cor = ag.failCorridors[sn], fr = ag.failRate[sn] * 100;
      var inC = fr >= cor[0] * 100 - 1 && fr <= cor[1] * 100 + 1;
      parts.push(sn + ' ' + fr.toFixed(0) + '% ' + (inC ? '✓' : '✗'));
    }
    h += parts.join(' · ') + '</div>';
    // sinks breakdown (последний день)
    var last = s.byDay[s.byDay.length - 1];
    var sinkTot = 0, sk; for (sk in last.spendBySink) sinkTot += last.spendBySink[sk];
    h += '<div class="ckMini"><b>Доля sinks (D30):</b> ';
    var sparts = [];
    for (sk in last.spendBySink) sparts.push(esc(sk) + ' ' + (last.spendBySink[sk] / sinkTot * 100).toFixed(0) + '%');
    h += (sparts.length ? sparts.join(' · ') : '—') + '</div>';
    // red flags
    if (s.flags.length) {
      h += '<div class="ckFlags"><b>⚑ Красные флаги дизайна (12 §8.4):</b><ul>';
      s.flags.forEach(function (f) { h += '<li>' + esc(f) + '</li>'; });
      h += '</ul></div>';
    } else {
      h += '<div class="ckMini ckOk">✓ Красных флагов дизайна нет (12 §8.4).</div>';
    }
    h += '</div>';
    return h;
  }
  function kpi(label, val, sub, cls) {
    return '<div class="ckKpi ' + cls + '"><div class="ckKpiV">' + val + '</div>'
      + '<div class="ckKpiL">' + label + '</div><div class="ckKpiS">' + sub + '</div></div>';
  }

  function renderGates() {
    var h = '<div class="ckSection"><h4>Гейты go / iterate / kill (09 §5.4)</h4>';
    h += '<p class="ckNote">Вердикт по симулированной когорте + сценарий удержания. D7 ROAS = LT7 × '
      + '(ad-ARPDAU симулятора + IAP-ARPDAU) / CPI. Лимит итераций — не более двух (10 P7), дальше '
      + 'решение kill/scale на данных.</p>';
    // controls
    h += '<div class="ckGateCtl">';
    h += '<label>Сценарий удержания: <select id="ckScenario">';
    for (var skey in RET_SCENARIOS) {
      var opt = RET_SCENARIOS[skey];
      h += '<option value="' + skey + '"' + (state.retScenario === skey ? ' selected' : '') + '>'
        + opt.label + ' (D1 ' + opt.d1 + ' / D7 ' + opt.d7 + ')</option>';
    }
    h += '</select></label>';
    h += '<label>CPI $ <input type="number" id="ckCpi" min="0.5" max="1.6" step="0.05" value="' + state.cpi + '"></label>';
    h += '<label>IAP-ARPDAU $ <input type="number" id="ckIap" min="0" max="0.2" step="0.005" value="' + state.iapArpdau + '"></label>';
    h += '</div>';

    if (!lastCohort) {
      h += '<p class="ckNote ckWarn">Прогони симуляцию — гейты считаются по COHORT-когорте (метрики на DAU).</p></div>';
      return h;
    }
    var G = computeGates();
    var bandLabel = { kill: 'KILL', iterate: 'ITERATE', scale: 'GO / SCALE' };
    var rows = [
      { key: 'd1', v: G.metrics.d1.value.toFixed(0) + '%' },
      { key: 'd7', v: G.metrics.d7.value.toFixed(0) + '%' },
      { key: 'adArpdau', v: '$' + G.metrics.adArpdau.value.toFixed(4) },
      { key: 'roas7', v: G.metrics.roas7.value.toFixed(0) + '%' }
    ];
    h += '<div class="ckTableWrap"><table class="ckTable ckGateTable"><thead><tr>'
      + '<th>метрика</th><th>значение</th><th>kill &lt;</th><th>scale ≥</th><th>вердикт</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = GATES[r.key], band = G.verdicts[r.key];
      var killV = g.unit === '$' ? '$' + g.kill.toFixed(2) : g.kill + g.unit;
      var scaleV = g.unit === '$' ? '$' + g.scale.toFixed(2) : g.scale + g.unit;
      h += '<tr><td>' + esc(g.label) + '</td><td><b>' + r.v + '</b></td><td>' + killV + '</td><td>' + scaleV
        + '</td><td class="ckBand ' + band + '">' + bandLabel[band] + '</td></tr>';
    });
    h += '</tbody></table></div>';
    // derived
    h += '<div class="ckMini">LT7 = ' + G.lt7.toFixed(2) + ' (сценарий «' + G.scenario.label + '») · '
      + 'blended ARPDAU = $' + G.blended.toFixed(4) + ' · LTV7 = $' + G.ltv7.toFixed(3) + ' · CPI = $' + G.cpi.toFixed(2) + '</div>';

    // overall verdict
    var vlabel = { kill: 'KILL — остановка проекта с ретро', iterate: 'ITERATE — цикл итераций (+4–6 недель)', scale: 'GO / SCALE — global launch' };
    var reasons = [];
    for (var key in G.verdicts) {
      if (G.verdicts[key] === G.verdict) reasons.push(GATES[key].label);
    }
    var iterExhausted = (G.verdict === 'iterate' && G.iterateCount >= G.iterateLimit);
    h += '<div class="ckVerdict ' + G.verdict + '">';
    h += '<div class="ckVerdictTop">Вердикт: <b>' + vlabel[G.verdict] + '</b></div>';
    if (G.verdict === 'kill') h += '<div class="ckVerdictWhy">Одна из метрик ниже kill-порога (' + reasons.join(', ') + '). '
      + 'Ниже kill — остановка с ретро (10 Проход Г DoD).</div>';
    else if (G.verdict === 'scale') h += '<div class="ckVerdictWhy">Все метрики на scale-порогах — гейт Прохода Г пройден '
      + '(D1 ≥38, D7 ≥15, ad-ARPDAU ≥$0.10, D7 ROAS ≥40%). Путь на Проход Д (global).</div>';
    else {
      h += '<div class="ckVerdictWhy">Метрики в «серой зоне» (' + reasons.join(', ') + ')'
        + (G.flags.length ? ' + красные флаги симулятора удерживают от scale' : '') + '. '
        + 'Итераций пройдено: <b>' + G.iterateCount + ' / ' + G.iterateLimit + '</b>.</div>';
      if (iterExhausted) h += '<div class="ckVerdictWhy ckWarn">⚠ Лимит из ' + G.iterateLimit
        + ' iterate-циклов исчерпан (10 P7): дальше — жёсткое решение kill/scale на данных, без бесконечного iterate.</div>';
      h += '<button type="button" class="ghostBtn" id="ckIterBtn"' + (iterExhausted ? ' disabled' : '')
        + '>Зафиксировать iterate-цикл (' + G.iterateCount + '→' + (G.iterateCount + 1) + ')</button>';
      h += '<button type="button" class="ghostBtn" id="ckIterReset">сбросить счётчик</button>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  function renderAll() {
    var body = el('cockpitBody');
    if (!body) return;
    var sess = el('cockpitSess');
    if (sess) sess.innerHTML = 'A/B: <code>' + esc(abGroupsString()) + '</code>';
    body.innerHTML = renderAB() + renderTuning() + renderRunControls() + renderResults() + renderGates();
    bindDynamic();
  }

  /* ============================== СОБЫТИЯ =============================== */

  function bindDynamic() {
    var body = el('cockpitBody');
    if (!body) return;

    // Ручки: range + number (синхронно), reset.
    body.querySelectorAll('.ckRange, .ckNum').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var key = inp.getAttribute('data-knob');
        setKnob(key, inp.value);
        // синхронизируем парный контрол без полной перерисовки
        body.querySelectorAll('[data-knob="' + key + '"]').forEach(function (o) { if (o !== inp) o.value = inp.value; });
        var wrap = inp.closest('.ckKnob'); if (wrap) wrap.classList.add('edited');
        var rb = wrap ? wrap.querySelector('.ckResetOne') : null; if (rb) rb.disabled = false;
        refreshSessLine();
      });
    });
    body.querySelectorAll('.ckResetOne').forEach(function (b) {
      b.addEventListener('click', function () { resetKnob(b.getAttribute('data-knob')); renderAll(); });
    });
    var rall = el('ckResetAll'); if (rall) rall.addEventListener('click', function () { resetAll(); renderAll(); });

    // N слайдер.
    var nEl = el('ckN'), nVal = el('ckNval');
    if (nEl) nEl.addEventListener('input', function () { state.simN = parseInt(nEl.value, 10); if (nVal) nVal.textContent = state.simN; saveState(); });
    var abTog = el('ckApplyAB');
    if (abTog) abTog.addEventListener('change', function () {
      state.applyAB = abTog.checked; saveState();
      runSim(); renderAll();   // пересчёт под новый режим
    });

    // Прогон.
    var runBtn = el('ckRunBtn');
    if (runBtn) runBtn.addEventListener('click', function () {
      runBtn.disabled = true; runBtn.textContent = '⏳ считаю…';
      setTimeout(function () { runSim(); renderAll(); }, 20);
    });

    // A/B «сравнить».
    body.querySelectorAll('.ckCompareBtn').forEach(function (b) {
      b.addEventListener('click', function () { compareAB(b.getAttribute('data-exp')); });
    });

    // Гейты: сценарий/CPI/IAP.
    var scSel = el('ckScenario');
    if (scSel) scSel.addEventListener('change', function () { state.retScenario = scSel.value; saveState(); renderGatesOnly(); });
    var cpiEl = el('ckCpi');
    if (cpiEl) cpiEl.addEventListener('change', function () { state.cpi = parseFloat(cpiEl.value) || 0.90; saveState(); renderGatesOnly(); });
    var iapEl = el('ckIap');
    if (iapEl) iapEl.addEventListener('change', function () { state.iapArpdau = parseFloat(iapEl.value) || 0; saveState(); renderGatesOnly(); });
    var iterBtn = el('ckIterBtn');
    if (iterBtn) iterBtn.addEventListener('click', function () { state.iterateCount = Math.min(state.iterateCount + 1, MAX_ITERATE); saveState(); renderGatesOnly(); });
    var iterReset = el('ckIterReset');
    if (iterReset) iterReset.addEventListener('click', function () { state.iterateCount = 0; saveState(); renderGatesOnly(); });
  }

  function refreshSessLine() {
    var sess = el('cockpitSess');
    if (sess) sess.innerHTML = 'A/B: <code>' + esc(abGroupsString()) + '</code>';
  }
  function renderGatesOnly() {
    // Перерисовываем только блок гейтов (последний .ckSection) — дешевле полной.
    renderAll();
  }

  /* A/B-сравнение: гоняем оба варианта, показываем дельту первичной метрики. */
  function compareAB(expId) {
    if (!Sim) return;
    var exp = null;
    for (var i = 0; i < EXPERIMENTS.length; i++) if (EXPERIMENTS[i].id === expId) exp = EXPERIMENTS[i];
    if (!exp) return;
    var out = el('ckCmp_' + expId);
    if (out) out.innerHTML = '<span class="ckNote">⏳ гоняю оба варианта…</span>';
    setTimeout(function () {
      var res = exp.variants.map(function (vr) {
        var over = {};
        // База = прочие A/B + ручной тюнинг, но ЭТОТ эксперимент фиксируем вариантом.
        EXPERIMENTS.forEach(function (other) {
          if (other.id === exp.id) return;
          applyOver(over, assignedVariant(other).over);
        });
        applyOver(over, state.tune);
        applyOver(over, vr.over);
        var coh = Sim.run({ N: state.simN, days: 30, runId: 'ab:' + exp.id + ':' + vr.id, mode: 'COHORT', tune: over });
        var surv = Sim.run({ N: state.simN, days: 30, runId: 'ab:' + exp.id + ':' + vr.id, mode: 'SURVIVOR', tune: over });
        return {
          id: vr.id, label: vr.label,
          adArpdau: coh.aggregates.adArpdau,
          rwPerDau: coh.aggregates.rwPerDauMean,
          ratio: surv.aggregates.ratioMean,
          balD30: surv.byDay[29].balanceMedianBaseCore,
          deficitD30: surv.aggregates.deficitShareD30
        };
      });
      var a = res[0], b = res[1];
      var dArp = ((b.adArpdau - a.adArpdau) / a.adArpdau * 100);
      var h = '<table class="ckTable ckCmpTable"><thead><tr><th>вариант</th><th>ad-ARPDAU</th><th>rw/DAU</th>'
        + '<th>earn/spend</th><th>баланс D30</th><th>деф D30</th></tr></thead><tbody>';
      res.forEach(function (r) {
        h += '<tr><td><b>' + esc(r.id) + '</b> ' + esc(r.label) + '</td><td>$' + r.adArpdau.toFixed(4) + '</td>'
          + '<td>' + r.rwPerDau.toFixed(2) + '</td><td>' + r.ratio.toFixed(3) + '</td><td>' + r.balD30
          + '</td><td>' + (r.deficitD30 * 100).toFixed(0) + '%</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="ckMini">Δ ad-ARPDAU (B−A) = <b>' + (dArp >= 0 ? '+' : '') + dArp.toFixed(1) + '%</b> · '
        + 'первичная метрика: ' + esc(exp.primary) + ' · guardrail: ' + esc(exp.guardrail)
        + '. Детерминировано (свой runId на вариант).</div>';
      if (out) out.innerHTML = h;
    }, 20);
  }

  /* ============================== ОТКРЫТИЕ ============================== */

  function open() {
    var sc = el('cockpitScreen'); if (sc) sc.classList.remove('hidden');
    if (!lastSummary) runSim();     // первый прогон при открытии
    renderAll();
  }
  function close() { var sc = el('cockpitScreen'); if (sc) sc.classList.add('hidden'); }

  function bind() {
    var openBtn = el('openCockpitBtn'); if (openBtn) openBtn.addEventListener('click', open);
    var closeBtn = el('cockpitCloseBtn'); if (closeBtn) closeBtn.addEventListener('click', close);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  }

  /* Публичный API (для дашборда монетизации и отладки). */
  return {
    getAssignments: getAssignments,
    abGroupsString: abGroupsString,
    buildOverrides: buildOverrides,
    runSim: runSim,
    computeGates: computeGates,
    open: open, close: close,
    EXPERIMENTS: EXPERIMENTS, KNOBS: KNOBS
  };
})();
