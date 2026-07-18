/* =============================================================================
 * Block Surge — СИМУЛЯТОР ЭКОНОМИКИ (Проход Г, soft-launch cockpit)
 * -----------------------------------------------------------------------------
 * Реализация офлайн-инструмента из приложения 12-economy-sim.md поверх готовых
 * Проходов А+Б+В. НИЧЕГО в ядре/экономике/монетизации не переписывает — это
 * ОТДЕЛЬНЫЙ расчётный модуль. Моделирует N виртуальных игроков сегментов
 * скилл×частота × 30 дней агрегатной move-цепью партии (комбо/Прилив, 11 §5),
 * считает монеты sources/sinks (05 §2), бустеры (инвентарь + покупка = sink),
 * continue, pity (11 §3.5), капы rewarded (06 §2.2). На выходе — баланс монет по
 * дням против опорной кривой 05 §4 (отклонение в %), точки дефицита, ad-ARPDAU,
 * доля sinks.
 *
 * ДЕТЕРМИНИЗМ (INV-E2): собственный seeded-RNG (mulberry32), сид игрока =
 * fnv1a32('blocksurge:econsim:v1:{runId}:{playerId}'). НИКАКИХ Math.random /
 * Date.now в расчётах — seed приходит параметром (runId). Один и тот же runId
 * даёт бит-в-бит один и тот же результат в браузере и в node.
 *
 * ДВА СПОСОБА ЗАПУСКА:
 *   (1) браузер: window.Sim.run({ N, days, runId, tune }) → SimSummary,
 *       кокпит (experiments.js) рендерит таблицу; кап N ~200–400, прогон <1 c.
 *   (2) node:  `node sim.js`  печатает текстовую сводку в stdout
 *       (module.exports + запуск при require.main === module).
 *
 * ЧИСЛА — из приложения 12 (§2 сегменты, §3 номиналы) и главы 05 (§4 кривая,
 * §2 sources/sinks). Свободные EV (миссии/колесо/недельный бандл/интенсивность
 * бустеров) — калибровочные ручки §8; их значения подобраны так, чтобы медиана
 * баланса BASE×CORE в режиме SURVIVOR трекала таблицу 05 §4 (см. отчёт снизу).
 * Номиналы (цены, награды, капы) НЕ тюнятся (INV-E1) — это решения глав 05/06.
 * ========================================================================== */
'use strict';

