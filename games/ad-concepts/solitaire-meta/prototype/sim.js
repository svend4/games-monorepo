/* =============================================================================
 * Orchard Peaks — СИМУЛЯТОР ЭКОНОМИКИ (Проход Г, soft-launch cockpit)
 * -----------------------------------------------------------------------------
 * Исполняемая реализация приложения [12-economy-sim.md]: агентная симуляция
 * 30 дней жизни медианного неплатящего игрока (персона «45–70» — винрейт × частота,
 * §12.2). Отвечает на три вопроса главы 12:
 *   (1) происходит ли плановый переход профицит→дефицит с точкой «Кошелька» в окне
 *       дня 12–16 (§12.6 гейт К3, [05] §5.4/§5.7);
 *   (2) держатся ли коридоры контрольного дашборда (§12.5, [05] §5.8);
 *   (3) насколько экономика чувствительна к смещению WR / темпа взноса / rewarded.
 *
 * Числа — из таблиц [05] §5.2, [06] §6.2, [11] §11.5/§11.7. Локальных констант
 * баланса нет: всё в объекте BOOK ниже, каждое поле помечено источником.
 *
 * ДЕТЕРМИНИЗМ (инвариант I-E1): весь случай — через seeded-PRNG (mulberry32),
 * seed = base + 7·i на игрока (сиды «1000 + 7·i», §12.1). НИ ОДНОГО обращения к
 * Math.random / Date.now в расчётах — прогон воспроизводим бит-в-бит по seed.
 *
 * ДВА РЕЖИМА ЗАПУСКА (один и тот же модуль):
 *   • Браузер:  window.Sim.run({...}) → объект-сводка, рендерится в кокпите
 *               (experiments.js). Кап N игроков ~200–400 → прогон < 1 c.
 *   • Node CLI: `node sim.js` → печать текстовой сводки (N=2000, 30 дней, seed 1000)
 *               в stdout; `require('./sim.js')` отдаёт тот же API.
 * ========================================================================== */
'use strict';

