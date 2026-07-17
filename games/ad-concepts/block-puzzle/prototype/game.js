/* =============================================================================
 * Block Surge — играбельный прототип ядра (Проход А)
 * -----------------------------------------------------------------------------
 * ОСОЗНАННЫЕ УПРОЩЕНИЯ ПРОХОДА А (по книге GDD games/ad-concepts/block-puzzle):
 *  - Без сборщиков и без TypeScript: в проде по главе 10 будет TS + Capacitor,
 *    здесь один файл на чистом JS, запускается с любого статического сервера.
 *  - Рендер: чистый Canvas 2D + DOM вместо Phaser 3 CDN. Обоснование: вся
 *    графика прототипа — прямоугольники сетки, ghost-подсветка и три спрайта
 *    дока; Canvas даёт это в ~200 строк без сцен/лоадеров Phaser, работает
 *    офлайн (ноль внешних зависимостей — надёжнее для прототипа, который
 *    открывают с локального статического сервера без интернета).
 *  - Режим один — «Классика» (endless): рост сложности w_hard по очкам
 *    (03 §5.2). Меты, рекламы, IAP, камней, pity-системы и Фигурных полей нет.
 *  - Кристальная механика упрощена по ТЗ Прохода А: при заполнении шкалы
 *    «Прилива» в док (4-е гнездо) приходит кристальная бомба; её перетаскивают
 *    на поле, и она очищает область 3×3 (40 + 1 очко/клетку, 11 §5.3).
 *    Использование бомбы — не ход: комбо-цепь не двигается (аналог правил
 *    бустеров 11 §4.3). Пока бомба в доке, заряд шкалы заморожен (11 §5.2).
 *  - SOLVENCY-CHECK: вместо beam-поиска (11 §3.4) — DFS с ранним выходом и
 *    потолком узлов; для поля 8×8 этого достаточно (< 2 мс на практике).
 *  - Снап: округление к ближайшей клетке (аппроксимация правила «≥60%
 *    площади», 03 §3).
 * Реализовано по спекам: 03-core-gameplay.md §2–5, 07-ux-ui-ftue.md §2.2,
 * 11-algorithms.md §1–5 (каталог 14 форм, мешок w_hard, антифрустрация,
 * reroll + форс-замена, комбо-автомат с «прощением», шкала Прилива,
 * одновременная очистка рядов и столбцов, честный game over INV-G2).
 * Управление: мышь (drag&drop), тач — бонусом через Pointer Events.
 * ========================================================================== */
'use strict';

/* ============================== КОНФИГ ==================================== */

var CFG = {
  N: 8,                    // размер поля (03 §2.1)
  CELL: 46,                // размер клетки поля, px (логических)
  PAD: 14,                 // поля канваса
  DOCK_GAP: 18,            // отступ поле → док
  DOCK_H: 112,             // высота дока
  SLOT_GAP: 8,             // зазор между гнёздами дока
  DOCK_CELL: 15,           // размер клетки фигуры в доке
  LIFT_MOUSE: 26,          // подъём фигуры над курсором (мышь)
  LIFT_TOUCH: 80,          // подъём над пальцем (03 §3: 80 px)
  // --- Баланс (03 §2.2–2.3, §5.2; 11 §3, §5) ---
  LINE_PTS: [0, 10, 30, 60, 100],  // очки за 1/2/3/4+ линий за ход
  CLEAN_BONUS: 300,        // «чистое поле», множителем не умножается
  BOMB_BASE_PTS: 40,       // взрыв кристалла: 40 + 1/клетку
  SURGE_MAX: 100,          // ёмкость шкалы Прилива
  SURGE_PER_MULT: 10,      // заряд за чистящий ход = 10 × множитель
  W_HARD_START: 0.19,      // Классика: стартовый w_hard (11 §3.1)
  W_HARD_STEP: 0.03,       // +0.03 за каждые 500 очков
  W_HARD_CAP: 0.55,
  SCORE_STEP: 500,
  FILL_BOOST_AT: 0.70,     // антифрустрация: fill > 70% → SMALL ×1.5
  SMALL_BOOST: 1.5,
  REROLLS: 3,              // reroll'ов солвенси-проверки (03 §4.1)
  SOLVER_NODE_CAP: 30000,  // потолок узлов DFS (fail-open: считаем решаемым)
  CLEAR_ANIM_MS: 300,
  FLOAT_ANIM_MS: 800,
  STORAGE_BEST: 'blocksurge_best'  // префикс имени игры
};

/* ===================== КАТАЛОГ ФИГУР (11 §2, 14 форм) ===================== */
/* cells нормализованы к (0,0); вращения нет (03 §2.1 п.2). colorIdx — палитра. */

var COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

