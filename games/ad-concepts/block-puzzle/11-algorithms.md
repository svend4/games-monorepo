# 11 — Приложение: алгоритмы ядра

Навигация: [← Производство](10-production.md) | [README](README.md) | [Симулятор экономики →](12-economy-sim.md)

Статус: нормативная спецификация для реализации в Проходе А ([10](10-production.md)). Все правила и номиналы — производные от [03](03-core-gameplay.md) §2–5; при расхождении глава 03 первична, это приложение обновляется синхронно. Псевдокод — структурированный TypeScript-подобный; целевая реализация — Phaser 3 + TypeScript.

Инварианты уровня документа:

- **INV-G1 (честная выдача):** в момент выдачи тройки существует хотя бы одна последовательность размещения всех трёх фигур (солвер §3.4). Следствие: хотя бы одна фигура тройки размещаема.
- **INV-G2 (честный проигрыш):** game over наступает только когда ни одна из оставшихся фигур руки не размещаема (§4.1) — т.е. из-за ходов игрока после выдачи, а не из-за «невозможной» тройки.
- **INV-G3 (детерминизм):** генератор, солвер и поля дня детерминированы от сида — реплей по телеметрии `piece_placed`/`line_clear` воспроизводит партию (античит лиг, [04](04-meta-progression.md) §5).
- **INV-G4 (без таймеров):** ни один алгоритм не зависит от реального времени внутри партии ([03](03-core-gameplay.md) §2.1, п.7).

---

## 1. Типы данных и представление поля

```ts
// Битборд: строка поля = 8-битная маска (бит c = клетка занята).
// Для Фигурных полей ширина 9 → Uint16Array, маска столбцов до 9 бит (§6.4).
type Board = {
  size: 8 | 9;                 // 8 — базовые режимы; 9 — Фигурные поля (маска)
  rows: Uint16Array;           // занятость: rows[r], бит c
  stones: Uint16Array;         // подмножество rows: клетки-камни (двойная очистка)
  cracked: Uint16Array;        // подмножество stones: треснувшие камни
  mask: Uint16Array | null;    // null для 8×8; для полей — допустимые клетки (§6)
};

type PieceId =
  | 'MONO' | 'DOMINO_H' | 'DOMINO_V' | 'TRIO_I' | 'TRIO_L'
  | 'TET_I' | 'TET_O' | 'TET_L' | 'TET_S' | 'TET_T'
  | 'PENT_P' | 'PENT_L' | 'PENT_X' | 'PENT_I5';

type PieceDef = {
  id: PieceId;
  cells: ReadonlyArray<[r: number, c: number]>; // нормализовано к (0,0)
  rowMasks: ReadonlyArray<number>;              // предвычислено для битборда
  size: number;                                 // число клеток (1..5)
  H: 1 | 2 | 3 | 4 | 5;                         // индекс неудобства (03 §4.1)
  w0: number;                                   // базовый вес внутри своей группы
};

type Hand = { pieces: (PieceId | null)[]; crystalIndex: number | null }; // null = слот пуст
type Rng = { next(): number };  // mulberry32, детерминированный (§6.1)
```

Инвариант представления: `stones ⊆ rows`, `cracked ⊆ stones`, `rows ⊆ mask` (если mask ≠ null). Проверяется assert'ом в dev-сборке после каждого хода.

## 2. Каталог фигур (полный, 14 форм)

Источник состава: [03](03-core-gameplay.md) §4.1 — «моно (1), домино (2), трио I/L (2), тетрамино I/O/L/S/T (5), пентамино P/L/крест/I5 (4)». Вращения у игрока нет, поэтому каждая запись каталога имеет фиксированную матрицу; ориентационные варианты сверх этих 14 в v1.0 сознательно не вводятся (каждый новый — отдельная запись каталога через remote config).

