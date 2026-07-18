/* =============================================================================
 * Block Surge — слой МЕТА-ПРОГРЕССИИ (Проход Б)
 * -----------------------------------------------------------------------------
 * Реализует 04-meta-progression.md §2 (карта «Путешествия»), §3 (стрик дней),
 * §4.1 (ежедневные миссии) поверх ядра Прохода А, используя валюту/бустеры из
 * economy.js. Ядро (game.js) не переписывается: партия вызывает несколько
 * добавленных хук-функций window.Meta.* в ключевых точках (очистка, бомба,
 * game over, рестарт), а бустеры влияют на партию через публичные глобалы
 * ядра (board/hand/dealHand/refreshPlaceable/updateHUD — все они var-глобалы
 * скрипта game.js, т.е. свойства window).
 *
 * Петля: партия → монеты/звёзды/прогресс миссий → мета (карта/стрик/миссии/
 * магазин) → бустеры → влияют на следующую партию.
 *
 * Подключается ПЕРЕД game.js. Ссылки на глобалы ядра берутся только внутри
 * обработчиков/хуков, исполняемых уже после загрузки game.js.
 * ========================================================================== */
'use strict';

window.Meta = (function () {

  var Store = window.Store;
  var Economy = window.Economy;
  var A = window.Analytics;
  var M = Store.state.meta;          // короткая ссылка на мета-ветку сейва
  var STATS = Store.state.stats;

  /* ===================== КОНФИГ МЕТА-ПРОГРЕССИИ ======================= */

  // Звёзды за партию по очкам (04 §2: 1–3★ за перевыполнение цели).
  var STAR_THRESHOLDS = [800, 2000, 4000];   // score ≥ → 1 / 2 / 3 ★

  // Карта «Путешествия» (04 §2): линейный трек узлов. Прогресс — по суммарным
  // звёздам (перепрохождение партий на звёзды = легальный гринд без энергии).
  // Узлы дают награды (монеты/бустеры); «босс»-узлы (04 §2) — усиленная награда.
  var MAP_NODES = [
    { id: 1,  stars: 1,  reward: { coins: 50 } },
    { id: 2,  stars: 3,  reward: { coins: 40 } },
    { id: 3,  stars: 5,  reward: { booster: 'undo' } },
    { id: 4,  stars: 8,  reward: { coins: 60 } },
    { id: 5,  stars: 12, reward: { booster: 'swap' }, boss: true },
    { id: 6,  stars: 16, reward: { coins: 80 } },
    { id: 7,  stars: 20, reward: { booster: 'hammer' } },
    { id: 8,  stars: 25, reward: { coins: 100 } },
    { id: 9,  stars: 30, reward: { coins: 200 }, boss: true },   // босс ×2
    { id: 10, stars: 36, reward: { booster: 'hammer' } },
    { id: 11, stars: 42, reward: { coins: 150 } },
    { id: 12, stars: 50, reward: { coins: 300, booster: 'hammer' }, boss: true }
  ];

  // Стрик дней (04 §3): 7-дневный цикл, награды нарастают; день 7 + бустер Молот.
  var STREAK_REWARDS = [
    { coins: 30 }, { coins: 40 }, { coins: 50 }, { coins: 60 },
    { coins: 80 }, { coins: 100 }, { coins: 150, booster: 'hammer' }
  ];

  // Пул ежедневных миссий (04 §4.1: 3 шт., ротация). type → как считаем прогресс.
  var MISSION_POOL = [
    { id: 'lines20', type: 'lines', target: 20,   reward: 40, text: 'Очисти 20 линий' },
    { id: 'lines35', type: 'lines', target: 35,   reward: 50, text: 'Очисти 35 линий' },
    { id: 'combo3',  type: 'combo', target: 3,    reward: 60, text: 'Собери комбо ×3' },
    { id: 'games2',  type: 'games', target: 2,    reward: 40, text: 'Сыграй 2 партии' },
    { id: 'score25', type: 'score', target: 2500, reward: 60, text: 'Набери 2500 очков за партию' },
    { id: 'clean1',  type: 'clean', target: 1,    reward: 50, text: 'Собери «чистое поле»' }
  ];
  var MISSION_BONUS = 60;   // 04 §4.1: все 3 закрыты → бонус-сундук 60 монет

  /* ============================ ДАТЫ ================================= */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // «Сегодня» с учётом тестового сдвига дней (кнопка «Новый день (тест)»).
  function today() {
    var d = new Date();
    d.setDate(d.getDate() + (M.simOffset || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseYMD(s) {
    var p = s.split('-');
    return new Date(+p[0], (+p[1]) - 1, +p[2]);
  }
  function daysBetween(a, b) {
    if (!a || !b) return 999;
    return Math.round((parseYMD(b) - parseYMD(a)) / 86400000);
  }

  /* ===================== ГЕНЕРАТОР МИССИЙ ДНЯ ======================== */
  /* Детерминированный выбор 3 миссий из пула по дате (ротация). Свой RNG,
   * независимый от RNG партии. */

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
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

  function rollMissions(dateStr) {
    var rnd = mulberry32(hashStr('missions:' + dateStr));
    var pool = MISSION_POOL.slice();
    // перемешивание Фишера–Йетса на детерминированном RNG
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, 3).map(function (m) { return m.id; });
  }

  // Убедиться, что набор миссий соответствует сегодняшней дате; иначе — ротация.
  function ensureMissions() {
    var t = today();
    if (M.missions.date !== t) {
      M.missions.date = t;
      M.missions.set = rollMissions(t);
      M.missions.progress = {};
      M.missions.done = [];
      M.missions.bonusClaimed = false;
      Store.save();
    }
  }

  function missionDef(id) {
    for (var i = 0; i < MISSION_POOL.length; i++) if (MISSION_POOL[i].id === id) return MISSION_POOL[i];
    return null;
  }

  /* Начислить прогресс миссиям заданного типа. mode:
   *  'add'  — progress += value (очистки линий, партии, «чистое поле»)
   *  'max'  — progress = max(progress, value) (комбо, очки за партию) */
  function advanceMissions(type, value, mode) {
    ensureMissions();
    var changed = false;
    for (var i = 0; i < M.missions.set.length; i++) {
      var id = M.missions.set[i];
      var def = missionDef(id);
      if (!def || def.type !== type) continue;
      if (M.missions.done.indexOf(id) !== -1) continue;
      var cur = M.missions.progress[id] || 0;
      var next = mode === 'max' ? Math.max(cur, value) : cur + value;
      M.missions.progress[id] = next;
      changed = true;
      if (next >= def.target) completeMission(def);
    }
    if (changed) { Store.save(); renderMeta(); }
  }

  function completeMission(def) {
    if (M.missions.done.indexOf(def.id) !== -1) return;
    M.missions.done.push(def.id);
    Economy.addCoins(def.reward, 'mission');
    A.track('mission_complete', { mission_id: def.id, type: 'daily' });
    toast('Миссия выполнена: +' + def.reward + '🪙');
    // Все 3 закрыты → бонус-сундук (04 §4.1)
    if (M.missions.done.length >= M.missions.set.length && !M.missions.bonusClaimed) {
      M.missions.bonusClaimed = true;
      Economy.addCoins(MISSION_BONUS, 'mission_bonus');
      A.track('mission_complete', { mission_id: 'daily_bonus', type: 'daily' });
      toast('Все миссии дня! Бонус-сундук +' + MISSION_BONUS + '🪙');
    }
    Store.save();
  }

  /* ========================= КАРТА «ПУТЕШЕСТВИЯ» ===================== */

  function nodeState(node) {
    if (M.mapClaimed.indexOf(node.id) !== -1) return 'claimed';
    if (M.totalStars >= node.stars) return 'ready';
    return 'locked';
  }

  function claimNode(id) {
    var node = null;
    for (var i = 0; i < MAP_NODES.length; i++) if (MAP_NODES[i].id === id) node = MAP_NODES[i];
    if (!node) return;
    if (nodeState(node) !== 'ready') return;
    M.mapClaimed.push(node.id);
    var r = node.reward, parts = [];
    if (r.coins) { Economy.addCoins(r.coins, 'chest'); parts.push('+' + r.coins + '🪙'); }
    if (r.booster) {
      Economy.addBooster(r.booster, 1, 'chest');
      parts.push('+1 ' + Economy.ECON.BOOSTERS[r.booster].name);
    }
    A.track('currency_earn', { amount: r.coins || 0, source: 'map_node_' + node.id });
    toast('Узел ' + node.id + ': ' + parts.join(', '));
    Store.save();
    renderMeta();
  }

  /* ============================ СТРИК ДНЕЙ =========================== */

  // Статус доступности дневной награды.
  function streakClaimable() { return M.streak.lastClaim !== today(); }

  function claimStreak() {
    if (!streakClaimable()) return;
    var t = today();
    var gap = M.streak.lastClaim ? daysBetween(M.streak.lastClaim, t) : 1;
    var newDay, action;
    if (!M.streak.lastClaim || gap >= 2) {
      newDay = 1;                                   // первый заход или пропуск 2+ дней → сброс
      M.streak.count = 1;
      action = M.streak.lastClaim && gap >= 2 ? 'reset' : 'inc';
    } else {
      newDay = M.streak.day >= 7 ? 1 : M.streak.day + 1;   // цикл 7 дней
      M.streak.count += 1;
      action = 'inc';
    }
    M.streak.day = newDay;
    M.streak.lastClaim = t;

    var reward = STREAK_REWARDS[newDay - 1];
    var parts = [];
    if (reward.coins) { Economy.addCoins(reward.coins, 'streak'); parts.push('+' + reward.coins + '🪙'); }
    if (reward.booster) {
      Economy.addBooster(reward.booster, 1, 'streak');
      parts.push('+1 ' + Economy.ECON.BOOSTERS[reward.booster].name);
    }
    A.track('streak_change', { new_value: M.streak.count, action: action });
    toast('Серия, день ' + newDay + ': ' + parts.join(', '));
    Store.save();
    renderMeta();
  }

  // Кнопка прототипа: имитировать наступление следующего календарного дня.
  function simNextDay() {
    M.simOffset = (M.simOffset || 0) + 1;
    ensureMissions();      // новая дата → ротация миссий
    Store.save();
    renderMeta();
    toast('Наступил новый день (тест). День +1');
  }

  /* ======================= ХУКИ ИЗ ЯДРА (game.js) =================== */

  var maxComboThisGame = 1;

  // Ход с постановкой фигуры завершён: lines — очищено линий, mult — множитель
  // комбо, clean — собралось ли «чистое поле», size — клеток в фигуре.
  function onMove(lines, mult, clean, size) {
    // Монеты: 05 §2.1 — за линию 1 × множитель комбо; бонус за «чистое поле».
    if (lines > 0) Economy.addCoins(lines * Economy.ECON.COIN_PER_LINE * mult, 'level', true);
    if (clean) Economy.addCoins(Economy.ECON.COIN_CLEAN_BOARD, 'level', true);
    // Прогресс миссий.
    if (lines > 0) advanceMissions('lines', lines, 'add');
    if (mult > maxComboThisGame) maxComboThisGame = mult;
    if (mult >= 2) advanceMissions('combo', mult, 'max');
    if (clean) advanceMissions('clean', 1, 'add');
    A.track('line_clear', { lines_n: lines, combo_mult: mult });
  }

  // Взрыв кристальной бомбы: removed — снято клеток, clean — «чистое поле».
  function onBomb(removed, clean) {
    if (clean) {
      Economy.addCoins(Economy.ECON.COIN_CLEAN_BOARD, 'level', true);
      advanceMissions('clean', 1, 'add');
    }
  }

  // Конец партии (честный game over ядра). score — финальный счёт.
  function onGameEnd(score) {
    // Звёзды за партию (04 §2).
    var stars = 0;
    for (var i = 0; i < STAR_THRESHOLDS.length; i++) if (score >= STAR_THRESHOLDS[i]) stars = i + 1;
    M.totalStars += stars;

    // Монеты за конец партии (аналог «Победа на уровне», 05 §2.1).
    var endCoins = Math.min(Economy.ECON.COIN_ENDGAME_MAX,
      Math.floor(score / Economy.ECON.COIN_ENDGAME_DIV));
    if (endCoins > 0) Economy.addCoins(endCoins, 'level', true);

    // Прогресс миссий: сыграна партия + рекорд очков за партию.
    STATS.gamesPlayed += 1;
    advanceMissions('games', 1, 'add');
    advanceMissions('score', score, 'max');

    A.track('game_end', { mode: 'classic', score: score, stars: stars });
    Store.save();

    // Заполнить строки экрана итога (game.js покажет оверлей через 450 мс).
    setText('overCoins', String(Economy.getEarnedThisGame()));
    var starEl = document.getElementById('overStars');
    if (starEl) starEl.textContent = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
    renderMeta();
  }

  // Рестарт партии (в т.ч. первый запуск ядра).
  function onNewGame() {
    Economy.resetEarnedThisGame();
    maxComboThisGame = 1;
    disarmHammer();
    Economy.refreshCoinHud();
    renderBoosterBar();
  }

  /* ===================== БУСТЕРЫ: ВЛИЯНИЕ НА ПАРТИЮ ================= */
  /* Снимок для «Отмены» + применение бустеров через глобалы ядра. */

  var undoSnapshot = null;

  // Снимок состояния ДО хода/бомбы (вызывается ядром перед мутацией).
  function snapshot() {
    if (typeof window.board === 'undefined' || !window.board) return;
    undoSnapshot = {
      board: window.board.map(function (row) { return row.slice(); }),
      hand: window.hand.slice(),
      handMovesMade: window.handMovesMade,
      score: window.score,
      chain: window.combo.chain,
      graceArmed: window.combo.graceArmed,
      charge: window.surge.charge,
      bombReady: window.bombReady
    };
  }

  function canUndo() { return !!undoSnapshot && !window.gameOver; }

  function useUndo() {
    if (window.gameOver) { toast('Партия окончена'); return; }
    if (!undoSnapshot) { toast('Отменять нечего'); return; }
    if (Economy.getBooster('undo') <= 0) { return; }   // защита; UI не должен пускать
    if (!Economy.consumeBooster('undo', 'classic')) return;
    // Восстановление состояния ядра.
    window.board = undoSnapshot.board.map(function (row) { return row.slice(); });
    window.hand = undoSnapshot.hand.slice();
    window.handMovesMade = undoSnapshot.handMovesMade;
    window.score = undoSnapshot.score;
    window.combo.chain = undoSnapshot.chain;
    window.combo.graceArmed = undoSnapshot.graceArmed;
    window.surge.charge = undoSnapshot.charge;
    window.bombReady = undoSnapshot.bombReady;
    undoSnapshot = null;                 // один уровень отмены на ход
    if (window.refreshPlaceable) window.refreshPlaceable();
    if (window.updateHUD) window.updateHUD();
    renderBoosterBar();
    toast('Ход отменён');
  }

  function useSwap() {
    if (window.gameOver) { toast('Партия окончена'); return; }
    if (Economy.getBooster('swap') <= 0) return;
    if (!Economy.consumeBooster('swap', 'classic')) return;
    if (window.dealHand) window.dealHand();       // новая разрешимая тройка (ядро)
    undoSnapshot = null;                          // старую руку уже не вернуть
    if (window.updateHUD) window.updateHUD();
    renderBoosterBar();
    toast('Фигуры заменены');
  }

  var hammerArmed = false;

  function armHammer() {
    if (window.gameOver) { toast('Партия окончена'); return; }
    if (Economy.getBooster('hammer') <= 0) return;
    hammerArmed = !hammerArmed;                   // повторный клик — отмена
    renderBoosterBar();
    toast(hammerArmed ? 'Молот: коснись клетки поля' : 'Молот отменён');
  }

  function disarmHammer() {
    if (hammerArmed) { hammerArmed = false; renderBoosterBar(); }
  }

  function isHammerArmed() { return hammerArmed; }

  // Применить молот к клетке поля (r,c). Возвращает true, если клетка снята.
  function hammerAt(r, c) {
    if (!hammerArmed || window.gameOver) return false;
    if (r < 0 || c < 0 || r >= window.board.length || c >= window.board.length) return false;
    if (window.board[r][c] === 0) { toast('Пустая клетка'); return false; }
    if (Economy.getBooster('hammer') <= 0) { disarmHammer(); return false; }
    snapshot();                                   // молот тоже можно отменить
    if (!Economy.consumeBooster('hammer', 'classic')) return false;
    window.board[r][c] = 0;
    hammerArmed = false;
    if (window.refreshPlaceable) window.refreshPlaceable();
    if (window.checkGameOver) window.checkGameOver();   // снятие клетки может «спасти» партию
    if (window.updateHUD) window.updateHUD();
    renderBoosterBar();
    toast('Клетка убрана');
    return true;
  }

  /* ============================= UI: DOM ============================ */

  function toast(msg) {
    if (window.showToast) { window.showToast(msg); return; }
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(function () { el.classList.add('hidden'); }, 2000);
  }

  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /* --- Бустер-бар в UI партии (кнопки со счётчиком количества) --- */
  function renderBoosterBar() {
    var bar = document.getElementById('boosterBar');
    if (!bar) return;
    var html = '';
    for (var i = 0; i < Economy.ECON.BOOSTER_ORDER.length; i++) {
      var id = Economy.ECON.BOOSTER_ORDER[i];
      var def = Economy.ECON.BOOSTERS[id];
      var cnt = Economy.getBooster(id);
      var armedCls = (id === 'hammer' && hammerArmed) ? ' armed' : '';
      var disabled = cnt <= 0 ? ' zero' : '';
      html += '<button type="button" class="boosterBtn' + armedCls + disabled + '" data-boost="' + id + '">'
            + '<span class="bEmoji">' + def.emoji + '</span>'
            + '<span class="bName">' + def.name + '</span>'
            + '<span class="bCount" id="bCount-' + id + '">×' + cnt + '</span>'
            + '<span class="bPrice">' + (cnt <= 0 ? def.price + '🪙' : '') + '</span>'
            + '</button>';
    }
    bar.innerHTML = html;
  }

  // Клик по бустеру в партии: есть в инвентаре → применить; нет → докупить за монеты.
  function onBoosterClick(id) {
    var cnt = Economy.getBooster(id);
    if (cnt <= 0) {
      var def = Economy.ECON.BOOSTERS[id];
      if (Economy.buyBooster(id)) {
        toast('Куплен «' + def.name + '» за ' + def.price + '🪙');
        renderBoosterBar();
      } else {
        toast('Недостаточно монет (' + def.price + '🪙)');
      }
      return;
    }
    if (id === 'undo') useUndo();
    else if (id === 'swap') useSwap();
    else if (id === 'hammer') armHammer();
  }

  /* --- Мета-экран (карта + магазин + миссии + стрик) --- */
  function renderMeta() {
    var screen = document.getElementById('metaScreen');
    if (!screen || screen.classList.contains('hidden')) {
      // Экран закрыт — обновим только всегда-видимый баланс монет.
      Economy.refreshCoinHud();
      return;
    }
    ensureMissions();
    Economy.refreshCoinHud();

    // Шапка: монеты + звёзды.
    setText('metaCoins', String(Economy.getCoins()));
    setText('metaStars', String(M.totalStars));

    // --- Карта ---
    var map = document.getElementById('mapList');
    if (map) {
      var mh = '';
      for (var i = 0; i < MAP_NODES.length; i++) {
        var node = MAP_NODES[i];
        var st = nodeState(node);
        var rewTxt = rewardText(node.reward);
        var cls = 'mapNode ' + st + (node.boss ? ' boss' : '');
        mh += '<div class="' + cls + '">'
            + '<div class="mnHead"><b>Узел ' + node.id + (node.boss ? ' · Босс' : '') + '</b>'
            + '<span class="mnReq">' + node.stars + '★</span></div>'
            + '<div class="mnRew">' + rewTxt + '</div>';
        if (st === 'ready') mh += '<button type="button" class="mnClaim" data-node="' + node.id + '">Забрать</button>';
        else if (st === 'claimed') mh += '<div class="mnDone">✓ получено</div>';
        else mh += '<div class="mnLock">🔒 нужно ' + node.stars + '★</div>';
        mh += '</div>';
      }
      map.innerHTML = mh;
    }

    // --- Магазин бустеров ---
    var shop = document.getElementById('shopList');
    if (shop) {
      var sh = '';
      for (var s = 0; s < Economy.ECON.BOOSTER_ORDER.length; s++) {
        var bid = Economy.ECON.BOOSTER_ORDER[s];
        var bdef = Economy.ECON.BOOSTERS[bid];
        sh += '<div class="shopItem">'
            + '<span class="siEmoji">' + bdef.emoji + '</span>'
            + '<div class="siInfo"><b>' + bdef.name + '</b><span>' + bdef.hint + '</span></div>'
            + '<span class="siOwned">в наличии: ' + Economy.getBooster(bid) + '</span>'
            + '<button type="button" class="siBuy" data-buy="' + bid + '">' + bdef.price + '🪙</button>'
            + '</div>';
      }
      shop.innerHTML = sh;
    }

    // --- Миссии дня ---
    var miss = document.getElementById('missionList');
    if (miss) {
      var xh = '';
      for (var m = 0; m < M.missions.set.length; m++) {
        var mid = M.missions.set[m];
        var mdef = missionDef(mid);
        if (!mdef) continue;
        var prog = Math.min(M.missions.progress[mid] || 0, mdef.target);
        var done = M.missions.done.indexOf(mid) !== -1;
        var pct = Math.round(prog / mdef.target * 100);
        xh += '<div class="mission' + (done ? ' done' : '') + '">'
            + '<div class="msTop"><span>' + mdef.text + '</span><b>+' + mdef.reward + '🪙</b></div>'
            + '<div class="msBar"><div class="msFill" style="width:' + pct + '%"></div></div>'
            + '<div class="msProg">' + (done ? '✓ выполнено' : prog + ' / ' + mdef.target) + '</div>'
            + '</div>';
      }
      var allDone = M.missions.done.length >= M.missions.set.length;
      xh += '<div class="missionBonus' + (allDone ? ' done' : '') + '">Все 3 миссии → бонус-сундук +'
          + MISSION_BONUS + '🪙 ' + (allDone ? '✓' : '') + '</div>';
      miss.innerHTML = xh;
    }

    // --- Стрик дней ---
    var streak = document.getElementById('streakRow');
    if (streak) {
      var kh = '';
      for (var k = 0; k < 7; k++) {
        var rw = STREAK_REWARDS[k];
        var reached = M.streak.day >= (k + 1) && M.streak.lastClaim;
        var isToday = (M.streak.day === (k + 1)) && !streakClaimable();
        var cls2 = 'streakDay' + (reached ? ' reached' : '') + (isToday ? ' current' : '');
        var label = (rw.coins ? rw.coins + '🪙' : '') + (rw.booster ? ' 🔨' : '');
        kh += '<div class="' + cls2 + '"><span class="sdNum">Д' + (k + 1) + '</span>'
            + '<span class="sdRew">' + label + '</span></div>';
      }
      streak.innerHTML = kh;
    }
    setText('streakCount', 'Серия: ' + M.streak.count + ' дн.');
    var claimBtn = document.getElementById('streakClaimBtn');
    if (claimBtn) {
      claimBtn.disabled = !streakClaimable();
      claimBtn.textContent = streakClaimable() ? 'Получить награду дня' : 'Награда дня получена';
    }
  }

  function rewardText(r) {
    var parts = [];
    if (r.coins) parts.push(r.coins + '🪙');
    if (r.booster) parts.push('1× ' + Economy.ECON.BOOSTERS[r.booster].name);
    return parts.join(' + ');
  }

  function openMeta() {
    disarmHammer();
    var screen = document.getElementById('metaScreen');
    if (screen) screen.classList.remove('hidden');
    ensureMissions();
    renderMeta();
  }
  function closeMeta() {
    var screen = document.getElementById('metaScreen');
    if (screen) screen.classList.add('hidden');
  }

  /* ============================ ПРИВЯЗКА ============================ */

  function bindStaticUi() {
    var openBtn = document.getElementById('openMetaBtn');
    if (openBtn) openBtn.addEventListener('click', openMeta);
    var closeBtn = document.getElementById('metaCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeMeta);
    var overMetaBtn = document.getElementById('overMetaBtn');
    if (overMetaBtn) overMetaBtn.addEventListener('click', function () {
      var ov = document.getElementById('overlay');
      if (ov) ov.classList.add('hidden');
      openMeta();
    });
    var streakBtn = document.getElementById('streakClaimBtn');
    if (streakBtn) streakBtn.addEventListener('click', claimStreak);
    var simBtn = document.getElementById('simDayBtn');
    if (simBtn) simBtn.addEventListener('click', simNextDay);

    // Делегирование кликов внутри бустер-бара и мета-экрана.
    var bar = document.getElementById('boosterBar');
    if (bar) bar.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.boosterBtn') : null;
      if (btn) onBoosterClick(btn.getAttribute('data-boost'));
    });
    var screen = document.getElementById('metaScreen');
    if (screen) screen.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var node = t.getAttribute('data-node');
      if (node) { claimNode(parseInt(node, 10)); return; }
      var buy = t.getAttribute('data-buy');
      if (buy) {
        var def = Economy.ECON.BOOSTERS[buy];
        if (Economy.buyBooster(buy)) { toast('Куплен «' + def.name + '»'); renderMeta(); renderBoosterBar(); }
        else toast('Недостаточно монет (' + def.price + '🪙)');
      }
    });
  }

  // Перехват тача по канвасу для режима «Молот» (capture-фаза, чтобы опередить
  // обработчик ядра на том же элементе). Навешивается после загрузки game.js.
  function attachCanvasHammer() {
    var cv = document.getElementById('game');
    if (!cv) return;
    cv.addEventListener('pointerdown', function (e) {
      if (!hammerArmed || window.gameOver) return;
      if (!window.toLogical) return;
      var pt = window.toLogical(e);
      var CELL = window.CFG ? window.CFG.CELL : 46;
      var bx = window.BOARD_X, by = window.BOARD_Y;
      var c = Math.floor((pt.x - bx) / CELL);
      var r = Math.floor((pt.y - by) / CELL);
      var n = window.board ? window.board.length : 8;
      if (r < 0 || c < 0 || r >= n || c >= n) return;   // не поле — не мешаем ядру
      e.stopImmediatePropagation();                     // не пускаем ход ядра
      e.preventDefault();
      hammerAt(r, c);
    }, true);   // capture — раньше bubble-обработчика game.js
  }

  /* Инициализация: статическая часть — сразу (DOM мета/бустеров уже в разметке
   * выше скриптов); канвас-часть — после загрузки game.js (window load). */
  ensureMissions();
  bindStaticUi();
  renderBoosterBar();
  Economy.refreshCoinHud();
  window.addEventListener('load', attachCanvasHammer);

  return {
    // хуки для game.js:
    onMove: onMove, onBomb: onBomb, onGameEnd: onGameEnd, onNewGame: onNewGame,
    snapshot: snapshot, hammerAt: hammerAt, isHammerArmed: isHammerArmed,
    // UI:
    openMeta: openMeta, closeMeta: closeMeta, renderMeta: renderMeta,
    renderBoosterBar: renderBoosterBar,
    // для отладки/тестов:
    canUndo: canUndo, _state: M
  };
})();