var CATALOG = [
  { id: 'MONO',     cells: [[0,0]],                          H: 1, w0: 6, colorIdx: 2 },
  { id: 'DOMINO_H', cells: [[0,0],[0,1]],                    H: 1, w0: 5, colorIdx: 1 },
  { id: 'DOMINO_V', cells: [[0,0],[1,0]],                    H: 1, w0: 5, colorIdx: 1 },
  { id: 'TRIO_I',   cells: [[0,0],[0,1],[0,2]],              H: 2, w0: 7, colorIdx: 5 },
  { id: 'TRIO_L',   cells: [[0,0],[1,0],[1,1]],              H: 2, w0: 7, colorIdx: 6 },
  { id: 'TET_I',    cells: [[0,0],[0,1],[0,2],[0,3]],        H: 3, w0: 6, colorIdx: 4 },
  { id: 'TET_O',    cells: [[0,0],[0,1],[1,0],[1,1]],        H: 2, w0: 8, colorIdx: 2 },
  { id: 'TET_L',    cells: [[0,0],[1,0],[2,0],[2,1]],        H: 3, w0: 6, colorIdx: 1 },
  { id: 'TET_S',    cells: [[0,1],[0,2],[1,0],[1,1]],        H: 4, w0: 4, colorIdx: 0 },
  { id: 'TET_T',    cells: [[0,0],[0,1],[0,2],[1,1]],        H: 3, w0: 6, colorIdx: 6 },
  { id: 'PENT_P',   cells: [[0,0],[0,1],[1,0],[1,1],[2,0]],  H: 4, w0: 4, colorIdx: 7 },
  { id: 'PENT_L',   cells: [[0,0],[1,0],[2,0],[3,0],[3,1]],  H: 4, w0: 4, colorIdx: 3 },
  { id: 'PENT_X',   cells: [[0,1],[1,0],[1,1],[1,2],[2,1]],  H: 5, w0: 2, colorIdx: 0 },
  { id: 'PENT_I5',  cells: [[0,0],[0,1],[0,2],[0,3],[0,4]],  H: 5, w0: 3, colorIdx: 4 }
];

var DEF = {};          // id → определение с производными полями
var SUM_W0_EASY = 0;   // H ≤ 3 (11 §2: 56)
var SUM_W0_HARD = 0;   // H ≥ 4 (11 §2: 17)

CATALOG.forEach(function (p) {
  var maxR = 0, maxC = 0;
  p.cells.forEach(function (rc) {
    if (rc[0] > maxR) maxR = rc[0];
    if (rc[1] > maxC) maxC = rc[1];
  });
  p.h = maxR + 1;
  p.w = maxC + 1;
  p.size = p.cells.length;
  DEF[p.id] = p;
  if (p.H >= 4) SUM_W0_HARD += p.w0; else SUM_W0_EASY += p.w0;
});

var RESCUE_ORDER = ['DOMINO_H', 'DOMINO_V', 'MONO'];  // «спасательные» (11 §2)

/* ========================= ГЕОМЕТРИЯ КАНВАСА ============================== */

var N = CFG.N;
var BOARD_X = CFG.PAD, BOARD_Y = CFG.PAD;
var GRID_W = N * CFG.CELL;
var DOCK_Y = BOARD_Y + GRID_W + CFG.DOCK_GAP;
var W = CFG.PAD * 2 + GRID_W;
var H = DOCK_Y + CFG.DOCK_H + CFG.PAD;
var SLOT_W = (GRID_W - 3 * CFG.SLOT_GAP) / 4;   // 3 гнезда фигур + гнездо бомбы

function slotRect(i) {   // i = 0..2 фигуры, 3 — гнездо кристальной бомбы
  return { x: BOARD_X + i * (SLOT_W + CFG.SLOT_GAP), y: DOCK_Y, w: SLOT_W, h: CFG.DOCK_H };
}

/* ============================ RNG (11 §6.1) =============================== */
/* mulberry32 — детерминизм от сида партии (INV-G3): никаких Math.random в логике. */

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

/* ========================= СОСТОЯНИЕ ПАРТИИ =============================== */

var board = null;          // N×N: 0 — пусто, 1..8 — colorIdx+1
var hand = [null, null, null];       // PieceId | null
var handPlaceable = [false, false, false];
var handMovesMade = 0;     // ходов сделано текущей тройкой (для «прощения»)
var score = 0;
var best = 0;
var startBest = 0;         // рекорд на старте партии (для «Новый рекорд!»)
var combo = { chain: 0, graceArmed: false };   // автомат 11 §5.1
var surge = { charge: 0 };                     // шкала 11 §5.2
var bombReady = false;     // кристальная бомба в доке (заряд заморожен)
var gameOver = false;
var rng = mulberry32(1);
var overTimer = null;      // отложенный показ экрана результата (отменяется рестартом)

