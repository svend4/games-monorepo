---
id: NX-SPEC-008
title: ECS — финальный API (createEntity/addComponent/query, индексы component→Set, архетипы) + тесты
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [ecs, world, archetypes, component-index, inverted-index, query-cache, swap-and-pop, es-modules, modern-first, contract, layer2, performance, acceptance-tests]
relates_to: [NX-SPEC-002, NX-SYS-001, NX-SPEC-001, NX-SPEC-006, NX-STRAT-004, NX-VIS-004, NX-SYS-005, NX-SYS-004]
depends_on: [NX-SPEC-002, NX-SYS-001]
comments_on: [NX-SPEC-002#predlozheniya, NX-STRAT-004#princip-sovremennoe-pervym]
superseded_by: null
maturity: analyzed
language: ru
---

# ECS — финальный API (createEntity/addComponent/query, индексы component→Set, архетипы) + тесты

## TL;DR
Финальный, **реализуемый и стек-агностичный** контракт ECS-`World` (слой 2 ядра, [NX-SYS-001]),
переводящий «analyzed»-эскиз [NX-SPEC-002] в **точные сигнатуры** (TS-подобно), **форматы данных**,
**инварианты**, **критерии приёмки** и **минимальные тест-кейсы**. Ядро `World` хранит сущности в
**архетипах** (группа с одинаковым набором компонентов) **и** в **обратных индексах
`component → Set<EntityId>`**; `createEntity`/`addComponent`/`removeComponent`/`destroyEntity`
переселяют сущность между bucket-ами **swap-and-pop за O(1)**; `query(required)` берёт результат из
**кэша по `structVersion`**, а при промахе пересекает **наименьший** индекс-`Set` за `O(min·k)` вместо
`O(n·m)`. По принципу «современное-первым» ([NX-STRAT-004]) `World` — **чистый ES-модуль** на
современных коллекциях (`Map`/`Set`, `structuredClone`); никакой персистентности/сети/PHP в ядре нет —
журналирование и серверный мультиплеер подключаются **снаружи, за интерфейсом** (субстрат [NX-SPEC-006],
эхо-сервер [NX-SPEC-003]), а не как часть `World`.

## Краткое содержание
[NX-SPEC-002] зафиксировал *подход* (архетипы + обратные индексы + версионный кэш) на уровне
«analyzed» с псевдокодом в стиле `NEXUS.core.World = (function(){…})()` (IIFE + namespace). Этот
документ — **контракт второго роя**: что именно компилятор/линтер/тест увидят как публичный API, какие
гарантии у каждого метода, какие структуры данных лежат под капотом, какие инварианты обязаны
выполняться в любой момент, и какой набор тестов считается «зелёным» порогом приёмки. Здесь **ничего
концептуально нового** относительно [NX-SPEC-002] — это его *детализация до сигнатур и приёмки* по
принципу «от общего к частному» ([NX-META-001] §5).

Два уточнения относительно [NX-SPEC-002], продиктованные принципом «современное-первым»
([NX-STRAT-004#princip-sovremennoe-pervym]):

1. **Форма поставки — ES-модуль, а не IIFE-namespace.** `NEXUS.*`-namespace из [NX-SYS-001] был
   «мостом на время прототипа»; финальный контракт — `export`-функции/класс ES-модуля (`world.js`),
   импортируемые статически. Namespace-обёртка остаётся **опциональным легаси-адаптером** (тонкий
   shim `window.NEXUS.core.World = World`) для старых клиентов v1/v2 ([NX-SYS-004]), **не** ядром.
2. **`World` ничего не персистит и не сетевизирует.** Журнал записей (event-sourcing), сейв и
   мультиплеер — **отдельный слой 1** (субстрат [NX-SPEC-006]) и **внешние адаптеры**. `World` — это
   *текущее состояние в памяти*. PHP/сервер касаются `World` только косвенно: внешняя система читает
   `query`, пишет `Record` в субстрат; обратно — субстрат проецируется в компоненты вызовами
   `addComponent`. Это держит ядро ECS чистым и тестируемым без браузера/сервера.

## Расширенное содержание (общее)

### Место `World` в архитектуре слоёв
```
СЛОЙ 0  EventBus            — нотификации (entity:created/destroyed, опционально)   [NX-SPEC-001]
СЛОЙ 1  Substrate           — append-only журнал Record (персист/сеть за адаптером) [NX-SPEC-006]
СЛОЙ 2  World (ЭТОТ ДОК)    — текущее состояние: entities + components + индексы     [NX-SPEC-008]
СЛОЙ 3  Системы/Линзы       — Combat/Enemy/AI/Movement/Loot читают через query      [NX-SYS-001]
```
`World` **может**: знать про `EventBus` (опционально, через инъекцию — для `entity:destroyed`).
`World` **не может**: импортировать Three.js, системы слоя 3, DOM, сеть, персистентность, субстрат
слоя 1 (однонаправленность: субстрат/системы читают `World`, `World` их — нет). Это та же дисциплина
слоёв, что в [NX-SPEC-002] и [NX-SYS-001] («ecs … не может: engine, systems, world, ui»).

### Что именно поставляется (поверхность модуля)
Один ES-модуль `world.js` экспортирует:
- `createWorld(opts?) → World` — **фабрика** (рекомендуемая форма; несколько независимых миров для
  тестов/слоёв/реплеев). Заменяет глобальный синглтон-IIFE из [NX-SPEC-002].
- `class World` (или замыкание с тем же интерфейсом) — публичные методы ниже.
- `defineComponent(name, schema?) → ComponentType` — **опционально**, реестр компонентов (для
  валидации в DEBUG и под будущие битовые маски — развилка D из [NX-SPEC-002]).

Публичный API минимален и совпадает по именам с эскизом [NX-SPEC-002] (`createEntity`, `addComponent`,
`removeComponent`, `destroyEntity`, `getComponent`, `hasComponent`, `query`, `queryStable`) плюс
сервисные `has`, `count`, `forEach`, `clear` и DEBUG-инвариант `checkInvariants()`.

### Два механизма доступа (как в [NX-SPEC-002], кратко)
- **Архетип** — `Map<Signature, ArchetypeBucket>`; сущность принадлежит **ровно одному** архетипу.
  Хорош для «горячего» точного запроса «ровно/как минимум `[Transform,Health,AI]`» и итерации списком.
- **Обратный индекс** — `Map<ComponentName, Set<EntityId>>`. Хорош для «все с `X`» и для **пересечения**
  нескольких множеств, начиная с **наименьшего** (выбор плана по селективности).
`World` держит оба и в `query` выбирает дешёвейший путь.

## Детали и частные случаи

### Форматы данных (нормативно)

```ts
// ── Идентификаторы и базовые типы ─────────────────────────────────
type EntityId   = number;          // > 0; 0 зарезервирован как "нет сущности"
type ComponentName = string;       // имя компонента; регистронезависимо НЕ нормализуется (точное совпадение)
type Signature  = string;          // отсортированные имена через '|', напр. "AI|Health|Transform"; "" = пустой архетип
type ComponentData = object;       // произвольный JS-объект данных компонента (см. инвариант I7)

// ── Внутреннее представление сущности ─────────────────────────────
interface EntityRec {
  id: EntityId;
  archetype: Signature;            // текущая сигнатура (источник истины о наборе компонентов)
}

// ── Архетип-bucket: плотный массив + позиции + данные ─────────────
interface ArchetypeBucket {
  signature: Signature;
  ids: EntityId[];                          // плотный массив (итерируется системами)
  pos: Map<EntityId, number>;               // id -> индекс в ids (для swap-and-pop за O(1))
  comps: Map<ComponentName, Map<EntityId, ComponentData>>;  // данные компонентов (развилка A из NX-SPEC-002)
}

// ── Результат query ───────────────────────────────────────────────
interface QueryResult {
  ids: ReadonlyArray<EntityId>;    // только чтение; мутировать нельзя (инвариант I6)
  version: number;                 // structVersion на момент вычисления (для отладки/кэша)
}

// ── Опции мира ────────────────────────────────────────────────────
interface WorldOptions {
  bus?: EventBusLike | null;       // опциональная инъекция EventBus (NX-SPEC-001); по умолчанию null
  debug?: boolean;                 // включает checkInvariants() в каждой мутации (по умолч. false)
  cloneOnAdd?: boolean;            // structuredClone(data) при addComponent (по умолч. false; см. I7)
}

interface EventBusLike { emit(event: string, data?: unknown): void; }  // структурная типизация, без зависимости
```

### Сигнатуры публичного API (нормативно)

```ts
interface World {
  // ── Жизненный цикл сущностей ──
  createEntity(components?: Record<ComponentName, ComponentData>): EntityId;
  // Создаёт сущность. Если передан объект компонентов — атомарно добавляет их все ОДНОЙ миграцией
  // (одно переселение архетипа, один structVersion++), а не по одному. Возвращает новый EntityId.

  destroyEntity(id: EntityId): boolean;
  // Удаляет сущность из bucket-а и всех индексов (swap-and-pop, O(1) на компонент). Идемпотентна:
  // повторный вызов на несуществующем id возвращает false и НЕ инкрементирует structVersion.

  isAlive(id: EntityId): boolean;            // существует ли сущность; O(1)

  // ── Компоненты ──
  addComponent(id: EntityId, name: ComponentName, data?: ComponentData): World;
  // Добавляет/перезаписывает компонент. Если компонента не было — переселяет архетип (structVersion++).
  // Если был — только перезаписывает data (БЕЗ миграции и БЕЗ structVersion++, см. I8). Возвращает this
  // (чейнинг). Бросает RangeError, если id мёртв.

  removeComponent(id: EntityId, name: ComponentName): World;
  // Удаляет компонент: переселяет архетип, чистит индекс, structVersion++. Если компонента не было —
  // no-op без structVersion++ (идемпотентна). Возвращает this.

  getComponent<T = ComponentData>(id: EntityId, name: ComponentName): T | undefined;
  // Возвращает данные компонента или undefined. O(1). НЕ бросает на мёртвом id (возвращает undefined).

  hasComponent(id: EntityId, name: ComponentName): boolean;   // O(1)

  // ── Запросы ──
  query(required: ReadonlyArray<ComponentName>): ReadonlyArray<EntityId>;
  // Возвращает ВСЕ живые сущности, имеющие КАК МИНИМУМ все компоненты required (надмножество).
  // Результат кэшируется по structVersion: при отсутствии мутаций возвращает ТОТ ЖЕ массив (===).
  // Пустой required ([]) => все живые сущности. Порядок ids НЕ гарантирован стабильным между
  // пересчётами (инвариант I5). Сложность: попадание в кэш O(1); промах O(min·k), k=required.length.

  queryStable(required: ReadonlyArray<ComponentName>): EntityId[];
  // Как query, но возвращает СНИМОК (новый массив, slice). Безопасен к мутациям World во время обхода
  // результата (destroyEntity/addComponent в цикле). Использовать в системах слоя 3, меняющих мир.

  count(required?: ReadonlyArray<ComponentName>): number;     // число подходящих; O(1) при попадании в кэш

  forEach(required: ReadonlyArray<ComponentName>,
          fn: (id: EntityId, world: World) => void): void;
  // Удобный обход по СНИМКУ (внутри использует queryStable): fn может безопасно мутировать мир.

  // ── Сервис/отладка ──
  clear(): void;                              // удаляет все сущности; сбрасывает индексы; structVersion++
  checkInvariants(): void;                    // DEBUG: бросает Error при нарушении I1..I9 (см. ниже)
  readonly structVersion: number;             // монотонный счётчик структурных изменений (для кэша/тестов)
  readonly size: number;                      // число живых сущностей
}

// ── Фабрика (точка входа модуля) ──
function createWorld(opts?: WorldOptions): World;
```

Соответствие именам [NX-SPEC-002] (стабильность контракта): `createEntity`, `addComponent`,
`removeComponent`, `destroyEntity`, `getComponent`, `query`, `queryStable` — **сохранены 1:1**.
Добавлены `isAlive`/`hasComponent`/`count`/`forEach`/`clear`/`checkInvariants` и переименование
`createEntity()`-IIFE-фабрики в `createWorld()` ES-модуля (см. «современное-первым» выше).

### Эвристика выбора пути в `query` (нормативное поведение, не реализация)
`query(required)` обязан вернуть множество, **эквивалентное** «все живые с надмножеством `required`».
Внутренняя стратегия (не наблюдаема снаружи, кроме сложности):
1. `key = sigOf(required)`; если `queryCache.get(key).version === structVersion` → вернуть кэш (`===`).
2. Промах: взять `Set`-ы `index.get(n)` для каждого `n ∈ required`; выбрать **наименьший**; пройтись
   по нему и оставить `id`, у которых `index.get(n).has(id)` для всех остальных `n`. Результат —
   `O(smallest.size · required.length)`. Записать в кэш с `version = structVersion`.
3. `required.length === 0` → вернуть все живые `id` (тоже кэшируется).
Отсутствующий компонент (нет в `index`) ⇒ результат пуст (один из `Set`-ов — `EMPTY`), кэшируется.

### Инварианты (обязаны выполняться ВСЕГДА; `checkInvariants()` проверяет в DEBUG)
- **I1. Один архетип.** Каждая живая сущность присутствует ровно в одном `ArchetypeBucket.ids` и
  именно в том, чья `signature === entities[id].archetype`.
- **I2. Плотность позиций.** Для каждого bucket: `pos.size === ids.length`, и
  `∀i: pos.get(ids[i]) === i` (swap-and-pop не оставляет дыр и не путает позиции).
- **I3. Согласованность индекса.** Для каждого `name`: `index.get(name)` === множество всех живых `id`,
  чей архетип содержит `name`. (Два источника правды — архетип и индекс — не расходятся.)
- **I4. Сигнатура детерминирована.** `entities[id].archetype === sigOf(componentsOf(id))`, имена
  отсортированы, разделитель `'|'`, пустой набор ⇒ `""`.
- **I5. Корректность множества query.** `query(R)` возвращает ровно `{ id живой : R ⊆ comps(id) }`;
  без дублей; порядок не специфицирован (но в пределах одной версии стабилен — это тот же массив).
- **I6. Иммутабельность кэша.** Массив, возвращённый `query`, не мутируется на месте; пересчёт создаёт
  **новый** массив. Поэтому два `query` подряд без мутаций возвращают **тот же** объект (`===`).
- **I7. Изоляция данных компонента.** Данные, переданные в `addComponent`, либо хранятся по ссылке
  (по умолчанию `cloneOnAdd:false` — вызывающий не должен мутировать переданный объект после), либо
  клонируются через `structuredClone` (`cloneOnAdd:true`). Контракт фиксирует поведение явно.
- **I8. Перезапись без миграции.** `addComponent` на уже существующем компоненте НЕ меняет архетип и
  НЕ инкрементирует `structVersion` (меняются только данные) — иначе кэш query «умирает» зря.
- **I9. Монотонность версии.** `structVersion` строго возрастает на каждом **структурном** изменении
  (create/destroy/add-нового/remove-существующего/clear) и не меняется на не-структурных операциях
  (перезапись данных, чтение, query-попадание).

### Граничные случаи (нормативно)
- **Пустой архетип `""`.** `createEntity()` без компонентов валиден (например, «пустые» эхо-якоря
  [NX-SPEC-002]); попадает в bucket `""`. Пустой bucket после ухода последней сущности **не удаляется
  сразу** (избегаем аллокаций при пере-заселении); сборка пустых — отдельным проходом, не на горячем пути.
- **Эфемерные компоненты (бафф/дебафф на 1 кадр).** Частая смена компонента дёргает миграцию и
  `structVersion++`, убивая кэш. **Контракт запрещает** использовать ECS-компонент для быстро мигающих
  состояний: их держат **флагами внутри долгоживущего компонента** (`status.frozenUntil`), как в
  [NX-SPEC-002] и риске [NX-SYS-001#riski]. Это правило код-ревью, а не рантайм-проверка.
- **Мутация во время обхода.** Систему обязали обходить **снимок** (`queryStable`/`forEach`); `query`
  отдаёт иммутабельный кэш-массив, который при `destroyEntity` внутри цикла **не** «съезжает» (пересчёт
  создаёт новый массив со следующего `query`). Та же snapshot-семантика, что у `emit` в [NX-SPEC-001].
- **Мёртвый id.** `getComponent`/`hasComponent`/`isAlive` на мёртвом id — безопасны (`undefined`/`false`).
  `addComponent`/`removeComponent` на мёртвом id — `RangeError` (программная ошибка, не штатный путь).
- **Дубли в `required`.** `query(['A','A','B'])` эквивалентен `query(['A','B'])` (нормализация ключа).

### Критерии приёмки (Acceptance Criteria — «зелёный порог» для второго роя)
Контракт считается выполненным, когда ВСЕ пункты ниже истинны:
- **AC1.** Публичный API из «Сигнатур» доступен как ES-модуль (`import { createWorld } from './world.js'`),
  без обращений к глобальным переменным кроме явного опционального legacy-shim.
- **AC2.** `addComponent`/`removeComponent`/`destroyEntity` выполняются за **амортизированное O(1)** на
  сущность (нет `indexOf`/`splice` по `ids`); подтверждается тестом масштабирования AC-PERF ниже.
- **AC3.** Повторный `query` без мутаций возвращает **тот же массив** (`===`) и не пересчитывает (I6).
- **AC4.** `query(R)` возвращает множество, удовлетворяющее I5, для любых комбинаций add/remove/destroy.
- **AC5.** `destroyEntity` внутри `forEach`/обхода `queryStable` **не теряет** и **не дублирует** соседей.
- **AC6.** `checkInvariants()` не бросает после любой последовательности из тест-набора (I1..I9 держатся).
- **AC7.** Перезапись существующего компонента не меняет `structVersion` (I8) → кэш переживает её.
- **AC-PERF.** При `N = 10_000` сущностей и `Q` горячих запросов за «кадр»: суммарное время `query`
  при попадании в кэш не растёт с `N` (O(1) на запрос); промах растёт как `O(min·k)`, не `O(N·k)`.
  Бюджет — согласован с [NX-SYS-005]; конкретные числа — в профиле, контракт фиксирует **класс
  сложности**, а не миллисекунды.

## Предложения и варианты реализации

Эталонная реализация — **ES-модуль** `world.js` (слой 2). Сохраняет алгоритмику [NX-SPEC-002]
(архетипы + обратные индексы + версионный кэш + swap-and-pop), но в форме `export`-ов и без namespace.

```js
// world.js — ES-модуль, слой 2. Без Three.js, без систем, без персистентности.
const EMPTY = new Set();
const sigOf = (names) => [...new Set(names)].sort().join('|');   // дедуп + детерминизм (I4)

export function createWorld(opts = {}) {
  const { bus = null, debug = false, cloneOnAdd = false } = opts;
  const entities   = new Map();   // EntityId -> { id, archetype }
  const archetypes = new Map();   // Signature -> { signature, ids, pos, comps }
  const index      = new Map();   // ComponentName -> Set<EntityId>
  const queryCache = new Map();   // key(Signature) -> { ids, version }
  let structVersion = 0, nextId = 1;

  const clone = (d) => (cloneOnAdd && d != null ? structuredClone(d) : d);  // I7
  const namesOf = (id) => { const s = entities.get(id).archetype; return s ? s.split('|') : []; };

  function bucketFor(sig) {
    let b = archetypes.get(sig);
    if (!b) archetypes.set(sig, b = { signature: sig, ids: [], pos: new Map(), comps: new Map() });
    return b;
  }
  function bucketAdd(b, id) { b.pos.set(id, b.ids.length); b.ids.push(id); }          // O(1)
  function bucketDel(b, id) {                                                          // O(1) swap-and-pop (I2)
    const i = b.pos.get(id), last = b.ids.pop();
    if (last !== id) { b.ids[i] = last; b.pos.set(last, i); }
    b.pos.delete(id);
  }
  function indexAdd(name, id) { (index.get(name) ?? index.set(name, new Set()).get(name)).add(id); }
  function indexDel(name, id) { index.get(name)?.delete(id); }

  function migrate(id, newNames) {                                                     // переселение архетипа
    const e = entities.get(id), oldSig = e.archetype, newSig = sigOf(newNames);
    if (oldSig === newSig) return;
    const oldB = bucketFor(oldSig), newB = bucketFor(newSig);
    bucketDel(oldB, id);
    // перенести данные компонентов, оставшихся в наборе
    for (const n of newNames) {
      const d = oldB.comps.get(n)?.get(id);
      if (d !== undefined) (newB.comps.get(n) ?? newB.comps.set(n, new Map()).get(n)).set(id, d);
    }
    for (const m of oldB.comps.values()) m.delete(id);
    e.archetype = newSig; bucketAdd(newB, id);
  }

  const api = {
    get structVersion() { return structVersion; },
    get size() { return entities.size; },

    createEntity(components) {
      const id = nextId++; entities.set(id, { id, archetype: '' });
      bucketAdd(bucketFor(''), id);
      if (components) {                          // атомарно: одна миграция (AC: один structVersion++)
        const names = Object.keys(components);
        migrate(id, names);
        const b = bucketFor(entities.get(id).archetype);
        for (const n of names) {
          (b.comps.get(n) ?? b.comps.set(n, new Map()).get(n)).set(id, clone(components[n]));
          indexAdd(n, id);
        }
      }
      structVersion++; if (debug) api.checkInvariants(); return id;
    },

    destroyEntity(id) {
      const e = entities.get(id); if (!e) return false;                 // идемпотентность (I9: без ++)
      for (const n of namesOf(id)) indexDel(n, id);
      bucketDel(bucketFor(e.archetype), id);
      entities.delete(id); queryCache.clear(); structVersion++;
      if (debug) api.checkInvariants(); return true;
    },

    isAlive(id) { return entities.has(id); },

    addComponent(id, name, data) {
      const e = entities.get(id); if (!e) throw new RangeError(`dead entity ${id}`);
      const names = namesOf(id);
      if (names.includes(name)) {                                       // I8: перезапись без миграции/++
        bucketFor(e.archetype).comps.get(name).set(id, clone(data)); return api;
      }
      migrate(id, [...names, name]);
      bucketFor(e.archetype).comps.get(name) ?? bucketFor(e.archetype).comps.set(name, new Map());
      bucketFor(e.archetype).comps.get(name).set(id, clone(data));
      indexAdd(name, id); structVersion++; if (debug) api.checkInvariants(); return api;
    },

    removeComponent(id, name) {
      const e = entities.get(id); if (!e) throw new RangeError(`dead entity ${id}`);
      if (!namesOf(id).includes(name)) return api;                      // идемпотентность (I9: без ++)
      migrate(id, namesOf(id).filter((n) => n !== name));
      indexDel(name, id); structVersion++; if (debug) api.checkInvariants(); return api;
    },

    getComponent(id, name) { const e = entities.get(id); return e && bucketFor(e.archetype).comps.get(name)?.get(id); },
    hasComponent(id, name) { return index.get(name)?.has(id) ?? false; },

    query(required) {
      const key = sigOf(required);
      const c = queryCache.get(key);
      if (c && c.version === structVersion) return c.ids;               // I6: тот же массив (===)
      let ids;
      if (required.length === 0) ids = [...entities.keys()];
      else {
        const sets = key.split('|').map((n) => index.get(n) ?? EMPTY);
        if (sets.some((s) => s.size === 0)) ids = [];
        else {
          const smallest = sets.reduce((a, b) => (a.size <= b.size ? a : b));
          ids = [];
          for (const id of smallest) if (sets.every((s) => s.has(id))) ids.push(id);  // O(min·k)
        }
      }
      queryCache.set(key, { ids, version: structVersion }); return ids;
    },

    queryStable(required) { return api.query(required).slice(); },      // снимок: безопасен к мутациям
    count(required) { return (required ? api.query(required) : [...entities.keys()]).length; },
    forEach(required, fn) { for (const id of api.queryStable(required)) fn(id, api); },

    clear() { entities.clear(); archetypes.clear(); index.clear(); queryCache.clear(); structVersion++; },

    checkInvariants() {                                                 // DEBUG: I1..I4 (минимум)
      for (const b of archetypes.values()) {
        if (b.pos.size !== b.ids.length) throw new Error('I2: pos≠ids');
        b.ids.forEach((id, i) => { if (b.pos.get(id) !== i) throw new Error('I2: pos mismatch'); });
      }
      for (const [id, e] of entities) {
        if (e.archetype !== sigOf(namesOf(id))) throw new Error('I4/I1: archetype mismatch');
      }
      for (const [name, set] of index) for (const id of set)
        if (!namesOf(id).includes(name)) throw new Error('I3: index∌entity');
    },
  };
  return api;
}

// ── Опциональный ЛЕГАСИ-адаптер (НЕ ядро): мост для клиентов v1/v2 на window.NEXUS ──
// import { installLegacyNamespace } from './world.legacy.js'  // подключается ТОЛЬКО при нужде
export function installLegacyNamespace(globalObj = globalThis) {
  globalObj.NEXUS = globalObj.NEXUS || { core: {}, svc: {} };
  globalObj.NEXUS.core.createWorld = createWorld;                // ядро остаётся ES-модульным
}
```

### Минимальные тест-кейсы (Vitest/любой ES-раннер; закрывают AC1..AC7, AC-PERF)
```js
import { createWorld } from '../world.js';
import { describe, it, expect } from 'vitest';

describe('World API contract (NX-SPEC-008)', () => {
  it('T1 createEntity/addComponent/query: множество корректно (AC4/I5)', () => {
    const w = createWorld({ debug: true });
    const a = w.createEntity({ Transform:{}, Health:{} });
    const b = w.createEntity({ Transform:{}, Health:{}, AI:{} });
    w.createEntity({ Transform:{} });                             // не подходит
    expect(new Set(w.query(['Transform','Health']))).toEqual(new Set([a, b]));
    expect(w.query(['AI'])).toEqual([b]);
    expect(w.query([]).length).toBe(3);                          // пустой required = все
  });

  it('T2 кэш: повторный query без мутаций — ТОТ ЖЕ массив (AC3/I6)', () => {
    const w = createWorld();
    w.createEntity({ Transform:{}, AI:{} });
    const r1 = w.query(['Transform','AI']);
    const r2 = w.query(['Transform','AI']);
    expect(r2).toBe(r1);                                          // === (не только eql)
    w.createEntity({ Transform:{}, AI:{} });                      // мутация инвалидирует
    expect(w.query(['Transform','AI'])).not.toBe(r1);
  });

  it('T3 перезапись компонента не дёргает structVersion (AC7/I8)', () => {
    const w = createWorld();
    const id = w.createEntity({ Health:{ hp:10 } });
    const v = w.structVersion;
    w.addComponent(id, 'Health', { hp:5 });                       // перезапись данных
    expect(w.structVersion).toBe(v);                             // версия не сдвинулась
    expect(w.getComponent(id,'Health').hp).toBe(5);
  });

  it('T4 destroyEntity в обходе снимка не теряет соседей (AC5)', () => {
    const w = createWorld({ debug:true });
    const ids = Array.from({length:50}, () => w.createEntity({ AI:{}, Transform:{} }));
    const seen = [];
    w.forEach(['AI'], (id) => { seen.push(id); if (id % 2 === 0) w.destroyEntity(id); });
    expect(seen.length).toBe(50);                                // все 50 посещены (снимок)
    expect(w.count(['AI'])).toBe(ids.filter(i => i % 2 !== 0).length);
  });

  it('T5 swap-and-pop сохраняет все ID, инварианты держатся (AC6/I1-I4)', () => {
    const w = createWorld({ debug:true });
    const ids = Array.from({length:20}, (_,k) => w.createEntity({ Health:{}, ...(k%2?{AI:{}}:{}) }));
    ids.filter((_,k)=>k%3===0).forEach(id => w.destroyEntity(id));
    ids.filter((_,k)=>k%5===0 && w.isAlive(ids[k])).forEach(id => w.removeComponent(id,'Health'));
    expect(() => w.checkInvariants()).not.toThrow();             // I1..I4 целы
  });

  it('T6 пересечение берёт наименьший Set (поведение, не падение)', () => {
    const w = createWorld();
    Array.from({length:1000}, () => w.createEntity({ Common:{} }));   // большой Set
    const rare = w.createEntity({ Common:{}, Rare:{} });              // маленький Set
    expect(w.query(['Common','Rare'])).toEqual([rare]);              // корректно и без обхода 1000
  });

  it('T7 эфемерный флаг НЕ переселяет архетип (граничный случай)', () => {
    const w = createWorld();
    const id = w.createEntity({ Status:{ frozenUntil:0 } });
    const sig0 = w.structVersion;
    w.getComponent(id,'Status').frozenUntil = 999;               // флаг внутри компонента
    expect(w.structVersion).toBe(sig0);                          // никакой миграции
  });

  it('T8 AC-PERF: query-попадание в кэш не зависит от N (класс сложности)', () => {
    const w = createWorld();
    for (let i=0;i<10_000;i++) w.createEntity({ Transform:{}, Health:{} });
    w.query(['Transform','Health']);                             // прогрев кэша
    const t0 = performance.now();
    for (let q=0;q<1000;q++) w.query(['Transform','Health']);    // 1000 попаданий
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(50);                                 // O(1)/запрос; порог — ориентир, не SLA
  });
});
```

### Развилки реализации (наследуются из [NX-SPEC-002], зафиксированы для контракта)
- **A (рекомендуемая для v2).** Данные компонентов как `Map<name, Map<id,data>>` в bucket-е — просто,
  отлаживаемо. Эталон выше использует именно её.
- **B.** По-компонентные версии вместо глобального `structVersion` (кэш `[T,H,AI]` инвалидируется только
  при изменении одного из трёх индексов). Меньше лишних пересчётов; включать по профилю [NX-SYS-005].
  Контракт `query` от этого **не меняется** (I5/I6 сохраняются), меняется лишь критерий инвалидации.
- **C.** Structure-of-Arrays (типизированные массивы на архетип) — кэш-локальность/SIMD; отложить до
  доказанной нужды («500+ врагов» из [NX-SPEC-002] — пока не профиль).
- **D.** Битовые маски компонентов (реестр `defineComponent → bit`, сигнатура = int) — для сотен
  архетипов; для 5 типов врагов оверинжиниринг. `defineComponent` зарезервирован в API под эту развилку.

## Что нового и какие кирпичики
> Раздел не обязателен для `spec`; коротко об источниках ([NX-META-001] §7).
- **Проверенные кирпичики:** archetype-ECS (Unity DOTS / flecs / EnTT), обратный индекс + «iterate the
  smallest set» (планировщик БД по селективности), swap-and-pop (управление пулами, [NX-SYS-001#detali]),
  snapshot-итерация ([NX-SPEC-001]), ES-модули и `structuredClone`/`Map`/`Set` (современные браузерные API).
- **Что нового именно здесь:** не алгоритм (он из [NX-SPEC-002]), а **финализация в исполнимый контракт**
  — точные сигнатуры, 9 инвариантов с DEBUG-проверкой, 8 критериев приёмки и тест-набор как «порог
  зелёного». Плюс перевод формы поставки на **ES-модуль** (современное-первым), с namespace-мостом как
  **опциональным адаптером**, а не ядром ([NX-STRAT-004#princip-sovremennoe-pervym]).
- **Чего мало в вебе:** связка *архетипы + обратные индексы + версионный кэш* в лёгком ES-модульном
  ядре под бюджет кадра ([NX-SYS-005]), переносимом между клиентами v1/v2/v3 ([NX-SYS-004]) без тяжёлого
  нативного ECS и без наивного «скан каждый кадр».

## Риски, открытые вопросы
- **Грубая инвалидация кэша.** `destroyEntity` чистит весь `queryCache`; в кадре с частыми смертями кэш
  может почти не «жить». Митигация: батчить структурные изменения к концу кадра или развилка B.
  Решает профиль [NX-SYS-005]. (Совпадает с риском [NX-SPEC-002#riski].)
- **Перенос данных при миграции.** `migrate` копирует ссылки данных между bucket-ами; для «широких»
  сущностей не бесплатно. Для прототипа приемлемо; эфемерные свойства обязаны идти флагами.
- **Согласованность архетип↔индекс.** Два источника правды легко рассинхронизировать ошибкой в
  `migrate`; страхует DEBUG-инвариант `checkInvariants()` (I1..I4) — рантайм-проверка как у DEBUG
  EventBus [NX-SPEC-001].
- **`cloneOnAdd` по умолчанию выключен (I7).** Производительность важнее безопасности по умолчанию;
  цена — вызывающий не должен мутировать переданный объект. Включать `cloneOnAdd:true` там, где данные
  переиспользуются (например, проекция `Record` из субстрата [NX-SPEC-006]).
- **Совместимость клиентов.** v1/v2 — монолиты без ECS; финальный `World` реально касается v3 + текстового
  1D-режима ([NX-STRAT-004]); legacy-namespace shim — единственная уступка старым клиентам, и она **вне ядра**.

## Комментарии
Документ финализирует контракт ECS-`World`, эскизированный в [NX-SPEC-002] (там — «analyzed» с псевдокодом
IIFE/namespace), переводя его в исполнимый ES-модульный API с инвариантами, приёмкой и тестами. Решение
о форме поставки (ES-модуль-ядро, namespace/PHP — только опциональные адаптеры) опирается на принцип
«современное-первым» из [NX-STRAT-004] и согласовано с тем же принципом в соседнем контракте субстрата
[NX-SPEC-006]. Зрелость — `analyzed` (реального кода ECS в `shared/*` нет — там `enems[]`-массив,
см. [NX-SPEC-002]); статус `proposed`. Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-SPEC-002 ECS с архетипами и индексами](./NX-SPEC-002-ecs-archetypes.md) — концепт-спека (depends_on); алгоритмика и развилки A–D
- [NX-SYS-001 Ядро v2 — ECS/EventBus/Services](../30-systems/NX-SYS-001-core-architecture-v2.md) — родительский системный документ (depends_on), решение про архетипы и слои
- [NX-SPEC-001 EventBus 2.0 — спека и каталог событий](./NX-SPEC-001-eventbus-2.md) — слой 0; snapshot-семантика, опциональная инъекция в `World`
- [NX-SPEC-006 Койне-субстрат — контракт API записей](./NX-SPEC-006-koine-substrate-api.md) — слой 1; журнал/персист/сеть за адаптером, проекция Record→компоненты
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — принцип «современное-первым, легаси не блокирует»
- [NX-VIS-004 Мета-слой Койне](../10-vision/NX-VIS-004-meta-layer-koine.md) — субстрат и линзы над ним
- [NX-SYS-005 Бюджет симуляции мира](../30-systems/NX-SYS-005-world-simulation-budget.md) — где решаются развилки B/C по профилю
- [NX-SYS-004 Рендер-абстракция](../30-systems/NX-SYS-004-render-abstraction.md) — совместимость клиентов v1/v2/v3
- [Шаблон](../00-meta/TEMPLATE.md) · [Конституция вики](../00-meta/CONSTITUTION.md)
