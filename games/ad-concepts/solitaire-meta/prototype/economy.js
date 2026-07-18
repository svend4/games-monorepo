/* =============================================================================
 * Orchard Peaks — слой ЭКОНОМИКИ (Проход Б)
 * -----------------------------------------------------------------------------
 * Реализует главу 05-economy.md (§5.1–§5.7) поверх ядра Прохода А. Ядро (TriPeaks
 * из game.js) НЕ переписывается — этот файл лишь ДОБАВЛЯЕТ две валюты (Монеты и
 * Урожай), инвентарь бустеров и единое хранилище мета-состояния. Подключается в
 * index.html ПЕРЕД meta.js и game.js, поэтому к первым вызовам из game.js объекты
 * window.Store / window.Economy уже существуют.
 *
 * Числа и ИМЕНА — из спеки (05 §5.1, §5.2, §5.3, §5.6). Формулы взносов/выигрышей
 * и цены бустеров держатся согласованными с главой 05; всё, что глава не задаёт
 * точным номиналом, помечено как тюнинг-константа прототипа в рамках earn-rate.
 *
 * СХЕМА САВА СОВМЕСТИМА С ПРОХОДОМ А. Проход А хранил монеты/рекорд/статистику под
 * ключами orchardPeaks.coins|bestScore|wins|games. Эти ключи СОХРАНЯЮТСЯ:
 *  - orchardPeaks.coins — по-прежнему источник истины по монетам (мигрируется в
 *    единый мета-документ при первом запуске Прохода Б, но и legacy-ключ пишется);
 *  - bestScore|wins|games — game.js читает их как раньше.
 * Новое мета-состояние (урожай, уровень, бустеры, сад, стрик, миссии) живёт в
 * одном ключе orchardPeaks.meta (JSON). Отсутствие ключа/полей → дефолты
 * (deepMerge ниже): старые сейвы игру не ломают.
 * ========================================================================== */
'use strict';

/* ============================ КОНФИГ ЭКОНОМИКИ ============================ */
/* Имена/числа согласованы с 05-economy.md. Менять номинал — только синхронно
 * со спекой (05 §5.2 sources/sinks, §5.3 стартовый баланс, §5.6 бустеры). */