/* Эффекты (только визуал, на логику не влияют — INV-G4) */
var clearFx = [];   // {r, c, color, t0}
var floatFx = [];   // {x, y, text, color, t0}
var ringFx = [];    // {x, y, t0}

/* Перетаскивание */
var drag = null;    // {kind:'piece'|'bomb', slot, id, px, py, lift, ghost}

/* ========================= БАЗОВЫЕ ОПЕРАЦИИ ПОЛЯ ========================== */

function newBoard() {
  var b = [];
  for (var r = 0; r < N; r++) {
    var row = [];
    for (var c = 0; c < N; c++) row.push(0);
    b.push(row);
  }
  return b;
}

function cloneBoard(b) {
  return b.map(function (row) { return row.slice(); });
}

function canPlace(b, p, r, c) {
  if (r < 0 || c < 0 || r + p.h > N || c + p.w > N) return false;
  for (var i = 0; i < p.cells.length; i++) {
    if (b[r + p.cells[i][0]][c + p.cells[i][1]] !== 0) return false;
  }
  return true;
}

function stampPiece(b, p, r, c, val) {
  for (var i = 0; i < p.cells.length; i++) {
    b[r + p.cells[i][0]][c + p.cells[i][1]] = val;
  }
}

function canPlaceAnywhere(b, p) {
  for (var r = 0; r <= N - p.h; r++) {
    for (var c = 0; c <= N - p.w; c++) {
      if (canPlace(b, p, r, c)) return true;   // ранний выход (11 §4.1)
    }
  }
  return false;
}

/* Одновременный поиск полных строк И столбцов — до удаления (11 §4.2 шаг 1). */
function findFullLines(b) {
  var rows = [], cols = [], r, c, full;
  for (r = 0; r < N; r++) {
    full = true;
    for (c = 0; c < N; c++) if (b[r][c] === 0) { full = false; break; }
    if (full) rows.push(r);
  }
  for (c = 0; c < N; c++) {
    full = true;
    for (r = 0; r < N; r++) if (b[r][c] === 0) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows: rows, cols: cols };
}

/* Клетки пересечения строк и столбцов очищаются один раз (11 §4.3). */
function lineCells(rows, cols) {
  var seen = {}, out = [], i, c, r, key;
  for (i = 0; i < rows.length; i++) {
    for (c = 0; c < N; c++) {
      key = rows[i] * N + c;
      if (!seen[key]) { seen[key] = true; out.push([rows[i], c]); }
    }
  }
  for (i = 0; i < cols.length; i++) {
    for (r = 0; r < N; r++) {
      key = r * N + cols[i];
      if (!seen[key]) { seen[key] = true; out.push([r, cols[i]]); }
    }
  }
  return out;
}

function fillRatio(b) {
  var n = 0;
  for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (b[r][c] !== 0) n++;
  return n / (N * N);
}

function boardEmpty(b) {
  for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (b[r][c] !== 0) return false;
  return true;
}

/* ================== ГЕНЕРАТОР: МЕШОК И ВЫДАЧА ТРОЙКИ ====================== */
/* 03 §4.1 шаги 1–6 + 11 §3.1/3.3 в объёме Прохода А (без pity и стресс-индекса). */

/* Классика: w_hard растёт с очками (03 §5.2), dEff = (w_hard − 0.10) / 0.45. */
function currentDEff() {
  var wHard = Math.min(CFG.W_HARD_CAP,
    CFG.W_HARD_START + CFG.W_HARD_STEP * Math.floor(score / CFG.SCORE_STEP));
  return (wHard - 0.10) / 0.45;
}

function buildBag(dEff) {
  var hardShare = Math.min(0.55, Math.max(0.10, 0.10 + 0.45 * dEff));
  var fill = fillRatio(board);
  var bag = {};   // id → вес
  CATALOG.forEach(function (p) {
    var groupShare = p.H >= 4 ? hardShare : 1 - hardShare;
    var groupSum = p.H >= 4 ? SUM_W0_HARD : SUM_W0_EASY;
    var w = groupShare * p.w0 / groupSum;
    if (fill > CFG.FILL_BOOST_AT && p.size <= 3) w *= CFG.SMALL_BOOST;  // антифрустрация
    bag[p.id] = w;
  });
  return bag;
}

function weightedDraw(bag) {
  var sum = 0, id, last = null;
  for (id in bag) sum += bag[id];
  var roll = rng() * sum;
  for (id in bag) {
    last = id;
    roll -= bag[id];
    if (roll <= 0) return id;
  }
  return last;   // защита от накопления погрешности float
}

