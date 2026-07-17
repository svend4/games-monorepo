# 12 — Приложение: симулятор экономики

Навигация: [← Алгоритмы ядра](11-algorithms.md) | [README](README.md)

Статус: спецификация офлайн-инструмента (Node/TypeScript-скрипт, вне клиентского бандла). Назначение — проверять и калибровать экономику [05](05-economy.md) ДО того, как номиналы уйдут в remote config: гейт перед Проходом В (монетизация) по роадмапу [10](10-production.md). Все номиналы симулятор читает из единого конфига, значения которого — точные копии таблиц [05](05-economy.md) §2 и [06](06-monetization.md) §2; собственных «магических чисел» в коде симуляции нет.

Инварианты уровня документа:

- **INV-E1 (номиналы не мои):** цены, награды и капы — только из конфига, зеркалящего [05](05-economy.md)/[06](06-monetization.md). Симулятор тюнит **поведенческую модель игрока**, но никогда — номиналы (§8.3).
- **INV-E2 (детерминизм):** прогон воспроизводим из сида: PRNG — mulberry32, сид игрока = `fnv1a32('blocksurge:econsim:v1:{runId}:{playerId}')` — та же схема, что в [11](11-algorithms.md) §6.1.
- **INV-E3 (те же автоматы):** комбо и шкала Прилива — дословно конечные автоматы [11](11-algorithms.md) §5.1–5.2 (общий импортируемый модуль с ядром, не переписанная копия).
- **INV-E4 (баланс ≥ 0):** монеты не уходят в минус — любой sink гейтится проверкой баланса, как в продукте.

---

## 1. Границы модели: что симулируем и что нет

Симулятор **не переигрывает ядро** на уровне битборда — это делает автоплей-бот валидации уровней ([03](03-core-gameplay.md) §4.2). Здесь партия — агрегатная move-цепь:

| Слой | Как моделируется | Источник правды |
|------|------------------|-----------------|
| Очистки линий, комбо, Прилив | Бернулли-поток очисток + автоматы [11](11-algorithms.md) §5 | [03](03-core-gameplay.md) §2.2–2.3 |
| Исход партии (победа/провал) | Сэмплируется из целевых fail-коридоров [03](03-core-gameplay.md) §5.2 × скилл × pity | [03](03-core-gameplay.md) §5.2, [11](11-algorithms.md) §3.5 |
| Монеты, бустеры, билеты, стрик | Полная транзакционная модель, до монеты | [05](05-economy.md) §2 |
| Rewarded-решения | Вероятности принятия по сегментам, капы из [06](06-monetization.md) §2.2 | [06](06-monetization.md) §2 |
| IAP | В базовом прогоне отсутствует (таблица [05](05-economy.md) §4 — «без IAP»); сценарные инъекции — §6 | [06](06-monetization.md) §5 |
| Interstitial | Не моделируется (не трогает монетную экономику) | — |

Осознанное следствие: fail rate в симуляторе — вход (цель), а не эмерджентный выход. Симулятор отвечает на вопрос «что происходит с монетами, если сложность держит коридоры», а не «держит ли генератор коридоры» (это ответственность бота из [03](03-core-gameplay.md) §4.2 и pity-контроля [11](11-algorithms.md) §3.5).

## 2. Модель игрока: сегменты скилл × частота

### 2.1 Сетка сегментов и доли популяции

|  | LIGHT (2.0 сес/д) | CORE (3.0 сес/д) | HEAVY (4.5 сес/д) | Σ |
|--|--|--|--|--|
| **NOVICE** | 14% | 12% | 4% | 30% |
| **BASE** | 12% | **26%** | 12% | 50% |
| **SKILLED** | 4% | 12% | 4% | 20% |
| **Σ** | 30% | 50% | 20% | 100% |

