# 11. Приложение А — Алгоритмы раскладов: генератор, солвер, калибровка

**Проект:** Orchard Peaks. Назад: [10-production.md](10-production.md) · Далее: [12-economy-sim.md](12-economy-sim.md)

Приложение детализирует пайплайн генерации уровней из [03-core-gameplay.md](03-core-gameplay.md) п. 3.4 до уровня псевдокода, пригодного к реализации. Все числа согласованы с главами 03 (правила, кривая сложности), 04 (темп урожая) и 05 (экономика взносов). При расхождении формулировок глава 03 задаёт намерение, это приложение — источник истины для реализации.

---

## 11.1. Структуры данных и инварианты

```typescript
// ===== Базовые типы =====
type Rank = number;      // 1..13 (A=1 ... K=13). Масти декоративны и на правила не влияют.
type SlotId = number;    // 0..N-1, N = число слотов стола (24..34)

interface Slot {
  id: SlotId;
  row: number;           // 0 = вершины пиков ... maxRow = нижний (открытый) ряд
  peak: number;          // индекс секции/пика (0..2 для классики) — для правил урожая
  coversPhys: SlotId[];  // слоты, которые данный слот физически накрывает (лежит поверх)
  coveredBy: SlotId[];   // кто мешает уборке: физические (≤2) + виртуальные рёбра (≤2)
}

interface Layout {
  slots: Slot[];         // 24..34 слотов ([03] п. 3.2)
  stockSize: number;     // 18..24 карты стока ([03] п. 3.2)
  maxRow: number;
}

interface Assignment {
  tableRanks: Rank[];    // ранг по каждому слоту
  stockRanks: Rank[];    // фиксированный порядок добора, [0] — верх стока
  rescueRanks: Rank[];   // 5 карт спасения «+5 карт» ([03] п. 3.6) — тоже фиксированы seed'ом
  startWaste: Rank;      // стартовая карта сброса
  bees: SlotId[];        // слоты с пчёлами (гл. 8+), таймер 3 добора; ≤ 2 на уровень
  vines: Array<{ root: SlotId; bound: SlotId[] }>;  // лозы (гл. 10+)
  locks: Array<{ locked: SlotId; key: SlotId }>;    // замки (гл. 4+)
}
```

**Ключевое решение — «безколодная» раздача.** Ранги генерируются свободно, без ограничения одной 52-карточной колодой (стандарт жанра: у Grand Harvest ранги повторяются произвольно). Иначе комбинация «стол 34 + сток 24 + сброс 1» была бы невозможна. Классический расклад «3 пика» при этом совпадает с колодным: 28 + 23 + 1 = 52.

**Инварианты (проверяются валидатором каждого батча):**

| # | Инвариант |
|---|---|
| I1 | Граф `coveredBy` — DAG; физических накрытий ≤ 2, виртуальных (замок/лоза) ≤ 2 на слот |
| I2 | Стол 24–34 слотов, сток 18–24; распределение рангов по батчу ≈ равномерное (χ², p > 0.01) — игрок не должен замечать перекоса |
| I3 | Первый ход существует всегда: в открытом ряду есть карта, соседняя со `startWaste` |
| I4 | Класс A (85% уровней): полная решаемость с ≤ S−2 доборов. Класс B (15%): очистка ≥ 90% стола **и** полная решаемость с добавкой `rescueRanks`. Уровней вне классов A/B не существует ([03] п. 3.4) |
| I5 | Разметка карт урожая ортогональна рангам — не влияет на решаемость (п. 11.8) |
| I6 | Генерация детерминирована по seed: уровень воспроизводим на клиенте, сервере и в тестах |

## 11.2. Классическая структура «3 пика»

28 карт, 4 ряда. Нижний ряд физически лежит **поверх** предыдущего: он открыт, а карта ряда r закрыта, пока не убраны накрывающие её карты ряда r+1.