var ECON = {
  META_KEY:   'orchardPeaks.meta',   // единый JSON мета-документа (Проход Б)
  LEGACY_COINS: 'orchardPeaks.coins', // ключ монет из Прохода А (совместимость)

  /* --- Стартовый баланс, 05 §5.3 --- */
  START_COINS:   1000,   // ≈ 3 взноса — буфер на обучение
  START_HARVEST: 20,     // первый заказ («расчистить крыльцо», 40) закрывается в 2 уровня
  START_JOKER:   1,      // обучающее применение джокера
  START_UNDO:    2,      // 2 бесплатных ундо — снять страх ошибки в FTUE

  /* --- Монеты: sources/sinks, 05 §5.2 --- */
  // Взнос за вход в раздачу (sink): E(n) = 350·1.012ⁿ, округление до 10.
  ENTRY_BASE:  350,
  ENTRY_GROWTH: 1.012,
  // Выигрыш (source): W(n) = M(n)·E(n), где M(n) = 2.2 − 0.7·min(1, n/60).
  WIN_M_HI:  2.2,
  WIN_M_DROP: 0.7,
  WIN_M_KNEE: 60,        // после уровня 60 множитель выходит на плато 1.5
  // Бонус за остаток стока (source): 25 × номер главы за карту (глава = зона+1).
  STOCK_BONUS_PER_CARD: 25,

  /* --- Урожай: sources/sinks, 05 §5.2 --- */
  HARVEST_PER_CARD: 1,   // +1 урожая за карту 🍎 (8–14 на уровень)
  BASKET_MULT:      2,   // Золотое лукошко / ивент «Золотая грядка»: ×2 урожай

  /* --- Бустеры: цена и роль, 05 §5.6 --- */
  BOOSTERS: {
    joker:  { name: 'Джокер',          emoji: '🃏', price: 1200, cap: 9,
              hint: 'Убрать любую открытую карту — «страховка» серии' },
    basket: { name: 'Золотое лукошко', emoji: '🧺', price: 800,  cap: 9,
              hint: '×2 урожай за раздачу — растит сад быстрее' }
  },
  BOOSTER_ORDER: ['joker', 'basket'],
  UNDO_PRICE: 150,       // платное ундо после бесплатных (05 §5.2)

  /* --- Стрик «Утренняя лейка», 04 §4.4 (день 1..7, дальше держится на 7) --- */
  STREAK_REWARDS: [
    null,                        // индекс 0 не используется
    { coins: 200 },              // день 1
    { coins: 300 },              // день 2
    { coins: 400, undo: 1 },     // день 3 (+1 ундо)
    { coins: 500 },              // день 4
    { coins: 600, joker: 1 },    // день 5 (+джокер)
    { coins: 800 },              // день 6
    { coins: 1500, basket: 1 }   // день 7+ (+Золотое лукошко)
  ],

  /* --- Миссии, 04 §4.4 (регулятор earn-rate, 05 §5.4) --- */
  DAILY_MISSIONS: [
    { id: 'd_harvest', type: 'harvest', target: 25, coins: 200, text: 'Соберите 25 🍎 урожая' },
    { id: 'd_chain',   type: 'chain5',  target: 1,  coins: 150, text: 'Соберите серию из 5 карт' },
    { id: 'd_order',   type: 'orders',  target: 1,  coins: 300, text: 'Выполните заказ в саду' }
  ],
  WEEKLY_MISSIONS: [
    { id: 'w_wins', type: 'wins', target: 12, coins: 1200, text: 'Выиграйте 12 уровней за неделю', card: true }
  ],

  /* --- Плановый earn-rate по дням (05 §5.4, медианный неплатящий игрок) ---
   * Данные таблицы 5.4 — для панели «План экономики»: показываем спроектированный
   * переход профицит→дефицит и отмечаем, в какой полосе находится игрок по n. */
  PLAN_5_4: [
    { day: 1,  level: 14,  saldo: 5600,  balance: 6600,  note: 'Медовый месяц: профицит по дизайну' },
    { day: 2,  level: 26,  saldo: 2960,  balance: 9560,  note: 'Игрок «богат», пробует бустеры' },
    { day: 3,  level: 37,  saldo: 1610,  balance: 11170, note: 'Пик баланса близко' },
    { day: 4,  level: 47,  saldo: 470,   balance: 11640, note: 'Кривая выравнивается' },
    { day: 5,  level: 56,  saldo: -240,  balance: 11400, note: 'Первый дефицитный день' },
    { day: 7,  level: 72,  saldo: -550,  balance: 10400, note: 'Стрик-бонус дня 7 смягчает' },
    { day: 10, level: 97,  saldo: -1370, balance: 6900,  note: 'Баланс тает — спрос зреет' },
    { day: 14, level: 126, saldo: -2250, balance: 1500,  note: 'Точка «Кошелька»: запас < 1 взноса' },
    { day: 21, level: 158, saldo: 580,   balance: 3100,  note: 'Rewarded-кошелёк вошёл в рутину' },
    { day: 30, level: 196, saldo: 180,   balance: 2900,  note: 'Стабильная «карусель» микродефицита' }
  ]
};

/* ============================== ХРАНИЛИЩЕ ================================= */
/* Единый JSON-документ мета-состояния. Экономика (монеты/урожай/бустеры) и мета
 * (сад/стрик/миссии) — в одном ключе: атомарное сохранение, никаких рассинхронов.
 * Монеты дублируются в legacy-ключ orchardPeaks.coins для обратной совместимости. */

