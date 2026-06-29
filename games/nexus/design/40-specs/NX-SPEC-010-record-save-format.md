---
id: NX-SPEC-010
title: Формат записей/сохранения + версии и миграции — schemaVersion, конверт сейва, цепочка миграторов vN→vN+1, поведение при несовместимости
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [save-format, schemaversion, migrations, migrators, save-envelope, record-format, event-sourcing, append-log, forward-compat, backward-compat, corruption-recovery, integrity, checksum, es-modules, modern-first, persistence-adapter, indexeddb, contract, layer1, acceptance-tests]
relates_to: [NX-SYS-006, NX-SPEC-006, NX-SPEC-003, NX-SYS-003, NX-SPEC-002, NX-SPEC-001, NX-STRAT-004, NX-VIS-004, NX-POLY-009, NX-INN-004, NX-INN-003, NX-INN-011]
depends_on: [NX-SYS-006, NX-SPEC-006]
comments_on: [NX-SYS-006#detali, NX-SPEC-006#kanonicheskaya-forma, NX-STRAT-004#princip-sovremennoe-pervym]
superseded_by: null
maturity: analyzed
language: ru
---

# Формат записей/сохранения + версии и миграции

## TL;DR
Реализуемый, **стек-агностичный** контракт **формата сохранения** NEXUS и его эволюции во времени.
Сводит воедино две оси, заданные ранее: журнал **типизированных записей** субстрата ([NX-SPEC-006])
и **конверт сейва игрока** ([NX-SYS-006]). Фиксирует точные сигнатуры (TS-подобно), бинарно-стабильный
формат конверта (`SaveEnvelope`), **две независимые версии** — `formatVersion` (версия самого конверта)
и `schemaVersion` (версия содержимого `state`), **цепочку чистых функций-миграторов** `vN → vN+1`,
порядок прогона и **строго определённое поведение при несовместимости** (сейв из будущего, дыра в
цепочке, порча, чужой формат). По принципу «современное-первым» ([NX-STRAT-004]) сериализатор и реестр
миграторов — **чистый ES-модуль** (`crypto`, `structuredClone`, `TextEncoder`), хранилище — за
интерфейсом `PersistAdapter` из [NX-SPEC-006] (IndexedDB по умолчанию, localStorage/memory — фолбэк),
а PHP/серверный сейв — **опциональный адаптер**, не ядро. Даны инварианты, коды ошибок, критерии
приёмки и минимальные тест-кейсы (golden-фикстуры всех исторических версий).

## Краткое содержание
[NX-SYS-006] на уровне `extended` зафиксировал **идею**: сейв — это версионированный конверт с
`schemaVersion`, целостностью (`checksum`) и **цепочкой миграторов** `vN→vN+1`, прогоняемой при загрузке;
тот же приём версионирования общий для трёх осей (сейв игрока, контент `data/` [NX-SYS-003], мод
[NX-POLY-009]). [NX-SPEC-006] зафиксировал **журнал записей** (`SubstrateRecord`, append-only, `seq`,
`Sig.schemaVersion` для версии payload каждого `type`). Этот документ — **контракт второго роя**: он
переводит обе вещи в точные сигнатуры и закрывает то, что в [NX-SYS-006] осталось эскизом:

1. **Точная форма конверта** `SaveEnvelope` (нормативные поля, типы, обязательность, порядок для
   стабильного хеша).
2. **Две оси версий, не одна.** `formatVersion` (как устроен **конверт**: где лежит чек-сумма, как
   кодируется журнал) ⟂ `schemaVersion` (как устроено **содержимое** `state`). Их путают — здесь разводим.
3. **Контракт миграторов** как чистых функций `(doc) → doc` + сигнатура движка `migrate.run(...)` +
   инварианты непрерывности и идемпотентности цепочки.
4. **Что именно сериализуется из субстрата** ([NX-SPEC-006]): сейв содержит либо снимок `state`
   (проекция), либо сегмент журнала записей (`records[]` от `sinceSeq`), либо оба — три профиля сейва.
5. **Поведение при несовместимости** — нормативная таблица решений (не «по ситуации»): из будущего,
   дыра, порча, чужой `magic`, неизвестный `type` записи, мод выключен.

Главный тезис: **формат — это контракт во времени**. Движок версии `B` обязан корректно прочитать любой
сейв, сделанный версиями `≤ B` (через миграторы), и **не угадывать** сейвы версии `> B` (честно отказать,
не затереть). Сериализация и миграция — **за интерфейсом** persistence ([NX-SPEC-006]): один и тот же
формат живёт поверх `memory`/`localStorage`/`IndexedDB`/`server`.

## Расширенное содержание (общее)

### Место формата в архитектуре (слои)
Формат сейва — это **граница persistence слоя 1** ([NX-SPEC-006]): то, как журнал/состояние
сериализуется наружу и читается обратно.
```
СЛОЙ 0  EventBus        — события save:loaded / save:recovered / save:migrated         [NX-SPEC-001]
СЛОЙ 1  Substrate       — журнал записей (источник данных для сейва-журнала)           [NX-SPEC-006]
        SaveFormat (ЭТОТ) — конверт, версии, миграторы, сериализация записей           [NX-SPEC-010]
СЛОЙ 2  World (ECS)     — текущее состояние (источник данных для сейва-снимка)          [NX-SPEC-002]
СЛОЙ 3  SaveSystem/линзы — вызывают serialize/deserialize, не знают про формат внутри  [NX-SYS-006]
```
Формат **может**: знать про `PersistAdapter` ([NX-SPEC-006]), про форму `SubstrateRecord`, эмитить
события в шину. Формат **не может**: знать про Three.js/DOM-рендер, про конкретную линзу, про правила
геймплея (он сериализует то, что дали; смысл полей — дело [NX-SYS-006]/[NX-SPEC-002]). Это та же
дисциплина однонаправленности, что в соседних спеках.

### Принцип «современное-первым» — где он в этом контракте
По [NX-STRAT-004#princip-sovremennoe-pervym]:
- **Ядро современно.** `save-format.js` — **ES-модуль** (`export`/`import`). Хеш — через `TextEncoder`
  (UTF-8 байты, детерминированно), id/время — `crypto.randomUUID()`/`Date.now()`, глубокое копирование
  миграторами — `structuredClone`. Кодировка по умолчанию — **JSON** (читается человеком/дизайнером),
  с опциональным бинарным профилем (см. развилку D). Хранилище по умолчанию — **IndexedDB** (через
  адаптер [NX-SPEC-006]), без обязательной привязки к `localStorage`.
- **Легаси — опциональный адаптер.** Серверный/PHP сейв ([NX-SYS-002], `nexus_api.php`) — это **тот же
  формат** конверта, передаваемый через `ServerAdapter` ([NX-SPEC-006]); подключается явно, по умолчанию
  выключен, **не блокирует** локальный сейв. PHP — сменный модуль за интерфейсом, не фундамент.
- **Деградация, а не зависимость.** Нет IndexedDB → формат тот же поверх `localStorage`/`memory`
  (контракт неизменен, инвариант I-7 из [NX-SPEC-006]). Нет `crypto.subtle` — чек-сумма FNV-1a на чистом
  JS (она и так не крипто; см. ниже).

### Две оси версий — `formatVersion` ⟂ `schemaVersion`
[NX-SYS-006] говорил об одном `schemaVersion`. На уровне контракта этого мало: меняться может **и**
устройство содержимого, **и** устройство самого конверта (например, перешли с inline-`state` на
`records[]`-журнал, или сменили алгоритм чек-суммы). Поэтому **две независимые целочисленные оси**:

| Ось | Что версионирует | Кто мигрирует | Заморожена при |
|---|---|---|---|
| **`formatVersion`** | структуру **конверта**: расположение полей, кодировку, алгоритм `checksum`, профиль (snapshot/journal) | `EnvelopeMigrations` (миграторы конверта) | смене раскладки контейнера |
| **`schemaVersion`** | структуру **`state`** (прогресс игрока): поля level/inventory/knowledge/… | `StateMigrations` (миграторы состояния) | смене формы прогресса |

Дополнительно — **третья, локальная ось**: `Sig.schemaVersion` каждой записи ([NX-SPEC-006]) версионирует
**payload конкретного `type`** (например `echo.message` v1→v2). Её мигрируют **линзы-владельцы типа** при
чтении записи, по тому же контракту миграторов (см. «Миграция payload записей»). Три оси — **один
механизм** `migrate.run`, разные цепочки и моменты запуска (прямое развитие «три оси — один принцип» из
[NX-SYS-006]).

> Практика: `formatVersion` меняется **редко** (раз в эпоху), `schemaVersion` — **по фичам прогресса**,
> `Sig.schemaVersion` — **локально по типу**. Большинство релизов трогают только `schemaVersion`.

### Три профиля сейва (что именно сериализуется)
Субстрат ([NX-SPEC-006]) — это журнал, World ([NX-SPEC-002]) — проекция-состояние. Сейв может нести любое
из трёх — это поле конверта `profile`, **часть формата**:

| `profile` | Что в конверте | Назначение | Восстановление |
|---|---|---|---|
| `"snapshot"` | только `state` (проекция World) | компактный сейв прогресса игрока (как [NX-SYS-006]) | присвоить `state` движку |
| `"journal"` | `records[]` — сегмент журнала субстрата (от `sinceSeq`) | event-sourcing, реплей, эхо-экспорт, отладка | `replay`: `substrate.write` каждой записи по порядку `seq` |
| `"hybrid"` | `state` + хвост `records[]` после последнего снапшота | быстрый старт (snapshot) + дозапись (journal); ротация журнала [NX-SPEC-006 разв. D] | присвоить `state`, затем доиграть хвост записей |

Профиль фиксируется в конверте, чтобы загрузчик знал стратегию восстановления **из самого файла**, а не
из конфигурации. Миграторы `state` применяются к `snapshot`/`hybrid.state`; миграция payload записей — к
`journal`/`hybrid.records` (разные цепочки, разные оси — см. выше).

### Миграция — цепочка чистых функций (контракт)
Прямой перенос проверенного кирпичика БД-миграций (Flyway/Alembic/Rails), уже выбранного в [NX-SYS-006]:
миграция — это **упорядоченный реестр** `{ [v]: (doc) => doc }`, где шаг с ключом `v` переводит документ
с версии `v-1` на `v`. Чтобы поднять с `from` до `to`, движок прогоняет `from+1 … to` по очереди. Каждый
шаг — **чистая функция** `(doc) → doc` над `structuredClone(doc)` (без мутации входа), что даёт
композицию, тестируемость (вход vN → выход vN+1) и аудируемость (цепочка читается как changelog).
**Старые шаги навсегда заморожены** — новый формат добавляет функцию в конец, не трогая прошлые.

### Поведение при несовместимости — нормативно, не «по ситуации»
Самая частая дыра реальных сейв-систем — недоопределённое поведение на «не своём» сейве. Здесь оно
**таблично и обязательно** (детали — ниже): сейв **новее** игры → не угадывать, не затирать, сообщить;
**дыра** в цепочке → громко в деве (CI), деградация с бэкапом в проде; **порча**/чужой `magic` →
бэкап оригинала + чистый профиль; **неизвестный `type`** записи → толерантно сохранить как непрозрачный
blob, не терять; **мод выключен** → пометить ссылки «недоступны», не удалять. Принцип сквозной:
**никогда не теряем оригинал молча и никогда не угадываем будущее.**

## Детали и частные случаи

### Каноническая форма конверта (`SaveEnvelope`) — нормативные типы
TS-подобные типы — нормативная форма контракта (конкретный язык — деталь реализации):

```ts
/** Маркер «это наш сейв». Константа; отсекает чужие строки ДО доверия JSON.parse. */
type Magic = "NEXUS_SAVE";

/** Профиль восстановления — стратегия чтения сейва зашита в сам файл. */
type SaveProfile = "snapshot" | "journal" | "hybrid";

/** Алгоритм чек-суммы (расширяемо; не крипто — защита от порчи, не анти-чит). */
type ChecksumAlg = "fnv1a" | "crc32";

/** Прогресс игрока. Форму версионирует schemaVersion; формат её НЕ интерпретирует. */
type SaveState = Record<string, unknown>;

/** Конверт сохранения — корневой объект формата. Поля в этом порядке для стабильного хеша. */
interface SaveEnvelope {
  magic: Magic;                 // всегда "NEXUS_SAVE"
  formatVersion: number;        // версия КОНВЕРТА (целое >= 1)
  schemaVersion: number;        // версия STATE (целое >= 1); для profile:"journal" может быть 0 (нет state)
  profile: SaveProfile;         // snapshot | journal | hybrid
  engineBuild: string;          // человекочитаемый билд движка, для диагностики ("0.4.1")
  slot: string;                 // имя сейв-слота/мира (= slot субстрата, NX-SPEC-006)
  createdAt: number;            // Date.now() первого создания профиля (мс, UTC)
  savedAt: number;              // Date.now() этого сохранения (мс, UTC)
  checksum: {                   // целостность ТЕЛА (state + records), не самого конверта
    alg: ChecksumAlg;
    value: string;              // hex-строка хеша canonical-сериализации тела
  };
  profileMeta: {                // лёгкие метаданные профиля игрока (для списка сейвов без парсинга state)
    name: string;
    sessionId: string;
  };
  state?: SaveState | null;     // присутствует при profile snapshot|hybrid; иначе null/отсутствует
  records?: SaveRecord[] | null;// присутствует при profile journal|hybrid; сегмент журнала субстрата
  baseSeq?: number;             // для hybrid: seq, ПОСЛЕ которого идут records (state отражает <= baseSeq)
  mods: ModRef[];               // активные моды на момент сохранения (может быть [])
}

/** Запись журнала в сейве = SubstrateRecord (NX-SPEC-006), сериализованный 1:1. */
interface SaveRecord {
  id: string; type: string; t: number; seq: number;
  place: { zone: string; x?: number; y?: number; z?: number; tile?: number | null } | null;
  payload: Record<string, unknown>;
  sig: { authorId: string; schemaVersion: number; hmac?: string | null };
}

/** Ссылка на мод (для толерантной деградации при выключенном моде). */
interface ModRef { id: string; version: string; }
```

Нормативные правила формы:
- **Порядок полей фиксирован** (как выше) — он входит в определение canonical-сериализации для `checksum`
  (см. ниже). Сериализатор обязан выдавать поля в этом порядке; десериализатор порядок не требует.
- `state` обязателен ⇔ `profile ∈ {snapshot, hybrid}`; `records` обязателен ⇔ `profile ∈ {journal, hybrid}`.
- Для `profile:"journal"` `schemaVersion` относится к **формату записи**, а не к `state`; если `state`
  отсутствует — `schemaVersion` равен версии формата записей-снимка (по умолчанию 1).
- `SaveRecord` сериализуется **байт-в-байт по форме `SubstrateRecord`** [NX-SPEC-006] — формат сейва не
  вводит свою форму записи, он переиспользует субстратную (единый источник истины формы записи).

### Каноническая сериализация и `checksum`
`checksum` защищает от **тихой порчи хранилища**, а не от чита (анти-чит — сервер, [NX-SYS-002]).
Нормативный алгоритм:
1. Тело = объект `{ state: env.state ?? null, records: env.records ?? null, baseSeq: env.baseSeq ?? null }`.
2. `canonical = stableStringify(тело)` — JSON с **детерминированной сортировкой ключей** на всех уровнях
   и без незначащих пробелов (исключает зависимость хеша от порядка ключей в рантайме).
3. `bytes = new TextEncoder().encode(canonical)` (UTF-8).
4. `value = hex(FNV1a(bytes))` (или CRC32, по `alg`). FNV-1a выбран как быстрый, безопасный, без
   зависимостей (как и в [NX-SYS-006]).
5. При загрузке: пересчитать по тому же телу; несовпадение ⇒ пометка `maybeCorrupt` (не фатально сразу —
   политика восстановления ниже).

`checksum` покрывает **тело**, а не весь конверт: метаданные (`savedAt`, `engineBuild`) меняются при
перезаписи без влияния на смысл данных и не должны инвалидировать хеш.

### Реестр миграторов и сигнатура движка
```ts
/** Один шаг миграции: переводит документ с версии (key-1) на (key). Чистая функция. */
type MigrationStep<T = unknown> = (doc: T) => T;

/** Реестр: разрежённый словарь по целевой версии. Ключи — последовательны от 2 до CURRENT. */
type MigrationChain<T = unknown> = { [targetVersion: number]: MigrationStep<T> };

interface MigrateApi {
  /**
   * Прогнать doc через цепочку с fromVersion (исключая) до toVersion (включая).
   * Чисто: вход не мутируется (внутри structuredClone). Бросает при дыре/из-будущего.
   */
  run<T>(chain: MigrationChain<T>, doc: T, fromVersion: number, toVersion: number): T;

  /** Проверка непрерывности цепочки [from..to]: все ключи from+1..to присутствуют. */
  validateChain(chain: MigrationChain, from: number, to: number):
    { ok: true } | { ok: false; missing: number[] };
}
```
Нормативная семантика `run`:
- `fromVersion === toVersion` ⇒ возврат `structuredClone(doc)` без шагов (ноль миграций — валидно).
- `fromVersion > toVersion` ⇒ ошибка `E_SAVE_FROM_FUTURE` (вниз не мигрируем; downgrade вне scope, как
  в [NX-SYS-006]).
- Отсутствует ключ `v ∈ (from, to]` ⇒ ошибка `E_MIGRATION_GAP` с указанием `v` (дыра в цепочке = баг
  сборки; CI обязан ловить через `validateChain(chain, 1, CURRENT)`).
- Каждый шаг применяется к **клону** результата предыдущего; исходный `doc` не мутируется (I-3 ниже).

### Сигнатура сериализатора формата (публичный API)
```ts
interface SaveCodecApi {
  readonly FORMAT_VERSION: number;   // текущая версия конверта, поддерживаемая этим билдом
  readonly STATE_SCHEMA_VERSION: number; // текущая версия state, поддерживаемая этим билдом

  /** Собрать конверт из состояния/журнала и сериализовать в строку (или Uint8Array для бинаря). */
  serialize(input: {
    profile: SaveProfile;
    state?: SaveState | null;
    records?: SaveRecord[] | null;
    baseSeq?: number;
    slot: string;
    profileMeta: { name: string; sessionId: string };
    mods?: ModRef[];
    createdAt?: number;              // если не задан — Date.now()
  }): string;

  /**
   * Прочитать строку → провалидировать → мигрировать конверт и state до текущих версий → вернуть.
   * НЕ бросает на несовместимости данных: возвращает дискриминированный результат (см. ниже).
   */
  deserialize(raw: string, opts?: {
    bus?: EventBusLike | null;       // для save:loaded/save:migrated/save:recovered
    stateMigrations?: MigrationChain;    // реестр миграторов state (по умолчанию встроенный)
    envelopeMigrations?: MigrationChain; // реестр миграторов конверта
  }): DeserializeResult;
}

/** Результат deserialize — дискриминированный союз, без исключений на «ожидаемых» бедах. */
type DeserializeResult =
  | { ok: true;  envelope: SaveEnvelope; migrated: boolean }              // успех (возможно после миграции)
  | { ok: false; reason: "empty" }                                       // нет сейва — новый профиль
  | { ok: false; reason: "foreign";   backupKey?: string }               // не наш magic/битый верх
  | { ok: false; reason: "corrupt";   backupKey: string; detail?: string }// parse/checksum провал → бэкап
  | { ok: false; reason: "from_future"; saveVersion: number; engineVersion: number } // сейв новее игры
  | { ok: false; reason: "gap";       missing: number[]; backupKey: string }          // дыра в цепочке
  | { ok: false; reason: "schema_invalid"; errors: string[]; backupKey: string };     // не прошёл схему
```
`deserialize` **не бросает** на ожидаемых ситуациях (пустой/чужой/из будущего/порча) — она возвращает
причину, чтобы вызывающий [NX-SYS-006 SaveSystem] принял UX-решение (новый профиль, «обновите игру»,
уведомление). Исключения остаются только для **программерских** ошибок (например, `serialize` без
обязательного `slot`).

### Конвейер `deserialize` (нормативный порядок)
1. `raw` пуст/`null` ⇒ `{ ok:false, reason:"empty" }` (новый профиль).
2. `JSON.parse` в `try/catch`. Ошибка ⇒ бэкап `raw` в `nexus_save_corrupt_<ts>`, `{reason:"corrupt"}`.
3. Проверить `env.magic === "NEXUS_SAVE"` и `typeof env.formatVersion === "number"`. Иначе ⇒
   бэкап, `{reason:"foreign"}`.
4. `env.formatVersion > FORMAT_VERSION` **или** `env.schemaVersion > STATE_SCHEMA_VERSION` ⇒
   `{reason:"from_future", ...}` — **не трогаем оригинал**.
5. Пересчитать `checksum` тела. Несовпадение ⇒ пометить `maybeCorrupt`; **не прерывать**, но бэкап-первым
   (оригинал не перезаписывать до успешной валидации).
6. Мигрировать **конверт**: если `env.formatVersion < FORMAT_VERSION` ⇒
   `migrate.run(envelopeMigrations, env, env.formatVersion, FORMAT_VERSION)`; `env.formatVersion = FORMAT_VERSION`.
   При дыре ⇒ бэкап, `{reason:"gap", missing}`.
7. Мигрировать **state** (если есть): если `env.schemaVersion < STATE_SCHEMA_VERSION` ⇒
   `migrate.run(stateMigrations, env.state, env.schemaVersion, STATE_SCHEMA_VERSION)`;
   `env.schemaVersion = STATE_SCHEMA_VERSION`. При дыре ⇒ бэкап, `{reason:"gap"}`.
8. Провалидировать `env.state` по `SAVE_STATE_SCHEMA` (те же вороты, что у контента [NX-SYS-003]).
   Ошибки ⇒ бэкап, `{reason:"schema_invalid", errors}`.
9. Для `records` (journal/hybrid): миграцию payload **не** делает кодек сейва — записи мигрируются
   **линзами-владельцами типа** при чтении (см. ниже). Кодек лишь восстанавливает форму `SaveRecord`.
10. `migrated = (шаги 6 или 7 что-то изменили)`. Эмитить `save:migrated`/`save:loaded`. Вернуть
    `{ ok:true, envelope, migrated }`. Вызывающий, при `migrated`, обязан **переписать сейв** в текущем
    формате (одноразовая починка) — но только после успешных шагов 7–8.

### Восстановление субстрата из `journal`/`hybrid`
```ts
/** Восстановить журнал субстрата из сегмента сейва. Идемпотентно по record.id (NX-SPEC-006 I-3). */
async function replayInto(substrate: Substrate, records: SaveRecord[]): Promise<void> {
  for (const r of records.slice().sort((a, b) => a.seq - b.seq)) {
    await substrate.write(r);   // write идемпотентен по id; seq сохранится тот же при пустом слоте
  }
}
```
Инвариант реплея: для **пустого** целевого слота `replayInto` восстанавливает идентичный журнал
(`seq` совпадают, т.к. записи несут свои `id`/`seq`, а субстрат идемпотентен по `id`). Для `hybrid`:
сначала присвоить `state` движку, затем `replayInto(substrate, env.records)` для хвоста после `baseSeq`.

### Миграция payload записей (третья ось, владелец — линза)
Запись несёт `sig.schemaVersion` — версию формата своего `payload` для данного `type` ([NX-SPEC-006]).
Кодек сейва её **не интерпретирует** (инвариант непрозрачности payload I-6 [NX-SPEC-006]). Когда линза
читает записи через `substrate.query`, она применяет **свою** цепочку к payload устаревших записей:
```ts
interface TypeMigratable {
  type: string;                    // напр. "echo.message"
  CURRENT: number;                 // текущая sig.schemaVersion этого type
  chain: MigrationChain;           // миграторы payload (key v: payload v-1 -> v)
  /** Поднять payload записи до CURRENT (не мутируя журнал; результат — для рантайма линзы). */
  upgrade(rec: SaveRecord): Record<string, unknown>;  // = migrate.run(chain, rec.payload, rec.sig.schemaVersion, CURRENT)
}
```
Журнал **остаётся как есть** (append-only, I-1 [NX-SPEC-006]); миграция payload — это **чтение-время**
преобразование в рантайм-форму линзы. По желанию линза может дописать новую запись `type` с актуальной
версией (event-sourcing), но это её политика, не обязанность формата.

### Граничные случаи и нормативные решения
| Случай | Условие | Решение (нормативно) |
|---|---|---|
| **Пустой сейв** | нет ключа в хранилище | `{reason:"empty"}` → новый профиль; не ошибка |
| **Сейв из будущего** | `formatVersion>CUR` ИЛИ `schemaVersion>CUR` | `{reason:"from_future"}`; **не** мигрировать вниз, **не** затирать оригинал; UX «обновите игру» |
| **Дыра в цепочке** | нет шага `v∈(from,to]` | дев/CI: падать громко (`validateChain` в тесте); прод: бэкап + `{reason:"gap"}` → новый профиль |
| **Порча (parse)** | `JSON.parse` бросил | бэкап `raw`, `{reason:"corrupt"}` |
| **Порча (checksum)** | хеш не сошёлся | `maybeCorrupt`; продолжить миграцию, но бэкап-первым; при провале схемы → `{reason:"corrupt"}` |
| **Чужой файл** | `magic≠NEXUS_SAVE` | `{reason:"foreign"}`; бэкап; новый профиль |
| **Неизвестный `type` записи** | journal содержит `type` без линзы-владельца | запись **сохраняется как непрозрачный blob**, не теряется; линза появится — прочитает (толерантность) |
| **Неизвестное поле `state`** | поле, которого нет в текущей схеме | сохранять как есть (forward-tolerant) **только** для зон, помеченных `additionalProperties:true`; иначе — миграция должна была учесть |
| **Мод выключен при загрузке** | `state`/record ссылается на `id` оверлея неактивного мода | ссылка помечается «недоступна (мод X выключен)», хранится как blob, **не** удаляется ([NX-SYS-006]) |
| **Несколько вкладок** | две вкладки пишут один слот | `storage`-событие как сигнал «изменён в другой вкладке»; полная блокировка — открытый вопрос ([NX-SYS-006]) |
| **Квота переполнена** | `QuotaExceededError` при записи | `E_QUOTA` ([NX-SPEC-006]); политика обрезки/сжатия/переход на IndexedDB у вызывающего |

### Инварианты (нормативные, проверяемы в DEBUG/тестах)
- **I-1 (две оси независимы).** `formatVersion` и `schemaVersion` мигрируются **раздельными** цепочками;
  изменение одной не требует изменения другой. После `deserialize` обе равны текущим версиям билда.
- **I-2 (непрерывность цепочки).** Для каждой цепочки `validateChain(chain, 1, CURRENT).ok === true`:
  ключи `2..CURRENT` присутствуют без пропусков. Нарушение — баг сборки, ловится CI.
- **I-3 (чистота миграторов).** `run` не мутирует входной `doc` (каждый шаг — над `structuredClone`);
  повторный `run(chain, doc, from, to)` даёт **глубоко равный** результат (детерминизм/идемпотентность
  на уровне «тот же вход → тот же выход»).
- **I-4 (заморозка истории).** Уже выпущенный шаг `chain[v]` не меняется при добавлении `chain[v+1]`;
  новый формат — только дописывание в конец. Тест: golden-фикстуры старых версий продолжают грузиться.
- **I-5 (round-trip).** Для текущей версии `deserialize(serialize(x))` восстанавливает семантически
  эквивалентный конверт; `checksum` совпадает (canonical-сериализация детерминирована).
- **I-6 (не-затирание будущего).** При `from_future` оригинал в хранилище **не изменяется** ни одним
  путём кода `deserialize`.
- **I-7 (бэкап-первым).** Любая ветка `corrupt|foreign|gap|schema_invalid` **сначала** сохраняет оригинал
  в `nexus_save_corrupt_<ts>` и лишь потом возвращает причину; оригинал не теряется молча.
- **I-8 (адаптер-инвариантность).** Один и тот же конверт сериализуется/десериализуется идентично поверх
  любого `PersistAdapter` ([NX-SPEC-006] I-7); формат не зависит от хранилища.
- **I-9 (реплей-идемпотентность).** `replayInto` в пустой слот восстанавливает журнал с теми же `seq`;
  повторный `replayInto` тех же записей — no-op (идемпотентность по `id`, [NX-SPEC-006] I-3).
- **I-10 (непрозрачность payload в формате).** Кодек сейва не читает и не мигрирует `payload` записей —
  только сохраняет/восстанавливает форму; миграция payload — ответственность линзы (третья ось).

### Коды ошибок (бросаемые) и причины (возвращаемые)
Бросаемые (программерские ошибки):
| Код | Когда |
|---|---|
| `E_SAVE_FROM_FUTURE` | `migrate.run` вызван с `from > to` |
| `E_MIGRATION_GAP` | `migrate.run` встретил отсутствующий шаг `v∈(from,to]` |
| `E_SERIALIZE_INPUT` | `serialize` без обязательного поля (`slot`/`profile`/несоответствие profile↔state/records) |
| `E_QUOTA` | хранилище переполнено (проброс из адаптера [NX-SPEC-006]) |

Возвращаемые `deserialize` (ожидаемые ситуации, не исключения): `empty`, `foreign`, `corrupt`,
`from_future`, `gap`, `schema_invalid` (см. `DeserializeResult`). Разделение «бросаем баги — возвращаем
ожидаемое» — нормативное.

## Предложения и варианты реализации

Псевдокод ниже — заготовка для роя. **ES-модуль** `save-format.js` (современное ядро); legacy v1/v2
получают тонкий UMD-шим `window.NEXUS.save` поверх того же модуля (адаптер совместимости, не ядро).

```pseudo
// ── общая библиотека миграций (используется конвертом, state и payload записей) ──
export const migrate = {
  run(chain, doc, from, to) {
    if (from > to) throw err('E_SAVE_FROM_FUTURE', { from, to })
    let v = from, out = structuredClone(doc)
    while (v < to) {
      const step = chain[v + 1]
      if (!step) throw err('E_MIGRATION_GAP', { missing: v + 1 })
      out = step(structuredClone(out))          // чистый шаг (I-3)
      v++
    }
    return out
  },
  validateChain(chain, from, to) {
    const missing = []
    for (let v = from + 1; v <= to; v++) if (!chain[v]) missing.push(v)
    return missing.length ? { ok: false, missing } : { ok: true }
  }
}

// ── кодек формата ──
export function createSaveCodec({ FORMAT_VERSION, STATE_SCHEMA_VERSION,
                                  envelopeMigrations, stateMigrations, stateSchema }) {
  function serialize(inp) {
    if (!inp.slot || !inp.profile) throw err('E_SERIALIZE_INPUT')
    requireProfileFields(inp)                   // snapshot⇒state; journal⇒records; hybrid⇒оба+baseSeq
    const body = { state: inp.state ?? null, records: inp.records ?? null, baseSeq: inp.baseSeq ?? null }
    const env = {
      magic: 'NEXUS_SAVE', formatVersion: FORMAT_VERSION, schemaVersion: STATE_SCHEMA_VERSION,
      profile: inp.profile, engineBuild: NEXUS.build, slot: inp.slot,
      createdAt: inp.createdAt ?? Date.now(), savedAt: Date.now(),
      checksum: { alg: 'fnv1a', value: fnv1aHex(stableStringify(body)) },
      profileMeta: inp.profileMeta, ...body, mods: inp.mods ?? [],
    }
    return stableStringify(env)                 // порядок ключей фиксирован → стабильный round-trip (I-5)
  }

  function deserialize(raw, opts = {}) {
    const bus = opts.bus ?? null
    if (!raw) return { ok: false, reason: 'empty' }
    let env
    try { env = JSON.parse(raw) }
    catch { return recover('corrupt', raw, bus) }

    if (env.magic !== 'NEXUS_SAVE' || typeof env.formatVersion !== 'number')
      return recover('foreign', raw, bus)
    if (env.formatVersion > FORMAT_VERSION || env.schemaVersion > STATE_SCHEMA_VERSION)
      return { ok: false, reason: 'from_future',                 // НЕ трогаем оригинал (I-6)
               saveVersion: env.schemaVersion, engineVersion: STATE_SCHEMA_VERSION }

    const body = { state: env.state ?? null, records: env.records ?? null, baseSeq: env.baseSeq ?? null }
    const maybeCorrupt = fnv1aHex(stableStringify(body)) !== env.checksum.value

    let migrated = false
    try {
      if (env.formatVersion < FORMAT_VERSION) {                  // ось 1: конверт
        env = migrate.run(opts.envelopeMigrations ?? envelopeMigrations, env, env.formatVersion, FORMAT_VERSION)
        env.formatVersion = FORMAT_VERSION; migrated = true
      }
      if (env.state && env.schemaVersion < STATE_SCHEMA_VERSION) { // ось 2: state
        env.state = migrate.run(opts.stateMigrations ?? stateMigrations, env.state, env.schemaVersion, STATE_SCHEMA_VERSION)
        env.schemaVersion = STATE_SCHEMA_VERSION; migrated = true
      }
    } catch (e) {
      if (e.code === 'E_MIGRATION_GAP') return recover('gap', raw, bus, { missing: [e.missing] })
      throw e
    }

    if (env.state) {
      const rep = validateBySchema(env.state, stateSchema)       // те же вороты, что контент (NX-SYS-003)
      if (rep.errors.length) return recover('schema_invalid', raw, bus, { errors: rep.errors })
    }
    if (maybeCorrupt && !env.state) return recover('corrupt', raw, bus, { detail: 'checksum' })

    bus?.emit(migrated ? 'save:migrated' : 'save:loaded', { format: FORMAT_VERSION, schema: env.schemaVersion })
    return { ok: true, envelope: env, migrated }
  }

  function recover(reason, raw, bus, extra = {}) {
    const backupKey = 'nexus_save_corrupt_' + Date.now()
    persist.backup(backupKey, raw)                               // НИКОГДА не теряем оригинал (I-7)
    bus?.emit('save:recovered', { reason, ...extra })
    return { ok: false, reason, backupKey, ...extra }
  }

  return { FORMAT_VERSION, STATE_SCHEMA_VERSION, serialize, deserialize }
}

// ── реестры миграторов (только дописывание в конец, старые заморожены — I-4) ──
export const STATE_MIGRATIONS = {           // ось schemaVersion (NX-SYS-006 пример)
  2: (s) => { s.inventory = s.inventory ?? []; return s },               // появился инвентарь
  3: (s) => { s.maxHp = s.hp_max; delete s.hp_max; return s },           // переименование поля
  4: (s) => { s.knowledge = { bestiary: [], recipes: [] }; return s },   // ось знания (NX-INN-004)
}
export const ENVELOPE_MIGRATIONS = {        // ось formatVersion
  2: (e) => { e.checksum = { alg: 'fnv1a', value: e.checksum }; return e }, // checksum-строка → объект
  3: (e) => { e.profile = e.profile ?? 'snapshot'; e.slot = e.slot ?? 'default'; return e }, // профили/слоты
}
```

### Развилки реализации
- **A. Хранилище через `PersistAdapter` [NX-SPEC-006] (рекомендую).** Формат не привязан к localStorage:
  `serialize` отдаёт строку/байты, запись — через адаптер (IndexedDB по умолчанию, localStorage/memory
  фолбэк). Сейв субстрата (journal) и сейв прогресса (snapshot) живут в одном механизме.
- **B. Профиль по умолчанию = `snapshot`** для прогресса игрока (компактно, как [NX-SYS-006]); `journal`/
  `hybrid` — для эхо-экспорта ([NX-INN-003]), отладки, реплея и ротации журнала ([NX-SPEC-006 разв. D]).
- **C. Чек-сумма FNV-1a по умолчанию**, CRC32 — альтернатива по `alg`. Не крипто; против порчи, не чита
  ([NX-SYS-002]). При наличии `crypto.subtle` — допустим профиль с `sha-256` (новый `ChecksumAlg`), но
  это смена `formatVersion` (новая ось-1 миграция).
- **D. Бинарный профиль (опц.).** `serialize` может вернуть `Uint8Array` (MessagePack/CBOR) для крупных
  `journal`-сейвов; `formatVersion` различает кодировку (`+coding`-флаг в конверте). JSON — дефолт
  («современное-первым» не отменяет читаемость дизайнером). Отложить до нужды по объёму.
- **E. Сжатие** (LZ-string/`CompressionStream`) по флагу при упоре в квоту — мост от localStorage к
  IndexedDB ([NX-SYS-006]). Сжатие применяется **после** canonical-сериализации (хеш считается по
  несжатому телу — детерминизм I-5).
- **F. Серверный сейв (опц., legacy).** Тот же конверт через `ServerAdapter` ([NX-SPEC-006]); миграции —
  и на клиенте, и на сервере по **одной** библиотеке `migrate.run`. Требует auth ([NX-SYS-002]); по
  умолчанию выключен, не блокирует локальный сейв (I-8 [NX-SPEC-006]).

### Минимальные тест-кейсы (обязательные для приёмки)
1. **Round-trip (I-5):** `serialize(snapshot)` → `deserialize` даёт `{ok:true, migrated:false}` с тем же
   `state`; `checksum` совпадает; повторная сериализация даёт идентичную строку.
2. **Миграция state:** golden-фикстура `schemaVersion:1` при `STATE_SCHEMA_VERSION:4` →
   `{ok:true, migrated:true}`, `state` прошёл `2,3,4`; `schemaVersion` в результате = 4.
3. **Миграция конверта:** фикстура `formatVersion:1` (где `checksum` — строка) → поднят до текущего
   (`checksum` стал объектом `{alg,value}`); поведение `deserialize` дальше штатное.
4. **Обе оси разом:** фикстура `formatVersion:1, schemaVersion:1` → обе подняты до текущих, обе цепочки
   отработали независимо (I-1).
5. **Заморозка истории (I-4):** добавление `STATE_MIGRATIONS[5]` не ломает загрузку фикстур v1..v4.
6. **Из будущего (I-6):** `formatVersion`/`schemaVersion` > текущих → `{reason:"from_future"}`; оригинал
   в хранилище **не изменён** (проверка байт до/после).
7. **Дыра в цепочке:** удалить `STATE_MIGRATIONS[3]`, грузить v2 при CURRENT 4 → `{reason:"gap", missing:[3]}`,
   бэкап создан (I-7); `validateChain(chain,1,4)` возвращает `missing:[3]`.
8. **Порча parse:** `raw="{битый json"` → `{reason:"corrupt"}`, бэкап `nexus_save_corrupt_*` существует.
9. **Порча checksum:** подменить байт в `state`, сохранить → `maybeCorrupt`; если схема не прошла —
   `{reason:"corrupt"}`, оригинал в бэкапе.
10. **Чужой файл:** `magic:"OTHER"` → `{reason:"foreign"}`, бэкап.
11. **Схема:** `state` с типом-нарушением (`level:"x"`) → `{reason:"schema_invalid", errors:[...]}` (те же
    вороты, что контент [NX-SYS-003]).
12. **Journal-реплей (I-9):** `profile:"journal"` с 3 записями → `replayInto` в пустой субстрат
    восстанавливает `seq` 1,2,3; повторный `replayInto` — no-op (та же длина журнала).
13. **Hybrid:** `state` + хвост `records` после `baseSeq` → state присвоен, хвост доигран; журнал
    консистентен с `state`.
14. **Неизвестный type (толерантность):** journal с `type:"mod.unknown"` без линзы → запись сохранена и
    восстановлена как blob, не потеряна.
15. **Чистота миграторов (I-3):** `migrate.run` не изменил входной объект (deep-equal до/после вызова).
16. **Payload-ось (I-10):** запись `echo.message` с `sig.schemaVersion:1` при CURRENT 2 → кодек сейва её
    **не** трогает; `TypeMigratable.upgrade` поднимает payload до 2 в рантайме линзы.
17. **Адаптер-инвариантность (I-8):** кейсы 1–13 поверх memory/localStorage/IndexedDB дают идентичные
    наблюдаемые результаты.
18. **Серверный опционал:** весь набор 1–13 проходит **без** `ServerAdapter`; с ним конверт идентичен,
    но `sig.authorId` записей — серверное (контракт [NX-SPEC-003]).

## Что нового и какие кирпичики

> Раздел не обязателен для `spec`, но кратко — откуда решения (по [NX-META-001] §7).

- **Проверенные кирпичики (c20-proven / технические дисциплины):** версионированный конверт + цепочка
  односторонних миграторов (БД-миграции Flyway/Alembic/Rails, уже выбранные в [NX-SYS-006]), canonical
  JSON + дешёвый хеш целостности (FNV-1a/CRC32), event-sourcing-реплей по `seq` ([NX-SPEC-006]),
  дискриминированный результат вместо исключений на ожидаемых ветках (Rust `Result`/функциональный стиль),
  forward-tolerant чтение (Protobuf «unknown fields» как идея для непрозрачных blob-полей/записей).
- **Что нового против обычных веб-игр:** **две независимые оси версий** конверта и содержимого + **третья**
  ось версии payload каждого `type` записи, обслуживаемые одним механизмом `migrate.run`; и **строго
  табличное** поведение при несовместимости (из будущего/дыра/порча/чужое/неизвестный type) вместо
  «по ситуации». В типичной браузерной игре сейв — `JSON.stringify(player)` без версии и плана миграции
  ([NX-SYS-006] факт из кода: `nexus_session`/`nexus_name` голыми строками).
- **Чего мало в вебе:** единый формат, переиспользующий **форму записи субстрата** ([NX-SPEC-006]) и для
  снимка прогресса, и для журнала событий, и для эхо-экспорта ([NX-INN-003]); толерантная деградация на
  неизвестные записи/моды без потери данных; стек-агностичность от `memory` до PHP-сервера за одним
  интерфейсом ([NX-STRAT-004]).

## Риски, открытые вопросы
- **Тестовая матрица миграций растёт.** N версий по двум осям ⇒ нужно покрыть «любая историческая → текущая»
  golden-фикстурами обеих осей. Митигация: хранить золотые сейвы `format×schema` в репозитории и гонять
  в CI «загрузка любой → текущая» (прямое продолжение риска [NX-SYS-006]).
- **Дрейф `state`-схемы и движка.** Поля `state` дублируют рантайм-знание ([NX-SYS-003] риск «двойной
  источник истины»). Митигация: схема сейва — единственный валидатор на входе (шаг 8), «движок читает
  state только после валидации» ([NX-SYS-006]).
- **Рост journal-сейвов.** Append-only журнал ([NX-SPEC-006]) растёт безгранично; `hybrid`+ротация
  (snapshot + хвост) — основной ответ, но политика обрезки/старения эхо-следов ([NX-INN-011]) — отдельный
  дизайн ([NX-SPEC-006 разв. D], [NX-SYS-005]).
- **Downgrade вне scope.** Миграторы односторонние; «сейв из будущего» только сообщается, не мигрируется
  вниз ([NX-SYS-006]). Двунаправленные цепочки удвоят тестовую матрицу — отложено.
- **Целостность ≠ анти-чит.** `checksum` ловит порчу хранилища, **не** подмену игроком. Всё, что влияет
  на чужой опыт (эхо), обязано переисполняться/валидироваться сервером ([NX-SYS-002], [NX-INN-003],
  [NX-SPEC-003]); локальный сейв авторитетен только для одиночного режима.
- **Конфликт миграции payload и журнала.** Если линза дописывает «обновлённые» записи поверх старых,
  журнал растёт дубль-семантикой; политика (мигрировать в рантайме vs материализовать запись) — на
  усмотрение линзы (I-10), но требует соглашения, чтобы реплей оставался детерминированным.
- **Совместимость с legacy v1/v2.** Монолиты не на ES-модулях; UMD-шим `window.NEXUS.save` — мост, но он
  адаптер совместимости, не часть современного ядра ([NX-STRAT-004]).

## Комментарии
Документ переводит `extended`-дизайн [NX-SYS-006] (конверт + цепочка миграторов) и форму записи
[NX-SPEC-006] (`SubstrateRecord`, `Sig.schemaVersion`) в **детальный реализуемый контракт** формата
сохранения, явно разводя **две** оси версий (конверт ⟂ state) и добавляя **третью** (payload записи),
обслуживаемые одним `migrate.run`. Зафиксировано «современное-первым»: ES-модульный кодек, хранилище за
`PersistAdapter` ([NX-SPEC-006]) с IndexedDB по умолчанию, PHP/серверный сейв — опциональный адаптер за
тем же интерфейсом, не блокирующий ядро. Поведение при несовместимости сделано **нормативно-табличным**
(а не «по ситуации»), что закрывает главный практический риск сейв-систем. Зрелость — `analyzed`
(реального кода сейва в `shared/*` нет; сегодня в клиенте — голые строки `nexus_session`/`nexus_name`,
факт из [NX-SYS-006]). Возражения и развилки (бинарный профиль, downgrade, политика payload-миграции) —
кандидаты на `90-comments/`.

## Связанные документы
- [NX-SYS-006 Сохранения, версии, миграции, моддинг](../30-systems/NX-SYS-006-save-versioning-modding.md) — родительский системный дизайн (depends_on): конверт, `schemaVersion`, цепочка миграторов, восстановление
- [NX-SPEC-006 Койне-субстрат — контракт API записей](./NX-SPEC-006-koine-substrate-api.md) — форма `SubstrateRecord`, `Sig.schemaVersion`, `PersistAdapter`, идемпотентность по `id` (depends_on)
- [NX-SPEC-003 Эхо-протокол](./NX-SPEC-003-echo-protocol.md) — серверный адаптер, анти-чит, переписывание `sig.authorId`/`t`
- [NX-SYS-003 Контент-пайплайн и data-driven](./NX-SYS-003-content-pipeline.md) — вороты валидации (JSON Schema + ссылочная целостность), ось версии контента
- [NX-SPEC-002 ECS с архетипами](./NX-SPEC-002-ecs-archetypes.md) — слой 2 (состояние); источник `state` для snapshot-сейва
- [NX-SPEC-001 EventBus 2.0](./NX-SPEC-001-eventbus-2.md) — события `save:loaded`/`save:migrated`/`save:recovered`
- [NX-POLY-009 Скриптовый слой моддинга](../50-polyglot/NX-POLY-009-scripting-modding-layer.md) — миграции данных модов по той же библиотеке
- [NX-INN-004 Прогрессия знанием](../20-innovation/NX-INN-004-knowledge-progression.md) · [NX-INN-003 Эхо](../20-innovation/NX-INN-003-echo-multiplayer.md) · [NX-INN-011 Время и археология](../20-innovation/NX-INN-011-time-seasons-archaeology.md) — что персистится и стареет
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — принцип «современное-первым»
- [NX-VIS-004 Мета-слой Койне](../10-vision/NX-VIS-004-meta-layer-koine.md) — субстрат записей как корень формата
- [Конституция вики](../00-meta/CONSTITUTION.md) · [Шаблон](../00-meta/TEMPLATE.md)
