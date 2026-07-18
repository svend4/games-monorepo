/* =============================================================================
 * Block Surge — слой ЭКОНОМИКИ (Проход Б)
 * -----------------------------------------------------------------------------
 * Реализует главу 05-economy.md §1–5 поверх ядра Прохода А. Ничего в ядре не
 * переписывает — только добавляет валюту (монеты), инвентарь бустеров и единое
 * хранилище мета-состояния. Подключается в index.html ПЕРЕД game.js, поэтому к
 * моменту первых вызовов из game.js объекты window.Store / window.Economy уже
 * существуют.
 *
 * Числа и имена — из спеки (05 §2.1, §2.2, §3, §5). Всё, что не задано точным
 * номиналом в главе (коин-бонус за «чистое поле», делитель монет за конец
 * партии), помечено как тюнинг-константа прототипа в рамках earn-rate (05 §4).
 *
 * СХЕМА САВА СОВМЕСТИМА: Проход А хранил только 'blocksurge_best' (число).
 * Проход Б добавляет отдельный ключ 'blocksurge_meta' (JSON). Отсутствие ключа
 * или отсутствие отдельных полей → подстановка дефолтов (deepMerge ниже), старые
 * сейвы игру не ломают.
 * ========================================================================== */
'use strict';

/* ============================ КОНФИГ ЭКОНОМИКИ ============================ */
/* Имена/числа согласованы с 05-economy.md. Менять номинал — только синхронно
 * со спекой (05 §5, 06 §5, 09 §5 — правило главы 05). */

var ECON = {
  STORAGE_KEY: 'blocksurge_meta',   // тот же префикс игры, что и Проход А

  START_COINS: 200,                 // 05 §3: стартовый баланс (FTUE-подарок)

  // Sources монет в партии (05 §2.1):
  COIN_PER_LINE: 1,                 // «Очистка линии = 1» × множитель комбо
  COIN_CLEAN_BOARD: 15,             // бонус за «чистое поле» (тюнинг прототипа)
  COIN_ENDGAME_DIV: 100,            // конец партии: floor(score/100) — аналог «Победа 25–50»
  COIN_ENDGAME_MAX: 100,            // защита от runaway при рекордной партии

  // Бустеры-инвентарь (05 §2.2 + прайсинг 05 §5). id → {name, price, hint}
  BOOSTERS: {
    undo:   { name: 'Отмена', price: 80,  emoji: '↩️', hint: 'Отменить последний ход' },
    swap:   { name: 'Обмен',  price: 120, emoji: '🔁', hint: 'Новая тройка фигур' },
    hammer: { name: 'Молот',  price: 150, emoji: '🔨', hint: 'Убрать одну клетку поля' }
  },
  BOOSTER_ORDER: ['undo', 'swap', 'hammer']
};

/* ============================== ХРАНИЛИЩЕ ================================= */
/* Единый JSON-документ мета-состояния. Экономика и мета (карта/стрик/миссии)
 * живут в одном ключе — атомарное сохранение, никаких рассинхронов. */

window.Store = (function () {

  function defaults() {
    return {
      v: 2,                                  // версия схемы (для будущих миграций)
      economy: {
        coins: ECON.START_COINS,
        boosters: { undo: 0, swap: 0, hammer: 0 }
      },
      meta: {
        totalStars: 0,
        mapClaimed: [],                      // id забранных узлов карты
        streak: { day: 0, count: 0, lastClaim: '' },
        missions: { date: '', set: [], progress: {}, done: [], bonusClaimed: false },
        simOffset: 0                         // сдвиг «сегодня» для кнопки «Новый день (тест)»
      },
      stats: { gamesPlayed: 0 },
      _fresh: true                            // помечает совсем новый сейв (для FTUE-события)
    };
  }

  /* Глубокое слияние: поля, которых нет в сохранённом объекте, берутся из
   * дефолтов. Так старые/частичные сейвы не ломают новые механики. */
  function deepMerge(base, over) {
    if (over === null || over === undefined) return base;
    if (typeof base !== 'object' || Array.isArray(base) || base === null) {
      return over === undefined ? base : over;
    }
    var out = {}, k;
    for (k in base) out[k] = base[k];
    for (k in over) {
      if (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
          && over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = deepMerge(base[k], over[k]);
      } else if (over[k] !== undefined) {
        out[k] = over[k];
      }
    }
    return out;
  }

  /* Санитизация после слияния. deepMerge сохраняет СТРУКТУРУ дефолтов, но не
   * типы значений: валидный, но повреждённый JSON (coins:null, totalStars:"x",
   * mapClaimed:"foo", coins:1e400→Infinity) прошёл бы насквозь и дал бы NaN/
   * Infinity в HUD или краш на mapClaimed.push. Приводим числа к конечным
   * неотрицательным целым, а поля-контейнеры — к массивам/объектам. */
  function toInt(v, def, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = def;
    n = Math.floor(n);
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }
  function toStr(v) { return typeof v === 'string' ? v : ''; }
  function toArr(v) { return Array.isArray(v) ? v : []; }

  function sanitize(s) {
    if (!s || typeof s !== 'object') return defaults();

    var e = (s.economy && typeof s.economy === 'object') ? s.economy : {};
    var b = (e.boosters && typeof e.boosters === 'object') ? e.boosters : {};
    s.economy = {
      coins: toInt(e.coins, ECON.START_COINS, 0),
      boosters: { undo: toInt(b.undo, 0, 0), swap: toInt(b.swap, 0, 0), hammer: toInt(b.hammer, 0, 0) }
    };

    var m = (s.meta && typeof s.meta === 'object') ? s.meta : {};
    var st = (m.streak && typeof m.streak === 'object') ? m.streak : {};
    var mi = (m.missions && typeof m.missions === 'object') ? m.missions : {};
    var prog = {};
    if (mi.progress && typeof mi.progress === 'object' && !Array.isArray(mi.progress)) {
      for (var k in mi.progress) prog[k] = toInt(mi.progress[k], 0, 0);
    }
    s.meta = {
      totalStars: toInt(m.totalStars, 0, 0),
      mapClaimed: toArr(m.mapClaimed),
      streak: { day: toInt(st.day, 0, 0, 7), count: toInt(st.count, 0, 0), lastClaim: toStr(st.lastClaim) },
      missions: {
        date: toStr(mi.date), set: toArr(mi.set), progress: prog,
        done: toArr(mi.done), bonusClaimed: !!mi.bonusClaimed
      },
      simOffset: toInt(m.simOffset, 0, 0)
    };

    var stt = (s.stats && typeof s.stats === 'object') ? s.stats : {};
    s.stats = { gamesPlayed: toInt(stt.gamesPlayed, 0, 0) };
    return s;
  }

  var state = defaults();
  var loadedExisting = false;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(ECON.STORAGE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state = sanitize(deepMerge(defaults(), parsed));
        state._fresh = false;
        loadedExisting = true;
      } catch (e) {
        state = defaults();   // повреждённый JSON → чистый старт, без краша
      }
    } else {
      state = defaults();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(ECON.STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* приватный режим / переполнение — игнорируем, игра продолжается */ }
  }

  load();

  return {
    state: state,
    save: save,
    isFreshInstall: function () { return !loadedExisting; },
    /* Переустановить ссылку (на случай будущих сбросов) */
    reset: function () { state = defaults(); save(); return state; }
  };
})();

