/*
 * WordGrove — мета-прогрессия (Проход Б).
 *
 * Слои поверх ядра (game.js) по GDD 04-meta-progression.md:
 *   §3.1 Атлас        — карта регионов; уровни ядра сгруппированы, регион даёт награду.
 *   §3.3 Дневной      — 1 кроссворд/день из пула (сид-дата) + стрик с вехами.
 *   §3.4 Копилка      — жёлуди копятся к капу, открытие конвертирует в монеты (см. economy.js).
 *   §3.5 Миссии       — daily-миссии считаются по игровым событиям.
 *
 * Мета-экран — отдельный полноэкранный оверлей с вкладками, достижим кнопкой из HUD
 * и закрывается обратно в игру. Модуль владеет своим сейвом `wordgrove.meta.v1`;
 * монеты берёт/выдаёт через мост window.WG (game.js), жёлуди — через window.Economy.
 * Подключается ПЕРЕД game.js. Совместимость: нет сейва меты → всё с дефолтов.
 *
 * Реклама/подписка НЕ трогаются (Проход В): в проде копилка/архив дня — за rewarded
 * (04 §3.3, §3.4), здесь эти гейты открыты. Постепенное включение слоёв по уровням
 * (04 §8) в прототипе не гейтим — все вкладки доступны сразу для наглядности.
 */
