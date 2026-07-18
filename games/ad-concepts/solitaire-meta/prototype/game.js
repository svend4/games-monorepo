/* =====================================================================
 * Orchard Peaks — играбельный прототип (Проход А ядро + Проход Б слои)
 * =====================================================================
 * ПРОХОД А (ядро, СОХРАНЕНО без переписывания core loop): TriPeaks по
 * 03-core-gameplay.md пп. 3.2–3.3 — расклад 3/6/9/10, вскрытие по графу
 * перекрытий, ход ±1 ранг от карты сброса с зацикливанием A↔K, серия с
 * растущим множителем, карты урожая (🍎), победа/поражение/рестарт.
 * Генератор и раскладка не тронуты — только вокруг них добавлены слои.
 *
 * ПРОХОД Б (эти слои поверх ядра), см. economy.js + meta.js:
 *  - ВАЛЮТЫ (05 §5.1–5.2): монеты и урожай. Взнос E(n) за старт раздачи,
 *    выигрыш W(n)=M(n)·E(n) + бонус за сток; карты 🍎 дают урожай (не монеты).
 *  - САД/ЗАКАЗЫ/ЗОНЫ (04 §4.2): мета-экран, петля «урожай→заказ→прогресс».
 *  - СТРИК + МИССИИ (04 §4.4).
 *  - БУСТЕРЫ (05 §5.6): джокер, золотое лукошко, ундо — прямо в раздаче.
 *
 * Технологии: чистый DOM + CSS, БЕЗ сборщиков/CDN/TypeScript. Порядок
 * подключения в index.html: economy.js → meta.js → game.js (глобалы
 * window.Store/Economy/Meta уже готовы к вызовам отсюда).
 * ===================================================================== */

'use strict';

/* =====================  КОНФИГ ЯДРА (Проход А)  ===================== */
/* Экономические номиналы (взносы, выигрыши, цены бустеров) вынесены в
 * economy.js (ECON) по главе 05. Здесь — только константы core-геймплея. */

const CFG = {
  STOCK_SIZE: 20,            // сток 18–24 по 03-core-gameplay.md п. 3.2
  HARVEST_COUNT: 8,          // карт урожая на уровне (полоса главы 1, п. 11.7)
  MIN_START_MOVES: 2,        // минимум ходов в нижнем ряду на старте (I3 с запасом)
  GEN_DEALS: 30,             // попыток генерации расклада
  GEN_PLAYOUTS: 40,          // случайных плейаутов на расклад (оценка живости)
  GEN_MIN_WIN_SHARE: 0.10,   // принять расклад: ≥10% случайных линий выигрышные
  SCORE_BASE: 100,           // очки за карту (× множитель серии)
  STREAK_STEP: 0.1,          // +0.1 к множителю за карту серии (п. 3.2)
  STREAK_MAX: 3.0,           // кап множителя ×3 (п. 3.2)
  CHAIN_MISSION: 5,          // длина серии для миссии «серия из 5 карт» (04 §4.4)
  IDLE_HINT_MS: 12000,       // автоподсказка через 12 с бездействия (п. 3.3)
};

/* Рекорд/статистика — legacy-ключи Прохода А (совместимость сейва).
   Монеты и урожай теперь ведёт Economy (economy.js), не эти ключи. */
const LS = {
  best: 'orchardPeaks.bestScore',
  wins: 'orchardPeaks.wins',
  games: 'orchardPeaks.games',
};

/* Русские индексы карт: Т(уз), В(алет), Д(ама), К(ороль). Ранги 1..13. */
const RANK_LABELS = ['', 'Т', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К'];
const SUITS = [
  { sym: '♠', red: false },
  { sym: '♥', red: true },
  { sym: '♣', red: false },
  { sym: '♦', red: true },
];

/* =====================  РАСКЛАДКА «3 ПИКА» (ядро)  ===================== */

function buildLayout() {
  const rowCols = [
    [1.5, 4.5, 7.5],                                    // ряд 0 — вершины пиков
    [1, 2, 4, 5, 7, 8],                                 // ряд 1
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],      // ряд 2
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],                     // ряд 3 — нижний, открытый
  ];
  const slots = [];
  rowCols.forEach((cols, row) => {
    cols.forEach((col) => {
      slots.push({ id: slots.length, row, col, coveredBy: [] });
    });
  });
  for (const s of slots) {
    for (const t of slots) {
      if (t.row === s.row + 1 && Math.abs(t.col - s.col) === 0.5) {
        s.coveredBy.push(t.id);
      }
    }
  }
  return slots;
}

const SLOTS = buildLayout();
const TABLE_SIZE = SLOTS.length; // 28

function peakOf(slot) {
  return slot.col < 3 ? 0 : slot.col < 6 ? 1 : 2;
}

