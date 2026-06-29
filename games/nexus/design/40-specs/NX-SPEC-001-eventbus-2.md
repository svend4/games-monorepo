---
id: NX-SPEC-001
title: EventBus 2.0 — спека и псевдокод (исправленный pub/sub)
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [eventbus, pub-sub, core, layer0, contract, debug, priority, once, off, event-catalog]
relates_to: [NX-SYS-001, NX-SPEC-002, NX-VIS-001, NX-SYS-002]
depends_on: [NX-SYS-001]
comments_on: [NX-ARCH#sec4, NX-REVIEW#sec3-1, NX-REVIEW#sec6]
superseded_by: null
language: ru
---

# EventBus 2.0 — спека и псевдокод (исправленный pub/sub)

## TL;DR
Детальная спека шины событий слоя 0 для [NX-SYS-001]: `emit` идёт по **копии-снимку** списка
слушателей (чинит баг из [NX-REVIEW#sec3-1] 🟠), `once` хранит **ссылку на оригинальную функцию**,
чтобы её можно было снять через `off(originalFn)` (чинит ⚪-баг утечки подписок), плюс **приоритеты**
слушателей и встроенная **отладка** (трассировка, счётчики, защита от рекурсии). Это единственный
источник истины по **каталогу событий** NEXUS.

## Краткое содержание
`ARCHITECTURE.md` (раздел 4, [NX-ARCH#sec4]) дал EventBus как эталонный листинг для копирования —
но ревью ([NX-REVIEW#sec3-1]) нашло в нём два реальных бага: (1) `emit` итерирует **живой** массив, а
`off`/`once` пересоздают его через `.filter()`, из-за чего при отписке внутри обработчика часть
слушателей пропускается, а `once` снимает себя гарантированно при каждом срабатывании; (2) `once`
несовместим с `off(originalFn)` — снять подписку можно только по ссылке на внутренний `wrapper`,
которой у вызывающего нет, → утечка подписок. На событии `entity:died` висит 4+ слушателя
(Quest/Loot/Experience/HUD по [NX-ARCH#sec4]), так что потеря слушателя — не теория.

Этот документ фиксирует **исправленную** реализацию (snapshot-итерация + original-ссылка для `off`),
добавляет два полезных расширения, которых не было в исходнике (**приоритеты** и **режим отладки**),
и приводит **полный каталог событий** с владельцами-эмиттерами, как требует [NX-REVIEW#sec5] п.10. Это
прямой «детальный» (частный) слой под «расширенный» [NX-SYS-001], по принципу вики «от общего к
частному» ([NX-META-001] §5).

## Расширенное содержание (общее)

EventBus — нулевой слой ядра ([NX-SYS-001]: «СЛОЙ 0 core … не импортирует НИЧЕГО»). Он развязывает
системы: `CombatSystem` объявляет «враг умер» через `emit`, а `LootSystem`, `QuestSystem`,
`ExperienceSystem`, `HUD` слушают независимо и не знают друг о друге. Сегодня в коде этого нет вовсе:
`shared/systems/CombatSystem.js` прямо вызывает `spawnLoot()`, `checkQuests()`, `updHUD()` внутри
`attack()` (жёсткая связка, см. файл) — ровно тот клубок, который шина должна разрезать.

Спека закрывает три задачи:

1. **Корректность.** `emit` обязан вызвать **ровно те** слушатели, что были подписаны на момент
   старта рассылки, даже если обработчик отпишет себя или соседа (snapshot-семантика).
2. **Симметрия `on`/`off`/`once`.** На что подписался — то и можешь снять, по той же ссылке. `once`
   не должен ломать эту симметрию.
3. **Управляемость порядка и наблюдаемость.** Слушатель с более высоким приоритетом получает событие
   раньше (например, анти-чит-валидатор «эхо» из [NX-VIS-001#detali] раньше визуальных эффектов);
   режим отладки даёт трассировку и счётчики без правки кода систем.

## Детали и частные случаи

### Баг №1 — `emit` по живому массиву (snapshot-семантика)
Исходник (`ARCHITECTURE.md:347-365`): `emit` — `for`-цикл по `_listeners[event]`; `off`/`once`
делают `_listeners[event] = _listeners[event].filter(...)`. Когда обработчик внутри `emit` вызывает
`off`/`once`, ссылка `_listeners[event]` подменяется на **новый** массив, а цикл идёт по индексам —
часть слушателей пропускается, индексы «съезжают». Фикс ([NX-REVIEW#sec6]): итерировать по
`list.slice()` — копии на момент входа в `emit`. Подписки/отписки, сделанные обработчиком, вступят
в силу со **следующего** `emit` — это предсказуемая и желаемая семантика.

Граничные случаи snapshot:
- Слушатель `A` в обработчике делает `off(B)`. `B` уже в снимке → `B` **получит** текущее событие,
  но не следующие. Это корректно: на момент рассылки `B` был подписан.
- Слушатель добавляет нового слушателя `C` во время `emit`. `C` **не** в снимке → пропустит текущее
  событие, получит со следующего. Корректно (иначе — риск бесконечной рассылки).
- `once`-слушатель снимается **после** своего вызова, но из «живого» списка, не из снимка — повторно
  в этом же `emit` он не выстрелит (его в снимке ровно одна копия).

### Баг №2 — `once` и `off(originalFn)` (original-ссылка)
Исходник оборачивает пользовательскую `fn` во внутренний `wrapper` и кладёт в список **wrapper**.
Вызывающий держит ссылку только на `fn` → `off(event, fn)` не находит запись (там `wrapper`), подписка
живёт вечно ([NX-REVIEW#sec3-1] ⚪). Фикс: запись хранит **обе** ссылки — `fn` (оригинал) как ключ
сравнения для `off` и `wrapper` (что реально вызвать). `off(event, fn)` матчит по `record.orig === fn`.
Дополнительно `on`/`once` возвращают **токен-отписку** `{ off() }` — это совпадает с решением
[NX-SYS-001#detali] (раздел «EventBus: snapshot + безопасная отписка») и даёт два способа снять
подписку: по токену и по оригинальной функции.

### Расширение — приоритеты слушателей
Слушатель регистрируется с числовым `priority` (по умолчанию `0`). В рамках одного события слушатели
вызываются по убыванию приоритета; при равенстве — в порядке подписки (стабильно). Зачем: валидатор
«эхо»-данных (анти-чит, [NX-VIS-001#riski]) должен отработать **раньше**, чем `LootSystem` начнёт
спавнить дроп; HUD-обновление — **позже** игровой логики. Реализация — вставка с поддержанием
сортировки (список короткий, до ~5 слушателей на событие по [NX-ARCH#sec4]); сортируем при `on`, а не
при `emit`, чтобы горячий путь рассылки оставался линейным.

### Расширение — режим отладки
`EventBus.debug(true)` включает: счётчики `emit` по событиям, лог `[event] → N listeners`, замер
длительности рассылки, и **защиту от рекурсии** — если `emit(E)` происходит внутри обработки `E` глубже
порога (`MAX_DEPTH = 16`), шина бросает понятную ошибку вместо тихого переполнения стека. В релизе
весь debug-код за флагом `if (DEBUG)` — нулевая стоимость на горячем пути. Это закрывает пробел
«нет наблюдаемости/отладочных хуков» рядом с пробелом «нет тестов» из [NX-REVIEW#sec3-5].

### Каталог событий (единственный источник истины)
[NX-REVIEW#sec5] п.10 требует: у каждого события — **владелец-эмиттер**, payload фиксирован каталогом;
расхождение листинга и каталога = баг. [NX-SYS-001#detali] делегирует полный каталог сюда. Минимальный
контракт ядра (расширяется по мере роста систем):

| Событие | Владелец-эмиттер | Payload (контракт) | Слушатели |
|---|---|---|---|
| `entity:died` | CombatSystem | `{ entityId, xp, gold, pos, tags }` | Loot, Quest, Experience, HUD |
| `entity:damaged` | CombatSystem | `{ entityId, amount, source, pos }` | HUD, Particles, Audio |
| `player:levelUp` | ExperienceSystem | `{ level, hpGain, atkGain }` | HUD, Audio, Quest |
| `loot:dropped` | LootSystem | `{ item, amount, pos }` | World, HUD |
| `loot:picked` | LootSystem | `{ item, amount }` | Inventory, HUD, Quest |
| `quest:updated` | QuestSystem | `{ questId, progress, done }` | HUD, Audio |
| `echo:received` | NetworkSystem | `{ kind, payload, fromSession, validated }` | World, HUD, Audio |
| `state:changed` | StateMachine | `{ from, to }` | HUD, Audio, InputManager |

Инвариант: **поле `tags` в `entity:died` обязательно** — его отсутствие и есть баг
[NX-REVIEW#sec3-1] 🟡 (`data.tags.has('enemy')` → `TypeError`). Поле `validated` в `echo:received`
несёт результат серверной/клиентской проверки «эхо» из [NX-SYS-002]/[NX-VIS-001#riski] (анти-чит в
асинхронной модели).

## Предложения и варианты реализации

Псевдокод ниже — заготовка для второго роя. Совместим с namespace `NEXUS.*` из
[NX-SYS-001#detali] (живёт как `NEXUS.core.EventBus`). Чистый слой 0 — без Three.js, без ECS.

```pseudo
// ── NEXUS.core.EventBus 2.0 ───────────────────────────────────────
// Запись слушателя: orig — ключ для off; wrapper — что реально звать;
// priority — порядок; ctx — this. Список на событие отсортирован по priority desc.
record := { orig: fn, wrapper: fn, ctx: ctx, priority: p }

NEXUS.core.EventBus = (function () {
  listeners = {}              // event -> [record]  (по убыванию priority, стабильно)
  DEBUG = false
  counts = {}                 // event -> число emit (только в DEBUG)
  depth = 0                   // глубина вложенных emit (защита от рекурсии)
  MAX_DEPTH = 16

  function insertSorted(list, rec):
    // стабильная вставка: после всех с priority >= rec.priority
    i = 0
    while i < list.length and list[i].priority >= rec.priority: i++
    list.splice(i, 0, rec)

  function on(event, fn, opts = {}):
    rec = { orig: fn, wrapper: fn, ctx: opts.ctx, priority: opts.priority or 0 }
    insertSorted(listeners[event] ||= [], rec)
    return { off: () => removeRec(event, rec) }      // токен-отписка

  function once(event, fn, opts = {}):
    rec = null
    wrapper = (data) => { rec.off_internal(); fn.call(opts.ctx, data) }  // снять ДО вызова: повторный emit внутри не выстрелит снова
    rec = { orig: fn, wrapper: wrapper, ctx: opts.ctx, priority: opts.priority or 0 }
    rec.off_internal = () => removeRec(event, rec)
    insertSorted(listeners[event] ||= [], rec)
    return { off: rec.off_internal }                 // ФИКС ⚪: можно снять и токеном, и off(fn)

  function off(event, fn):
    list = listeners[event]; if not list: return
    // ФИКС ⚪: матч по ОРИГИНАЛУ, не по wrapper — работает и для once
    listeners[event] = list.filter(r => r.orig !== fn)

  function removeRec(event, rec):
    list = listeners[event]; if not list: return
    idx = list.indexOf(rec); if idx >= 0: list.splice(idx, 1)

  function emit(event, data):
    list = listeners[event]; if not list or list.length == 0: return this
    if DEBUG:
      counts[event] = (counts[event] or 0) + 1
      if ++depth > MAX_DEPTH:
        depth--; throw Error("EventBus: рекурсия > " + MAX_DEPTH + " на '" + event + "'")
    snapshot = list.slice()                          // ФИКС 🟠: копия — безопасно к off/once внутри
    try:
      for r in snapshot:                             // уже отсортирован по priority
        r.wrapper.call(r.ctx, data)
    finally:
      if DEBUG: depth--
    return this

  // ── Отладка (нулевая стоимость в релизе за флагом) ──
  function setDebug(on): DEBUG = on
  function stats(): return DEBUG ? counts : {}
  function listenerCount(event): return (listeners[event] or []).length

  return { on, once, off, emit, debug: setDebug, stats, listenerCount }
})()

// ── Пример использования (слой 3, общение только через шину) ──────
// CombatSystem — владелец entity:died (каталог выше):
EventBus.emit('entity:died', { entityId: en.id, xp: en.xp, gold: en.gold,
                               pos: en.pos, tags: en.tags })   // ФИКС: tags обязателен

// Анти-чит «эхо» слушает РАНЬШЕ всех (высокий приоритет):
EventBus.on('echo:received', validateEcho, { priority: 100 })
// Loot/HUD — приоритет по умолчанию 0, отработают после валидатора.
```

**Развилки реализации:**
- **A. Список записей + сортировка при `on`** (как выше) — просто, отлаживаемо, линейный `emit`;
  оптимально при ≤5 слушателях на событие ([NX-ARCH#sec4]). **Рекомендую.**
- **B. Две очереди (`pre`/`post`) вместо числового priority** — грубее, но без сортировки; годится,
  если приоритет нужен только «до/после игровой логики».
- **C. Микро-батчинг `emit` в конце кадра** (event queue, flush в GameLoop) — убирает реентрантность
  целиком, но ломает синхронные ожидания (`emit` → немедленный эффект). Отложить до [NX-SYS-005],
  где считаются бюджеты кадра; согласовать с `alpha`-интерполяцией GameLoop ([NX-SYS-001#riski]).

**Тестируемость (закрывает пробел [NX-REVIEW#sec3-5]):** шина — слой 0 без зависимостей, поэтому
юнит-тесты тривиальны. Обязательные кейсы: off-внутри-обработчика не теряет соседа; `once` стреляет
ровно раз; `off(originalFn)` снимает `once`-подписку; приоритет соблюдается; рекурсия > `MAX_DEPTH`
бросает ошибку в DEBUG.

## Риски, открытые вопросы
- **Реентрантность `emit` внутри `emit`.** Snapshot решает корректность, но глубокая вложенность —
  запах дизайна. `MAX_DEPTH` ловит только катастрофу; разумную глубину держим code-review’ом.
  Альтернатива — вариант C (батчинг), отложен.
- **`once` и приоритет.** Если `once`-слушатель снимает себя до вызова `fn`, а `fn` бросает исключение,
  подписка уже снята (это намеренно — иначе риск двойного срабатывания). Поведение при исключении в
  обработчике: `try/finally` гарантирует декремент `depth`, но **не** изолирует слушателей друг от
  друга; нужно ли оборачивать каждый вызов в `try/catch` — открытый вопрос (стоимость vs живучесть).
- **Каталог событий ↔ код.** Если каталог и реальные `emit` разойдутся, баг `entity:died`-без-`tags`
  воспроизведётся в новом виде ([NX-SYS-001#riski]). Нужен лёгкий рантайм-валидатор payload в DEBUG.
- **Глобальность шины.** Один `NEXUS.core.EventBus` на приложение — допустимый «глобал» по
  [NX-SYS-001#detali], но для трёх клиентов v1/v2/v3 нужно убедиться, что шина не шарится между
  несовместимыми мирами (изоляция инстансов при необходимости).

## Комментарии
Документ комментирует и детализирует раздел 4 `ARCHITECTURE.md` ([NX-ARCH#sec4]), реализует патч
[NX-REVIEW#sec6] (snapshot) и ⚪-фикс [NX-REVIEW#sec3-1] (original-ссылка для `off`). Два расширения —
приоритеты и debug-режим — выходят за рамки исходных правок ревью и предлагаются как улучшение
наблюдаемости/детерминизма. Это `proposed`/детальный слой под `proposed`/расширенный [NX-SYS-001];
зрелость — `analyzed`, не `prototyped` (реального кода нет). Возражения — в `90-comments/`.

## Связанные документы
- [NX-SYS-001 Ядро v2 — ECS/EventBus/Services](../30-systems/NX-SYS-001-core-architecture-v2.md) — родительский системный документ (depends_on)
- [NX-SPEC-002 Пулы и эхо-маркеры](./) — применение ObjectPool/событий в эхо-мире (планируется)
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md) — северная звезда (анти-чит «эхо», приоритеты)
- [NX-SYS-002 Сеть и эхо-слой](../30-systems/NX-SYS-002-netcode-echo-layer.md) — источник `echo:received`
- [ARCHITECTURE.md](../../ARCHITECTURE.md) (NX-ARCH) · [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) (NX-REVIEW)
- [Конституция вики](../00-meta/CONSTITUTION.md)