/* Три вытяжки без возврата; ≤1 фигуры с H=5 в тройке (11 §3.3). */
function drawTriple(bag) {
  var pool = {}, id;
  for (id in bag) pool[id] = bag[id];
  var triple = [], h5 = 0;
  while (triple.length < 3) {
    id = weightedDraw(pool);
    if (DEF[id].H === 5 && h5 >= 1) {
      var easy = {}, any = false, k;
      for (k in pool) if (DEF[k].H <= 3) { easy[k] = pool[k]; any = true; }
      id = any ? weightedDraw(easy) : 'MONO';
    }
    if (DEF[id].H === 5) h5++;
    triple.push(id);
    delete pool[id];
  }
  return triple;
}

/* ------------------- SOLVENCY-CHECK (11 §3.4, INV-G1) --------------------- */
/* DFS: ищет ОДНУ последовательность размещения всех фигур; симуляция хода
 * обязана выполнять очистку линий — иначе ложные «нерешаемо». */

function solveTriple(srcBoard, ids) {
  var nodes = 0;

  function applySim(b, p, r, c) {
    var nb = cloneBoard(b);
    stampPiece(nb, p, r, c, 1);
    var lines = findFullLines(nb);
    var cells = lineCells(lines.rows, lines.cols);
    for (var i = 0; i < cells.length; i++) nb[cells[i][0]][cells[i][1]] = 0;
    return nb;
  }

  function dfs(b, left) {
    if (left.length === 0) return true;
    if (++nodes > CFG.SOLVER_NODE_CAP) return true;  // fail-open: не блокируем выдачу
    var tried = {};
    for (var i = 0; i < left.length; i++) {
      var id = left[i];
      if (tried[id]) continue;   // дубликаты фигур в тройке не перебираем дважды
      tried[id] = true;
      var p = DEF[id];
      for (var r = 0; r <= N - p.h; r++) {
        for (var c = 0; c <= N - p.w; c++) {
          if (!canPlace(b, p, r, c)) continue;
          var rest = left.slice(0, i).concat(left.slice(i + 1));
          if (dfs(applySim(b, p, r, c), rest)) return true;
        }
      }
    }
    return false;
  }

  return dfs(cloneBoard(srcBoard), ids);
}

/* Полный цикл выдачи: reroll ≤3, затем форс-замена самой неудобной фигуры
 * на спасательную, затем деградация до предела (03 §4.1 шаги 4–5, 11 §3.3). */
function dealHand() {
  var dEff = currentDEff();
  var triple = null;
  for (var attempt = 0; attempt <= CFG.REROLLS; attempt++) {
    triple = drawTriple(buildBag(dEff));
    if (solveTriple(board, triple)) { finishDeal(triple); return; }
  }
  // Форс-замена: худшая по H фигура → спасательная
  var worst = 0, i, j;
  for (i = 1; i < 3; i++) if (DEF[triple[i]].H > DEF[triple[worst]].H) worst = i;
  for (i = 0; i < RESCUE_ORDER.length; i++) {
    var cand = triple.slice();
    cand[worst] = RESCUE_ORDER[i];
    if (solveTriple(board, cand)) { finishDeal(cand); return; }
  }
  // Деградация до предела: [спасательная, MONO, MONO]
  for (j = 0; j < RESCUE_ORDER.length; j++) {
    var degr = [RESCUE_ORDER[j], 'MONO', 'MONO'];
    if (solveTriple(board, degr)) { finishDeal(degr); return; }
  }
  // Поле практически полное: выдаём MONO — честный game over зафиксирует INV-G2
  finishDeal(['MONO', 'MONO', 'MONO']);
}

function finishDeal(triple) {
  hand = triple.slice();
  handMovesMade = 0;
  refreshPlaceable();
}

function refreshPlaceable() {
  for (var i = 0; i < 3; i++) {
    handPlaceable[i] = hand[i] !== null && canPlaceAnywhere(board, DEF[hand[i]]);
  }
}

/* ==================== КОМБО И ПРИЛИВ (11 §5.1–5.2) ======================== */

function multFor(chain) {
  return chain >= 4 ? 5 : chain === 3 ? 3 : chain === 2 ? 2 : 1;
}

/* Автомат комбо: очистка растит цепь; ход без очистки рвёт её, кроме
 * ПЕРВОГО хода новой тройки при взведённом «прощении» (окно планирования). */
function comboAdvance(cleared, wasFirstMoveOfHand) {
  if (cleared) {
    combo.chain += 1;
    combo.graceArmed = true;         // прощение взводится заново каждой очисткой
  } else if (wasFirstMoveOfHand && combo.graceArmed) {
    combo.graceArmed = false;        // цепь не рвётся, но и не растёт
  } else {
    combo.chain = 0;
    combo.graceArmed = false;
  }
  return multFor(combo.chain);
}

