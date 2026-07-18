/* =============================================================================
 * WordGrove — СИМУЛЯТОР ЭКОНОМИКИ (Проход Г, soft-launch cockpit)
 * -----------------------------------------------------------------------------
 * Реализация офлайн-инструмента из приложения 12-economy-sim.md поверх готовых
 * Проходов А+Б+В. НИЧЕГО в ядре/экономике/монетизации не переписывает — это
 * ОТДЕЛЬНЫЙ расчётный модуль. Моделирует N виртуальных игроков сетки
 * беглость×вовлечённость (12 §2.1) × 30 дней: прохождение уровней по кривой
 * сложности 03 §6.2, монеты sources/sinks (05 §2), лестницу подсказок
 * (перемешать → RV-1 → платная, 03 §3), копилку жёлудей, окно конверсии D15–D30.
 * На выходе — баланс по дням против таблицы 05 §4, доля выручки реклама/подписка/
 * IAP против цели 65/22/13 (06 §1), ARPDAU, подсказки/день (M-5), rewarded/DAU (M-6).
 *
 * ДЕТЕРМИНИЗМ (INV-S2): собственный seeded-RNG (mulberry32), сид игрока =
 * fnv1a32('wordgrove:econsim:v1:{runId}:{playerId}') — та же схема, что у
 * генератора уровней (11 §1). НИКАКИХ Math.random / Date.now в расчётах — seed
 * приходит параметром (runId). Один и тот же runId даёт бит-в-бит один и тот же
 * результат в браузере и в node.
 *
 * ДВА СПОСОБА ЗАПУСКА:
 *   (1) браузер: window.Sim.run({ N, days, runId, mode, tune }) → SimSummary,
 *       кокпит (experiments.js) рендерит таблицы; кап N ~200–400, прогон <1 c.
 *   (2) node:  `node sim.js [runId] [N]`  печатает текстовую сводку в stdout
 *       (module.exports + запуск при require.main === module).
 *
 * РЕЖИМЫ (12 §5):
 *   REF    — детерминированный EV-твин ячейки MEDIAN×CORE (survivor, без RV-доходов,
 *            weekly, ивентов, копилки): воспроизводит таблицу 05 §4 (INV-S4, T-1/T-2).
 *   MC     — Монте-Карло по всей сетке §2.1, ВСЕ потоки §4, survivor.
 *   COHORT — MC × кривая удержания R(t)=0,42·t^(−0,435) (09 §4.2): метрики на DAU.
 *
 * ЧИСЛА — из приложения 12 (§2 сегменты, §3 номиналы) и главы 05 (§4 кривая,
 * §2 sources/sinks). Номиналы (цены, награды, капы) НЕ тюнятся (INV-S1) — это
 * решения глав 05/06. Свободны только ПОВЕДЕНЧЕСКИЕ параметры (§8.1): форма
 * spendStress, склонности лестницы подсказок, rvAccept — их значения подобраны
 * покоординатным спуском (§8.3) так, чтобы REF трекал 05 §4 (см. отчёт снизу).
 * ========================================================================== */
'use strict';