| # | id | Матрица | Клеток | H | w0 |
|---|----|---------|--------|---|----|
| 1 | MONO | `#` | 1 | 1 | 6 |
| 2 | DOMINO_H | `##` | 2 | 1 | 5 |
| 3 | DOMINO_V | `#`／`#` (вертикаль) | 2 | 1 | 5 |
| 4 | TRIO_I | `###` | 3 | 2 | 7 |
| 5 | TRIO_L | `#.`／`##` | 3 | 2 | 7 |
| 6 | TET_I | `####` | 4 | 3 | 6 |
| 7 | TET_O | `##`／`##` | 4 | 2 | 8 |
| 8 | TET_L | `#.`／`#.`／`##` | 4 | 3 | 6 |
| 9 | TET_S | `.##`／`##.` | 4 | 4 | 4 |
| 10 | TET_T | `###`／`.#.` | 4 | 3 | 6 |
| 11 | PENT_P | `##`／`##`／`#.` | 5 | 4 | 4 |
| 12 | PENT_L | `#.`／`#.`／`#.`／`##` | 5 | 4 | 4 |
| 13 | PENT_X (крест) | `.#.`／`###`／`.#.` | 5 | 5 | 2 |
| 14 | PENT_I5 | `#####` | 5 | 5 | 3 |

Группы: **EASY** = H ≤ 3 (записи 1–8, 10; Σw0 = 56), **HARD** = H ≥ 4 (записи 9, 11–14; Σw0 = 17). **SMALL** = size ≤ 3 (записи 1–5) — цель анти-фрустрационного буста ([03](03-core-gameplay.md) §4.1, шаг 6). «Спасательные» фигуры: MONO, DOMINO_H, DOMINO_V.

Средний размер фигуры при D = 0.3 (уровни ~21–60) ≈ 3.3 клетки — согласовано с `avg_cells_per_piece` формулы бюджета уровней ([03](03-core-gameplay.md) §4.2).

## 3. Bag-система и режиссёр сложности

### 3.1 Построение взвешенного мешка

Доля HARD-группы задаётся кривой сложности ([03](03-core-gameplay.md) §5.1): `w_hard = 0.10 + 0.45·D`, где D — управляющий параметр уровня. Внутри группы фигуры делят долю пропорционально w0.

```ts
function buildBag(dEff: number, board: Board, pity: PityLevel): Map<PieceId, number> {
  const hardShare = clamp(0.10 + 0.45 * dEff, 0.10, 0.55);   // потолок 0.55 = потолок Классики
  const w = new Map<PieceId, number>();
  for (const p of CATALOG) {
    const groupShare = p.H >= 4 ? hardShare : 1 - hardShare;
    const groupSum   = p.H >= 4 ? SUM_W0_HARD : SUM_W0_EASY;
    let weight = groupShare * (p.w0 / groupSum);
    if (fillRatio(board) > 0.70 && p.size <= 3) weight *= 1.5;  // антифрустрация, 03 §4.1 шаг 6
    if (pity >= 1 && p.size <= 3) weight *= 1.25;               // pity L1+, §3.5
    w.set(p.id, weight);
  }
  return normalize(w); // Σ = 1
}
```

Режимные источники D:

- **Путешествие:** `D(n) = min(0.85, 0.18 + 0.10·log10(n+1) + spike(n))`; spike = +0.12 при n mod 10 = 0, −0.06 при n mod 10 = 1 ([03](03-core-gameplay.md) §5.1).
- **Классика:** стартовый w_hard = 0.19 (эквивалент D = 0.20); каждые 500 набранных очков w_hard += 0.03, потолок 0.55 ([03](03-core-gameplay.md) §5.2). В buildBag передаётся эквивалентный dEff = (w_hard − 0.10)/0.45.
- **Фигурные поля:** D фиксирован маской дня (поле задаёт сложность формой, не мешком); по умолчанию D = 0.30, weekend-поля ([08](08-liveops.md) §2) — D = 0.40.

### 3.2 Оценка поля (входы режиссёра)

```ts
type BoardEval = {
  fill: number;          // занятые / доступные клетки, 0..1
  fragmentation: number; // 1 − (макс. связная пустая область / все пустые), 0..1
  deadPocketRatio: number; // доля пустых клеток в областях размером < 3 (не примет даже TRIO)
  almostLines: number;   // строки+столбцы, где занято ≥ (len−2) клеток — «доступные линии»
  maxFit: number;        // максимальный size фигуры каталога, у которой есть ≥1 валидное размещение
};

function evaluate(board: Board): BoardEval; // flood-fill пустых областей + битборд-скан; O(клеток)
```