/* Заряд = 10 × множитель за чистящий ход; при готовой бомбе заряд заморожен. */
function surgeOnClear(lines, mult) {
  if (lines === 0 || bombReady) return;
  surge.charge = Math.min(CFG.SURGE_MAX, surge.charge + CFG.SURGE_PER_MULT * mult);
  if (surge.charge >= CFG.SURGE_MAX) {
    bombReady = true;
    showToast('💎 Прилив! Кристальная бомба в доке');
  }
}

/* ========================= РАЗРЕШЕНИЕ ХОДА (11 §4.2) ====================== */

function placePieceFromSlot(slot, r, c) {
  var id = hand[slot];
  if (id === null || gameOver) return;
  var p = DEF[id];
  if (!canPlace(board, p, r, c)) return;

  var wasFirstMove = handMovesMade === 0;
  handMovesMade++;

  stampPiece(board, p, r, c, p.colorIdx + 1);

  // 1. Полные линии — одновременно строки и столбцы, до удаления
  var lines = findFullLines(board);
  var lineCount = lines.rows.length + lines.cols.length;
  var cells = lineCells(lines.rows, lines.cols);

  // 2. Комбо и шкала
  var mult = comboAdvance(lineCount > 0, wasFirstMove);
  surgeOnClear(lineCount, mult);

  // 3. Удаление клеток (с анимацией)
  var now = performance.now();
  for (var i = 0; i < cells.length; i++) {
    var cr = cells[i][0], cc = cells[i][1];
    clearFx.push({ r: cr, c: cc, color: COLORS[board[cr][cc] - 1] || '#fff', t0: now });
    board[cr][cc] = 0;
  }

  // 4. Очки: постановка + mult × очки линий + чистое поле (без множителя)
  var linePts = CFG.LINE_PTS[Math.min(lineCount, 4)];
  var clean = boardEmpty(board);
  var pts = p.size + mult * linePts + (clean ? CFG.CLEAN_BONUS : 0);
  score += pts;

  // Визуальный фидбек
  var fx = boardToPx(r + p.h / 2, c + p.w / 2);
  addFloat(fx.x, fx.y, '+' + pts, lineCount > 0 ? '#ffd43b' : '#b8c4d3');
  if (mult > 1 && lineCount > 0) addFloat(fx.x, fx.y - 26, 'Комбо ×' + mult, '#ff922b');
  if (clean) addFloat(BOARD_X + GRID_W / 2, BOARD_Y + GRID_W / 2, 'Чистое поле +' + CFG.CLEAN_BONUS, '#69db7c');

  // 5. Слот пустеет; пустая рука → новая тройка
  hand[slot] = null;
  if (hand[0] === null && hand[1] === null && hand[2] === null) dealHand();
  refreshPlaceable();

  // 6. Контроль fail state (INV-G2)
  checkGameOver();
  updateHUD();
}

/* Кристальная бомба: очищает 3×3 вокруг клетки. Не ход: комбо не двигается. */
function dropBomb(r, c) {
  if (!bombReady || gameOver) return;
  var removed = 0;
  var now = performance.now();
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      var tr = r + dr, tc = c + dc;
      if (tr < 0 || tc < 0 || tr >= N || tc >= N) continue;   // клип границами поля
      if (board[tr][tc] !== 0) {
        clearFx.push({ r: tr, c: tc, color: COLORS[board[tr][tc] - 1] || '#fff', t0: now });
        board[tr][tc] = 0;
        removed++;
      }
    }
  }
  var pts = CFG.BOMB_BASE_PTS + removed;         // 40 + 1/клетку, не умножается
  var clean = boardEmpty(board);
  if (clean) pts += CFG.CLEAN_BONUS;
  score += pts;

  var fx = boardToPx(r + 0.5, c + 0.5);
  ringFx.push({ x: fx.x, y: fx.y, t0: now });
  addFloat(fx.x, fx.y, '+' + pts, '#67e8f9');

  bombReady = false;
  surge.charge = 0;                              // шкала сбрасывается (11 §5.2)
  refreshPlaceable();
  checkGameOver();
  updateHUD();
}

/* ===================== GAME OVER И РЕСТАРТ (11 §4.1) ====================== */

function checkGameOver() {
  if (bombReady) return;   // бомба ставится всегда — мёртвого состояния нет
  for (var i = 0; i < 3; i++) if (handPlaceable[i]) return;
  gameOver = true;
  var isRecord = score > startBest;
  if (score > best) {
    best = score;
    try { localStorage.setItem(CFG.STORAGE_BEST, String(best)); } catch (e) { /* приватный режим */ }
  }
  // Пауза, чтобы анимация последней очистки доиграла. Фиксируем значения
  // сейчас: к моменту срабатывания глобалы мог сбросить рестарт.
  var finalScore = score, finalBest = best;
  overTimer = setTimeout(function () {
    overTimer = null;
    document.getElementById('overScore').textContent = finalScore;
    document.getElementById('overBest').textContent = finalBest;
    document.getElementById('newRecord').classList.toggle('hidden', !isRecord);
    document.getElementById('overlay').classList.remove('hidden');
  }, 450);
}

