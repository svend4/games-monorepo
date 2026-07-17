/* =====================================================================
 * Orchard Peaks — играбельный прототип ядра (Проход А)
 * =====================================================================
 * Объём: TriPeaks-ядро по 03-core-gameplay.md пп. 3.2–3.3 в упрощении
 * Прохода А — без меты/рекламы/IAP/взносов. Правила: ход ±1 ранг от карты
 * сброса с зацикливанием A↔K, серия ×1 → +0.1/карта → кап ×3, карты
 * урожая (🍎) дают монеты, победа = чистый стол (+бонус за остаток
 * колоды, 25 монет/карта — глава 1), поражение = пустая колода без ходов.
 *
 * Технологии: чистый DOM + CSS, БЕЗ сборщиков, БЕЗ TypeScript.
 * Почему DOM, а не Phaser/CDN и не Canvas:
 *  - карточная игра — это ~30 прямоугольников с текстом; DOM даёт крупный
 *    чёткий текст (ЦА 45+, 07-ux-ui-ftue.md п. 7.4), простые зоны тапа,
 *    CSS-анимации «дыхания» и hover бесплатно;
 *  - нет зависимости от сети (CDN) — index.html открывается с любого
 *    статического сервера и даже с file://;
 *  - в проде по книге (10-production.md) будет TS + Capacitor; для
 *    Прохода А одиночный JS-файл — осознанное упрощение.
 *
 * Генератор — упрощённый по заданию Прохода А: случайный «безколодный»
 * расклад (ранги свободны, 11-algorithms.md п. 11.1) + перекладка, чтобы
 * нижний ряд имел ходы (инвариант I3), + отбор лучшего расклада по
 * случайным плейаутам (дешёвый суррогат beam-солвера из п. 11.4).
 * Урожай размещается оверлеем по упрощённым квотам Q1–Q3 (п. 11.8).
 * ===================================================================== */

'use strict';

/* =====================  КОНФИГ (баланс и размеры)  ===================== */

const CFG = {
  STOCK_SIZE: 20,            // сток 18–24 по 03-core-gameplay.md п. 3.2
  HARVEST_COUNT: 8,          // карт урожая на уровне (полоса главы 1, п. 11.7)
  MIN_START_MOVES: 2,        // минимум ходов в нижнем ряду на старте (I3 с запасом)
  GEN_DEALS: 30,             // попыток генерации расклада
  GEN_PLAYOUTS: 40,          // случайных плейаутов на расклад (оценка живости)
  GEN_MIN_WIN_SHARE: 0.10,   // принять расклад: ≥10% случайных линий выигрышные
                             // (живой игрок играет сильно лучше случайного —
                             //  это даёт дружелюбие ранних уровней, п. 3.5)
  SCORE_BASE: 100,           // очки за карту (× множитель серии)
  COINS_PER_HARVEST: 25,     // монеты за карту урожая (× множитель серии)
  WIN_REWARD: 100,           // монеты за победу
  STOCK_BONUS_PER_CARD: 25,  // бонус за карту остатка колоды: 25 × глава (тут глава 1)
  STREAK_STEP: 0.1,          // +0.1 к множителю за карту серии (п. 3.2)
  STREAK_MAX: 3.0,           // кап множителя ×3 (п. 3.2)
  IDLE_HINT_MS: 12000,       // автоподсказка через 12 с бездействия (п. 3.3)
};

/* Состояние в localStorage — префикс имени игры */
const LS = {
  coins: 'orchardPeaks.coins',
  best: 'orchardPeaks.bestScore',
  wins: 'orchardPeaks.wins',
  games: 'orchardPeaks.games',
};

