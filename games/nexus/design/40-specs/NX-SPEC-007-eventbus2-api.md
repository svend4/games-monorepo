---
id: NX-SPEC-007
title: EventBus 2.0 — финальный API (on/off/once/emit, snapshot, приоритеты, отладка) + контракт и тесты
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [eventbus, pub-sub, core, layer0, contract, api, snapshot, priority, once, off, debug, es-modules, modern-first, tests, acceptance]
relates_to: [NX-SPEC-001, NX-SYS-001, NX-SPEC-006, NX-STRAT-004, NX-VIS-004]
depends_on: [NX-SPEC-001, NX-SYS-001]
comments_on: [NX-SPEC-001#predlozheniya, NX-SYS-001#detali, NX-STRAT-004#princip-sovremennoe-pervym]
superseded_by: null
language: ru
---

# EventBus 2.0 — финальный API + контракт и тесты

## TL;DR
Превращает концепт-спеку [NX-SPEC-001] в **реализуемый стек-агностичный контракт** шины
событий слоя 0: финальные сигнатуры `on / off / once / emit` (плюс служебные `debug / stats /
listenerCount / clear`), формальные **инварианты** (emit по **копии-снимку**; симметрия
`on`↔`off` по оригинальной функции; `once` снимается **до** вызова; приоритеты — desc, при
равенстве стабильно по порядку подписки), **критерии приёмки** и **минимальные тест-кейсы**
(off-внутри-emit не теряет соседа; `once` стреляет ровно раз; `off(origFn)` снимает `once`;
приоритет соблюдён; рекурсия > `MAX_DEPTH` бросает ошибку в DEBUG). По принципу
«современное-первым» ([NX-STRAT-004]) ядро — **ES-модуль** с современными браузерными API
(`performance.now`, `queueMicrotask`); легаси (PHP/серверный мост) — **только опциональный
адаптер за интерфейсом транспорта**, не ядро.

## Краткое содержание
[NX-SPEC-001] зафиксировал *почему* шина должна работать так (баги исходного `ARCHITECTURE.md`:
`emit` по живому массиву теряет слушателей; `once` нельзя снять через `off(origFn)`) и дал
контурный псевдокод. Настоящий документ — **контракт второго роя**, который пишет реальный код:
точные TS-подобные сигнатуры, форма опций, форма токена-отписки, поведение в граничных случаях,
проверяемые инварианты, набор приёмочных критериев и готовый план юнит-тестов. Это `detailed`
слой под `extended` [NX-SYS-001] и **финализация** API из [NX-SPEC-001] (от «как должно» к «вот
сигнатура и тест»).

Главный инженерный тезис: **шина — чистый слой 0 без зависимостей**, поэтому контракт
**стек-агностичен** и **полностью юнит-тестируем** в Node/браузере без моков. Современное ядро
(ES-модуль, фабрика `createEventBus()` + единый синглтон в `NEXUS.core`); любой сетевой/легаси
мост (PHP-`nexus_api.php`, WebSocket) подключается **снаружи** как подписчик/эмиттер, а не
встраивается в ядро.

## Расширенное содержание (общее)

### Место шины в архитектуре (слои)
```
СЛОЙ 0  EventBus (ЭТОТ)  — синхронная нотификация: on/off/once/emit                [NX-SPEC-007]
СЛОЙ 1  Substrate        — append-only журнал; эмитит record:written в шину        [NX-SPEC-006]
СЛОЙ 2  World (ECS)      — состояние; слушает события, не зовёт системы напрямую   [NX-SPEC-002]
СЛОЙ 3  Системы/Линзы    — Combat/Loot/Quest/echo/knowledge общаются ТОЛЬКО шиной  [NX-SYS-001]
```
Шина **может**: хранить слушателей, звать их синхронно по приоритету, считать отладочные
метрики. Шина **не может** (инвариант слоя 0 из [NX-SYS-001#detali]): импортировать Three.js,
ECS-`World`, DOM, сеть, `Substrate`. Любой транспорт (сеть, PHP) — **снаружи**: он
`emit('echo:received', …)` как обычный эмиттер и `on(…)` как обычный подписчик. Шина о нём не
знает — это и есть «легаси за интерфейсом» ([NX-STRAT-004]).

### Принцип «современное-первым» в применении к шине
- **Ядро — современное:** ES-модуль (`export function createEventBus()`, `export const bus`),
  никакого `var x = (function(){…})()`-IIFE как фундамента. Отладка использует
  `performance.now()` (а не `Date.now()`), микрозадачи — `queueMicrotask` (если понадобится
  отложенный режим в будущем; в v0.1 ядро **синхронно**).
- **Легаси — опциональный адаптер:** серверный/PHP мост ([v1-2d-mmo/nexus_api.php]) **не**
  является частью шины. Он — отдельный модуль `NetworkBridge`, который слушает локальную шину и
  ретранслирует наружу/внутрь. Замена PHP на Node/WebSocket не трогает ни одной строки шины.
- **Единый синглтон без глобального мусора:** ровно одна точка входа `NEXUS.core.EventBus`
  ([NX-SYS-001#detali]: «1 контролируемая точка входа в глобальную область»), а в современном
  коде — именованный импорт `import { bus } from 'core/eventbus.js'`.

### Три гарантии, которые финализирует контракт
1. **Snapshot-корректность.** `emit(E)` вызывает **ровно тот** набор слушателей, что был
   подписан на момент входа в `emit` (отписки/подписки из обработчика вступают со следующего
   `emit`). Источник правки — [NX-SPEC-001#detali] баг №1, [NX-SYS-001] строка таблицы #1.
2. **Симметрия `on`↔`off`↔`once`.** Снять подписку можно (а) токеном `{ off() }`, который
   вернул `on`/`once`, и (б) по **оригинальной** функции через `off(event, fn)` — в т.ч. для
   `once`. Источник — [NX-SPEC-001#detali] баг №2.
3. **Детерминизм порядка + наблюдаемость.** Приоритет (desc, при равенстве — порядок подписки)
   и DEBUG-режим (счётчики, трассировка, защита от рекурсии `MAX_DEPTH`).

## Детали и частные случаи

### Контракт типов (TS-подобно, нормативно)
Это **нормативная** часть. Реализация на любом стеке обязана соответствовать сигнатурам и
семантике; имена опций и поля токена — часть контракта.

```ts
// ── Базовые типы ──────────────────────────────────────────────────
/** Имя события. Соглашение каталога: 'domain:action' (см. NX-SPEC-001 каталог). */
type EventName = string;

/** Payload произволен, но для каталожных событий фиксирован в NX-SPEC-001. */
type Payload = unknown;

/** Обработчик. Возвращаемое значение игнорируется (в т.ч. Promise — см. инвариант I-9). */
type Handler<T = any> = (data: T) => void;

/** Опции подписки. Все поля опциональны. */
interface SubscribeOptions {
  /** this внутри обработчика. По умолчанию undefined. */
  ctx?: unknown;
  /** Порядок вызова: выше priority → раньше. По умолчанию 0. Может быть отрицательным. */
  priority?: number;
  /** Метка для отладочной трассировки (имя слушателя в логах DEBUG). */
  tag?: string;
}

/** Токен отписки. Возвращается из on() и once(). */
interface Subscription {
  /** Идемпотентно снимает подписку. Повторный вызов — no-op. */
  off(): void;
  /** true, пока подписка активна; false после off() или после авто-снятия once. */
  readonly active: boolean;
}

// ── Публичный интерфейс шины ──────────────────────────────────────
interface IEventBus {
  on<T = any>(event: EventName, fn: Handler<T>, opts?: SubscribeOptions): Subscription;
  once<T = any>(event: EventName, fn: Handler<T>, opts?: SubscribeOptions): Subscription;
  /** Снимает ВСЕ записи с orig === fn для данного события (см. инвариант I-4). */
  off(event: EventName, fn: Handler): void;
  /** Синхронно вызывает слушателей по снимку. Возвращает количество вызванных. */
  emit<T = any>(event: EventName, data?: T): number;

  // ── Служебные / отладка ──
  /** Включает/выключает DEBUG (счётчики, трассировка, защита рекурсии). */
  debug(on: boolean): void;
  /** Снимок счётчиков emit по событиям (пусто, если DEBUG выключен). */
  stats(): Readonly<Record<EventName, number>>;
  /** Число активных слушателей события (0, если нет). */
  listenerCount(event: EventName): number;
  /** Снимает всех слушателей события (или всех событий, если аргумент опущен). */
  clear(event?: EventName): void;
}

// ── Фабрика (современное ядро) ────────────────────────────────────
/** Создаёт изолированный инстанс шины (для тестов и для изоляции миров v1/v2/v3). */
function createEventBus(config?: { maxDepth?: number; debug?: boolean }): IEventBus;

/** Глобальный синглтон приложения: NEXUS.core.EventBus. */
const bus: IEventBus; // export const bus = createEventBus();
```

Решение vs [NX-SPEC-001]: контракт **финализирует** два неявных места исходного псевдокода —
(а) токен теперь несёт `active: boolean` (наблюдаемость состояния подписки, нужно для
идемпотентного `off()`), (б) `emit` возвращает **число вызванных** слушателей (а не `this`) —
это полезно в тестах и для метрик и не противоречит «синхронной» семантике. `tag` добавлен для
трассировки в DEBUG (закрывает «нет наблюдаемости» из [NX-SPEC-001#detali]).

### Внутреннее представление записи слушателя
```ts
interface ListenerRecord {
  orig: Handler;       // ключ сравнения для off(event, fn)  — оригинал пользователя
  wrapper: Handler;    // что реально вызывается (для once — обёртка со снятием)
  ctx: unknown;        // this
  priority: number;    // порядок (desc)
  tag?: string;        // метка для DEBUG
  alive: boolean;      // false после снятия (для идемпотентности и snapshot-семантики)
}
// listeners: Map<EventName, ListenerRecord[]>  — массив отсортирован по priority DESC, стабильно.
```

### Инварианты (нормативные, проверяемые)
- **I-1 (snapshot).** `emit(E, d)` итерирует по **копии** массива слушателей, снятой в момент
  входа. Подписка/отписка, выполненная любым обработчиком во время этого `emit`, **не** влияет
  на текущую рассылку — только на следующие `emit`.
- **I-2 (off-внутри-emit не теряет соседа).** Если слушатель `A` в обработчике вызывает
  `off(E, B)`, то `B`, уже бывший в снимке, **получит** текущее событие, но не последующие.
  Соседи `A` не пропускаются (прямое следствие I-1).
- **I-3 (once ровно раз).** `once(E, fn)` вызывает `fn` **не более одного раза**. Снятие
  происходит **до** вызова `fn` (поэтому повторный `emit(E)`, инициированный изнутри `fn`,
  **не** вызовет `fn` снова). Если `fn` бросает исключение — подписка всё равно уже снята.
- **I-4 (симметрия off по оригиналу).** `off(E, fn)` удаляет **все** записи, у которых
  `orig === fn`, включая записи, созданные `once`. Сравнение строгое (`===`).
- **I-5 (идемпотентный токен).** `subscription.off()` можно звать многократно; первый снимает,
  последующие — no-op. После снятия `subscription.active === false`.
- **I-6 (приоритет).** В пределах одного `emit` слушатели вызываются по **убыванию** `priority`.
  При равном `priority` — в **порядке подписки** (стабильность). Сортировка поддерживается при
  `on`/`once` (вставкой), не при `emit` (горячий путь линеен).
- **I-7 (нет слушателей).** `emit(E)` при отсутствии подписчиков — no-op, возвращает `0`, не
  бросает.
- **I-8 (защита рекурсии).** В DEBUG, если глубина вложенных `emit` превышает `maxDepth`
  (по умолчанию `16`), шина бросает `Error` с именем события. Вне DEBUG защита выключена
  (нулевая стоимость на горячем пути).
- **I-9 (синхронность).** `emit` **синхронен**: к моменту его возврата все обработчики снимка
  отработали (или брошено исключение). Если обработчик вернул `Promise`, шина его **не** ждёт и
  **не** обрабатывает (fire-and-forget); ответственность — на обработчике.
- **I-10 (изоляция инстансов).** Два инстанса из `createEventBus()` не разделяют слушателей и
  счётчики. Это решает риск «шина шарится между несовместимыми мирами» из [NX-SPEC-001#riski].

### Поведение при исключении в обработчике (финализация открытого вопроса [NX-SPEC-001#riski])
Контракт фиксирует: по умолчанию `emit` **не изолирует** слушателей друг от друга — исключение
в обработчике прерывает рассылку и пробрасывается вызывающему `emit` (последующие слушатели
снимка не вызываются). Обоснование: тихое проглатывание скрывает баги в прототипе.
**Опционально** (config-флаг будущей версии `safeEmit`) можно обернуть каждый вызов в `try/catch`
с логом в DEBUG — но это **не** ядро v0.1 (стоимость vs живучесть). В DEBUG `depth` декрементится
через `finally` даже при исключении (инвариант стека не нарушается).

### Каталог событий — ссылка, не дубль
Единственный источник истины по событиям/payload — **каталог в [NX-SPEC-001]** (таблица
`entity:died`, `echo:received`, и т.д.). Этот документ его **не дублирует**, чтобы не разойтись.
Контракт лишь добавляет правило валидации (см. ниже, в DEBUG).

### Опциональный рантайм-валидатор payload (DEBUG)
Закрывает риск «каталог ↔ код» из [NX-SPEC-001#riski]. В DEBUG шина может принять реестр схем и
проверять payload каталожных событий:
```ts
interface IEventBus {
  /** DEBUG-only: регистрирует предикат-валидатор payload для события. */
  validate?(event: EventName, check: (data: unknown) => boolean): void;
}
// Пример инварианта каталога: entity:died обязан содержать tags (NX-SPEC-001):
bus.validate('entity:died', d =>
  d != null && typeof d === 'object' && 'tags' in (d as object));
```
Вне DEBUG `validate` — no-op (нулевая стоимость). Это **опциональное** расширение контракта;
ядро без него валидно.

### Псевдо/референс-реализация (ES-модуль, современное ядро)
Нормативно — сигнатуры и инварианты выше; код ниже — референс, удовлетворяющий им.
```js
// core/eventbus.js  — СЛОЙ 0, импортирует НИЧЕГО (NX-SYS-001)
export function createEventBus(config = {}) {
  const MAX_DEPTH = config.maxDepth ?? 16;
  const listeners = new Map();   // EventName -> ListenerRecord[]  (priority DESC, стабильно)
  let DEBUG = config.debug ?? false;
  const counts = Object.create(null);
  let depth = 0;

  const insertSorted = (list, rec) => {
    let i = 0;
    while (i < list.length && list[i].priority >= rec.priority) i++; // I-6: стабильно
    list.splice(i, 0, rec);
  };
  const getList = (event) => {
    let l = listeners.get(event);
    if (!l) { l = []; listeners.set(event, l); }
    return l;
  };
  const removeRec = (event, rec) => {
    if (!rec.alive) return;               // I-5: идемпотентно
    rec.alive = false;
    const l = listeners.get(event);
    if (!l) return;
    const i = l.indexOf(rec);
    if (i >= 0) l.splice(i, 1);
  };

  function on(event, fn, opts = {}) {
    const rec = { orig: fn, wrapper: fn, ctx: opts.ctx,
                  priority: opts.priority ?? 0, tag: opts.tag, alive: true };
    insertSorted(getList(event), rec);
    return { off: () => removeRec(event, rec), get active() { return rec.alive; } };
  }

  function once(event, fn, opts = {}) {
    const rec = { orig: fn, ctx: opts.ctx, priority: opts.priority ?? 0,
                  tag: opts.tag, alive: true };
    rec.wrapper = (data) => {             // I-3: снять ДО вызова
      removeRec(event, rec);
      fn.call(opts.ctx, data);
    };
    insertSorted(getList(event), rec);
    return { off: () => removeRec(event, rec), get active() { return rec.alive; } };
  }

  function off(event, fn) {              // I-4: матч по orig, снимает и once
    const l = listeners.get(event);
    if (!l) return;
    for (const rec of l) if (rec.orig === fn) rec.alive = false;
    listeners.set(event, l.filter(r => r.alive));
  }

  function emit(event, data) {
    const l = listeners.get(event);
    if (!l || l.length === 0) return 0;  // I-7
    if (DEBUG) {
      counts[event] = (counts[event] ?? 0) + 1;
      if (++depth > MAX_DEPTH) { depth--; throw new Error(
        `EventBus: рекурсия > ${MAX_DEPTH} на '${event}'`); } // I-8
    }
    const snapshot = l.slice();          // I-1: копия-снимок
    let n = 0;
    try {
      for (const r of snapshot) {        // I-2: снятые позже соседи не теряются
        if (r.alive) { r.wrapper.call(r.ctx, data); n++; } // I-9: синхронно, Promise не ждём
      }
    } finally { if (DEBUG) depth--; }    // инвариант стека при исключении
    return n;
  }

  return {
    on, once, off, emit,
    debug: (on) => { DEBUG = on; },
    stats: () => (DEBUG ? { ...counts } : {}),
    listenerCount: (e) => (listeners.get(e)?.length ?? 0),
    clear: (e) => { e === undefined ? listeners.clear() : listeners.delete(e); },
  };
}

export const bus = createEventBus();     // NEXUS.core.EventBus
```
Замечание к `emit` и снимку: проверка `if (r.alive)` внутри цикла — **усиление** I-2 на случай,
когда обработчик снял слушателя, ещё **не вызванного** в этом снимке. Базовая snapshot-семантика
[NX-SPEC-001] вызвала бы его (он был подписан на момент входа); строгий вариант — **не** вызывать
уже снятого. Контракт фиксирует **строгий вариант** как нормативный (см. тест T-2b) — он
предсказуемее и совпадает с интуицией «отписался — не получаю».

## Предложения и варианты реализации

### Критерии приёмки (Definition of Done для второго роя)
Реализация считается соответствующей контракту, если **все** пункты выполнены:
- **AC-1.** Публичный API совпадает с `IEventBus` по именам и арности; `on/once` возвращают
  `Subscription` с рабочими `off()` и `active`.
- **AC-2.** Все инварианты I-1…I-10 покрыты проходящими юнит-тестами (см. ниже).
- **AC-3.** Ядро — ES-модуль слоя 0: статический анализ импортов показывает **ноль** импортов
  из `engine/ecs/systems/world/ui/three/dom/net`.
- **AC-4.** Вне DEBUG путь `emit` не выполняет работы по счётчикам/трассировке/валидации
  (проверяемо: `stats()` пуст, отсутствие throw при глубокой легальной вложенности вне DEBUG).
- **AC-5.** Любой сетевой/легаси транспорт подключается **снаружи** (тест: мок-`NetworkBridge`
  ретранслирует `echo:received` без изменения файла шины).
- **AC-6.** `createEventBus()` даёт изолированные инстансы (I-10) — тест с двумя шинами.

### Минимальные тест-кейсы (нормативный план; framework-агностично)
Псевдо-тесты (Vitest/Jest/нативный `node:test` — на выбор роя). Каждый помечен инвариантом.

```js
// T-1 (I-1, I-2) off СОСЕДА внутри emit не теряет соседа
const b = createEventBus(); const seen = [];
const A = () => { b.off('e', B); seen.push('A'); };  // A снимает B
const B = () => seen.push('B');
const C = () => seen.push('C');
b.on('e', A); b.on('e', B); b.on('e', C);
b.emit('e');
// B был в снимке, но СНЯТ до своего вызова (строгий вариант) → не вызывается;
// C — сосед, НЕ теряется. Ожидаем seen === ['A','C'] (НЕ ['A'] и НЕ ['A','C'] с пропуском C).
assert.deepEqual(seen, ['A', 'C']);

// T-2 (I-1) off СЕБЯ внутри emit: текущая рассылка не ломается
const b2 = createEventBus(); let calls = 0; let sub;
const self = () => { calls++; sub.off(); };
sub = b2.on('e', self);
b2.emit('e'); b2.emit('e');                 // второй emit — self уже снят
assert.equal(calls, 1);

// T-2b (строгий вариант I-2) снятие ЕЩЁ НЕ вызванного в этом снимке → не вызывается
const b2b = createEventBus(); const log = [];
const first = () => { log.push('first'); subSecond.off(); }; // снимает ещё не вызванного
const second = () => log.push('second');
b2b.on('e', first); const subSecond = b2b.on('e', second);
b2b.emit('e');
assert.deepEqual(log, ['first']);            // second снят до вызова → не вызван

// T-3 (I-3) once стреляет ровно раз
const b3 = createEventBus(); let c = 0;
b3.once('e', () => c++);
b3.emit('e'); b3.emit('e'); b3.emit('e');
assert.equal(c, 1);

// T-3b (I-3) once: повторный emit ИЗНУТРИ обработчика не вызывает повторно
const b3b = createEventBus(); let c2 = 0;
b3b.once('e', () => { c2++; if (c2 < 5) b3b.emit('e'); }); // снят ДО вызова
b3b.emit('e');
assert.equal(c2, 1);

// T-4 (I-4) off(origFn) снимает once-подписку
const b4 = createEventBus(); let c3 = 0;
const fn = () => c3++;
b4.once('e', fn);
b4.off('e', fn);                             // снятие по ОРИГИНАЛУ
b4.emit('e');
assert.equal(c3, 0);
assert.equal(b4.listenerCount('e'), 0);

// T-5 (I-6) приоритет: desc, при равенстве — порядок подписки
const b5 = createEventBus(); const order = [];
b5.on('e', () => order.push('low'),  { priority: 0 });
b5.on('e', () => order.push('high'), { priority: 100 });
b5.on('e', () => order.push('mid'),  { priority: 50 });
b5.on('e', () => order.push('low2'), { priority: 0 });   // тот же приоритет, что low
b5.emit('e');
assert.deepEqual(order, ['high', 'mid', 'low', 'low2']); // стабильно: low раньше low2

// T-6 (I-5) токен идемпотентен, active отражает состояние
const b6 = createEventBus();
const s = b6.on('e', () => {});
assert.equal(s.active, true);
s.off(); assert.equal(s.active, false);
s.off();                                     // no-op, без ошибки
assert.equal(b6.listenerCount('e'), 0);

// T-7 (I-7) emit без слушателей — 0, без throw
const b7 = createEventBus();
assert.equal(b7.emit('никого'), 0);

// T-8 (I-8) рекурсия > MAX_DEPTH в DEBUG бросает; вне DEBUG — нет
const b8 = createEventBus({ maxDepth: 4 }); b8.debug(true);
b8.on('e', () => b8.emit('e'));              // бесконечная вложенность
assert.throws(() => b8.emit('e'), /рекурсия > 4/);

// T-9 (I-9) emit возвращает число вызванных
const b9 = createEventBus();
b9.on('e', () => {}); b9.on('e', () => {});
assert.equal(b9.emit('e'), 2);

// T-10 (I-10) изоляция инстансов
const x = createEventBus(); const y = createEventBus(); let hit = 0;
x.on('e', () => hit++);
y.emit('e');                                 // другой инстанс
assert.equal(hit, 0);

// T-11 (AC-5) легаси/сеть — снаружи: мост ретранслирует без правки ядра
const local = createEventBus(); const received = [];
function NetworkBridge(busRef, transport) {  // отдельный модуль, НЕ часть шины
  busRef.on('echo:received', (d) => transport.push(d)); // слушает как обычный подписчик
}
const transport = []; NetworkBridge(local, transport);
local.emit('echo:received', { kind: 'ghost', validated: true });
assert.equal(transport.length, 1);
```

### Развилки реализации (наследуются из [NX-SPEC-001], уточнены)
- **A. Массив записей + сортировка при `on`** (референс выше) — линейный `emit`, оптимально при
  ≤5 слушателях на событие ([NX-SPEC-001]). **Рекомендую для v0.1.**
- **B. Две очереди `pre`/`post`** вместо числового priority — отложено; число гибче для
  анти-чит-валидатора эхо ([NX-VIS-001#riski], `priority: 100`).
- **C. Микро-батчинг `emit` (event queue, flush в GameLoop)** — убирает реентрантность, но
  ломает синхронные ожидания (I-9). Отложить до бюджетов кадра ([NX-SYS-005]); если делать —
  через `queueMicrotask`/`requestAnimationFrame` снаружи ядра, как опциональный планировщик.

### Стек-агностичность и легаси-граница (явно)
- **Ядро (этот контракт)** не содержит ни одного вызова PHP/HTTP/WebSocket/DOM — только память и
  функции. Поэтому оно идентично работает в браузере, в Node (тесты, 1D-текст-прогон из
  [NX-STRAT-004]) и в воркере.
- **Легаси-мост (PHP `v1-2d-mmo/nexus_api.php`, серверный эхо-обмен)** — **снаружи**, реализует
  интерфейс транспорта `{ push(record), onMessage(cb) }` и связывается с шиной через
  `NetworkBridge` (тест T-11). Замена PHP на современный сервер не меняет шину — это и есть
  «легаси как опциональный адаптер за интерфейсом» ([NX-STRAT-004#princip-sovremennoe-pervym]).

## Риски, открытые вопросы
- **Строгий vs мягкий snapshot (T-1/T-2b).** Контракт выбрал **строгий** (снятый-до-вызова не
  вызывается) как нормативный. [NX-SPEC-001] описывал мягкий («был в снимке → получит»).
  Это сознательное уточнение; если второй рой найдёт сценарий, где мягкий нужен, — обсудить в
  `90-comments/`, но по умолчанию строгий.
- **Изоляция исключений.** v0.1 пробрасывает исключение и прерывает рассылку. Для живучести
  рантайма (один кривой слушатель не должен валить кадр) может понадобиться `safeEmit` — открыто,
  отложено до профиля.
- **Async-обработчики.** I-9 фиксирует fire-and-forget. Если появятся реально асинхронные
  реакции (сеть), их оркестрация — **снаружи** шины (мост, не ядро), иначе ломается синхронность.
- **Каталог ↔ код.** Опциональный `validate` (DEBUG) — митигирует, но не заменяет
  дисциплину ведения каталога [NX-SPEC-001].
- **Глобальный синглтон `bus`.** Для трёх клиентов v1/v2/v3 использовать **разные** инстансы
  `createEventBus()` (I-10), чтобы миры не шарили события.

## Комментарии
Документ финализирует API из [NX-SPEC-001] (концепт-спека «как должно») в **исполнимый контракт**
со строгими сигнатурами, инвариантами, критериями приёмки и тестами. Два сознательных уточнения
относительно [NX-SPEC-001]: (1) строгая snapshot-семантика «снятый-до-вызова не вызывается»;
(2) `emit` возвращает число вызванных, токен несёт `active`. По принципу «современное-первым»
([NX-STRAT-004]) ядро — ES-модуль слоя 0, а PHP/сеть — опциональный внешний мост. Зрелость —
`analyzed` (кода в репозитории ещё нет; это контракт для второго роя). Возражения — в `90-comments/`.

## Связанные документы
- [NX-SPEC-001 EventBus 2.0 — концепт-спека и каталог событий](./NX-SPEC-001-eventbus-2.md) — родительская спека (depends_on, финализируется здесь)
- [NX-SYS-001 Ядро v2 — ECS/EventBus/Services](../30-systems/NX-SYS-001-core-architecture-v2.md) — системный слой и контракты слоёв (depends_on)
- [NX-SPEC-006 Койне-субстрат — контракт API записей](./NX-SPEC-006-koine-substrate-api.md) — соседний слой 1, эмитит record:written в шину
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — принцип «современное-первым, легаси за адаптером»
- [NX-VIS-004 Мета-слой Койне](../10-vision/NX-VIS-004-meta-layer-koine.md) — место EventBus в оркестрации записей
- [Конституция вики](../00-meta/CONSTITUTION.md)