Индекс стресса поля (агрегат для решений режиссёра):

```
S = clamp01( 0.45·max(0, (fill − 0.35) / 0.50)
           + 0.35·fragmentation
           + 0.20·deadPocketRatio )
```

Интерпретация: S < 0.3 — комфорт (мешок работает как есть), 0.3–0.6 — рабочее напряжение, > 0.6 — предаварийное поле (режиссёр смягчает выдачу, §3.3). Пороги — remote config, стартовые значения выше.

### 3.3 Алгоритм выдачи тройки (полный цикл режиссёра)

Реализует шаги 1–6 из [03](03-core-gameplay.md) §4.1 плюс правила смягчения. Вызывается, когда рука пуста (или на старте партии).

```ts
function dealHand(board: Board, ctx: ModeCtx, rng: Rng): Hand {
  const ev = evaluate(board);
  const S  = stressIndex(ev);
  // 1. Эффективная сложность: стресс поля временно опускает D (но не ниже пола)
  let dEff = ctx.dLevel * (1 - 0.5 * S);
  dEff = Math.max(dEff, ctx.dLevel - PITY_DELTA[ctx.pity]); // pity: −0.08 (L1) / −0.15 (L2), §3.5
  const bag = buildBag(dEff, board, ctx.pity);

  for (let attempt = 0; attempt < 4; attempt++) {           // 1 базовая + 3 reroll (03 §4.1 шаг 4)
    let triple = drawTriple(bag, rng);                      // без возврата; ≤1 фигуры с H=5
    // 2. Директорские гарантии (замена БЕЗ изменения статистики мешка сверх правил ниже):
    if (S > 0.6 && ev.almostLines >= 2 && !hasLineMatcher(triple, board)) {
      triple = swapWorstFor(lineMatcherFrom(bag, board, rng), triple);  // ≥1 «закрыватель линии»
    }
    if (ctx.pity >= 2 && !triple.some(p => sizeOf(p) <= 2)) {
      triple = swapWorstFor(rng.pick(['MONO','DOMINO_H','DOMINO_V']), triple);
    }
    // 3. SOLVENCY-CHECK: вся тройка размещаема (INV-G1)
    if (solveTriple(board, triple)) return toHand(triple, ctx); // §3.4
  }
  // 4. Форс-замена самой неудобной фигуры на спасательную (03 §4.1 шаг 5)
  let triple = lastTriple();
  triple = swapWorstFor(bestRescue(board), triple);         // DOMINO_* если солвент, иначе MONO
  if (!solveTriple(board, triple)) {
    triple = [bestRescue(board), 'MONO', 'MONO'];           // деградация до предела
  }
  return toHand(triple, ctx);
  // Если даже MONO не ставится — поле полное; такой вызов невозможен: game over
  // зафиксирован ранее проверкой §4.1 (INV-G2). Assert в dev-сборке.
}
```

Правила `drawTriple`: три вытяжки без возврата; если во время вытяжки вторая фигура с H = 5 — она заменяется повторной вытяжкой из EASY (лимит «не более 1 фигуры с H=5 в тройке»). `hasLineMatcher(triple, board)` = у хотя бы одной фигуры существует размещение, завершающее ≥1 линию (проверка битбордом, ≤ 3×64 позиций).

Кристальный флаг: если `ctx.surge.crystalPending`, первая фигура выданной тройки помечается кристальной (§5.2), включая случай спасательной замены.

### 3.4 Солвер размещаемости (SOLVENCY-CHECK)

Жадный beam-поиск: находит **одну** последовательность размещения всех трёх фигур; не оптимальную — существование достаточно (INV-G1).