/* Русские индексы карт: Т(уз), В(алет), Д(ама), К(ороль). Ранги 1..13. */
const RANK_LABELS = ['', 'Т', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К'];
/* Масти декоративны и на правила не влияют (11-algorithms.md п. 11.1);
   различаются формой, не только цветом — требование дальтонизм-доступности. */
const SUITS = [
  { sym: '♠', red: false },
  { sym: '♥', red: true },
  { sym: '♣', red: false },
  { sym: '♦', red: true },
];

/* =====================  РАСКЛАДКА «3 ПИКА»  ===================== */
/* 28 слотов, 4 ряда (3/6/9/10). col — в единицах ширины карты.
   coveredBy — карты ряда ниже (row+1), физически лежащие поверх:
   слот открыт, когда все его накрыватели убраны. */

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

/** Пик/секция слота — для равномерности урожая (Q3). */
function peakOf(slot) {
  return slot.col < 3 ? 0 : slot.col < 6 ? 1 : 2;
}

/* =====================  УТИЛИТЫ  ===================== */

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

/* =====================  ГЕНЕРАТОР РАСКЛАДА  ===================== */

/** Случайная «безколодная» раздача: ранги свободны (п. 11.1). */
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

/** Перекладка: гарантируем ≥ MIN_START_MOVES ходов в нижнем ряду (I3).
    Сначала пытаемся ОБМЕНЯТЬ подходящую карту из верхних рядов с картой
    нижнего ряда; если подходящих нет — переписываем ранг напрямую. */
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

/** Один случайный плейаут: доля очищенного стола (0..1).
    Дешёвый суррогат солвера из п. 11.4 — только для отбора раскладов. */
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

/** Качество расклада: доля выигрышных плейаутов (главный критерий)
    и лучшая доля очистки (тай-брейк для «безнадёжных» партий). */
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

/** Разметка урожая — оверлей слотов, ранги не трогаем (инвариант I5).
    Упрощённые квоты 11.8: Q1 — половина меток на глубине 0–1 (ряды 2–3),
    Q2 — не более одной на вершинах, Q3 — разброс по пикам ≤ 2. */
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

/** Итоговый генератор уровня Прохода А. */
function generateLevel() {
  let bestDeal = null;
  let bestScoreQ = -1;
  for (let i = 0; i < CFG.GEN_DEALS; i++) {
    const deal = randomDeal();
    ensureFirstMoves(deal);
    const q = dealQuality(deal);
    const scoreQ = q.winShare * 100 + q.bestClear; // winShare доминирует
    if (scoreQ > bestScoreQ) {
      bestScoreQ = scoreQ;
      bestDeal = deal;
    }
    if (q.winShare >= CFG.GEN_MIN_WIN_SHARE) break; // достаточно дружелюбен
  }
  assignHarvest(bestDeal);
  return bestDeal;
}

/* =====================  СОСТОЯНИЕ ИГРЫ  ===================== */

let G = null;               // текущая партия
let cardEls = [];           // DOM-элементы карт стола по id слота
let coinBalance = lsGet(LS.coins, 0);
let bestScore = lsGet(LS.best, 0);
let winsCount = lsGet(LS.wins, 0);
let gamesCount = lsGet(LS.games, 0);
let idleTimer = null;
let hintEl = null;

const $ = (id) => document.getElementById(id);

function addCoins(n) {
  coinBalance += n;
  lsSet(LS.coins, coinBalance);
}

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
    coinsThisLevel: 0,
    over: false,
  };
  buildTableDom();
  $('overlay').classList.add('hidden');
  render();
  armIdleTimer();
}

/* =====================  DOM СТОЛА  ===================== */