/* =====================  УТИЛИТЫ (ядро)  ===================== */

const randInt = (n) => Math.floor(Math.random() * n);
const randRank = () => 1 + randInt(13);
const randSuit = () => randInt(SUITS.length);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** ±1 ранг с зацикливанием A↔K (03-core-gameplay.md п. 3.2). */
function isAdjacent(a, b) {
  const d = (a - b + 13) % 13;
  return d === 1 || d === 12;
}

/** Множитель серии: 1-я карта ×1, далее +0.1/карта, кап ×3 (п. 3.2). */
function multiplierFor(chain) {
  if (chain <= 1) return 1.0;
  return Math.min(CFG.STREAK_MAX, 1.0 + CFG.STREAK_STEP * (chain - 1));
}

function lsGet(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : JSON.parse(v);
  } catch (e) {
    return dflt;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* приватный режим и т.п. — играем без сохранения */ }
}

/* =====================  ГЕНЕРАТОР РАСКЛАДА (ядро, не тронут)  ===================== */

function randomDeal() {
  const tableRanks = [];
  const tableSuits = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    tableRanks.push(randRank());
    tableSuits.push(randSuit());
  }
  const stockRanks = [];
  const stockSuits = [];
  for (let i = 0; i < CFG.STOCK_SIZE; i++) {
    stockRanks.push(randRank());
    stockSuits.push(randSuit());
  }
  return {
    tableRanks, tableSuits, stockRanks, stockSuits,
    startWaste: randRank(),
    startWasteSuit: randSuit(),
    harvest: new Set(),
  };
}

function ensureFirstMoves(deal) {
  const bottom = SLOTS.filter((s) => s.row === 3);
  const countMoves = () =>
    bottom.filter((s) => isAdjacent(deal.tableRanks[s.id], deal.startWaste)).length;

  let guard = 0;
  while (countMoves() < CFG.MIN_START_MOVES && guard++ < 20) {
    const nonMoving = shuffle(bottom.filter((s) => !isAdjacent(deal.tableRanks[s.id], deal.startWaste)));
    if (nonMoving.length === 0) break;
    const target = nonMoving[0];
    const donors = shuffle(SLOTS.filter(
      (s) => s.row < 3 && isAdjacent(deal.tableRanks[s.id], deal.startWaste)
    ));
    if (donors.length > 0) {
      const d = donors[0];
      [deal.tableRanks[target.id], deal.tableRanks[d.id]] =
        [deal.tableRanks[d.id], deal.tableRanks[target.id]];
      [deal.tableSuits[target.id], deal.tableSuits[d.id]] =
        [deal.tableSuits[d.id], deal.tableSuits[target.id]];
    } else {
      const dir = Math.random() < 0.5 ? 1 : -1;
      deal.tableRanks[target.id] = ((deal.startWaste - 1 + dir + 13) % 13) + 1;
    }
  }
}

function playoutClearRatio(deal) {
  const removed = new Set();
  let waste = deal.startWaste;
  let stockIdx = 0;
  while (removed.size < TABLE_SIZE) {
    const moves = [];
    for (const s of SLOTS) {
      if (removed.has(s.id)) continue;
      if (!s.coveredBy.every((c) => removed.has(c))) continue;
      if (isAdjacent(deal.tableRanks[s.id], waste)) moves.push(s.id);
    }
    if (moves.length > 0) {
      const id = moves[randInt(moves.length)];
      removed.add(id);
      waste = deal.tableRanks[id];
    } else if (stockIdx < deal.stockRanks.length) {
      waste = deal.stockRanks[stockIdx];
      stockIdx++;
    } else {
      break;
    }
  }
  return removed.size / TABLE_SIZE;
}

function dealQuality(deal) {
  let wins = 0;
  let bestClear = 0;
  for (let k = 0; k < CFG.GEN_PLAYOUTS; k++) {
    const r = playoutClearRatio(deal);
    bestClear = Math.max(bestClear, r);
    if (r >= 1) wins++;
  }
  return { winShare: wins / CFG.GEN_PLAYOUTS, bestClear };
}

function assignHarvest(deal) {
  let marks = new Set();
  for (let attempt = 0; attempt < 30; attempt++) {
    marks = new Set();
    const rowIds = (r) => SLOTS.filter((s) => s.row === r).map((s) => s.id);
    const shallowPool = shuffle(rowIds(3).concat(rowIds(2)));   // глубина 0–1
    const midPool = shuffle(rowIds(1).concat(rowIds(2)));       // середина
    const peakPool = shuffle(rowIds(0));                        // вершины

    for (let i = 0; i < 4 && i < shallowPool.length; i++) marks.add(shallowPool[i]);
    if (Math.random() < 0.5) marks.add(peakPool[0]);            // Q2: ≤ 1 на вершинах
    for (const id of midPool) {
      if (marks.size >= CFG.HARVEST_COUNT) break;
      marks.add(id);
    }

    const perPeak = [0, 0, 0];
    for (const id of marks) perPeak[peakOf(SLOTS[id])]++;
    if (Math.max(...perPeak) - Math.min(...perPeak) <= 2) break; // Q3 выполнена
  }
  deal.harvest = marks;
}