window.Store = (function () {

  function defaults() {
    return {
      v: 1,
      economy: {
        coins:   ECON.START_COINS,
        harvest: ECON.START_HARVEST,
        level:   1,                         // текущий уровень n (для E(n)/W(n))
        boosters: { joker: ECON.START_JOKER, basket: 0 },
        freeUndos: ECON.START_UNDO
      },
      garden: {
        completed: 0,                       // сколько заказов выполнено (линейная цепочка)
        cards: 0                            // карточки гербария (флейвор наград зон)
      },
      almanac: 0,                           // очки альманаха (05 §5.1) — лёгкий счётчик
      streak:   { day: 0, lastClaim: '' },  // «Утренняя лейка» (04 §4.4)
      missions: { day: '', week: 0, prog: {}, claimed: {} },
      stats: { simDayOffset: 0 },           // сдвиг «сегодня» для кнопки «Новый день (тест)»
      _fresh: true
    };
  }

  /* Глубокое слияние: поля, которых нет в сохранённом объекте, берутся из
   * дефолтов — старые/частичные сейвы не ломают новые механики. */
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

  function readLegacyCoins() {
    try {
      var raw = localStorage.getItem(ECON.LEGACY_COINS);
      if (raw === null) return null;
      var v = JSON.parse(raw);
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    } catch (e) { return null; }
  }

  /* Санитайзер: коэрсим числовые поля к конечным неотрицательным значениям.
   * deepMerge сохраняет ЗНАЧЕНИЯ из сейва как есть — значит повреждённый (но
   * валидный по JSON) сейв с чужими типами мог бы дать "abc"+100="abc100",
   * NaN во взносе E(n) или падение на дробном/отрицательном индексе заказа
   * (FLAT[2.5].zoneIdx). Здесь это гасится: балансы всегда конечные ≥ 0,
   * уровень/инвентарь/прогресс сада — целые в допустимых границах. */
  function fin(v, dflt)  { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }
  function intGE(v, min, dflt) { var n = Math.floor(fin(v, dflt)); return n < min ? min : n; }
  function sanitize(st) {
    var d = defaults();
    if (!st.economy || typeof st.economy !== 'object') st.economy = d.economy;
    var e = st.economy;
    e.coins     = Math.max(0, fin(e.coins,   d.economy.coins));
    e.harvest   = Math.max(0, fin(e.harvest, d.economy.harvest));
    e.level     = intGE(e.level, 1, 1);
    e.freeUndos = intGE(e.freeUndos, 0, 0);
    if (!e.boosters || typeof e.boosters !== 'object') e.boosters = { joker: 0, basket: 0 };
    for (var bid in ECON.BOOSTERS) {
      e.boosters[bid] = Math.min(ECON.BOOSTERS[bid].cap, intGE(e.boosters[bid], 0, 0));
    }
    if (!st.garden || typeof st.garden !== 'object') st.garden = d.garden;
    st.garden.completed = intGE(st.garden.completed, 0, 0);   // индекс FLAT — только целый ≥ 0
    st.garden.cards     = intGE(st.garden.cards, 0, 0);
    st.almanac = Math.max(0, fin(st.almanac, 0));
    if (!st.streak || typeof st.streak !== 'object') st.streak = d.streak;
    st.streak.day = Math.min(7, intGE(st.streak.day, 0, 0));
    if (!st.missions || typeof st.missions !== 'object') st.missions = d.missions;
    if (!st.missions.prog    || typeof st.missions.prog    !== 'object' || Array.isArray(st.missions.prog))    st.missions.prog = {};
    if (!st.missions.claimed || typeof st.missions.claimed !== 'object' || Array.isArray(st.missions.claimed)) st.missions.claimed = {};
    if (!st.stats || typeof st.stats !== 'object') st.stats = d.stats;
    st.stats.simDayOffset = intGE(st.stats.simDayOffset, 0, 0);
    return st;
  }

  var state = defaults();
  var loadedExisting = false;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(ECON.META_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        state = deepMerge(defaults(), JSON.parse(raw));
        state._fresh = false;
        loadedExisting = true;
      } catch (e) {
        state = defaults();                 // повреждённый JSON → чистый старт без краша
      }
    } else {
      // Первый запуск Прохода Б. Мигрируем монеты Прохода А, если игрок уже играл.
      state = defaults();
      var legacy = readLegacyCoins();
      if (legacy !== null) {
        state.economy.coins = legacy;       // сохраняем накопленные монеты Прохода А
        state._fresh = false;               // не совсем новый игрок
      }
    }
    sanitize(state);                         // повреждённый сейв не должен давать NaN/краш
    return state;
  }

  function save() {
    try { localStorage.setItem(ECON.META_KEY, JSON.stringify(state)); }
    catch (e) { /* приватный режим / переполнение — игра продолжается без сейва */ }
    // Дублируем монеты в legacy-ключ: обратная совместимость и единый источник HUD.
    try { localStorage.setItem(ECON.LEGACY_COINS, JSON.stringify(state.economy.coins)); }
    catch (e) { /* no-op */ }
  }

  load();

  return {
    state: state,
    save: save,
    isFreshInstall: function () { return !loadedExisting && state._fresh; },
    reset: function () { state = defaults(); save(); return state; }
  };
})();