(function () {
  'use strict';

  // ============================== КОНФИГ МЕТЫ ==============================
  var MC = {
    SAVE_KEY: 'wordgrove.meta.v1',

    // Атлас (04 §3.1): 10 уровней прототипа сгруппированы в 2 региона по 5.
    // В проде — локации по 15 уровней и регионы по 60 (04 §3.1); здесь масштаб адаптирован.
    REGIONS: [
      { id: 'grove', name: 'Зелёная роща', emoji: '🌳', levels: [0, 1, 2, 3, 4] },
      { id: 'meadow', name: 'Солнечный луг', emoji: '🌻', levels: [5, 6, 7, 8, 9] }
    ],

    // Daily-миссии (04 §3.5): 3 шт., 30–60 монет; часть даёт жёлуди (05 §2.2).
    MISSIONS: [
      { id: 'bonus5', text: 'Найди 5 бонусных слов', emoji: '⭐', metric: 'bonus_word', target: 5, coins: 40, acorns: 0 },
      { id: 'levels3', text: 'Пройди 3 уровня', emoji: '🧩', metric: 'level_complete', target: 3, coins: 30, acorns: 0 },
      { id: 'nohint', text: 'Пройди уровень без подсказок', emoji: '💡', metric: 'level_perfect', target: 1, coins: 60, acorns: 10 }
    ],

    // Темы дня (04 §3.3) — ротация по дню года.
    THEMES: ['Кухня', 'Осень', 'Кино 80-х', 'Природа', 'Город', 'Музыка', 'Путешествия']
  };

  // ============================== СОСТОЯНИЕ ==============================
  // Мутируем поля на месте; при загрузке подставляем дефолты для отсутствующих.
  var meta = {
    daily: { lastDate: null, streak: 0, longest: 0 },
    missions: { date: null, list: [] },
    regions: { claimed: {} },
    stats: { bonusTotal: 0, dailyTotal: 0 }
  };

  var scr = null;        // корневой DOM мета-экрана (ленивое создание)
  var contentEl = null;  // контейнер вкладки
  var isOpen = false;
  var currentTab = 'atlas';

  // ============================== СЕЙВ ==============================
  function saveMeta() {
    try { localStorage.setItem(MC.SAVE_KEY, JSON.stringify(meta)); }
    catch (e) { /* приватный режим/квота */ }
  }

  function loadMeta() {
    var raw = null;
    try { raw = localStorage.getItem(MC.SAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    if (s.daily && typeof s.daily === 'object') {
      if (typeof s.daily.lastDate === 'string') meta.daily.lastDate = s.daily.lastDate;
      if (typeof s.daily.streak === 'number' && isFinite(s.daily.streak) && s.daily.streak >= 0) meta.daily.streak = Math.floor(s.daily.streak);
      if (typeof s.daily.longest === 'number' && isFinite(s.daily.longest) && s.daily.longest >= 0) meta.daily.longest = Math.floor(s.daily.longest);
    }
    if (s.missions && typeof s.missions === 'object') {
      if (typeof s.missions.date === 'string') meta.missions.date = s.missions.date;
      // Санитизация строк миссий: отбрасываем неизвестные id, приводим progress к
      // валидному числу [0..target], claimed — к boolean. Иначе повреждённый сейв
      // (progress = "abc"/undefined/Infinity) прошёл бы проверку `progress < target`
      // как false и позволил забрать награду без выполнения (и рисовал бы NaN%).
      if (Object.prototype.toString.call(s.missions.list) === '[object Array]') {
        meta.missions.list = s.missions.list
          .filter(function (row) { return row && typeof row === 'object' && missionDef(row.id); })
          .map(function (row) {
            var def = missionDef(row.id);
            var p = (typeof row.progress === 'number' && isFinite(row.progress) && row.progress >= 0)
              ? Math.min(Math.floor(row.progress), def.target) : 0;
            return { id: row.id, progress: p, claimed: !!row.claimed };
          });
      }
    }
    if (s.regions && s.regions.claimed && typeof s.regions.claimed === 'object') meta.regions.claimed = s.regions.claimed;
    if (s.stats && typeof s.stats === 'object') {
      if (typeof s.stats.bonusTotal === 'number' && isFinite(s.stats.bonusTotal) && s.stats.bonusTotal >= 0) meta.stats.bonusTotal = Math.floor(s.stats.bonusTotal);
      if (typeof s.stats.dailyTotal === 'number' && isFinite(s.stats.dailyTotal) && s.stats.dailyTotal >= 0) meta.stats.dailyTotal = Math.floor(s.stats.dailyTotal);
    }
  }

  // ============================== ДАТЫ ==============================
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isYesterday(prevStr, curStr) {
    // true, если prevStr — календарный день перед curStr.
    var p = parseDate(prevStr), c = parseDate(curStr);
    if (!p || !c) return false;
    var y = new Date(c.getTime());
    y.setDate(y.getDate() - 1);
    return todayStr(y) === prevStr;
  }
  function parseDate(str) {
    if (typeof str !== 'string') return null;
    var m = str.split('-');
    if (m.length !== 3) return null;
    var d = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function dayOfYear(d) {
    d = d || new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }

  // ============================== ДНЕВНОЙ КРОССВОРД (04 §3.3) ==============================
  function totalLevels() {
    return (typeof WORDGROVE_LEVELS !== 'undefined') ? WORDGROVE_LEVELS.length : 10;
  }
  // Детерминированный уровень дня из пула по сид-дате.
  function dailySeedIndex() {
    var d = todayStr(), h = 0;
    for (var i = 0; i < d.length; i++) { h = (h * 31 + d.charCodeAt(i)) >>> 0; }
    return h % totalLevels();
  }
  function todayTheme() { return MC.THEMES[dayOfYear() % MC.THEMES.length]; }
  function isDailyDoneToday() { return meta.daily.lastDate === todayStr(); }
  function nextMilestone(streak) {
    var ms = [3, 7, 14, 30];
    for (var i = 0; i < ms.length; i++) { if (ms[i] > streak) return ms[i]; }
    return null;
  }

  // Вызывается ядром (game.js) при победе в дневном режиме. Начисляет монеты + стрик.
  // Возвращает сводку для оверлея. Идемпотентно в пределах дня (награда 1/день).
  function onDailyComplete() {
    var today = todayStr();
    if (meta.daily.lastDate === today) {
      return { already: true, coins: 0, streak: meta.daily.streak, milestone: 0 };
    }
    if (meta.daily.lastDate && isYesterday(meta.daily.lastDate, today)) meta.daily.streak += 1;
    else meta.daily.streak = 1;
    meta.daily.lastDate = today;
    if (meta.daily.streak > meta.daily.longest) meta.daily.longest = meta.daily.streak;
    meta.stats.dailyTotal += 1;

    var coins = ECON.DAILY_COINS;
    var milestone = ECON.STREAK_MILESTONES[meta.daily.streak] || 0;
    coins += milestone;
    addCoins(coins, milestone ? 'daily+streak_milestone' : 'daily');
    track('daily_finish', { theme_id: todayTheme(), is_premium: false, streak_after: meta.daily.streak });
    if (milestone) track('streak_milestone', { days: meta.daily.streak });

    saveMeta();
    updateBadge();
    return { already: false, coins: coins, streak: meta.daily.streak, milestone: milestone };
  }

  // ============================== МИССИИ (04 §3.5) ==============================
  function ensureMissionsToday() {
    var today = todayStr();
    if (meta.missions.date === today && meta.missions.list && meta.missions.list.length) return;
    meta.missions.date = today;
    meta.missions.list = MC.MISSIONS.map(function (m) {
      return { id: m.id, progress: 0, claimed: false };
    });
    saveMeta();
  }
  function missionDef(id) {
    for (var i = 0; i < MC.MISSIONS.length; i++) { if (MC.MISSIONS[i].id === id) return MC.MISSIONS[i]; }
    return null;
  }
  function bumpMissions(metric, amount) {
    ensureMissionsToday();
    for (var i = 0; i < meta.missions.list.length; i++) {
      var row = meta.missions.list[i];
      var def = missionDef(row.id);
      if (!def || def.metric !== metric) continue;
      if (row.progress < def.target) row.progress = Math.min(def.target, row.progress + amount);
    }
  }
  function claimMission(id) {
    ensureMissionsToday();
    var row = null;
    for (var i = 0; i < meta.missions.list.length; i++) { if (meta.missions.list[i].id === id) { row = meta.missions.list[i]; break; } }
    var def = missionDef(id);
    if (!row || !def) return;
    if (row.claimed || row.progress < def.target) return;
    row.claimed = true;
    if (def.coins) addCoins(def.coins, 'mission:' + id);
    if (def.acorns && window.Economy) window.Economy.addAcorns(def.acorns);
    track('mission_complete', { mission_id: id, type: 'daily' });
    saveMeta();
    refreshHud();
    updateBadge();
    if (isOpen) renderTab();
  }
  function missionsClaimable() {
    ensureMissionsToday();
    for (var i = 0; i < meta.missions.list.length; i++) {
      var row = meta.missions.list[i];
      var def = missionDef(row.id);
      if (def && !row.claimed && row.progress >= def.target) return true;
    }
    return false;
  }

  // ============================== АТЛАС (04 §3.1) ==============================
  function levelsDone() {
    return (window.WG && typeof window.WG.getLevel === 'function') ? window.WG.getLevel() : 0;
  }
  function regionDone(region) {
    var done = levelsDone();
    for (var i = 0; i < region.levels.length; i++) { if (region.levels[i] >= done) return false; }
    return true;
  }
  // Выдать награды за уже полностью пройденные регионы (раз в регион).
  // Вызывается при завершении уровня и при инициализации (миграция игрока Прохода А).
  function checkRegions(silent) {
    for (var i = 0; i < MC.REGIONS.length; i++) {
      var region = MC.REGIONS[i];
      if (meta.regions.claimed[region.id]) continue;
      if (!regionDone(region)) continue;
      meta.regions.claimed[region.id] = true;
      addCoins(ECON.REGION_REWARD, 'region:' + region.id);
      track('postcard_earned', { postcard_id: region.id, region: region.id });
      saveMeta();
      if (!silent && window.WG && window.WG.toast) {
        window.WG.toast(region.emoji + ' Регион «' + region.name + '» пройден! +' + ECON.REGION_REWARD + ' 🪙');
      }
    }
  }

  // ============================== СОБЫТИЯ ЯДРА ==============================
  // game.js вызывает Meta.emit(evt, payload). Обновляем миссии/атлас/статистику.
  function emit(evt, payload) {
    payload = payload || {};
    if (evt === 'bonus_word') {
      meta.stats.bonusTotal += 1;
      bumpMissions('bonus_word', 1);
    } else if (evt === 'level_complete') {
      bumpMissions('level_complete', 1);
      if (payload.perfect) bumpMissions('level_perfect', 1);
      checkRegions(false);
    }
    saveMeta();
    updateBadge();
    if (isOpen) renderTab();
  }

  // ============================== МОСТ К МОНЕТАМ ==============================
  function addCoins(n, source) {
    if (window.WG && typeof window.WG.addCoins === 'function') window.WG.addCoins(n, source);
  }
  function getCoins() { return (window.WG && window.WG.getCoins) ? window.WG.getCoins() : 0; }
  function refreshHud() { if (window.WG && window.WG.refreshHud) window.WG.refreshHud(); }
  function getAcorns() { return window.Economy ? window.Economy.getAcorns() : 0; }
  function track(evt, params) { if (window.Economy && window.Economy.track) window.Economy.track(evt, params); }

  // ============================== БЕЙДЖ НА КНОПКЕ HUD ==============================
  function anyActionable() {
    return missionsClaimable() || !isDailyDoneToday() || (window.Economy && window.Economy.isPiggyFull());
  }
  function updateBadge() {
    var btn = document.getElementById('btn-meta');
    if (!btn) return;
    if (anyActionable()) btn.classList.add('has-badge');
    else btn.classList.remove('has-badge');
  }

  // ============================== DOM МЕТА-ЭКРАНА ==============================
  function buildScreen() {
    if (scr) return;
    scr = document.createElement('div');
    scr.id = 'meta-screen';
    scr.className = 'hidden';
    scr.innerHTML =
      '<header class="meta-header">' +
        '<div class="meta-cur"><span class="c-coin">🪙 <b id="meta-coins">0</b></span>' +
        '<span class="c-acorn">🌰 <b id="meta-acorns">0</b></span></div>' +
        '<button class="meta-close" data-action="close">✕ Играть</button>' +
      '</header>' +
      '<nav class="meta-tabs">' +
        '<button data-tab="atlas">🗺️ Атлас</button>' +
        '<button data-tab="daily">📅 Дневной</button>' +
        '<button data-tab="piggy">🐿️ Копилка</button>' +
        '<button data-tab="missions">🎯 Миссии</button>' +
      '</nav>' +
      '<div id="meta-content"></div>';
    (document.getElementById('app') || document.body).appendChild(scr);
    contentEl = scr.querySelector('#meta-content');

    // Навигация по вкладкам + закрытие (создаётся один раз).
    var tabs = scr.querySelectorAll('.meta-tabs button');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { currentTab = btn.getAttribute('data-tab'); renderTab(); });
      })(tabs[i]);
    }
    // Делегирование действий внутри контента и хедера.
    scr.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== scr && !t.getAttribute('data-action')) t = t.parentNode;
      if (!t || t === scr) return;
      handleAction(t.getAttribute('data-action'), t);
    });
  }

  function handleAction(action, el) {
    if (action === 'close' || action === 'play-current') {
      close();
    } else if (action === 'play-daily') {
      close();
      if (window.WG && window.WG.startDaily) window.WG.startDaily(dailySeedIndex());
    } else if (action === 'open-piggy') {
      if (window.Economy) {
        var got = window.Economy.openPiggy();
        refreshHud();
        renderTab();
        updateBadge();
        if (got > 0 && window.WG && window.WG.toast) window.WG.toast('🐿️ Копилка открыта: +' + got + ' 🪙');
      }
    } else if (action === 'claim-mission') {
      claimMission(el.getAttribute('data-id'));
    }
  }

  // ============================== РЕНДЕР ВКЛАДОК ==============================
  function renderTab() {
    if (!scr) return;
    // подсветка активной вкладки
    var tabs = scr.querySelectorAll('.meta-tabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === currentTab);
    }
    var coinsEl = document.getElementById('meta-coins');
    var acornEl = document.getElementById('meta-acorns');
    if (coinsEl) coinsEl.textContent = getCoins();
    if (acornEl) acornEl.textContent = getAcorns();

    if (currentTab === 'atlas') contentEl.innerHTML = renderAtlas();
    else if (currentTab === 'daily') contentEl.innerHTML = renderDaily();
    else if (currentTab === 'piggy') contentEl.innerHTML = renderPiggy();
    else if (currentTab === 'missions') contentEl.innerHTML = renderMissions();
  }

  function renderAtlas() {
    var done = levelsDone();
    var total = totalLevels();
    var html = '<div class="meta-pane">' +
      '<p class="pane-sub">Пройдено уровней: ' + Math.min(done, total) + ' / ' + total + '</p>';
    for (var i = 0; i < MC.REGIONS.length; i++) {
      var region = MC.REGIONS[i];
      var rd = 0;
      for (var j = 0; j < region.levels.length; j++) { if (region.levels[j] < done) rd++; }
      var pct = Math.round((rd / region.levels.length) * 100);
      var claimed = !!meta.regions.claimed[region.id];
      html += '<div class="region-card">' +
        '<div class="region-head"><span class="region-emoji">' + region.emoji + '</span>' +
        '<span class="region-name">' + region.name + '</span>' +
        '<span class="region-pct">' + pct + '%</span></div>' +
        '<div class="region-nodes">';
      for (var k = 0; k < region.levels.length; k++) {
        var lvl = region.levels[k];
        var cls = 'node', label = (lvl + 1);
        if (lvl < done) { cls += ' node-done'; label = '✓'; }
        else if (lvl === done) { cls += ' node-current'; }
        else { cls += ' node-locked'; }
        var act = (lvl === done && done < total) ? ' data-action="play-current"' : '';
        html += '<span class="' + cls + '"' + act + '>' + label + '</span>';
      }
      html += '</div>' +
        '<div class="region-reward">' + (claimed
          ? '✅ Награда региона получена: +' + ECON.REGION_REWARD + ' 🪙'
          : '🏆 Заверши все уровни → +' + ECON.REGION_REWARD + ' 🪙') + '</div>' +
        '</div>';
    }
    if (done < total) {
      html += '<button class="meta-primary" data-action="play-current">▶ Продолжить уровень ' + (done + 1) + '</button>';
    } else {
      html += '<p class="pane-sub">🌳 Роща пройдена полностью!</p>';
    }
    return html + '</div>';
  }

  function renderDaily() {
    var done = isDailyDoneToday();
    var streak = meta.daily.streak;
    var nm = nextMilestone(streak);
    var html = '<div class="meta-pane">' +
      '<div class="daily-hero"><div class="daily-theme">Тема дня: <b>' + todayTheme() + '</b></div>' +
      '<div class="daily-streak">🔥 <b>' + streak + '</b> ' + plural(streak, 'день', 'дня', 'дней') +
      ' подряд</div>' +
      '<div class="daily-longest">Лучший стрик: ' + meta.daily.longest + '</div></div>';
    // трек вех стрика
    html += '<div class="milestones">';
    var ms = [3, 7, 14, 30];
    for (var i = 0; i < ms.length; i++) {
      var reached = streak >= ms[i];
      html += '<div class="ms-node' + (reached ? ' ms-reached' : '') + '">' +
        '<div class="ms-day">' + ms[i] + 'д</div>' +
        '<div class="ms-rew">+' + ECON.STREAK_MILESTONES[ms[i]] + ' 🪙</div></div>';
    }
    html += '</div>';
    if (nm) html += '<p class="pane-sub">Следующая веха: ' + nm + ' дней</p>';
    html += '<p class="pane-sub">Награда за день: +' + ECON.DAILY_COINS + ' 🪙 (бонусные слова → жёлуди в копилку)</p>';
    if (done) {
      html += '<div class="daily-done">✅ Сегодня пройден — приходи завтра</div>';
    } else {
      html += '<button class="meta-primary" data-action="play-daily">📅 Играть дневной кроссворд</button>';
    }
    return html + '</div>';
  }

  function renderPiggy() {
    var acorns = getAcorns();
    var cap = window.Economy ? window.Economy.getCap() : 200;
    var pct = Math.round((acorns / cap) * 100);
    var full = window.Economy && window.Economy.isPiggyFull();
    var html = '<div class="meta-pane">' +
      '<div class="piggy-emoji">🐿️</div>' +
      '<div class="piggy-count"><b>' + acorns + '</b> / ' + cap + ' 🌰</div>' +
      '<div class="piggy-bar"><div class="piggy-fill" style="width:' + pct + '%"></div></div>';
    if (full) html += '<p class="pane-warn">Копилка полная — новые жёлуди сгорают!</p>';
    html += '<p class="pane-sub">Жёлуди капают за бонусные слова (+' + ECON.ACORN_PER_BONUS + '/слово). Открытие копилки конвертирует их в монеты 1:1.</p>' +
      '<p class="pane-note">В проде открытие — за просмотр рекламы (RV-5, Проход В).</p>';
    if (acorns > 0) {
      html += '<button class="meta-primary" data-action="open-piggy">🐿️ Открыть копилку (+' + acorns + ' 🪙)</button>';
    } else {
      html += '<div class="daily-done">Пусто — собирай бонусные слова в уровнях</div>';
    }
    return html + '</div>';
  }

  function renderMissions() {
    ensureMissionsToday();
    var html = '<div class="meta-pane"><p class="pane-sub">Ежедневные миссии (обновляются каждый день)</p>';
    for (var i = 0; i < meta.missions.list.length; i++) {
      var row = meta.missions.list[i];
      var def = missionDef(row.id);
      if (!def) continue;
      var prog = Math.min(row.progress, def.target);
      var pct = Math.round((prog / def.target) * 100);
      var reward = '+' + def.coins + ' 🪙' + (def.acorns ? ' +' + def.acorns + ' 🌰' : '');
      html += '<div class="mission-card' + (row.claimed ? ' mission-claimed' : '') + '">' +
        '<div class="mission-top"><span class="mission-emoji">' + def.emoji + '</span>' +
        '<span class="mission-text">' + def.text + '</span></div>' +
        '<div class="mission-bar"><div class="mission-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="mission-foot"><span class="mission-prog">' + prog + '/' + def.target + '</span>' +
        '<span class="mission-rew">' + reward + '</span>';
      if (row.claimed) html += '<span class="mission-state">✅ Получено</span>';
      else if (prog >= def.target) html += '<button class="mission-claim" data-action="claim-mission" data-id="' + def.id + '">Забрать</button>';
      else html += '<span class="mission-state">В процессе</span>';
      html += '</div></div>';
    }
    return html + '</div>';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ============================== ОТКРЫТИЕ / ЗАКРЫТИЕ ==============================
  function open(tab) {
    buildScreen();
    ensureMissionsToday();
    if (tab) currentTab = tab;
    isOpen = true;
    scr.classList.remove('hidden');
    renderTab();
    updateBadge();
  }
  function close() {
    isOpen = false;
    if (scr) scr.classList.add('hidden');
  }

  // ============================== СБРОС ==============================
  function resetMeta() {
    meta.daily = { lastDate: null, streak: 0, longest: 0 };
    meta.missions = { date: null, list: [] };
    meta.regions = { claimed: {} };
    meta.stats = { bonusTotal: 0, dailyTotal: 0 };
    saveMeta();
    updateBadge();
    if (isOpen) renderTab();
  }

  // ============================== ИНИЦИАЛИЗАЦИЯ ==============================
  function init() {
    loadMeta();
    ensureMissionsToday();
    // Миграция: выдать награды за уже пройденные регионы (игрок Прохода А), без тостов.
    checkRegions(true);
    updateBadge();
  }

  // ============================== ЭКСПОРТ ==============================
  window.Meta = {
    init: init,
    open: open,
    close: close,
    emit: emit,
    onDailyComplete: onDailyComplete,
    isDailyDoneToday: isDailyDoneToday,
    dailySeedIndex: dailySeedIndex,
    todayTheme: todayTheme,
    reset: resetMeta
  };
})();