function buildTableDom() {
  const peaks = $('peaks');
  peaks.innerHTML = '';
  cardEls = [];
  for (const s of SLOTS) {
    const el = document.createElement('div');
    el.className = 'card down';
    el.style.left = `calc(${s.col} * (var(--card-w) + var(--gap)))`;
    el.style.top = `calc(${s.row} * var(--row-step))`;
    el.style.zIndex = String(s.row + 1); // нижний ряд лежит поверх
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
    // aria-label ставится в render(): закрытые карты не должны выдавать ранг
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
    el.classList.toggle('playable', !G.over && !removed && open && isAdjacent(G.deal.tableRanks[s.id], G.waste));

    // Доступность: закрытые карты не выдают ранг, убранные — вне фокуса,
    // открытые доступны с клавиатуры (у role="button" должен быть tabindex)
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

  // HUD и прогресс
  $('hud-coins').textContent = String(coinBalance);
  $('hud-score').textContent = String(G.score);
  $('hud-chain').textContent = G.chain > 0
    ? `${G.chain} (×${multiplierFor(G.chain).toFixed(1)})`
    : '—';
  $('hud-harvest').textContent = `${G.harvestGot}/${G.deal.harvest.size}`;
  $('progress-fill').style.width = `${(G.removed.size / TABLE_SIZE) * 100}%`;
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

/* =====================  ХОДЫ  ===================== */

function onCardClick(slotId) {
  if (!G || G.over) return;
  if (G.removed.has(slotId)) return;
  if (!isOpen(slotId)) {
    // Тап по закрытой карте: та же обратная связь, что и по неподходящей
    shake(cardEls[slotId]);
    armIdleTimer();
    return;
  }

  const rank = G.deal.tableRanks[slotId];
  if (!isAdjacent(rank, G.waste)) {
    shake(cardEls[slotId]);
    armIdleTimer();
    return;
  }

  // Уборка карты: серия растёт, карта становится сбросом
  G.removed.add(slotId);
  G.chain++;
  const mult = multiplierFor(G.chain);
  G.score += Math.round(CFG.SCORE_BASE * mult);
  if (G.deal.harvest.has(slotId)) {
    G.harvestGot++;
    const coins = Math.round(CFG.COINS_PER_HARVEST * mult);
    G.coinsThisLevel += coins;
    addCoins(coins); // урожай начисляется сразу и сохраняется даже при поражении (п. 3.6)
  }
  G.waste = rank;
  G.wasteSuit = G.deal.tableSuits[slotId];

  if (G.removed.size === TABLE_SIZE) {
    finishWin();
    return;
  }
  if (stockLeft() === 0 && !anyMoves()) {
    finishLose();
    return;
  }
  render();
  armIdleTimer();
}

function onStockClick() {
  if (!G || G.over) return;
  if (stockLeft() === 0) {
    shake($('stock-card'));
    armIdleTimer();
    return;
  }
  // Добор: верхняя карта стока в сброс, серия обнуляется (п. 3.2)
  G.waste = G.deal.stockRanks[G.stockIdx];
  G.wasteSuit = G.deal.stockSuits[G.stockIdx];
  G.stockIdx++;
  G.chain = 0;

  if (stockLeft() === 0 && !anyMoves()) {
    finishLose();
    return;
  }
  render();
  armIdleTimer();
}

/* =====================  ФИНАЛЫ  ===================== */

function finishWin() {
  G.over = true;
  clearHint();

  const left = stockLeft();
  const stockBonus = left * CFG.STOCK_BONUS_PER_CARD;
  const winCoins = CFG.WIN_REWARD + stockBonus;
  addCoins(winCoins);
  G.coinsThisLevel += winCoins;

  winsCount++;
  gamesCount++;
  lsSet(LS.wins, winsCount);
  lsSet(LS.games, gamesCount);
  const isRecord = G.score > bestScore;
  if (isRecord) {
    bestScore = G.score;
    lsSet(LS.best, bestScore);
  }

  render();
  showOverlay(
    `<div class="emoji">🎉🍎</div>` +
    `<h2>Стол чист!</h2>` +
    `<p>Отличная работа — сад благодарит вас.</p>` +
    `<table class="reward">` +
    `<tr><td>Очки за уровень</td><td>${G.score}${isRecord ? ' — рекорд!' : ''}</td></tr>` +
    `<tr><td>Монеты за победу</td><td>+${CFG.WIN_REWARD}</td></tr>` +
    `<tr><td>Бонус колоды: ${left} × ${CFG.STOCK_BONUS_PER_CARD}</td><td>+${stockBonus}</td></tr>` +
    `<tr><td>Урожай: ${G.harvestGot} 🍎</td><td>+${G.coinsThisLevel - winCoins}</td></tr>` +
    `<tr class="total"><td>Всего монет за уровень</td><td>+${G.coinsThisLevel}</td></tr>` +
    `<tr><td>Баланс</td><td>💰 ${coinBalance}</td></tr>` +
    `</table>` +
    `<button id="btn-again" class="btn-main" type="button">Играть ещё раз</button>`
  );
}

function finishLose() {
  G.over = true;
  clearHint();

  gamesCount++;
  lsSet(LS.games, gamesCount);

  const pct = Math.round((G.removed.size / TABLE_SIZE) * 100);
  render();
  // Тёплый тон поражения, урожай сохранён — 07-ux-ui-ftue.md и п. 3.6
  showOverlay(
    `<div class="emoji">🐶</div>` +
    `<h2>Почти получилось!</h2>` +
    `<p>Стол был чист на ${pct}%. Бисквит уверен: в следующий раз выйдет.</p>` +
    (G.harvestGot > 0
      ? `<p class="kept">Урожай сохранён: ${G.harvestGot} 🍎 (+${G.coinsThisLevel} монет уже в копилке)</p>`
      : `<p class="kept">Монеты урожая не сгорают — попробуйте собрать 🍎 в новой партии.</p>`) +
    `<p>Баланс: 💰 ${coinBalance}</p>` +
    `<button id="btn-again" class="btn-main" type="button">Ещё раз</button>`
  );
}

function showOverlay(html) {
  const overlay = $('overlay');
  overlay.querySelector('.panel').innerHTML = html;
  overlay.classList.remove('hidden');
  const btn = overlay.querySelector('#btn-again');
  if (btn) btn.addEventListener('click', newGame);
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

/* =====================  ЗАПУСК  ===================== */

document.addEventListener('DOMContentLoaded', () => {
  $('btn-restart').addEventListener('click', newGame);
  $('stock-card').addEventListener('click', onStockClick);
  $('stock-card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onStockClick();
    }
  });
  newGame();
});