| Ряд (row) | Карт | Состояние на старте | Накрыта картами ряда |
|---|---|---|---|
| 0 — вершины пиков | 3 | закрыты | 1 (по 2 на вершину) |
| 1 | 6 | закрыты | 2 (по 2 на карту) |
| 2 | 9 | закрыты | 3 (по 2 на карту) |
| 3 — нижний, открытый | 10 | **открыты** | — |

Итого: 18 закрытых + 10 открытых — ровно как в [03] п. 3.2. Глубина залегания (для правил урожая, п. 11.8): `depth(slot) = maxRow − slot.row`, т.е. открытый ряд — depth 0, вершины — depth 3. Фигурные расклады («яблоня», «лейка», «улитка») — тот же граф с другой геометрией, 24–34 слота, depth 0–4.

**Спецмеханики как рёбра графа.** Замок (гл. 4) и лоза (гл. 10) моделируются виртуальными рёбрами `coveredBy`: замковая карта получает ребро от карты-ключа, связанные лозой — от корневой. Солверу не нужны специальные ветки — только пчела (гл. 8) требует счётчика в состоянии (п. 11.4). Валидатор запрещает циклы: лоза/замок не могут указывать на карту, которая физически накрывает их источник (I1).

## 11.3. Прямая генерация: обратная сборка

Детализация шагов 1–3 из [03] п. 3.4. Скелет решения строится наперёд, затем раздаётся по слотам в порядке, обратном порядку вскрытия, — поэтому хотя бы одна выигрышная линия существует по построению.

```typescript
type SkeletonEvent =
  | { kind: 'TABLE'; rank: Rank }   // уборка карты со стола
  | { kind: 'DRAW';  rank: Rank };  // добор из стока (разрыв серии)

// --- Шаг 1: скелет решения — цепочки Маркова по кругу рангов ---
function generateSkeleton(L: Layout, dTarget: number, rng: RNG): SkeletonEvent[] {
  const p = clamp(0.25 + 0.40 * dTarget, 0.25, 0.55); // лёгкий: длинные цепочки (p=0.25),
                                                      // сложный: рваные (p=0.55) — [03] п. 3.4
  const maxDraws = L.stockSize - RESERVE_M;           // m = 2 — запас стока ([03] п. 3.4)
  const events: SkeletonEvent[] = [];
  let waste = randRank(rng);                          // станет startWaste
  let tablePlaced = 0, draws = 0;

  while (tablePlaced < L.slots.length) {
    // длина цепочки ~ 1 + Geom(p); внутри цепочки шаг ±1 c зацикливанием A↔K
    const chainLen = 1 + sampleGeometric(p, rng);
    let dir = rng() < 0.5 ? +1 : -1;
    for (let i = 0; i < chainLen && tablePlaced < L.slots.length; i++) {
      if (rng() < 0.35) dir = -dir;                   // смена направления — живость цепочек
      waste = wrapRank(waste + dir);                  // wrapRank: 0→13, 14→1 (King wraps, [03] п. 3.2)
      events.push({ kind: 'TABLE', rank: waste });
      tablePlaced++;
    }
    if (tablePlaced < L.slots.length) {               // разрыв: добор из стока
      if (draws >= maxDraws) return generateSkeleton(L, dTarget, rng); // редко: перезапуск
      waste = randRankNotAdjacent(waste, rng);        // стоковая карта рвёт серию
      events.push({ kind: 'DRAW', rank: waste });
      draws++;
    }
  }
  return events; // events[0] всегда TABLE, соседний со startWaste → инвариант I3
}

// --- Шаг 2: раскладка по слотам, обратная порядку вскрытия ---
function dealBackwards(L: Layout, events: SkeletonEvent[], rng: RNG): Assignment {
  // Фронтир — слоты, все физические накрыватели которых уже получили карты
  // (их карты убираются раньше). Стартовый фронтир — открытый ряд.
  const frontier = new Set(openRowSlots(L));
  const tableRanks = new Array<Rank>(L.slots.length);
  const stockRanks: Rank[] = [];

  for (const ev of events) {
    if (ev.kind === 'DRAW') { stockRanks.push(ev.rank); continue; }
    const slot = pickRandom(frontier, rng);           // случайность формы решения
    tableRanks[slot.id] = ev.rank;
    frontier.delete(slot);
    for (const under of slot.coversPhys)              // карта под ним теперь достижима
      if (allCoverersAssigned(under, tableRanks, L)) frontier.add(L.slots[under]);
  }
  // Хвост стока (неиспользованный запас m) и карты спасения — равномерные ранги
  while (stockRanks.length < L.stockSize) stockRanks.push(randRank(rng));
  const rescueRanks = [0,1,2,3,4].map(() => randRank(rng));
  return { tableRanks, stockRanks, rescueRanks, startWaste: startOf(events), bees: [], vines: [], locks: [] };
}

// --- Шаг 3: шум — ломаем «телеграфность» решения ---
function addNoise(L: Layout, asg: Assignment, dTarget: number, rng: RNG): Assignment {
  const q = lerp(0.10, 0.45, dTarget);                // растёт со сложностью ([03] п. 3.4)
  for (const row of rowsOf(L)) {
    for (const [a, b] of randomPairsInRow(row, rng)) {
      if (rng() >= q) continue;
      swap(asg.tableRanks, a, b);                     // перестановка внутри слоя
      if (!quickSolvable(L, asg)) swap(asg.tableRanks, a, b); // откат при потере решаемости
    }
  }
  return asg;
}
```

