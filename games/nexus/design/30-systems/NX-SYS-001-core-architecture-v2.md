---
id: NX-SYS-001
title: Ядро v2 — исправленные ECS / EventBus / Services и контракты слоёв
type: system
status: proposed
layer: technical
abstraction: extended
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [core, ecs, eventbus, service-locator, object-pool, architecture, contracts, namespace]
relates_to: [NX-VIS-001, NX-SPEC-001, NX-SPEC-002, NX-SYS-002, NX-SYS-003, NX-SYS-004]
depends_on: []
comments_on: [NX-ARCH#sec4, NX-REVIEW#sec3-1, NX-REVIEW#sec6]
superseded_by: null
language: ru
---

# Ядро v2 — исправленные ECS / EventBus / Services и контракты слоёв

## TL;DR
Берём набор паттернов из [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (EventBus, ServiceLocator, ECS,
ObjectPool, StateMachine, GameLoop), но **с исправлениями из ревью** ([NX-REVIEW#sec3-1],
[NX-REVIEW#sec6]): `emit` по копии-снимку, `release` за O(1) через swap-and-pop, **archetype-ECS** вместо
O(n·m) скана, и честный отказ от «нулевых глобалов»-лозунга в пользу **единого namespace `NEXUS.*`**.
Документ фиксирует контракты слоёв (кто кого может звать) как исполнимое правило для код-ревью.

## Краткое содержание
`ARCHITECTURE.md` выбрал правильный скелет ядра, но подал его как «уже сделано ✅», тогда как в
коде (`shared/*.js`) всё построено на глобалах (`scene`, `MAT`, `pg`, `PS`, `enems`, `worldEvent`), а
эталонные листинги содержат баги (`emit` ломается при `off()` внутри обработчика, `ObjectPool.release`
= O(n), `World.query` = O(n·m) каждый кадр). Этот документ — **версия 2 ядра**: те же паттерны, но
с правками ревью, плюс два решения, которых в исходнике не было: переход к **архетипам ECS** и
**прагматичный namespace** вместо недостижимого «zero globals». Цель — дать второму рою (который пишет
реальный код по [NX-SPEC-001]/[NX-SPEC-002]) непротиворечивый, отлаженный фундамент, на который ложится
эхо-мир и живая симуляция из [NX-VIS-001].

## Расширенное содержание (общее)

### Что мы берём из ARCHITECTURE.md как есть
Ревью ([NX-REVIEW#sec1]) подтвердило, что выбор паттернов под заявленный масштаб корректен:
- **EventBus** — развязка систем (враг умер → `emit`, кто хочет — слушает).
- **ServiceLocator** — реестр сервисов вместо россыпи глобалов.
- **ECS** — сущности как ID, данные как компоненты, логика как системы.
- **ObjectPool** — частицы, числа урона, «эхо»-маркеры без аллокаций в горячем цикле.
- **StateMachine** — состояния игры (menu/loading/playing/paused/dead).
- **GameLoop** с фиксированным timestep — единственный листинг, который ревью признало
  каноническим без багов ([NX-REVIEW#sec1] п.2). Его не трогаем.

### Что мы исправляем (приоритет ревью над исходником)
По конституции вики ([NX-META-001] §2) `ARCHITECTURE_REVIEW.md` имеет приоритет над `ARCHITECTURE.md`
там, где они расходятся. Ядро v2 включает все правки из [NX-REVIEW#sec6] плюс два структурных решения:

| # | Было в ARCH (баг/долг) | В ядре v2 (исправление) | Источник |
|---|------------------------|--------------------------|----------|
| 1 | `emit` итерирует живой массив → теряет слушателей при `off`/`once` внутри | `emit` по **снимку** (`list.slice()`) | [NX-REVIEW#sec6] |
| 2 | `ObjectPool.release` = `indexOf`+`splice` (O(n), в горячем цикле O(n²)) | **swap-and-pop** с `obj.__i` (O(1)) | [NX-REVIEW#sec6] |
| 3 | `World.query` = `Object.keys`+вложенный цикл каждый кадр (O(n·m)) | **archetype-ECS**: сущности группируются по сигнатуре компонентов | новое (этот док) |
| 4 | «Правило нулевых глобальных переменных», но код целиком на глобалах | честный **namespace `NEXUS.*`** + ServiceLocator для рантайм-инстансов | новое (этот док) |
| 5 | `entity:died` без `tags` в payload → `TypeError` у подписчика | payload включает `tags`; каталог = единственный источник истины | [NX-REVIEW#sec3-3] |
| 6 | `StateMachine.back()` корректен один раз (пушит `null` и back) | не пушим историю при старте и при back-переходе | [NX-REVIEW#sec6] |
| 7 | `once` несовместим с `off(originalFn)` → утечка подписок | `once` возвращает токен-отписку | [NX-REVIEW#sec3-1] |

### Три контракта слоёв (исполнимое правило)
`ARCHITECTURE.md` ввёл правило «стрелка зависимостей всегда вниз» ([NX-ARCH#sec3]). Делаем его
проверяемым. Слои ядра v2 и **что им разрешено импортировать**:

```
СЛОЙ 0  core      EventBus, ServiceLocator, StateMachine, ObjectPool, Logger, Config
                  → не импортирует НИЧЕГО (даже Three.js). Чистый JS.
СЛОЙ 1  engine    GameLoop, InputManager, AudioSystem, AssetLoader, SaveSystem
                  → может: core. Не может: ecs, systems, world, ui.
СЛОЙ 2  ecs       World (archetypes), Entity, Component-схемы
                  → может: core. Не может: engine, systems, world, ui.
СЛОЙ 3  systems   Combat, Enemy, Loot, Quest, WorldEvents, AI, Movement…
                  → может: core, ecs. Общается с другими systems ТОЛЬКО через EventBus.
СЛОЙ 4  world/ui  Arena, NPC, HUD, Minimap, Overlay, Shop
                  → может: core, ecs, engine (read). Подписывается на события, не дёргает системы напрямую.
```
Правило-критерий для код-ревью: **импорт «вверх» по слоям = баг**; **прямой вызов чужой системы вместо
события = баг**. Это можно проверять линтером (граф зависимостей), что закрывает пробел
«нет CI/линта» из [NX-REVIEW#sec3-5].

## Детали и частные случаи

### EventBus: snapshot + безопасная отписка
Корень бага в исходнике — `emit` идёт `for`-циклом по `_listeners[event]`, а `off`/`once`
пересоздают массив через `.filter()` (см. `ARCHITECTURE.md:347-365`). На `entity:died` висит 4+
слушателя ([NX-ARCH#sec4]: Quest/Experience/Loot/HUD) — потеря слушателя реальна. Фикс из
[NX-REVIEW#sec6] — итерировать по `slice()`. Дополнительно: `once` обязан возвращать токен, иначе
снять подписку по `off(originalFn)` нельзя (внутренний `wrapper` недоступен вызывающему) —
[NX-REVIEW#sec3-1] ⚪.

### ObjectPool: O(1) release, без мутации при обходе
`release` через `indexOf`+`splice` в горячем цикле `FloatingText`/частиц даёт O(n²) — обратное смыслу
пула ([NX-REVIEW#sec3-1] 🟠). Решение — хранить индекс в `obj.__i` и делать swap-and-pop. `releaseAll`
не мутирует `_active` во время обхода (исходник делал `splice` в цикле — тоже O(n²)).
Это критично для эхо-маркеров ([NX-INN-003]/[NX-SPEC-002]): их может быть много на экране.

### Archetype-ECS: почему не «query каждый кадр»
`World.query` в исходнике (`ARCHITECTURE.md:483-495`) — `Object.keys(_entities)` + вложенный цикл по
требуемым компонентам, **каждый кадр для каждой системы**: O(n·m). Ровно та проблема, ради которой ECS
и заводят ([NX-REVIEW#sec3-2] 🟡). Ядро v2 группирует сущности по **архетипу** — битовой/строковой
сигнатуре набора компонентов. Система получает уже готовый список «всех с `[Transform, Health, AI]`»;
пересчёт — только при `addComponent`/`removeComponent`, а не каждый тик. Это классическая оптимизация
из data-oriented ECS (см. «Что нового и кирпичики»). Граничный случай: частая смена компонентов
(бафф/дебафф на 1 кадр) дёргает реиндексацию — для таких эфемерных свойств используем **флаги внутри
компонента**, а не отдельный компонент.

### Честные глобалы → namespace `NEXUS.*`
Ревью прямо зафиксировало ([NX-REVIEW#sec2]): код целиком на глобалах (`scene`, `MAT`, `pg`, `PS`,
`enems`, `worldEvent`), а «zero globals» — невыполненный лозунг. Реальный код `shared/systems/EnemySystem.js`
объявляет `var eDefs`, `var enems` в глобальной области и зависит от `scene, MAT, THREE, pg, PS`
(см. шапку файла). Притворяться, что глобалов нет, — нечестно ([NX-META-001] §2).

Прагматичное решение ядра v2: **один namespace-объект** `NEXUS`, внутри — три зоны:
- `NEXUS.core` — синглтоны ядра (EventBus, ServiceLocator, StateMachine, Config) — это допустимые
  «глобалы», потому что они и должны быть едиными на приложение.
- `NEXUS.svc` — рантайм-инстансы (`scene`, `camera`, `renderer`, `clock`) через ServiceLocator,
  не как голые переменные.
- **Данные контента** (`eDefs`, `QUESTS`, `SHOP_ITEMS`) уезжают в JSON ([NX-SYS-003]); в коде их
  заменяют загруженные таблицы, а не хардкод-массивы.

Итог: вместо ложного «0 глобалов» — **1 контролируемая точка входа** в глобальную область. Это
честно, проверяемо линтером (`no-implicit-globals` + запрет всего, кроме `window.NEXUS`) и совместимо
с тремя клиентами v1/v2/v3 ([NX-SYS-004]).

### Каталог событий — единственный источник истины
Ревью требует ([NX-REVIEW#sec5] п.10): у каждого события — **владелец-эмиттер**, payload фиксирован
каталогом. Баг `entity:died` без `tags` ([NX-REVIEW#sec3-1] 🟡) — прямое следствие отсутствия этого
правила. Полный каталог — в [NX-SPEC-001]; здесь фиксируем инвариант: **payload в каталоге = контракт;
расхождение листинга и каталога = баг.**

## Предложения и варианты реализации

Псевдокод ниже — заготовка для второго роя. Детальные сигнатуры и полный каталог событий — в
[NX-SPEC-001] (ядро) и [NX-SPEC-002] (пулы/эхо-маркеры).

```pseudo
// ── СЛОЙ 0: NEXUS namespace + EventBus (snapshot) ──────────────────
NEXUS = NEXUS || { core: {}, svc: {} }

NEXUS.core.EventBus = (function () {
  listeners = {}                                  // event -> [ {fn, ctx} ]
  function on(event, fn, ctx):
    (listeners[event] ||= []).push({fn, ctx})
    return { off: () => off(event, fn) }          // токен-отписка (фикс once/off)
  function off(event, fn):
    if listeners[event]:
      listeners[event] = listeners[event].filter(l => l.fn !== fn)
  function emit(event, data):
    list = listeners[event]; if not list: return
    snapshot = list.slice()                       // ФИКС: копия, безопасно к off/once внутри
    for l in snapshot: l.fn.call(l.ctx, data)
  function once(event, fn, ctx):
    token = on(event, d => { fn.call(ctx, d); token.off() }, ctx)
    return token                                  // ФИКС: вызывающий может отписаться
  return { on, off, emit, once }
})()

// ── СЛОЙ 0: ObjectPool (swap-and-pop, O(1)) ───────────────────────
ObjectPool(factory, reset):
  pool = []; active = []
  get():
    obj = pool.length ? pool.pop() : factory()
    obj.__i = active.length; active.push(obj); return obj
  release(obj):                                   // ФИКС: O(1)
    i = obj.__i; last = active.pop()
    if last !== obj: active[i] = last; last.__i = i
    reset(obj); pool.push(obj)
  releaseAll():
    for obj in active: reset(obj); pool.push(obj)  // без splice-в-цикле
    active.length = 0

// ── СЛОЙ 2: Archetype-ECS World ───────────────────────────────────
NEXUS.core.World = (function () {
  entities = {}                                   // id -> {id, comps:{}, archetype}
  archetypes = {}                                 // signature -> Set<id>
  function sig(comps): sort(keys(comps)).join('|')
  function reindex(e):
    if e.archetype: archetypes[e.archetype].delete(e.id)
    e.archetype = sig(e.comps)
    (archetypes[e.archetype] ||= new Set()).add(e.id)
  function createEntity(): id=nextId++; entities[id]={id,comps:{}}; reindex(entities[id]); return id
  function addComponent(id,name,c): entities[id].comps[name]=c; reindex(entities[id])
  function query(required):                       // ФИКС: O(matched), не O(n·m)
    out = []
    for (s, set) in archetypes:
      if required ⊆ parse(s):                      // проверка надмножества по сигнатуре
        out.push(...set)
    return out                                     // кэшируемо: пересчёт только при структурном изменении
  return { createEntity, addComponent, getComponent, query }
})()

// ── СЛОЙ 3: системы общаются только через EventBus ────────────────
// CombatSystem (владелец события entity:died — каталог в NX-SPEC-001):
EventBus.emit('entity:died', { entityId: en.id, xp: en.xp, gold: en.gold,
                               pos: en.pos, tags: en.tags })   // ФИКС: tags в payload
// LootSystem / QuestSystem / ExperienceSystem — подписчики, не зовут CombatSystem напрямую.
```

**Варианты по архетипам (развилка для [NX-SPEC-001]):**
- **A. Строковая сигнатура** (как выше) — просто, отлаживаемо, достаточно для масштаба прототипа
  (5 типов врагов, 1 зона по [NX-REVIEW#sec3-2]). Рекомендую для v2.
- **B. Битовые маски компонентов** — быстрее на сотнях архетипов, но требует реестра component→bit.
  Оверинжиниринг, пока нет реальных «500+ врагов».
- **C. Structure-of-Arrays (SoA)** — максимум кэш-локальности, но ломает простоту «компонент = объект».
  Отложить до доказанной нужды (бюджеты — [NX-SYS-005]).

## Риски, открытые вопросы
- **Реиндексация при частой смене компонентов** (эфемерные баффы) — митигируем флагами в компоненте;
  нужно замерить на реальном профиле.
- **Namespace `NEXUS.*` vs ES-модули.** Ревью ([NX-REVIEW#sec3-5]) справедливо ставит вопрос о
  бандлере. Namespace — мост на время прототипа; решение «ES-модули + Vite/esbuild» оставляем за
  [NX-SPEC-001]/отдельным документом по сборке.
- **Совместимость трёх клиентов.** v1 (3701 стр) и v2 (369 стр) — монолиты, 0 ссылок на `shared/`
  ([NX-REVIEW#sec2]). Внедрение ядра v2 реально касается v3; миграцию v1/v2 оговорить отдельно.
- **GameLoop не меняем** — но интерполяция `alpha` должна согласоваться с эхо-тиком сети ([NX-SYS-002]).
- **Каталог событий** должен вестись синхронно с кодом, иначе баг `entity:died` повторится в новом виде.

## Комментарии
Этот документ комментирует и исправляет раздел 4 `ARCHITECTURE.md` ([NX-ARCH#sec4]) и опирается на
готовые патчи ревью ([NX-REVIEW#sec6]). Два решения — archetype-ECS и namespace `NEXUS.*` — выходят за
рамки исходных правок ревью и предлагаются как улучшение. Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md) — северная звезда
- [NX-SPEC-001 Спека ядра + каталог событий](../40-specs/) — детальные сигнатуры (зависимый док)
- [NX-SPEC-002 Пулы и эхо-маркеры](../40-specs/) — применение ObjectPool в эхо-мире
- [NX-SYS-002 Сеть и эхо](./) · [NX-SYS-003 Данные и контент-пайплайн](./) · [NX-SYS-004 Рендер-абстракция](./)
- [ARCHITECTURE.md](../../ARCHITECTURE.md) (NX-ARCH) · [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) (NX-REVIEW)
- [Конституция вики](../00-meta/CONSTITUTION.md)