function newGame() {
  if (overTimer) { clearTimeout(overTimer); overTimer = null; }  // рестарт в окне паузы
  board = newBoard();
  score = 0;
  combo.chain = 0;
  combo.graceArmed = false;
  surge.charge = 0;
  bombReady = false;
  gameOver = false;
  clearFx = [];
  floatFx = [];
  ringFx = [];
  drag = null;
  startBest = best;
  rng = mulberry32((Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0);  // сид партии
  dealHand();
  document.getElementById('overlay').classList.add('hidden');
  updateHUD();
}

/* ============================== HUD (DOM) ================================= */

function updateHUD() {
  // Рекорд фиксируем сразу при превышении, а не только на game over —
  // иначе высокий счёт теряется, если игрок закрыл вкладку не проиграв.
  if (score > best) {
    best = score;
    try { localStorage.setItem(CFG.STORAGE_BEST, String(best)); } catch (e) { /* приватный режим */ }
  }
  document.getElementById('scoreEl').textContent = score;
  document.getElementById('bestEl').textContent = Math.max(best, score);
  var comboEl = document.getElementById('comboEl');
  if (combo.chain >= 2) {
    comboEl.textContent = 'Комбо ×' + multFor(combo.chain) + ' · серия ' + combo.chain;
    comboEl.classList.add('active');
  } else if (combo.chain === 1) {
    comboEl.textContent = 'Серия начата…';
    comboEl.classList.remove('active');
  } else {
    comboEl.textContent = 'Комбо —';
    comboEl.classList.remove('active');
  }
  var pct = Math.round(surge.charge / CFG.SURGE_MAX * 100);
  document.getElementById('surgeFill').style.width = pct + '%';
  document.getElementById('surgePct').textContent = pct + '%';
  document.getElementById('surgeWrap').classList.toggle('ready', bombReady);
}

var toastTimer = null;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2000);
}

function addFloat(x, y, text, color) {
  floatFx.push({ x: x, y: y, text: text, color: color, t0: performance.now() });
}

/* ============================ РЕНДЕР (Canvas) ============================= */

var cv = document.getElementById('game');
var ctx = cv.getContext('2d');
var DPR = Math.min(window.devicePixelRatio || 1, 2);
cv.width = W * DPR;
cv.height = H * DPR;
cv.style.width = W + 'px';
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

function boardToPx(r, c) {
  return { x: BOARD_X + c * CFG.CELL, y: BOARD_Y + r * CFG.CELL };
}