```ts
function solveTriple(board: Board, triple: PieceId[]): boolean {
  // Состояние луча: (доска, мультимножество оставшихся фигур)
  let beam: Array<{ b: Board; left: PieceId[] }> = [{ b: board, left: triple }];
  for (let depth = 0; depth < 3; depth++) {
    const next: typeof beam = [];
    for (const st of beam)
      for (const p of unique(st.left))
        for (const pos of topPlacements(st.b, p, K_PLACE))   // K_PLACE = 6 позиций на фигуру
          next.push({ b: applySim(st.b, p, pos), left: remove(st.left, p) });
    if (next.length === 0) return false;
    if (next.some(st => st.left.length === 0)) return true;
    beam = topK(next, BEAM_WIDTH, heuristic);                // BEAM_WIDTH = 8 (16 при pity ≥ 1)
  }
  return false;
}
// heuristic(доска): −fragmentation, −deadPocketRatio, +закрытые линии (симулируются с очисткой)
// topPlacements ранжирует позиции той же эвристикой; applySim выполняет и очистку линий —
// солвер обязан учитывать, что очистка освобождает место (иначе ложные "нерешаемо").
```

Сложность: ≤ 3! перестановок покрыты лучом; фактически ≤ BEAM_WIDTH × 3 фигуры × K_PLACE ≈ 150 симуляций хода на проверку, каждая — битовые операции. Бюджет: < 2 мс на среднем устройстве, вызывается только при выдаче руки. Пограничный случай: очистка линии внутри симуляции обязана обрабатывать камни как в §4.2 (камень не исчезает с первой очистки) — иначе солвер «увидит» несуществующее место.

### 3.5 Pity-система (анти-фрустрация после серии неудач)

Цель: удержать фактический fail rate в коридорах [03](03-core-gameplay.md) §5.2, гася хвост игроков, попавших в серию поражений (главный предиктор churn первой недели, где делается 89% ad-LTV).

```ts
type PityLevel = 0 | 1 | 2;
type PityState = { counter: number; level: PityLevel };

// Инкремент counter:
//  Путешествие: провал попытки уровня (level_fail)          → counter++
//  Классика:    партия < 40% скользящей медианы своего счёта → counter++
// Сброс: победа уровня / партия ≥ медианы → counter = 0.
// level = 0 при counter ≤ 1;  1 при counter ∈ {2,3};  2 при counter ≥ 4.
```

| Уровень | Эффекты (кумулятивно) |
|---------|------------------------|
| L1 (2–3 неудачи) | dEff − 0.08; вес SMALL ×1.25; BEAM_WIDTH солвера 8 → 16 |
| L2 (4+ неудач) | dEff − 0.15; гарантия: в каждой тройке ≥1 фигура размером ≤2; на fail-экране оффер RW-1 «+3 фигуры» подсвечен первым |

Ограничения (пограничные случаи):

1. **Честность лиг:** в Классике для игроков лиги Золото+ pity ограничен L1 и не сдвигает dEff — работают только директорские подсказки §3.3 в рамках того же мешка (статистика фигур неизменна). Иначе «удача фигур» ломает сравнение очков в турнире ([04](04-meta-progression.md) §5).
2. **Пол эффекта:** pity не может опустить расчётный fail rate сегмента ниже (цель §5.2 − 5 п.п.) — контролируется офлайн-ботом при тюнинге конфигов.
3. **Не складывается с передышкой:** на уровнях n mod 10 = 1 (spike = −0.06) применяется max(pity-скидка, скидка передышки), не сумма.
4. Каждый факт применения пишется событием `pity_applied {level, mode, dShift}` — новое событие в дереве [09](09-analytics-kpi.md) §2.1 (добавить при реализации).

### 3.6 Сводные инварианты генератора

| ID | Инвариант | Механизм |
|----|-----------|----------|
| INV-G1 | Тройка размещаема при выдаче | solveTriple + reroll ≤3 + форс-замена |
| G-H5 | ≤1 фигуры H=5 в тройке | drawTriple |
| G-70 | fill > 70% → SMALL ×1.5 | buildBag |
| G-DET | Выдача воспроизводима из сида партии | единый Rng, никаких Math.random |
| G-PITY | Pity не влияет на лиги Золото+ (кроме подсказок) | §3.5 п.1 |

## 4. Game over и очистка линий