(function (global) {

  /* ======================= ДЕТЕРМИНИРОВАННЫЙ RNG ========================= */
  /* fnv1a32 — та же схема хеша, что в meta.js/11 §6.1. mulberry32 — тот же
   * PRNG, что в game.js. Идентичность важна: сид воспроизводим (INV-E2). */

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
    return fnv1a32('blocksurge:econsim:v1:' + runId + ':' + playerId);
  }

  /* ========================= НОМИНАЛЫ (INV-E1) ==========================
   * Зеркало 05 §2 / 06 §2. Единственное место этих чисел в симуляторе. */

  var PRICES = {
    hammer: 150, swap: 120, undo: 80,        // бустеры, 05 §5
    continue1: 200, continue2: 400,          // 05 §5
    streakRestore: 100, fieldTicket: 150,    // 05 §2.1, §2.3
    skinMin: 1000                            // нижняя граница витрины, 05 §2.1
  };
  var EARN = {
    linePerMult: 1,                          // 1 монета × множитель за линию, 05 §2.1
    levelWin: [25, 50], star3First: 20,      // 05 §2.1
    bossRewardMult: 2,                       // каждый 10-й уровень, 05 §2.1
    streakRamp: [30, 45, 60, 80, 100, 120, 150], // цикл 7 дней, 30–150 (05 §2.1)
    chestAmortPerDay: 12,                    // сундуки глав 100–400, амортизировано
    startGrant: 200                          // FTUE-подарок 05 §3 (учтён в дне 1 таблицы 05 §4)
  };
  var CAPS = {
    rw1PerParty: 1, rw2PerDay: 3, rw3PerDay: 1, rw4PerDay: 2,  // 06 §2.2
    tickets: 3                                                  // 05 §1
  };
  var PITY_RELIEF = [1.0, 0.85, 0.70];       // эффект pity на fail (11 §3.5, 12 §4.2)

  /* ===================== СЕГМЕНТЫ ИГРОКА (12 §2) ========================= */

  var SKILL = {
    NOVICE:  { pClear: 0.30, failMult: 1.4, linesDist: [0.78, 0.18, 0.035, 0.005], crystalAim: 0.05 },
    BASE:    { pClear: 0.35, failMult: 1.0, linesDist: [0.78, 0.18, 0.035, 0.005], crystalAim: 0.15 },
    SKILLED: { pClear: 0.42, failMult: 0.4, linesDist: [0.70, 0.24, 0.050, 0.010], crystalAim: 0.25 }
  };
  var FREQ = {
    LIGHT: { sessionsPerDay: 2.0, gamesPerSession: 1.0, modeMix: { journey: 0.75, classic: 0.10, field: 0.15 }, skipDayP: 0.20 },
    CORE:  { sessionsPerDay: 3.0, gamesPerSession: 1.0, modeMix: { journey: 0.65, classic: 0.20, field: 0.15 }, skipDayP: 0.05 },
    HEAVY: { sessionsPerDay: 4.5, gamesPerSession: 1.0, modeMix: { journey: 0.55, classic: 0.35, field: 0.10 }, skipDayP: 0.01 }
  };
  // Доли популяции (12 §2.1). Σ = 1.00; проверяется assertShares().
  var SHARES = {
    NOVICE:  { LIGHT: 0.14, CORE: 0.12, HEAVY: 0.04 },
    BASE:    { LIGHT: 0.12, CORE: 0.26, HEAVY: 0.12 },
    SKILLED: { LIGHT: 0.04, CORE: 0.12, HEAVY: 0.04 }
  };
  // Базовые склонности ячейки BASE×CORE (12 §2.4). Прочие сегменты берут те же
  // с поправкой на failMult/skill через stress и winrate — упрощение модели §1.
  var PROP = {
    rwAccept: { rw1: 0.45, rw2: 0.40, rw3: 0.30, rw4: 0.25 },
    continueBaseP: 0.25,
    boosterIntensity: { hammer: 0.17, swap: 0.15, undo: 0.27 },
    buySkinP: 0.03,
    buyTicketP: 0.15,
    restoreStreakP: 0.40,
    restoreStreakLoP: 0.05
  };

  /* ============== КАЛИБРОВОЧНЫЕ РУЧКИ (12 §8, свободные EV) ===============
   * Это TUNE-слой: значения «книги», которые кокпит (experiments.js) может
   * переопределять для A/B и ручного тюнинга. Всё, что здесь — НЕ номинал
   * (INV-E1), а поведенческая модель/допущение (§8.3). */

  // Значения — КАЛИБРОВАННЫЙ baseline (econ-sim.baseline, 12 §8.2): подобраны
  // покоординатным спуском так, чтобы медиана баланса BASE×CORE в SURVIVOR
  // трекала 05 §4 (D1–D14 в ±10%; см. отчёт калибровки в README). Свободные EV —
  // поведенческая модель (§8.3), НЕ номиналы. Отклонения D21–D30 — задокументи-
  // рованный эффект аффордабилити-пола (INV-E4): медиана упирается в цену
  // continue/бустера и не доходит до идеализированного «100» таблицы 05 §4.
  var BOOK_TUNE = {
    // Свободные источники (EV/день, ячейка BASE×CORE):
    missionsEV: 10,          // daily-миссии: калибровка ужала EV — приход от геймплея
                             // (линии+победы при 3.2 партии/день) слегка выше 05 §4 (12 §8.4)
    weeklyBundleEV: 150,     // недельный всплеск = weekly-миссии + турнир (12 §5)
    wheelWeightsLow: true,   // колесо взвешено к нижним секторам, EV ≈ 42
    noveltyAmp: 0.30,        // novelty(t) = 1 + amp·e^(−t/4): энтузиазм первых дней (12 §5.1)
    engageDecay: 0.10,       // мягкий спад числа партий за лайфтайм (зрелость игрока):
                             // games ×= 1 − engageDecay·t/30 — форма спада earn 05 §4
    // Форма расхода (спрос на бустеры = intensity × stress(level) × scale).
    // Наклон stress рассчитан так, чтобы расход рос 100→320→400 монет за лайфтайм
    // (05 §4), а кривая earn/spend пересекала 1.0 у пика баланса (D8).
    boosterScale: 1.30,      // общий множитель спроса на бустеры (калибровка §8.2 п.3)
    stressFloor: 0.40,       // stress при низком уровне (ранние траты «учимся», 05 §4)
    stressSlope: 0.065,      // рост stress с уровнем (форма кривой расхода)
    stressCap: 1.85,         // потолок stress (плато расхода к D20+, 05 §4)
    bossStress: 2.2,         // stress на боссе (пик спроса, 05 §7 п.1)
    continueScale: 1.0,      // множитель к continueBaseP
    W_HARD: 1.0,             // сложность сегмента 21–60 (09 §6 тест №7): ×fail в hard
    // Прогрессия уровней (влияет на stress и winrate):
    winP: 0.75,              // P(continue конвертирует провал в победу) — 12 §4.2 ставит 0.75
    // Монетизация (для ad-ARPDAU и гейтов, 06 §4 / 09 §4):
    rw2Mult: 2,              // множитель RW-2 «×2 монеты» (09 §6 тест №6: ×2 vs ×3)
    intPerDau: 7.0,          // interstitial/DAU (не влияет на монеты, 09 §4)
    bannerPerDau: 35,        // banner/DAU (09 §4)
    ecpm: { rw: 16.0, int: 14.0, banner: 0.50 }, // T1-прокси soft-launch (06 §4)
    // Стартовый грант (09 §6-подобный тест: 200 vs 300):
    startGrant: 200,
    // Дневные капы rewarded (тюнинг/эксперименты):
    rw2Cap: 3, intCap: 7
  };

  /* Опорные данные глав (цели калибровки, 12 §8.1) */
  var BALANCE_05 = {  // медиана баланса на конец дня, 05 §4
    1: 450, 2: 650, 3: 790, 4: 890, 5: 960, 6: 1000, 7: 1160, 8: 1170, 9: 1170, 10: 1155,
    11: 1135, 12: 1105, 13: 1070, 14: 1180, 15: 1130, 16: 1075, 17: 1010, 18: 945, 19: 870, 20: 790,
    21: 860, 22: 775, 23: 685, 24: 590, 25: 490, 26: 390, 27: 285, 28: 325, 29: 215, 30: 100
  };
  var EARN_05 = {
    1: 550, 2: 380, 3: 360, 4: 350, 5: 350, 6: 340, 7: 480, 8: 330, 9: 330, 10: 325,
    11: 320, 12: 320, 13: 315, 14: 470, 15: 310, 16: 310, 17: 305, 18: 305, 19: 300, 20: 300,
    21: 450, 22: 295, 23: 295, 24: 290, 25: 290, 26: 290, 27: 285, 28: 435, 29: 285, 30: 285
  };
  var SPEND_05 = {
    1: 100, 2: 180, 3: 220, 4: 250, 5: 280, 6: 300, 7: 320, 8: 320, 9: 330, 10: 340,
    11: 340, 12: 350, 13: 350, 14: 360, 15: 360, 16: 365, 17: 370, 18: 370, 19: 375, 20: 380,
    21: 380, 22: 380, 23: 385, 24: 385, 25: 390, 26: 390, 27: 390, 28: 395, 29: 395, 30: 400
  };
  var CHECKPOINTS = [1, 7, 8, 14, 21, 25, 30];  // 12 §8.1
  // Кривая удержания (09 §5.1) для COHORT-режима и LT/ROAS в гейтах.
  var RETENTION = { 1: 38, 2: 30, 3: 25, 4: 22, 5: 19, 6: 17, 7: 15, 14: 10.5, 30: 6, 60: 4, 90: 3 };
  // Fail-коридоры сегментов уровней (03 §5.2 / 12 §7 M3), в долях.
  var FAIL_CORRIDORS = {
    's1_5':   [0.00, 0.02],
    's6_20':  [0.05, 0.10],
    's21_60': [0.12, 0.18],
    's60p':   [0.18, 0.25]
  };

  /* ============================ УТИЛИТЫ ================================== */

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function randRange(rng, a, b) { return a + (b - a) * rng(); }
  function randInt(rng, a, b) { return Math.floor(a + (b - a + 1) * rng()); }
  function gauss(rng, mean, sd) {
    var u1 = Math.max(1e-9, rng()), u2 = rng();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * sd;
  }
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
    return Math.abs(sum - 1) < 1e-9;   // Σ долей = 1.00 (12 §2.1)
  }

  /* Сборка мердж-конфига: книга + переопределения кокпита. */
  function mergeTune(over) {
    var t = {}, k;
    for (k in BOOK_TUNE) t[k] = BOOK_TUNE[k];
    // ecpm собираем отдельным СВЕЖИМ объектом (книга + ЧАСТИЧНЫЕ переопределения):
    // (а) не мутируем BOOK_TUNE.ecpm по ссылке; (б) частичный тюнинг (например,
    // правка только rewarded-eCPM в панели) НЕ обнуляет остальные под-ключи —
    // иначе adArpdau = NaN (e.int/e.banner === undefined). См. INV-E1/§8.
    t.ecpm = { rw: BOOK_TUNE.ecpm.rw, int: BOOK_TUNE.ecpm.int, banner: BOOK_TUNE.ecpm.banner };
    if (over) for (k in over) {
      if (k === 'ecpm' && over.ecpm) {
        if (over.ecpm.rw !== undefined) t.ecpm.rw = over.ecpm.rw;
        if (over.ecpm.int !== undefined) t.ecpm.int = over.ecpm.int;
        if (over.ecpm.banner !== undefined) t.ecpm.banner = over.ecpm.banner;
      } else if (k !== 'ecpm' && over[k] !== undefined) t[k] = over[k];
    }
    return t;
  }

  /* ==================== КОРИДОРЫ И STRESS (03 §5.2) ====================== */

  function levelSegment(level) {
    if (level <= 5) return 's1_5';
    if (level <= 20) return 's6_20';
    if (level <= 60) return 's21_60';
    return 's60p';
  }
  // Целевой fail для уровня (без учёта скилла/pity). Босс — до 0.30 (05 §7 п.1).
  function failTarget(level, boss, tune) {
    if (boss) return 0.30;
    var seg = levelSegment(level);
    var base;
    if (seg === 's1_5') base = 0.01;
    else if (seg === 's6_20') base = 0.075;
    else if (seg === 's21_60') base = 0.15 * tune.W_HARD;   // ручка сложности hard-сегмента
    else base = 0.215 * tune.W_HARD;
    return base;
  }
  // Спрос на бустеры растёт со сложностью (05 §7 п.1). Гладкая функция уровня
  // (а не ступенчатая failTarget/0.15): ранние траты низки («учимся», 05 §4),
  // плавно растут с прогрессом Путешествия и упираются в плато к D20+. Босс —
  // отдельный пик. W_HARD ускоряет наклон (эксперимент сложности 09 §6 №7).
  function stressAt(level, boss, tune) {
    if (boss) return tune.bossStress;
    var s = tune.stressFloor + (level - 1) * tune.stressSlope * tune.W_HARD;
    return clamp(s, tune.stressFloor, tune.stressCap);
  }
  function novelty(t, tune) { return 1 + tune.noveltyAmp * Math.exp(-t / 4); }

  /* ===================== АВТОМАТЫ КОМБО/ПРИЛИВ (11 §5) ================== */
  /* Агрегатная move-цепь партии (12 §4.1): комбо-множитель ×2/×3/×5 с
   * прощением, шкала Прилива (заряд 10×mult, шкала 100), кристалл. */

  function comboMult(chain) {
    if (chain >= 6) return 5;
    if (chain >= 4) return 3;
    if (chain >= 2) return 2;
    return 1;
  }
  function sampleLines(dist, rng) {
    var r = rng(), acc = 0;
    for (var i = 0; i < dist.length; i++) { acc += dist[i]; if (r < acc) return i + 1; }
    return 1;
  }

  function simulateGame(pl, mode, rng, tune) {
    var moves;
    if (mode === 'classic') moves = Math.round(clamp(Math.exp(gauss(rng, Math.log(75), 0.35)), 20, 220));
    else moves = Math.round(clamp(gauss(rng, 42, 8), 12, 90));   // journey/field, 12 §4.1

    var chain = 0;
    var charge = 0, crystalPending = false, crystalOnBoard = false;
    var coins = 0, lines = 0, crystals = 0, clearingMoves = 0;
    var sk = pl.skill;

    for (var m = 0; m < moves; m++) {
      var firstOfHand = (m % 3) === 0;                 // рука = 3 фигуры (03 §2.1)
      if (crystalPending && firstOfHand) { crystalPending = false; crystalOnBoard = true; }

      var cleared = rng() < sk.pClear;
      // Автомат комбо 11 §5.1: цепь копится на очистках подряд, рвётся на промахе.
      // Средний множитель цепи при pClear≈0.35 держится ≈1.35 (санити 12 §4.1).
      if (cleared) chain++; else chain = 0;
      var mult = comboMult(chain);

      if (cleared) {
        var n = sampleLines(sk.linesDist, rng);
        clearingMoves++; lines += n;
        coins += n * mult * EARN.linePerMult;          // монеты за линии, 05 §2.1
        charge += 10 * mult;                           // заряд Прилива, 11 §5.2
        if (charge >= 100) { charge = 100; crystalPending = true; }
      }
      if (crystalOnBoard) {
        var explodes = cleared && rng() < clamp01(sk.pClear + sk.crystalAim);
        if (explodes) { crystals++; crystalOnBoard = false; charge = 0; }  // взрыв: очки, НЕ монеты (11 §5.3)
        else if (!cleared && rng() < 0.10) { crystalOnBoard = false; charge = 0; }
      }
    }
    return { coins: coins, lines: lines, crystals: crystals, moves: moves, mode: mode };
  }

  /* ===================== РАСХОД / ПРИХОД (транзакции) =================== */

  function earn(pl, log, amount, source) {
    amount = Math.round(amount);
    if (amount <= 0) return;
    pl.coins += amount;
    log.earn += amount;
    log.earnBySource[source] = (log.earnBySource[source] || 0) + amount;
  }
  // INV-E4: sink гейтится проверкой баланса; отказ пишется в denied.
  function spend(pl, log, amount, sink) {
    amount = Math.round(amount);
    if (amount <= 0) return true;
    if (pl.coins < amount) {
      log.denied[sink] = (log.denied[sink] || 0) + 1;
      return false;
    }
    pl.coins -= amount;
    log.spend += amount;
    log.spendBySink[sink] = (log.spendBySink[sink] || 0) + amount;
    return true;
  }

  /* Использование бустеров за партию (12 §4.2): интенсивность × stress; сначала
   * инвентарь (подарки/RW-3), при пустом — покупка = sink (INV-E4). */
  function useBoosters(pl, level, boss, rng, tune, log) {
    var stress = stressAt(level, boss, tune);
    var order = ['hammer', 'swap', 'undo'];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      var p = clamp(PROP.boosterIntensity[b] * stress * tune.boosterScale, 0, 0.95);
      if (rng() < p) {
        if (pl.boosters[b] > 0) pl.boosters[b]--;               // из инвентаря — бесплатно
        else spend(pl, log, PRICES[b], 'booster_' + b);         // иначе покупка = sink
      }
    }
  }

  /* Исход journey-партии: fail-коридор × скилл × pity → continue → награда.
   * Монеты линий начисляются ЗДЕСЬ: провальная партия обрывается раньше бюджета
   * (§9 «второй шанс не даёт монет»), поэтому линий на провале — доля coins. */
  function resolveOutcome(pl, g, mode, t, rng, tune, log) {
    if (mode !== 'journey') {                    // classic/field: монеты линий уже начислены
      useBoosters(pl, pl.levelMax, false, rng, tune, log);
      return;
    }
    var boss = pl.levelMax % 10 === 0 && pl.levelMax > 0;
    useBoosters(pl, pl.levelMax, boss, rng, tune, log);

    // Учёт попыток/провалов по сегментам (для fail-коридоров M3):
    var seg = levelSegment(pl.levelMax);
    log.segAttempt[seg] = (log.segAttempt[seg] || 0) + 1;

    var failP = failTarget(pl.levelMax, boss, tune) * pl.skill.failMult * PITY_RELIEF[pl.pity];
    var failed = rng() < clamp01(failP);
    if (failed) log.segFail[seg] = (log.segFail[seg] || 0) + 1;

    if (failed) {
      log.fails++;
      var progress = 0.5 + 0.5 * rng();                          // прокси прогресса партии
      var saved = tryContinue(pl, progress, rng, tune, log);
      if (saved && rng() < tune.winP) failed = false;            // continue конвертирует провал
    }
    // Монеты линий journey: полные на победе, урезанные на провале (партия короче).
    earn(pl, log, g.coins * (failed ? 0.55 : 1.0), 'lines');
    if (!failed) {
      var reward = randInt(rng, EARN.levelWin[0], EARN.levelWin[1]) * (boss ? EARN.bossRewardMult : 1);
      if (rng() < 0.35) reward += EARN.star3First;               // первое 3★
      if (log.rw2Used < tune.rw2Cap && rng() < PROP.rwAccept.rw2) {
        reward *= tune.rw2Mult; log.rw2Used++; log.rwViews++;    // RW-2 «×множитель монеты»
      }
      earn(pl, log, reward, 'level_win');
      pl.levelMax++;
      pl.pity = 0;                                               // сброс счётчика на победе (11 §3.5)
    } else {
      pl.pity = Math.min(pl.pity + 1, 2);                        // эскалация pity
    }
  }

  function tryContinue(pl, progress, rng, tune, log) {
    // Приоритет: RW-1 (бесплатно, 1/партию) → монеты 200 (12 §2.4, 03 §6).
    if (!log.rw1UsedThisGame && rng() < PROP.rwAccept.rw1) {
      log.rw1UsedThisGame = true; log.rwViews++; log.continues++; return true;
    }
    var pCoins = PROP.continueBaseP * tune.continueScale * (progress >= 0.8 ? 2 : 1);
    if (pl.coins >= PRICES.continue1 && rng() < pCoins) {
      if (spend(pl, log, PRICES.continue1, 'continue1')) { log.continues++; return true; }
    }
    return false;
  }

  /* ============================ МОДЕЛЬ ДНЯ (12 §5) ====================== */

  function weightedWheel(rng) {
    var v = [30, 45, 60, 80, 100, 120, 150];
    var w = [0.60, 0.20, 0.10, 0.05, 0.03, 0.015, 0.005];       // взвешено к нижним, EV ≈ 42
    var r = rng(), acc = 0;
    for (var i = 0; i < v.length; i++) { acc += w[i]; if (r < acc) return v[i]; }
    return v[0];
  }
  function pickMode(pl, rng) {
    var mm = pl.freq.modeMix, r = rng();
    if (r < mm.journey) return 'journey';
    if (r < mm.journey + mm.classic) return 'classic';
    return 'field';
  }

  function onSkippedDay(pl, t, rng, tune, log) {
    // Пропуск дня: стрик теряется; с P — восстановление (100 монет или RW-4).
    if (pl.streakCount >= 6) {
      var pRestore = PROP.restoreStreakP;
      if (rng() < pRestore) {
        if (rng() < PROP.rwAccept.rw4 && log.rw4Used < CAPS.rw4PerDay) {
          log.rw4Used++; log.rwViews++;                          // спас серию рекламой (RW-4)
        } else {
          spend(pl, log, PRICES.streakRestore, 'streak_restore');
        }
      } else { pl.streakCount = 0; pl.streakDay = 0; }
    } else { pl.streakCount = 0; pl.streakDay = 0; }
    log.skipped = true;
    log.balanceEOD = pl.coins;
  }

  function streakTick(pl, rng, log) {
    pl.streakDay = (pl.streakDay % 7) + 1;
    pl.streakCount++;
    earn(pl, log, EARN.streakRamp[pl.streakDay - 1], 'streak');
  }

  function shopDecisions(pl, t, rng, tune, log) {
    // Скин: покупка при балансе > 1.2 × цены (05 §6, амортизация редких покупок).
    if (pl.coins > 1.2 * PRICES.skinMin && rng() < PROP.buySkinP) {
      spend(pl, log, PRICES.skinMin, 'skin');
    }
    // Билет Поля: при балансе > 600 и не полном стеке (05 §2.3).
    if (pl.coins > 600 && pl.tickets < CAPS.tickets && rng() < PROP.buyTicketP) {
      if (spend(pl, log, PRICES.fieldTicket, 'field_ticket')) pl.tickets = Math.min(pl.tickets + 1, CAPS.tickets);
    }
  }

  function emptyLog(t) {
    return {
      day: t, earn: 0, spend: 0,
      earnBySource: {}, spendBySink: {}, denied: {},
      games: 0, fails: 0, continues: 0, rwViews: 0, crystalGames: 0,
      rw1UsedThisGame: false, rw2Used: 0, rw4Used: 0,
      segAttempt: {}, segFail: {},
      skipped: false, balanceEOD: 0
    };
  }

  function simulateDay(pl, t, rng, tune) {
    var log = emptyLog(t);
    // Капы rewarded сбрасываются на границе дня (12 §9).
    if (rng() < pl.freq.skipDayP) { onSkippedDay(pl, t, rng, tune, log); return log; }

    var wheel = weightedWheel(rng);
    if (log.rw4Used < CAPS.rw4PerDay && rng() < PROP.rwAccept.rw4) { wheel *= 2; log.rw4Used++; log.rwViews++; }
    earn(pl, log, wheel, 'wheel');

    streakTick(pl, rng, log);

    var engage = 1 - tune.engageDecay * Math.min(t, 30) / 30;   // зрелость игрока (спад earn)
    var games = Math.max(1, Math.round(pl.freq.sessionsPerDay * pl.freq.gamesPerSession * novelty(t, tune) * engage));
    pl.fieldFreeUsed = false;
    for (var gi = 0; gi < games; gi++) {
      log.rw1UsedThisGame = false;
      var mode = pickMode(pl, rng);
      if (mode === 'field') {
        if (!pl.fieldFreeUsed) { pl.fieldFreeUsed = true; }      // 1 бесплатный запуск/день
        else if (pl.tickets > 0) { pl.tickets--; }               // 2-й+ = билет
        else if (rng() < PROP.rwAccept.rw4 && log.rw4Used < CAPS.rw4PerDay) { log.rw4Used++; log.rwViews++; }
        else { mode = 'classic'; }                               // нет билета/рекламы → обычная партия
      }
      var res = simulateGame(pl, mode, rng, tune);
      if (mode !== 'journey') earn(pl, log, res.coins, 'lines');  // journey — внутри resolveOutcome
      log.games++;
      if (res.crystals > 0) log.crystalGames++;
      resolveOutcome(pl, res, mode, t, rng, tune, log);
    }

    // Daily-миссии (частичное закрытие вокруг EV).
    earn(pl, log, tune.missionsEV * randRange(rng, 0.6, 1.4), 'missions');
    // Недельный всплеск (weekly-миссии + турнир).
    if (t % 7 === 0) earn(pl, log, tune.weeklyBundleEV * randRange(rng, 0.7, 1.3), 'weekly');
    earn(pl, log, EARN.chestAmortPerDay, 'chests');
    // RW-3 «бесплатный бустер» в инвентарь (1/день).
    if (log.rwViews >= 0 && rng() < PROP.rwAccept.rw3) { pl.boosters.hammer++; log.rwViews++; }
    shopDecisions(pl, t, rng, tune, log);

    log.balanceEOD = pl.coins;
    return log;
  }

  /* ==================== СПАВН ИГРОКА / КОГОРТЫ ========================== */

  // Сегменты в детерминированном порядке (для распределения по долям).
  function segmentTable() {
    var rows = [], sk, fq;
    var skOrder = ['NOVICE', 'BASE', 'SKILLED'], fqOrder = ['LIGHT', 'CORE', 'HEAVY'];
    for (var si = 0; si < skOrder.length; si++) for (var fi = 0; fi < fqOrder.length; fi++) {
      sk = skOrder[si]; fq = fqOrder[fi];
      rows.push({ skill: sk, freq: fq, share: SHARES[sk][fq] });
    }
    return rows;
  }

  function spawnPlayer(id, runId, tune) {
    // Детерминированное назначение сегмента по позиции игрока в популяции.
    var rows = segmentTable();
    var frac = (id + 0.5) / tune._N;             // равномерная раскладка по долям
    var acc = 0, chosen = rows[rows.length - 1];
    for (var i = 0; i < rows.length; i++) { acc += rows[i].share; if (frac < acc) { chosen = rows[i]; break; } }
    return {
      id: id, skillTier: chosen.skill, freqTier: chosen.freq,
      skill: SKILL[chosen.skill], freq: FREQ[chosen.freq],
      coins: tune.startGrant,                    // старт = FTUE-грант (05 §3)
      boosters: { hammer: 0, swap: 0, undo: 0 },
      tickets: 1,                                // 05 §3: билет дня 2 в подарок (упрощ. — на старте)
      streakDay: 0, streakCount: 0,
      levelMax: 1, pity: 0,
      fieldFreeUsed: false,
      rng: mulberry32(seedOf(runId, id)),
      aliveUntil: Infinity
    };
  }

  // COHORT: день churn обратным преобразованием кривой удержания 09 §5.1.
  function retentionAt(day) {
    var pts = [[1, 38], [2, 30], [3, 25], [4, 22], [5, 19], [6, 17], [7, 15], [14, 10.5], [30, 6]];
    if (day <= 1) return 38;
    for (var i = 1; i < pts.length; i++) {
      if (day <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        var f = (day - a[0]) / (b[0] - a[0]);
        return (a[1] + f * (b[1] - a[1])) / 100;
      }
    }
    return 0.06;
  }
  function churnDay(rng) {
    // Инвертируем кривую: игрок «жив» до дня d, если u < retention(d).
    var u = rng();
    for (var d = 1; d <= 30; d++) { if (u > retentionAt(d)) return d - 1; }
    return 30;
  }

  /* ============================ ПРОГОН =================================== */

  function runSim(opts) {
    opts = opts || {};
    var tune = mergeTune(opts.tune);
    var N = opts.N || 300;
    var days = opts.days || 30;
    var runId = opts.runId || 'default';
    var simMode = opts.mode || 'SURVIVOR';       // SURVIVOR (калибровка) | COHORT (метрики на DAU)
    tune._N = N;

    var players = [];
    for (var i = 0; i < N; i++) {
      var p = spawnPlayer(i, runId, tune);
      if (simMode === 'COHORT') p.aliveUntil = churnDay(p.rng);
      players.push(p);
    }

    // Аккумуляторы по дням.
    var perDay = [];
    for (var t = 0; t <= days; t++) perDay[t] = null;

    for (var d = 1; d <= days; d++) {
      var acc = {
        balancesBaseCore: [], balancesAll: [],
        earnSum: 0, spendSum: 0, activeCount: 0,
        rwViewsSum: 0, gamesSum: 0, crystalGamesSum: 0,
        deficit: 0, deepDeficit: 0, hoard: 0,
        segAttempt: {}, segFail: {},
        earnBySource: {}, spendBySink: {}, deniedSum: 0
      };
      for (var pi = 0; pi < players.length; pi++) {
        var pl = players[pi];
        if (simMode === 'COHORT' && d > pl.aliveUntil) continue;
        var log = simulateDay(pl, d, pl.rng, tune);
        acc.activeCount++;
        acc.earnSum += log.earn; acc.spendSum += log.spend;
        acc.rwViewsSum += log.rwViews; acc.gamesSum += log.games; acc.crystalGamesSum += log.crystalGames;
        acc.balancesAll.push(pl.coins);
        if (pl.skillTier === 'BASE' && pl.freqTier === 'CORE') acc.balancesBaseCore.push(pl.coins);
        if (pl.coins < 200) acc.deficit++;
        if (pl.coins < 400) acc.deepDeficit++;
        if (pl.coins > 5000) acc.hoard++;
        var k;
        for (k in log.segAttempt) acc.segAttempt[k] = (acc.segAttempt[k] || 0) + log.segAttempt[k];
        for (k in log.segFail) acc.segFail[k] = (acc.segFail[k] || 0) + log.segFail[k];
        for (k in log.earnBySource) acc.earnBySource[k] = (acc.earnBySource[k] || 0) + log.earnBySource[k];
        for (k in log.spendBySink) acc.spendBySink[k] = (acc.spendBySink[k] || 0) + log.spendBySink[k];
        for (k in log.denied) acc.deniedSum += log.denied[k];
      }
      perDay[d] = acc;
    }

    return summarize(perDay, players, days, simMode, tune, runId, N);
  }

  /* ============================ СВОДКА =================================== */

  function summarize(perDay, players, days, simMode, tune, runId, N) {
    var byDay = [];
    for (var d = 1; d <= days; d++) {
      var a = perDay[d];
      var active = Math.max(1, a.activeCount);
      var medBC = median(a.balancesBaseCore);
      var target = BALANCE_05[d] || 0;
      byDay.push({
        day: d,
        balanceMedianBaseCore: Math.round(medBC),
        balanceP10: Math.round(quantile(a.balancesAll, 0.10)),
        balanceP50: Math.round(quantile(a.balancesAll, 0.50)),
        balanceP90: Math.round(quantile(a.balancesAll, 0.90)),
        target05: target,
        devPct: target > 0 ? (medBC - target) / target * 100 : 0,
        earnMean: a.earnSum / active,
        spendMean: a.spendSum / active,
        ratio: a.spendSum > 0 ? a.earnSum / a.spendSum : 0,
        deficitShare: a.deficit / active,
        deepDeficitShare: a.deepDeficit / active,
        hoardShare: a.hoard / active,
        rwPerDau: a.rwViewsSum / active,
        surgeGamesPct: a.gamesSum > 0 ? a.crystalGamesSum / a.gamesSum : 0,
        deniedPerDau: a.deniedSum / active,
        earnBySource: a.earnBySource,
        spendBySink: a.spendBySink
      });
    }

    // Отклонения на чекпоинтах (12 §8.2 критерий M1 ±10%).
    var checkpoints = CHECKPOINTS.map(function (d) {
      var row = byDay[d - 1];
      return { day: d, sim: row.balanceMedianBaseCore, target: row.target05, devPct: row.devPct };
    });
    var maxAbsDev = 0, cpWithin10 = 0;
    checkpoints.forEach(function (c) {
      var ad = Math.abs(c.devPct);
      if (ad > maxAbsDev) maxAbsDev = ad;
      if (ad <= 10) cpWithin10++;
    });

    // Fail-коридоры по сегментам (усреднение за все дни).
    var segAtt = {}, segFail = {};
    for (var di = 0; di < byDay.length; di++) {
      var aa = perDay[di + 1];
      var kk;
      for (kk in aa.segAttempt) segAtt[kk] = (segAtt[kk] || 0) + aa.segAttempt[kk];
      for (kk in aa.segFail) segFail[kk] = (segFail[kk] || 0) + aa.segFail[kk];
    }
    var failRate = {};
    for (var sname in FAIL_CORRIDORS) {
      failRate[sname] = segAtt[sname] > 0 ? (segFail[sname] || 0) / segAtt[sname] : 0;
    }

    // Итоговые агрегаты (усреднение по «стабильной» части D14–D30 где уместно).
    var d14_30 = byDay.filter(function (r) { return r.day >= 14; });
    var ratioMean = mean(d14_30.map(function (r) { return r.ratio; }));
    var rwPerDauMean = mean(byDay.map(function (r) { return r.rwPerDau; }));
    var surgeMean = mean(byDay.map(function (r) { return r.surgeGamesPct; }));
    var last = byDay[byDay.length - 1];

    // ad-ARPDAU: interstitial+banner (допущения 09 §4) + rewarded (симулируется).
    var e = tune.ecpm;
    var adArpdau = (tune.intPerDau * e.int + rwPerDauMean * e.rw + tune.bannerPerDau * e.banner) / 1000;

    // Красные флаги дизайна (12 §8.4).
    var flags = [];
    if (ratioMean < 0.95) flags.push('M2 < 0.95 после D14: sinks агрессивнее плана — дефицит до окна офферов (12 §8.4)');
    if (ratioMean > 1.15) flags.push('M2 > 1.15 после D14: инфляция прихода — earn завышен (05 §6)');
    if (last.deficitShare < 0.20) flags.push('M8 < 20% к D30: окно дефицита 05 §7 п.2 не открывается (12 §8.4)');
    if (last.hoardShare > 0.05) flags.push('M10 > 5% к D30: риск ветеранов-накопителей недооценён (12 §8.4)');
    if (surgeMean < 0.40) flags.push('M7 < 40%: Прилив мёртв для медианы — сверить pClear/заряд (12 §8.4)');

    return {
      meta: { runId: runId, N: N, days: days, mode: simMode, tune: tune, sharesOk: assertShares() },
      byDay: byDay,
      checkpoints: checkpoints,
      calibration: {
        maxAbsDevPct: maxAbsDev,
        checkpointsWithin10: cpWithin10,
        checkpointsTotal: CHECKPOINTS.length,
        pass: (cpWithin10 === CHECKPOINTS.length && ratioMean >= 0.95 && ratioMean <= 1.15)
      },
      aggregates: {
        ratioMean: ratioMean,
        rwPerDauMean: rwPerDauMean,
        surgeGamesPct: surgeMean,
        adArpdau: adArpdau,
        deficitShareD30: last.deficitShare,
        deepDeficitShareD30: last.deepDeficitShare,
        hoardShareD30: last.hoardShare,
        failRate: failRate,
        failCorridors: FAIL_CORRIDORS
      },
      flags: flags
    };
  }

  /* ==================== ТЕКСТОВАЯ СВОДКА (node/консоль) ================== */

  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function padL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  function toText(sum) {
    var L = [];
    L.push('==========================================================================');
    L.push(' Block Surge — симулятор экономики (12-economy-sim.md), Проход Г');
    L.push('==========================================================================');
    L.push(' runId=' + sum.meta.runId + '  N=' + sum.meta.N + '  дней=' + sum.meta.days +
      '  режим=' + sum.meta.mode + '  доли Σ=1: ' + (sum.meta.sharesOk ? 'ok' : 'СБОЙ'));
    L.push('');
    L.push(' Медиана баланса BASE×CORE по дням против таблицы 05 §4:');
    L.push(' ' + pad('день', 5) + padL('sim', 7) + padL('05§4', 7) + padL('откл%', 8) +
      padL('earn', 7) + padL('spend', 7) + padL('ratio', 7) + padL('деф<200', 9));
    for (var i = 0; i < sum.byDay.length; i++) {
      var r = sum.byDay[i];
      var mark = Math.abs(r.devPct) > 10 ? ' !' : '';
      L.push(' ' + pad(r.day, 5) + padL(r.balanceMedianBaseCore, 7) + padL(r.target05, 7) +
        padL(r.devPct.toFixed(1), 8) + padL(r.earnMean.toFixed(0), 7) + padL(r.spendMean.toFixed(0), 7) +
        padL(r.ratio.toFixed(2), 7) + padL((r.deficitShare * 100).toFixed(0) + '%', 9) + mark);
    }
    L.push('');
    L.push(' Калибровка (M1, чекпоинты ' + CHECKPOINTS.join('/') + '):');
    sum.checkpoints.forEach(function (c) {
      L.push('   день ' + pad(c.day, 3) + ' sim=' + padL(c.sim, 5) + '  цель=' + padL(c.target, 5) +
        '  откл=' + padL(c.devPct.toFixed(1) + '%', 7) + (Math.abs(c.devPct) <= 10 ? '  ok' : '  ВНЕ ±10%'));
    });
    L.push('   max|откл| = ' + sum.calibration.maxAbsDevPct.toFixed(1) + '%  ·  в ±10%: ' +
      sum.calibration.checkpointsWithin10 + '/' + sum.calibration.checkpointsTotal +
      '  ·  вердикт калибровки: ' + (sum.calibration.pass ? 'СОШЁЛСЯ' : 'требует тюнинга'));
    L.push('');
    L.push(' Агрегаты:');
    var ag = sum.aggregates;
    L.push('   earn/spend ratio (D14–30, цель 0.95–1.15): ' + ag.ratioMean.toFixed(3));
    L.push('   rewarded/DAU (цель ≈1.8): ' + ag.rwPerDauMean.toFixed(2));
    L.push('   % партий с кристаллом / Прилив (M7, цель ≥60%): ' + (ag.surgeGamesPct * 100).toFixed(0) + '%');
    L.push('   ad-ARPDAU (T1-eCPM ' + sum.meta.tune.ecpm.rw + '/' + sum.meta.tune.ecpm.int + '/' +
      sum.meta.tune.ecpm.banner + '): $' + ag.adArpdau.toFixed(4));
    L.push('   доля дефицита D30: <200 = ' + (ag.deficitShareD30 * 100).toFixed(0) + '%  ·  <400 = ' +
      (ag.deepDeficitShareD30 * 100).toFixed(0) + '%  ·  накопители >5000 = ' + (ag.hoardShareD30 * 100).toFixed(1) + '%');
    L.push('   fail-коридоры по сегментам уровней (03 §5.2):');
    for (var sn in ag.failCorridors) {
      var cor = ag.failCorridors[sn];
      var fr = ag.failRate[sn] * 100;
      var inC = fr >= cor[0] * 100 - 1 && fr <= cor[1] * 100 + 1;
      L.push('     ' + pad(sn, 8) + ' = ' + padL(fr.toFixed(1) + '%', 7) +
        '  (коридор ' + (cor[0] * 100) + '–' + (cor[1] * 100) + '%)' + (inC ? '' : '  вне'));
    }
    if (sum.flags.length) {
      L.push('');
      L.push(' Красные флаги дизайна (12 §8.4):');
      sum.flags.forEach(function (f) { L.push('   • ' + f); });
    } else {
      L.push('');
      L.push(' Красных флагов дизайна нет (12 §8.4).');
    }
    L.push('==========================================================================');
    return L.join('\n');
  }

  /* ============================ ЭКСПОРТ ================================== */

  var Sim = {
    run: runSim,
    toText: toText,
    // экспортируем константы/утилиты для кокпита и тестов:
    BOOK_TUNE: BOOK_TUNE, PRICES: PRICES, EARN: EARN, CAPS: CAPS,
    BALANCE_05: BALANCE_05, EARN_05: EARN_05, SPEND_05: SPEND_05,
    RETENTION: RETENTION, CHECKPOINTS: CHECKPOINTS, FAIL_CORRIDORS: FAIL_CORRIDORS,
    retentionAt: retentionAt, mergeTune: mergeTune,
    fnv1a32: fnv1a32, mulberry32: mulberry32, seedOf: seedOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  if (global) global.Sim = Sim;

  /* Headless-запуск: `node sim.js` печатает сводку в stdout. */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    var runId = process.argv[2] || 'cli';
    var N = parseInt(process.argv[3], 10) || 2000;
    var survivor = Sim.run({ N: N, days: 30, runId: runId, mode: 'SURVIVOR' });
    process.stdout.write(Sim.toText(survivor) + '\n');
    // Короткая COHORT-сводка (метрики «на DAU»: rewarded/DAU, ad-ARPDAU).
    var cohort = Sim.run({ N: N, days: 30, runId: runId, mode: 'COHORT' });
    process.stdout.write('\n COHORT (метрики на DAU, кривая удержания 09 §5.1):\n');
    process.stdout.write('   rewarded/DAU = ' + cohort.aggregates.rwPerDauMean.toFixed(2) +
      '  ·  ad-ARPDAU (T1) = $' + cohort.aggregates.adArpdau.toFixed(4) +
      '  ·  earn/spend = ' + cohort.aggregates.ratioMean.toFixed(3) + '\n');
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