function generateLevel() {
  let bestDeal = null;
  let bestScoreQ = -1;
  for (let i = 0; i < CFG.GEN_DEALS; i++) {
    const deal = randomDeal();
    ensureFirstMoves(deal);
    const q = dealQuality(deal);
    const scoreQ = q.winShare * 100 + q.bestClear;
    if (scoreQ > bestScoreQ) {
      bestScoreQ = scoreQ;
      bestDeal = deal;
    }
    if (q.winShare >= CFG.GEN_MIN_WIN_SHARE) break;
  }
  assignHarvest(bestDeal);
  return bestDeal;
}

/* =====================  СОСТОЯНИЕ ИГРЫ  ===================== */

const Economy = window.Economy;
const Meta = window.Meta;
const ECFG = Economy.ECON;   // конфиг экономики (глобальный `var ECON` живёт в economy.js — не переобъявляем)

let G = null;               // текущая партия
let cardEls = [];           // DOM-элементы карт стола по id слота
let bestScore = lsGet(LS.best, 0);
let winsCount = lsGet(LS.wins, 0);
let gamesCount = lsGet(LS.games, 0);
let idleTimer = null;
let hintEl = null;
let lastFinishWin = false;    // был ли последний финал победой (для INT1, 06 §6.2/§6.3)

const $ = (id) => document.getElementById(id);

function stockLeft() {
  return G.deal.stockRanks.length - G.stockIdx;
}

function isOpen(slotId) {
  return SLOTS[slotId].coveredBy.every((c) => G.removed.has(c));
}

function isPlayable(slotId) {
  return !G.removed.has(slotId)
    && isOpen(slotId)
    && isAdjacent(G.deal.tableRanks[slotId], G.waste);
}

function firstPlayable() {
  for (const s of SLOTS) {
    if (isPlayable(s.id)) return s.id;
  }
  return null;
}

function anyMoves() {
  return firstPlayable() !== null;
}

/* =====================  НОВАЯ ПАРТИЯ  ===================== */

function newGame() {
  clearHint();
  hideOverlay();
  disarmJoker();

  // Взнос за старт раздачи (sink монет, 05 §5.2). Не хватает — раздача бесплатна
  // (в Проходе Б нет rewarded/IAP; жёсткой стены не ставим, дефицит показываем).
  Economy.resetEarnedThisLevel();
  const level = Economy.getLevel();
  const cost = Economy.entryCost(level);
  const entryPaid = Economy.spendCoins(cost, 'entry') ? cost : 0;

  const deal = generateLevel();
  G = {
    deal,
    removed: new Set(),
    stockIdx: 0,
    waste: deal.startWaste,
    wasteSuit: deal.startWasteSuit,
    chain: 0,
    score: 0,
    harvestGot: 0,
    harvestGained: 0,
    harvestCommitted: false,
    entryLevel: level,
    entryCost: cost,
    entryPaid,
    history: [],
    jokerArmed: false,
    basketActive: false,
    rw1Used: false,     // RW1 «Второй шанс» — 1/уровень (06 §6.2)
    over: false,
  };
  buildTableDom();
  render();
  updateBoosterBar();
  armIdleTimer();
}

/* =====================  DOM СТОЛА (ядро)  ===================== */

function buildTableDom() {
  const peaks = $('peaks');
  peaks.innerHTML = '';
  cardEls = [];
  for (const s of SLOTS) {
    const el = document.createElement('div');
    el.className = 'card down';
    el.style.left = `calc(${s.col} * (var(--card-w) + var(--gap)))`;
    el.style.top = `calc(${s.row} * var(--row-step))`;
    el.style.zIndex = String(s.row + 1);
    el.setAttribute('role', 'button');

    const rank = G.deal.tableRanks[s.id];
    const suit = SUITS[G.deal.tableSuits[s.id]];
    const label = RANK_LABELS[rank];
    if (suit.red) el.classList.add('red-suit');
    el.innerHTML =
      `<div class="face">` +
      `<span class="corner tl">${label}</span>` +
      `<span class="suit-center">${suit.sym}</span>` +
      `<span class="corner br">${label}</span>` +
      `</div>` +
      (G.deal.harvest.has(s.id) ? `<span class="apple-badge">🍎</span>` : '');
    el.addEventListener('click', () => onCardClick(s.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCardClick(s.id);
      }
    });
    peaks.appendChild(el);
    cardEls.push(el);
  }
}