### 4.1 Проверка размещаемости и fail state

```ts
function canPlace(b: Board, p: PieceDef, r: number, c: number): boolean {
  if (r + p.height > b.size || c + p.width > b.size) return false;
  for (let i = 0; i < p.height; i++) {
    const m = p.rowMasks[i] << c;
    if ((b.rows[r + i] & m) !== 0) return false;                 // пересечение с занятым
    if (b.mask && (b.mask[r + i] & m) !== m) return false;       // выход за маску поля (§6.4)
  }
  return true;
}

function canPlaceAny(b: Board, hand: Hand): boolean {
  for (const id of hand.pieces) {
    if (id === null) continue;
    const p = DEF[id];
    for (let r = 0; r <= b.size - p.height; r++)
      for (let c = 0; c <= b.size - p.width; c++)
        if (canPlace(b, p, r, c)) return true;                   // ранний выход
  }
  return false;
}
```

Вызывается **после каждого хода** (и после выдачи руки — assert INV-G1). `false` → fail state: пайплайн спасения [03](03-core-gameplay.md) §6 (Второй шанс / continue 200→400 монет / RW-1), затем game over. Сложность худшего случая: 3 × 64 позиций × ≤5 строковых AND — микросекунды; ghost-preview использует тот же canPlace.

«Второй шанс» (Классика): очистка 2 случайных рядов + 2 случайных столбцов (Rng партии; камни при этом удаляются полностью — спасение должно спасать), очки и комбо-цепь сохраняются, шкала Прилива сохраняется.

### 4.2 Разрешение хода: постановка, линии, камни, очки

```ts
type MoveResult = {
  linesCleared: number;       // строк + столбцов за ход
  points: number; coins: number;
  cleanBoard: boolean; crystalExploded: boolean;
  gameOver: boolean;
};

function resolveMove(b: Board, hand: Hand, slot: number, r: number, c: number,
                     combo: ComboState, surge: SurgeState): MoveResult {
  const p = DEF[hand.pieces[slot]!];
  assert(canPlace(b, p, r, c));
  stamp(b, p, r, c);                                   // rows |= маски фигуры
  // 1. Поиск полных линий (одновременно строки и столбцы — до удаления!)
  const fullRows = findFullRows(b);                    // rows[r] == fullMask(r)
  const fullCols = findFullCols(b);
  const lines = fullRows.length + fullCols.length;
  // 2. Удаление: обычные клетки исчезают; камень → треснувший; треснувший → исчезает
  for (const cell of cellsOf(fullRows, fullCols, b)) degradeCell(b, cell);
  // 3. Комбо и шкала (полный автомат — §5)
  const mult = combo.advance(lines > 0, hand);         // 1 | 2 | 3 | 5
  surge.onClear(lines, mult);
  // 4. Кристальный взрыв (§5.3): только если кристальная фигура участвовала в очистке
  let crystalPts = 0, exploded = false;
  if (slot === hand.crystalIndex && lines > 0) {
    crystalPts = explode3x3(b, centerCell(p, r, c));   // 40 + 1/клетку; не умножается
    exploded = true; surge.reset();
  } else if (slot === hand.crystalIndex) {             // кристалл «сожжён» без очистки
    surge.reset();                                     // эффект пропал, заряд сгорел (цена решения)
  }
  hand.pieces[slot] = null;
  if (slot === hand.crystalIndex) hand.crystalIndex = null;
  // 5. Очки и монеты (таблица 03 §2.2; монеты — 05 §2.1)
  const linePts = [0, 10, 30, 60, 100][Math.min(lines, 4)];
  const clean = isEmpty(b);                            // камни считаются непустотой
  const points = p.size + mult * linePts + crystalPts + (clean ? 300 : 0);
  const coins  = lines * mult;                         // 1 монета за линию × множитель
  // 6. Пустая рука → новая тройка; затем контроль fail state (INV-G2)
  if (hand.pieces.every(x => x === null)) Object.assign(hand, dealHand(b, ctx, rng));
  const over = !canPlaceAny(b, hand);
  return { linesCleared: lines, points, coins, cleanBoard: clean, crystalExploded: exploded, gameOver: over };
}
```