`quickSolvable` — beam search шириной 200 (п. 11.4): дёшев, ошибается только консервативно (может забраковать решаемое, не наоборот).

## 11.4. Солвер: точный поиск с мемоизацией

Уточнение шага 4 из [03] п. 3.4: beam(200) — **быстрый первичный фильтр** внутри циклов генерации и шума; точный мемоизированный солвер — **финальный верификатор** и источник метрик (доля выигрышных линий, ловушки). Оба работают только офлайн — в билд попадают сериализованные расклады ([03] п. 3.4).

Состояние поиска — тройка «рука, колода, открытые карты»: карта сброса («рука»), позиция в стоке («колода»), множество оставшихся карт стола (открытость выводится из маски и графа).

```typescript
interface SolverState {
  removed: bigint;       // битовая маска убранных слотов; N ≤ 34 → влезает и в double (2^34 < 2^53)
  stockIdx: number;      // сколько карт стока добрано (0..stockSize)
  waste: Rank;           // текущая карта сброса
  beeTimers: number[];   // по каждой пчеле: 3..1 = сидит, 0 = улетела; тикает на DRAW
}

function stateKey(st: SolverState): string {
  return `${st.removed}|${st.stockIdx}|${st.waste}|${st.beeTimers.join('')}`;
}

function isAdjacent(a: Rank, b: Rank): boolean {     // ±1 с зацикливанием ([03] п. 3.2)
  const d = (a - b + 13) % 13;
  return d === 1 || d === 12;
}

function isRemovable(s: Slot, st: SolverState, A: Assignment): boolean {
  if (bit(st.removed, s.id)) return false;
  for (const c of s.coveredBy) {                      // физические + замок/лоза (п. 11.2)
    if (isVirtualBeeEdge(c, s, A)) {                  // пчела: мешает, пока таймер > 0
      if (st.beeTimers[beeIndex(c, A)] > 0) return false;
    } else if (!bit(st.removed, c)) return false;
  }
  return isAdjacent(A.tableRanks[s.id], st.waste);
}
```

### Точный солвер (полный псевдокод)

Мемоизация по `stateKey`; в узле агрегируются и решаемость, и счётчики линий — подсчёт путей по DAG корректен при мемоизации (число терминальных линий узла = сумма по потомкам).