(function () {

  /* ============================ ПАРАМЕТРЫ КНИГИ ============================ */
  /* Единственный источник номиналов. Тюнинг-панель (experiments.js) и A/B
   * накладывают оверрайды поверх копии этого объекта; кнопка «сброс к книге»
   * возвращает ровно сюда. */
  var BOOK = {
    /* --- Монетный контур, [05] §5.2 --- */
    entryBase:   350,          // E(n) = 350·1.012ⁿ, округление до 10
    entryGrowth: 1.012,        // A/B #4 ([09] §9.6): 1.010 / 1.012 / 1.015
    winMHi:   2.2,             // M(n) = 2.2 − 0.7·min(1, n/60)
    winMDrop: 0.7,
    winMKnee: 60,

    /* --- Кривая WR, [11] §11.5 (W(n)=0.55+0.35·e^(−n/25)+Osc), [03] §3.5 --- */
    wrPlateau: 0.55,           // плато ([11] контроль: n=100 → 55.6%)
    wrSpan:    0.35,           // амплитуда экспоненты (n=20 → 71%, n=50 → 60%)
    wrDecay:   25,             // постоянная спада
    stoneDip: -0.15,           // Osc на «камнях» n%10==0 → WR ≈ 40.6% ([11] §11.5)

    /* --- Бонус за остаток стока, [05] §5.2 / [11] §11.7 --- */
    stockBonusPerCard: 25,     // 25 × номер главы за карту
    stockLeft: [2, 3],         // консервативная половина диапазона 2–4 ([11] §11.7)

    /* --- Бустеры (цены-sinks), [05] §5.2/§5.6 --- */
    boosters: { joker: 1200, plus5: 900, basket: 800, undoPaid: 150 },

    /* --- Прочие sources, [05] §5.2 / [04] §4.4 --- */
    wheelEV: 350,              // колесо ярмарки, EV ≈ 350, 1/день
    streak7: [200, 300, 400, 500, 600, 800, 1500],   // «Утренняя лейка» день 1–7
    missionDaily:  { count: 3, lo: 150, hi: 400, minAttempts: 4 },
    missionWeekly: { count: 3, lo: 800, hi: 1500 },
    missionMult: 1.0,          // тюнинг: номиналы миссий ±% (рычаг Ф2 — высота карусели)
    chestTiers: [[5, 300], [10, 700], [15, 1500]],   // сундук тёти Марты: побед → монеты

    /* --- Rewarded «Кошелёк» RW6, [06] §6.2 --- */
    rw6Grant:   0.8,           // грант 0.8·E(n); A/B #5: 0.6 / 0.8 / 1.0
    rw6CapDay:  3,             // ≤ 3 видео/день (I-E4)
    rw6OfferAt: 2.0,           // оффер виден при balance < 2·E(n) (метрика точки «Кошелька»)
    rw2DoubleP: 0.08,          // RW2 «удвоить» — редкая привычка персоны (§12.3)
    rw1RescueP: 0.48,          // оффер тупика → просмотр RW1 (доля берущих бесплатный второй шанс)
    rw3StoneP:  0.50,          // бесплатный RW3-бустер на «камне» после адопции

    /* --- Стартовые запасы, [05] §5.3 --- */
    start: { coins: 1000, harvest: 20, freeUndo: 2, joker: 1 },

    /* --- Сад, §12.4 (стоимости заказов — калибровочный выход) --- */
    goldenBedDays: [9, 23],    // ивент «Золотая грядка» ×2 урожай ([04] §4.7)
    orderCostMult: 1.0,        // A/B: стоимость заказов ±20% (0.8 / 1.0 / 1.2)
    harvestLo: 10, harvestHi: 14,               // номинал урожая уровня ([04] §4.2)
    rw3HarvestMult: 2,         // A/B «rewarded-урожай ×2»: множитель RW3-лукошка (1 / 2)
    zoneOrderCosts: [          // §12.4: тоталы 750 / 1300 / 1440, зоны 3+ повторяют [2]
      [40, 60, 80, 90, 100, 110, 130, 140],                       // зона 1 «Крыльцо» = 750
      [40, 70, 100, 120, 130, 150, 160, 170, 180, 180],           // зона 2 «Клумбы» = 1300
      [40, 70, 90, 110, 120, 130, 140, 150, 150, 150, 150, 140]   // зона 3+ = 1440
    ],

    /* --- eCPM для ad-ARPDAU симкогорты, [09] §9.3 / [06] §6.7 --- */
    ecpmRewarded: 16.0,        // Tier-1 blended, $ (A/B гардрейл §6.7)
    ecpmInt:      12.0,        // interstitial blended, $
    intStartLevel: 12,         // INT1 не раньше уровня 12 ([06] §6.3.1)
    intDailyCap:   8,          // ≤ 8 INT/день ([06] §6.3.3)
    intMinLevels:  2,          // ≥ 2 уровня между INT ([06] §6.3.2)

    /* --- Допущение IAP-ARPDAU (НЕ симулируется: персона неплатящая) --- */
    iapArpdau: 0.12            // база [09] §9.3 — вход для гейтов юнит-экономики
  };

  /* ============================ SEEDED-PRNG ============================ */
  /* mulberry32 — компактный детерминированный генератор. Тот же PRNG-контракт,
   * что I6 в [11]: один seed → один поток чисел, воспроизводимо. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    var r = mulberry32(seed);
    return {
      f: r,
      u: function (a, b) { return a + (b - a) * r(); },
      iInc: function (a, b) { return Math.floor(a + (b - a + 1) * r()); },   // целое [a,b]
      gauss: function (mean, sd) {
        var u = 1 - r(), v = r();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      // Треугольное распределение с модой c на [a,b] (день адопции rewarded, §12.2)
      tri: function (a, c, b) {
        var u = r(), fc = (c - a) / (b - a);
        return u < fc ? a + Math.sqrt(u * (b - a) * (c - a))
                      : b - Math.sqrt((1 - u) * (b - a) * (b - c));
      }
    };
  }

  /* ============================ ФОРМУЛЫ ЭКОНОМИКИ ============================ */
  function round10(x) { return Math.round(x / 10) * 10; }
  function E(n, P) { return round10(P.entryBase * Math.pow(P.entryGrowth, n)); }        // взнос
  function M(n, P) { return P.winMHi - P.winMDrop * Math.min(1, n / P.winMKnee); }       // множитель
  function isStone(n) { return n >= 10 && n % 10 === 0; }
  function W(n, P) {                                                                     // WR-кривая
    var base = P.wrPlateau + P.wrSpan * Math.exp(-n / P.wrDecay);
    return base + (isStone(n) ? P.stoneDip : 0);
  }
  function chapterOf(n) { return Math.max(1, Math.min(12, Math.ceil(n / 20))); }         // глава ≈ 20 ур.
  function attemptsBase(t) {                                                             // A(t), §12.2
    if (t <= 1) return 14;
    if (t === 2) return 12;
    if (t === 3) return 11;
    if (t <= 7) return 10;
    if (t <= 20) return 9;
    return 8;
  }
  function aggro(t) {                                                                    // агрессия трат
    if (t <= 2) return 0.35;
    if (t <= 5) return 0.55;
    if (t <= 10) return 1.05;
    return 1.8;
  }
  function wealthMult(t) { return t <= 5 ? 8 : (t <= 10 ? 6 : 4); }                       // порог богатства ×E
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /* ============================ ПЕРСОНА ИГРОКА (§12.2) ============================ */
  function makeProfile(rng) {
    return {
      skillOffset:   clamp(rng.gauss(0, 0.04), -0.08, 0.08),   // сдвиг WR ±8 п.п.
      attemptsMult:  clamp(rng.gauss(1, 0.12), 0.7, 1.3),      // частота попыток
      rwAdoptDay:    Math.round(rng.tri(10, 14, 21)),          // «без rewarded до дня 10»
      spendAffinity: rng.u(0.85, 1.15)                         // склонность тратить
    };
  }

  function initState(P, profile) {
    return {
      coins:   P.start.coins,
      harvest: P.start.harvest,
      level:   1,
      lossStreakOnLevel: 0,
      freeUndoLeft: P.start.freeUndo,
      joker: P.start.joker,
      profile: profile,
      // сад
      zone: 0, orderIdx: 0,
      // INT-счётчики (переживают дни внутри игрока)
      levelsSinceInt: 99, intToday: 0
    };
  }

  /* ============================ ПОЛИТИКИ ПОВЕДЕНИЯ (§12.2) ============================ */
  // «Кошелёк» RW6: добор монет до входа при реальной нужде (coins < E), кап 3/день.
  function policyWallet(st, t, e, viewsToday, P, rng) {
    return t >= st.profile.rwAdoptDay && st.coins < e
        && viewsToday < P.rw6CapDay && rng.f() < 0.75;
  }
  // Спасение в тупике: сперва RW1 (бесплатно), затем монеты 0.9·E; «до дна» после адопции.
  function policyRescue(st, t, e, P, rng) {
    var aff = st.profile.spendAffinity, ag = aggro(t);
    if (t >= st.profile.rwAdoptDay && rng.f() < P.rw1RescueP) return 'RW1';
    var gate = t >= st.profile.rwAdoptDay ? 1.5 : 3.0;
    if (st.coins > gate * e && rng.f() < Math.min(0.9, 0.65 * aff * ag)) return 'PAY';
    return 'DECLINE';
  }
  // Pre-level бустер. На «камне»: бесплатный RW3-лукошко (реклама) или «+5 карт» за 900.
  // Вне камня: спонтанная покупка выше порога/гейта (джокер / +5 / лукошко поровну).
  function policyBooster(st, t, e, stone, P, rng) {
    var aff = st.profile.spendAffinity, ag = aggro(t);
    if (stone) {
      if (t >= st.profile.rwAdoptDay && rng.f() < P.rw3StoneP)
        return { kind: 'basket', paid: false, ad: true };   // RW3 бесплатно, ×2 урожай
      if (st.coins > 2 * e && rng.f() < Math.min(0.85, 0.6 * aff * ag))
        return { kind: 'plus5', paid: true };
      return null;
    }
    var gate = (t >= st.profile.rwAdoptDay ? 1.5 : wealthMult(t)) * e;
    if (st.coins <= gate) return null;
    // «Обучение богатством» (дни 1–4, §12.2): чем выше запас во взносах, тем охотнее
    // игрок пробует бустеры. Множитель бьёт по ранней фазе (D1–13) и почти не трогает
    // плато (баланс карусели ~4·E) — коридоры K5/K6 меряются на D14+ и остаются целы.
    var rich = st.coins / e;
    var richK = rich > 15 ? 5.8 : (rich > 10 ? 3.0 : (rich > 7 ? 1.5 : 1.0));
    if (rng.f() < Math.min(0.64, 0.078 * aff * ag * richK)) {
      // Лукошко — «любимый бустер неплательщика» ([05] §5.6): чаще прочих; ×2 урожай
      // (растит сад → заказы/день) и одновременно монетный sink (гасит ранний профицит).
      var r = rng.f();
      var kind = r < 0.30 ? 'joker' : (r < 0.55 ? 'plus5' : 'basket');
      return { kind: kind, paid: true };
    }
    return null;
  }

  /* ============================ УРОЖАЙ / САД (§12.4) ============================ */
  function harvestYield(n, buy, t, P, day) {
    var h = P.harvestLo + Math.floor((day.rngH()) * (P.harvestHi - P.harvestLo + 1)); // U_int(10,14)
    if (buy && (buy.kind === 'basket')) h *= (buy.ad ? P.rw3HarvestMult : 2);          // лукошко/RW3
    if (P.goldenBedDays.indexOf(t) >= 0) h *= 2;                                       // «Золотая грядка»
    return h;
  }
  function orderCost(zone, idx, P) {
    var band = P.zoneOrderCosts[Math.min(zone, P.zoneOrderCosts.length - 1)];
    if (idx >= band.length) return undefined;
    return Math.round(band[idx] * P.orderCostMult);
  }
  function settleGardenOrders(st, day, P) {
    while (true) {
      var cost = orderCost(st.zone, st.orderIdx, P);
      if (cost === undefined) { st.zone++; st.orderIdx = 0; day.zoneClosed = st.zone; continue; }
      if (st.harvest < cost) break;
      st.harvest -= cost; st.orderIdx++; day.orders++;
    }
  }

  /* ============================ ДЕНЬ (§12.3) ============================ */
  function newDayLog(rng) {
    return {
      sources: 0, rwIncome: 0, sinks: 0,
      wins: 0, attempts: 0, boostAttempts: 0,
      rw6Views: 0, rwImps: 0, intImps: 0,
      orders: 0, zoneClosed: -1,
      harvestNominal: 0, harvestReal: 0,
      // номинал урожая тянет из того же seeded-потока игрока (алиас rng.f) —
      // единый детерминированный источник на игрока, воспроизводим по seed
      rngH: rng.f
    };
  }
  function earn(st, amount, day) { amount = Math.round(amount); st.coins += amount; day.sources += amount; }
  function grantRW(st, amount, day) { amount = Math.round(amount); st.coins += amount; day.rwIncome += amount; }
  function pay(st, amount, day) { amount = Math.round(amount); st.coins -= amount; day.sinks += amount; }

  function simulateDay(st, t, P, rng) {
    var day = newDayLog(rng);

    earn(st, P.streak7[(t - 1) % 7], day);                 // «Утренняя лейка», без пропусков дней
    if (rng.f() < 0.9) earn(st, P.wheelEV, day);           // колесо ярмарки, 1/день

    st.intToday = 0;                                        // суточный INT-кап
    var A = Math.round(attemptsBase(t) * st.profile.attemptsMult);

    for (var i = 0; i < A; i++) {
      var n = st.level, e = E(n, P);

      while (policyWallet(st, t, e, day.rw6Views, P, rng)) {   // RW6: добор монет до входа
        grantRW(st, round10(P.rw6Grant * e), day);
        day.rw6Views++; day.rwImps++;
      }
      if (st.coins < e) break;                             // банкротство дня — инвариант I-E3
      pay(st, e, day); day.attempts++;                     // взнос ([05] §5.2)

      var buy = policyBooster(st, t, e, isStone(n), P, rng);  // денежный поток, WR не трогаем (I-E2)
      if (buy) {
        day.boostAttempts++;
        if (buy.paid) pay(st, P.boosters[buy.kind], day);
        else day.rwImps++;                                 // RW3 — rewarded-показ
      }
      if (st.freeUndoLeft > 0) st.freeUndoLeft--;          // стартовые ундо гасят первые платные
      else if (rng.f() < 0.12 * aggro(t)) pay(st, P.boosters.undoPaid, day);

      var pity = st.lossStreakOnLevel >= 5 ? 0.09           // «лёгкая рука» ([03] §3.5)
               : st.lossStreakOnLevel >= 3 ? 0.05 : 0;
      var p = clamp(W(n, P) + st.profile.skillOffset + pity, 0.02, 0.995);
      var win = rng.f() < p;

      if (rng.f() < (1 - p) * 0.9) {                       // тупик со столом ≥ 60% — оффер спасения
        var r = policyRescue(st, t, e, P, rng);
        if (r === 'RW1') day.rwImps++;                     // бесплатный второй шанс — rewarded-показ
        else if (r === 'PAY') {
          pay(st, round10(0.9 * e), day);                  // конверсия уже в W(n) — только деньги
          if (st.coins > 2 * e && rng.f() < 0.42) pay(st, round10(1.2 * e), day);   // повторное спасение
        }
      }

      if (win) {
        var gain = round10(M(n, P) * e)
                 + P.stockBonusPerCard * chapterOf(n) * (P.stockLeft[0] + Math.floor(rng.f() * (P.stockLeft[1] - P.stockLeft[0] + 1)));
        if (t >= st.profile.rwAdoptDay && rng.f() < P.rw2DoubleP) {    // RW2 «удвоить» — редкая привычка
          var dbl = round10(M(n, P) * e);
          grantRW(st, dbl, day); gain += dbl; day.rwImps++;
        }
        earn(st, gain, day);
        var yld = harvestYield(n, buy, t, P, day);
        st.harvest += yld; day.harvestNominal += yld; day.harvestReal += yld;
        day.wins++; st.level++; st.lossStreakOnLevel = 0;

        // INT1 на возврате в сад после победы ([06] §6.3): уровень ≥ 12, день ≥ 2,
        // ≥ 2 уровня с прошлого INT, дневной кап 8. Персона неплатящая → без remove-ads.
        st.levelsSinceInt++;
        if (n >= P.intStartLevel && t >= 2 && st.levelsSinceInt >= P.intMinLevels && st.intToday < P.intDailyCap) {
          day.intImps++; st.intToday++; st.levelsSinceInt = 0;
        }
      } else {
        var yl = harvestYield(n, buy, t, P, day);
        var realized = Math.round(yl * rng.u(0.45, 0.65));  // пол поражения ≥ 50% ([11] Q4)
        st.harvest += realized; day.harvestNominal += yl; day.harvestReal += realized;
        st.lossStreakOnLevel++;
        st.levelsSinceInt++;
      }
    }

    if (day.attempts >= P.missionDaily.minAttempts)         // daily-миссии закрываются игрой
      for (var m = 0; m < P.missionDaily.count; m++)
        if (rng.f() < 0.85) earn(st, round10(P.missionMult * rng.u(P.missionDaily.lo, P.missionDaily.hi)), day);
    if (t % 7 === 0)                                        // weekly-миссии
      for (var w = 0; w < P.missionWeekly.count; w++)
        if (rng.f() < 0.80) earn(st, round10(P.missionMult * rng.u(P.missionWeekly.lo, P.missionWeekly.hi)), day);
    for (var c = 0; c < P.chestTiers.length; c++)           // сундук тёти Марты
      if (day.wins >= P.chestTiers[c][0]) earn(st, P.chestTiers[c][1], day);

    settleGardenOrders(st, day, P);
    return day;
  }

  /* ============================ СТАТИСТИКА ============================ */
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function percentile(arr, p) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var idx = clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1);
    return a[idx];
  }
  function mean(arr) { if (!arr.length) return 0; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

  /* ============================ ПРОГОН КОГОРТЫ ============================ */
  function mergeParams(over) {
    var P = JSON.parse(JSON.stringify(BOOK));
    if (over) for (var k in over) if (over.hasOwnProperty(k)) P[k] = over[k];
    return P;
  }

  function run(opts) {
    opts = opts || {};
    var P = mergeParams(opts.params);
    var N = Math.max(1, opts.N || 2000);
    var days = opts.days || 30;
    var baseSeed = (opts.seed != null) ? (opts.seed | 0) : 1000;

    // Помесячные когортные накопители по дням: баланс, уровень, сальдо.
    var balByDay = [], lvlByDay = [], saldoByDay = [];
    for (var d = 0; d <= days; d++) { balByDay[d] = []; lvlByDay[d] = []; saldoByDay[d] = []; }

    var walletPoints = [];                 // точка «Кошелька» на игрока
    var zone1ByD7 = 0;                      // закрыл зону 1 к D7
    var ordersTotal = 0;
    // Накопители коридоров D14+ (дни 15–30) — когортно-агрегатные
    var sinks1530 = 0, sourcesCore1530 = 0, attempts1530 = 0, boost1530 = 0;
    // Ad-ARPDAU
    var rwImpsTot = 0, intImpsTot = 0, rw6ViewsTot = 0;
    var harvestNomTot = 0, harvestRealTot = 0;

    for (var i = 0; i < N; i++) {
      var rng = makeRng(baseSeed + 7 * i);
      var profile = makeProfile(rng);
      var st = initState(P, profile);
      var wp = Infinity;
      var prevBal = st.coins;

      for (var t = 1; t <= days; t++) {
        var day = simulateDay(st, t, P, rng);

        balByDay[t].push(st.coins);
        lvlByDay[t].push(st.level);
        saldoByDay[t].push(st.coins - prevBal);
        prevBal = st.coins;

        // Точка «Кошелька»: первый день, когда игрок не может оплатить попытки без RW6
        // ЛИБО баланс на конец дня < 2·E(n) ([05] §5.4/§5.7, §12.5).
        if (wp === Infinity && (day.rw6Views > 0 || st.coins < P.rw6OfferAt * E(st.level, P))) wp = t;

        if (t >= 15) {
          sinks1530 += day.sinks; sourcesCore1530 += day.sources;
          attempts1530 += day.attempts; boost1530 += day.boostAttempts;
        }
        if (t === 7 && st.zone >= 1) zone1ByD7++;

        rwImpsTot += day.rwImps; intImpsTot += day.intImps; rw6ViewsTot += day.rw6Views;
        ordersTotal += day.orders;
        harvestNomTot += day.harvestNominal; harvestRealTot += day.harvestReal;
      }
      walletPoints.push(wp === Infinity ? days + 1 : wp);
    }

    /* ---- Свод по дням ---- */
    var byDay = [];
    for (var dd = 1; dd <= days; dd++) {
      var mb = median(balByDay[dd]);
      var ml = Math.round(median(lvlByDay[dd]));
      byDay.push({
        day: dd,
        medBalance: Math.round(mb),
        medLevel: ml,
        medSaldo: Math.round(median(saldoByDay[dd])),
        entry: E(ml, P),
        balInEntries: E(ml, P) > 0 ? mb / E(ml, P) : 0
      });
    }

    /* ---- Пик / первый дефицитный день ---- */
    var peak = { day: 1, balance: byDay[0].medBalance };
    for (var q = 1; q < byDay.length; q++) if (byDay[q].medBalance > peak.balance) peak = { day: byDay[q].day, balance: byDay[q].medBalance };
    var firstNeg = 0;
    for (var f = 0; f < byDay.length; f++) if (byDay[f].medSaldo < 0) { firstNeg = byDay[f].day; break; }

    var playerDays = N * days;
    var adRevTotal = (rwImpsTot * P.ecpmRewarded + intImpsTot * P.ecpmInt) / 1000;

    var wpMedian = median(walletPoints);
    var find = function (d) { for (var z = 0; z < byDay.length; z++) if (byDay[z].day === d) return byDay[z]; return byDay[byDay.length - 1]; };

    return {
      meta: { N: N, days: days, seed: baseSeed, params: P },
      byDay: byDay,
      peak: peak,
      firstNegDay: firstNeg,
      wallet: {
        median: wpMedian,
        iqrLo: percentile(walletPoints, 0.25),
        iqrHi: percentile(walletPoints, 0.75),
        inWindow: wpMedian >= 12 && wpMedian <= 16
      },
      balD7Entries:  find(7).balInEntries,
      balD30Entries: find(days).balInEntries,
      sinkSourceD14: sourcesCore1530 > 0 ? sinks1530 / sourcesCore1530 : 0,
      boosterShareD14: attempts1530 > 0 ? boost1530 / attempts1530 : 0,
      garden: {
        ordersPerDay: ordersTotal / playerDays,
        zone1ByD7Pct: zone1ByD7 / N
      },
      harvestRealization: harvestNomTot > 0 ? harvestRealTot / harvestNomTot : 0,
      ad: {
        adArpdau: adRevTotal / playerDays,
        rewardedPerDau: rwImpsTot / playerDays,
        intPerDau: intImpsTot / playerDays,
        rw6PerDau: rw6ViewsTot / playerDays,
        ecpmRw: P.ecpmRewarded, ecpmInt: P.ecpmInt
      }
    };
  }

  /* ============================ ГЕЙТЫ К1–К8 (§12.6) ============================ */
  /* Оценка симкогорты против контрольных точек приёмки экономического прогона. */
  function checkGates(res) {
    var g = [];
    var add = function (id, name, target, factStr, ok) { g.push({ id: id, name: name, target: target, fact: factStr, ok: ok }); };

    add('К1', 'Пик баланса', 'день 3–7', 'день ' + res.peak.day + ' (' + Math.round(res.peak.balance / 1000) + 'K)',
      res.peak.day >= 3 && res.peak.day <= 7);
    add('К2', 'Первый отрицательный день', '5 ± 1', 'день ' + res.firstNegDay,
      res.firstNegDay >= 4 && res.firstNegDay <= 6);
    add('К3', 'Точка «Кошелька» (профицит→дефицит)', 'день 12–16',
      'медиана ' + res.wallet.median + ', IQR ' + res.wallet.iqrLo + '–' + res.wallet.iqrHi, res.wallet.inWindow);
    add('К4', 'Баланс D7 во взносах', '8–15', res.balD7Entries.toFixed(1),
      res.balD7Entries >= 8 && res.balD7Entries <= 15);
    add('К5', 'Sink/Source D14+ (без RW)', '1.05–1.15', res.sinkSourceD14.toFixed(2),
      res.sinkSourceD14 >= 1.05 && res.sinkSourceD14 <= 1.15);
    add('К6', 'Доля уровней с бустером D14+', '15–25%', (res.boosterShareD14 * 100).toFixed(0) + '%',
      res.boosterShareD14 >= 0.15 && res.boosterShareD14 <= 0.25);
    add('К7', 'Баланс D30 во взносах', '1–2 (карусель)', res.balD30Entries.toFixed(1),
      res.balD30Entries >= 1 && res.balD30Entries <= 2);
    add('К8', 'Заказов/день; зона 1 к D7', '≥ 1; 60%',
      res.garden.ordersPerDay.toFixed(2) + '; ' + (res.garden.zone1ByD7Pct * 100).toFixed(0) + '%',
      res.garden.ordersPerDay >= 1 && res.garden.zone1ByD7Pct >= 0.6);
    return g;
  }

  /* ============================ CLI-СВОДКА (node) ============================ */
  function formatSummary(res) {
    var P = res.meta.params;
    var L = [];
    L.push('==============================================================');
    L.push(' Orchard Peaks — СИМУЛЯТОР ЭКОНОМИКИ (Проход Г, приложение 12)');
    L.push('==============================================================');
    L.push(' N=' + res.meta.N + ' игроков · ' + res.meta.days + ' дней · seed=' + res.meta.seed +
           ' · взнос E(n)=' + P.entryBase + '·' + P.entryGrowth + 'ⁿ');
    L.push(' WR(n)=' + P.wrPlateau + '+' + P.wrSpan + '·e^(−n/' + P.wrDecay + ')  ' +
           '(камни ' + P.stoneDip + ') · rw6-грант ' + P.rw6Grant + '·E · заказы ×' + P.orderCostMult);
    L.push('');
    L.push(' Монетный контур по дням (медианы когорты):');
    L.push(' ---------------------------------------------------------------');
    L.push('  День |  Ур. |     Баланс |  Сальдо/день |  Бал/E |  Взнос E(n)');
    L.push(' ------+------+------------+--------------+--------+------------');
    var show = [1, 2, 4, 5, 7, 10, 14, 21, 30];
    for (var s = 0; s < res.byDay.length; s++) {
      var r = res.byDay[s];
      if (show.indexOf(r.day) < 0) continue;
      L.push(
        '  ' + pad(r.day, 3) + '  | ' + pad(r.medLevel, 4) + ' | ' + pad(fmt(r.medBalance), 10) +
        ' | ' + pad((r.medSaldo >= 0 ? '+' : '') + fmt(r.medSaldo), 12) +
        ' | ' + pad(r.balInEntries.toFixed(1), 6) + ' | ' + pad(fmt(r.entry), 10));
    }
    L.push('');
    L.push(' Точка «Кошелька» (профицит→дефицит): медиана день ' + res.wallet.median +
           ', IQR ' + res.wallet.iqrLo + '–' + res.wallet.iqrHi +
           '  →  окно 12–16: ' + (res.wallet.inWindow ? 'ПОПАЛИ ✓' : 'мимо ✗'));
    L.push(' Пик баланса: день ' + res.peak.day + ' (' + fmt(res.peak.balance) + ')' +
           ' · первый дефицитный день: ' + res.firstNegDay);
    L.push('');
    L.push(' Сад: заказов/день ' + res.garden.ordersPerDay.toFixed(2) +
           ' · зона 1 к D7 у ' + (res.garden.zone1ByD7Pct * 100).toFixed(0) + '% когорты' +
           ' · реализация урожая ' + (res.harvestRealization * 100).toFixed(0) + '% номинала');
    L.push(' Реклама: ad-ARPDAU $' + res.ad.adArpdau.toFixed(4) +
           ' · rewarded ' + res.ad.rewardedPerDau.toFixed(2) + '/DAU' +
           ' (RW6 ' + res.ad.rw6PerDau.toFixed(2) + ')' +
           ' · INT ' + res.ad.intPerDau.toFixed(2) + '/DAU');
    L.push('');
    L.push(' Контрольные точки приёмки (§12.6):');
    L.push(' ---------------------------------------------------------------');
    var gates = checkGates(res);
    var passed = 0;
    for (var gi = 0; gi < gates.length; gi++) {
      var gg = gates[gi];
      if (gg.ok) passed++;
      L.push('  ' + gg.id + ' ' + (gg.ok ? '✓' : '✗') + '  ' + rpad(gg.name, 40) +
             ' цель ' + rpad(gg.target, 16) + ' факт ' + gg.fact);
    }
    L.push(' ---------------------------------------------------------------');
    L.push('  Пройдено ' + passed + '/' + gates.length + ' контрольных точек.');
    L.push('==============================================================');
    return L.join('\n');
  }

  function fmt(n) {
    n = Math.round(n);
    var s = n < 0 ? '-' : '', a = Math.abs(n);
    if (a < 10000) return s + a;
    if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return s + (a / 1000000).toFixed(2) + 'M';
  }
  function pad(v, w) { v = String(v); while (v.length < w) v = ' ' + v; return v; }
  function rpad(v, w) { v = String(v); while (v.length < w) v = v + ' '; return v; }

  /* ============================ ЭКСПОРТ ============================ */
  var Sim = {
    BOOK: BOOK,
    run: run,
    checkGates: checkGates,
    formatSummary: formatSummary,
    E: E, M: M, W: W, isStone: isStone, chapterOf: chapterOf,
    mergeParams: mergeParams,
    _cli: function () {
      var res = run({ N: 2000, days: 30, seed: 1000 });
      // eslint-disable-next-line no-console
      console.log(formatSummary(res));
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Sim;
    if (typeof require !== 'undefined' && require.main === module) Sim._cli();
  }
  if (typeof window !== 'undefined') window.Sim = Sim;

})();