/* =====================  РЕНДЕР  ===================== */

function render() {
  // Стол
  for (const s of SLOTS) {
    const el = cardEls[s.id];
    const removed = G.removed.has(s.id);
    const open = isOpen(s.id);
    el.classList.toggle('removed', removed);
    el.classList.toggle('down', !removed && !open);
    el.classList.toggle('up', !removed && open);
    const normalPlayable = !G.over && !removed && open && isAdjacent(G.deal.tableRanks[s.id], G.waste);
    // В режиме джокера подсвечиваем как «взаимодействуемую» любую открытую карту.
    el.classList.toggle('playable', normalPlayable || (G.jokerArmed && !G.over && !removed && open));

    if (removed) {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');
    } else {
      el.removeAttribute('aria-hidden');
      el.setAttribute('aria-label', open
        ? `Карта ${RANK_LABELS[G.deal.tableRanks[s.id]]}${SUITS[G.deal.tableSuits[s.id]].sym}`
        : 'Закрытая карта');
      el.setAttribute('tabindex', open && !G.over ? '0' : '-1');
    }
  }

  // Колода
  const left = stockLeft();
  $('stock-count').textContent = String(left);
  $('stock-card').classList.toggle('empty', left === 0);

  // Сброс
  const wasteEl = $('waste-card');
  const wl = RANK_LABELS[G.waste];
  const ws = SUITS[G.wasteSuit];
  wasteEl.classList.toggle('red-suit', ws.red);
  wasteEl.classList.toggle('glow', G.chain >= 2);
  wasteEl.innerHTML =
    `<div class="face">` +
    `<span class="corner tl">${wl}</span>` +
    `<span class="suit-center">${ws.sym}</span>` +
    `<span class="corner br">${wl}</span>` +
    `</div>`;

  // Прогресс очистки стола
  $('progress-fill').style.width = `${(G.removed.size / TABLE_SIZE) * 100}%`;

  syncHud();
}

/** Обновление всех числовых полей HUD (монеты/урожай/уровень + партия).
    Вызывается из render() и как Game.syncHud() после закрытия мета-экрана. */
