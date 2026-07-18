/* =============================================================================
 * Orchard Peaks — слой МЕТА-ПРОГРЕССИИ (Проход Б)
 * -----------------------------------------------------------------------------
 * Реализует 04-meta-progression.md: сад с зонами и заказами (§4.2 — сердце
 * модели), стрик «Утренняя лейка» и миссии (§4.4). Единый мета-экран достижим из
 * партии и обратно. Подключается в index.html ПОСЛЕ economy.js, ПЕРЕД game.js.
 *
 * Петля (04 §4.8): солитер → монеты (W(n)) + урожай (карты 🍎) → заказы сада
 * потребляют урожай/монеты → зона продвигается, открывается новый заказ (новая
 * цель) → мотив сыграть ещё раздачу за урожаем. Мета создаёт и причину играть, и
 * дефицит монет (желание «добить заказ сегодня» → ещё раздачи → взносы).
 *
 * Состояние берётся/пишется в window.Store.state (economy/garden/streak/missions/
 * almanac). Начисления валют идут через window.Economy. DOM — крупные шрифты для
 * ЦА 45+ (стили в style.css). Обработчики навешены делегированием на контейнеры —
 * переживают перерисовку экрана без «повисших» слушателей.
 * ========================================================================== */
'use strict';

window.Meta = (function () {

  var S = window.Store.state;
  var E = window.Economy;
  var C = E.ECON;                 // конфиг экономики/меты (объявлен в economy.js)

  /* --- Производные выборки по конфигу (локальные, без глобальных коллизий) --- */
  function rewardsSafe(day) {
    var idx = Math.max(1, Math.min(7, day || 1));
    return C.STREAK_REWARDS[idx] || { coins: 0 };
  }
  function dailyIds()   { return C.DAILY_MISSIONS.map(function (d) { return d.id; }); }
  function weeklyIds()  { return C.WEEKLY_MISSIONS.map(function (d) { return d.id; }); }
  function allMissions() { return C.DAILY_MISSIONS.concat(C.WEEKLY_MISSIONS); }
  function missionById(id) {
    var all = allMissions();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* ============================ ДАННЫЕ САДА ============================ */
  /* Зоны 04 §4.2: Крыльцо → Клумбы → Огород → Теплица (4 зоны на прототип из 12
   * на запуске). В каждой 4 заказа. Заказ потребляет урожай (единственный sink
   * урожая, 05 §5.2) и иногда монеты; даёт награду и открывает следующий.
   * costH — урожай (40–400, 04 §4.2); costC — монеты; rc — награда монет; decor —
   * эмодзи, который «достраивает» сцену зоны (визуальный прогресс, 04 §4.2). */
  var ZONES = [
    { id: 'porch', name: 'Крыльцо', emoji: '🏡', scene: 'Дощатое крыльцо тётиного дома',
      orders: [
        { title: 'Расчистить дорожку',      costH: 40,  costC: 0,   rc: 120, decor: '🧹' },
        { title: 'Повесить фонарик',        costH: 70,  costC: 0,   rc: 150, decor: '🏮' },
        { title: 'Починить скамейку',       costH: 120, costC: 100, rc: 260, decor: '🪑' },
        { title: 'Посадить герань у входа',  costH: 160, costC: 0,   rc: 220, decor: '🌺' }
      ] },
    { id: 'beds', name: 'Клумбы', emoji: '🌷', scene: 'Полоса клумб вдоль забора',
      orders: [
        { title: 'Вскопать клумбу',         costH: 120, costC: 0,   rc: 200, decor: '🪴' },
        { title: 'Посадить лаванду',        costH: 180, costC: 120, rc: 320, decor: '💜' },
        { title: 'Высадить тюльпаны',       costH: 220, costC: 0,   rc: 300, decor: '🌷' },
        { title: 'Поставить бордюр',        costH: 280, costC: 200, rc: 380, decor: '🧱' }
      ] },
    { id: 'garden', name: 'Огород', emoji: '🥕', scene: 'Огород за домом',
      orders: [
        { title: 'Разметить грядки',        costH: 200, costC: 0,   rc: 260, decor: '🌱' },
        { title: 'Посадить морковь',        costH: 260, costC: 150, rc: 340, decor: '🥕' },
        { title: 'Посадить томаты',         costH: 320, costC: 0,   rc: 360, decor: '🍅' },
        { title: 'Собрать первый урожай',   costH: 380, costC: 250, rc: 520, decor: '🧺' }
      ] },
    { id: 'greenhouse', name: 'Теплица', emoji: '🪟', scene: 'Стеклянная теплица у пруда',
      orders: [
        { title: 'Собрать каркас',          costH: 260, costC: 200, rc: 380, decor: '🔩' },
        { title: 'Вставить стёкла',         costH: 340, costC: 0,   rc: 420, decor: '🪟' },
        { title: 'Высадить рассаду',        costH: 400, costC: 0,   rc: 440, decor: '🌿' },
        { title: 'Запустить полив',         costH: 400, costC: 300, rc: 640, decor: '💧' }
      ] }
  ];

  var ALMANAC_PER_ORDER = 10;   // очки альманаха за заказ (04 §4.5, лёгкий счётчик)

  /* Плоский список заказов + карта «глобальный индекс → зона». */
  var FLAT = [];
  ZONES.forEach(function (z, zi) {
    z.startIndex = FLAT.length;
    z.orders.forEach(function (o) { FLAT.push({ order: o, zoneIdx: zi }); });
    z.endIndex = FLAT.length; // exclusive
  });
  var TOTAL_ORDERS = FLAT.length;

  function zoneCompleteBonus(zoneIdx) { return 1000 + 500 * zoneIdx; }

  /* Индекс зоны текущего активного заказа (для бонуса за сток = глава). */
  function currentZoneIdx() {
    var done = S.garden.completed;
    if (!(done >= 0)) done = 0;                          // защита от NaN/отрицательного индекса
    if (done >= TOTAL_ORDERS) return ZONES.length - 1;
    var entry = FLAT[done];
    return entry ? entry.zoneIdx : ZONES.length - 1;     // дробный/битый индекс не роняет мету
  }
  function currentChapter() { return currentZoneIdx() + 1; }

  /* ============================ ДАТЫ / СИМ-ДЕНЬ ============================ */
  /* Кнопка «Новый день (тест)» двигает виртуальное «сегодня» — чтобы вживую
   * увидеть стрик и суточный сброс миссий без ожидания реальных суток. */
  function nowMs() { return Date.now() + (S.stats.simDayOffset || 0) * 86400000; }
  function dateStr(ms) {
    var d = new Date(ms);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function today() { return dateStr(nowMs()); }
  function yesterday() { return dateStr(nowMs() - 86400000); }
  function weekKey() { return Math.floor(nowMs() / (7 * 86400000)); }

  /* ============================ СТРИК (04 §4.4) ============================ */
  function streakStatus() {
    var st = S.streak;
    var t = today();
    if (st.lastClaim === t) return { claimable: false, day: st.day };       // уже забрали сегодня
    var newDay = (st.lastClaim === yesterday()) ? Math.min(7, (st.day || 0) + 1) : 1;
    return { claimable: true, day: newDay };
  }
  function claimStreak() {
    var s = streakStatus();
    if (!s.claimable) return false;
    var rw = rewardsSafe(s.day);
    E.addCoins(rw.coins, 'streak');
    if (rw.undo)   E.addFreeUndo(rw.undo);
    if (rw.joker)  E.addBooster('joker', rw.joker, 'streak');
    if (rw.basket) E.addBooster('basket', rw.basket, 'streak');
    S.streak.day = s.day;
    S.streak.lastClaim = today();
    window.Store.save();
    window.Analytics.track('streak_update', { day_no: s.day });
    return true;
  }

  /* ============================ МИССИИ (04 §4.4) ============================ */
  function refreshMissions() {
    var m = S.missions;
    var t = today(), wk = weekKey();
    var changed = false;
    if (m.day !== t) {
      dailyIds().forEach(function (id) { delete m.prog[id]; delete m.claimed[id]; });
      m.day = t; changed = true;
    }
    if (m.week !== wk) {
      weeklyIds().forEach(function (id) { delete m.prog[id]; delete m.claimed[id]; });
      m.week = wk; changed = true;
    }
    if (changed) window.Store.save();
  }
  /* Прогресс миссий по игровым событиям. type: harvest|chain5|orders|wins. */
  function track(type, amount) {
    amount = amount || 1;
    refreshMissions();
    var m = S.missions, touched = false;
    allMissions().forEach(function (def) {
      if (def.type !== type || m.claimed[def.id]) return;
      var cur = m.prog[def.id] || 0;
      if (cur >= def.target) return;
      m.prog[def.id] = Math.min(def.target, cur + amount);
      touched = true;
    });
    if (touched) { window.Store.save(); if (isOpen() && tab === 'tasks') render(); }
  }
  function claimMission(id) {
    var def = missionById(id);
    if (!def) return false;
    var m = S.missions;
    if (m.claimed[id] || (m.prog[id] || 0) < def.target) return false;
    E.addCoins(def.coins, 'mission');
    if (def.card) S.garden.cards += 1;
    m.claimed[id] = true;
    window.Store.save();
    window.Analytics.track('mission_complete', { mission_id: id, coins: def.coins });
    return true;
  }

  /* ============================ ЗАКАЗЫ САДА (04 §4.2) ============================ */
  var lastZoneToast = null;
  function activeOrder() {
    if (S.garden.completed >= TOTAL_ORDERS) return null;   // сад пройден целиком
    return FLAT[S.garden.completed];
  }
  function canComplete(entry) {
    if (!entry) return false;
    return E.getHarvest() >= entry.order.costH && E.getCoins() >= entry.order.costC;
  }
  function completeActiveOrder() {
    var entry = activeOrder();
    if (!entry || !canComplete(entry)) return false;
    var o = entry.order;
    E.spendHarvest(o.costH);
    if (o.costC > 0) E.spendCoins(o.costC, 'order');
    var idx = S.garden.completed;
    S.garden.completed += 1;
    S.almanac += ALMANAC_PER_ORDER;
    E.addCoins(o.rc, 'order');                 // награда за заказ (04 §4.2)
    window.Analytics.track('order_complete', {
      order_id: idx, zone_id: entry.zoneIdx, harvest_spent: o.costH
    });
    // Завершение зоны → крупная награда (04 §4.2/§4.3).
    var zone = ZONES[entry.zoneIdx];
    if (S.garden.completed >= zone.endIndex) {
      var bonus = zoneCompleteBonus(entry.zoneIdx);
      E.addCoins(bonus, 'zone_complete');
      S.garden.cards += 1;                     // карточка гербария за зону (флейвор)
      window.Analytics.track('zone_complete', { zone_id: entry.zoneIdx });
      lastZoneToast = { name: zone.name, bonus: bonus };
    } else {
      lastZoneToast = null;
    }
    window.Store.save();
    track('orders', 1);                        // прогресс миссий
    render();
    return true;
  }

  /* ============================ МЕТА-ЭКРАН ============================ */
  var tab = 'garden';
  var elScreen, elBody, elCoins, elHarvest;

  function isOpen() { return elScreen && !elScreen.classList.contains('hidden'); }

  function syncBalances() {
    if (elCoins)   elCoins.textContent   = E.fmt(E.getCoins());
    if (elHarvest) elHarvest.textContent = E.fmt(E.getHarvest());
  }

  function open(startTab) {
    refreshMissions();
    tab = startTab || 'garden';
    elScreen.classList.remove('hidden');
    document.body.classList.add('meta-open');
    setActiveTabButton();
    render();
    window.Analytics.track('screen_open', { screen: 'meta:' + tab });
  }
  function close() {
    elScreen.classList.add('hidden');
    document.body.classList.remove('meta-open');
    if (window.Game && Game.syncHud) Game.syncHud();
  }
  function setTab(name) { tab = name; setActiveTabButton(); render(); }
  function setActiveTabButton() {
    var btns = document.querySelectorAll('#meta-tabs button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tab);
    }
  }

  /* --- утилита экранирования (заголовки заказов статичны, но на всякий) --- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function render() {
    syncBalances();
    if (tab === 'garden')     elBody.innerHTML = renderGarden();
    else if (tab === 'tasks') elBody.innerHTML = renderTasks();
    else if (tab === 'shop')  elBody.innerHTML = renderShop();
    elBody.scrollTop = 0;
  }

  /* ---------- Вкладка «Сад»: зоны, сцены, заказы ---------- */
  function renderGarden() {
    var done = S.garden.completed;
    var curZone = currentZoneIdx();
    var html = '';

    if (done >= TOTAL_ORDERS) {
      html += '<div class="meta-hero">🎉 Весь сад расцвёл!</div>' +
              '<p class="meta-sub">Вы прошли все зоны прототипа. В полной игре — 12 зон и 240 уровней.</p>';
    } else {
      html += '<p class="meta-sub">Заказы тратят 🍎 урожай (и иногда 💰 монеты), продвигают зону и открывают новую цель. ' +
              'Не хватает урожая — сыграйте ещё раздачу.</p>';
    }

    for (var zi = 0; zi <= Math.min(curZone, ZONES.length - 1); zi++) {
      html += renderZone(zi);
    }
    // Тизер следующей запертой зоны.
    if (curZone + 1 < ZONES.length && done < TOTAL_ORDERS) {
      var nz = ZONES[curZone + 1];
      html += '<div class="zone locked"><div class="zone-head"><span class="zone-emoji">🔒</span>' +
              '<span class="zone-name">' + esc(nz.name) + '</span></div>' +
              '<div class="zone-teaser">Откроется, когда закончите «' + esc(ZONES[curZone].name) + '»</div></div>';
    }
    return html;
  }

  function renderZone(zi) {
    var z = ZONES[zi];
    var done = S.garden.completed;
    var doneInZone = Math.max(0, Math.min(z.orders.length, done - z.startIndex));
    var pct = Math.round((doneInZone / z.orders.length) * 100);

    var scene = '';
    for (var i = 0; i < z.orders.length; i++) {
      scene += '<span class="decor ' + (i < doneInZone ? 'on' : 'off') + '">' +
               (i < doneInZone ? z.orders[i].decor : '·') + '</span>';
    }

    var html = '<div class="zone">';
    html += '<div class="zone-head"><span class="zone-emoji">' + z.emoji + '</span>' +
            '<span class="zone-name">' + esc(z.name) + '</span>' +
            '<span class="zone-pct">' + pct + '%</span></div>';
    html += '<div class="zone-scene" title="' + esc(z.scene) + '">' + scene + '</div>';
    html += '<div class="zone-bar"><div class="zone-fill" style="width:' + pct + '%"></div></div>';

    // Активный заказ этой зоны (если он тут).
    var ao = activeOrder();
    if (ao && ao.zoneIdx === zi) {
      var o = ao.order;
      var okH = E.getHarvest() >= o.costH;
      var okC = E.getCoins() >= o.costC;
      var can = okH && okC;
      html += '<div class="order active">';
      html += '<div class="order-title">📋 ' + esc(o.title) + ' ' + o.decor + '</div>';
      html += '<div class="order-cost">Нужно: ' +
              '<b class="' + (okH ? '' : 'lack') + '">🍎 ' + o.costH + '</b>' +
              (o.costC > 0 ? ' + <b class="' + (okC ? '' : 'lack') + '">💰 ' + o.costC + '</b>' : '') +
              ' → награда <b>💰 ' + o.rc + '</b></div>';
      html += '<button class="order-btn" data-action="order" ' + (can ? '' : 'disabled') + '>' +
              (can ? 'Выполнить заказ' : (okH ? 'Не хватает монет' : 'Не хватает урожая')) + '</button>';
      html += '</div>';
    } else if (done >= z.endIndex) {
      html += '<div class="order zone-done">✓ Зона готова — сад благодарит вас!</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- Вкладка «Задания»: стрик + миссии ---------- */
  function renderTasks() {
    var html = '';
    // Стрик.
    var s = streakStatus();
    var rw = rewardsSafe(s.day);
    html += '<div class="card-panel">';
    html += '<div class="panel-title">🌅 Утренняя лейка — стрик</div>';
    html += '<div class="streak-row">';
    for (var d = 1; d <= 7; d++) {
      var isNow = s.claimable && d === s.day;
      var isPast = (!s.claimable && d <= s.day) || (s.claimable && d < s.day);
      var cls = 'streak-day' + (isPast ? ' past' : '') + (isNow ? ' now' : '');
      html += '<div class="' + cls + '"><div class="sd-n">' + (d === 7 ? '7+' : d) + '</div>' +
              '<div class="sd-r">' + rewardsSafe(d).coins + '</div></div>';
    }
    html += '</div>';
    if (s.claimable) {
      var extra = (rw.undo ? ' +↩' : '') + (rw.joker ? ' +🃏' : '') + (rw.basket ? ' +🧺' : '');
      html += '<button class="claim-btn" data-action="claim-streak">Забрать день ' + s.day +
              ': 💰 ' + rw.coins + extra + '</button>';
    } else {
      html += '<div class="claimed-note">Награда дня забрана. Возвращайтесь завтра — стрик продолжится.</div>';
    }
    html += '</div>';

    // Миссии — дневные и недельная.
    html += renderMissionGroup('Дневные миссии', C.DAILY_MISSIONS);
    html += renderMissionGroup('Миссия недели', C.WEEKLY_MISSIONS);

    // Тест-кнопка виртуального дня.
    html += '<div class="card-panel test-panel">' +
            '<div class="panel-title">🧪 Проверка петли</div>' +
            '<div class="claimed-note">Сдвиньте «сегодня» на день вперёд, чтобы увидеть стрик и сброс миссий.</div>' +
            '<button class="ghost-btn" data-action="newday">Новый день (тест)</button></div>';
    return html;
  }

  function renderMissionGroup(title, defs) {
    var m = S.missions;
    var html = '<div class="card-panel"><div class="panel-title">🎯 ' + title + '</div>';
    defs.forEach(function (def) {
      var prog = Math.min(def.target, m.prog[def.id] || 0);
      var pct = Math.round((prog / def.target) * 100);
      var claimed = !!m.claimed[def.id];
      var ready = prog >= def.target && !claimed;
      html += '<div class="mission">';
      html += '<div class="mission-text">' + esc(def.text) + '</div>';
      html += '<div class="mission-bar"><div class="mission-fill" style="width:' + pct + '%"></div>' +
              '<span class="mission-frac">' + prog + '/' + def.target + '</span></div>';
      if (claimed) {
        html += '<div class="mission-reward done">✓ Забрано (💰 ' + def.coins + ')</div>';
      } else if (ready) {
        html += '<button class="claim-btn small" data-action="claim-mission" data-id="' + def.id + '">' +
                'Забрать 💰 ' + def.coins + (def.card ? ' + карточка' : '') + '</button>';
      } else {
        html += '<div class="mission-reward">Награда: 💰 ' + def.coins + (def.card ? ' + карточка' : '') + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ---------- Вкладка «Лавка»: бустеры + план экономики ---------- */
  function renderShop() {
    var html = '<p class="meta-sub">Бустеры покупаются за монеты и помогают в раскладах (05 §5.6).</p>';
    C.BOOSTER_ORDER.forEach(function (id) {
      var def = C.BOOSTERS[id];
      var owned = E.getBooster(id);
      var full = owned >= def.cap;
      var afford = E.getCoins() >= def.price;
      html += '<div class="shop-item">';
      html += '<div class="shop-emoji">' + def.emoji + '</div>';
      html += '<div class="shop-info"><div class="shop-name">' + esc(def.name) + ' <span class="owned">×' + owned + '</span></div>' +
              '<div class="shop-hint">' + esc(def.hint) + '</div></div>';
      html += '<button class="buy-btn" data-action="buy" data-id="' + id + '" ' +
              (full || !afford ? 'disabled' : '') + '>' +
              (full ? 'Максимум' : '💰 ' + def.price) + '</button>';
      html += '</div>';
    });
    html += '<div class="shop-item info-item"><div class="shop-emoji">↩</div>' +
            '<div class="shop-info"><div class="shop-name">Отмена хода</div>' +
            '<div class="shop-hint">Бесплатных: ' + E.getFreeUndos() + '. Далее — 💰 ' + C.UNDO_PRICE +
            ' за отмену прямо в раздаче.</div></div></div>';

    html += renderEconomyPlan();
    return html;
  }

  /* Панель «План экономики» — воспроизводит спроектированный переход
   * профицит→дефицит (05 §5.4) и отмечает полосу игрока по текущему уровню n. */
  function renderEconomyPlan() {
    var n = E.getLevel();
    var e = E.entryCost(n), w = E.winReward(n), m = E.winMult(n);
    var plan = C.PLAN_5_4;
    // Ближайшая по уровню строка плана.
    var nearest = 0, bestD = Infinity;
    for (var i = 0; i < plan.length; i++) {
      var d = Math.abs(plan[i].level - n);
      if (d < bestD) { bestD = d; nearest = i; }
    }
    var html = '<div class="card-panel plan-panel">';
    html += '<div class="panel-title">📊 Экономика: где вы на кривой</div>';
    html += '<div class="plan-now">Уровень <b>' + n + '</b> · взнос <b>💰 ' + E.fmt(e) +
            '</b> · выигрыш <b>💰 ' + E.fmt(w) + '</b> · множитель <b>×' + m.toFixed(2) + '</b></div>';
    html += '<div class="plan-note">Спроектированный путь баланса медианного игрока (05 §5.4): ' +
            'дни 1–4 — профицит («медовый месяц»), день 5+ — плановое сползание в дефицит, ' +
            'день 12–16 — точка первого денежного решения.</div>';
    html += '<div class="plan-table-wrap"><table class="plan-table"><thead><tr>' +
            '<th>День</th><th>Ур.</th><th>Сальдо/день</th><th>Баланс</th></tr></thead><tbody>';
    for (var j = 0; j < plan.length; j++) {
      var row = plan[j];
      var pos = row.saldo >= 0;
      html += '<tr class="' + (j === nearest ? 'plan-here' : '') + '">' +
              '<td>' + row.day + '</td><td>' + row.level + '</td>' +
              '<td class="' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '') + E.fmt(row.saldo) + '</td>' +
              '<td>' + E.fmt(row.balance) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<div class="plan-note">▲ строка ближе всего к вашему уровню (' + esc(plan[nearest].note) + ').</div>';
    html += '</div>';
    return html;
  }

  /* ============================ ИНИЦИАЛИЗАЦИЯ ============================ */
  function init() {
    elScreen  = document.getElementById('meta-screen');
    elBody    = document.getElementById('meta-body');
    elCoins   = document.getElementById('meta-coins');
    elHarvest = document.getElementById('meta-harvest');

    refreshMissions();
    E.subscribe(function () { if (isOpen()) syncBalances(); });

    // Навигация по вкладкам.
    document.getElementById('meta-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-tab]');
      if (b) setTab(b.getAttribute('data-tab'));
    });

    // Кнопка «← Играть».
    document.getElementById('meta-back').addEventListener('click', close);

    // Делегированные действия внутри тела экрана.
    elBody.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-action]');
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-action');
      if (act === 'order') {
        if (completeActiveOrder()) flashToast(lastZoneToast
          ? ('🎉 Зона «' + lastZoneToast.name + '» готова! +💰 ' + lastZoneToast.bonus)
          : 'Заказ выполнен! Сад подрос.');
      } else if (act === 'buy') {
        var id = b.getAttribute('data-id');
        if (E.buyBooster(id)) { render(); flashToast('Куплено: ' + C.BOOSTERS[id].name); }
      } else if (act === 'claim-mission') {
        if (claimMission(b.getAttribute('data-id'))) { render(); flashToast('Награда за миссию получена!'); }
      } else if (act === 'claim-streak') {
        if (claimStreak()) { render(); flashToast('Стрик засчитан! Лейка полна.'); }
      } else if (act === 'newday') {
        S.stats.simDayOffset = (S.stats.simDayOffset || 0) + 1;
        window.Store.save();
        refreshMissions();
        render();
        flashToast('Наступил новый день (тест).');
      }
    });
  }

  /* Небольшой всплывающий тост поверх мета-экрана. */
  var toastTimer = null;
  function flashToast(msg) {
    var t = document.getElementById('meta-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  return {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    syncBalances: syncBalances,
    track: track,
    streakStatus: streakStatus,
    claimStreak: claimStreak,
    claimMission: claimMission,
    completeActiveOrder: completeActiveOrder,
    currentChapter: currentChapter,
    ZONES: ZONES,
    TOTAL_ORDERS: TOTAL_ORDERS
  };
})();