### 4.3 Пограничные случаи разрешения хода

| Случай | Правило |
|--------|---------|
| Линия содержит камень | Линия **считается** очищенной (очки/монеты/комбо/заряд начисляются), но клетка камня остаётся: камень → треснувший, треснувший → удалён (двойная очистка, [03](03-core-gameplay.md) §2.4) |
| Строка и столбец пересекаются | Клетка пересечения деградирует один раз (множество клеток, не мультимножество) |
| «Чистое поле» | +300 фиксированно, множителем комбо **не** умножается (множитель действует только на очки линий, [03](03-core-gameplay.md) §2.2); при наличии камней недостижимо |
| Очистка «Вторым шансом» | Не является ходом: комбо не двигается, заряд не растёт, монеты за линии не начисляются |
| Undo после кристальной очистки | Запрещён ([03](03-core-gameplay.md) §6): взрыв необратим; кнопка Undo (80 монет) гаснет на этот ход |
| Бустер Молот | Удаляет 1 клетку (камень — сразу полностью); не ход: комбо/заряд не двигаются |
| Бустер Обмен | Текущая рука сбрасывается, dealHand выдаёт новую тройку по тем же правилам §3.3 (SOLVENCY-CHECK обязателен) |

## 5. «Прилив»: комбо, шкала, кристальная бомба

### 5.1 Конечный автомат комбо

Правила [03](03-core-gameplay.md) §2.3: множитель растёт по **последовательным ходам с очисткой**: 2 подряд → ×2, 3 → ×3, 4+ → ×5 (потолок). Ход без очистки сбрасывает цепь, с одним прощением — первый ход новой тройки.

```ts
type ComboState = { chain: number; graceArmed: boolean };

function advance(this: ComboState, cleared: boolean, hand: Hand): 1 | 2 | 3 | 5 {
  if (cleared) {
    this.chain += 1;
    this.graceArmed = true;                    // прощение взводится заново каждой очисткой
  } else if (isFirstMoveOfHand(hand) && this.graceArmed) {
    this.graceArmed = false;                   // окно планирования: цепь не рвётся, но не растёт
  } else {
    this.chain = 0; this.graceArmed = false;
  }
  return this.chain >= 4 ? 5 : this.chain === 3 ? 3 : this.chain === 2 ? 2 : 1;
}
```

Пограничные случаи: (1) прощение действует ровно один раз между очистками — два нечистящих хода подряд рвут цепь всегда; (2) множитель применяется к очкам линий **текущего** хода (цепь 2 → этот ход уже ×2); (3) game over не обнуляет комбо до экрана результата — «Второй шанс» продолжает цепь (§4.1).

### 5.2 Шкала Прилива и спавн кристалла

```ts
type SurgeState = { charge: number; crystalPending: boolean; crystalOnBoard: boolean };

function onClear(this: SurgeState, lines: number, mult: number): void {
  if (lines === 0 || this.crystalPending || this.crystalOnBoard) return; // заряд заморожен при готовом кристалле
  this.charge = Math.min(100, this.charge + 10 * mult);   // заряд = 10 × множитель за чистящий ход
  if (this.charge >= 100) this.crystalPending = true;     // следующая выданная фигура — кристальная
}
function reset(this: SurgeState): void { this.charge = 0; this.crystalPending = false; this.crystalOnBoard = false; }
```

Номиналы: шкала 100; заряд за ход = 10 × текущий множитель (мультилинейный ход заряжает один раз — «каждая очистка», т.е. каждый чистящий ход). Тайпинг разгона: одиночные очистки — 10 ходов до кристалла; идеальная цепь 10+20+30+50 → кристалл за 4–5 чистящих ходов. Это соответствует референсной сессии [03](03-core-gameplay.md) §7 (к 3-й минуте ×3 и шкала 80%). Ивент «Неделя Прилива» ([08](08-liveops.md) §4): заряд ×1.25 (remote config `surge.chargeMult`).

