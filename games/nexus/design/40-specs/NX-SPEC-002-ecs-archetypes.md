---
id: NX-SPEC-002
title: ECS с архетипами и индексами — спека и псевдокод (O(1) add/remove, кэш query)
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [ecs, archetypes, component-index, query-cache, data-oriented, core, layer2, performance, contract]
relates_to: [NX-SYS-001, NX-SPEC-001, NX-VIS-001, NX-SYS-005, NX-SYS-002]
depends_on: [NX-SYS-001]
comments_on: [NX-ARCH#sec4, NX-REVIEW#sec3-2, NX-REVIEW#sec6]
superseded_by: null
language: ru
---

# ECS с архетипами и индексами — спека и псевдокод (O(1) add/remove, кэш query)

## TL;DR
Детальная спека ECS-`World` слоя 2 для [NX-SYS-001]: вместо `World.query`, который у исходника
([NX-ARCH#sec4]) был **O(n·m) каждый кадр** ([NX-REVIEW#sec3-2] 🟡), храним сущности в **архетипах**
(группы с одинаковым набором компонентов) и **компонент→Set(id)-индексах**, `addComponent`/
`removeComponent` делают **swap-and-pop за O(1)**, а результат `query([Transform,Health,AI])` берётся из
**кэша** и пересчитывается только при структурном изменении, а не на каждом тике. Это «детальный»
(частный) слой под «расширенным» [NX-SYS-001] по принципу «от общего к частному» ([NX-META-001] §5).

## Краткое содержание
`ARCHITECTURE.md` завёл ECS «правильно по форме» — сущности как ID, данные как компоненты, логика как
системы, — но эталонный `World.query` (`ARCHITECTURE.md:483-495`) перебирал `Object.keys(_entities)` и
для каждой сущности вложенным циклом проверял наличие всех требуемых компонентов: **O(n·m) на систему
на кадр**. Ревью прямо назвало это «ровно та проблема, ради которой ECS и заводят» ([NX-REVIEW#sec3-2]).
В реальном коде ECS вообще нет: `shared/systems/EnemySystem.js` держит обычный массив `var enems = []`
из 5 захардкоженных врагов и итерирует его в `tickEnemies(dt,t)` — никакого индекса по компонентам.

Этот документ фиксирует **архетипную** реализацию `World` с двумя дополняющими механизмами доступа —
**архетипы** (для запросов «все с таким-то набором») и **обратные индексы `component → Set(entityId)`**
(для запросов «все, у кого есть компонент X», и для пересечений), — плюс **кэш результатов query** с
инвалидацией по версии структуры. Цель — отдать второму рою отлаженную O(1)-на-мутацию,
O(matched)-на-запрос заготовку, на которую лягут системы боя, AI, эхо-маркеров и живой симуляции из
[NX-VIS-001]. Решение про архетипы введено на общем уровне в [NX-SYS-001] (таблица правок, строка 3);
здесь — детальные сигнатуры, граничные случаи и развилки.

## Расширенное содержание (общее)

ECS-`World` — слой 2 ядра ([NX-SYS-001]: «СЛОЙ 2 ecs … может: core. Не может: engine, systems, world,
ui»). Системы слоя 3 (Combat, Enemy, AI, Movement, Loot) **не** держат собственные массивы сущностей и
**не** трогают чужие данные напрямую — они спрашивают у `World` список ID по сигнатуре компонентов и
общаются между собой только через EventBus ([NX-SPEC-001]). Сегодня этого разделения нет: `enems[]`
живёт прямо в `EnemySystem`, а `CombatSystem` дёргает соседей напрямую (см. [NX-SPEC-001#kratkoe]).

Спека закрывает три задачи, вытекающие из [NX-REVIEW#sec3-2]:

1. **Дешёвый запрос.** `query(required)` обязан возвращать готовый список сущностей с набором
   компонентов `required` за время, пропорциональное **числу подходящих**, а не общему числу сущностей.
2. **Дешёвая мутация.** `addComponent`/`removeComponent`/`destroyEntity` меняют принадлежность сущности
   архетипу и индексам за **O(1)** (swap-and-pop, как `ObjectPool` из [NX-SYS-001#detali]), без
   `indexOf`/`splice` по большому массиву.
3. **Стабильность под итерацией.** Система может создавать/убивать сущности **во время** обхода
   результата query (бой порождает дроп, смерть — эхо-маркер) без «съезжающих индексов» — за счёт
   снимка результата, по аналогии со snapshot-семантикой EventBus ([NX-SPEC-001#detali]).

Два механизма доступа дополняют друг друга:

- **Архетип** — точная группа «ровно компоненты `{A,B,C}`». Идеален, когда запросов вида «все
  `[Transform, Health, AI]`» немного и наборы стабильны. Минус: запрос «все с `Health`» обходит много
  архетипов (любой, где есть `Health`).
- **Обратный индекс `component → Set(id)`** — «все, у кого есть компонент X». Идеален для разреженных
  одиночных компонентов (`EchoMarker`, `Dead`, `Frozen`) и для **пересечения** нескольких множеств.
  Минус: для запроса из 3+ компонентов нужно пересекать 3 Set.

`World` держит **оба** и выбирает дешёвейший путь под конкретный запрос (эвристика — в «Деталях»).

## Детали и частные случаи

### Архетип = сигнатура набора компонентов
Сигнатура — детерминированная строка из отсортированных имён компонентов: `sig({Transform,Health,AI})
= "AI|Health|Transform"`. Сущность принадлежит **ровно одному** архетипу в любой момент. `archetypes`
— это `Map<signature, ArchetypeBucket>`, где bucket хранит:
- `ids` — плотный массив `entityId` (итерируется системами; swap-and-pop при удалении);
- `pos` — `Map<entityId, index>` (позиция в `ids` для O(1) удаления);
- `components` — данные компонентов (вариант хранения — развилка A/C ниже).

Создание/удаление компонента **переселяет** сущность из старого архетипа-bucket в новый: удалить из
старого (swap-and-pop), добавить в новый (push). Обе операции — O(1). Это data-oriented паттерн из
Unity DOTS / flecs / EnTT (см. «Что нового и кирпичики» в [NX-SYS-001#chto-novogo]); мы берём его
**кирпичиком**, упрощённым до строковых сигнатур под масштаб прототипа ([NX-REVIEW#sec3-2]: реально 5
типов врагов, 1 зона).

### Обратный индекс `component → Set(entityId)`
Параллельно архетипам ведём `index: Map<componentName, Set<entityId>>`. При `addComponent(id, "AI")` —
`index["AI"].add(id)`; при `removeComponent` — `delete`. Set даёт O(1) add/delete/has. Зачем дублировать
информацию, которая уже есть в архетипах:
- запрос «все с `Dead`» = просто `index["Dead"]`, без обхода архетипов;
- запрос из нескольких компонентов = **пересечение Set’ов**, начиная с самого маленького (классическая
  оптимизация «iterate the smallest set»). Для `[Transform, Health, AI]`: берём наименьший из трёх
  `index`-Set и фильтруем по `has` в остальных двух → O(min·k), а не O(n·m).

### query: выбор стратегии и кэш
`query(required)` выбирает путь:
1. Если `required` — это **точная** известная сигнатура с «горячим» bucket — вернуть `bucket.ids`
   (O(1) доступ к готовому списку; самый частый случай в горячем цикле систем).
2. Иначе — **пересечение обратных индексов** наименьшего Set (надмножество: сущность годится, если
   имеет **все** `required`, даже если у неё есть и лишние компоненты).

Результат **кэшируется** в `queryCache: Map<requiredKey, {ids, version}>`. У `World` есть
`structVersion` — счётчик, инкрементируемый при **любом** структурном изменении (создание/уничтожение
сущности, add/remove компонента). При вызове `query` сравниваем `cache.version` со `structVersion`:
совпало — отдаём кэш как есть; нет — пересчитываем и обновляем версию. Так в пределах кадра, где
структура не менялась, все системы читают один и тот же закэшированный список **бесплатно**.
Это прямой ответ на «нет архетипов/индексов/кэша» из [NX-REVIEW#sec3-2].

Тонкость инвалидации: глобальный `structVersion` инвалидирует **весь** кэш при любой мутации — грубо,
но просто и корректно. Если профиль ([NX-SYS-005]) покажет, что мутации часты, а запросов много —
переходим на **по-компонентные версии** (кэш `[Transform,Health,AI]` инвалидируется только при
изменении одного из этих трёх индексов). Это развилка B ниже; для прототипа глобальной версии хватает.

### Стабильность под итерацией (snapshot результата)
Система AI обходит `query([Transform, Health, AI])`; внутри обработки враг умирает → `destroyEntity`
меняет архетип-bucket и индексы прямо во время обхода. Если система итерирует **живой** `bucket.ids`,
индексы «съедут» (тот же класс бага, что `emit` по живому массиву в [NX-SPEC-001#detali]). Контракт:
система обходит **снимок** (`ids.slice()` или захваченный кэш-результат текущей версии); мутации
вступают в силу со следующего query. Для горячих циклов, где slice дорог, даём `queryStable()`,
возвращающий иммутабельную ссылку на кэш-результат текущей версии (он не мутируется на месте —
пересчёт создаёт новый массив).

### O(1) add/remove/destroy (swap-and-pop)
Удаление сущности из `bucket.ids`: берём `i = bucket.pos.get(id)`, кладём в позицию `i` последний
элемент, укорачиваем массив, чиним `pos` для перемещённого. Идентично `ObjectPool.release` из
[NX-SYS-001#detali] — тот же проверенный приём против O(n) `indexOf`+`splice` ([NX-REVIEW#sec6]).
`removeComponent` = удалить из старого bucket + удалить из `index[old]` + добавить в новый bucket +
обновить `index`-Set’ы + `structVersion++`.

### Граничный случай — эфемерные компоненты (баффы на 1 кадр)
Частая смена компонентов (бафф/дебафф/`Frozen` на один тик) дёргает переселение между архетипами и
инкремент `structVersion` каждый раз — это убивает кэш query. [NX-SYS-001#detali] уже предписал решение:
**для эфемерных свойств — флаги внутри компонента**, а не отдельный компонент. То есть `Frozen` живёт
как поле `status.frozenUntil` в долгоживущем компоненте `Status`, и системы проверяют флаг, не меняя
архетип. Архетипы — для **структурно стабильных** наборов; флаги — для быстро мигающих состояний. Это
прямое продолжение риска «реиндексация при частой смене компонентов» из [NX-SYS-001#riski].

### Граничный случай — пустой архетип и «архетип без компонентов»
Только что созданная `createEntity()` без компонентов попадает в архетип с пустой сигнатурой `""`. Это
валидно (например, «пустые» эхо-якоря, которым компоненты добавят позже). Пустой bucket после ухода
последней сущности **не удаляем сразу** (чтобы не плодить аллокации при частом пере-заселении); сборка
пустых bucket’ов — отдельным проходом или по порогу, не на горячем пути.

## Предложения и варианты реализации

Псевдокод ниже — заготовка для второго роя. Живёт как `NEXUS.core.World` (слой 2) и совместим с
namespace `NEXUS.*` из [NX-SYS-001#detali]. Чистый слой — без Three.js, без систем.

```pseudo
// ── NEXUS.core.World — archetype-ECS + обратные индексы + кэш query ──
NEXUS.core.World = (function () {
  entities   = {}                 // id -> { id, archetype:signature }
  archetypes = new Map()          // signature -> { ids:[], pos:Map<id,idx>, comps:Map<name,Map<id,data>> }
  index      = new Map()          // componentName -> Set<id>     (обратный индекс)
  queryCache = new Map()          // requiredKey -> { ids:[], version }
  structVersion = 0               // ++ при любом структурном изменении
  nextId = 1

  // --- утилиты сигнатуры ---
  function sigOf(names): return sort(names).join('|')         // детерминированная строка
  function bucketFor(signature):
    if not archetypes.has(signature):
      archetypes.set(signature, { ids: [], pos: new Map(), comps: new Map() })
    return archetypes.get(signature)

  // --- bucket: O(1) добавление/удаление (swap-and-pop, как ObjectPool) ---
  function bucketAdd(b, id):
    b.pos.set(id, b.ids.length); b.ids.push(id)
  function bucketDel(b, id):
    i = b.pos.get(id); last = b.ids.pop()
    if last !== id: b.ids[i] = last; b.pos.set(last, i)   // переставили хвост на место i
    b.pos.delete(id)

  // --- индекс: component -> Set<id> ---
  function indexAdd(name, id): (index.get(name) || index.set(name,new Set()).get(name)).add(id)
  function indexDel(name, id): if index.has(name): index.get(name).delete(id)

  // --- структурные операции (каждая делает structVersion++) ---
  function createEntity():
    id = nextId++; e = { id, archetype: "" }; entities[id] = e
    bucketAdd(bucketFor(""), id); structVersion++; return id

  function componentsOf(id):                                // имена компонентов сущности
    return parse(entities[id].archetype)                   // "" -> [], "A|B" -> [A,B]

  function migrate(id, newNames):                           // переселить сущность в новый архетип
    e = entities[id]; oldSig = e.archetype; newSig = sigOf(newNames)
    if oldSig === newSig: return
    bucketDel(bucketFor(oldSig), id)                        // O(1)
    e.archetype = newSig
    bucketAdd(bucketFor(newSig), id)                        // O(1)

  function addComponent(id, name, data):
    names = componentsOf(id); if name in names: /*перезапись данных*/ else names.push(name)
    migrate(id, names)
    bucketFor(entities[id].archetype).comps
        .getOrCreate(name).set(id, data)                   // данные компонента
    indexAdd(name, id); structVersion++

  function removeComponent(id, name):
    names = componentsOf(id).filter(n => n !== name)
    migrate(id, names); indexDel(name, id); structVersion++

  function destroyEntity(id):
    for name in componentsOf(id): indexDel(name, id)
    bucketDel(bucketFor(entities[id].archetype), id)       // O(1)
    delete entities[id]; structVersion++

  function getComponent(id, name):
    return bucketFor(entities[id].archetype).comps.get(name)?.get(id)

  // --- query: кэш по structVersion, иначе пересечение наименьшего Set ---
  function query(required):                                // required = [имена компонентов]
    key = sigOf(required)
    cached = queryCache.get(key)
    if cached and cached.version === structVersion:
      return cached.ids                                    // ПОПАДАНИЕ В КЭШ: O(1)
    ids = compute(required)
    queryCache.set(key, { ids, version: structVersion })
    return ids

  function compute(required):
    if required.length === 0: return allIds()
    // 1) обратные индексы: берём наименьший Set и фильтруем по остальным
    sets = required.map(n => index.get(n) || EMPTY_SET)
    smallest = minBy(sets, s => s.size)
    out = []
    for id in smallest:
      if forall n in required: index.get(n).has(id):       // надмножество: есть ВСЕ required
        out.push(id)
    return out                                             // O(min.size * required.length)

  // --- стабильный обход: снимок результата на момент вызова ---
  function queryStable(required): return query(required).slice()   // безопасно к мутациям в цикле

  return { createEntity, destroyEntity, addComponent, removeComponent,
           getComponent, query, queryStable }
})()

// ── Пример (слой 3): AISystem обходит снимок, может убивать в цикле ──
ids = World.queryStable(['Transform','Health','AI'])       // стабильно к destroyEntity внутри
for id in ids:
  ai = World.getComponent(id, 'AI'); tr = World.getComponent(id, 'Transform')
  decide(ai, tr)
  if dead(id):
    EventBus.emit('entity:died', { entityId:id, xp:.., gold:.., pos:tr.pos, tags:.. }) // NX-SPEC-001
    World.destroyEntity(id)                                // O(1); кэш инвалидируется через structVersion
```

**Развилки реализации:**
- **A. Архетип-bucket хранит данные компонентов как `Map<name, Map<id,data>>`** (как выше) — просто,
  «компонент = объект», отлаживаемо. Достаточно для масштаба прототипа ([NX-REVIEW#sec3-2]).
  **Рекомендую для v2.**
- **B. По-компонентные версии вместо глобального `structVersion`.** Кэш `[Transform,Health,AI]`
  инвалидируется только при мутации одного из этих трёх индексов. Меньше лишних пересчётов при частых
  мутациях, но сложнее учёт. Включать по данным профиля ([NX-SYS-005]).
- **C. Structure-of-Arrays (SoA): параллельные типизированные массивы на архетип.** Максимум
  кэш-локальности и SIMD-дружелюбности, но ломает простоту «компонент = JS-объект» и усложняет
  add/remove. Отложить до доказанной нужды («500+ врагов» из [NX-REVIEW#sec3-2] пока маркетинг шапки).
- **D. Битовые маски компонентов вместо строковых сигнатур** (реестр `component→bit`, сигнатура = int).
  Быстрее на сотнях архетипов; для 5 типов врагов — оверинжиниринг (та же развилка, что в
  [NX-SYS-001#predlozheniya], вариант B).

**Тестируемость (закрывает пробел [NX-REVIEW#sec3-5]):** `World` — слой без Three.js/систем, юнит-тесты
тривиальны. Обязательные кейсы: `query` после add/remove возвращает корректное множество; повторный
`query` без мутаций — попадание в кэш (тот же массив/версия); `destroyEntity` в цикле по `queryStable`
не теряет соседей; swap-and-pop сохраняет все ID (нет дублей/потерь); эфемерный флаг **не** переселяет
архетип; пересечение берёт наименьший Set.

## Что нового и какие кирпичики

> Раздел не обязателен для `spec`, но коротко — откуда взяты решения (по [NX-META-001] §7).

- **Проверенные кирпичики (c20-proven / технические дисциплины):** archetype-ECS из data-oriented
  движков (Unity DOTS, flecs, EnTT), обратные индексы и пересечение «наименьшего множества» из теории
  баз данных (bitmap/inverted index, выбор плана по селективности), swap-and-pop из управления пулами
  ([NX-SYS-001#detali]), snapshot-итерация — из [NX-SPEC-001].
- **Что здесь, по сути, не новое, а исправление долга:** в браузерных играх ECS часто пишут наивно
  (скан каждый кадр) — ровно то, что было в `ARCHITECTURE.md`. Ценность спеки — довести «правильную
  форму» до «правильной сложности».
- **Чего мало в вебе:** комбинация *архетипы + обратные индексы + версионный кэш query* в маленьком
  браузерном ядре под бюджет кадра 16 мс ([NX-SYS-005]) — обычно либо тяжёлый нативный ECS, либо
  наивный JS. Здесь — лёгкий компромисс под три клиента v1/v2/v3 ([NX-SYS-004]).

## Риски, открытые вопросы
- **Грубая инвалидация кэша.** Глобальный `structVersion` обнуляет весь кэш при любой мутации; в кадре
  с частыми спавнами/смертями кэш может почти не «жить». Митигируем: батчить структурные изменения к
  концу кадра (как вариант C батчинга в [NX-SPEC-001#predlozheniya]) или перейти на развилку B. Решает
  профиль [NX-SYS-005].
- **Стоимость переселения архетипа.** Каждый add/remove компонента копирует ссылку на данные между
  bucket’ами. При «широких» сущностях (много компонентов) это не бесплатно; для прототипа приемлемо,
  но эфемерные свойства обязаны идти флагами ([NX-SYS-001#riski]).
- **Память индексов.** Дублирование «архетип + обратный индекс» удваивает учётные структуры. Для сотен
  сущностей незначимо; для десятков тысяч — мерить (бюджеты [NX-SYS-005]).
- **Согласованность архетип ↔ индекс.** Два источника правды о принадлежности компонента легко
  рассинхронизировать при ошибке в `migrate`. Нужен DEBUG-инвариант: `index[name]` == объединение
  bucket’ов, содержащих `name` (рантайм-проверка в режиме отладки, по аналогии с DEBUG EventBus
  [NX-SPEC-001#detali]).
- **Совместимость клиентов.** v1/v2 — монолиты на `enems[]` без ECS ([NX-REVIEW#sec2]); внедрение
  `World` реально касается v3, миграцию v1/v2 оговорить отдельно ([NX-SYS-001#riski]).

## Комментарии
Документ детализирует решение «archetype-ECS» из [NX-SYS-001] (таблица правок, строка 3) и реализует
претензию ревью [NX-REVIEW#sec3-2] (🟡 `World.query` = O(n·m)). Это `proposed`/детальный слой под
`proposed`/расширенным [NX-SYS-001]; зрелость — `analyzed`, **не** `prototyped` (реального кода ECS в
`shared/*` нет — там `enems[]`-массив). Параллелен по структуре [NX-SPEC-001] (EventBus): тот — слой 0,
этот — слой 2. Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-SYS-001 Ядро v2 — ECS/EventBus/Services](../30-systems/NX-SYS-001-core-architecture-v2.md) — родительский системный документ (depends_on), решение про архетипы
- [NX-SPEC-001 EventBus 2.0 — спека и псевдокод](./NX-SPEC-001-eventbus-2.md) — соседняя спека слоя 0; snapshot-семантика и каталог событий
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md) — северная звезда (живой мир, эхо-маркеры как сущности)
- [NX-SYS-005 Бюджет симуляции мира](../30-systems/NX-SYS-005-world-simulation-budget.md) — где решаются развилки B/C по данным профиля
- [NX-SYS-002 Сеть и эхо-слой](../30-systems/NX-SYS-002-netcode-echo-layer.md) — эхо-маркеры как сущности World
- [ARCHITECTURE.md](../../ARCHITECTURE.md) (NX-ARCH) · [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) (NX-REVIEW)
- [Конституция вики](../00-meta/CONSTITUTION.md)
</content>
</invoke>
