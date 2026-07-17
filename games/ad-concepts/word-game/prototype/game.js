/*
 * WordGrove — играбельный прототип ядра (Проход А).
 *
 * ОСОЗНАННЫЕ УПРОЩЕНИЯ ПРОХОДА А (по книге GDD games/ad-concepts/word-game/):
 *  - Без сборщиков и без TypeScript: в проде по 10-production.md будет TS + Capacitor,
 *    здесь — чистый ES5/ES6 JS, запускается с любого статического сервера (или file://).
 *  - Рендер: ЧИСТЫЙ Canvas (колесо + линия-след) + DOM (сетка, HUD, оверлеи), а не Phaser.
 *    Обоснование выбора: (1) нет зависимости от CDN — прототип работает полностью
 *    офлайн, что соответствует INV-W5/03 §7; (2) словесной игре не нужны спрайты,
 *    физика и сцены Phaser — примитивов канваса достаточно; (3) DOM даёт бесплатный
 *    качественный рендер кириллицы и CSS-анимации клеток; (4) полный контроль над
 *    хит-тестом букв (радиус захвата 1.3x визуального — 07 §3).
 *  - Словарь валидации: вместо DAWG на ~60 тыс. слов (11 §2.4) — захардкоженный
 *    список бонус-слов на уровень (levels.js). Логика submitWord следует 11 §4.1.
 *  - Без меты/рекламы/IAP/daily/DDA: только ядро — колесо, сетка, бонусы,
 *    подсказка «Лампа», перемешивание, победа, переход уровней, localStorage.
 *  - Жёсткого поражения в ядре НЕТ по дизайну (03 §3) — «рестарт уровня» есть
 *    кнопкой в HUD, тупиковых состояний нет (перемешивание бесплатно, подсказка
 *    опциональна, при нехватке монет игра подсказывает фармить бонусные слова).
 *
 * Управление: зажать кнопку мыши на букве колеса и вести по буквам (линия-след),
 * отпустить — проверка слова. Тач работает через Pointer Events (бонус).
 */