/* ============================== АНАЛИТИКА ================================= */
/* Лёгкий трекер по дереву событий 09-analytics-kpi.md §9.1. Прод-стек —
 * BigQuery + AppsFlyer (09 §9.7); в прототипе это in-memory тэлли + компактный
 * console-лог значимых событий (coins_delta, order_complete, streak_update…). */

window.Analytics = (function () {
  var tally = {};
  var LOUD = {
    coins_delta: true, order_complete: true, zone_complete: true,
    streak_update: true, mission_complete: true, booster_use: true, level_finish: true
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
  var listeners = [];
  var earnedCoinsThisLevel = 0;   // для экрана итога уровня

  /* --- Подписка на изменение валют (HUD игры + баланс мета-экрана) --- */
  function subscribe(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function notify() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }

  /* --- Форматирование крупных номиналов, 05 §5.5 («42.1K») --- */
  function fmt(n) {
    n = Math.round(n);
    var s = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a < 10000) return s + a;
    if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return s + (a / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
  }

  /* --- Формулы взноса/выигрыша, 05 §5.2 --- */
  function round10(x) { return Math.round(x / 10) * 10; }
  function entryCost(level) {
    var n = (level == null ? S.level : level);
    return round10(ECON.ENTRY_BASE * Math.pow(ECON.ENTRY_GROWTH, n));
  }
  function winMult(level) {
    var n = (level == null ? S.level : level);
    return ECON.WIN_M_HI - ECON.WIN_M_DROP * Math.min(1, n / ECON.WIN_M_KNEE);
  }
  function winReward(level) {
    var n = (level == null ? S.level : level);
    return round10(winMult(n) * entryCost(n));
  }
  /* Номер «главы»/зоны для бонуса за сток (глава = индекс текущей зоны + 1). */
  function chapterNo() {
    return (window.Meta && typeof window.Meta.currentChapter === 'function')
      ? window.Meta.currentChapter() : 1;
  }
  function stockBonus(cards) {
    return Math.max(0, cards | 0) * ECON.STOCK_BONUS_PER_CARD * chapterNo();
  }

  /* --- Геттеры --- */
  function getCoins()   { return S.coins; }
  function getHarvest() { return S.harvest; }
  function getLevel()   { return S.level; }
  function getFreeUndos() { return S.freeUndos; }
  function getEarnedThisLevel() { return earnedCoinsThisLevel; }
  function resetEarnedThisLevel() { earnedCoinsThisLevel = 0; }

  /* --- Монеты (source_id по 09 §9.1) --- */
  function addCoins(amount, source, countLevel) {
    amount = Math.max(0, Math.round(amount));
    if (amount === 0) return 0;
    S.coins += amount;
    if (countLevel) earnedCoinsThisLevel += amount;
    window.Analytics.track('coins_delta', { amount: amount, direction: 'in', source_id: source || 'unknown' });
    window.Store.save(); notify();
    return amount;
  }
  function spendCoins(amount, sink) {
    amount = Math.max(0, Math.round(amount));
    if (S.coins < amount) return false;
    S.coins -= amount;
    window.Analytics.track('coins_delta', { amount: amount, direction: 'out', source_id: sink || 'unknown' });
    window.Store.save(); notify();
    return true;
  }

  /* --- Урожай (мета-ресурс; единственный sink — заказы сада, 05 §5.2) --- */
  function addHarvest(amount, source) {
    amount = Math.max(0, Math.round(amount));
    if (amount === 0) return 0;
    S.harvest += amount;
    window.Analytics.track('coins_delta', { amount: amount, direction: 'in', source_id: 'harvest:' + (source || 'cards') });
    window.Store.save(); notify();
    return amount;
  }
  function spendHarvest(amount) {
    amount = Math.max(0, Math.round(amount));
    if (S.harvest < amount) return false;
    S.harvest -= amount;
    window.Store.save(); notify();
    return true;
  }

  /* --- Прогресс уровня --- */
  function nextLevel() { S.level += 1; window.Store.save(); notify(); return S.level; }

  /* --- Бустеры (05 §5.6) --- */
  function getBooster(id) { return S.boosters[id] || 0; }
  function addBooster(id, n, source) {
    if (!(id in S.boosters)) return;
    var def = ECON.BOOSTERS[id];
    var cap = def ? def.cap : 9;
    S.boosters[id] = Math.min(cap, (S.boosters[id] || 0) + (n || 1));  // кап инвентаря, 05 §5.5
    window.Analytics.track('booster_use', { booster_id: id, context: 'grant:' + (source || '?') });
    window.Store.save(); notify();
  }
  function buyBooster(id) {
    var def = ECON.BOOSTERS[id];
    if (!def) return false;
    if ((S.boosters[id] || 0) >= def.cap) return false;   // инвентарь полон
    if (!spendCoins(def.price, 'booster')) return false;
    S.boosters[id] = (S.boosters[id] || 0) + 1;
    window.Store.save(); notify();
    return true;
  }
  function consumeBooster(id, context) {
    if ((S.boosters[id] || 0) <= 0) return false;
    S.boosters[id] -= 1;
    window.Analytics.track('booster_use', { booster_id: id, context: context || 'in' });
    window.Store.save(); notify();
    return true;
  }

  /* --- Ундо: бесплатные из инвентаря, затем за монеты (05 §5.2) --- */
  function useUndo() {
    if (S.freeUndos > 0) {
      S.freeUndos -= 1;
      window.Analytics.track('booster_use', { booster_id: 'undo', context: 'free' });
      window.Store.save(); notify();
      return 'free';
    }
    if (spendCoins(ECON.UNDO_PRICE, 'undo')) {
      window.Analytics.track('booster_use', { booster_id: 'undo', context: 'paid' });
      return 'paid';
    }
    return null; // нет ни бесплатных, ни монет
  }
  function addFreeUndo(n) { S.freeUndos += (n || 1); window.Store.save(); notify(); }

  return {
    ECON: ECON,
    subscribe: subscribe, notify: notify, fmt: fmt,
    entryCost: entryCost, winMult: winMult, winReward: winReward, stockBonus: stockBonus,
    getCoins: getCoins, getHarvest: getHarvest, getLevel: getLevel, getFreeUndos: getFreeUndos,
    getEarnedThisLevel: getEarnedThisLevel, resetEarnedThisLevel: resetEarnedThisLevel,
    addCoins: addCoins, spendCoins: spendCoins,
    addHarvest: addHarvest, spendHarvest: spendHarvest,
    nextLevel: nextLevel,
    getBooster: getBooster, addBooster: addBooster, buyBooster: buyBooster, consumeBooster: consumeBooster,
    useUndo: useUndo, addFreeUndo: addFreeUndo
  };
})();