function syncHud() {
  $('hud-coins').textContent = Economy.fmt(Economy.getCoins());
  $('hud-harvest-bank').textContent = Economy.fmt(Economy.getHarvest());
  $('hud-level').textContent = String(Economy.getLevel());
  if (G) {
    $('hud-score').textContent = String(G.score);
    $('hud-chain').textContent = G.chain > 0
      ? `${G.chain} (×${multiplierFor(G.chain).toFixed(1)})`
      : '—';
    $('hud-harvest').textContent = `${G.harvestGot}/${G.deal.harvest.size}`;
  }
  updateBoosterBar();   // держим счётчики бустеров/ундо свежими (в т.ч. после лавки)
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

/* =====================  ХОДЫ  ===================== */

function onCardClick(slotId) {
  if (!G || G.over) return;
  if (G.removed.has(slotId)) return;

  const open = isOpen(slotId);
  if (!open) {
    if (G.jokerArmed) gToast('Джокер работает только по открытой карте');
    shake(cardEls[slotId]);
    armIdleTimer();
    return;
  }

  const rank = G.deal.tableRanks[slotId];
  const adjacent = isAdjacent(rank, G.waste);

  if (G.jokerArmed) {
    if (adjacent) {
      // Соседняя карта — обычный ход, джокер сохраняем.
      disarmJoker();
      removeCard(slotId, false);
    } else {
      // Не соседняя — тратим джокер как «дикую карту».
      if (!Economy.consumeBooster('joker', 'in')) { disarmJoker(); return; }
      disarmJoker();
      gToast('🃏 Джокер применён');
      removeCard(slotId, true);
    }
    return;
  }

  if (!adjacent) {
    shake(cardEls[slotId]);
    armIdleTimer();
    return;
  }
  removeCard(slotId, false);
}

/** Уборка карты со стола (общий путь обычного хода и джокера). */
function removeCard(slotId, viaJoker) {
  pushHistory(!!viaJoker);
  G.removed.add(slotId);
  G.chain++;
  const mult = multiplierFor(G.chain);
  G.score += Math.round(CFG.SCORE_BASE * mult);

  if (G.deal.harvest.has(slotId)) {
    G.harvestGot++;                         // урожай копится, банкуется в конце уровня
    Meta.track('harvest', 1);               // прогресс дневной миссии «собрать урожай»
  }
  if (G.chain === CFG.CHAIN_MISSION) Meta.track('chain5', 1);

  G.waste = G.deal.tableRanks[slotId];
  G.wasteSuit = G.deal.tableSuits[slotId];

  if (G.removed.size === TABLE_SIZE) { finishWin(); return; }
  if (stockLeft() === 0 && !anyMoves()) { finishLose(); return; }
  render();
  armIdleTimer();
}

function onStockClick() {
  if (!G || G.over) return;
  if (G.jokerArmed) disarmJoker();          // тап по колоде отменяет режим джокера
  if (stockLeft() === 0) {
    shake($('stock-card'));
    armIdleTimer();
    return;
  }
  pushHistory(false);
  G.waste = G.deal.stockRanks[G.stockIdx];
  G.wasteSuit = G.deal.stockSuits[G.stockIdx];
  G.stockIdx++;
  G.chain = 0;

  if (stockLeft() === 0 && !anyMoves()) { finishLose(); return; }
  render();
  armIdleTimer();
}

/* =====================  БУСТЕРЫ В РАЗДАЧЕ (05 §5.6)  ===================== */

function pushHistory(jokerRefund) {
  G.history.push({
    removed: Array.from(G.removed),
    stockIdx: G.stockIdx,
    waste: G.waste, wasteSuit: G.wasteSuit,
    chain: G.chain, score: G.score,
    harvestGot: G.harvestGot,
    jokerRefund: !!jokerRefund,
  });
  if (G.history.length > 80) G.history.shift();
}

/** Отмена хода. Бесплатные ундо (инвентарь) → затем 150 монет (05 §5.2). */
function doUndo() {
  if (!G || G.over) return;
  if (G.history.length === 0) { gToast('Отменять нечего'); return; }
  const kind = Economy.useUndo();
  if (!kind) { gToast(`Нет монет на отмену (нужно ${ECFG.UNDO_PRICE})`); return; }

  const snap = G.history.pop();
  G.removed = new Set(snap.removed);
  G.stockIdx = snap.stockIdx;
  G.waste = snap.waste;
  G.wasteSuit = snap.wasteSuit;
  G.chain = snap.chain;
  G.score = snap.score;
  G.harvestGot = snap.harvestGot;
  if (snap.jokerRefund) Economy.addBooster('joker', 1, 'undo_refund');  // вернуть потраченный джокер

  gToast(kind === 'free' ? 'Ход отменён (бесплатно)' : `Ход отменён (−${ECFG.UNDO_PRICE} 💰)`);
  render();
  updateBoosterBar();
  armIdleTimer();
}

function armJoker() {
  if (!G || G.over) return;
  if (Economy.getBooster('joker') <= 0) { openGarden('shop'); return; }
  G.jokerArmed = true;
  document.body.classList.add('joker-mode');
  gToast('🃏 Выберите любую открытую карту');
  render();
  updateBoosterBar();
}

function disarmJoker() {
  if (!G) return;
  if (G.jokerArmed) {
    G.jokerArmed = false;
    document.body.classList.remove('joker-mode');
    updateBoosterBar();
  }
}

function toggleJoker() {
  if (!G || G.over) return;
  if (G.jokerArmed) { disarmJoker(); render(); }
  else armJoker();
}

function activateBasket() {
  if (!G || G.over) return;
  if (G.basketActive) { gToast('Лукошко уже включено'); return; }
  if (Economy.getBooster('basket') <= 0) { openGarden('shop'); return; }
  if (!Economy.consumeBooster('basket', 'in')) return;
  G.basketActive = true;
  gToast(`🧺 Урожай этой раздачи ×${ECFG.BASKET_MULT}`);
  updateBoosterBar();
}

function updateBoosterBar() {
  const free = Economy.getFreeUndos();
  const undoBtn = $('bst-undo');
  if (undoBtn) {
    undoBtn.textContent = free > 0 ? `↩ Отмена (${free})` : `↩ Отмена (💰${ECFG.UNDO_PRICE})`;
    undoBtn.disabled = !G || G.over || G.history.length === 0;
  }
  const jokerBtn = $('bst-joker');
  if (jokerBtn) {
    const jn = Economy.getBooster('joker');
    jokerBtn.textContent = `🃏 Джокер (${jn})`;
    jokerBtn.classList.toggle('armed', !!(G && G.jokerArmed));
    jokerBtn.disabled = !G || G.over;
  }
  const basketBtn = $('bst-basket');
  if (basketBtn) {
    const bn = Economy.getBooster('basket');
    basketBtn.textContent = G && G.basketActive ? '🧺 ×2 активно' : `🧺 Лукошко (${bn})`;
    basketBtn.classList.toggle('armed', !!(G && G.basketActive));
    basketBtn.disabled = !G || G.over || (G && G.basketActive);
  }
}

/* =====================  ФИНАЛЫ  ===================== */

function commitHarvest() {
  if (G.harvestCommitted) return 0;
  const mult = G.basketActive ? ECFG.BASKET_MULT : 1;
  // Проход В: подписка «Клуб садовода» даёт +50% урожая (06 §6.5). Заглушка
  // Monetize может отсутствовать (Проходы А+Б) — тогда множитель 1.
  const clubMult = (window.Monetize && Monetize.harvestMultiplier) ? Monetize.harvestMultiplier() : 1;
  const gained = Math.round(G.harvestGot * ECFG.HARVEST_PER_CARD * mult * clubMult);
  if (gained > 0) Economy.addHarvest(gained, G.basketActive ? 'basket' : 'cards');
  G.harvestCommitted = true;
  G.harvestGained = gained;
  return gained;
}

function finishWin() {
  G.over = true;
  lastFinishWin = true;                          // для INT1 на возврате в сад (06 §6.2)
  clearHint();
  disarmJoker();

  const n = G.entryLevel;                       // уровень только что сыгранной раздачи
  const stockCards = stockLeft();
  const stockB = Economy.stockBonus(stockCards);
  const win = Economy.winReward(n);

  Economy.addCoins(win, 'win', true);
  if (stockB > 0) Economy.addCoins(stockB, 'stock_bonus', true);
  const gained = commitHarvest();
  Economy.nextLevel();                          // прогресс к n+1
  Meta.track('wins', 1);                        // недельная миссия «выиграй N уровней»

  // Проход В: копилка копит 5% выигрышей; счётчик уровней для правил INT (06 §6.3).
  if (window.Monetize) {
    Monetize.onCoinsWon(win + stockB);
    Monetize.onLevelFinished();
  }

  winsCount++; gamesCount++;
  lsSet(LS.wins, winsCount);
  lsSet(LS.games, gamesCount);
  const isRecord = G.score > bestScore;
  if (isRecord) { bestScore = G.score; lsSet(LS.best, bestScore); }

  window.Analytics.track('level_finish', { result: 'win', level: n, coins_won: win + stockB, harvest_earned: gained });

  // Данные экрана победы держим на G, чтобы перерисовать после rewarded «×2».
  G.win = { n: n, stockCards: stockCards, stockB: stockB, win: win, gained: gained,
            doubleBase: win + stockB, rw2Used: false };
  syncHud();
  updateBoosterBar();
  showOverlay(winOverlayHtml());
}

/* HTML экрана победы — вынесен, чтобы перерисовывать после rewarded «×2 награда»
 * (значения net/баланса пересчитываются заново из текущего состояния). */
function winOverlayHtml() {
  const w = G.win;
  const earned = Economy.getEarnedThisLevel();
  const net = earned - G.entryPaid;

  let adCta = '';
  if (window.Monetize) {                         // rewarded не убирается remove-ads/подпиской
    if (!w.rw2Used) {
      adCta += `<button class="btn-ad" data-ov="rw2" type="button">📺 ×2 награда за рекламу <span class="sim-tag">СИМУЛЯЦИЯ</span></button>`;
    } else {
      adCta += `<div class="ad-done">✓ Награда удвоена рекламой (RW2)</div>`;
    }
    if (Monetize.isEventWeekend()) {
      adCta += `<button class="btn-ad" data-ov="rw5" type="button">📺 ×2 жетоны ярмарки <span class="sim-tag">СИМУЛЯЦИЯ</span></button>`;
    }
    if (adCta) adCta = `<div class="ad-cta">${adCta}</div>`;
  }

  return (
    `<div class="emoji">🎉🍎</div>` +
    `<h2>Стол чист!</h2>` +
    `<p>Сад благодарит вас. Уровень ${w.n} пройден.</p>` +
    `<table class="reward">` +
    `<tr><td>Взнос за раздачу</td><td>${G.entryPaid > 0 ? '−' + Economy.fmt(G.entryPaid) : 'бесплатно'}</td></tr>` +
    `<tr><td>Выигрыш W(${w.n})</td><td>+${Economy.fmt(w.win)}</td></tr>` +
    `<tr><td>Бонус колоды: ${w.stockCards} карт</td><td>+${Economy.fmt(w.stockB)}</td></tr>` +
    (w.rw2Used ? `<tr><td>📺 ×2 за рекламу (RW2)</td><td>+${Economy.fmt(w.doubleBase)}</td></tr>` : '') +
    `<tr class="total"><td>Итог монет за уровень</td><td>${net >= 0 ? '+' : ''}${Economy.fmt(net)}</td></tr>` +
    `<tr><td>Урожай: ${G.harvestGot} 🍎${G.basketActive ? ' ×2' : ''}</td><td>+${Economy.fmt(w.gained)} 🍎</td></tr>` +
    `<tr><td>Баланс</td><td>💰 ${Economy.fmt(Economy.getCoins())}</td></tr>` +
    `<tr><td>Урожай в саду</td><td>🍎 ${Economy.fmt(Economy.getHarvest())}</td></tr>` +
    `</table>` +
    adCta +
    metaCtaWin() +
    `<div class="btn-row">` +
    `<button class="btn-main" data-ov="garden" type="button">🌳 В сад</button>` +
    `<button class="btn-main" data-ov="again" type="button">Играть ещё</button>` +
    `</div>`
  );
}

/** Мотиватор петли: пока сад не пройден целиком — зовём продвинуть заказ. */
function metaCtaWin() {
  const st = window.Store.state.garden;
  if (st.completed < Meta.TOTAL_ORDERS) {
    return `<p class="kept">Урожай растёт — загляните в сад, чтобы продвинуть заказ.</p>`;
  }
  return '';
}

function finishLose() {
  G.over = true;
  lastFinishWin = false;                     // INT никогда после поражения (06 §6.3.4)
  clearHint();
  disarmJoker();

  gamesCount++;
  lsSet(LS.games, gamesCount);
  const gained = commitHarvest();            // урожай сохраняется даже при поражении (п. 3.6)
  if (window.Monetize) Monetize.onLevelFinished();

  window.Analytics.track('level_finish', { result: 'lose', level: G.entryLevel, harvest_earned: gained });

  const clearRatio = G.removed.size / TABLE_SIZE;
  G.lose = { pct: Math.round(clearRatio * 100), gained: gained, clearRatio: clearRatio };
  syncHud();
  updateBoosterBar();
  showOverlay(loseOverlayHtml());
}

/* HTML экрана поражения — вынесен для перерисовки после rewarded «Второй шанс». */
function loseOverlayHtml() {
  const L = G.lose;
  // RW1 «Второй шанс» (06 §6.2): rewarded, только если стол ≥ 60% чист и ещё не
  // брали в ЭТОМ уровне (флаг на G, а не на G.lose — 1/уровень даже после добора).
  let adCta = '';
  if (window.Monetize && L.clearRatio >= 0.60 && !G.rw1Used) {
    adCta = `<div class="ad-cta">` +
      `<button class="btn-ad" data-ov="rw1" type="button">📺 Второй шанс: +5 карт в колоду <span class="sim-tag">СИМУЛЯЦИЯ</span></button>` +
      `</div>`;
  }
  return (
    `<div class="emoji">🐶</div>` +
    `<h2>Почти получилось!</h2>` +
    `<p>Стол был чист на ${L.pct}%. Бисквит уверен: в следующий раз выйдет.</p>` +
    (L.gained > 0
      ? `<p class="kept">Урожай сохранён: +${Economy.fmt(L.gained)} 🍎 (уже в саду)</p>`
      : `<p class="kept">Урожай не сгорает — соберите 🍎 в новой раздаче.</p>`) +
    `<p>Баланс: 💰 ${Economy.fmt(Economy.getCoins())} · 🍎 ${Economy.fmt(Economy.getHarvest())}</p>` +
    adCta +
    `<div class="btn-row">` +
    `<button class="btn-main" data-ov="garden" type="button">🌳 В сад</button>` +
    `<button class="btn-main" data-ov="again" type="button">Ещё раз</button>` +
    `</div>`
  );
}

/* =====================  ОВЕРЛЕЙ / МЕТА-ПЕРЕХОДЫ  ===================== */

function showOverlay(html) {
  const overlay = $('overlay');
  overlay.querySelector('.panel').innerHTML = html;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  $('overlay').classList.add('hidden');
}

function openGarden(tab) {
  Meta.open(tab || 'garden');
}

/* Делегированная обработка кнопок оверлея (data-ov). */
function onOverlayClick(ev) {
  const b = ev.target.closest('[data-ov]');
  if (!b) return;
  const act = b.getAttribute('data-ov');
  if (act === 'again') newGame();
  else if (act === 'garden') goGardenFromOverlay();  // возможен INT1 после победы
  else if (act === 'close') hideOverlay();
  else if (act === 'rw2') onRewardedDoubleWin();
  else if (act === 'rw5') onRewardedEventTokens();
  else if (act === 'rw1') onRewardedSecondChance();
  else if (act === 'claim-streak') {
    Meta.claimStreak && Meta.claimStreak();
    hideOverlay();
    syncHud();
  }
}

/* Возврат на карту сада после победы: правила 06 §6.3 решают, показать ли INT1.
 * После поражения (lastFinishWin=false) interstitial не запрашивается вовсе. */
function goGardenFromOverlay() {
  if (lastFinishWin && window.Monetize) {
    Monetize.maybeInterstitial(function () { openGarden('garden'); });
  } else {
    openGarden('garden');
  }
}

/* RW2 «Удвоить награду» (06 §6.2): rewarded на экране победы → ×2 монет уровня. */
function onRewardedDoubleWin() {
  if (!window.Monetize || !G || !G.win || G.win.rw2Used) return;
  Monetize.showRewarded('RW2', {}, function (ok) {
    if (!ok) return;
    Economy.addCoins(G.win.doubleBase, 'rw2_double', true);
    G.win.rw2Used = true;
    syncHud();
    showOverlay(winOverlayHtml());               // перерисовать итог с удвоением
  });
}

/* RW5 «×2 жетоны ярмарки» (06 §6.2): rewarded на победе во время ивента пт–вс. */
function onRewardedEventTokens() {
  if (!window.Monetize) return;
  Monetize.rwEventTokens(function () { syncHud(); showOverlay(winOverlayHtml()); });
}

/* RW1 «Второй шанс» (06 §6.2): rewarded из тупика (стол ≥ 60%) → +5 карт в колоду
 * и продолжение уровня вместо поражения. */
function onRewardedSecondChance() {
  if (!window.Monetize || !G || !G.lose || G.rw1Used) return;
  Monetize.showRewarded('RW1', {}, function (ok) {
    if (!ok) return;
    for (let i = 0; i < 5; i++) {
      G.deal.stockRanks.push(randRank());
      G.deal.stockSuits.push(randSuit());
    }
    G.rw1Used = true;
    G.over = false;
    hideOverlay();
    gToast('Второй шанс! Колода пополнена (+5 карт).');
    render();
    updateBoosterBar();
    armIdleTimer();
  });
}

/* Стрик-модалка на входе (ежедневный ритуал, 04 §4.4). */
function maybeShowStreakModal() {
  const s = Meta.streakStatus();
  if (!s.claimable) return;
  const rw = ECFG.STREAK_REWARDS[Math.max(1, Math.min(7, s.day))] || { coins: 0 };
  const extra = (rw.undo ? ' +1 ундо' : '') + (rw.joker ? ' +джокер 🃏' : '') + (rw.basket ? ' +лукошко 🧺' : '');
  showOverlay(
    `<div class="emoji">🌅</div>` +
    `<h2>Утренняя лейка</h2>` +
    `<p>День ${s.day} подряд. Забирайте награду и продолжайте стрик.</p>` +
    `<p class="kept">Награда: 💰 ${rw.coins}${extra}</p>` +
    `<div class="btn-row">` +
    `<button class="btn-main ghost" data-ov="close" type="button">Позже</button>` +
    `<button class="btn-main" data-streak="1" type="button">Забрать</button>` +
    `</div>`
  );
  // Отдельная привязка кнопки «Забрать» (грант + перерисовка HUD).
  const claimBtn = $('overlay').querySelector('[data-streak]');
  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      if (Meta.claimStreak()) gToast('Стрик засчитан!');
      hideOverlay();
      syncHud();
    });
  }
}

