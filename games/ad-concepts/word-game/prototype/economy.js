/*
 * WordGrove — экономика (Проход Б).
 *
 * Слой валют поверх ядра Прохода А. Ядро (game.js) остаётся владельцем МОНЕТ
 * (в его сейве `wordgrove.save.v1`); этот модуль владеет ЖЁЛУДЯМИ и КОПИЛКОЙ и
 * даёт единый конфиг экономики. Монеты этот модуль трогает только через мост
 * window.WG (см. game.js) — конвертация копилки в монеты 1:1.
 *
 * Все числа согласованы с GDD 05-economy.md (в проде — remote config, 05 §10).
 * Модуль подключается в index.html ПЕРЕД meta.js и game.js. Обратная совместимость:
 * при отсутствии сейва экономики (старый игрок Прохода А) всё стартует с дефолтов —
 * жёлудей 0, монеты игрока не трогаются.
 */
(function () {
  'use strict';

  // ======================= КОНФИГ ЭКОНОМИКИ (05-economy.md) =======================
  // Имена и числа — из главы 05. Держим согласованными со спекой.
  var ECON = {
    // --- Валюты и капы (05 §1) ---
    ACORN_CAP: 200,            // кап копилки жёлудей; переполнение сгорает (05 §1, §2.2)
    ACORN_PER_BONUS: 2,        // +2 жёлудя за бонусное слово (05 §2.2, 04 §3.4)

    // --- Монеты: sources (05 §2.1) ---
    DAILY_COINS: 40,           // дневной кроссворд, 1/день (05 §2.1)
    STREAK_MILESTONES: { 3: 50, 7: 120, 14: 250, 30: 600 }, // вехи стрика (05 §2.1)
    REGION_REWARD: 300,        // «альбом региона завершён» — раз в регион (05 §2.1)

    // --- Монеты: sinks / цены бустеров (05 §1, §2.1, §8) ---
    PRICE_LAMP: 100,           // Лампа — случайная буква (= HINT_COST ядра)
    PRICE_SCOPE: 150,          // Прицел — выбранная клетка
    PRICE_ROCKET: 350,         // Ракета — 5 случайных букв
    PRICE_FREEZE: 500,         // Заморозка стрика

    // --- Стартовый баланс монет (05 §3) — фактически задаётся в game.js CFG.START_COINS ---
    START_COINS: 300,

    SAVE_KEY: 'wordgrove.economy.v1'
  };

  // ======================= СОСТОЯНИЕ (localStorage) =======================
  // Мутируем поля объекта на месте (не переприсваиваем st), чтобы ссылки жили.
  var st = {
    acorns: 0,          // текущие жёлуди в копилке (0..ACORN_CAP)
    acornsLifetime: 0,  // всего накоплено (для статистики/миссий)
    piggyOpens: 0,      // сколько раз открывали копилку
    burned: 0           // сколько жёлудей сгорело при переполнении
  };

  function save() {
    try {
      localStorage.setItem(ECON.SAVE_KEY, JSON.stringify(st));
    } catch (e) { /* приватный режим/квота — играем без сохранения экономики */ }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(ECON.SAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    // Подстановка дефолтов при отсутствии полей (совместимость схемы).
    if (typeof s.acorns === 'number' && isFinite(s.acorns) && s.acorns >= 0) {
      st.acorns = Math.min(Math.floor(s.acorns), ECON.ACORN_CAP);
    }
    if (typeof s.acornsLifetime === 'number' && isFinite(s.acornsLifetime) && s.acornsLifetime >= 0) {
      st.acornsLifetime = Math.floor(s.acornsLifetime);
    }
    if (typeof s.piggyOpens === 'number' && isFinite(s.piggyOpens) && s.piggyOpens >= 0) st.piggyOpens = Math.floor(s.piggyOpens);
    if (typeof s.burned === 'number' && isFinite(s.burned) && s.burned >= 0) st.burned = Math.floor(s.burned);
  }

  // ======================= ЖЁЛУДИ / КОПИЛКА (04 §3.4, 05 §2.2) =======================

  function getAcorns() { return st.acorns; }
  function getCap() { return ECON.ACORN_CAP; }
  function isPiggyFull() { return st.acorns >= ECON.ACORN_CAP; }

  // Начислить жёлуди с учётом капа. Переполнение сгорает (05 §2.2).
  // Возвращает { added, burned, full }.
  function addAcorns(n) {
    n = Math.max(0, Math.floor(n || 0));
    var space = Math.max(0, ECON.ACORN_CAP - st.acorns);
    var added = Math.min(n, space);
    var burned = n - added;
    st.acorns += added;
    st.acornsLifetime += added;
    st.burned += burned;
    save();
    if (added > 0) track('currency_earn', { currency: 'acorn', amount: added, source: 'bonus_word', balance_after: st.acorns });
    return { added: added, burned: burned, full: isPiggyFull() };
  }

  // Открыть копилку → конвертация в монеты 1:1 (05 §2.2). В проде гейт — rewarded RV-5
  // (04 §3.4); реклама — Проход В, здесь открытие бесплатно. Возвращает выданные монеты.
  function openPiggy() {
    var amount = st.acorns;
    if (amount <= 0) return 0;
    st.acorns = 0;
    st.piggyOpens += 1;
    save();
    if (window.WG && typeof window.WG.addCoins === 'function') {
      window.WG.addCoins(amount); // конвертация 1:1
    }
    track('piggy_open', { amount: amount, source: 'free_pass_b' });
    track('currency_spend', { currency: 'acorn', amount: amount, sink: 'piggy_convert', balance_after: 0 });
    return amount;
  }

  function reset() {
    st.acorns = 0;
    st.acornsLifetime = 0;
    st.piggyOpens = 0;
    st.burned = 0;
    save();
  }

  // ======================= АНАЛИТИКА-ЗАГЛУШКА (09-analytics-kpi.md §1) =======================
  // Лёгкий трекер в консоль по соглашениям главы 09 (snake_case). В проде — Firebase.
  function track(event, params) {
    try {
      if (window.console && console.debug) console.debug('[wg-track]', event, params || {});
    } catch (e) { /* no-op */ }
  }

  // ======================= ЭКСПОРТ =======================
  window.ECON = ECON;
  window.Economy = {
    CFG: ECON,
    load: load,
    save: save,
    getAcorns: getAcorns,
    getCap: getCap,
    isPiggyFull: isPiggyFull,
    addAcorns: addAcorns,
    openPiggy: openPiggy,
    reset: reset,
    track: track
  };

  load();
})();