```typescript
const CAP = 1e15;                                     // кап счётчиков линий (double-safe)
const MEMO_LIMIT = 5_000_000;                         // бюджет памяти (~2 с на расклад)

interface NodeInfo {
  win: boolean;          // достижима ли победа (стол пуст)
  minStock: number;      // мин. доборов до победы; Infinity, если win=false
  maxCleared: number;    // максимум убранных карт стола по всем линиям (для класса B)
  winLines: number;      // выигрышных терминальных линий (кап CAP)
  totalLines: number;    // всех терминальных линий (кап CAP)
}

function solveNode(st: SolverState, A: Assignment, L: Layout,
                   memo: Map<string, NodeInfo>, stats: SearchStats): NodeInfo {
  if (popcount(st.removed) === L.slots.length)        // стол чист — победа
    return { win: true, minStock: 0, maxCleared: L.slots.length, winLines: 1, totalLines: 1 };

  const key = stateKey(st);
  const hit = memo.get(key);
  if (hit) return hit;
  if (memo.size > MEMO_LIMIT) throw new SolverBudgetExceeded(); // → фолбэк beam, п. 11.6

  const moves = L.slots.filter(s => isRemovable(s, st, A));
  const canDraw = st.stockIdx < A.stockRanks.length;
  stats.branchSum += moves.length; stats.branchCnt++; // для метрики branching

  let out: NodeInfo = { win: false, minStock: Infinity,
                        maxCleared: popcount(st.removed), winLines: 0, totalLines: 0 };

  if (moves.length === 0 && !canDraw) {
    out.totalLines = 1;                               // терминальное поражение — одна линия
  } else {
    for (const m of moves) {
      const next: SolverState = { ...st, removed: setBit(st.removed, m.id),
                                  waste: A.tableRanks[m.id] };
      merge(out, solveNode(next, A, L, memo, stats), /*drawCost*/ 0);
    }
    if (canDraw) {                                    // добор всегда легален ([03] п. 3.2)
      const next: SolverState = { ...st, stockIdx: st.stockIdx + 1,
                                  waste: A.stockRanks[st.stockIdx],
                                  beeTimers: st.beeTimers.map(t => Math.max(0, t - 1)) };
      merge(out, solveNode(next, A, L, memo, stats), 1);
    }
  }
  memo.set(key, out);
  return out;
}

function merge(out: NodeInfo, child: NodeInfo, drawCost: number): void {
  out.win = out.win || child.win;
  if (child.win) out.minStock = Math.min(out.minStock, child.minStock + drawCost);
  out.maxCleared = Math.max(out.maxCleared, child.maxCleared);
  out.winLines  = Math.min(CAP, out.winLines + child.winLines);
  out.totalLines = Math.min(CAP, out.totalLines + child.totalLines);
}
```

### Beam search (первичный фильтр)

```typescript
function quickSolvable(L: Layout, A: Assignment, width = 200): boolean {
  let beam: SolverState[] = [initialState(A)];
  while (beam.length > 0) {
    const next: SolverState[] = [];
    for (const st of beam) {
      if (popcount(st.removed) === L.slots.length) return true;
      for (const st2 of expand(st, A, L)) next.push(st2); // все уборки + добор
    }
    // эвристика: продвинутость минус потраченный сток
    next.sort((a, b) => score(b) - score(a));         // score = 3·removed + open − 1.5·stockIdx
    beam = dedupeByKey(next).slice(0, width);
  }
  return false;                                       // не доказательство нерешаемости!
}
```

## 11.5. Метрики решаемости

Из корневого `NodeInfo` и статистики поиска:

| Метрика | Формула | Смысл и потребитель |
|---|---|---|
| `solvable` | `root.win` | Класс A (инвариант I4) |
| `clearRatio` | `root.maxCleared / N` | Класс B: ≥ 0.90 ([03] п. 3.4) |
| `minStockUsed` | `root.minStock` | Компонента U сложности ([03] п. 3.4) |
| `branching` | `stats.branchSum / stats.branchCnt` | Среднее число легальных ходов; компонента B_inv |
| `trapCount` | `|{k ∈ memo : !memo[k].win}|` (кап 10⁴) | Достижимые состояния-ловушки; компонента T |
| `winLineRatio` | `root.winLines / root.totalLines` | **Доля выигрышных линий** — сколько «свободы ошибаться» у игрока; главный предиктор WR после D |
| `avgChainLen`, `avgMaxStreak` | сэмплирование (ниже) | **Средняя длина цепочек** между доборами; прогноз множителя серии |

### Сэмплирование выигрышных линий (цепочки и серии)

Точный подсчёт длин цепочек по всем линиям экспоненциален — оцениваем по K случайных выигрышных прогонов, используя мемо-таблицу как оракул («ходи только в состояния с win=true»).

```typescript
function sampleWinningLines(A: Assignment, L: Layout, memo: Map<string, NodeInfo>,
                            K = 400, rng: RNG): ChainStats {
  const chains: number[] = [], streaks: number[] = [];
  for (let k = 0; k < K; k++) {
    let st = initialState(A), chain = 0, best = 0, mult = 1.0;
    while (popcount(st.removed) < L.slots.length) {
      const winningMoves = childrenOf(st, A, L).filter(c => memo.get(stateKey(c.state))!.win);
      const pick = pickRandom(winningMoves, rng);     // равновероятно среди сохраняющих победу
      if (pick.kind === 'DRAW') { chains.push(chain); chain = 0; mult = 1.0; }
      else { chain++; mult = Math.min(3.0, 1.0 + 0.1 * (chain - 1)); best = Math.max(best, mult); }
      st = pick.state;                                // множитель: ×1, +0.1/карта, кап ×3 ([03] п. 3.2)
    }
    chains.push(chain); streaks.push(best);
  }
  return { avgChainLen: mean(chains), avgMaxStreak: mean(streaks) };
}
```

**Стыковка с экономикой:** реализованный средний множитель победы M(n) = 2.2 − 0.7·min(1, n/60) ([05-economy.md](05-economy.md) п. 5.2) — следствие именно этой метрики: p(D) растёт с уровнем → цепочки короче → серии беднее. Генератор обязан выдавать `avgChainLen`, при которой симулятор серий даёт M(n) ± 0.15 для полосы уровня — это контрольный тест батча (п. 11.9).

## 11.6. Скоринг сложности и цикл генерации

Формула D — каноническая из [03] п. 3.4, без изменений:

```
D = 0.35·H + 0.25·U + 0.20·B_inv + 0.20·T
H     = доля закрытых карт стола           (классика: 18/28 = 0.64)
U     = minStockUsed / S                   (насколько впритык сток)
B_inv = 1 − clamp(branching / 4, 0, 1)     (мало опций = сложно)
T     = clamp(trapCount / 6, 0, 1)         (ловушки = сложно)
```

```typescript
function generateLevel(spec: LevelSpec, rng: RNG): SerializedLevel | 'FAIL' {
  for (let iter = 0; iter < 40; iter++) {            // до 40 итераций ([03] п. 3.4)
    const skeleton = generateSkeleton(spec.layout, spec.dTarget, rng);
    let asg = dealBackwards(spec.layout, skeleton, rng);
    attachMechanics(asg, spec.chapter, rng);          // замки/лозы/пчёлы по главе ([03] п. 3.2)
    asg = addNoise(spec.layout, asg, spec.dTarget, rng);

    let m: Metrics;
    try { m = exactSolveAndMeasure(spec.layout, asg); }
    catch (e) {                                       // бюджет солвера исчерпан
      if (!quickSolvable(spec.layout, asg)) continue; // консервативно бракуем
      m = beamMetricsOnly(spec.layout, asg);          // D по beam-оценкам, класс — только A
    }
    const cls = classify(m);                          // A: solvable ∧ minStock ≤ S−2
                                                      // B: clearRatio ≥ 0.90 ∧ solvableWithRescue
    if (cls === 'NONE') continue;                     // инвариант I4
    if (cls === 'B' && !solvesWithRescue(spec.layout, asg)) { rerollRescue(asg, rng); continue; }
    if (Math.abs(m.D - spec.dTarget) > 0.07) continue; // допуск ([03] п. 3.4)

    assignHarvest(spec.layout, asg, spec.level, rng); // п. 11.8 — после фиксации рангов (I5)
    return serialize(spec, asg, m);
  }
  return 'FAIL';                                      // в отчёт батча; шаблон правится вручную
}
```