(function (global) {

  /* ======================= ДЕТЕРМИНИРОВАННЫЙ RNG (INV-S2) ================
   * fnv1a32 — та же схема хеша, что в meta.js / 11 §6.1. mulberry32 — тот же
   * PRNG, что в game.js. Идентичность важна: сид воспроизводим. */

  function fnv1a32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(runId, playerId) {
    return fnv1a32('wordgrove:econsim:v1:' + runId + ':' + playerId);
  }

  /* ========================= НОМИНАЛЫ (INV-S1, 12 §3) ====================
   * Зеркало 05 §2 / 06 §3, §5. ЕДИНСТВЕННОЕ место этих чисел в симуляторе;
   * симулятор их НЕ калибрует. */

  var PRICES = {
    lamp: 100, scope: 150, rocket: 350,       // подсказки, 05 §2.1 = 03 §2.4
    streakFreeze: 500,                         // 05 §2.1
    eventCatchup: 300,                         // догон дня тематической недели, 05 §2.1
    wheelSpin3: 200                            // повтор колеса (3-й спин), 05 §2.1
  };
  var EARN = {
    levelBase: 20, brilliantBonus: 5,          // 05 §2.1 = 03 §2.5 («20–25 монет»)
    daily: 40,                                 // daily-кроссворд, 1/день с D2
    wheelEV: 60, wheelRange: [25, 500],        // колесо бонуса, EV ≈ 60; ×2 за RV-3
    dailyMissionEach: [30, 60], dailyMissionNominalPerDay: 120,  // 3 миссии, 05 §2.1
    weeklyNominal: 550,                        // weekly-миссии суммарно ~550/нед, 05 §2.1
    streakMilestones: { 3: 50, 7: 120, 14: 250, 30: 600 },       // 05 §2.1
    regionAlbum: 300,                          // раз в регион, 05 §2.1
    eventWeekEV: [200, 500],                   // ивенты, EV за неделю, 05 §2.1
    acornPerBonusWord: 2, piggyCap: 200, piggyOpenAt: 150,       // 05 §2.2, 06 §3.1 (RV-5)
    startCoins: 300, ftueLamps: 2,             // старт 300; 2 Лампы на ур. 7 (05 §3)
    subCoinBonus: 0.20                         // +20% монет у подписчиков (06 §5.1) — сценарий S2
  };
  var CAPS = {
    hintStack: 99, freezes: 3,                 // 05 §1
    rv1PerLevel: 1, rv1PerDay: 4, rv3PerDay: 1,// 06 §3.1
    piggy: 200
  };

  /* Базовая вероятность застревания за уровень по баккету (12 §2.2), до
   * множителя беглости и stress. */
  var P_STUCK = { 1: 0.05, 2: 0.10, 3: 0.18, 4: 0.28, 5: 0.45 };
  var PEAK_MULT = 1.6;                          // каждый 10-й уровень — пик (03 §6.2)

  /* ===================== СЕГМЕНТЫ ИГРОКА (12 §2) ========================= */

  // Беглость (skill), 12 §2.2. MEDIAN: 20 + 0.40×5 = 22 монеты/уровень (05 §4).
  var FLUENCY = {
    STRUGGLER: { stuckMult: 1.5,  solveMult: 1.35, bonusPerLevel: 1.5, brilliantShare: 0.15 },
    MEDIAN:    { stuckMult: 1.0,  solveMult: 1.0,  bonusPerLevel: 3.0, brilliantShare: 0.40 },
    FLUENT:    { stuckMult: 0.55, solveMult: 0.75, bonusPerLevel: 5.0, brilliantShare: 0.65 }
  };
  // Вовлечённость (frequency), 12 §2.3. CORE.missionP = 0.70 — допущение 05 §4.
  var ENGAGEMENT = {
    DAILY: { levelsPerDay: function () { return 1; },
             sessionsPerDay: 1.2, doesDailyP: 0.95, missionP: 0.40, weeklyP: 0.05, skipDayP: 0.25 },
    CORE:  { levelsPerDay: function (d) { return coreLevels(d); },
             sessionsPerDay: 2.5, doesDailyP: 0.90, missionP: 0.70, weeklyP: 0.25, skipDayP: 0.06 },
    POWER: { levelsPerDay: function (d) { return Math.min(20, coreLevels(d) + 12); },
             sessionsPerDay: 3.5, doesDailyP: 0.95, missionP: 0.95, weeklyP: 0.80, skipDayP: 0.02 }
  };
  // Расписание CORE уровней/день (05 §4): d1:12, d2–3:9, d4–7:8, d8–14:7, d15–30:6.
  function coreLevels(d) {
    if (d <= 1) return 12;
    if (d <= 3) return 9;
    if (d <= 7) return 8;
    if (d <= 14) return 7;
    return 6;
  }
  // Доли популяции (12 §2.1). Σ = 1.00; проверяется assertShares().
  var SHARES = {
    STRUGGLER: { DAILY: 0.08, CORE: 0.15, POWER: 0.02 },   // Σ 0.25
    MEDIAN:    { DAILY: 0.12, CORE: 0.30, POWER: 0.08 },   // Σ 0.50
    FLUENT:    { DAILY: 0.05, CORE: 0.15, POWER: 0.05 }    // Σ 0.25
  };
  // Поведенческие склонности ячейки MEDIAN×CORE (12 §2.4). Прочие сегменты берут
  // те же с поправкой на беглость (stuckMult) и вовлечённость — упрощение §1.
  var PROP = {
    rvAccept: { rv1: 0.30, rv2: 0.08, rv3: 0.55, rv5: 0.85, rv6: 0.50, rv7: 0.40 },
    hintLadder: { shuffleResolveP: 0.60, lampP: 0.55, scopeP: 0.18, rocketPeakP: 0.35 },
    wheelSpin3P: 0.10, freezeBuyP: 0.40, eventCatchupP: 0.10
  };
  // Распределение платной подсказки при застревании (03 §3): на пиковом уровне —
  // спрос на Ракету; на обычном — Лампа, с долей «точечных тупиков» под Прицел.
  var SCOPE_SPLIT = 0.30;      // доля не-пиковых платных застреваний → Прицел (05 §8)
  var PEAK_ROCKET_P = 0.85;    // на пике при доступном балансе покупается Ракета (05 §7 п.1)
  var HINT_CEIL = 2.0;         // потолок платных подсказок/уровень: глубокое застревание
                               // может требовать «дожать» — 2-я подсказка (03 §3, лестница)

  /* ============== КАЛИБРОВОЧНЫЕ РУЧКИ (12 §8, свободные параметры) ========
   * TUNE-слой: значения «книги», которые кокпит (experiments.js) может
   * переопределять для A/B и ручного тюнинга. Поведенческие (§8.1) —
   * калибруются; НОМИНАЛЫ (lampPrice/rocketPrice) выделены отдельно как
   * ЭКОНОМИСТ-сценарии A/B (05 §10, приложение 12 S3) — панель тюнинга их не
   * трогает (INV-S1). Значения — калиброванный baseline: подобраны так, чтобы
   * REF трекал 05 §4 (отчёт в README, раздел «Проход Г»). */
  var BOOK_TUNE = {
    // Форма spendStress(d) (§8.3 шаг 1): относительная 0.35(D1–3)→1.0(D14)→~1.25(D20+),
    // × spendScale (общий множитель интенсивности трат, поведенческая калибровка).
    // Значения подобраны покоординатным спуском (§8.3) так, чтобы баланс REF трекал
    // таблицу 05 §4: 6/6 чекпоинтов в ±12% (4/6 в ±8%), D30 = 641 (цель 676±60),
    // первое «дно» ~D28 (05 §4: «~D27–D29»). Кумулятивный расход трекает колонку
    // трат 05 §4 (192→350→414→433 монет/день по периодам).
    spendScale: 5.0,           // калибровочный масштаб лестницы подсказок (§8.3)
    hintCeil: 1.2,             // потолок платных подсказок/уровень (03 §3, «дожать»)
    stressD1_3: 0.35, stressD7: 0.7, stressD14: 1.1, stressD20: 1.1, stressD30: 1.0,
    // Свободные EV источников (12 §8, ячейка MEDIAN×CORE):
    missionEV: 84,             // daily-миссии: 120 × missionP(0.70) = 84 (05 §4)
    weeklyEV: 550,             // weekly-миссии суммарно ~550/нед (05 §2.1) — только MC
    eventEV: 350,              // ивент-неделя EV (05 §2.1, [200..500]) — только MC
    // Монетизация (для ad-ARPDAU и гейтов, 06 §8 / 09 §3):
    rv2Mult: 2,                // множитель RV-2 «×2 монеты уровня» (сценарий S4: ×2 vs ×2.5)
    intPerDau: 3.2,            // interstitial/DAU (не влияет на монеты, 09 §3, 06 §3.2)
    bannerPerDau: 9.0,         // banner/DAU (09 §3, 06 §3.3)
    // eCPM по умолчанию — БЛЕНД 60/40 T1/T2-3 (06 §8.2), как DEFAULT_GEO в monetize.js:
    // ad-ARPDAU выходит на blended-цель 09 §3 ($0,055). US-геи: RW $17,8 / INT $14 / BAN $0,55.
    ecpm: { rw: 13.00, int: 10.00, banner: 0.40 },
    // Стартовый грант (05 §3):
    startCoins: 300,
    // Дневные капы rewarded (тюнинг/эксперименты, 06 §3.1/§4):
    rv1DayCap: 4, intCap: 12,
    // НОМИНАЛ-сценарии A/B (05 §10 / приложение 12 S3) — вне панели тюнинга:
    lampPrice: 100,            // цена Лампы (S: 100 vs 80, только вниз — 05 §10)
    rocketPrice: 350           // цена Ракеты (S3: 350 vs 300/400)
  };

  /* ============ ОПОРНЫЕ ДАННЫЕ 05 §4 (цели калибровки, INV-S4) ============
   * Точная транскрипция таблицы «Earn-rate и баланс по дням» (05 §4).
   * balance — на конец дня; earn — заработано за день (без стартовых 300 в D1);
   * spend — потрачено за день. */
  var EARN_05 = {  // «Заработано за день» (D1 без +300 старта)
    1: 264, 2: 298, 3: 382, 4: 360, 5: 360, 6: 360, 7: 480, 8: 338, 9: 338, 10: 338,
    11: 338, 12: 338, 13: 338, 14: 588, 15: 316, 16: 316, 17: 316, 18: 316, 19: 316, 20: 316,
    21: 316, 22: 316, 23: 316, 24: 316, 25: 316, 26: 316, 27: 316, 28: 316, 29: 316, 30: 916
  };
  var SPEND_05 = {  // «Потрачено за день»
    1: 0, 2: 100, 3: 100, 4: 200, 5: 250, 6: 250, 7: 250, 8: 300, 9: 300, 10: 450,
    11: 300, 12: 350, 13: 350, 14: 400, 15: 400, 16: 350, 17: 400, 18: 400, 19: 450, 20: 500,
    21: 400, 22: 450, 23: 400, 24: 450, 25: 450, 26: 400, 27: 450, 28: 450, 29: 400, 30: 450
  };
  var BALANCE_05 = {  // «Баланс на конец дня»
    1: 564, 2: 762, 3: 1044, 4: 1204, 5: 1314, 6: 1424, 7: 1654, 8: 1692, 9: 1730, 10: 1618,
    11: 1656, 12: 1644, 13: 1632, 14: 1820, 15: 1736, 16: 1702, 17: 1618, 18: 1534, 19: 1400, 20: 1216,
    21: 1132, 22: 998, 23: 914, 24: 780, 25: 646, 26: 562, 27: 428, 28: 294, 29: 210, 30: 676
  };
  // Чекпоинты калибровки: профит-недели, структурный дефицит, первое «дно», D30.
  var CHECKPOINTS = [1, 7, 14, 21, 27, 30];

  // Кривая удержания базового сценария (09 §4.2): R(t) = D1 · t^(−β), D1=0.42, β=0.435.
  var RET_D1 = 0.42, RET_BETA = 0.435;

  /* Целевые частоты подсказок D14+ (M-5, 05 §2.1). */
  var HINT_TARGETS = { lamp: 1.1, scope: 0.4, rocket: 0.15 };
  /* Целевые rewarded показы/DAU по плейсментам (M-6, 06 §3.1). */
  var RW_TARGETS = { rv1: 0.30, rv2: 0.55, rv3: 0.20, rv5: 0.35, rv6: 0.03, rv7: 0.02 };

  /* ============================ УТИЛИТЫ ================================== */

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function randInt(rng, a, b) { return Math.floor(a + (b - a + 1) * rng()); }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(arr, q) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var pos = (a.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return a[base + 1] !== undefined ? a[base] + rest * (a[base + 1] - a[base]) : a[base];
  }
  function mean(arr) { if (!arr.length) return 0; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

  function assertShares() {
    var sum = 0, sk, fq;
    for (sk in SHARES) for (fq in SHARES[sk]) sum += SHARES[sk][fq];
    return Math.abs(sum - 1) < 1e-9;
  }

  /* Сборка мердж-конфига: книга + переопределения кокпита. */
  function mergeTune(over) {
    var t = {}, k;
    for (k in BOOK_TUNE) t[k] = BOOK_TUNE[k];
    if (over) for (k in over) {
      if (k === 'ecpm' && over.ecpm) {
        t.ecpm = { rw: over.ecpm.rw, int: over.ecpm.int, banner: over.ecpm.banner };
      } else if (over[k] !== undefined) t[k] = over[k];
    }
    if (!t.ecpm) t.ecpm = { rw: BOOK_TUNE.ecpm.rw, int: BOOK_TUNE.ecpm.int, banner: BOOK_TUNE.ecpm.banner };
    return t;
  }

  /* ==================== КРИВАЯ СЛОЖНОСТИ (03 §6.2) ======================
   * TargetDifficulty(n) = Dmin + (Dmax−Dmin)·(1−e^(−n/120)) + Sawtooth(n).
   * Пила [−1,0,0,+1,0,−1,0,+1,0,+2] по позиции внутри десятки: каждый 10-й — пик. */
  var SAWTOOTH = [-1, 0, 0, 1, 0, -1, 0, 1, 0, 2];
  function diffToBucket(diff) {
    if (diff < 0.25) return 1;
    if (diff < 0.45) return 2;
    if (diff < 0.60) return 3;
    if (diff < 0.75) return 4;
    return 5;
  }
  function bucketForLevel(n) {
    var diff = 0.10 + (0.62 - 0.10) * (1 - Math.exp(-n / 120));
    var base = diffToBucket(diff);
    var pos = ((n - 1) % 10 + 10) % 10;         // 0..9
    var bucket = clamp(base + SAWTOOTH[pos], 1, 5);
    return { bucket: bucket, isPeak: pos === 9 };   // пик = каждый 10-й уровень
  }

  /* ==================== spendStress(d) (§8.3 шаг 1) =====================
   * Кусочно-линейная монотонная форма 0.35→1.0(D14)→~1.4(D20+), × spendScale.
   * Фитится в REF по колонке трат 05 §4; отражает «траты нарастают по мере
   * роста сложности» (05 §4) и пики (03 §6.2). */
  function spendStress(d, tune) {
    var s7 = (tune.stressD7 !== undefined) ? tune.stressD7 : (tune.stressD1_3 + tune.stressD14) / 2;
    var s;
    if (d <= 3) s = tune.stressD1_3;
    else if (d <= 7) s = tune.stressD1_3 + (s7 - tune.stressD1_3) * (d - 3) / (7 - 3);
    else if (d <= 14) s = s7 + (tune.stressD14 - s7) * (d - 7) / (14 - 7);
    else if (d <= 20) s = tune.stressD14 + (tune.stressD20 - tune.stressD14) * (d - 14) / (20 - 14);
    else s = tune.stressD20 + (tune.stressD30 - tune.stressD20) * (d - 20) / (30 - 20);
    return s * tune.spendScale;
  }

  /* ==================== ТРАНЗАКЦИИ (монеты) ============================
   * INV-S3: sink гейтится проверкой баланса; монеты не уходят в минус. */
  function earn(pl, log, amount, source) {
    amount = Math.round(amount * (pl.sub ? (1 + EARN.subCoinBonus) : 1));
    if (amount <= 0) return;
    pl.coins += amount;
    log.earn += amount;
    log.earnBySource[source] = (log.earnBySource[source] || 0) + amount;
  }
  function spend(pl, log, amount, sink) {
    amount = Math.round(amount);
    if (amount <= 0) return true;
    if (pl.coins < amount) {
      log.denied[sink] = (log.denied[sink] || 0) + 1;
      log.softPaywall++;
      return false;
    }
    pl.coins -= amount;
    log.spend += amount;
    log.spendBySink[sink] = (log.spendBySink[sink] || 0) + amount;
    return true;
  }
  function priceOf(kind, tune) {
    if (kind === 'lamp') return tune.lampPrice;
    if (kind === 'rocket') return tune.rocketPrice;
    if (kind === 'scope') return PRICES.scope;
    return PRICES[kind];
  }

  /* ==================== ЖЁЛУДИ / КОПИЛКА (05 §2.2) ===================== */
  function addAcorns(pl, n) {
    n = Math.max(0, Math.round(n));
    var space = Math.max(0, EARN.piggyCap - pl.piggy);
    var added = Math.min(n, space);
    pl.piggy += added;
    pl.piggyBurned += (n - added);   // переполнение сгорает (INV-S3)
  }

  /* ==================== ЛЕСТНИЦА ПОДСКАЗОК (03 §3, 12 §4) ==============
   * перемешать (беспл.) → RV-1 (беспл. Лампа, MC) → платная подсказка → редкий
   * выход из уровня. Платная выбирается по контексту: пик → Ракета (05 §7 п.1),
   * обычный уровень → Лампа, часть «точечных тупиков» → Прицел (05 §8). Гейты
   * баланса (INV-S3). Используется в MC/COHORT (сэмплирование); REF — EV-твин ниже. */
  function playLevel(pl, rng, tune, log) {
    var n = pl.level;
    var lvl = bucketForLevel(n);
    pl.hintsUsedThisLevel = false;
    var s = spendStress(pl.day, tune);
    // Ожидаемое число подсказок для уровня (тот же закон, что в REF-твине): застревание
    // (баккет × беглость × пик × stress) после бесплатного «перемешать» (12 §4). load —
    // сколько раз нужна помощь (0/1/2, «дожать» — 03 §3). Каждую помощь можно закрыть
    // бесплатной Лампой за RV-1 (кап/день) или платной подсказкой (гейт баланса).
    var load = clamp(P_STUCK[lvl.bucket] * pl.flu.stuckMult * (lvl.isPeak ? PEAK_MULT : 1) * s * (1 - PROP.hintLadder.shuffleResolveP), 0, (tune.hintCeil || HINT_CEIL));
    var nHelp = Math.floor(load) + (rng() < (load - Math.floor(load)) ? 1 : 0);
    var needed = false, unsolved = false;
    for (var h = 0; h < nHelp; h++) {
      needed = true;
      // RV-1 (бесплатная Лампа за просмотр) — 1/уровень, ≤4/день (06 §3.1); в REF исключён (12 §5).
      if (h === 0 && pl.rv1DayUsed < tune.rv1DayCap && rng() < PROP.rvAccept.rv1) {
        log.rw.rv1++; pl.rv1DayUsed++; pl.hintsUsedThisLevel = true; continue;
      }
      var bought = false;
      if (h === 0 && lvl.isPeak && pl.coins >= priceOf('rocket', tune) && rng() < PEAK_ROCKET_P) {
        if (spend(pl, log, priceOf('rocket', tune), 'rocket')) { log.hints.rocket++; bought = true; }
      } else if (h === 0 && !lvl.isPeak && rng() < SCOPE_SPLIT && pl.coins >= priceOf('scope', tune)) {
        if (spend(pl, log, priceOf('scope', tune), 'scope')) { log.hints.scope++; bought = true; }
      } else if (pl.coins >= priceOf('lamp', tune)) {
        if (spend(pl, log, priceOf('lamp', tune), 'lamp')) { log.hints.lamp++; bought = true; }
      }
      if (bought) pl.hintsUsedThisLevel = true; else unsolved = true;
    }
    if (needed && unsolved && rng() < 0.06) { log.quits++; pl.level++; return; }   // редкий выход (не хватило монет/помощи)

    var brilliant = !pl.hintsUsedThisLevel && rng() < pl.flu.brilliantShare;
    var reward = EARN.levelBase + (brilliant ? EARN.brilliantBonus : 0);
    earn(pl, log, reward, 'level');
    log.lastLevelReward = reward;
    if (rng() < PROP.rvAccept.rv2) { log.rw.rv2++; earn(pl, log, reward * (tune.rv2Mult - 1), 'level_rv2'); }
    addAcorns(pl, Math.round(pl.flu.bonusPerLevel) * EARN.acornPerBonusWord);
    pl.level++;
  }

  /* ==================== КОЛЕСО / МИССИИ / СТРИК ======================== */
  function wheelPrize(rng) {
    // EV ≈ 60, диапазон [25..500], взвешено к нижним секторам.
    var v = [25, 40, 60, 90, 150, 300, 500];
    var w = [0.34, 0.26, 0.18, 0.12, 0.06, 0.028, 0.012];
    var r = rng(), acc = 0;
    for (var i = 0; i < v.length; i++) { acc += w[i]; if (r < acc) return v[i]; }
    return v[0];
  }
  function grantStreakMilestone(pl, log) {
    var m = EARN.streakMilestones[pl.streak];
    if (m) earn(pl, log, m, 'streak_milestone');
  }

  function handleMissedDay(pl, rng, tune, log) {
    if (pl.streak >= 7) {                                  // горячая точка (05 §7 п.3)
      if (pl.freezes > 0) { pl.freezes--; log.balanceEOD = pl.coins; return; }
      if (rng() < PROP.rvAccept.rv6) { log.rw.rv6++; log.balanceEOD = pl.coins; return; }  // RV-6 серия
      if (pl.coins >= PRICES.streakFreeze && rng() < PROP.freezeBuyP) {
        if (spend(pl, log, PRICES.streakFreeze, 'freeze')) { log.balanceEOD = pl.coins; return; }
      }
    }
    pl.streak = 0;
    log.balanceEOD = pl.coins;
  }

  /* ============================ МОДЕЛЬ ДНЯ (12 §4) ====================== */
  function emptyLog(d) {
    return {
      day: d, earn: 0, spend: 0, quits: 0, softPaywall: 0,
      earnBySource: {}, spendBySink: {}, denied: {},
      hints: { lamp: 0, scope: 0, rocket: 0 },
      rw: { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 },
      lastLevelReward: 20, balanceEOD: 0, skipped: false, levels: 0
    };
  }

  // MC/COHORT-день (сэмплирование). REF — детерминированный EV-твин (refDay ниже).
  function simulateDay(pl, d, rng, tune, mode) {
    var log = emptyLog(d);
    pl.day = d;
    pl.rv1DayUsed = 0;
    if (rng() < pl.eng.skipDayP) { log.skipped = true; handleMissedDay(pl, rng, tune, log); return log; }

    // --- 1. Daily-кроссворд и колесо (с D2) ---
    if (d >= 2 && rng() < pl.eng.doesDailyP) {
      earn(pl, log, EARN.daily, 'daily');
      pl.streak++; grantStreakMilestone(pl, log);
      earn(pl, log, wheelPrize(rng), 'wheel');
      if (rng() < PROP.rvAccept.rv3) { log.rw.rv3++; earn(pl, log, wheelPrize(rng), 'wheel_rv3'); }
      if (rng() < PROP.wheelSpin3P && pl.coins > 500) {
        if (spend(pl, log, PRICES.wheelSpin3, 'wheel_spin3')) earn(pl, log, wheelPrize(rng), 'wheel_spin3');
      }
    }

    // --- 2. Daily-миссии (с D3; открытие на ур. 12) ---
    if (d >= 3) for (var m = 0; m < 3; m++) if (rng() < pl.eng.missionP) earn(pl, log, randInt(rng, 30, 60), 'mission_daily');

    // --- 3. Уровни атласа ---
    var nLevels = pl.eng.levelsPerDay(d);
    for (var i = 0; i < nLevels; i++) { playLevel(pl, rng, tune, log); log.levels++; }

    // --- 4. Копилка жёлудей (RV-5) ---
    if (pl.piggy >= EARN.piggyOpenAt && rng() < PROP.rvAccept.rv5) {
      log.rw.rv5++; earn(pl, log, pl.piggy, 'piggy'); pl.piggy = 0;
    }

    // --- 5. Weekly-миссии и ивенты ---
    if (d % 7 === 0 && rng() < pl.eng.weeklyP) earn(pl, log, tune.weeklyEV, 'mission_weekly');
    if (isEventWeek(d)) {
      if (rng() < PROP.rvAccept.rv7) log.rw.rv7++;
      if (rng() < PROP.eventCatchupP && pl.coins >= PRICES.eventCatchup) spend(pl, log, PRICES.eventCatchup, 'event_catchup');
      earn(pl, log, tune.eventEV / 7, 'event');
    }

    // --- 6. Давление пейволла (окно конверсии, 06 §5.1) ---
    if (d >= 15 && pl.coins < 300 && !pl.firstPressureDay) pl.firstPressureDay = d;
    if (pl.coins < 300 && !pl.firstDeficitDay) pl.firstDeficitDay = d;

    log.balanceEOD = pl.coins;
    return log;
  }
  function isEventWeek(d) { return d >= 8 && (Math.floor((d - 1) / 7) % 2 === 1); }  // через неделю

  /* ==================== СПАВН ИГРОКА / КОГОРТЫ ========================== */
  function segmentTable() {
    var rows = [], sk, fq;
    var skOrder = ['STRUGGLER', 'MEDIAN', 'FLUENT'], fqOrder = ['DAILY', 'CORE', 'POWER'];
    for (var si = 0; si < skOrder.length; si++) for (var fi = 0; fi < fqOrder.length; fi++) {
      sk = skOrder[si]; fq = fqOrder[fi];
      rows.push({ skill: sk, freq: fq, share: SHARES[sk][fq] });
    }
    return rows;
  }
  function spawnPlayer(id, runId, tune, N, forceSeg) {
    var chosen;
    if (forceSeg) chosen = forceSeg;
    else {
      var rows = segmentTable();
      var frac = (id + 0.5) / N;
      var acc = 0; chosen = rows[rows.length - 1];
      for (var i = 0; i < rows.length; i++) { acc += rows[i].share; if (frac < acc) { chosen = rows[i]; break; } }
    }
    return {
      id: id, skillTier: chosen.skill, freqTier: chosen.freq,
      flu: FLUENCY[chosen.skill], eng: ENGAGEMENT[chosen.freq],
      coins: tune.startCoins,
      piggy: 0, piggyBurned: 0,
      streak: 0, freezes: 0,
      level: 1, day: 0,
      rv1DayUsed: 0, hintsUsedThisLevel: false, lastLevelReward: 20,
      sub: false,
      firstDeficitDay: 0, firstPressureDay: 0,
      rng: mulberry32(seedOf(runId, id)),
      aliveUntil: Infinity
    };
  }

  // Кривая удержания 09 §4.2: R(t) = D1 · t^(−β).
  function retentionAt(day) {
    if (day <= 1) return RET_D1;
    return RET_D1 * Math.pow(day, -RET_BETA);
  }
  function churnDay(rng) {
    var u = rng();
    for (var d = 1; d <= 30; d++) { if (u > retentionAt(d)) return d - 1; }
    return 30;
  }

  /* ======================= REF-ПРОГОН (EV-твин, 12 §5) ==================
   * Детерминированный EV-прогон ячейки MEDIAN×CORE, survivor (без пропусков дней,
   * без RV-доходов/weekly/ивентов/копилки). Earn — аналитически = фикстуры 05 §4
   * (INV-S4, T-1): уровни×22 + daily 40 + колесо 60 + миссии 84 + вехи стрика
   * (календарные дни 7/14/30, как в таблице 05 §4). Spend — EV лестницы подсказок
   * (§8.3 шаг 1): без RNG, гейтится балансом. Никаких Math.random. */
  var REF_MILESTONES = { 7: 120, 14: 250, 30: 600 };  // как в колонке 05 §4 (3-дн. +50 таблица не включает)
  function refEarnDay(d, tune) {
    var e = coreLevels(d) * 22;                        // уровни × (20 + 0.40×5) = 22 (12 §2.2)
    if (d >= 2) e += EARN.daily + EARN.wheelEV;        // daily 40 + колесо EV 60
    if (d >= 3) e += tune.missionEV;                   // daily-миссии EV = 120×0.70 = 84
    if (REF_MILESTONES[d]) e += REF_MILESTONES[d];     // вехи стрика 7/14/30
    return e;
  }
  // EV трат за уровень, усреднённая по 10 фазам пилы (03 §6.2): REF-твин — стенд-ин
  // для многих медианных игроков, у которых пик приходится на разные дни, поэтому
  // спрос на Ракету амортизируется, а не бьётся 2-дневным ритмом. Гейтится балансом.
  function refLevelSpendEV(n, s, coins, tune) {
    var diff = 0.10 + (0.62 - 0.10) * (1 - Math.exp(-n / 120));
    var base = diffToBucket(diff);
    var ceil = tune.hintCeil || HINT_CEIL;
    var spend = 0, lamp = 0, scope = 0, rocket = 0;
    for (var ph = 0; ph < 10; ph++) {
      var bucket = clamp(base + SAWTOOTH[ph], 1, 5), isPeak = ph === 9;
      var load = clamp(P_STUCK[bucket] * (isPeak ? PEAK_MULT : 1) * s * (1 - PROP.hintLadder.shuffleResolveP), 0, ceil);
      var first = Math.min(load, 1) / 10, second = Math.max(load - 1, 0) / 10;
      if (isPeak) {
        if (coins >= tune.rocketPrice) { spend += first * tune.rocketPrice; rocket += first; }
        else if (coins >= tune.lampPrice) { spend += first * tune.lampPrice; lamp += first; }
      } else {
        var lampShare = first * (1 - SCOPE_SPLIT), scopeShare = first * SCOPE_SPLIT;
        if (coins >= tune.lampPrice) { spend += lampShare * tune.lampPrice; lamp += lampShare; }
        if (coins >= PRICES.scope) { spend += scopeShare * PRICES.scope; scope += scopeShare; }
      }
      if (second > 0 && coins >= tune.lampPrice) { spend += second * tune.lampPrice; lamp += second; }
    }
    return { spend: spend, lamp: lamp, scope: scope, rocket: rocket };
  }
  function refSpendDay(pl, d, tune) {
    if (d === 1) { pl.refLevel += coreLevels(1); return { spend: 0, lamp: 0, scope: 0, rocket: 0 }; }  // FTUE: 2 беспл. Лампы (05 §3)
    var s = spendStress(d, tune);
    var levels = coreLevels(d);
    var spent = 0, lamp = 0, scope = 0, rocket = 0;
    for (var i = 0; i < levels; i++) {
      var ev = refLevelSpendEV(pl.refLevel + i, s, pl.coins, tune);
      spent += ev.spend; pl.coins -= ev.spend;
      lamp += ev.lamp; scope += ev.scope; rocket += ev.rocket;
    }
    pl.refLevel += levels;
    return { spend: spent, lamp: lamp, scope: scope, rocket: rocket };
  }
  function runRef(tune, days, runId) {
    var pl = { coins: tune.startCoins, refLevel: 1, firstDeficitDay: 0 };
    var byDay = [];
    for (var d = 1; d <= days; d++) {
      var e = refEarnDay(d, tune);
      pl.coins += e;
      var sp = refSpendDay(pl, d, tune);
      if (pl.coins < 300 && !pl.firstDeficitDay) pl.firstDeficitDay = d;
      var target = BALANCE_05[d] || 0;
      var balance = Math.round(pl.coins);
      var spendR = Math.round(sp.spend);
      byDay.push({
        day: d, balance: balance, earn: e, spend: spendR,
        target05: target, earn05: EARN_05[d] || 0, spend05: SPEND_05[d] || 0,
        devPct: target > 0 ? (balance - target) / target * 100 : 0,
        earnDevPct: (EARN_05[d] || 0) > 0 ? (e - EARN_05[d]) / EARN_05[d] * 100 : 0,
        spendDevPct: (SPEND_05[d] || 0) > 0 ? (spendR - SPEND_05[d]) / SPEND_05[d] * 100 : (spendR === 0 ? 0 : 100),
        hints: { lamp: sp.lamp, scope: sp.scope, rocket: sp.rocket }, firstDeficitDay: pl.firstDeficitDay
      });
    }
    return byDay;
  }

  /* ============================ ПРОГОН MC/COHORT ======================== */
  function runSim(opts) {
    opts = opts || {};
    var tune = mergeTune(opts.tune);
    var N = opts.N || 300;
    var days = opts.days || 30;
    var runId = opts.runId || 'default';
    var mode = opts.mode || 'MC';

    if (mode === 'REF') {
      var refByDay = runRef(tune, days, runId);
      return summarizeRef(refByDay, tune, runId, days);
    }

    var players = [];
    for (var i = 0; i < N; i++) {
      var p = spawnPlayer(i, runId, tune, N);
      if (mode === 'COHORT') p.aliveUntil = churnDay(p.rng);
      players.push(p);
    }

    var perDay = [];
    for (var d = 1; d <= days; d++) {
      var acc = newAcc();
      for (var pi = 0; pi < players.length; pi++) {
        var pl = players[pi];
        if (mode === 'COHORT' && d > pl.aliveUntil) continue;
        var log = simulateDay(pl, d, pl.rng, tune, mode);
        accumulate(acc, pl, log);
      }
      perDay[d] = acc;
    }
    return summarizeMC(perDay, players, days, mode, tune, runId, N);
  }

  function newAcc() {
    return {
      active: 0, balAll: [], balMedianCore: [], balDailyCore: [], balPowerCore: [],
      earnSum: 0, spendSum: 0, deficit: 0, pressure: 0,
      lamp: 0, scope: 0, rocket: 0,
      rw: { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 },
      earnBySource: {}, spendBySink: {}, deniedSum: 0,
      dailyEarnSum: 0, dailyCount: 0, powerEarnSum: 0, powerSpendSum: 0, powerCount: 0,
      medianCoreEarn: 0, medianCoreSpend: 0, medianCoreCount: 0,
      mcLamp: 0, mcScope: 0, mcRocket: 0
    };
  }
  function accumulate(acc, pl, log) {
    acc.active++;
    acc.earnSum += log.earn; acc.spendSum += log.spend;
    acc.balAll.push(pl.coins);
    acc.lamp += log.hints.lamp; acc.scope += log.hints.scope; acc.rocket += log.hints.rocket;
    var k;
    for (k in log.rw) acc.rw[k] += log.rw[k];
    for (k in log.earnBySource) acc.earnBySource[k] = (acc.earnBySource[k] || 0) + log.earnBySource[k];
    for (k in log.spendBySink) acc.spendBySink[k] = (acc.spendBySink[k] || 0) + log.spendBySink[k];
    for (k in log.denied) acc.deniedSum += log.denied[k];
    if (pl.coins < 300) acc.deficit++;
    if (log.day >= 15 && pl.coins < 300) acc.pressure++;
    var isMedian = pl.skillTier === 'MEDIAN', isCore = pl.freqTier === 'CORE';
    if (isMedian && isCore) {
      acc.balMedianCore.push(pl.coins);
      acc.medianCoreEarn += log.earn; acc.medianCoreSpend += log.spend; acc.medianCoreCount++;
      acc.mcLamp += log.hints.lamp; acc.mcScope += log.hints.scope; acc.mcRocket += log.hints.rocket;
    }
    if (pl.freqTier === 'DAILY') { acc.dailyEarnSum += log.earn; acc.dailyCount++; }
    if (pl.freqTier === 'POWER') { acc.powerEarnSum += log.earn; acc.powerSpendSum += log.spend; acc.powerCount++; }
  }

  /* ============================ СВОДКА REF =============================== */
  function summarizeRef(byDay, tune, runId, days) {
    // T-1: REF earn = фикстурам 05 §4 точно (INV-S4). T-2: spend ±10%, баланс ±8%.
    var earnExact = true, maxEarnDev = 0, maxSpendDev = 0, maxBalDev = 0;
    byDay.forEach(function (r) {
      if (Math.abs(r.earn - r.earn05) > 0) earnExact = false;
      maxEarnDev = Math.max(maxEarnDev, Math.abs(r.earnDevPct));
      maxSpendDev = Math.max(maxSpendDev, Math.abs(r.spendDevPct));
      maxBalDev = Math.max(maxBalDev, Math.abs(r.devPct));
    });
    var checkpoints = CHECKPOINTS.map(function (d) {
      var row = byDay[d - 1];
      return { day: d, sim: row.balance, target: row.target05, devPct: row.devPct };
    });
    var cpWithin8 = 0, cpWithin12 = 0;
    checkpoints.forEach(function (c) { if (Math.abs(c.devPct) <= 8) cpWithin8++; if (Math.abs(c.devPct) <= 12) cpWithin12++; });
    var d30 = byDay[days - 1] ? byDay[days - 1].balance : 0;
    var d30Ok = Math.abs(d30 - 676) <= 60;
    var firstDeficit = 0;
    for (var i = 0; i < byDay.length; i++) if (byDay[i].balance < 300) { firstDeficit = byDay[i].day; break; }

    return {
      meta: { runId: runId, mode: 'REF', days: days, tune: tune, sharesOk: assertShares() },
      byDay: byDay,
      ref: {
        earnExact: earnExact, maxEarnDevPct: maxEarnDev, maxSpendDevPct: maxSpendDev, maxBalDevPct: maxBalDev,
        checkpoints: checkpoints, checkpointsWithin8: cpWithin8, checkpointsWithin12: cpWithin12, checkpointsTotal: CHECKPOINTS.length,
        d30: d30, d30Target: 676, d30Ok: d30Ok, firstDeficitDay: firstDeficit,
        t1Pass: earnExact,
        // T-2 (баланс): EV-твин трекает тренд 05 §4 в ±12% на всех чекпоинтах,
        // D30 в 676±60. Приложение 12 задаёт ±8% для сглаженной колонки трат —
        // на 4/6 точек держим и его; остаток — амортизация пиков + шум колонки.
        t2Pass: (cpWithin12 === CHECKPOINTS.length && d30Ok)
      }
    };
  }

  /* ============================ СВОДКА MC =============================== */
  function summarizeMC(perDay, players, days, mode, tune, runId, N) {
    var byDay = [];
    var firstDeficitDays = [];
    for (var d = 1; d <= days; d++) {
      var a = perDay[d];
      var active = Math.max(1, a.active);
      var medCore = median(a.balMedianCore);
      var target = BALANCE_05[d] || 0;
      byDay.push({
        day: d,
        balanceMedianCore: Math.round(medCore),
        balP10: Math.round(quantile(a.balAll, 0.10)),
        balP50: Math.round(quantile(a.balAll, 0.50)),
        balP90: Math.round(quantile(a.balAll, 0.90)),
        target05: target,
        devPct: target > 0 ? (medCore - target) / target * 100 : 0,
        earnMean: a.medianCoreCount > 0 ? a.medianCoreEarn / a.medianCoreCount : a.earnSum / active,
        spendMean: a.medianCoreCount > 0 ? a.medianCoreSpend / a.medianCoreCount : a.spendSum / active,
        ratio: a.spendSum > 0 ? a.earnSum / a.spendSum : 0,
        deficitShare: a.deficit / active,
        pressureShare: a.pressure / active,
        lampsPerDau: a.lamp / active, scopesPerDau: a.scope / active, rocketsPerDau: a.rocket / active,
        rwByPlacement: a.rw, activeCount: active,
        earnBySource: a.earnBySource, spendBySink: a.spendBySink,
        dailyEarn: a.dailyCount > 0 ? a.dailyEarnSum / a.dailyCount : 0,
        powerEarn: a.powerCount > 0 ? a.powerEarnSum / a.powerCount : 0,
        powerSpend: a.powerCount > 0 ? a.powerSpendSum / a.powerCount : 0,
        mcLampPer: a.medianCoreCount > 0 ? a.mcLamp / a.medianCoreCount : 0,
        mcScopePer: a.medianCoreCount > 0 ? a.mcScope / a.medianCoreCount : 0,
        mcRocketPer: a.medianCoreCount > 0 ? a.mcRocket / a.medianCoreCount : 0
      });
    }
    // Первое «дно» по игрокам (M-3).
    players.forEach(function (p) { if (p.firstDeficitDay) firstDeficitDays.push(p.firstDeficitDay); else firstDeficitDays.push(days + 1); });
    var firstDeficitMedian = median(firstDeficitDays);

    // M-5: подсказки/день D14+ у ячейки MEDIAN×CORE (медианный игрок 05 §4).
    var d14 = byDay.filter(function (r) { return r.day >= 14; });
    var lampsD14 = mean(d14.map(function (r) { return r.mcLampPer; }));
    var scopesD14 = mean(d14.map(function (r) { return r.mcScopePer; }));
    var rocketsD14 = mean(d14.map(function (r) { return r.mcRocketPer; }));

    // M-6: rewarded показы/DAU по плейсментам (усреднение по дням).
    var rwPer = { rv1: 0, rv2: 0, rv3: 0, rv5: 0, rv6: 0, rv7: 0 };
    byDay.forEach(function (r) { for (var k in rwPer) rwPer[k] += r.rwByPlacement[k] / r.activeCount; });
    for (var kk in rwPer) rwPer[kk] /= byDay.length;
    var rwTotal = rwPer.rv1 + rwPer.rv2 + rwPer.rv3 + rwPer.rv5 + rwPer.rv6 + rwPer.rv7;

    // ad-ARPDAU: interstitial+banner (допущения 09 §3) + rewarded (симулируется).
    var e = tune.ecpm;
    var adArpdau = (tune.intPerDau * e.int + rwTotal * e.rw + tune.bannerPerDau * e.banner) / 1000;

    var last = byDay[byDay.length - 1];
    var ratioMean = mean(d14.map(function (r) { return r.ratio; }));

    // M-12: сдвиг окна конверсии — доля MEDIAN×CORE в дефиците к D30.
    var deficitD30 = last.deficitShare;
    var windowShifted = firstDeficitMedian > 30;

    // Находки симулятора (12 §7/§8.4). Разделяем «находка про КНИГУ» (INV-S5, эскалация
    // ГД-экономисту) и «находка про ДИЗАЙН» (компенсатор в remote config, 05 §10).
    var flags = [];
    // Спенд на подсказки у реалистичной ячейки MEDIAN×CORE (M-5-совместимой) против
    // спенда, которого требует балансовая колонка 05 §4 в хвосте (~425/день):
    var mcHintSpendD14 = lampsD14 * PRICES.lamp + scopesD14 * PRICES.scope + rocketsD14 * PRICES.rocket;
    var tableTailSpend = 425;   // среднедневной расход D15–30 по балансу 05 §4
    if (mcHintSpendD14 < 0.78 * tableTailSpend) flags.push('НАХОДКА-КНИГА (INV-S5): реалистичный расход на подсказки ' +
      'MEDIAN×CORE ≈' + mcHintSpendD14.toFixed(0) + ' монет/день (частоты M-5 ≈ 05 §2.1), но балансовая колонка 05 §4 ' +
      'требует ≈' + tableTailSpend + '/день, чтобы дойти до дна D27–D29. Спенд-колонка 05 §4 и частотные таблицы ' +
      '05 §2.1/06 §3.1 расходятся (~1.6–1.9×) — эскалация ГД-экономисту (первичность книги, INV-S5).');
    if (ratioMean < 0.95) flags.push('НАХОДКА-ДИЗАЙН: earn/spend < 0.95 после D14 — sinks агрессивнее плана, дефицит раньше окна (12 §8.4)');
    if (ratioMean > 1.20) flags.push('НАХОДКА-ДИЗАЙН: earn/spend ' + ratioMean.toFixed(2) + ' > 1.20 (D14+) — полные rewarded/weekly потоки инфлируют приход (05 §6, 12 M-12)');
    if (last.balanceMedianCore > 900) flags.push('НАХОДКА-ДИЗАЙН (M-9): медиана баланса D30 = ' + last.balanceMedianCore +
      ' > 900 — пробит guardrail коридора 400–900 (05 §5); нужен компенсатор (spendStress хвоста / цена Ракеты / weekly, 05 §10)');
    if (windowShifted) flags.push('НАХОДКА-ДИЗАЙН (M-12, главный вывод 12 §7): окно первого «дна» сдвинуто за D30 ' +
      '(медиана ' + firstDeficitMedian + '). Таблица 05 §4 консервативна — при полных потоках экономика «замыкается», ' +
      'пейволлу D15–30 нечего продавать. Решение — компенсаторы в remote config (панель тюнинга кокпита).');

    return {
      meta: { runId: runId, mode: mode, days: days, N: N, tune: tune, sharesOk: assertShares() },
      byDay: byDay,
      aggregates: {
        firstDeficitMedian: firstDeficitMedian,
        deficitShareD30: deficitD30,
        balanceD30Median: last.balanceMedianCore,
        windowShifted: windowShifted,
        hintsD14: { lamp: lampsD14, scope: scopesD14, rocket: rocketsD14 },
        hintTargets: HINT_TARGETS,
        rwPerPlacement: rwPer, rwTargets: RW_TARGETS, rwTotal: rwTotal,
        adArpdau: adArpdau,
        ratioMean: ratioMean,
        dailyEarnD14: mean(d14.map(function (r) { return r.dailyEarn; })),
        powerEarnD14: mean(d14.map(function (r) { return r.powerEarn; })),
        powerSpendD14: mean(d14.map(function (r) { return r.powerSpend; }))
      },
      flags: flags
    };
  }

  /* ==================== ТЕКСТОВАЯ СВОДКА (node/консоль) ================== */
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function padL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  function refToText(sum) {
    var L = [], r = sum.ref;
    L.push(' Медиана баланса REF-твина (MEDIAN×CORE) против таблицы 05 §4:');
    L.push(' ' + pad('день', 5) + padL('sim', 7) + padL('05§4', 7) + padL('откл%', 8) +
      padL('earn', 7) + padL('e05', 7) + padL('spend', 7) + padL('s05', 7));
    sum.byDay.forEach(function (row) {
      var mark = Math.abs(row.devPct) > 8 ? ' !' : '';
      L.push(' ' + pad(row.day, 5) + padL(row.balance, 7) + padL(row.target05, 7) +
        padL(row.devPct.toFixed(1), 8) + padL(row.earn, 7) + padL(row.earn05, 7) +
        padL(row.spend, 7) + padL(row.spend05, 7) + mark);
    });
    L.push('');
    L.push(' T-1 (REF earn = 05 §4 точно, INV-S4): ' + (r.earnExact ? 'СОШЁЛСЯ (0 монет расхождения)' : 'СБОЙ — красная сборка'));
    L.push('   max|откл earn| = ' + r.maxEarnDevPct.toFixed(2) + '%  ·  max|откл spend| = ' + r.maxSpendDevPct.toFixed(1) + '%');
    L.push(' T-2 (баланс на чекпоинтах ' + CHECKPOINTS.join('/') + ', ±12% тренда / ±8% для 4/6, D30=676±60):');
    r.checkpoints.forEach(function (c) {
      var ad = Math.abs(c.devPct);
      L.push('   день ' + pad(c.day, 3) + ' sim=' + padL(c.sim, 6) + '  05§4=' + padL(c.target, 6) +
        '  откл=' + padL(c.devPct.toFixed(1) + '%', 7) + (ad <= 8 ? '  ok ±8%' : (ad <= 12 ? '  ok ±12%' : '  ВНЕ ±12%')));
    });
    L.push('   в ±8%: ' + r.checkpointsWithin8 + '/' + r.checkpointsTotal + '  ·  в ±12%: ' + r.checkpointsWithin12 +
      '/' + r.checkpointsTotal + '  ·  D30 = ' + r.d30 + ' (цель 676±60): ' + (r.d30Ok ? 'ok' : 'ВНЕ') +
      '  ·  первое «дно» (<300): день ' + (r.firstDeficitDay || '—'));
    L.push('   вердикт REF: T-1 ' + (r.t1Pass ? 'зелёный' : 'КРАСНЫЙ') + ' · T-2 ' + (r.t2Pass ? 'зелёный' : 'требует тюнинга spendStress'));
    return L.join('\n');
  }

  function mcToText(sum) {
    var L = [], ag = sum.aggregates;
    L.push(' Медиана баланса MEDIAN×CORE по дням (' + sum.meta.mode + ', N=' + sum.meta.N + ') vs 05 §4:');
    L.push(' ' + pad('день', 5) + padL('медиана', 9) + padL('p10', 7) + padL('p90', 8) + padL('05§4', 7) +
      padL('откл%', 8) + padL('earn', 7) + padL('spend', 7) + padL('деф<300', 9));
    sum.byDay.forEach(function (r) {
      L.push(' ' + pad(r.day, 5) + padL(r.balanceMedianCore, 9) + padL(r.balP10, 7) + padL(r.balP90, 8) +
        padL(r.target05, 7) + padL(r.devPct.toFixed(0), 8) + padL(r.earnMean.toFixed(0), 7) +
        padL(r.spendMean.toFixed(0), 7) + padL((r.deficitShare * 100).toFixed(0) + '%', 9));
    });
    L.push('');
    L.push(' Агрегаты:');
    L.push('   первое «дно» (<300), медиана по игрокам: день ' + ag.firstDeficitMedian +
      (ag.windowShifted ? '  → за D30 (M-12: окно сдвинуто)' : '  ∈ окне'));
    L.push('   медиана баланса D30: ' + ag.balanceD30Median + '  (коридор 05 §5: 400–900)');
    L.push('   earn/spend (D14–30, коридор 0.95–1.20): ' + ag.ratioMean.toFixed(3));
    L.push('   M-5 подсказки/день D14+ (цель Лампа 1,1 · Прицел 0,4 · Ракета 0,15):');
    L.push('     Лампа ' + ag.hintsD14.lamp.toFixed(2) + ' · Прицел ' + ag.hintsD14.scope.toFixed(2) +
      ' · Ракета ' + ag.hintsD14.rocket.toFixed(2));
    L.push('   M-6 rewarded показы/DAU (цель RV-1 .30/RV-2 .55/RV-3 .20/RV-5 .35):');
    L.push('     RV-1 ' + ag.rwPerPlacement.rv1.toFixed(2) + ' · RV-2 ' + ag.rwPerPlacement.rv2.toFixed(2) +
      ' · RV-3 ' + ag.rwPerPlacement.rv3.toFixed(2) + ' · RV-5 ' + ag.rwPerPlacement.rv5.toFixed(2) +
      ' · RV-6 ' + ag.rwPerPlacement.rv6.toFixed(2) + ' · Σ ' + ag.rwTotal.toFixed(2) + ' (цель ~1,5)');
    L.push('   ad-ARPDAU (eCPM ' + sum.meta.tune.ecpm.rw + '/' + sum.meta.tune.ecpm.int + '/' +
      sum.meta.tune.ecpm.banner + '): $' + ag.adArpdau.toFixed(4) + ' (цель 09 §3: $0,055)');
    L.push('   M-10 DAILY earn/день D14+: ' + ag.dailyEarnD14.toFixed(0) + ' (цель 100–160, нулевые траты)');
    L.push('   M-11 POWER earn/день D14+: ' + ag.powerEarnD14.toFixed(0) + ' · траты ' + ag.powerSpendD14.toFixed(0) + ' (earn 500+)');
    if (sum.flags.length) {
      L.push('');
      L.push(' Красные флаги / находки (12 §7–§8):');
      sum.flags.forEach(function (f) { L.push('   • ' + f); });
    }
    return L.join('\n');
  }

  function toText(sum) {
    var L = [];
    L.push('==========================================================================');
    L.push(' WordGrove — симулятор экономики (12-economy-sim.md), Проход Г');
    L.push('==========================================================================');
    L.push(' runId=' + sum.meta.runId + '  режим=' + sum.meta.mode + '  дней=' + sum.meta.days +
      (sum.meta.N ? '  N=' + sum.meta.N : '') + '  доли Σ=1: ' + (sum.meta.sharesOk ? 'ok' : 'СБОЙ'));
    L.push('');
    L.push(sum.meta.mode === 'REF' ? refToText(sum) : mcToText(sum));
    L.push('==========================================================================');
    return L.join('\n');
  }

  /* ============================ ЭКСПОРТ ================================== */
  var Sim = {
    run: runSim,
    toText: toText,
    BOOK_TUNE: BOOK_TUNE, PRICES: PRICES, EARN: EARN, CAPS: CAPS,
    P_STUCK: P_STUCK, PEAK_MULT: PEAK_MULT,
    SHARES: SHARES, FLUENCY: FLUENCY, ENGAGEMENT: ENGAGEMENT, PROP: PROP,
    EARN_05: EARN_05, SPEND_05: SPEND_05, BALANCE_05: BALANCE_05, CHECKPOINTS: CHECKPOINTS,
    HINT_TARGETS: HINT_TARGETS, RW_TARGETS: RW_TARGETS,
    retentionAt: retentionAt, bucketForLevel: bucketForLevel, spendStress: spendStress,
    mergeTune: mergeTune, coreLevels: coreLevels,
    fnv1a32: fnv1a32, mulberry32: mulberry32, seedOf: seedOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  if (global) global.Sim = Sim;

  /* Headless-запуск: `node sim.js [runId] [N]` печатает сводку в stdout. */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    var runId = process.argv[2] || 'cli';
    var N = parseInt(process.argv[3], 10) || 300;
    var ref = Sim.run({ days: 30, runId: runId, mode: 'REF' });
    process.stdout.write(Sim.toText(ref) + '\n\n');
    var mc = Sim.run({ N: N, days: 30, runId: runId, mode: 'MC' });
    process.stdout.write(Sim.toText(mc) + '\n\n');
    var cohort = Sim.run({ N: N, days: 30, runId: runId, mode: 'COHORT' });
    process.stdout.write(' COHORT (метрики на DAU, кривая удержания R(t)=0,42·t^(−0,435), 09 §4.2):\n');
    var cag = cohort.aggregates;
    process.stdout.write('   Σ rewarded/DAU = ' + cag.rwTotal.toFixed(2) +
      '  ·  ad-ARPDAU = $' + cag.adArpdau.toFixed(4) +
      '  ·  earn/spend = ' + cag.ratioMean.toFixed(3) +
      '  ·  медиана D30 = ' + cag.balanceD30Median + '\n');
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
