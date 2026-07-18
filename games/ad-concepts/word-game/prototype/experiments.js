/* =============================================================================
 * WordGrove — SOFT-LAUNCH COCKPIT (Проход Г): A/B + тюнинг + гейты
 * -----------------------------------------------------------------------------
 * Кокпит поверх симулятора экономики (sim.js). Три блока:
 *   1) A/B-фреймворк — пул из 3 экспериментов, ДЕТЕРМИНИРОВАННОЕ назначение
 *      варианта по хешу session-id (тот же fnv1a32, что в sim.js). Вариант виден
 *      в кокпите и в дашборде монетизации. Кнопка «Сравнить A/B» гоняет оба
 *      варианта и показывает дельту первичной метрики (дисциплина 09 §6, 05 §10).
 *   2) Панель тюнинга ручек — spendStress-масштаб, ad-капы, earn-rate EV, RV-2,
 *      eCPM; значения редактируются, сохраняются в localStorage (префикс
 *      'wordgrove_softlaunch') и сбрасываются «к значениям книги» (baseline 12 §8).
 *      НОМИНАЛЫ (цены, награды, капы) панель НЕ трогает (INV-S1) — только
 *      поведенческую модель; правки номиналов идут через A/B-сценарии (05 §10).
 *   3) Гейты go/iterate/kill (09 §4.3) — оценка симулированной когорты против
 *      kill/scale-критериев: D1, ARPDAU, ROAS(365), ROAS(7), подписочная доля
 *      выручки. LTV(365) считается с подписочным компонентом; отдельный виджет
 *      показывает, что ПОДПИСКА-ЗАВИСИМЫЙ LTV особенно чувствителен (обвал триала
 *      → обвал LTV → смена вердикта).
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
  var STORAGE_KEY = 'wordgrove_softlaunch';

  /* ========================= РУЧКИ ТЮНИНГА (панель) =====================
   * key совпадает с ключом tune симулятора (sim.js BOOK_TUNE); ecpm.* —
   * вложенные. book — «значение книги» (калиброванный baseline). ТОЛЬКО
   * поведенческие/монетизационные ручки (INV-S1) — номиналов здесь нет. */
  var KNOBS = [
    { key: 'spendScale', group: 'Сложность / earn-rate', label: 'spendStress-масштаб (интенсивность трат)',
      min: 3, max: 9, step: 0.25, hint: 'общий множитель лестницы подсказок (§8.3); ↑ = быстрее дно' },
    { key: 'missionEV', group: 'Сложность / earn-rate', label: 'Daily-миссии EV / день',
      min: 40, max: 130, step: 6, hint: '120×выполняемость; книга 84 (05 §4)' },
    { key: 'weeklyEV', group: 'Сложность / earn-rate', label: 'Weekly-миссии EV / нед',
      min: 300, max: 700, step: 25, hint: 'суммарно ~550/нед (05 §2.1); компенсатор M-12' },
    { key: 'rv2Mult', group: 'Сложность / earn-rate', label: 'RV-2 множитель монет (×2 / ×2.5)',
      min: 2, max: 3, step: 0.5, hint: 'сценарий S4 (12 §6); guardrail медиана D30 ≤ 900' },
    { key: 'startCoins', group: 'Сложность / earn-rate', label: 'Стартовый баланс монет',
      min: 200, max: 500, step: 50, hint: 'старт 300 (05 §3)' },
    { key: 'intPerDau', group: 'Реклама: капы', label: 'INT-кап / DAU (interstitial)',
      min: 2.5, max: 5, step: 0.1, hint: 'показы interstitial на DAU (09 §3, кап 06 §4)' },
    { key: 'bannerPerDau', group: 'Реклама: капы', label: 'Banner / DAU',
      min: 6, max: 12, step: 0.5, hint: 'показы баннера на DAU (09 §3)' },
    { key: 'rv1DayCap', group: 'Реклама: капы', label: 'RV-1 «Бесплатная Лампа» кап / день',
      min: 1, max: 6, step: 1, hint: 'дневной кап RV-1 (06 §3.1: ≤4/день)' },
    { key: 'ecpm.rw', group: 'eCPM (06 §8.1)', label: 'eCPM rewarded, $',
      min: 4, max: 20, step: 0.5, hint: 'rewarded, $ за 1000 показов (US $17,8 / бленд $13)' },
    { key: 'ecpm.int', group: 'eCPM (06 §8.1)', label: 'eCPM interstitial, $',
      min: 3, max: 16, step: 0.5, hint: 'interstitial, $ за 1000 показов' },
    { key: 'ecpm.banner', group: 'eCPM (06 §8.1)', label: 'eCPM banner, $',
      min: 0.1, max: 1.0, step: 0.05, hint: 'banner, $ за 1000 показов' }
  ];

  /* ============================ ПУЛ A/B (09 §6, 05 §10) ==================
   * variants[0] — контроль. over — переопределения ручек симулятора. Эти три
   * эксперимента затрагивают НОМИНАЛЫ (цена подсказки) и продуктовые параметры
   * (длина триала, INT-кап) — это ЭКОНОМИСТ/ПРОД-решения через A/B (05 §10,
   * приложение 12 S3), не калибровка (INV-S1). primary — первичная метрика. */
  var EXPERIMENTS = [
    {
      id: 'hint_price', name: 'Цена Лампы (подсказка)',
      primary: 'окно конверсии / расход', guardrail: 'инфляция баланса D30 (05 §10: цена только вниз)',
      variants: [
        { id: 'A', label: '100 монет (контроль)', over: { lampPrice: 100 } },
        { id: 'B', label: '80 монет (−20%)', over: { lampPrice: 80 } }
      ]
    },
    {
      id: 'sub_trial', name: 'Длина триала подписки',
      primary: 'триал→платная / sub-ARPDAU', guardrail: 'D7 retention',
      variants: [
        { id: 'A', label: '7 дней (контроль)', over: { trialDays: 7 } },
        { id: 'B', label: '3 дня', over: { trialDays: 3 } }
      ]
    },
    {
      id: 'int_cap', name: 'INT-кап interstitial / DAU',
      primary: 'ad-ARPDAU', guardrail: 'D7 отток (−1 п.п. max)',
      variants: [
        { id: 'A', label: '3.2 / DAU (контроль)', over: { intPerDau: 3.2 } },
        { id: 'B', label: '4.0 / DAU', over: { intPerDau: 4.0 } }
      ]
    }
  ];

  /* ==================== СЦЕНАРИИ УДЕРЖАНИЯ (09 §4.2) ====================
   * D1/D7/D30, β, LT(7)/LT(365) — из таблицы «Три сценария» 09 §4.2. */
  var RET_SCENARIOS = {
    pess:  { label: 'Пессимист', d1: 35, d7: 12, d30: 5.4, beta: 0.55,  lt7: 2.3, lt365: 11.5 },
    base:  { label: 'База',      d1: 42, d7: 18, d30: 8.0, beta: 0.435, lt7: 2.8, lt365: 21.3 },
    optim: { label: 'Оптимист',  d1: 48, d7: 23, d30: 12.0, beta: 0.378, lt7: 3.2, lt365: 30.8 }
  };

  /* Подписочная модель (06 §5.1, §8.3) — для sub-ARPDAU и LTV. */
  var SUB = { trialRate: 0.026, trialConv: 0.55, lifetimeMo: 4.2, monthly: 8.99, storeCut: 0.30, yearlyUpliftPct: 0.06 };
  // Длина триала → конверсия триал→платная (иллюстративно): короче триал — выше
  // мгновенная конверсия, но ниже качество; книга: 7 дней = 55% (09 §4.2).
  var TRIAL_CONV = { 7: 0.55, 3: 0.62 };

  /* Kill/iterate/scale-пороги (09 §4.3). higher=true — больше лучше. */
  var GATES = {
    d1:       { kill: 37, scale: 40,   unit: '%', higher: true, label: 'D1 retention (kill <37, 09 §4.3)' },
    arpdau:   { kill: 0.055, scale: 0.085, unit: '$', higher: true, label: 'ARPDAU blended (kill <$0.055)' },
    roas365:  { kill: 80, scale: 151,  unit: '%', higher: true, label: 'ROAS D365 (kill <80%, 09 §4.3)' },
    roas7:    { kill: 12, scale: 18,   unit: '%', higher: true, label: 'ROAS D7 (scale ≥18%, 09 §4.3)' },
    subShare: { kill: 12, scale: 22,   unit: '%', higher: true, label: 'Подписочная доля выручки (цель 22%, 06 §1)' }
  };
  var MAX_ITERATE = 2;   // 10 P7 / 09 §4.3: не более двух iterate-циклов

  /* ============================== ХРАНИЛИЩЕ ============================= */
  function defaults() {
    return {
      v: 1, sessionId: '', tune: {}, retScenario: 'base',
      cpi: 1.20,           // 09 §4.2 база
      iapArpdau: 0.011,    // 06 §8.3
      trialRate: 0.026,    // 06 §5.1
      iterateCount: 0, simN: 300, applyAB: false
    };
  }
  function loadState() {
    var s = defaults();
    var loadedSession = false;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        for (var k in s) if (p[k] !== undefined) s[k] = p[k];
        if (!p.tune || typeof p.tune !== 'object') s.tune = {};
        if (p.sessionId) loadedSession = true;
      }
    } catch (e) { s = defaults(); loadedSession = false; }
    if (!s.sessionId) s.sessionId = genSessionId();
    // Персистим session-id СРАЗУ при первом появлении. Без этого свежий id жил бы
    // только в памяти (saveState зовётся лишь при правке ручки/тумблера), и каждый
    // перезагруз генерировал бы новый id → другой A/B-бакет. Стабильность назначения
    // по session-id — инвариант A/B-фреймворка (09 §1.2; «одна и та же сессия всегда
    // получает те же варианты»). Пишем только при первом минте, чтобы не затирать
    // уже накопленный tune из старших вкладок.
    if (!loadedSession) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* no-op */ } }
    return s;
  }
  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* no-op */ } }
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
  function assignedVariant(exp) { return exp.variants[hash32(state.sessionId + ':' + exp.id) % exp.variants.length]; }
  function getAssignments() {
    return EXPERIMENTS.map(function (exp) {
      var v = assignedVariant(exp);
      return { exp: exp.id, name: exp.name, variant: v.id, label: v.label };
    });
  }
  function abGroupsString() {
    return EXPERIMENTS.map(function (exp) { return exp.id + '=' + assignedVariant(exp).id; }).join(', ');
  }

  /* ============ ЭФФЕКТИВНЫЙ TUNE = book + A/B + ручной тюнинг =========== */
  function buildOverrides() {
    var over = {};
    if (state.applyAB) EXPERIMENTS.forEach(function (exp) { applyOver(over, assignedVariant(exp).over); });
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
  function knobValue(key) {
    var over = buildOverrides(), book = Sim ? Sim.BOOK_TUNE : {};
    if (key.indexOf('ecpm.') === 0) {
      var sub = key.split('.')[1], o = over.ecpm || {};
      return (o[sub] !== undefined) ? o[sub] : (book.ecpm ? book.ecpm[sub] : 0);
    }
    return (over[key] !== undefined) ? over[key] : book[key];
  }
  function bookValue(key) {
    var book = Sim ? Sim.BOOK_TUNE : {};
    if (key.indexOf('ecpm.') === 0) { var sub = key.split('.')[1]; return book.ecpm ? book.ecpm[sub] : 0; }
    return book[key];
  }
  function setKnob(key, val) {
    val = parseFloat(val);
    if (!isFinite(val)) return;
    if (key.indexOf('ecpm.') === 0) { var sub = key.split('.')[1]; state.tune.ecpm = state.tune.ecpm || {}; state.tune.ecpm[sub] = val; }
    else state.tune[key] = val;
    saveState();
  }
  function resetKnob(key) {
    if (key.indexOf('ecpm.') === 0) { if (state.tune.ecpm) delete state.tune.ecpm[key.split('.')[1]]; }
    else delete state.tune[key];
    saveState();
  }
  function resetAll() { state.tune = {}; saveState(); }
  function isKnobEdited(key) {
    if (key.indexOf('ecpm.') === 0) { var sub = key.split('.')[1]; return !!(state.tune.ecpm && state.tune.ecpm[sub] !== undefined); }
    return state.tune[key] !== undefined;
  }

  /* ============================ ПРОГОН СИМУЛЯТОРА ======================= */
  var lastRef = null, lastMC = null, lastCohort = null;
  function runSim() {
    if (!Sim) return null;
    var over = buildOverrides(), N = state.simN || 300, rid = 'cockpit:' + state.sessionId;
    lastRef = Sim.run({ days: 30, runId: rid, mode: 'REF', tune: over });
    lastMC = Sim.run({ N: N, days: 30, runId: rid, mode: 'MC', tune: over });
    lastCohort = Sim.run({ N: N, days: 30, runId: rid, mode: 'COHORT', tune: over });
    return lastMC;
  }

  /* ==================== ПОДПИСОЧНАЯ МОДЕЛЬ + LTV (06 §8.3, 09 §4) ========
   * sub-ARPDAU = trialRate × trialConv × lifetimeMo × monthly × (1−cut) × (1+yearlyUplift) / LT365.
   * Длина триала (A/B sub_trial) меняет trialConv. Гейты считают LTV(365) с этим
   * компонентом — и показывают его чувствительность. */
  function trialConvFor() {
    var over = buildOverrides();
    var td = over.trialDays || 7;
    return TRIAL_CONV[td] || SUB.trialConv;
  }
  function subArpdauFor(scn, trialConv, trialRate) {
    var perInstall = trialRate * trialConv * SUB.lifetimeMo * SUB.monthly * (1 - SUB.storeCut) * (1 + SUB.yearlyUpliftPct);
    return perInstall / scn.lt365;
  }

  function computeGates() {
    var scn = RET_SCENARIOS[state.retScenario] || RET_SCENARIOS.base;
    var adArpdau = lastCohort ? lastCohort.aggregates.adArpdau : 0;
    var trialConv = trialConvFor();
    var trialRate = state.trialRate || SUB.trialRate;
    var subArpdau = subArpdauFor(scn, trialConv, trialRate);
    var iapArpdau = state.iapArpdau || 0;
    var blended = adArpdau + subArpdau + iapArpdau;
    var subShare = blended > 0 ? subArpdau / blended * 100 : 0;
    var adShare = blended > 0 ? adArpdau / blended * 100 : 0;
    var iapShare = blended > 0 ? iapArpdau / blended * 100 : 0;

    var cpi = state.cpi || 1.20;
    var ltv7 = scn.lt7 * blended, ltv365 = scn.lt365 * blended;
    var roas7 = cpi > 0 ? ltv7 / cpi * 100 : 0;
    var roas365 = cpi > 0 ? ltv365 / cpi * 100 : 0;

    var metrics = {
      d1: { value: scn.d1 }, arpdau: { value: blended },
      roas365: { value: roas365 }, roas7: { value: roas7 }, subShare: { value: subShare }
    };
    var verdicts = {}, worst = 'scale', rank = { scale: 0, iterate: 1, kill: 2 };
    for (var key in GATES) {
      var g = GATES[key], v = metrics[key].value, band;
      if (v < g.kill) band = 'kill'; else if (v < g.scale) band = 'iterate'; else band = 'scale';
      verdicts[key] = band;
      if (rank[band] > rank[worst]) worst = band;
    }
    // Находки-дизайн симулятора (M-9/M-12) удерживают от scale (12 §8.4).
    var flags = lastMC ? lastMC.flags : [];
    if (worst === 'scale' && flags.length) worst = 'iterate';

    // Чувствительность подписки: LTV/ROAS при обвале триал-конверсии вдвое.
    var subHalf = subArpdauFor(scn, trialConv * 0.5, trialRate);
    var blendedHalf = adArpdau + subHalf + iapArpdau;
    var roas365Half = cpi > 0 ? scn.lt365 * blendedHalf / cpi * 100 : 0;
    var noSub = adArpdau + iapArpdau;                    // подписки нет вовсе
    var roas365NoSub = cpi > 0 ? scn.lt365 * noSub / cpi * 100 : 0;

    return {
      scn: scn, adArpdau: adArpdau, subArpdau: subArpdau, iapArpdau: iapArpdau, blended: blended,
      adShare: adShare, subShare: subShare, iapShare: iapShare, trialConv: trialConv, trialRate: trialRate,
      cpi: cpi, ltv7: ltv7, ltv365: ltv365, roas7: roas7, roas365: roas365,
      metrics: metrics, verdicts: verdicts, verdict: worst, flags: flags,
      iterateCount: state.iterateCount, iterateLimit: MAX_ITERATE,
      sens: { roas365Half: roas365Half, roas365NoSub: roas365NoSub, blendedHalf: blendedHalf, blendedNoSub: noSub,
              killPct: (roas365 - roas365Half) / (roas365 || 1) * 100 }
    };
  }

  /* ================================ РЕНДЕР ============================== */
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(v, d) { return Number(v).toFixed(d === undefined ? 2 : d); }
  function money(v) { v = v || 0; return '$' + Number(v).toFixed(v >= 1 ? 2 : 4); }

  function renderAB() {
    var h = '<div class="ckSection"><h4>1 · A/B-эксперименты <span class="simTag">session ' + esc(state.sessionId) + '</span></h4>';
    h += '<p class="ckNote">Назначение варианта — детерминировано по хешу session-id (fnv1a32, как в sim.js). '
      + 'Одна и та же сессия всегда получает те же варианты; они видны и в дашборде монетизации (ab_groups, 09 §1). '
      + 'Эти A/B меняют НОМИНАЛ/продукт (цена подсказки, длина триала, INT-кап) — решения экономиста/прода через '
      + 'A/B (05 §10), не калибровку.</p>';
    EXPERIMENTS.forEach(function (exp) {
      var assigned = assignedVariant(exp);
      h += '<div class="ckExp"><div class="ckExpTop"><b>' + esc(exp.name) + '</b><span class="ckExpId">' + esc(exp.id) + '</span></div>';
      h += '<div class="ckExpMeta">Первичная: ' + esc(exp.primary) + ' · Guardrail: ' + esc(exp.guardrail) + '</div>';
      h += '<div class="ckVariants">';
      exp.variants.forEach(function (vr) {
        var on = vr.id === assigned.id;
        h += '<span class="ckVar' + (on ? ' active' : '') + '">' + (on ? '● ' : '○ ') + esc(vr.id) + ': ' + esc(vr.label) + '</span>';
      });
      h += '</div>';
      h += '<button type="button" class="ckCompareBtn ckGhost" data-exp="' + exp.id + '">⚖ Сравнить A/B (гонит оба)</button>';
      h += '<div class="ckCompareOut" id="ckCmp_' + exp.id + '"></div></div>';
    });
    h += '</div>';
    return h;
  }

  function renderTuning() {
    var h = '<div class="ckSection"><h4>2 · Панель тюнинга ручек <span class="simTag">localStorage</span></h4>';
    h += '<p class="ckNote">Правки сохраняются локально (префикс <code>wordgrove_softlaunch</code>) и применяются к '
      + 'симулятору. «Книга» — калиброванный baseline (12 §8, трекает 05 §4). Изменённые ручки подсвечены; «↺» '
      + 'возвращает к книге. НОМИНАЛЫ (цены/награды/капы rewarded) панель НЕ тюнит — это решения глав 05/06 (INV-S1); '
      + 'их правят A/B-сценарии выше.</p>';
    var groups = {}, order = [];
    KNOBS.forEach(function (kn) { if (!groups[kn.group]) { groups[kn.group] = []; order.push(kn.group); } groups[kn.group].push(kn); });
    order.forEach(function (gname) {
      h += '<div class="ckGroup"><div class="ckGroupName">' + esc(gname) + '</div>';
      groups[gname].forEach(function (kn) {
        var val = knobValue(kn.key), book = bookValue(kn.key), edited = isKnobEdited(kn.key);
        h += '<div class="ckKnob' + (edited ? ' edited' : '') + '">';
        h += '<div class="ckKnobLbl">' + esc(kn.label) + '<span class="ckKnobHint">' + esc(kn.hint) + '</span></div>';
        h += '<div class="ckKnobCtl">';
        h += '<input type="range" class="ckRange" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max + '" step="' + kn.step + '" value="' + val + '">';
        h += '<input type="number" class="ckNum" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max + '" step="' + kn.step + '" value="' + val + '">';
        h += '<span class="ckBook">книга ' + book + '</span>';
        h += '<button type="button" class="ckResetOne" data-knob="' + kn.key + '"' + (edited ? '' : ' disabled') + '>↺</button>';
        h += '</div></div>';
      });
      h += '</div>';
    });
    h += '<button type="button" class="ckGhost" id="ckResetAll">↺ Сбросить все ручки к книге</button>';
    h += '</div>';
    return h;
  }

  function renderRunControls() {
    var h = '<div class="ckSection"><h4>3 · Прогон симулятора</h4>';
    h += '<p class="ckNote">Браузер: N=' + state.simN + ' игроков × 30 дней, <1 c (REF + MC + COHORT). Node: '
      + '<code>node sim.js</code> печатает ту же сводку в stdout. runId привязан к session-id — прогон воспроизводим '
      + '(INV-S2, детерминизм).</p>';
    h += '<div class="ckRunRow">';
    h += '<label class="ckNlabel">N игроков: <input type="range" id="ckN" min="100" max="400" step="50" value="' + state.simN + '"><b id="ckNval">' + state.simN + '</b></label>';
    h += '<button type="button" id="ckRunBtn" class="ckRunBtn">▶ Прогнать симуляцию</button>';
    h += '</div>';
    h += '<label class="ckNlabel ckAbToggle"><input type="checkbox" id="ckApplyAB"' + (state.applyAB ? ' checked' : '')
      + '> применять назначенные A/B-варианты к прогону (' + esc(abGroupsString()) + ')</label>';
    h += '</div>';
    return h;
  }

  function kpi(label, val, sub, cls) {
    return '<div class="ckKpi ' + cls + '"><div class="ckKpiV">' + val + '</div><div class="ckKpiL">' + label + '</div><div class="ckKpiS">' + sub + '</div></div>';
  }

  function renderResults() {
    if (!lastRef) return '<div class="ckSection"><h4>4 · Результаты симуляции</h4>'
      + '<p class="ckNote">Нажми «Прогнать симуляцию» — здесь появятся кривая баланса REF vs 05 §4, окно дефицита, '
      + 'подсказки/день (M-5), rewarded/DAU (M-6), ARPDAU и находки.</p></div>';
    var r = lastRef.ref, mc = lastMC.aggregates;
    var h = '<div class="ckSection"><h4>4 · Баланс REF-твина по дням vs таблица 05 §4</h4>';
    h += '<p class="ckNote">REF — детерминированный EV-твин ячейки MEDIAN×CORE (survivor, без RV-доходов/weekly/копилки): '
      + 'воспроизводит таблицу 05 §4 (INV-S4). MEDIAN×CORE MC — та же ячейка при ПОЛНЫХ потоках §4.</p>';
    h += '<div class="ckTableWrap"><table class="ckTable"><thead><tr>'
      + '<th>день</th><th>REF</th><th>05§4</th><th>откл%</th><th>MC медиана</th><th>MC деф&lt;300</th></tr></thead><tbody>';
    for (var i = 0; i < lastRef.byDay.length; i++) {
      var rr = lastRef.byDay[i], mrow = lastMC.byDay[i];
      var ad = Math.abs(rr.devPct);
      var cls = ad <= 8 ? 'ok' : (ad <= 12 ? 'near' : 'off');
      h += '<tr><td>' + rr.day + '</td><td>' + rr.balance + '</td><td>' + rr.target05 + '</td>'
        + '<td class="' + cls + '">' + rr.devPct.toFixed(0) + '%</td>'
        + '<td>' + mrow.balanceMedianCore + '</td><td>' + (mrow.deficitShare * 100).toFixed(0) + '%</td></tr>';
    }
    h += '</tbody></table></div>';

    // KPI-плитки
    h += '<div class="ckKpiGrid">';
    h += kpi('T-1 REF earn = 05 §4', r.earnExact ? '✓ точно' : '✗ СБОЙ', 'INV-S4, 0 монет расхождения', r.earnExact ? 'ok' : 'off');
    h += kpi('T-2 баланс REF', r.checkpointsWithin12 + '/' + r.checkpointsTotal + ' в ±12%', r.checkpointsWithin8 + '/6 в ±8% · D30 ' + r.d30, r.t2Pass ? 'ok' : 'near');
    h += kpi('REF первое «дно»', 'D' + (r.firstDeficitDay || '—'), 'цель ~D27–D29 (05 §4)', (r.firstDeficitDay >= 26 && r.firstDeficitDay <= 30) ? 'ok' : 'near');
    h += kpi('MC окно дефицита', mc.windowShifted ? 'за D30' : 'D' + mc.firstDeficitMedian, 'M-12: сдвиг от полных потоков', mc.windowShifted ? 'off' : 'ok');
    h += kpi('MC медиана D30', String(mc.balanceD30Median), 'коридор 400–900 (05 §5)', (mc.balanceD30Median >= 400 && mc.balanceD30Median <= 900) ? 'ok' : 'off');
    h += kpi('earn/spend D14+', fmt(mc.ratioMean, 2), 'коридор 0.95–1.20', (mc.ratioMean >= 0.95 && mc.ratioMean <= 1.20) ? 'ok' : 'near');
    h += kpi('ad-ARPDAU (COHORT)', money(lastCohort.aggregates.adArpdau), 'цель $0.055 (09 §3)', lastCohort.aggregates.adArpdau >= 0.055 ? 'ok' : 'near');
    h += kpi('Σ rewarded/DAU', fmt(lastCohort.aggregates.rwTotal, 2), 'цель ~1.5 (06 §3.1)', 'near');
    h += '</div>';

    // M-5 / M-6
    h += '<div class="ckMini"><b>M-5 подсказки/день D14+ (MEDIAN×CORE):</b> '
      + 'Лампа ' + fmt(mc.hintsD14.lamp, 2) + ' (цель 1.1) · Прицел ' + fmt(mc.hintsD14.scope, 2) + ' (0.4) · Ракета ' + fmt(mc.hintsD14.rocket, 2) + ' (0.15)</div>';
    var rw = mc.rwPerPlacement;
    h += '<div class="ckMini"><b>M-6 rewarded показы/DAU:</b> RV-1 ' + fmt(rw.rv1, 2) + ' · RV-2 ' + fmt(rw.rv2, 2)
      + ' · RV-3 ' + fmt(rw.rv3, 2) + ' · RV-5 ' + fmt(rw.rv5, 2) + ' · Σ ' + fmt(mc.rwTotal, 2) + ' (цель RV .30/.55/.20/.35)</div>';
    h += '<div class="ckMini"><b>M-10/M-11:</b> DAILY earn/день ' + mc.dailyEarnD14.toFixed(0) + ' (цель 100–160) · '
      + 'POWER earn ' + mc.powerEarnD14.toFixed(0) + ' / траты ' + mc.powerSpendD14.toFixed(0) + ' (earn 500+)</div>';

    if (mc.windowShifted || lastMC.flags.length) {
      h += '<div class="ckFlags"><b>⚑ Находки симулятора (12 §7–§8):</b><ul>';
      lastMC.flags.forEach(function (f) { h += '<li>' + esc(f) + '</li>'; });
      h += '</ul></div>';
    } else h += '<div class="ckMini ckOk">✓ Находок-флагов нет.</div>';
    h += '</div>';
    return h;
  }

  function renderGates() {
    var h = '<div class="ckSection"><h4>5 · Гейты go / iterate / kill (09 §4.3)</h4>';
    h += '<p class="ckNote">Вердикт по симулированной когорте (COHORT, ad-ARPDAU) + сценарий удержания 09 §4.2 + '
      + 'подписочная модель 06 §8.3. LTV(365) = LT(365) × (ad + подписка + IAP ARPDAU). Лимит итераций — не более двух '
      + '(09 §4.3), дальше — решение kill/scale на данных.</p>';
    h += '<div class="ckGateCtl">';
    h += '<label>Сценарий удержания: <select id="ckScenario">';
    for (var skey in RET_SCENARIOS) {
      var o = RET_SCENARIOS[skey];
      h += '<option value="' + skey + '"' + (state.retScenario === skey ? ' selected' : '') + '>' + o.label + ' (D1 ' + o.d1 + ' / D7 ' + o.d7 + ' / LT365 ' + o.lt365 + ')</option>';
    }
    h += '</select></label>';
    h += '<label>CPI $ <input type="number" id="ckCpi" min="0.6" max="1.6" step="0.05" value="' + state.cpi + '"></label>';
    h += '<label>IAP-ARPDAU $ <input type="number" id="ckIap" min="0" max="0.05" step="0.002" value="' + state.iapArpdau + '"></label>';
    h += '<label>Триал-рейт <input type="number" id="ckTrial" min="0" max="0.06" step="0.002" value="' + state.trialRate + '"></label>';
    h += '</div>';

    if (!lastCohort) { h += '<p class="ckNote ckWarn">Прогони симуляцию — гейты считаются по COHORT-когорте.</p></div>'; return h; }
    var G = computeGates();
    var bandLabel = { kill: 'KILL', iterate: 'ITERATE', scale: 'GO / SCALE' };
    var rows = [
      { key: 'd1', v: G.metrics.d1.value.toFixed(0) + '%' },
      { key: 'arpdau', v: money(G.metrics.arpdau.value) },
      { key: 'roas365', v: G.metrics.roas365.value.toFixed(0) + '%' },
      { key: 'roas7', v: G.metrics.roas7.value.toFixed(0) + '%' },
      { key: 'subShare', v: G.metrics.subShare.value.toFixed(0) + '%' }
    ];
    h += '<div class="ckTableWrap"><table class="ckTable ckGateTable"><thead><tr>'
      + '<th>метрика</th><th>значение</th><th>kill &lt;</th><th>scale ≥</th><th>вердикт</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = GATES[r.key], band = G.verdicts[r.key];
      var killV = g.unit === '$' ? money(g.kill) : g.kill + g.unit, scaleV = g.unit === '$' ? money(g.scale) : g.scale + g.unit;
      h += '<tr><td>' + esc(g.label) + '</td><td><b>' + r.v + '</b></td><td>' + killV + '</td><td>' + scaleV + '</td><td class="ckBand ' + band + '">' + bandLabel[band] + '</td></tr>';
    });
    h += '</tbody></table></div>';

    // Разбивка ARPDAU / выручки
    h += '<div class="ckMini">ARPDAU: реклама ' + money(G.adArpdau) + ' (' + G.adShare.toFixed(0) + '%) · подписка '
      + money(G.subArpdau) + ' (' + G.subShare.toFixed(0) + '%) · IAP ' + money(G.iapArpdau) + ' (' + G.iapShare.toFixed(0)
      + '%) → blended ' + money(G.blended) + '. Цель сплита 65/22/13 (06 §1).</div>';
    h += '<div class="ckMini">LT(365) = ' + G.scn.lt365 + ' (сценарий «' + G.scn.label + '») · LTV(365) = ' + money(G.ltv365)
      + ' · LTV(7) = ' + money(G.ltv7) + ' · CPI = ' + money(G.cpi) + ' · триал→платная = ' + (G.trialConv * 100).toFixed(0) + '%</div>';

    // Виджет чувствительности подписки
    h += '<div class="ckSens"><div class="ckSensTitle">🔬 Чувствительность к подписке (подписка-зависимый LTV)</div>';
    h += '<div class="ckSensNote">Подписка — главный платный продукт (06 §5.1) и держит LTV(365): её net-ARPU в ~2,5× '
      + 'выше blended (05 §6). Проверяем хрупкость: что с ROAS(365), если триал-конверсия обвалится.</div>';
    h += '<table class="ckTable ckSensTable"><thead><tr><th>сценарий подписки</th><th>blended ARPDAU</th><th>ROAS(365)</th><th>вердикт по ROAS365</th></tr></thead><tbody>';
    var sensRows = [
      { label: 'база (триал ' + (G.trialConv * 100).toFixed(0) + '%)', bl: G.blended, roas: G.roas365 },
      { label: 'триал −50%', bl: G.sens.blendedHalf, roas: G.sens.roas365Half },
      { label: 'подписки нет', bl: G.sens.blendedNoSub, roas: G.sens.roas365NoSub }
    ];
    sensRows.forEach(function (sr) {
      var band = sr.roas < GATES.roas365.kill ? 'kill' : (sr.roas < GATES.roas365.scale ? 'iterate' : 'scale');
      h += '<tr><td>' + esc(sr.label) + '</td><td>' + money(sr.bl) + '</td><td>' + sr.roas.toFixed(0) + '%</td>'
        + '<td class="ckBand ' + band + '">' + (band === 'kill' ? 'KILL' : band === 'iterate' ? 'ITERATE' : 'SCALE') + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="ckSensNote">Обвал триал-конверсии вдвое роняет ROAS(365) на <b>' + Math.abs(G.sens.killPct).toFixed(0)
      + '%</b>' + (G.sens.roas365Half < GATES.roas365.kill && G.roas365 >= GATES.roas365.kill ? ' и переводит проект в <b class="ckKillTxt">KILL</b>' : '')
      + '. Вывод: LTV(365) держится на подписке — приоритет soft launch = защитить триал→платную конверсию (пейволл, длина триала A/B).</div>';
    h += '</div>';

    // Итоговый вердикт
    var vlabel = { kill: 'KILL — остановка проекта с ретро', iterate: 'ITERATE — цикл итераций (+4–6 недель)', scale: 'GO / SCALE — global launch' };
    var reasons = [];
    for (var key in G.verdicts) if (G.verdicts[key] === G.verdict) reasons.push(GATES[key].label.split(' (')[0]);
    var iterExhausted = (G.verdict === 'iterate' && G.iterateCount >= G.iterateLimit);
    h += '<div class="ckVerdict ' + G.verdict + '"><div class="ckVerdictTop">Вердикт: <b>' + vlabel[G.verdict] + '</b></div>';
    if (G.verdict === 'kill') h += '<div class="ckVerdictWhy">Метрика ниже kill-порога (' + reasons.join(', ') + '). '
      + 'Kill-критерий 09 §4.3: D1 < 37% ИЛИ ARPDAU < $0.055 ИЛИ ROAS D365 < 80% после 3 итераций → не выходим в global.</div>';
    else if (G.verdict === 'scale') h += '<div class="ckVerdictWhy">Все метрики на scale-порогах — гейт Прохода Г пройден '
      + '(D1 ≥40, ARPDAU ≥$0.085, ROAS365 ≥151%, ROAS7 ≥18%, подписка ≥22%). Путь в global.</div>';
    else {
      h += '<div class="ckVerdictWhy">Метрики в «серой зоне» (' + reasons.join(', ') + ')'
        + (G.flags.length ? ' + находки симулятора (M-9/M-12) удерживают от scale' : '') + '. Итераций: <b>' + G.iterateCount + ' / ' + G.iterateLimit + '</b>.</div>';
      if (iterExhausted) h += '<div class="ckVerdictWhy ckWarn">⚠ Лимит из ' + G.iterateLimit + ' iterate-циклов исчерпан (09 §4.3): дальше — жёсткое kill/scale на данных.</div>';
      h += '<button type="button" class="ckGhost" id="ckIterBtn"' + (iterExhausted ? ' disabled' : '') + '>Зафиксировать iterate-цикл (' + G.iterateCount + '→' + (G.iterateCount + 1) + ')</button>';
      h += '<button type="button" class="ckGhost" id="ckIterReset">сбросить счётчик</button>';
    }
    h += '</div></div>';
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
    body.querySelectorAll('.ckRange, .ckNum').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var key = inp.getAttribute('data-knob');
        setKnob(key, inp.value);
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

    var nEl = el('ckN'), nVal = el('ckNval');
    if (nEl) nEl.addEventListener('input', function () { state.simN = parseInt(nEl.value, 10); if (nVal) nVal.textContent = state.simN; saveState(); });
    var abT = el('ckApplyAB'); if (abT) abT.addEventListener('change', function () { state.applyAB = abT.checked; saveState(); });

    var runBtn = el('ckRunBtn');
    if (runBtn) runBtn.addEventListener('click', function () {
      runBtn.disabled = true; runBtn.textContent = '⏳ считаю…';
      setTimeout(function () { runSim(); renderAll(); }, 20);
    });

    body.querySelectorAll('.ckCompareBtn').forEach(function (b) { b.addEventListener('click', function () { compareAB(b.getAttribute('data-exp')); }); });

    var scSel = el('ckScenario'); if (scSel) scSel.addEventListener('change', function () { state.retScenario = scSel.value; saveState(); renderAll(); });
    var cpiEl = el('ckCpi'); if (cpiEl) cpiEl.addEventListener('change', function () { state.cpi = parseFloat(cpiEl.value) || 1.20; saveState(); renderAll(); });
    var iapEl = el('ckIap'); if (iapEl) iapEl.addEventListener('change', function () { state.iapArpdau = parseFloat(iapEl.value) || 0; saveState(); renderAll(); });
    var trEl = el('ckTrial'); if (trEl) trEl.addEventListener('change', function () { state.trialRate = parseFloat(trEl.value) || 0; saveState(); renderAll(); });
    var iterBtn = el('ckIterBtn'); if (iterBtn) iterBtn.addEventListener('click', function () { state.iterateCount = Math.min(state.iterateCount + 1, MAX_ITERATE); saveState(); renderAll(); });
    var iterReset = el('ckIterReset'); if (iterReset) iterReset.addEventListener('click', function () { state.iterateCount = 0; saveState(); renderAll(); });
  }
  function refreshSessLine() { var sess = el('cockpitSess'); if (sess) sess.innerHTML = 'A/B: <code>' + esc(abGroupsString()) + '</code>'; }

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
        EXPERIMENTS.forEach(function (other) { if (other.id !== exp.id) applyOver(over, assignedVariant(other).over); });
        applyOver(over, state.tune);
        applyOver(over, vr.over);
        var coh = Sim.run({ N: state.simN, days: 30, runId: 'ab:' + exp.id + ':' + vr.id, mode: 'COHORT', tune: over });
        var mc = Sim.run({ N: state.simN, days: 30, runId: 'ab:' + exp.id + ':' + vr.id, mode: 'MC', tune: over });
        // sub-ARPDAU для этого варианта (длина триала может отличаться).
        var scn = RET_SCENARIOS[state.retScenario] || RET_SCENARIOS.base;
        var td = over.trialDays || 7, tc = TRIAL_CONV[td] || SUB.trialConv;
        var subA = subArpdauFor(scn, tc, state.trialRate || SUB.trialRate);
        var blended = coh.aggregates.adArpdau + subA + (state.iapArpdau || 0);
        return {
          id: vr.id, label: vr.label, adArpdau: coh.aggregates.adArpdau, subArpdau: subA, blended: blended,
          roas365: state.cpi > 0 ? scn.lt365 * blended / state.cpi * 100 : 0,
          balD30: mc.byDay[29].balanceMedianCore, deficitD30: mc.aggregates.deficitShareD30
        };
      });
      var a = res[0], b = res[1];
      var primary = { hint_price: 'balD30', sub_trial: 'subArpdau', int_cap: 'adArpdau' }[exp.id];
      var dPrim = a[primary] ? (b[primary] - a[primary]) / a[primary] * 100 : 0;
      var h = '<table class="ckTable ckCmpTable"><thead><tr><th>вариант</th><th>ad-ARPDAU</th><th>sub-ARPDAU</th>'
        + '<th>ROAS365</th><th>баланс D30</th><th>деф D30</th></tr></thead><tbody>';
      res.forEach(function (rr) {
        h += '<tr><td><b>' + esc(rr.id) + '</b> ' + esc(rr.label) + '</td><td>' + money(rr.adArpdau) + '</td>'
          + '<td>' + money(rr.subArpdau) + '</td><td>' + rr.roas365.toFixed(0) + '%</td><td>' + rr.balD30 + '</td><td>' + (rr.deficitD30 * 100).toFixed(0) + '%</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="ckMini">Δ первичной (' + esc(exp.primary) + ', B−A) = <b>' + (dPrim >= 0 ? '+' : '') + dPrim.toFixed(1) + '%</b> · '
        + 'guardrail: ' + esc(exp.guardrail) + '. Детерминировано (свой runId на вариант).</div>';
      if (out) out.innerHTML = h;
    }, 20);
  }

  /* ============================== ОТКРЫТИЕ ============================== */
  function open() {
    var sc = el('cockpitScreen'); if (sc) sc.classList.remove('hidden');
    if (!lastMC) runSim();
    renderAll();
  }
  function close() { var sc = el('cockpitScreen'); if (sc) sc.classList.add('hidden'); }
  function bind() {
    var openBtn = el('btn-cockpit'); if (openBtn) openBtn.addEventListener('click', open);
    var closeBtn = el('cockpitCloseBtn'); if (closeBtn) closeBtn.addEventListener('click', close);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  }

  /* Публичный API (для дашборда монетизации и отладки). */
  return {
    getAssignments: getAssignments, abGroupsString: abGroupsString, buildOverrides: buildOverrides,
    runSim: runSim, computeGates: computeGates, open: open, close: close,
    EXPERIMENTS: EXPERIMENTS, KNOBS: KNOBS
  };
})();