Балансировка классов — на уровне батча: генератор получает целевой класс (85% заявок A, 15% B), допустимый провал `FAIL` ≤ 2% батча.

## 11.7. Калибровка сложности по прогрессу игрока

### Таблица «уровень → параметры генерации»

База WR — кривая W(n) = 0.55 + 0.35·e^(−n/25) + Osc(n) из [03] п. 3.5; D_target — кусочно-линейная инверсия калибровочной таблицы D→W оттуда же (0.15→90%, 0.45→70%, 0.65→55%, 0.78→40%). Главы: 12 × 20 уровней ([03] п. 3.4).

| Уровни (глава) | База WR | D_target | Стол, слотов | Сток S | Карт урожая (доля стола) | Механики |
|---|---|---|---|---|---|---|
| 1–2 (гл. 1) | 100% / ≥97% | 0.03–0.08 | 24 | 24 | 0 | ур. 1 — победа любой последовательностью ([03] п. 3.5) |
| 3–5 (гл. 1) | 88–95% | 0.08–0.15 | 24–28 | 22–24 | 8 (29–33%) | ввод карт урожая ([03] п. 3.2) |
| 6–20 (гл. 1) | 71–83% | 0.26–0.44 | 28 | 21–22 | 8–9 (29–32%) | первый «камень» — ур. 10 |
| 21–40 (гл. 2) | 62–71% | 0.44–0.56 | 28–30 | 20–21 | 9–10 (30–33%) | золотые карты |
| 41–60 (гл. 3) | 58–62% | 0.56–0.61 | 28–32 | 19–20 | 10–11 (31–34%) | — |
| 61–100 (гл. 4–5) | 56–58% | 0.61–0.64 | 30–34 | 18–19 | 10–12 (32–35%) | замок и ключ (гл. 4) |
| 101–160 (гл. 6–8) | 55–56% | 0.64–0.66 | 30–34 | 18–19 | 11–13 (34–38%) + мешки 0–2 | мешок семян (гл. 6), пчела (гл. 8) |
| 161–240 (гл. 9–12) | 55% (плато) | 0.65–0.67 | 30–34 | 18 | 12–14 (35–41%) + мешки 1–2 | лоза (гл. 10) |
| «Камень» (n mod 10 = 0, n ≥ 10) | база −15 п.п. | база +0.10–0.13, кап 0.78 | по полосе | S − 1 | +2 к полосе (п. 11.8) | без изменений |
| «Вдох» (n mod 10 = 1, n ≥ 11) | база +8 п.п. | база −0.08 | по полосе | S | по полосе | без изменений |

Контрольные точки против [03] п. 3.5: n=20 → 71% ✓; n=50 (база) → 60% ✓; n=100 → 55.6%, камень 40.6% ✓. Уровни 1–5 генерятся по спецзаявке (FTUE), формула на них не давит. Лёгкий рост D на плато (0.64 → 0.67) при плоском WR — компенсация роста скилла когорты; уточняется по `level_finish` с soft launch ([09-analytics-kpi.md](09-analytics-kpi.md) п. 9.1, дашборд «Баланс сложности» п. 9.7).