Спавн: при crystalPending первая фигура следующей выдачи получает `crystalIndex` (§3.3), crystalPending → crystalOnBoard. Заряд заморожен на 100 до разрешения кристалла — второй кристалл в очередь не встаёт.

### 5.3 Взрыв 3×3

```ts
function centerCell(p: PieceDef, r: number, c: number): Cell {
  const cr = r + Math.floor((p.height - 1) / 2), cc = c + Math.floor((p.width - 1) / 2);
  // если геометрический центр bbox не принадлежит фигуре (TET_S, TRIO_L) —
  // ближайшая клетка фигуры по манхэттену, при равенстве — верхняя-левая
  return nearestPieceCell(p, r, c, cr, cc);
}

function explode3x3(b: Board, center: Cell): number {
  let removed = 0;
  for (const cell of neighborhood3x3(center, b))   // клип по границам поля и маске
    if (occupied(b, cell)) { degradeCell(b, cell); removed++; }
  return 40 + removed;                             // 03 §2.2: 40 + очки очищенных клеток (1/клетка)
}
```

Правила: взрыв срабатывает только если кристальная фигура участвовала в очистке линии этим ходом (§4.2); зона клипуется границами поля/маски; камни деградируют по общему правилу (камень → трещина); монеты за взрыв **не** начисляются (монеты — только за линии, [05](05-economy.md) §2.1); взрыв не порождает каскадных проверок линий (клетки удаляются напрямую). После взрыва — обычная проверка «чистого поля».

### 5.4 Сводка взаимодействия с очками (полный порядок начисления за ход)

```
points = size(piece)                        // постановка: 1/клетку
       + mult × linePts(lines)              // 10/30/60/100, умножается комбо
       + [кристалл: 40 + removedCells]      // не умножается
       + [чистое поле: 300]                 // не умножается
coins  = lines × mult                       // экономика, 05 §2.1
charge += 10 × mult (если lines > 0)        // до начисления кристального взрыва
```

## 6. Ежедневные «Фигурные поля»: генерация из сида даты

### 6.1 Сид и PRNG

```ts
function fieldSeed(localDate: string /* 'YYYY-MM-DD' */): number {
  return fnv1a32(`blocksurge:field:v1:${localDate}`);       // соль версионируется при смене логики
}
// PRNG — mulberry32: только uint32-арифметика → бит-в-бит одинаков на iOS/Android/JS.
function mulberry32(seed: number): Rng { /* стандартная реализация, без float-состояния */ }
```

Дата — **локальная** (поле дня исчезает в полночь устройства, [05](05-economy.md) §7). Пограничный случай: смена таймзоны может показать одно поле дважды — допускаем (бесплатный запуск всё равно 1/календарный день по локальным суткам; билеты не дублируются). Сервер публикует тот же seed для валидации рекордов и генерации share-изображений/deep link'ов ([04](04-meta-progression.md) §5).

### 6.2 Выбор маски дня и мутация

```ts
type MaskDef = { id: string; bitmap: Uint16Array /* 9×9 */; theme: string; weekend: boolean };

function fieldOfTheDay(localDate: string, season: SeasonContent): DailyField {
  const rng = mulberry32(fieldSeed(localDate));
  const isWeekend = dayOfWeek(localDate) >= 6;               // Сб/Вс: особое поле, награда ×1.5 (08 §2)
  const pool = (isWeekend ? season.weekendMasks : season.masks.concat(EVERGREEN_MASKS));
  // Окно неповторения 14 дней — без хранения истории: селекция пересчитывается
  // той же чистой функцией для 13 предыдущих дат (детерминизм, INV-G3)
  const recent = last13Dates(localDate).map(d => selectMaskId(d, season));
  const candidates = pool.filter(m => !recent.includes(m.id));
  const mask = weightedPick(candidates.length ? candidates : pool, rng);
  return mutate(mask, rng, isWeekend);
}

function mutate(m: MaskDef, rng: Rng, isWeekend: boolean): DailyField {
  let bm = m.bitmap;
  if (rng.next() < 0.5) bm = mirrorH(bm);                    // зеркало — бесплатная новизна
  if (rng.next() < 0.35) bm = toggleBoundaryCells(bm, rng, 3); // ±≤3 краевые клетки
  if (!validateMask(bm)) bm = m.bitmap;                      // мутация невалидна → откат к оригиналу
  return { bitmap: bm, rewardMult: isWeekend ? 1.5 : 1.0, dImplied: isWeekend ? 0.40 : 0.30 };
}
```

