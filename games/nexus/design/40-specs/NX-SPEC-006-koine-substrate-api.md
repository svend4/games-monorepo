---
id: NX-SPEC-006
title: Койне-субстрат — контракт API записей (write/query/all/clear, типы, персист-адаптеры)
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [koine, substrate, records, event-sourcing, append-log, persistence-adapter, indexeddb, localstorage, memory, es-modules, modern-first, contract, layer1]
relates_to: [NX-VIS-004, NX-SPEC-002, NX-SPEC-001, NX-SPEC-003, NX-STRAT-004, NX-SYS-004]
depends_on: [NX-VIS-004]
comments_on: [NX-VIS-004#predlozheniya, NX-STRAT-004#princip-sovremennoe-pervym]
superseded_by: null
language: ru
---

# Койне-субстрат — контракт API записей

## TL;DR
Детальный, **стек-агностичный** контракт ядра мета-слоя [NX-VIS-004]: единое append-only
хранилище **типизированных записей** (`Record`) с четырьмя операциями — `write`, `query`,
`all`, `clear` — поверх сменного **персист-адаптера** (`memory` / `localStorage` / `IndexedDB`;
серверный — опциональный адаптер за тем же интерфейсом). Субстрат — это «журнал слов мира»:
любая сущность/система **порождает** записи (`write`), любая профессия-линза ([NX-VIS-004])
**читает** их (`query`). По принципу «современное-первым» ([NX-STRAT-004]) ядро — **ES-модуль
с современными браузерными API** (IndexedDB, `structuredClone`, `crypto.randomUUID`), а
PHP/серверная персистентность — **опциональный адаптер**, не фундамент. Фиксируем точные
сигнатуры (TS-подобно), форматы данных, инварианты, критерии приёмки и минимальные тест-кейсы.

## Краткое содержание
[NX-VIS-004] свёл четыре столпа NEXUS к **одному субстрату записей** и дал контурный псевдокод
(`Substrate.write` / `Substrate.query`). Этот документ — **реализуемый контракт** этого субстрата:
он закрывает «что именно за тип `Record`», «какие гарантии у `write`/`query`», «как
персистентность отделена от логики» и «как это тестировать», не уходя в конкретный движок
рендера или столп. Это слой 1 ядра (над EventBus слоя 0 [NX-SPEC-001], рядом с ECS-World слоя 2
[NX-SPEC-002]): субстрат — **журнал фактов**, ECS-World — **текущее состояние**, EventBus —
**нотификация об изменениях**. Эхо-протокол [NX-SPEC-003] становится **частным случаем**
субстрата (записи `type:'echo.*'` + серверный адаптер с анти-читом).

Главный инженерный тезис: **persistence — деталь за интерфейсом**. Один и тот же код геймплея
работает поверх `MemoryAdapter` (тесты, SSR, 1D-текст-прогон без браузера), `LocalStorageAdapter`
(быстрый сейв одной вкладки), `IndexedDBAdapter` (большой журнал, бинарь, индексы) и —
опционально — `ServerAdapter` (PHP/HTTP, асинхронный мультиплеер). Ядро их **не различает**.

## Расширенное содержание (общее)

### Место субстрата в архитектуре (слои)
```
СЛОЙ 0  EventBus           — нотификации (record:written, substrate:cleared)   [NX-SPEC-001]
СЛОЙ 1  Substrate (ЭТОТ)   — append-only журнал типизированных Record          [NX-SPEC-006]
СЛОЙ 2  World (ECS)        — текущее состояние, проекция записей в компоненты   [NX-SPEC-002]
СЛОЙ 3  Системы/Линзы      — echo/knowledge/ecology/myth читают через query     [NX-VIS-004]
```
Субстрат **может**: знать про `PersistAdapter`, эмитить в EventBus (опционально, через
инъекцию). Субстрат **не может**: знать про Three.js, про конкретную линзу, про DOM-рендер,
про ECS-`World` (однонаправленность: World читает субстрат, субстрат — нет). Это та же
дисциплина слоёв, что в [NX-SPEC-002] (World «не может: engine, systems, ui»).

### Принцип «современное-первым» — где он проявляется в контракте
По [NX-STRAT-004#princip-sovremennoe-pervym]:
- **Ядро современно.** Публичный модуль — **ES-модуль** (`export`/`import`), без глобального
  `window.NEXUS`-намespace как обязательного (он допустим лишь как тонкий UMD-шим для legacy v1/v2).
  Идентификаторы — `crypto.randomUUID()`; глубокое копирование — `structuredClone`; время —
  `Date.now()` (мс, UTC); основной адаптер по умолчанию — **IndexedDB** (асинхронный, ёмкий).
- **Легаси — опциональный адаптер.** PHP/серверная персистентность ([NX-SPEC-003], `nexus_api.php`)
  реализует **тот же интерфейс `PersistAdapter`** и подключается **по выбору**, по умолчанию
  выключена. Она **не блокирует** работу ядра: без сервера субстрат полноценно живёт локально.
  PHP — сменный модуль за интерфейсом, **не ядро архитектуры**.
- **Деградация, а не зависимость.** Нет IndexedDB (старый/приватный режим) → авто-фолбэк на
  `localStorage`, затем на `memory`. Контракт операций при этом **не меняется** (см. инвариант I-7).

### Запись (`Record`) — единица субстрата
Запись — маленький **иммутабельный** типизированный факт, ровно по [NX-VIS-004]:
`{ тип, автор, время, место, payload, подпись }`. Append-only: записи **не редактируются и не
удаляются по одной** — только дописываются (`write`) и читаются (`query`/`all`); полное стирание —
`clear` (для нового мира/теста/сейв-слота). «Изменение» факта моделируется **новой записью**
(event sourcing): отмена — записью `type:'*.revoked'`, ссылающейся на `id` исходной.

### Четыре операции — контур API
| Операция | Назначение | Стоимость | Мутирует журнал |
|---|---|---|---|
| `write(input)` | дописать одну запись (любая сущность/система) | O(1) амортизированно | да (append) |
| `query(spec)` | выбрать записи по фильтру (любая линза) | O(подходящих) при индексе | нет |
| `all()` | снимок всего журнала (отладка, экспорт, миграция) | O(n) | нет |
| `clear()` | стереть журнал целиком (новый мир/слот/тест) | O(1)/O(n) | да (truncate) |

`query` — **только чтение** и возвращает **снимок** (новый массив), безопасный к параллельным
`write` (snapshot-семантика, как у [NX-SPEC-001] emit по снимку и [NX-SPEC-002] `queryStable`).

## Детали и частные случаи

### Каноническая форма записи (data format)
TS-подобные типы (нормативная форма контракта; конкретный язык — деталь реализации):

```ts
/** Идентификатор записи: UUIDv4-строка, генерируется субстратом, если не задан. */
type RecordId = string;            // напр. "8f14e45f-ceea-467a-9c4f-3b2d1a6e0c11"

/** Тип записи — точка над субстратом; пространство имён через '.'. */
type RecordType = string;          // напр. "echo.message" | "world.need" | "myth.symbol"

/** Место в мире — РЕНДЕР-НЕЗАВИСИМО (мировые координаты, не пиксели). [NX-SYS-004] */
interface Place {
  zone: string;                    // строковый id зоны/региона
  x?: number; y?: number; z?: number;  // мировые координаты, опциональны (текст-режим без xyz)
  tile?: number | null;            // опц. дискретная клетка для 1D/2D
}

/** Полезная нагрузка — структура зависит от type; субстрат её НЕ интерпретирует. */
type Payload = Record<string, unknown>;   // произвольный сериализуемый JSON-объект

/** Подпись/происхождение. authorId — доверенное (в серверном адаптере переписывается сервером). */
interface Sig {
  authorId: string;               // кто породил (сущность/игрок/система)
  schemaVersion: number;          // версия схемы payload данного type (целое >= 1)
  hmac?: string | null;           // опц., только для серверного контура (анти-чит [NX-SPEC-003])
}

/** ЗАПИСЬ СУБСТРАТА — иммутабельна после write. */
interface SubstrateRecord {
  id: RecordId;                   // присвоен субстратом (или принят, если уникален; см. идемпотентность)
  type: RecordType;
  t: number;                      // время создания, Date.now() (мс, UTC), серверное в серверном адаптере
  seq: number;                    // монотонный порядковый номер в журнале (1,2,3…), назначает субстрат
  place: Place | null;            // null для записей без места (чисто текстовый факт)
  payload: Payload;
  sig: Sig;
}

/** Вход write — без серверно-назначаемых полей (id/t/seq могут быть опущены). */
interface WriteInput {
  type: RecordType;
  place?: Place | null;
  payload: Payload;
  sig: { authorId: string; schemaVersion: number; hmac?: string | null };
  id?: RecordId;                  // опц. клиентский UID для идемпотентности (как echoUid в [NX-SPEC-003])
  t?: number;                     // опц.; если не задано — субстрат проставит Date.now()
}
```

Инвариант формы: **поля `seq` и (в серверном адаптере) `t`, `sig.authorId` — назначает/переписывает
субстрат**, клиент их не контролирует (прямой перенос правила «meta — только сервер» из
[NX-SPEC-003#detali]). В локальных адаптерах `t` клиентское допустимо, но `seq` всегда субстратное.

### Спецификация запроса (`QuerySpec`)
```ts
interface QuerySpec {
  type?: RecordType | RecordType[];   // точный тип ИЛИ список ИЛИ префикс через '*'
  typePrefix?: string;                // напр. "echo." — все echo.* (взаимоисключимо с точным type)
  zone?: string;                      // фильтр по place.zone
  authorId?: string;                  // фильтр по автору
  since?: number;                     // t >= since (мс)
  until?: number;                     // t <  until (мс)
  sinceSeq?: number;                  // seq > sinceSeq — инкрементальная подписка/синк
  limit?: number;                     // максимум записей в ответе (после сортировки)
  order?: 'asc' | 'desc';             // по seq; по умолчанию 'asc' (хронологический)
  where?: (r: SubstrateRecord) => boolean; // опц. предикат-добивка (НЕ индексируется)
}
```
Семантика: фильтры комбинируются логическим **И**. Пустой `QuerySpec` (`{}`) эквивалентен `all()`,
но как снимок-массив, отсортированный по `seq asc`. `sinceSeq` — основа инкрементального чтения
(линза или серверный синк подтягивают «всё, что появилось после моего курсора»).

### Контракт интерфейса субстрата (нормативные сигнатуры)
```ts
interface Substrate {
  /** Дописать запись. Возвращает финальную (с присвоенными id/seq/t). Идемпотентно по id. */
  write(input: WriteInput): Promise<SubstrateRecord>;

  /** Снимок записей по фильтру. Чистое чтение, безопасно к параллельным write. */
  query(spec?: QuerySpec): Promise<SubstrateRecord[]>;

  /** Полный снимок журнала (= query({}) по seq asc). Для экспорта/миграции/отладки. */
  all(): Promise<SubstrateRecord[]>;

  /** Стереть журнал целиком. Сбрасывает seq в 0. Эмитит substrate:cleared, если есть шина. */
  clear(): Promise<void>;

  /** Кол-во записей (дёшево, без материализации массива). */
  count(spec?: QuerySpec): Promise<number>;

  /** Подписка на новые записи (push поверх EventBus); возвращает функцию отписки. */
  subscribe(handler: (r: SubstrateRecord) => void): () => void;
}
```
Все операции **асинхронны** (`Promise`) — это цена «современного-первым»: IndexedDB и серверный
адаптер по природе async, и единый async-контракт избавляет от двух API. Для `MemoryAdapter`
промисы резолвятся синхронно-микротаском (тесты не платят за реальный I/O).

### Контракт персист-адаптера (точка подмены legacy)
Субстрат не хранит данные сам — он делегирует **адаптеру**. Это и есть «интерфейс, за которым
прячется легаси»:

```ts
interface PersistAdapter {
  /** Готовность хранилища (открыть БД/проверить квоту). Идемпотентно. */
  open(): Promise<void>;

  /** Append одной записи. ДОЛЖЕН быть идемпотентен по record.id (upsert-no-op при дубле). */
  append(record: SubstrateRecord): Promise<void>;

  /** Чтение по фильтру. Адаптер ОБЯЗАН отдать корректное множество; индексы — на его усмотрение. */
  read(spec: QuerySpec): Promise<SubstrateRecord[]>;

  /** Текущий максимум seq (для продолжения нумерации после перезагрузки). */
  maxSeq(): Promise<number>;

  /** Полная очистка. */
  clear(): Promise<void>;

  /** Имя адаптера для диагностики ("memory" | "localStorage" | "indexeddb" | "server"). */
  readonly name: string;
}
```

Четыре нормативных адаптера:

1. **`MemoryAdapter`** — `Array<SubstrateRecord>` + `Map<id>` для дедупа. Без персистентности.
   Назначение: юнит-тесты, 1D-текст-прогон «живого мира» без браузера ([NX-STRAT-004#tekst-1d]),
   SSR. **Базовый адаптер по умолчанию в тестах.**
2. **`LocalStorageAdapter`** — сериализация журнала в один ключ `nexus.substrate.<slot>` (JSON).
   Лимит ~5 МБ. Назначение: быстрый сейв одной вкладки, простые прототипы. Запись — read-modify-write
   всего массива (приемлемо до ~тысяч записей; выше — IndexedDB). Синхронная база, но интерфейс async.
3. **`IndexedDBAdapter`** — **адаптер по умолчанию в рантайме**. ObjectStore `records` с `keyPath:'id'`,
   индексы по `seq`, `type`, `zone`, `t`. `append` = `put` (идемпотентно), `read` = курсор по
   подходящему индексу (например `IDBKeyRange.lowerBound(sinceSeq, true)` по индексу `seq`). Ёмкий
   (сотни МБ), асинхронный — естественно ложится на современное ядро.
4. **`ServerAdapter` (ОПЦИОНАЛЬНЫЙ, legacy-совместимый)** — HTTP/`fetch` к серверу (PHP `nexus_api.php`
   или любой бэкенд) по контракту [NX-SPEC-003]: `append`→`echo.publish`, `read`→`echo.fetch`/sync по
   `sinceSeq`. Здесь сервер **переписывает `sig.authorId`/`t`** и валидирует анти-чит. Подключается
   **явно**, по умолчанию выключен; ядро без него работает локально. Это и есть «PHP — опциональный
   адаптер, не фундамент» из [NX-STRAT-004].

Допускается **композитный** `LayeredAdapter(local, remote)` (оптимистичная локальная запись +
фоновая отправка в `remote`, синк по `sinceSeq`) — но это надстройка над тем же интерфейсом, не
изменение контракта (см. развилку C).

### Фабрика и авто-фолбэк (деградация без смены контракта)
```ts
async function createSubstrate(opts?: {
  adapter?: PersistAdapter;          // явный адаптер (включая ServerAdapter/LayeredAdapter)
  slot?: string;                     // имя сейв-слота/мира (по умолчанию "default")
  bus?: EventBusLike | null;         // опц. EventBus для record:written/substrate:cleared
  prefer?: ('indexeddb'|'localStorage'|'memory')[]; // порядок авто-выбора; по умолч. этот же
}): Promise<Substrate>;
```
Если `adapter` не задан — `createSubstrate` пробует `prefer` по порядку, проверяя доступность
(`'indexedDB' in globalThis`, доступность `localStorage` в try/catch), и берёт первый рабочий.
**Контракт операций при любом адаптере идентичен** (инвариант I-7).

### Идемпотентность и порядок (event-sourcing гарантии)
- `write` с уже существующим `id` — **no-op**, возвращает **ранее сохранённую** запись (не плодит
  дубли). Это переносит идемпотентность `echoUid`/upsert из [NX-SPEC-003#detali] на уровень субстрата.
- `seq` **строго монотонен и плотен в пределах слота**: 1,2,3,… Назначается субстратом атомарно
  относительно `append` (в IndexedDB — внутри той же транзакции, читая `maxSeq`). После `clear` —
  обнуляется.
- Порядок `query(order:'asc')` — по `seq` (= порядок появления), не по `t` (часы клиентов могут
  расходиться; в серверном адаптере `t` серверное и согласовано с `seq`).

### Связь с EventBus и ECS-World (без нарушения слоёв)
- При успешном `write` субстрат (если ему передан `bus`) эмитит `record:written` с записью —
  так слой 3 (линзы/системы) и слой 2 (World-проекторы) узнают о новом факте, **не опрашивая**
  журнал. `clear` эмитит `substrate:cleared`. Каталог событий расширяет [NX-SPEC-001].
- ECS-`World` ([NX-SPEC-002]) **проецирует** записи в компоненты (например `echo.ghost` →
  сущность с `EchoMarker`), но это код **слоя 2**, а не субстрата. Субстрат о World не знает.

### Граничные случаи
- **Пустой журнал.** `query`/`all` → `[]`; `count` → 0; `maxSeq` → 0. `clear` на пустом — корректный no-op.
- **Запись без места.** `place:null` валидна (чисто текстовый факт, миф-символ без локации).
  Фильтр `zone` такие записи **не** возвращает (нет места — нет зоны).
- **`payload` несериализуем.** Контракт требует JSON-сериализуемый payload; адаптер с персистентностью
  при `append` несериализуемого значения **отклоняет** запись ошибкой `E_PAYLOAD_NOT_SERIALIZABLE`
  (а не молча теряет). `MemoryAdapter` для совместимости поведения тоже проверяет через
  `structuredClone`-проверку при включённом DEBUG.
- **Превышение квоты `localStorage`.** `append` ловит `QuotaExceededError` → ошибка `E_QUOTA`;
  вызывающий код может переключить слот на IndexedDB. Контракт не молчит.
- **Конкурентные `write`.** Два `write` подряд (до резолва первого) обязаны получить **разные** `seq`
  и не потеряться. В IndexedDB это гарантирует сериализуемость транзакций; в Memory/LocalStorage —
  внутренняя очередь операций (mutex-микроцепочка промисов).

### Инварианты (нормативные, проверяемы в DEBUG)
- **I-1 (append-only).** Существующая запись не меняется и не исчезает иначе как через `clear`.
  `query` дважды без `clear`/`write` между ними по тому же `spec` даёт идентичное множество.
- **I-2 (монотонность seq).** Для любых двух записей `a`,`b` в слоте: `a.seq < b.seq` ⇔ `a` записана раньше.
  Множество `seq` = `{1..maxSeq}` без пропусков и дублей.
- **I-3 (идемпотентность по id).** `write` дважды с одинаковым `id` ⇒ ровно одна запись в журнале,
  оба вызова вернули её же.
- **I-4 (снимок query).** Результат `query` — новый массив; мутация результата вызывающим **не**
  меняет журнал; параллельный `write` во время обхода результата его не «съезжает».
- **I-5 (агностичность места).** Субстрат хранит `place` как мировые координаты/зону и **не**
  интерпретирует их в пикселях/тайлах рендера ([NX-SYS-004]).
- **I-6 (непрозрачность payload).** Субстрат не читает и не валидирует структуру `payload` по `type`
  (это дело линз/серверного адаптера); он лишь обязан его сохранить и вернуть без потерь.
- **I-7 (адаптер-инвариантность).** Для одинаковой последовательности операций любой адаптер даёт
  **одинаковые наблюдаемые результаты** `query/all/count` (с точностью до персистентности между
  сессиями). Поведение контракта не зависит от выбранного адаптера.
- **I-8 (legacy-неблокирование).** Без `ServerAdapter` субстрат полностью функционален локально;
  серверный адаптер — строго опциональное расширение и не является зависимостью ядра.

### Коды ошибок
| Код | Когда | Операция |
|---|---|---|
| `E_INVALID_INPUT` | нет `type`/`payload`/`sig.authorId`, или `schemaVersion < 1` | write |
| `E_PAYLOAD_NOT_SERIALIZABLE` | payload не сериализуется | write |
| `E_QUOTA` | хранилище переполнено (localStorage/IndexedDB) | write |
| `E_ADAPTER_UNAVAILABLE` | ни один из `prefer`-адаптеров недоступен | createSubstrate |
| `E_CONFLICT_TYPE_SPEC` | заданы одновременно точный `type` и `typePrefix` | query |
| `E_REMOTE` | серверный адаптер: сеть/валидация (с под-кодом из [NX-SPEC-003]) | write/query |

## Предложения и варианты реализации

Псевдокод ниже — заготовка для роя. **ES-модуль** `substrate.js` (современное ядро); legacy v1/v2
получают тонкий UMD-шим `window.NEXUS.substrate` поверх того же модуля (адаптер совместимости, не ядро).

```pseudo
// ── ядро: общий движок поверх адаптера (стек-агностичен) ──
export async function createSubstrate(opts = {}) {
  const bus  = opts.bus ?? null
  const slot = opts.slot ?? 'default'
  const adapter = opts.adapter ?? await pickAdapter(opts.prefer ?? ['indexeddb','localStorage','memory'], slot)
  await adapter.open()
  let seq = await adapter.maxSeq()        // продолжить нумерацию после перезагрузки
  let opChain = Promise.resolve()         // сериализация write (гарантия I-2/конкурентности)

  function write(input) {
    validate(input)                        // E_INVALID_INPUT
    // ставим в очередь, чтобы seq назначался атомарно
    opChain = opChain.then(async () => {
      if (input.id) {                      // идемпотентность (I-3)
        const dup = await adapter.read({ /* by id */ })
        if (dup.length) return dup[0]
      }
      const rec = {
        id:   input.id ?? crypto.randomUUID(),
        type: input.type,
        t:    input.t ?? Date.now(),
        seq:  ++seq,
        place: input.place ?? null,
        payload: input.payload,
        sig: { authorId: input.sig.authorId, schemaVersion: input.sig.schemaVersion, hmac: input.sig.hmac ?? null }
      }
      await adapter.append(rec)            // E_PAYLOAD_NOT_SERIALIZABLE / E_QUOTA
      bus?.emit('record:written', rec)     // нотификация слою 2/3 (опц.)
      return rec
    })
    return opChain
  }

  async function query(spec = {}) {
    if (spec.type && spec.typePrefix) throw err('E_CONFLICT_TYPE_SPEC')
    let out = await adapter.read(spec)     // адаптер фильтрует по индексам где может
    if (spec.where) out = out.filter(spec.where)       // предикат-добивка (не индексируется)
    out.sort((a,b) => (spec.order === 'desc' ? b.seq - a.seq : a.seq - b.seq))
    if (spec.limit != null) out = out.slice(0, spec.limit)
    return out                             // снимок-массив (I-4)
  }

  const all   = () => query({})
  const count = async (spec) => (await query(spec)).length   // адаптер может переопределить дёшево
  async function clear() { await adapter.clear(); seq = 0; bus?.emit('substrate:cleared', { slot }) }
  function subscribe(h) { return bus ? bus.on('record:written', h) : () => {} }

  return { write, query, all, count, clear, subscribe }
}

// ── MemoryAdapter (нормативная семантика-эталон) ──
export function MemoryAdapter() {
  const arr = [], byId = new Map()
  return {
    name: 'memory',
    async open() {},
    async append(r) {
      if (byId.has(r.id)) return           // идемпотентность на уровне адаптера (I-3)
      if (DEBUG) assertSerializable(r.payload) // E_PAYLOAD_NOT_SERIALIZABLE
      arr.push(r); byId.set(r.id, r)
    },
    async read(spec) { return arr.filter(r => matches(r, spec)) }, // matches: type/zone/since/sinceSeq/…
    async maxSeq() { return arr.reduce((m,r) => Math.max(m, r.seq), 0) },
    async clear() { arr.length = 0; byId.clear() }
  }
}

// ── IndexedDBAdapter (адаптер по умолчанию в рантайме) ──
export function IndexedDBAdapter(slot) { /* objectStore 'records' keyPath:'id';
   индексы seq,type,zone,t; append=put; read=курсор по лучшему индексу; maxSeq=last по index('seq') */ }

// ── ServerAdapter (ОПЦИОНАЛЬНЫЙ legacy/PHP за тем же интерфейсом) ──
export function ServerAdapter({ baseUrl, token }) {
  return {
    name: 'server',
    async open() {},
    async append(r) { await postJSON(`${baseUrl}/echo.publish`, toWire(r, token)) }, // сервер пишет author/t
    async read(spec) { return (await postJSON(`${baseUrl}/echo.fetch`, toQuery(spec, token))).map(fromWire) },
    async maxSeq() { return (await postJSON(`${baseUrl}/sync.head`, { token })).seq ?? 0 },
    async clear() { /* как правило запрещён на сервере; локальный clear отдельно */ }
  } // протокол/анти-чит — [NX-SPEC-003]
}
```

**Развилки реализации:**
- **A. Адаптер по умолчанию = IndexedDB, фолбэк localStorage→memory.** Рекомендую — соответствует
  «современное-первым»; ёмкий журнал не упирается в 5 МБ.
- **B. Индексирование в IndexedDB.** Минимально — индекс по `seq` (для `sinceSeq`/порядка) и `type`.
  Индексы `zone`/`t` — добавлять по данным профиля ([NX-SYS-005] аналогично кэшу query в [NX-SPEC-002]).
- **C. `LayeredAdapter(local, remote)`** для асинхронного мультиплеера: оптимистичный локальный
  `append` + фоновый push в `remote` + синк по `sinceSeq`. Целевой режим для эхо ([NX-SPEC-003]),
  но строится **над** контрактом, не меняя его.
- **D. Сегментация/ротация журнала.** При больших объёмах — агрегаты/снапшоты состояния + обрезка
  старых записей (бюджеты [NX-SYS-005], риск «объём журнала» из [NX-VIS-004#riski]). Отложить до нужды.

**Минимальные тест-кейсы (обязательные для приёмки, гоняются на КАЖДОМ адаптере):**
1. `write` → `query({})` возвращает ровно одну запись с присвоенными `id`/`seq=1`/`t`.
2. Три `write` → `seq` = 1,2,3 без пропусков (I-2); `order:'desc'` отдаёт 3,2,1.
3. `write` с тем же `id` дважды → одна запись в журнале, оба вызова вернули её (I-3).
4. `query({type:'echo.message'})` и `query({typePrefix:'echo.'})` фильтруют корректно; их одновременная
   передача → `E_CONFLICT_TYPE_SPEC`.
5. `query({zone:'marsh'})` не возвращает записи с `place:null`; `query({sinceSeq:1})` отдаёт только seq>1.
6. Мутация результата `query` (push в массив) не влияет на следующий `query` (I-4).
7. `clear` → `all()` = `[]`, следующий `write` снова получает `seq=1` (сброс нумерации).
8. `write` без `type`/`payload`/`sig.authorId` → `E_INVALID_INPUT`; `schemaVersion:0` → `E_INVALID_INPUT`.
9. **Адаптер-инвариантность (I-7):** один и тот же сценарий 1–7 на Memory/localStorage/IndexedDB даёт
   идентичные наблюдаемые результаты.
10. **Фолбэк:** при недоступном IndexedDB `createSubstrate` выбирает localStorage; при недоступном и
    нём — memory; контракт операций неизменен (I-7/I-8).
11. **Конкурентность:** `Promise.all([write(a),write(b)])` → две записи с разными `seq`, обе в `all()`.
12. **Серверный опционал (I-8):** весь набор 1–11 проходит **без** `ServerAdapter`; с ним
    `sig.authorId` в сохранённой записи — серверное, не клиентское (контракт [NX-SPEC-003]).

## Что нового и какие кирпичики

> Раздел не обязателен для `spec`, но кратко — откуда решения (по [NX-META-001] §7).

- **Проверенные кирпичики (c20-proven / технические дисциплины):** event sourcing / append-only log
  (Kafka, Datomic, EventStore), идемпотентный upsert по UID (перенос `echoUid` из [NX-SPEC-003]),
  адаптер/порт-и-адаптер (гексагональная архитектура) для подмены persistence, snapshot-итерация
  (из [NX-SPEC-001]/[NX-SPEC-002]), инкрементальный синк по курсору `seq` (репликация по log offset).
- **Что нового против обычных веб-игр:** субстрат как **единый журнал смысла**, над которым 4 столпа —
  линзы ([NX-VIS-004]), плюс **строгая стек-агностичность** — один контракт от `memory` до PHP-сервера
  без изменения кода геймплея. В типичной браузерной игре persistence жёстко зашита (или localStorage,
  или сервер), а здесь это сменный модуль за интерфейсом.
- **Чего мало в вебе:** event-sourcing-субстрат с авто-деградацией IndexedDB→localStorage→memory и
  опциональным legacy-адаптером под единым async-контрактом, удерживающий 1D-текст/2D/3D как «окна в
  один журнал» ([NX-STRAT-004], [NX-SYS-004]).

## Риски, открытые вопросы
- **Async-контракт усложняет горячий путь.** Все операции — `Promise`; в кадровом цикле линзы должны
  работать с кэш-снимком (как [NX-SPEC-002] `queryStable`), а не `await`-ить субстрат каждый тик.
  Митигация: проекция записей в ECS-`World` при `record:written`, чтение горячих данных из World.
- **Рост журнала и очистка.** Append-only растёт; нужны агрегаты/снапшоты и ротация (развилка D,
  бюджеты [NX-SYS-005], прямой риск из [NX-VIS-004#riski]).
- **Синхронность seq в распределённом случае.** Локальный `seq` и серверный `seq` — разные оси;
  `LayeredAdapter` обязан вести **два курсора** (локальный и удалённый) и мапить их при синке.
  Контракт это допускает, но реализация синка — отдельная спека (расширение [NX-SPEC-003]).
- **Анти-чит — не в ядре.** Субстрат `payload`-непрозрачен (I-6); валидация правомерности живёт в
  **серверном адаптере** ([NX-SPEC-003]). Локальный субстрат записям доверяет — это допустимо для
  одиночного/локального режима, но мультиплеер **обязан** идти через серверный адаптер.
- **Совместимость с legacy v1/v2.** Монолиты v1/v2 не на ES-модулях; UMD-шим `window.NEXUS.substrate`
  обязателен как мост, но он — адаптер совместимости, а не часть современного ядра ([NX-STRAT-004]).

## Комментарии
Документ переводит контурный псевдокод [NX-VIS-004] (`Substrate.write`/`Substrate.query`) в
**реализуемый контракт** слоя 1 и явно фиксирует «современное-первым»: ES-модульное ядро с
IndexedDB по умолчанию, PHP/сервер — опциональный адаптер за интерфейсом `PersistAdapter`, не
блокирующий ядро (I-8). Структурно параллелен соседним спекам: [NX-SPEC-001] — слой 0 (шина),
[NX-SPEC-002] — слой 2 (состояние/ECS), этот — слой 1 (журнал фактов). Зрелость — `analyzed`
(реального кода субстрата в `shared/*` нет; эхо-обмен сегодня — частный PHP-случай [NX-SPEC-003],
который здесь обобщён до адаптера). Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-VIS-004 Мета-слой Койне — единый субстрат сигналов](../10-vision/NX-VIS-004-meta-layer-koine.md) — родительское видение (depends_on); контурный псевдокод субстрата
- [NX-SPEC-002 ECS с архетипами](./NX-SPEC-002-ecs-archetypes.md) — слой 2 (состояние); проекция записей в компоненты, snapshot-семантика query
- [NX-SPEC-001 EventBus 2.0](./NX-SPEC-001-eventbus-2.md) — слой 0; события `record:written`/`substrate:cleared`, snapshot-итерация
- [NX-SPEC-003 Эхо-протокол](./NX-SPEC-003-echo-protocol.md) — частный случай субстрата: серверный адаптер, анти-чит, идемпотентность по UID
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — принцип «современное-первым»; 1D-текст как окно в журнал
- [NX-SYS-004 Рендер-абстракция](../30-systems/NX-SYS-004-render-abstraction.md) — рендер-независимость `place` (мировые координаты)
- [Конституция вики](../00-meta/CONSTITUTION.md) · [Шаблон](../00-meta/TEMPLATE.md)