Целевая решаемость по классам: доля A/B = 85/15 одинакова во всех полосах; на «камнях» допускается сдвиг до 75/25 (класс B там ощущается честным: спасение «+5 карт» — штатный выход, [03] п. 3.6).

### Стыковка с экономикой взносов (глава 05)

Матожидание монетного результата одной попытки уровня:

```
EV_core(n) = WR(n) · [ M(n)·E(n) + B_stock(n) ] − E(n)
E(n)       = 350·1.012ⁿ (округление до 10)      — взнос ([05] п. 5.2)
M(n)       = 2.2 − 0.7·min(1, n/60)             — множитель выигрыша ([05] п. 5.2)
B_stock(n) = 25 · глава(n) · E[остаток стока | победа], E[остаток] ≈ 2–4 ([03] п. 3.2, запас m=2)
```

| Точка | Подстановка | EV_core | Смысл |
|---|---|---|---|
| n=20 (гл. 1) | 0.71·(1.967·440 + 75) − 440 | **≈ +227** | Медовый месяц: ядро само в плюс; с миссиями ≈ +247/уровень — сходится с сальдо дня 2 таблицы 5.4 (+2 960 / 12 уровней) |
| n=100 (гл. 5) | 0.55·(1.5·1150 + 375) − 1150 | **≈ +5** | Плато: ядро в нуле **по дизайну**; дефицит создают бустеры/спасения, приход — миссии и стрик ([05] пп. 5.4–5.5) |
| n=100, камень | 0.40·(1725 + 375) − 1150 | **≈ −310** | Серия попыток на камне сжигает 1–3 взноса — точка спроса №2 из [05] п. 5.7 |

Вывод для генератора: калибровка WR — это калибровка экономики. Смещение фактического WR на ±3 п.п. от таблицы смещает EV_core на плато на ∓0.06·E за попытку и сдвигает точку дефицита дня 12–16 (проверка — [12-economy-sim.md](12-economy-sim.md) п. 12.6, чувствительность — п. 12.7). Поэтому допуск батча по WR симуляторов — жёстче допуска по D (п. 11.9).

## 11.8. Размещение карт урожая: правила глубины залегания

Карты урожая — оверлей поверх готового расклада (инвариант I5): выбираются слоты, не ранги. Количество — по таблице 11.7; средний выход урожая за уровень с учётом мешков — 10–14 ([04-meta-progression.md](04-meta-progression.md) п. 4.2).

| # | Правило | Норматив |
|---|---|---|
| Q1 | «Ранний сок»: урожай должен пойти с первых ходов — игрок 45–70 сразу видит смысл партии | 35–45% урожайных карт на depth 0–1 |
| Q2 | «Жила»: часть урожая — награда за вскрытие пирамиды | ≤ 20% на максимальной глубине |
| Q3 | Равномерность по пикам/секциям: нет «пустого пика» | разброс числа урожайных карт между секциями ≤ 2 |
| Q4 | Пол поражения — «сессия никогда не в ноль» ([03] п. 3.6) | медиана собранного урожая в **проигранных** прогонах жадного симулятора ≥ 50% разметки |
| Q5 | Спецмеханики: урожай не прячется за фрустрацией | на замковых картах: гл. 4–5 — 0, далее ≤ 2; мешок семян — depth ≥ 2 и никогда под замком |
| Q6 | «Камни»: +2 урожайные карты, обе depth ≥ 1 | утешение: даже проигранный камень приносит заметный урожай |