(function () {
  'use strict';

  // ============================== КОНФИГ ==============================

  var CFG = {
    SAVE_KEY: 'wordgrove.save.v1',   // префикс имени игры в localStorage
    START_COINS: 200,                // стартовый баланс монет
    HINT_COST: 100,                  // «Лампа» — цена в монетах (03 §2.4)
    WIN_REWARD: 22,                  // награда за уровень, монет (03 §2.5: 20–25)
    PERFECT_BONUS: 5,                // «блестящий проход» без подсказок (03 §2.5)
    BONUS_WORD_REWARD: 2,            // за бонусное слово (03 §2.1: 2 жёлудя -> тут монеты)
    MIN_WORD_LEN: 3,                 // минимальная длина слова (03 §2.3)
    MAX_CELL_PX: 56,                 // максимальный размер клетки сетки
    MIN_CELL_PX: 26,                 // минимальный размер клетки сетки
    HIT_RADIUS_FACTOR: 1.3,          // радиус захвата буквы = 1.3 x визуального (07 §3)
    TOAST_MS: 1900,                  // длительность тоста
    WORD_FLASH_MS: 750,              // подсветка результата над колесом
    WIN_DELAY_MS: 550                // пауза перед экраном победы (анимация клеток)
  };

  // ============================== СОСТОЯНИЕ ==============================

  // Персистентное состояние (localStorage). level == LEVELS.length => всё пройдено.
  var state = {
    level: 0,
    coins: CFG.START_COINS,
    revealed: {},     // "r,c" -> 1 (открыто словом) | 2 (открыто подсказкой)
    foundBonus: {},   // 'СЛОВО' -> true (сохраняется при рестарте уровня — антифарм, 11 §4.2)
    usedHint: false,  // была ли подсказка на уровне (для «блестящего прохода»)
    rewardGiven: false // защита от двойной выдачи награды (перезагрузка на экране победы)
  };

  // Рантайм текущего уровня (не сохраняется).
  var L = null;          // данные уровня из WORDGROVE_LEVELS
  var cells = {};        // "r,c" -> { letter, r, c, el }
  var cellKeys = [];     // все ключи клеток
  var wordCells = {};    // 'СЛОВО' -> [ключи клеток по порядку букв]
  var gridWordSet = {};  // 'СЛОВО' -> true
  var bonusSet = {};     // 'СЛОВО' -> true
  var wheelLetters = []; // текущий порядок букв на колесе
  var tiles = [];        // [{ letter, x, y }]
  var path = [];         // индексы tiles в порядке протяжки
  var dragging = false;
  var activePointerId = null; // id указателя, начавшего протяжку (мультитач-защита)
  var pointerPos = null; // {x, y} в координатах канваса
  var wheelSize = 0;     // сторона канваса в CSS-пикселях
  var tileR = 0;         // радиус плашки буквы
  var toastTimer = null;
  var flashTimer = null;
  var firstRunToastShown = false;

  // ============================== DOM ==============================

  var $ = function (id) { return document.getElementById(id); };
  var elGrid = $('grid');
  var elGridArea = $('grid-area');
  var elToast = $('toast');
  var elWord = $('current-word');
  var elCoins = $('coins-value');
  var elLevel = $('hud-level');
  var elBonusCount = $('bonus-count');
  var elHintBtn = $('btn-hint');
  var elOverlay = $('overlay');
  var elPanel = $('overlay-panel');
  var canvas = $('wheel');
  var ctx = canvas.getContext('2d');

  // ============================== СОХРАНЕНИЕ ==============================

  function save() {
    try {
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify({
        level: state.level,
        coins: state.coins,
        revealed: state.revealed,
        foundBonus: state.foundBonus,
        usedHint: state.usedHint,
        rewardGiven: state.rewardGiven
      }));
    } catch (e) { /* приватный режим/квота — играем без сохранения */ }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(CFG.SAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    if (typeof s.level === 'number' && s.level >= 0 && s.level <= WORDGROVE_LEVELS.length) {
      state.level = Math.floor(s.level);
    }
    if (typeof s.coins === 'number' && isFinite(s.coins) && s.coins >= 0) {
      state.coins = Math.floor(s.coins);
    }
    if (s.revealed && typeof s.revealed === 'object') state.revealed = s.revealed;
    if (s.foundBonus && typeof s.foundBonus === 'object') state.foundBonus = s.foundBonus;
    state.usedHint = !!s.usedHint;
    state.rewardGiven = !!s.rewardGiven;
  }

  function resetLevelState() {
    state.revealed = {};
    state.foundBonus = {};
    state.usedHint = false;
    state.rewardGiven = false;
  }

  // ============================== УРОВЕНЬ ==============================

  function buildLevel() {
    L = WORDGROVE_LEVELS[state.level];
    cells = {}; cellKeys = []; wordCells = {}; gridWordSet = {}; bonusSet = {};
    path = []; dragging = false; pointerPos = null;

    L.words.forEach(function (pw) {
      var dr = pw.d === 'V' ? 1 : 0;
      var dc = pw.d === 'H' ? 1 : 0;
      var keys = [];
      for (var k = 0; k < pw.w.length; k++) {
        var r = pw.r + dr * k, c = pw.c + dc * k;
        var key = r + ',' + c;
        keys.push(key);
        if (!cells[key]) {
          cells[key] = { letter: pw.w.charAt(k), r: r, c: c, el: null };
          cellKeys.push(key);
        }
      }
      wordCells[pw.w] = keys;
      gridWordSet[pw.w] = true;
    });
    L.bonus.forEach(function (b) { bonusSet[b] = true; });

    // Чистка сохранённых открытых клеток от чужих ключей (смена версии данных).
    var cleaned = {};
    cellKeys.forEach(function (k) {
      if (state.revealed[k]) cleaned[k] = state.revealed[k];
    });
    state.revealed = cleaned;

    // Аналогично чистим бонус-копилку от слов не с этого уровня (старый сейв).
    var cleanedBonus = {};
    Object.keys(state.foundBonus).forEach(function (w) {
      if (bonusSet[w]) cleanedBonus[w] = true;
    });
    state.foundBonus = cleanedBonus;

    wheelLetters = L.wheel.slice();

    renderGrid();
    layoutWheel();
    drawWheel();
    updateWordDisplay('');
    updateHud();

    if (state.level === 0 && cellKeys.every(function (k) { return !state.revealed[k]; }) && !firstRunToastShown) {
      firstRunToastShown = true;
      toast('Зажми букву и веди по буквам, отпусти — проверка');
    }
  }

  function isRevealed(key) { return !!state.revealed[key]; }

  function wordCompleted(w) {
    return wordCells[w].every(isRevealed);
  }

  function allCompleted() {
    return cellKeys.every(isRevealed);
  }

  // ============================== СЕТКА (DOM) ==============================

  function renderGrid() {
    elGrid.innerHTML = '';
    var areaW = elGridArea.clientWidth - 20;
    var areaH = elGridArea.clientHeight - 12;
    var cellPx = Math.floor(Math.min(areaW / L.size.w, areaH / L.size.h, CFG.MAX_CELL_PX));
    if (cellPx < CFG.MIN_CELL_PX) cellPx = CFG.MIN_CELL_PX;

    elGrid.style.width = (L.size.w * cellPx) + 'px';
    elGrid.style.height = (L.size.h * cellPx) + 'px';

    cellKeys.forEach(function (key) {
      var cell = cells[key];
      var el = document.createElement('div');
      el.className = 'cell';
      el.style.left = (cell.c * cellPx + 2) + 'px';
      el.style.top = (cell.r * cellPx + 2) + 'px';
      el.style.width = (cellPx - 4) + 'px';
      el.style.height = (cellPx - 4) + 'px';
      el.style.fontSize = Math.round(cellPx * 0.55) + 'px';
      el.textContent = cell.letter;
      if (state.revealed[key]) {
        el.classList.add('revealed');
        if (state.revealed[key] === 2) el.classList.add('hint-revealed');
        el.style.animation = 'none'; // уже открытые — без повторной анимации при ререндере
      }
      cell.el = el;
      elGrid.appendChild(el);
    });
  }

  // Открыть клетку. byHint -> золотая подсветка. delay — стаггер анимации букв слова.
  function revealCell(key, byHint, delay) {
    if (state.revealed[key]) return;
    state.revealed[key] = byHint ? 2 : 1;
    var el = cells[key].el;
    if (!el) return;
    if (delay) {
      setTimeout(function () {
        el.classList.add('revealed');
        if (byHint) el.classList.add('hint-revealed');
      }, delay);
    } else {
      el.classList.add('revealed');
      if (byHint) el.classList.add('hint-revealed');
    }
  }

  // ============================== КОЛЕСО (Canvas) ==============================

  function layoutWheel() {
    var areaW = document.getElementById('wheel-area').clientWidth;
    var s = Math.min(Math.floor(window.innerHeight * 0.40), areaW - 150, 330);
    if (s < 190) s = 190;
    wheelSize = s;
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = s + 'px';
    canvas.style.height = s + 'px';
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var n = wheelLetters.length;
    tileR = Math.round(s * (n >= 7 ? 0.105 : 0.12));
    var R = s / 2 - tileR - 6;
    tiles = [];
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      tiles.push({
        letter: wheelLetters[i],
        x: s / 2 + R * Math.cos(ang),
        y: s / 2 + R * Math.sin(ang)
      });
    }
  }

  function drawWheel() {
    var s = wheelSize;
    ctx.clearRect(0, 0, s, s);

    // подложка колеса
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();

    // линия-след через выбранные буквы (+ текущая точка указателя)
    if (path.length > 0) {
      ctx.beginPath();
      var first = tiles[path[0]];
      ctx.moveTo(first.x, first.y);
      for (var i = 1; i < path.length; i++) {
        ctx.lineTo(tiles[path[i]].x, tiles[path[i]].y);
      }
      if (dragging && pointerPos) ctx.lineTo(pointerPos.x, pointerPos.y);
      ctx.strokeStyle = 'rgba(67,160,71,0.6)';
      ctx.lineWidth = Math.max(6, tileR * 0.34);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // плашки букв
    var inPath = {};
    path.forEach(function (idx) { inPath[idx] = true; });
    for (var t = 0; t < tiles.length; t++) {
      var tile = tiles[t];
      ctx.beginPath();
      ctx.arc(tile.x, tile.y, tileR, 0, Math.PI * 2);
      ctx.fillStyle = inPath[t] ? '#43a047' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = inPath[t] ? '#2e7d32' : 'rgba(102,187,106,0.9)';
      ctx.stroke();
      ctx.fillStyle = inPath[t] ? '#ffffff' : '#1b5e20';
      ctx.font = '800 ' + Math.round(tileR * 1.05) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.letter, tile.x, tile.y + 1);
    }
  }

  function shuffleWheel() {
    if (dragging) return; // нельзя менять раскладку под активной протяжкой
    // Fisher–Yates; кнопка «перемешать» — бесплатно и без лимита (03 §2.2)
    for (var i = wheelLetters.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = wheelLetters[i]; wheelLetters[i] = wheelLetters[j]; wheelLetters[j] = tmp;
    }
    path = [];
    updateWordDisplay('');
    layoutWheel();
    drawWheel();
  }

  // ============================== ВВОД (Pointer Events) ==============================

  function canvasPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Ближайшая буква в радиусе захвата 1.3x (07 §3), иначе -1.
  function hitTile(p) {
    var best = -1, bestD = Infinity;
    var maxD = tileR * CFG.HIT_RADIUS_FACTOR;
    for (var i = 0; i < tiles.length; i++) {
      var dx = p.x - tiles[i].x, dy = p.y - tiles[i].y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= maxD && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function handlePointer(p) {
    pointerPos = p;
    var idx = hitTile(p);
    if (idx >= 0) {
      var last = path.length - 1;
      if (path.length === 0) {
        path.push(idx);
      } else if (idx === path[last]) {
        // стоим на той же букве — ничего
      } else if (path.length >= 2 && idx === path[last - 1]) {
        path.pop(); // откат: вернулись на предыдущую букву
      } else if (path.indexOf(idx) === -1) {
        path.push(idx);
      }
      updateWordDisplay(currentWord());
    }
    drawWheel();
  }

  function currentWord() {
    return path.map(function (i) { return tiles[i].letter; }).join('');
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (allCompleted()) return; // уровень уже решён — ждём оверлей
    // Второй палец во время протяжки — игнор; повторный down того же указателя
    // (потерян pointerup без capture) — перезапуск жеста, не блокировка.
    if (dragging && e.pointerId !== activePointerId) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // только левая кнопка
    e.preventDefault();
    dragging = true;
    activePointerId = e.pointerId;
    path = []; // защита от «хвоста» при потерянном pointerup (без capture)
    clearFlash();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* старые браузеры */ }
    handlePointer(canvasPos(e));
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    e.preventDefault();
    handlePointer(canvasPos(e));
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    e.preventDefault();
    dragging = false;
    activePointerId = null;
    pointerPos = null;
    submitPath();
  });

  canvas.addEventListener('pointercancel', function (e) {
    if (e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    pointerPos = null;
    path = [];
    updateWordDisplay('');
    drawWheel();
  });

  // Фолбэк для браузеров без pointer capture: отпускание вне канваса — проверка слова
  // (с capture pointerup приходит на canvas и снимает dragging до всплытия сюда).
  window.addEventListener('pointerup', function (e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    pointerPos = null;
    submitPath();
  });

  // ============================== ПРОВЕРКА СЛОВА ==============================
  // Порядок проверок — по 11 §4.1: длина -> сетка -> дубликат -> бонус -> невалидно.
  // Мультимножество колеса соблюдено конструктивно: каждая плашка в path один раз.

  function submitPath() {
    var word = currentWord();
    path = [];
    drawWheel();

    if (word.length === 0) { updateWordDisplay(''); return; }
    if (word.length < CFG.MIN_WORD_LEN) {
      if (word.length >= 2) toast('Слово — минимум ' + CFG.MIN_WORD_LEN + ' буквы');
      updateWordDisplay('');
      return;
    }

    if (gridWordSet[word]) {
      if (wordCompleted(word)) {
        flashWord(word, 'dup');           // DUPLICATE: нейтрально, без наград (03 §2.1)
        toast('Уже найдено');
      } else {
        openGridWord(word);               // GRID_HIT
      }
      return;
    }

    if (state.foundBonus[word]) {
      flashWord(word, 'dup');
      toast('Уже найдено');
      return;
    }

    if (bonusSet[word]) {                 // BONUS: валидное слово не из сетки
      state.foundBonus[word] = true;
      addCoins(CFG.BONUS_WORD_REWARD);
      flashWord(word, 'bonus');
      toast('⭐ Бонусное слово! +' + CFG.BONUS_WORD_REWARD + ' 🪙');
      updateHud();
      save();
      return;
    }

    // INVALID: мягкая тряска, без штрафа (03 §1)
    flashWord(word, 'bad');
    shakeWheel();
  }

  function openGridWord(word) {
    var keys = wordCells[word];
    for (var i = 0; i < keys.length; i++) {
      revealCell(keys[i], false, i * 60);
    }
    flashWord(word, 'ok');
    save();
    checkWin();
  }

  // ============================== ПОДСКАЗКА «ЛАМПА» ==============================

  function useHint() {
    if (allCompleted()) return;
    if (state.coins < CFG.HINT_COST) {
      toast('Не хватает монет — ищи бонусные слова! ⭐');
      return;
    }
    var hidden = cellKeys.filter(function (k) { return !state.revealed[k]; });
    if (hidden.length === 0) return;
    var key = hidden[Math.floor(Math.random() * hidden.length)];
    state.coins -= CFG.HINT_COST;
    state.usedHint = true;
    revealCell(key, true, 0);
    toast('💡 Буква открыта');
    updateHud();
    save();
    checkWin();
  }

  // ============================== ПОБЕДА / ПЕРЕХОДЫ ==============================

  function checkWin() {
    if (!allCompleted()) return;
    var reward = CFG.WIN_REWARD + (state.usedHint ? 0 : CFG.PERFECT_BONUS);
    if (!state.rewardGiven) {
      state.rewardGiven = true;
      addCoins(reward);
      save();
    }
    var levelAtWin = state.level;
    setTimeout(function () {
      // Рестарт (или иная смена состояния) в паузе анимации отменяет показ победы.
      if (state.level === levelAtWin && allCompleted()) showWinOverlay(reward);
    }, CFG.WIN_DELAY_MS);
  }

  function showWinOverlay(reward) {
    var bonusFound = Object.keys(state.foundBonus).length;
    var html =
      '<h2>Уровень ' + (state.level + 1) + ' пройден! 🌿</h2>' +
      '<p class="reward-line">+' + CFG.WIN_REWARD + ' 🪙</p>' +
      (state.usedHint
        ? ''
        : '<p class="reward-line">✨ Блестящий проход: +' + CFG.PERFECT_BONUS + ' 🪙</p>') +
      (bonusFound > 0
        ? '<p>Бонусных слов найдено: ' + bonusFound + ' из ' + L.bonus.length + '</p>'
        : '<p>Бонусных слов на уровне было: ' + L.bonus.length + '</p>') +
      '<button class="primary" id="ov-next">Дальше ▶</button>';
    showOverlay(html);
    $('ov-next').addEventListener('click', nextLevel);
  }

  function nextLevel() {
    hideOverlay();
    state.level++;
    resetLevelState();
    save();
    if (state.level >= WORDGROVE_LEVELS.length) {
      showFinalOverlay();
    } else {
      buildLevel();
    }
  }

  function showFinalOverlay() {
    var html =
      '<h2>🌳 Роща пройдена!</h2>' +
      '<p>Все ' + WORDGROVE_LEVELS.length + ' уровней позади. Монет накоплено: ' +
      state.coins + ' 🪙</p>' +
      '<p>В полной версии дальше — атлас регионов, открытки и ежедневные кроссворды.</p>' +
      '<button class="primary" id="ov-replay">Играть с начала</button>' +
      '<button class="secondary" id="ov-wipe">Сбросить всё</button>';
    showOverlay(html);
    $('ov-replay').addEventListener('click', function () {
      hideOverlay();
      state.level = 0;
      resetLevelState();  // монеты сохраняются
      save();
      buildLevel();
    });
    $('ov-wipe').addEventListener('click', function () {
      hideOverlay();
      state.level = 0;
      state.coins = CFG.START_COINS;
      resetLevelState();
      save();
      buildLevel();
      toast('Прогресс сброшен');
    });
  }

  function restartLevel() {
    if (state.level >= WORDGROVE_LEVELS.length) return;
    // foundBonus сохраняем: повторный ввод бонуса наград не даёт (антифарм, 11 §4.2)
    state.revealed = {};
    state.usedHint = false;
    state.rewardGiven = false;
    save();
    buildLevel();
    toast('Уровень начат заново');
  }

  // ============================== БОНУС-КОПИЛКА ==============================

  function showBonusOverlay() {
    var found = Object.keys(state.foundBonus).sort();
    var listHtml = found.length
      ? '<div class="bonus-list">' + found.map(function (w) {
          return '<span>' + w + '</span>';
        }).join('') + '</div>'
      : '<p>Пока пусто. Составляй валидные слова, которых нет в сетке, — за каждое +' +
        CFG.BONUS_WORD_REWARD + ' 🪙</p>';
    var html =
      '<h2>⭐ Бонусные слова</h2>' +
      '<p>Найдено на уровне: ' + found.length + ' из ' + L.bonus.length + '</p>' +
      listHtml +
      '<button class="primary" id="ov-close">Понятно</button>';
    showOverlay(html);
    $('ov-close').addEventListener('click', hideOverlay);
  }

  // ============================== UI-МЕЛОЧИ ==============================

  function updateHud() {
    elLevel.textContent = state.level < WORDGROVE_LEVELS.length
      ? 'Уровень ' + (state.level + 1) + '/' + WORDGROVE_LEVELS.length
      : 'Роща пройдена';
    elCoins.textContent = state.coins;
    elBonusCount.textContent = Object.keys(state.foundBonus).length;
    $('hint-cost').textContent = CFG.HINT_COST;
    elHintBtn.classList.toggle('poor', state.coins < CFG.HINT_COST);
  }

  function addCoins(n) {
    state.coins += n;
    updateHud();
    var hudCoins = $('hud-coins');
    hudCoins.classList.add('pulse');
    setTimeout(function () { hudCoins.classList.remove('pulse'); }, 200);
  }

  function updateWordDisplay(text) {
    elWord.className = '';
    elWord.innerHTML = text ? '' : '&nbsp;';
    if (text) elWord.textContent = text;
  }

  function clearFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    updateWordDisplay('');
  }

  // Показать введённое слово с цветом результата, потом очистить.
  function flashWord(word, cls) {
    if (flashTimer) clearTimeout(flashTimer);
    elWord.textContent = word;
    elWord.className = cls;
    flashTimer = setTimeout(function () {
      flashTimer = null;
      if (!dragging && path.length === 0) updateWordDisplay('');
    }, CFG.WORD_FLASH_MS);
  }

  function shakeWheel() {
    var area = document.getElementById('wheel-area');
    area.classList.remove('shake');
    // перезапуск CSS-анимации
    void area.offsetWidth;
    area.classList.add('shake');
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      elToast.classList.remove('show');
      toastTimer = null;
    }, CFG.TOAST_MS);
  }

  function showOverlay(html) {
    elPanel.innerHTML = html;
    elOverlay.classList.remove('hidden');
  }

  function hideOverlay() {
    elOverlay.classList.add('hidden');
    elPanel.innerHTML = '';
  }

  // ============================== СТАРТ ==============================

  $('btn-shuffle').addEventListener('click', shuffleWheel);
  elHintBtn.addEventListener('click', useHint);
  $('btn-restart').addEventListener('click', restartLevel);
  $('btn-bonus').addEventListener('click', showBonusOverlay);

  var resizeRaf = null;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      if (!L) return;
      renderGrid();
      layoutWheel();
      drawWheel();
    });
  });

  load();
  if (state.level >= WORDGROVE_LEVELS.length) {
    // Всё пройдено: показываем последний уровень фоном и финальный экран.
    state.level = WORDGROVE_LEVELS.length - 1;
    buildLevel();
    state.level = WORDGROVE_LEVELS.length;
    updateHud();
    showFinalOverlay();
  } else {
    buildLevel();
    // Перезагрузка страницы на решённом уровне: награда уже выдана (rewardGiven),
    // повторно показываем экран победы без повторного начисления.
    if (allCompleted()) {
      checkWin();
    }
  }
})();