function rr(x, y, w, h, rad) {
  rad = Math.min(rad, w / 2, h / 2);   // arcTo ломается при радиусе > половины стороны
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawCell(x, y, size, color, alpha) {
  var rad = Math.max(2, size * 0.13);   // скругление пропорционально размеру клетки
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.fillStyle = color;
  rr(x + 1.5, y + 1.5, size - 3, size - 3, rad);
  ctx.fill();
  // блик сверху
  ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.28;
  ctx.fillStyle = '#ffffff';
  rr(x + 4, y + 4, size - 8, (size - 8) * 0.32, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawBoard() {
  // подложка поля
  ctx.fillStyle = '#0d131c';
  rr(BOARD_X - 6, BOARD_Y - 6, GRID_W + 12, GRID_W + 12, 12);
  ctx.fill();
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      var p = boardToPx(r, c);
      ctx.fillStyle = '#1a2230';
      rr(p.x + 1.5, p.y + 1.5, CFG.CELL - 3, CFG.CELL - 3, 6);
      ctx.fill();
      if (board[r][c] !== 0) {
        drawCell(p.x, p.y, CFG.CELL, COLORS[board[r][c] - 1]);
      }
    }
  }
}

/* Подсветка линий, которые соберутся этим ходом (03 §3: зелёное свечение). */
function drawGhost() {
  if (!drag || !drag.ghost) return;
  var g = drag.ghost, i, p;

  if (drag.kind === 'bomb') {
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var rrr = g.r + dr, ccc = g.c + dc;
        if (rrr < 0 || ccc < 0 || rrr >= N || ccc >= N) continue;
        p = boardToPx(rrr, ccc);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#67e8f9';
        rr(p.x + 2, p.y + 2, CFG.CELL - 4, CFG.CELL - 4, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    return;
  }

  var def = DEF[drag.id];
  // линии будущей очистки — свечение всей строки/столбца
  if (g.valid && (g.fullRows.length || g.fullCols.length)) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#69db7c';
    for (i = 0; i < g.fullRows.length; i++) {
      p = boardToPx(g.fullRows[i], 0);
      ctx.fillRect(p.x, p.y, GRID_W, CFG.CELL);
    }
    for (i = 0; i < g.fullCols.length; i++) {
      p = boardToPx(0, g.fullCols[i]);
      ctx.fillRect(p.x, p.y, CFG.CELL, GRID_W);
    }
    ctx.globalAlpha = 1;
  }
  // призрак фигуры: зелёный — валидно, красный — нет
  for (i = 0; i < def.cells.length; i++) {
    p = boardToPx(g.r + def.cells[i][0], g.c + def.cells[i][1]);
    ctx.globalAlpha = g.valid ? 0.45 : 0.38;
    ctx.fillStyle = g.valid ? '#51cf66' : '#ff6b6b';
    rr(p.x + 2, p.y + 2, CFG.CELL - 4, CFG.CELL - 4, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawDock() {
  var i, s, p;
  for (i = 0; i < 3; i++) {
    s = slotRect(i);
    ctx.fillStyle = '#141a24';
    rr(s.x, s.y, s.w, s.h, 10);
    ctx.fill();
    var id = hand[i];
    if (id === null || (drag && drag.kind === 'piece' && drag.slot === i)) continue;
    var def = DEF[id];
    var ds = CFG.DOCK_CELL;
    var ox = s.x + (s.w - def.w * ds) / 2;
    var oy = s.y + (s.h - def.h * ds) / 2;
    var alpha = handPlaceable[i] ? 1 : 0.28;   // не помещается нигде → приглушена
    for (var k = 0; k < def.cells.length; k++) {
      drawCell(ox + def.cells[k][1] * ds, oy + def.cells[k][0] * ds, ds, COLORS[def.colorIdx], alpha);
    }
  }
  // Гнездо кристальной бомбы
  s = slotRect(3);
  ctx.fillStyle = '#10202a';
  rr(s.x, s.y, s.w, s.h, 10);
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = bombReady ? '#67e8f9' : '#26374a';
  ctx.lineWidth = 1.5;
  rr(s.x + 2, s.y + 2, s.w - 4, s.h - 4, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  if (bombReady && !(drag && drag.kind === 'bomb')) {
    var pulse = 1 + 0.08 * Math.sin(performance.now() / 220);
    ctx.font = Math.round(34 * pulse) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💎', s.x + s.w / 2, s.y + s.h / 2 - 8);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#67e8f9';
    ctx.fillText('бомба 3×3', s.x + s.w / 2, s.y + s.h - 16);
  } else if (!bombReady) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#3d5065';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('заполни', s.x + s.w / 2, s.y + s.h / 2 - 8);
    ctx.fillText('«Прилив»', s.x + s.w / 2, s.y + s.h / 2 + 8);
  }
}

function drawDragPiece() {
  if (!drag) return;
  var cx = drag.px, cy = drag.py - drag.lift;
  if (drag.kind === 'bomb') {
    ctx.font = '40px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💎', cx, cy);
    return;
  }
  var def = DEF[drag.id];
  var ox = cx - def.w * CFG.CELL / 2;
  var oy = cy - def.h * CFG.CELL / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  for (var k = 0; k < def.cells.length; k++) {
    drawCell(ox + def.cells[k][1] * CFG.CELL, oy + def.cells[k][0] * CFG.CELL, CFG.CELL, COLORS[def.colorIdx], 0.92);
  }
  ctx.restore();
}

function drawFx(now) {
  var i, t, p;
  // исчезающие клетки
  for (i = clearFx.length - 1; i >= 0; i--) {
    t = (now - clearFx[i].t0) / CFG.CLEAR_ANIM_MS;
    if (t >= 1) { clearFx.splice(i, 1); continue; }
    p = boardToPx(clearFx[i].r, clearFx[i].c);
    var size = CFG.CELL * (1 - t);
    var off = (CFG.CELL - size) / 2;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = clearFx[i].color;
    rr(p.x + off + 1, p.y + off + 1, Math.max(size - 2, 1), Math.max(size - 2, 1), 5);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // кольцо взрыва бомбы
  for (i = ringFx.length - 1; i >= 0; i--) {
    t = (now - ringFx[i].t0) / 500;
    if (t >= 1) { ringFx.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(ringFx[i].x, ringFx[i].y, 10 + t * CFG.CELL * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // всплывающие очки
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (i = floatFx.length - 1; i >= 0; i--) {
    t = (now - floatFx[i].t0) / CFG.FLOAT_ANIM_MS;
    if (t >= 1) { floatFx.splice(i, 1); continue; }
    ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
    ctx.font = 'bold 17px sans-serif';
    ctx.fillStyle = floatFx[i].color;
    ctx.fillText(floatFx[i].text, floatFx[i].x, floatFx[i].y - t * 30);
    ctx.globalAlpha = 1;
  }
}

function frame(now) {
  ctx.clearRect(0, 0, W, H);
  drawBoard();
  drawGhost();
  drawDock();
  drawFx(now || performance.now());
  drawDragPiece();
  requestAnimationFrame(frame);
}

/* ====================== ВВОД: МЫШЬ + ТАЧ (Pointer Events) ================= */

function toLogical(e) {
  var rect = cv.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top) * (H / rect.height)
  };
}

/* Снап: округление верхнего левого угла поднятой фигуры к ближайшей клетке. */
function computeGhost() {
  if (!drag) return null;
  var cx = drag.px, cy = drag.py - drag.lift;

  if (drag.kind === 'bomb') {
    var bc = Math.floor((cx - BOARD_X) / CFG.CELL);
    var br = Math.floor((cy - BOARD_Y) / CFG.CELL);
    if (br < 0 || bc < 0 || br >= N || bc >= N) return null;
    return { r: br, c: bc, valid: true, fullRows: [], fullCols: [] };
  }

  var def = DEF[drag.id];
  var ox = cx - def.w * CFG.CELL / 2;
  var oy = cy - def.h * CFG.CELL / 2;
  var c = Math.round((ox - BOARD_X) / CFG.CELL);
  var r = Math.round((oy - BOARD_Y) / CFG.CELL);
  if (r < 0 || c < 0 || r > N - def.h || c > N - def.w) return null;
  var valid = canPlace(board, def, r, c);
  var fullRows = [], fullCols = [];
  if (valid) {
    var sim = cloneBoard(board);
    stampPiece(sim, def, r, c, 1);
    var lines = findFullLines(sim);
    fullRows = lines.rows;
    fullCols = lines.cols;
  }
  return { r: r, c: c, valid: valid, fullRows: fullRows, fullCols: fullCols };
}

cv.addEventListener('pointerdown', function (e) {
  if (gameOver || drag) return;   // drag уже идёт (мультитач/быстрый второй клик) — игнор
  e.preventDefault();
  var pt = toLogical(e);
  var lift = e.pointerType === 'touch' ? CFG.LIFT_TOUCH : CFG.LIFT_MOUSE;
  for (var i = 0; i < 4; i++) {
    var s = slotRect(i);
    if (pt.x < s.x || pt.x > s.x + s.w || pt.y < s.y || pt.y > s.y + s.h) continue;
    if (i < 3) {
      if (hand[i] === null) return;
      drag = { kind: 'piece', slot: i, id: hand[i], px: pt.x, py: pt.y, lift: lift, ghost: null, pointerId: e.pointerId };
    } else {
      if (!bombReady) return;
      drag = { kind: 'bomb', slot: 3, id: null, px: pt.x, py: pt.y, lift: lift, ghost: null, pointerId: e.pointerId };
    }
    drag.ghost = computeGhost();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    return;
  }
});

cv.addEventListener('pointermove', function (e) {
  if (!drag || e.pointerId !== drag.pointerId) return;   // чужой указатель — игнор
  e.preventDefault();
  var pt = toLogical(e);
  drag.px = pt.x;
  drag.py = pt.y;
  drag.ghost = computeGhost();
});

function endDrag(commit) {
  if (!drag) return;
  var g = drag.ghost;
  var kind = drag.kind, slot = drag.slot;
  drag = null;   // сбрасываем ДО мутаций состояния (события могут прийти повторно)
  if (!commit || !g) return;               // отпустили вне поля → возврат в док без штрафа
  if (kind === 'piece' && g.valid) placePieceFromSlot(slot, g.r, g.c);
  else if (kind === 'bomb') dropBomb(g.r, g.c);
}

cv.addEventListener('pointerup', function (e) {
  if (drag && e.pointerId !== drag.pointerId) return;   // чужой указатель — игнор
  e.preventDefault();
  endDrag(true);
});
cv.addEventListener('pointercancel', function (e) {
  if (drag && e.pointerId !== drag.pointerId) return;
  endDrag(false);
});

/* Фолбэк на случай отказа setPointerCapture: отпускание вне канваса или потеря
 * фокуса окна не должны оставлять drag «прилипшим» к курсору. Обычный commit
 * успевает раньше (pointerup на канвасе обрабатывается до всплытия к window). */
window.addEventListener('pointerup', function (e) {
  if (drag && e.pointerId === drag.pointerId) endDrag(false);
});
window.addEventListener('blur', function () { endDrag(false); });

/* ============================== ЗАПУСК ==================================== */

document.getElementById('restartBtn').addEventListener('click', newGame);
document.getElementById('againBtn').addEventListener('click', newGame);

try {
  best = parseInt(localStorage.getItem(CFG.STORAGE_BEST), 10) || 0;
} catch (e) { best = 0; }

newGame();
requestAnimationFrame(frame);