```typescript
function assignHarvest(L: Layout, asg: Assignment, level: number, rng: RNG): void {
  const spec = harvestSpecFor(level);                 // количество и мешки — таблица 11.7
  for (let attempt = 0; attempt < 25; attempt++) {
    const marks = sampleSlots(L, spec, rng, {         // сэмплинг с квотами Q1–Q3, Q5, Q6
      shallowShare: [0.35, 0.45], deepMax: 0.20, perPeakSpread: 2,
      lockedMax: lockedQuota(level), bagMinDepth: 2, stoneExtra: isStone(level) ? 2 : 0,
    });
    // Q4: жадный симулятор — «берёт длиннейшую видимую цепочку» ([03] п. 3.4)
    const runs = greedyRollouts(L, asg, marks, 200, rng);
    const lost = runs.filter(r => !r.win);
    if (lost.length === 0 || median(lost.map(r => r.harvestShare)) >= 0.50) {
      asg.harvest = marks; return;
    }
    spec.migrateUp();                                 // провал Q4 → часть глубоких меток поднять
  }
  throw new BatchValidationError('Q4 unsatisfiable'); // сигнал: слишком глубокий шаблон layout
}

function greedyRollouts(L, asg, marks, K, rng): Run[] {
  // K прогонов жадной политики: из легальных ходов берём начало длиннейшей цепочки,
  // добор — только когда ходов нет. Считаем: win, собранный урожай / |marks|.
  // Тот же симулятор используется в валидации батчей ([03] п. 3.4) — код один.
}
```

Связь с экономикой урожая: квоты Q1/Q4 гарантируют, что даже при WR 55% на плато фактический приток урожая ≈ 0.55·(полный сбор) + 0.45·(≥50% сбора) ≈ 77% номинала — этот коэффициент зашит в симулятор сада ([12-economy-sim.md](12-economy-sim.md) п. 12.4) и согласован с темпом «≥ 1 заказ в день» ([04] п. 4.2).

## 11.9. Пограничные случаи и тесты батча

**Пограничные случаи:**

- **Нет первого хода** — исключён построением (скелет начинается с TABLE-события, соседнего со стартовым сбросом) + прямой тест I3 на каждом расклада.
- **Взрыв состояний от пчёл** — таймер пчелы входит в ключ мемоизации; домен мал (0–3), но контент-правило «≤ 2 пчёл на уровень» держит рост ×16 максимум.
- **Циклы виртуальных рёбер** (лоза указывает на накрывателя корня) — DAG-валидация при `attachMechanics`, нарушение = пересборка механик, не расклада.
- **Бюджет солвера исчерпан** (MEMO_LIMIT / 2 с) — фолбэк beam(200): решение найдено → класс A подтверждён (beam-линия — конструктивное доказательство); не найдено → расклад бракуется, хотя нерешаемость не доказана. Консервативность нам подходит: генерация офлайн, брак дешёв.
- **Переполнение счётчиков линий** — кап 10¹⁵, `winLineRatio` остаётся корректным как отношение капированных величин (смещение одинаково направлено, использование — пороговое).
- **Класс B без рабочего спасения** — `rescueRanks` перегенерируются до выполнения I4; если 40 итераций не хватило — FAIL в отчёт.

**Тесты приёмки батча (40 уровней, [03] п. 3.4):**

| Тест | Критерий |
|---|---|
| Допуск сложности | |D − D_target| ≤ 0.07 для 100% принятых |
| Классы решаемости | A/B = 85/15 ± 3 п.п. (на «камнях» до 75/25) |
| Доля FAIL генератора | ≤ 2% заявок |
| WR симуляторов | жадный и случайный игрок в калибровочных коридорах полосы; после soft launch — сверка с фактическим WR когорт (`level_finish`, [09] п. 9.1) |
| Серии | avgMaxStreak → реализованный M(n) ± 0.15 (п. 11.5) |
| Урожай | квоты Q1–Q6; медиана сбора в поражениях ≥ 50% |
| Ранги | χ²-тест равномерности по батчу, p > 0.01 (I2) |
| Детерминизм | повторная генерация по seed бит-в-бит идентична (I6) |

Прогон тестов — часть DoD контентного батча ([10-production.md](10-production.md)); симулятор экономики читает выход генератора напрямую — см. [12-economy-sim.md](12-economy-sim.md).