/* ============================== АНАЛИТИКА ================================= */
/* Лёгкий трекер по дереву событий 09-analytics-kpi.md §2.2. Прод-стек —
 * Firebase + AppsFlyer + BigQuery (09 §0); в прототипе это in-memory тэлли +
 * компактный console-лог значимых событий (без спама на каждую линию). */

window.Analytics = (function () {
  var tally = {};                 // event → count
  var LOUD = {                    // какие события логируем в консоль
    currency_spend: true, mission_complete: true, streak_change: true,
    booster_used: true, season_progress: true, game_end: true
  };
  function track(event, params) {
    tally[event] = (tally[event] || 0) + 1;
    if (LOUD[event]) {
      try { console.log('[analytics] ' + event, params || {}); } catch (e) { /* no-op */ }
    }
  }
  return { track: track, tally: tally };
})();

/* ============================== ЭКОНОМИКА ================================= */

window.Economy = (function () {
  var S = window.Store.state.economy;
  var earnedThisGame = 0;         // монеты, заработанные в текущей партии (для экрана итога)

  /* FTUE-начисление стартового бонуса как явное событие (05 §2.1: 200 разово). */
  if (window.Store.isFreshInstall()) {
    window.Analytics.track('currency_earn', { amount: ECON.START_COINS, source: 'ftue_start' });
    window.Store.save();
  }

  function refreshCoinHud() {
    var el = document.getElementById('coinBal');
    if (el) el.textContent = S.coins;
  }

  function getCoins() { return S.coins; }
  function getEarnedThisGame() { return earnedThisGame; }
  function resetEarnedThisGame() { earnedThisGame = 0; }

  /* Приход монет. source — из перечня 09 §2.2 (level/mission/streak/... ). */
  function addCoins(amount, source, countThisGame) {
    amount = Math.max(0, Math.round(amount));
    if (amount === 0) return 0;
    S.coins += amount;
    if (countThisGame) earnedThisGame += amount;
    window.Analytics.track('currency_earn', { amount: amount, source: source || 'unknown' });
    window.Store.save();
    refreshCoinHud();
    return amount;
  }

  /* Расход монет. Возвращает true, если хватило средств. sink — 09 §2.2. */
  function spendCoins(amount, sink) {
    amount = Math.max(0, Math.round(amount));
    if (S.coins < amount) return false;
    S.coins -= amount;
    window.Analytics.track('currency_spend', { amount: amount, sink: sink || 'unknown' });
    window.Store.save();
    refreshCoinHud();
    return true;
  }

  /* ------------------------------ Бустеры ------------------------------- */

  function getBooster(id) { return S.boosters[id] || 0; }

  function addBooster(id, n, source) {
    if (!(id in S.boosters)) return;
    n = n || 1;
    S.boosters[id] += n;
    window.Analytics.track('currency_earn', { amount: 0, source: (source || 'grant') + ':booster_' + id });
    window.Store.save();
  }

  /* Покупка бустера за монеты (sink монет, 05 §2.2). Возвращает true при успехе. */
  function buyBooster(id) {
    var def = ECON.BOOSTERS[id];
    if (!def) return false;
    if (!spendCoins(def.price, 'booster')) return false;
    S.boosters[id] += 1;
    window.Store.save();
    return true;
  }

  /* Списание одного бустера при использовании в партии. */
  function consumeBooster(id, context) {
    if ((S.boosters[id] || 0) <= 0) return false;
    S.boosters[id] -= 1;
    window.Analytics.track('booster_used', { type: id, context: context || 'classic' });
    window.Store.save();
    return true;
  }

  return {
    ECON: ECON,
    refreshCoinHud: refreshCoinHud,
    getCoins: getCoins,
    addCoins: addCoins,
    spendCoins: spendCoins,
    getEarnedThisGame: getEarnedThisGame,
    resetEarnedThisGame: resetEarnedThisGame,
    getBooster: getBooster,
    addBooster: addBooster,
    buyBooster: buyBooster,
    consumeBooster: consumeBooster
  };
})();