Пул: 6–10 сезонных масок + ~20 вечнозелёных ([08](08-liveops.md) §3 — маски производятся контент-конвейером и доставляются remote config'ом без релиза бинарника, [10](10-production.md) §2). Ивент «Марафон полей» подменяет селектор на фиксированную цепочку из 5 масок ивента (hook `fieldSelectorOverride`).

### 6.3 Валидация маски

Правила [03](03-core-gameplay.md) §4.3, исполняемые как чистая функция (используется и в контент-конвейере как pre-commit гейт, и в клиенте после мутации):

```ts
function validateMask(bm: Uint16Array): boolean {
  const cells = popcountAll(bm);
  if (cells < 45) return false;                          // V1: связная область ≥ 45 клеток
  if (!isConnected(bm)) return false;                    // V1: связность (flood-fill)
  const clearableRows = rowsWithCount(bm, c => c >= 4);  // V2: линии с <4 клетками — нечистимые
  const clearableCols = colsWithCount(bm, c => c >= 4);
  if (clearableRows.length + clearableCols.length < 6) return false; // V3: ≥6 чистимых линий,
  return true;                                           //      иначе поле «глухое» для ядра
}
```

V3 — директорское дополнение к главе 03 (маска может иметь короткие ряды, но игровых линий должно хватать для работы комбо и Прилива).

### 6.4 Очистка в пределах маски

Линия Фигурного поля = **все клетки маски** данной строки/столбца заполнены; строки/столбцы с числом клеток < 4 в очистке не участвуют (список `clearableRows/Cols` предвычисляется при загрузке поля). `canPlace` дополнительно требует вхождения фигуры в маску (§4.1). Очки, комбо, Прилив, монеты — по общим правилам §4–5; итоговая награда поля умножается на `rewardMult` (weekend ×1.5). Кристальный взрыв клипуется маской (§5.3).

## 7. Константы и трассировка к главам

| Константа | Значение | Источник |
|-----------|----------|----------|
| Поле / маска полей | 8×8 / 9×9 | [03](03-core-gameplay.md) §2.1, §2.4 |
| Каталог | 14 форм, H 1–5 | [03](03-core-gameplay.md) §4.1 |
| w_hard(D) | 0.10 + 0.45·D, потолок 0.55 | [03](03-core-gameplay.md) §5.1–5.2 |
| Антифрустрация fill > 70% | SMALL ×1.5 | [03](03-core-gameplay.md) §4.1 |
| Reroll / форс-замена | ≤3 / моно-домино | [03](03-core-gameplay.md) §4.1 |
| Очки линий | 10/30/60/100; комбо ×2/×3/×5 | [03](03-core-gameplay.md) §2.2–2.3 |
| Заряд шкалы | 10 × mult, шкала 100 | [03](03-core-gameplay.md) §2.3 |
| Кристалл | взрыв 3×3, 40 + 1/клетку | [03](03-core-gameplay.md) §2.2 |
| Чистое поле | 300, без множителя | [03](03-core-gameplay.md) §2.2 |
| Монеты за линию | 1 × mult | [05](05-economy.md) §2.1 |
| Маска: ≥45 клеток, линии ≥4 | V1–V2 | [03](03-core-gameplay.md) §4.3 |
| Weekend-поле ×1.5 | награда | [08](08-liveops.md) §2 |
| Fail-коридоры для pity | §5.2 главы 03 | [03](03-core-gameplay.md) §5.2 |

Открытые решения для Прохода А: точные пороги S (0.3/0.6), K_PLACE/BEAM_WIDTH под бюджет производительности, распределение весов внутри weekend-пула. Фиксируются ADR'ами ([10](10-production.md) §6) после прогонов автоплей-бота.

---

Следующее приложение: [12 — Симулятор экономики](12-economy-sim.md)