/* =====================  АВТОПОДСКАЗКА (12 с)  ===================== */

function clearHint() {
  if (hintEl) {
    hintEl.classList.remove('hint');
    hintEl = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer() {
  clearHint();
  idleTimer = setTimeout(showIdleHint, CFG.IDLE_HINT_MS);
}

function showIdleHint() {
  if (!G || G.over) return;
  const p = firstPlayable();
  if (p !== null) {
    hintEl = cardEls[p];
  } else if (stockLeft() > 0) {
    hintEl = $('stock-card');
  }
  if (hintEl) hintEl.classList.add('hint');
}

/* =====================  ЛЁГКИЙ ИГРОВОЙ ТОСТ  ===================== */

let gToastTimer = null;
function gToast(msg) {
  const t = $('game-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (gToastTimer) clearTimeout(gToastTimer);
  gToastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

/* =====================  ЗАПУСК  ===================== */

/* Публичный мост для meta.js (возврат из мета-экрана обновляет HUD). */
window.Game = {
  syncHud: syncHud,
  newGame: newGame,
  openGarden: openGarden,
};

document.addEventListener('DOMContentLoaded', () => {
  Meta.init();                                   // мета-экран: делегирование, вкладки
  if (window.Monetize)  Monetize.init();         // Проход В: реклама/IAP-заглушки, полка
  if (window.Dashboard) Dashboard.init();        // Проход В: KPI-дашборд сессии
  Economy.subscribe(syncHud);                    // изменения валют → обновление HUD

  $('btn-restart').addEventListener('click', newGame);
  $('btn-garden').addEventListener('click', () => openGarden('garden'));

  $('stock-card').addEventListener('click', onStockClick);
  $('stock-card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onStockClick();
    }
  });

  $('bst-undo').addEventListener('click', doUndo);
  $('bst-joker').addEventListener('click', toggleJoker);
  $('bst-basket').addEventListener('click', activateBasket);

  $('overlay').addEventListener('click', onOverlayClick);

  newGame();
  maybeShowStreakModal();                         // ежедневный стрик поверх стартовой раздачи
});