Контрольные суммы (проверяются assert'ом при загрузке конфига):

- Взвешенные сессии/день: `0.30·2.0 + 0.50·3.0 + 0.20·4.5 = 3.00` — ровно KPI «Сессии/DAU = 3.0» ([09](09-analytics-kpi.md) §4).
- Взвешенный failMult: `0.30·1.4 + 0.50·1.0 + 0.20·0.4 = 1.00` — популяционный fail rate сходится к коридорам [03](03-core-gameplay.md) §5.2 (они заданы для популяции, а не для среднего игрока).
- Ячейка **BASE × CORE (26%)** — «базовый активный игрок» таблицы [05](05-economy.md) §4 (3.0 сессии/день, ~21 мин, ~1.8 rewarded/день). Калибровка §8 ведётся именно по этой ячейке.

### 2.2 Параметры скилла

```ts
type SkillTier = 'NOVICE' | 'BASE' | 'SKILLED';

type SkillParams = {
  pClear: number;      // P(ход очищает ≥1 линию): 0.30 / 0.35 / 0.42
  failMult: number;    // множитель к коридорам 03 §5.2: 1.4 / 1.0 / 0.4
  linesDist: number[]; // P(n линий | очистка): NOVICE/BASE [.78,.18,.035,.005]
                       //                       SKILLED     [.70,.24,.050,.010]
  crystalAim: number;  // добавка к P(кристалл участвует в очистке): 0.05 / 0.15 / 0.25
};
```

`pClear` и `linesDist` — стартовые значения; их первичная оценка снимается с автоплей-бота ([03](03-core-gameplay.md) §4.2), затем — с телеметрии `line_clear` ([09](09-analytics-kpi.md) §2.1). Средние линии за очистку: 1.25 (BASE) / 1.35 (SKILLED).

### 2.3 Параметры частоты

```ts
type FreqTier = 'LIGHT' | 'CORE' | 'HEAVY';

type FreqParams = {
  sessionsPerDay: number;   // 2.0 / 3.0 / 4.5
  gamesPerSession: number;  // 1.0 — медиана партии 6–9 мин ≈ длина сессии ~7 мин (03 §5.2, 09 §4)
  modeMix: { journey: number; classic: number; field: number };
  // LIGHT { .75, .10, .15 } | CORE { .65, .20, .15 } | HEAVY { .55, .35, .10 }
  skipDayP: number;         // пропуск дня: 0.20 / 0.05 / 0.01 (в SURVIVOR-режиме BASE×CORE = 0, см. §6)
};
```

Поле (`field`) выбирается не чаще 1 бесплатного запуска/день; второй запуск требует билета или RW-4 ([05](05-economy.md) §2.3).

### 2.4 Поведенческие склонности

```ts
type Propensity = {
  rwAccept: { rw1: number; rw2: number; rw3: number; rw4: number };
  // старт BASE×CORE: .45 / .40 / .30 / .25 — калибруются так, чтобы взвешенные показы/DAU
  // сошлись к 0.5 / 0.6 / 0.4 / 0.3 (06 §2.2), суммарно ≈1.8 rewarded/DAU
  continueCoinsP: (balance: number, progressPct: number) => number;
  // база 0.25; ×2 при progress ≥ 80% («обидный» провал); ×0 при balance < цены (INV-E4)
  boosterIntensity: { hammer: number; swap: number; undo: number };
  // базовые интенсивности использования за партию: 0.17 / 0.15 / 0.27 (BASE×CORE);
  // умножаются на stress(t) = failTarget(levelAt(t)) / 0.15 — спрос растёт со сложностью (05 §7 п.1)
  buySkinP: (balance: number) => number;  // 0, если balance < 1.2 × 1000; иначе 0.03/день
  buyTicketP: number;                     // 0.15/день при пройденном поле дня и балансе > 600
  restoreStreakP: number;                 // 0.40 при потере стрика ≥ 6 дней (05 §7 п.4), иначе 0.05
};
```

Приоритет средств на continue — как в продукте ([03](03-core-gameplay.md) §6): сначала RW-1 (бесплатно, 1/партию), затем монеты 200, второй continue — только 400.

## 3. Типы данных и конфигурация

```ts
// ---- Номиналы: зеркало 05 §2 / 06 §2. Единственное место, где встречаются эти числа. ----
const PRICES = {
  hammer: 150, swap: 120, undo: 80,          // бустеры, 05 §5
  continue1: 200, continue2: 400,            // 05 §5
  streakRestore: 100, fieldTicket: 150,      // 05 §2.1, §2.3
  skin: [1000, 5000],                        // диапазон витрины, 05 §2.1
} as const;

const EARN = {
  linePerMult: 1,                            // 1 монета × множитель за линию, 05 §2.1 = 11 §5.4
  levelWin: [25, 50], star3First: 20,        // 05 §2.1
  bossRewardMult: 2,                         // каждый 10-й уровень, 05 §2.1
  wheel: [30, 150], streakRamp: [30, 45, 60, 80, 100, 120, 150], // цикл 7 дней в диапазоне 30–150
  dailyMissionsMax: 220, weekly: [300, 500], tournament: [100, 500],
  chestAmortPerDay: 12,                      // сундуки глав 100–400, амортизированно
  ftueBonus: 200,                            // день 1, разово, 05 §3
} as const;

const CAPS = {
  rw1PerParty: 1, rw2PerDay: 3, rw3PerDay: 1, rw4PerDay: 2,   // 06 §2.2
  tickets: 3,                                                  // 05 §1
} as const;

type PlayerState = {
  id: number; skill: SkillParams; freq: FreqParams; prop: Propensity;
  coins: number;
  boosters: { hammer: number; swap: number; undo: number };    // инвентарь; расход — сначала из него
  tickets: number; streakDay: number; frozenStreak: boolean;
  levelMax: number;                          // прогресс Путешествия; сегменты сложности 03 §5.2
  pity: 0 | 1 | 2;                           // счётчик — по правилам 11 §3.5
  rwShownToday: { rw2: number; rw3: number; rw4: number };
  aliveUntil: number;                        // день churn (COHORT-режим), Infinity в SURVIVOR
};

type DayLog = {
  day: number; earn: number; spend: number;
  earnBySource: Record<string, number>; spendBySink: Record<string, number>;
  games: number; fails: number; continues: number; rwViews: number;
  crystals: number; clearingMoves: number;   // здоровье Прилива
  balanceEOD: number;
};
```

## 4. Модель партии (агрегатная move-цепь)

### 4.1 Ходы, комбо, Прилив

```ts
function simulateGame(pl: PlayerState, mode: Mode, rng: Rng): GameResult {
  const moves = movesBudget(mode, rng);
  // JOURNEY/FIELD: бюджет фигур уровня ≈ N(42, 8) — производное budget-формулы 03 §4.2;
  // CLASSIC: LogNormal, медиана 75 ходов ≈ партия 6–9 мин (03 §5.2)
  const combo: ComboState = newCombo();       // автомат 11 §5.1 (импорт из ядра, INV-E3)
  const surge: SurgeState = newSurge();       // автомат 11 §5.2
  let coins = 0, lines = 0, crystals = 0, clearingMoves = 0;

  for (let m = 0; m < moves; m++) {
    const firstOfHand = m % 3 === 0;          // рука = 3 фигуры (03 §2.1)
    if (surge.crystalPending && firstOfHand) {
      surge.crystalPending = false; surge.crystalOnBoard = true;  // спавн со следующей выдачей, 11 §5.2
    }
    const cleared = rng.next() < pl.skill.pClear;
    const n = cleared ? sampleLines(pl.skill.linesDist, rng) : 0;
    const mult = combo.advance(cleared, firstOfHand);             // 1|2|3|5, с прощением (11 §5.1)
    if (cleared) {
      clearingMoves++; lines += n;
      coins += n * mult * EARN.linePerMult;                       // монеты за линии, 05 §2.1
      surge.onClear(n, mult);                                     // заряд = 10 × mult, шкала 100 (11 §5.2)
    }
    if (surge.crystalOnBoard) {
      const explodes = cleared && rng.next() < clamp01(pl.skill.pClear + pl.skill.crystalAim);
      if (explodes) { crystals++; surge.reset(); }                // взрыв: очки, НЕ монеты (11 §5.3)
      else if (!cleared && rng.next() < 0.10) surge.reset();      // кристалл «сожжён» без очистки
    }
  }
  return { coins, lines, crystals, clearingMoves, moves, mode };
}
```

Санити-производные (BASE, journey): 42 хода × 0.35 ≈ 14.7 чистящих ходов × 1.25 линии ≈ 18 линий; средний множитель цепи ≈ 1.35 → **~24 монеты/партию** с линий. Одиночные очистки заряжают шкалу за 10 чистящих ходов ([11](11-algorithms.md) §5.2) → ≈ 1 кристалл/партию у BASE — согласуется с референсной сессией [03](03-core-gameplay.md) §7 (шкала 80% к 3-й минуте).

### 4.2 Исход партии, continue, pity

```ts
function resolveOutcome(pl: PlayerState, g: GameResult, log: DayLog, rng: Rng): void {
  if (g.mode !== 'JOURNEY') { applyClassicOrField(pl, g, log); return; }  // рекорды, монеты линий
  const boss = pl.levelMax % 10 === 0;
  const failP = failTarget(pl.levelMax, boss)      // коридоры 03 §5.2; босс — до 0.30 (05 §7 п.1)
              * pl.skill.failMult
              * PITY_RELIEF[pl.pity];              // 1.0 | 0.85 | 0.70 — модель эффектов dEff (11 §3.5)
  let failed = rng.next() < failP;

  if (failed) {
    log.fails++;
    const saved = tryContinue(pl, log, rng);       // RW-1 → 200 монет → (вторая жизнь) 400
    if (saved && rng.next() < 0.75) failed = false; // continue конвертирует провал в победу с P=0.75
  }
  if (!failed) {
    let reward = randInt(EARN.levelWin, rng) * (boss ? EARN.bossRewardMult : 1);
    if (rng.next() < 0.35) reward += EARN.star3First;              // первое 3★, 05 §2.1
    if (pl.rwShownToday.rw2 < CAPS.rw2PerDay && rng.next() < pl.prop.rwAccept.rw2) {
      reward *= 2; pl.rwShownToday.rw2++; log.rwViews++;           // RW-2 «×2 монеты», 06 §2.2
    }
    earn(pl, log, reward, 'level_win');
    pl.levelMax++; pl.pity = pityOnWin();                          // сброс счётчика, 11 §3.5
  } else {
    pl.pity = pityOnFail(pl.pity);                                 // инкремент/эскалация, 11 §3.5
  }
}

function tryContinue(pl: PlayerState, log: DayLog, rng: Rng): boolean {
  if (rng.next() < pl.prop.rwAccept.rw1) { log.rwViews++; log.continues++; return true; } // cap 1/партию
  if (pl.coins >= PRICES.continue1 &&
      rng.next() < pl.prop.continueCoinsP(pl.coins, progressPct())) {
    spend(pl, log, PRICES.continue1, 'continue1'); log.continues++; return true;
  }
  return false;   // continue2 (400) — только внутри уже спасённой партии; P мал, учтён в continueCoinsP
}
```

Бустеры расходуются внутри партии с интенсивностью `boosterIntensity × stress(t)`; сначала списывается инвентарь (подарки FTUE на уровнях 5/8/12, RW-3, сундуки — [05](05-economy.md) §2.2), при пустом инвентаре — покупка за монеты (это и есть sink), при нехватке монет действие не происходит (INV-E4).

## 5. Модель дня

### 5.1 Порядок дня (детерминированный пайплайн)

```ts
function simulateDay(pl: PlayerState, t: number, rng: Rng): DayLog {
  const log = emptyLog(t);
  pl.rwShownToday = { rw2: 0, rw3: 0, rw4: 0 };
  if (rng.next() < pl.freq.skipDayP) { onSkippedDay(pl, log, rng); return log; }  // стрик: потеря/восстановление

  if (t === 1) earn(pl, log, EARN.ftueBonus, 'ftue');              // 200 разово, 05 §3
  let wheel = weightedWheel(rng);                                   // 30–150, EV ≈ 40
  if (pl.rwShownToday.rw4 < CAPS.rw4PerDay && rng.next() < pl.prop.rwAccept.rw4)
    { wheel *= 2; pl.rwShownToday.rw4++; log.rwViews++; }           // RW-4 «×2 колеса», 06 §2.2
  earn(pl, log, wheel, 'wheel');
  streakTick(pl, log, rng);                                         // ramp 30→150 по циклу 7 дней

  const games = Math.round(pl.freq.sessionsPerDay * pl.freq.gamesPerSession * novelty(t, rng));
  // novelty(t) = 1 + 0.20·e^(−t/4): энтузиазм первых дней — реализация слагаемого 65·e^(−t/4)
  // формулы прихода 05 §4 через дополнительные партии, а не «монеты из воздуха»
  for (let g = 0; g < games; g++) {
    const res = simulateGame(pl, pickMode(pl, rng), rng);
    earn(pl, log, res.coins, 'lines'); resolveOutcome(pl, res, log, rng);
  }

  dailyMissions(pl, log, rng);          // EV ≈ 55 из max 220 (частичное закрытие; 05 §2.1)
  if (t % 7 === 0) weeklyBundle(pl, log, rng);   // weekly-миссии EV≈100 + турнир EV≈50 → всплеск ≈ +150 (05 §4)
  earn(pl, log, EARN.chestAmortPerDay, 'chests');
  rw3FreeBooster(pl, log, rng);         // 1/день, кладёт бустер в инвентарь (06 §2.2)
  shopDecisions(pl, log, rng);          // скин при balance > 1.2×цены; билет Поля; восстановление стрика
  log.balanceEOD = pl.coins;
  return log;
}
```

### 5.2 Декомпозиция прихода — стартовые EV (ячейка BASE×CORE, день ~9)

| Источник | EV/день, монет | Комментарий |
|----------|----------------|-------------|
| Линии (3 партии × ~20–24) | 60 | §4.1; часть партий обрывается провалом раньше бюджета |
| Победы уровней (2.1 × ~33 + 3★) | 75 | fail ~15% в сегменте 21–60 |
| Daily-миссии | 55 | частичное закрытие, max 220 |
| Колесо | 40 | 30–150, взвешено к нижним секторам |
| Стрик (цикл 7 дней, 30→150) | 84 | среднее ramp'а 585/7 |
| RW-2 ×2 победы | 16 | ~0.5 принятия/день × ~33 |
| RW-4 ×2 колеса | 4 | ~0.1 × 40 |
| Сундуки (амортизация) | 12 | 100–400 за главу |
| **Σ** | **≈ 346** | цель дня 9 по [05](05-economy.md) §4 — **330**; +4.8% снимается калибровкой §8 |

### 5.3 Декомпозиция расхода — стартовые EV (там же)

| Sink | EV/день, монет | Комментарий |
|------|----------------|-------------|
| Молот (0.5/д × 150) | 75 | интенсивность × stress(t) |
| Обмен (0.45/д × 120) | 54 | — |
| Отмена (0.8/д × 80) | 64 | самый частый, самый дешёвый ([05](05-economy.md) §5) |
| Continue №1 (0.35 провала × ~0.5 × 200) | 35 | после отказов от RW-1 |
| Continue №2 | 12 | редкий хвост |
| Билет Поля (0.15 × 150) | 22 | — |
| Восстановление стрика | 4 | всплесками при потере серии |
| Скины (амортизация редких покупок) | 40 | покупки начинаются при балансе > 1200 |
| **Σ** | **≈ 306** | цель дня 9 — **330**; разница добирается ростом stress(t) к дням 10+ (босс-уровни) |

Обе декомпозиции — это **стартовая точка оптимизатора**, а не утверждение баланса; их сумма обязана сойтись с таблицей [05](05-economy.md) §4 после §8.

## 6. Пайплайн симуляции 30 дней

```ts
type SimMode = 'SURVIVOR' | 'COHORT';
// SURVIVOR: все игроки активны 30 дней (без churn) — режим калибровки против 05 §4
//           (таблица главы 05 описывает удержанного игрока, а не среднего по когорте).
// COHORT:  день churn сэмплируется обратным преобразованием из кривой удержания 09 §5.1
//          (D1 38 … D30 6%); режим для метрик «на DAU» (rewarded/DAU и т.п.).

function runSim(cfg: SimConfig, mode: SimMode, N = 10_000, days = 30, runId: string): SimSummary {
  const players = range(N).map(i => spawnPlayer(i, cfg, mulberry32(seedOf(runId, i))));  // INV-E2
  const logs: DayLog[][] = [];
  for (let t = 1; t <= days; t++) {
    logs[t] = [];
    for (const pl of players) {
      if (mode === 'COHORT' && t > pl.aliveUntil) continue;
      logs[t].push(simulateDay(pl, t, pl.rng));
    }
  }
  return aggregate(logs, players, mode);
  // Один прогон N=10k×30 дней ≈ 1M партий-агрегатов — секунды; калибровка гоняет сотни прогонов.
}
```

Сценарные инъекции (флаги конфига, вне базового прогона): `injectIAP` (покупка пака S/M в окне дефицита — оценка «сколько дней дефицита закрывает $1.99», сверка с полкой [06](06-monetization.md) §5), `seasonPass` (билет/день — [05](05-economy.md) §2.3), `eventBudget` (проверка правила «бюджет ивента ≤ 15% недельного earn-rate», [05](05-economy.md) §6).

## 7. Выводимые метрики

| # | Метрика | Определение | Целевой коридор | Источник цели |
|---|---------|-------------|-----------------|---------------|
| M1 | `balance_median(t)` | Медиана баланса на конец дня, BASE×CORE, SURVIVOR | Таблица дней 1–30 ± 10% (пик ~1170 к дню 8, ~100 к дню 30) | [05](05-economy.md) §4 |
| M2 | `earn_spend_ratio(t)` | Σearn/Σspend по дню, популяция | 0.95–1.15 после D14 | [05](05-economy.md) §6 |
| M3 | `fail_rate(segment)` | Провалы/попытки по сегментам уровней | 0–2 / 5–10 / 12–18 / 18–25% (пики ≤30) | [03](03-core-gameplay.md) §5.2 |
| M4 | `rw_views_per_dau` | Показы RW1–RW4 на DAU, COHORT | ≈ 1.8 (0.5/0.6/0.4/0.3 по плейсментам) | [06](06-monetization.md) §2.2 |
| M5 | `continue_conversion` | Принятые/предложенные continue, сплит rw/coins | Выход (наблюдаемая), сверка с `continue_offer` | [09](09-analytics-kpi.md) §2.1 |
| M6 | `booster_spend_share(t)` | Доля бустеров в расходе | Рост с t синхронно fail-коридорам | [05](05-economy.md) §7 п.1 |
| M7 | `surge_games_pct` | % партий с ≥1 кристаллом | ≥ 60% (дизайн-цель здоровья фичи; валидируется ботом) | [09](09-analytics-kpi.md) §2.1 `surge_activated` |
| M8 | `deficit_share(t)` | % игроков с балансом < 200 (не хватает на continue №1) | ≥ 40% к D30; «зона дефицита» открывается в D25±2 | [05](05-economy.md) §4, §7 п.2 |
| M9 | `deep_deficit_share(t)` | % игроков с балансом < 400 (continue №2 «дорого») | Монотонный рост с D20 | [05](05-economy.md) §4 (день 27) |
| M10 | `hoard_share(t)` | % игроков с балансом > 5000 (ветераны-накопители) | ≤ 3% к D30; триггер «витрины недели» | [05](05-economy.md) §6 |
| M11 | `streak_survival(t)` | % игроков со стриком ≥ t (по циклу) | Выход; питает пуш-стратегию | [08](08-liveops.md) §5 |
| M12 | `iap_window_pressure` | % дней D25–30, где медиана < цены continue №2 | ≥ 50% — окно офферов работает | [05](05-economy.md) §7 п.2, [06](06-monetization.md) §5 |

Формат вывода: CSV по дням + сводный JSON с квантилями (p10/p50/p90) для каждой метрики; квантили обязательны — «средний игрок» скрывает и дефицитный хвост (M8), и накопителей (M10).

## 8. Калибровка против главы 05

### 8.1 Целевой вектор

```ts
const TARGETS = {
  balance05: BALANCE_TABLE_05_S4,        // 30 точек медианы баланса из таблицы 05 §4 (450…100)
  checkpoints: [1, 7, 8, 14, 21, 25, 30],// день 8 — пик 1170; день 25 — открытие дефицита 490; день 30 — 100
  earnFormula: (t: number) => 285 + 65 * Math.exp(-t / 4) + 150 * +(t % 7 === 0) + 200 * +(t === 1), // 05 §4
  ratioCorridor: [0.95, 1.15],           // после D14, 05 §6
  failCorridors: FAIL_TABLE_03_S52,      // 03 §5.2
  rwPerDau: { rw1: 0.5, rw2: 0.6, rw3: 0.4, rw4: 0.3 },  // 06 §2.2
};
```

### 8.2 Функция потерь и процедура

```ts
function loss(sim: SimSummary): number {
  const eBal  = mean(TARGETS.checkpoints.map(d =>
    sq((sim.balanceMedian[d] - TARGETS.balance05[d]) / TARGETS.balance05[d])));
  const eEarn = mean(range(1, 30).map(t =>
    sq((sim.earnMean[t] - TARGETS.earnFormula(t)) / TARGETS.earnFormula(t))));
  const eRatio = mean(range(15, 30).map(t => corridorPenalty(sim.ratio[t], TARGETS.ratioCorridor)));
  const eFail = mean(SEGMENTS.map(s => corridorPenalty(sim.failRate[s], TARGETS.failCorridors[s])));
  const eRw   = mean(PLACEMENTS.map(p => sq((sim.rwPerDau[p] - TARGETS.rwPerDau[p]) / TARGETS.rwPerDau[p])));
  return 1.0 * eBal + 0.6 * eEarn + 0.6 * eRatio + 0.8 * eFail + 0.4 * eRw;
}
```

Процедура — покоординатный спуск по ручкам в фиксированном порядке (от крупных к тонким), 200 прогонов × N = 2 000 на оценку точки, сид фиксирован (INV-E2 — иначе оптимизатор гоняется за шумом):

1. `dailyMissions.EV`, `wheel.EV` — крупнейшие свободные источники;
2. `pClear` (в пределах ±0.03 от оценки бота — дальше это уже спор с ядром, см. §8.4);
3. `continueCoinsP`, `boosterIntensity` — форма кривой расхода;
4. `weeklyBundle.EV` — высота недельных всплесков (цель +150);
5. `rwAccept.*` — подгонка M4 (последней: слабо влияет на баланс, сильно — на [06](06-monetization.md)).

Критерии приёмки калибровки: M1 в ±10% на всех чекпоинтах И M2 в коридоре И M3 в коридорах И M4 в ±15%. Результат — версионированный `econ-sim.baseline.json` в репозитории; любое изменение номиналов [05](05-economy.md) обязано прийти с перегонкой baseline (правило синхронных правок 05/06/09 — шапка [05](05-economy.md)).

### 8.3 Что запрещено тюнить (INV-E1)

Цены бустеров/continue, награды уровней, капы rewarded, ramp стрика, максимум миссий — это **продуктовые решения** глав [05](05-economy.md)/[06](06-monetization.md). Если баланс не сходится без их изменения — это не задача калибровки, а сигнал менять главу 05 (синхронно с 06/09, через ADR [10](10-production.md) §6), после чего симулятор перекалибровывается на новый целевой вектор.

### 8.4 Красные флаги (симулятор поймал проблему дизайна, а не свою)

| Флаг | Интерпретация |
|------|---------------|
| Сходится только при `pClear > 0.45` | Приход от линий в 05 §4 завышен против реального ядра — пересчитать таблицу 05 |
| M2 < 0.95 уже к D10 | Sinks агрессивнее плана: дефицит наступит до окна офферов D25–30 → фрустрация вместо конверсии |
| M8 < 20% к D30 при сошедшемся M1 | Дефицит есть у медианы, но не у распределения — точка дефицита [05](05-economy.md) §7 п.2 не работает как окно IAP |
| M10 > 5% к D30 | Инфляционный риск «ветеранов» ([05](05-economy.md) §6) недооценён — нужны sinks, а не правка симулятора |
| M7 < 40% | Прилив мёртв для медианного игрока — сверить `pClear`/заряд с ботом и [11](11-algorithms.md) §5.2 до правки экономики |

## 9. Пограничные случаи

| Случай | Правило симуляции |
|--------|-------------------|
| Баланс < цены sink'а | Действие не происходит (INV-E4); факт пишется в `denied_spend` — прямой измеритель точек дефицита |
| Капы rewarded | Сбрасываются на границе дня симуляции; RW-1 — на границе партии ([06](06-monetization.md) §2.2) |
| Билеты Поля | `min(tickets, 3)` — cap инвентаря ([05](05-economy.md) §1); покупка при полном стеке невозможна |
| Пропуск дня (skipDayP) | Стрик теряется; с P=`restoreStreakP` игрок платит 100 или смотрит RW-4 «спасти серию» (не чаще 1/день, [06](06-monetization.md) §2.2) |
| День 1 | + FTUE-бонус 200; interstitial-ограничения дня 1 не моделируются (вне монетной экономики) |
| Босс-уровень (levelMax % 10 = 0) | fail до 0.30, награда ×2, RW-3 доступен дополнительно («+1 на боссе», [06](06-monetization.md) §2.2); следующий уровень — передышка (spike −0.06, [03](03-core-gameplay.md) §5.1) |
| Pity и лиги | Экономический симулятор применяет pity всем (упрощение); ограничение «Золото+ без сдвига dEff» ([11](11-algorithms.md) §3.5 п.1) влияет на очки лиг, не на монеты — вне границ модели §1 |
| «Второй шанс» Классики | Не даёт монет за очищенные ряды (не ход — [11](11-algorithms.md) §4.3); в симуляции только продлевает партию |
| Кристальный взрыв | Очки, но не монеты ([11](11-algorithms.md) §5.3) — взрыв не участвует в earn |

## 10. Константы и трассировка к главам

| Константа | Значение | Источник |
|-----------|----------|----------|
| Цены: Молот/Обмен/Отмена | 150 / 120 / 80 | [05](05-economy.md) §5 |
| Continue №1/№2 | 200 / 400 | [05](05-economy.md) §5 |
| Монеты за линию | 1 × множитель (×2/×3/×5) | [05](05-economy.md) §2.1, [11](11-algorithms.md) §5.4 |
| Награда уровня / 3★ / босс | 25–50 / +20 / ×2 | [05](05-economy.md) §2.1 |
| Колесо / стрик / миссии | 30–150 / 30–150 / 220 (daily max), 300–500 (weekly) | [05](05-economy.md) §2.1 |
| FTUE-бонус / билет Поля / восстановление стрика | 200 / 150 / 100 | [05](05-economy.md) §2.1, §3 |
| Капы RW-1..4 | 1/партию, 3/д, 1/д, 2/д | [06](06-monetization.md) §2.2 |
| Fail-коридоры | 0–2 / 5–10 / 12–18 / 18–25 (пики 30)% | [03](03-core-gameplay.md) §5.2 |
| Сессии/день, партия | 3.0 / 6–9 мин | [09](09-analytics-kpi.md) §4, [03](03-core-gameplay.md) §5.2 |
| Кривая удержания (COHORT) | D1 38 … D30 6% | [09](09-analytics-kpi.md) §5.1 |
| Заряд Прилива | 10 × mult, шкала 100 | [11](11-algorithms.md) §5.2 |
| Коридор earn/spend | 0.95–1.15 после D14 | [05](05-economy.md) §6 |
| Целевая кривая баланса | Таблица дней 1–30 (450 → пик 1170 → 100) | [05](05-economy.md) §4 |

Открытые решения для реализации: точные `linesDist` по скиллам (снять с автоплей-бота), форма `continueCoinsP` (логистическая по progress), стоит ли выделять четвёртый частотный сегмент «weekend-only» для M11. Фиксируются ADR'ами ([10](10-production.md) §6) после первой перегонки baseline.

---

Предыдущее приложение: [11 — Алгоритмы ядра](11-algorithms.md)
