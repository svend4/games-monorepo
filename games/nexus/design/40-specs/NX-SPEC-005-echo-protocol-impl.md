---
id: NX-SPEC-005
title: Эхо-протокол — реализуемый контракт (стек-агностичный, современное-первым)
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [echo, protocol, contract, ts-interfaces, anti-cheat, validation, dedup, query, ports-adapters, es-modules, php-optional, idempotent, acceptance-criteria, test-cases]
relates_to: [NX-INN-003, NX-SPEC-003, NX-SYS-002, NX-VIS-004, NX-STRAT-004, NX-SYS-004, NX-SPEC-001, NX-SYS-006]
depends_on: [NX-SPEC-003, NX-SYS-002]
comments_on: [NX-SPEC-003#detali-i-chastnye-sluchai, NX-SYS-002#kontrakt-endpointov, NX-STRAT-004#princip-sovremennoe-pervym-legasi-ne-blokiruet]
superseded_by: null
language: ru
---

# Эхо-протокол — реализуемый контракт (стек-агностичный, современное-первым)

> Этот документ закрывает висячую ссылку `NX-SPEC-005` (зарегистрирована в
> [INDEX.md#висячие-ссылки](../00-meta/INDEX.md)) **именно как реализуемый контракт эхо-протокола**.
> Он не переписывает [NX-SPEC-003] (форматы пакетов и PHP-псевдокод), а **поднимает его до
> стек-агностичного контракта**: точные сигнатуры портов, инварианты, критерии приёмки и
> минимальные тест-кейсы, по которым «второй рой» напишет реальный код на **современном ядре**
> (ES-модули, Web Crypto, IndexedDB), а PHP/legacy подключит **только как опциональный адаптер за
> интерфейсом** ([NX-STRAT-004#принцип-современное-первым]).

## TL;DR
Превращаем концепт эхо ([NX-INN-003]) и его форматы ([NX-SPEC-003]) в **исполняемый контракт по
схеме «порты и адаптеры»**: ядро — чистые, стек-агностичные интерфейсы (`EchoCodec`, `EchoValidator`,
`EchoStore`, `IdentityPort`, `Clock`, `EchoService`) с точными TS-подобными сигнатурами, инвариантами
и кодами ошибок. **Современное ядро** (ES-модули + Web Crypto HMAC + IndexedDB-outbox) реализует эти
порты напрямую; **PHP/MySQL — лишь один из сменных адаптеров `EchoStore`/транспорта**, по умолчанию
выключаемый и не влияющий на ядро. К контракту прилагаются критерии приёмки (Definition of Done) и
минимальный набор тест-кейсов (валидация, дедуп, выборка, decay, идемпотентность).

## Краткое содержание
[NX-SPEC-003] дал детальные форматы (`type/pose/payload/sig/meta`), три уровня валидации (L1/L2/L3),
дедуп (`echoUid` + `contentKey`), выборку top-N и decay — но в форме PHP-ориентированного псевдокода.
Принцип «современное-первым» ([NX-STRAT-004]) требует, чтобы **ядро было современным и
стек-агностичным**, а PHP жил **за адаптером**. Поэтому этот документ переформулирует те же сущности
как **набор портов с фиксированными сигнатурами и инвариантами** и добавляет то, чего не хватало для
«передачи в работу»: формальную модель ошибок, контракт идемпотентности/дедупа как набор законов,
точную семантику выборки по комнате/времени, и **минимальные тест-кейсы как исполняемую спецификацию**.

Ключевая идея — **изоморфность ядра**: один и тот же `EchoService` работает и в браузере (in-memory /
IndexedDB store), и на сервере (любой backend store), потому что всё нестек-агностичное спрятано за
портами. PHP-backend из [NX-SPEC-003] становится **реализацией `EchoStore`**, а не фундаментом.

## Расширенное содержание (общее)

### Архитектурный стиль: порты и адаптеры (hexagonal)
Контракт делит мир эхо на **ядро** (домен + сервис, ничего не знает о транспорте/БД/крипте) и
**адаптеры** (конкретные реализации портов). Это прямая инженерная форма «современное-первым»:

```
                    ┌───────────────────────── ЯДРО (стек-агностичное, ES-модули) ─────────────┐
                    │   EchoService  ──uses──►  EchoCodec · EchoValidator · IdGen · ScoreFn     │
                    └───────────┬───────────────────────────┬───────────────────────┬──────────┘
        порт IdentityPort ◄─────┘            порт EchoStore ─┘           порт Clock ─┘
        порт TransportPort ◄────────────────────────────────────────────────────────
                    │                          │                          │
        ┌───────────┴──────────┐   ┌───────────┴───────────┐   ┌──────────┴───────────┐
        │ АДАПТЕРЫ современные  │   │ АДАПТЕР EchoStore     │   │ АДАПТЕР EchoStore     │
        │ WebCryptoHmacIdentity │   │ MemoryStore (тест/   │   │ PhpMySqlStore         │
        │ FetchTransport        │   │ IndexedDbStore (offline)│ │ (ОПЦИОНАЛЬНЫЙ, legacy)│
        └──────────────────────┘   └───────────────────────┘   └──────────────────────┘
```

**Правило (инвариант стека):** ядро **не импортирует** ни одного модуля адаптера. Любая зависимость
от PHP, MySQL, конкретного HTTP-клиента или Node API находится **только** в каталоге адаптеров и
подключается через DI (передачей реализаций порта в конструктор `EchoService`). Это делает PHP
«сменным модулем по умолчанию выключаемым», как требует [NX-STRAT-004#принцип-современное-первым].

### Что относится к «современному ядру», что — к «опциональному легаси»
| Слой | Современное-первым (ядро/дефолт) | Легаси/опциональный адаптер |
|---|---|---|
| Идентичность/подпись | **Web Crypto** `crypto.subtle` HMAC-SHA-256 (изоморфно: браузер и Node ≥ через `globalThis.crypto`) | PHP `hash_hmac` за `IdentityPort` |
| Хранилище | **In-memory** (тест) и **IndexedDB** (offline-first outbox+кеш) | **PHP+MySQL** `echoes`/`echo_likes` ([NX-SPEC-003#predlagaemaya-shema-tablic]) за `EchoStore` |
| Транспорт | **`fetch`** + JSON (батч), `AbortController`, бэкофф | PHP-эндпоинты `?action=echo.*` за `TransportPort` |
| Кодек/валидация | **чистый ES-модуль**, без зависимостей | — (валидация всегда в ядре, чтобы и сервер, и клиент звали одну) |
| Идентификаторы | `crypto.randomUUID()` | fallback-генератор UUIDv4 за `IdGen` |

**Принцип:** если что-то можно сделать на современном стеке сразу — делаем (Web Crypto, IndexedDB,
`fetch`, `randomUUID`); PHP остаётся **одним из** адаптеров `EchoStore`/`TransportPort` и **не
блокирует** ядро. Сервер на современном рантайме реализует те же порты — контракт это позволяет.

### Изоморфность: одна валидация — два места
Критично для анти-чита: **`EchoValidator` живёт в ядре и вызывается и клиентом, и сервером**. Клиент
зовёт его для оптимистичного UI и раннего отсева; сервер — как **ворота записи** (источник истины).
Это убирает дублирование L2/L3-логики между JS-клиентом и backend-адаптером (в [NX-SPEC-003]
валидация была описана только серверным псевдокодом; здесь она — переносимый модуль).

## Детали и частные случаи

### Доменные типы (TS-подобно, нормативно)
Совместимы с wire-форматом [NX-SPEC-003#kanonicheskaya-json-forma-eho-zapisi]. Здесь — **типы ядра**.

```ts
// ── Идентификаторы и базовые алиасы ─────────────────────────────
type EchoUid    = string;   // UUIDv4, клиентский ключ идемпотентности
type ContentKey = string;   // 64-hex, семантический ключ дедупа (SHA-256 канона)
type PlayerId   = string;   // серверная личность (из IdentityPort), НЕ session_id клиента
type RoomId     = string;   // «комната» = зона/инстанс (zone в NX-SPEC-003); ≤64 симв.
type Millis     = number;   // целые мс эпохи; источник — Clock (НЕ Date.now клиента на сервере)
type EchoType   = 'message' | 'ghost' | 'build';

// ── Поза (рендер-независима, единая СК с players.x/y — NX-SYS-002) ──
interface Pose { room: RoomId; worldX: number; worldZ: number; dir: number; tile?: number | null }

// ── Payload по типам (дискриминируется EchoType) ────────────────
interface MessagePayload { kind: 'message'; phraseIds: number[]; emoteId?: number | null } // 1..4 id
interface GhostPayload   { kind: 'ghost';   track: TrackPoint[];  events: GhostTag[]; seedDay?: number | null }
interface BuildPayload   { kind: 'build';   buildType: BuildType; cells: Cell[]; cost: number }
type EchoPayload = MessagePayload | GhostPayload | BuildPayload;

interface TrackPoint { worldX: number; worldZ: number; dir: number; tMs: number } // tMs монотонен
type GhostTag = 'entered' | 'died' | 'solved' | 'looted';
type BuildType = 'bridge' | 'path' | 'camp' | 'marker' | 'repair';
interface Cell { cx: number; cz: number }

// ── Входящее эхо (то, что шлёт клиент; meta НЕ задаёт) ──────────
interface EchoDraft {
  type: EchoType;
  schemaVersion: number;
  echoUid: EchoUid;
  pose: Pose;
  payload: EchoPayload;
  clientTs: Millis;          // справочно; сервер ему не доверяет
}

// ── Запись эхо (то, что хранит сервер; meta — ТОЛЬКО серверное) ──
interface EchoRecord extends EchoDraft {
  contentKey: ContentKey;
  meta: {                    // ИНВАРИАНТ: заполняет только ядро/сервер, клиент не присылает
    author: PlayerId;
    createdAt: Millis;
    expiresAt: Millis;
    likes: number;
    confirms: number;        // счётчик семантических подтверждений (дедуп-схлопывание)
  };
}

// ── Эхо для чтения (обогащённое; message локализован) ───────────
interface EchoView {
  echoUid: EchoUid; type: EchoType; pose: Pose;
  text?: string;             // только message: renderPhrase(phraseIds, lang) — текст НЕ хранится
  payload?: Exclude<EchoPayload, MessagePayload>; // ghost/build отдаются как payload
  likes: number; ageMs: Millis; expiresInMs: Millis; score: number;
}
```

### Порты ядра (нормативные сигнатуры)
Это и есть «контракт». Любая реализация (современная или legacy) обязана соблюдать сигнатуры,
инварианты и законы ниже. `Result<T>` — явная модель ошибок без исключений на горячем пути.

```ts
type Ok<T>  = { ok: true;  value: T };
type Err    = { ok: false; error: EchoError };
type Result<T> = Ok<T> | Err;

interface EchoError { code: ErrorCode; reason: string; field?: string }
type ErrorCode =
  | 'UNAUTHENTICATED'   // L1: нет/битый/истёкший токен          → HTTP 401
  | 'SCHEMA_INVALID'    // L2: не прошло JSON-schema/диапазоны    → HTTP 422
  | 'SEMANTIC_INVALID'  // L3: нелегальная поза/фраза/постройка   → HTTP 422
  | 'CANNOT_AFFORD'     // L3: списание стоимости не удалось      → HTTP 422
  | 'DUPLICATE'         // транспортный дубль echoUid (приняли ранее) → HTTP 409 (трактовать как ok)
  | 'RATE_LIMITED'      // спам-вектор publish/like               → HTTP 429
  | 'CONFLICT_VERSION'  // schemaVersion > MAX_VER                → HTTP 422
  | 'STORE_FAILURE';    // сбой адаптера хранилища/сети           → HTTP 5xx

// ── Порт личности: НЕ доверяем session_id клиента (NX-REVIEW#sec3-4) ──
interface IdentityPort {
  verify(token: string, now: Millis): Promise<Result<PlayerId>>;   // HMAC-проверка + срок
  issue(playerId: PlayerId, now: Millis): Promise<{ token: string; expiresAt: Millis }>;
}

// ── Порт часов: единый источник времени (сервер не доверяет clientTs) ──
interface Clock { now(): Millis }

// ── Порт генерации id ──
interface IdGen { uuid(): EchoUid }

// ── Кодек: канон, contentKey, сериализация payload (БЕЗ сырого текста) ──
interface EchoCodec {
  canonicalize(draft: EchoDraft): string;                 // детерминированная байтовая форма
  contentKey(draft: EchoDraft): ContentKey;               // SHA-256 от семантического канона
  encodePayload(p: EchoPayload): string;                  // для хранения (phraseIds/track/cells)
  decodePayload(type: EchoType, raw: string): EchoPayload;
  renderPhrase(phraseIds: number[], lang: string): string; // локализация из ID (текст не хранится)
}

// ── Валидатор: чистый, изоморфный (клиент И сервер зовут один и тот же) ──
interface EchoValidator {
  validateSchema(draft: EchoDraft): Result<void>;          // L2: дёшево, без I/O
  // L3 может требовать данных мира/баланса → принимает контекст, но НЕ делает прямой I/O сам
  validateSemantics(draft: EchoDraft, ctx: WorldContext): Result<void>;
}
interface WorldContext {
  roomExists(room: RoomId): boolean;
  inBounds(pose: Pose): boolean;
  isBlocked(pose: Pose): boolean;
  poseSane(author: PlayerId, pose: Pose, sinceMs: Millis): boolean; // sanity-коридор (NX-SYS-002)
  phraseLegal(ids: number[]): boolean;                     // словарь + грамматика (анти-токсичность)
  trackSane(track: TrackPoint[]): boolean;                 // монотонный tMs, шаги ≤ vMax
  buildPlaceable(p: BuildPayload, pose: Pose): boolean;
  lifetimeFor(type: EchoType): Millis;
}

// ── Хранилище: ЕДИНСТВЕННОЕ место стек-зависимости (PHP/MySQL — здесь) ──
interface EchoStore {
  // транспортный дедуп: вернуть существующую запись по echoUid или null
  findByUid(uid: EchoUid): Promise<EchoRecord | null>;
  // семантический дедуп: живая запись с тем же contentKey (alive = expiresAt>now)
  findAliveByContentKey(ck: ContentKey, now: Millis): Promise<EchoRecord | null>;
  // идемпотентная вставка по echoUid (ON DUPLICATE KEY DO NOTHING семантика)
  insertIfAbsent(rec: EchoRecord): Promise<{ inserted: boolean }>;
  // схлопывание дубля: +1 confirm, продлить expiresAt
  bumpConfirm(uid: EchoUid, newExpiresAt: Millis): Promise<void>;
  // выборка по комнате/времени, top-N с лимитом на тип (горячий путь)
  queryRoom(q: RoomQuery): Promise<EchoRecord[]>;
  // лайк: идемпотентно (один игрок = один лайк); вернуть, изменилось ли
  addLike(uid: EchoUid, voter: PlayerId, extendBy: Millis): Promise<{ applied: boolean }>;
  // decay: удалить истёкшие; вернуть число удалённых (вызывает таймер, НЕ запрос)
  purgeExpired(now: Millis): Promise<number>;
  // атомарно списать стоимость постройки (в одной транзакции со вставкой — см. инвариант)
  chargeCost(author: PlayerId, cost: number): Promise<{ charged: boolean }>;
}
interface RoomQuery {
  room: RoomId; now: Millis; near?: { x: number; z: number };
  perTypeCap: Record<EchoType, number>;                    // {message:20, ghost:5, build:50}
  weights: { like: number; fresh: number; near: number };
  maxAgeMs: Millis;
}

// ── Сервис: оркестрирует порты; ЭТО публичный API эхо-протокола ──
interface EchoService {
  publish(token: string, draft: EchoDraft): Promise<Result<{ echoUid: EchoUid; merged: boolean }>>;
  fetch(room: RoomId, lang: string, near?: { x: number; z: number }): Promise<Result<EchoView[]>>;
  like(token: string, uid: EchoUid): Promise<Result<{ ok: true }>>;
  runDecay(): Promise<{ purged: number }>;                 // дёргает таймер/крон, не клиент
}
```

### Алгоритм `publish` (нормативный порядок ворот записи)
Порядок фиксирован: L1 → версия → L2 → L3 → дедуп → запись. Дешёвое раньше дорогого
(тот же принцип, что приоритеты слушателей [NX-SPEC-001]).

```ts
async function publish(token, draft): Promise<Result<{echoUid, merged}>> {
  const now = clock.now();
  // L1 личность (НЕ session_id клиента)
  const idr = await identity.verify(token, now);
  if (!idr.ok) return err('UNAUTHENTICATED', 'bad token');
  const author = idr.value;

  if (draft.schemaVersion > MAX_VER) return err('CONFLICT_VERSION', 'schema too new', 'schemaVersion');

  // L2 структура (чисто, без I/O)
  const s = validator.validateSchema(draft); if (!s.ok) return s;

  // L3 семантика (через WorldContext-порт, без прямого I/O в валидаторе)
  const sem = validator.validateSemantics(draft, world); if (!sem.ok) return sem;

  // дедуп СЕМАНТИЧЕСКИЙ (две разные записи об одном объекте мира → схлопнуть)
  const ck = codec.contentKey(draft);
  const alive = await store.findAliveByContentKey(ck, now);
  if (alive) {
    await store.bumpConfirm(alive.echoUid, Math.max(alive.meta.expiresAt, now + world.lifetimeFor(draft.type)));
    return ok({ echoUid: alive.echoUid, merged: true });
  }

  // стоимость постройки — АТОМАРНО со вставкой (инвариант I-7)
  if (draft.payload.kind === 'build') {
    const c = await store.chargeCost(author, draft.payload.cost);
    if (!c.charged) return err('CANNOT_AFFORD', 'cannot afford');
  }

  const rec: EchoRecord = {
    ...draft, contentKey: ck,
    meta: { author, createdAt: now, expiresAt: now + world.lifetimeFor(draft.type),
            likes: 0, confirms: 1 },
  };
  const ins = await store.insertIfAbsent(rec);      // дедуп ТРАНСПОРТНЫЙ (echoUid)
  // повтор из outbox: уже принято — это успех для клиента (трактуем 409 как ok)
  return ok({ echoUid: rec.echoUid, merged: !ins.inserted });
}
```

### Семантика выборки по комнате/времени (`fetch`)
- Источник истины — `EchoStore.queryRoom`. Скоринг **детерминирован**:
  `score = likes·w.like + freshness·w.fresh + proximity·w.near`, где
  `freshness = clamp01(1 − ageMs / maxAgeMs)`, `proximity = clamp01(1 − dist(pose, near)/R)` (если
  `near` не задан — `proximity = 0`, член выпадает).
- **Лимит на тип** (анти-свалка): выбираем top-N по `score` **в пределах каждого типа** отдельно
  (`perTypeCap`), а не общий top-N — иначе постройки вытеснят послания.
- Только живые: `expiresAt > now`. `message` отдаётся как `text` (локализация из `phraseIds`),
  `ghost`/`build` — как `payload`. **Сырой текст никогда не покидает кодек и не хранится.**
- Сортировка/лимит — на стороне `EchoStore` (в SQL-адаптере — `ORDER BY score DESC LIMIT cap`); в
  in-memory/IndexedDB-адаптере — та же формула на JS. Контракт один, реализации две.

### Контракт идемпотентности и дедупа (законы)
Сформулированы как проверяемые свойства (см. тест-кейсы T-DEDUP-*):
- **L-IDEMP-PUBLISH:** `publish(uid=X)` дважды подряд ⇒ ровно одна запись в store; второй вызов
  возвращает `merged:true` (или `DUPLICATE`-трактуемый-как-ok), **никаких побочных списаний**.
- **L-IDEMP-LIKE:** `like(uid, voter)` повторно тем же `voter` ⇒ `likes` не растёт; `applied:false`.
- **L-DEDUP-CONTENT:** два **разных** `echoUid` с одинаковым `contentKey` (один объект мира) ⇒ одна
  запись + `confirms++` + продление `expiresAt`, а **не** вторая строка.
- **L-CHARGE-ATOMIC:** для `build` списание стоимости и вставка эхо — **в одной транзакции**: либо оба,
  либо ни одного (иначе чит «построил, откатил списание» — [NX-SPEC-003#riski]).

### Модель ошибок ↔ HTTP (для транспортного адаптера)
Маппинг `ErrorCode → HTTP` фиксирован (см. таблицу в `ErrorCode` выше). Транспортный адаптер обязан:
`401 → rejoin()` (refresh токена, **не теряя outbox**); `409 → outbox.remove` (как успех);
`422 → markRejectedLocally + outbox.remove`; `429 → экспоненциальный бэкофф, держать в outbox`;
`5xx → оставить в outbox, повтор позже`. Это согласовано с клиентским outbox [NX-SYS-002#klientskiy-outbox].

### Версионирование схемы
`schemaVersion` обязателен. Ядро читает `MAX_VER` и `MAX_VER-1`, старшие → `CONFLICT_VERSION` с
warning. **Новые поля только опциональные**; удаление поля = мажорная версия + `migrate(N→N+1)` в
кодеке при чтении. Это частный случай политики [NX-SYS-006].

### Опциональный PHP-адаптер (явно: не ядро)
PHP-реализация — **один файл-адаптер** `PhpMySqlStore implements EchoStore`, отображающий методы порта
на эндпоинты/SQL из [NX-SPEC-003#predlagaemaya-shema-tablic]:
`findByUid → SELECT … WHERE echoUid=?`; `insertIfAbsent → INSERT … ON DUPLICATE KEY (echoUid) DO NOTHING`;
`queryRoom → ORDER BY score DESC LIMIT`; `purgeExpired → DELETE … WHERE expires<now` (по крону, не по
запросу — фикс self-DoS); `chargeCost`+`insertIfAbsent` — в одной транзакции (`START TRANSACTION/COMMIT`).
**Дефолт-конфиг проекта подключает `IndexedDbStore` (offline) или серверный современный store; PHP —
opt-in флагом `store: 'php'`.** Ядро об этом не знает.

## Предложения и варианты реализации

### Развилки реализации (аддитивные, как в NX-SPEC-003)
- **A. Ядро + MemoryStore (тест-первый):** реализовать `EchoCodec`/`EchoValidator`/`EchoService` и
  `MemoryStore`; гонять весь набор тест-кейсов ниже. Нулевая инфраструктура, мгновенная проверка
  контракта. **Рекомендую первым** — это и есть «современное-первым».
- **B. + IndexedDbStore + FetchTransport:** offline-first клиент с outbox; ядро без изменений.
- **C. + серверный store (современный рантайм ИЛИ PHP-адаптер):** один и тот же `EchoService` на
  сервере; PHP подключается как **сменный** `EchoStore`, не трогая ядро.

### Скелет инициализации (DI — ядро не знает об адаптерах)
```ts
// современная сборка по умолчанию
const svc: EchoService = new EchoServiceImpl({
  clock:    systemClock,
  identity: new WebCryptoHmacIdentity(secretProvider),   // crypto.subtle HMAC-SHA-256
  ids:      { uuid: () => crypto.randomUUID() },
  codec:    new DefaultEchoCodec(phraseDict, i18n),
  validator:new DefaultEchoValidator(),
  store:    config.store === 'php'
              ? new PhpMySqlStore(endpoint)               // ОПЦИОНАЛЬНЫЙ legacy-адаптер
              : new IndexedDbStore(),                     // современный дефолт
  world:    worldContextFor(currentRoom),
  limits:   { perTypeCap: { message: 20, ghost: 5, build: 50 },
              weights: { like: 1, fresh: 0.6, near: 0.4 }, maxAgeMs: DAY },
});
```

### Критерии приёмки (Definition of Done контракта)
Реализация считается соответствующей контракту, когда:
- [ ] **AC-1 (порты):** ядро (`EchoService`/`Codec`/`Validator`) не импортирует ни одного модуля
      адаптера; смена `store` с `IndexedDbStore` на `PhpMySqlStore` не меняет ни строки ядра.
- [ ] **AC-2 (ворота):** невалидное эхо (L2/L3) **не появляется** в `EchoStore` (проверяется
      `store.queryRoom` после `publish` с ошибкой).
- [ ] **AC-3 (meta-инвариант):** любые присланные клиентом `meta.author/expiresAt/likes/...`
      игнорируются; `author` в записи == результат `IdentityPort.verify`.
- [ ] **AC-4 (идемпотентность):** законы L-IDEMP-PUBLISH / L-IDEMP-LIKE / L-DEDUP-CONTENT /
      L-CHARGE-ATOMIC выполняются (тесты T-DEDUP-*, T-CHARGE-*).
- [ ] **AC-5 (выборка):** `fetch` возвращает ≤ `perTypeCap[type]` живых эхо на тип, отсортированных
      по `score` убыв.; истёкшие отсутствуют; `message` приходит как `text`, не как `phraseIds`.
- [ ] **AC-6 (decay):** `runDecay()` вызывается таймером, а не из `publish/fetch`; после него
      `expiresAt<now` записей нет.
- [ ] **AC-7 (изоморфность):** один и тот же `EchoValidator` даёт идентичный вердикт на клиенте и
      на сервере для одного `draft`.
- [ ] **AC-8 (без сырого текста):** ни `EchoStore`, ни wire-ответ не содержат свободного текста для
      `message` на запись — только `phraseIds`; `text` появляется лишь в `EchoView` после `renderPhrase`.

### Минимальные тест-кейсы (исполняемая спецификация)
Формат: `given → when → then`. Достаточны для прохождения развилки A на `MemoryStore`.

| ID | given | when | then |
|---|---|---|---|
| **T-AUTH-1** | битый/просроченный token | `publish` | `Err{UNAUTHENTICATED}`; store пуст |
| **T-AUTH-2** | валидный token | `publish` валидного draft | `Ok{merged:false}`; в store 1 запись, `meta.author==verify(token)` |
| **T-SCHEMA-1** | `phraseIds` длиной 5 (>4) | `publish` | `Err{SCHEMA_INVALID, field:'phraseIds'}`; store пуст |
| **T-SCHEMA-2** | `schemaVersion = MAX_VER+1` | `publish` | `Err{CONFLICT_VERSION}` |
| **T-SEM-1** | поза в стене (`isBlocked`) | `publish` | `Err{SEMANTIC_INVALID}`; store пуст |
| **T-SEM-2** | `phraseId` вне словаря | `publish` message | `Err{SEMANTIC_INVALID, field:'phraseIds'}` |
| **T-SEM-3** | трек с немонотонным `tMs` | `publish` ghost | `Err{SEMANTIC_INVALID, field:'track'}` |
| **T-DEDUP-1** | один draft, `uid=X` | `publish` ×2 подряд | вторая → `Ok{merged:true}`; в store ровно 1 запись (L-IDEMP-PUBLISH) |
| **T-DEDUP-2** | два draft, разные `uid`, один `contentKey` | `publish` обоих | 1 запись, `confirms==2`, `expiresAt` продлён (L-DEDUP-CONTENT) |
| **T-LIKE-1** | эхо `uid=X`, voter `V` | `like` ×2 от `V` | `likes==1`; второй `applied:false` (L-IDEMP-LIKE); `expiresAt` продлён один раз |
| **T-CHARGE-1** | `build`, у автора нет ресурса | `publish` | `Err{CANNOT_AFFORD}`; store пуст; **ничего не списано** (L-CHARGE-ATOMIC) |
| **T-CHARGE-2** | `build`, ресурса хватает | `publish` | `Ok`; ресурс списан ровно `cost`; 1 запись |
| **T-FETCH-1** | 25 живых message в комнате | `fetch` | вернулось ровно 20 (cap), по `score` убыв. |
| **T-FETCH-2** | message c истёкшим `expiresAt` | `fetch` | этого эхо нет в выдаче |
| **T-FETCH-3** | message в выдаче | `fetch(lang='ru')` | поле `text` присутствует, `phraseIds` отсутствует (AC-8) |
| **T-DECAY-1** | 1 истёкшее + 1 живое | `runDecay()` | `purged==1`; живое осталось |
| **T-ISO-1** | один `draft` | `validateSchema` на «клиенте» и «сервере» | идентичный `Result` (AC-7) |
| **T-STORE-SWAP-1** | весь набор выше | прогон на `MemoryStore`, затем на `PhpMySqlStore` (если доступен) | тесты ядра идентичны; код ядра не менялся (AC-1) |

> T-STORE-SWAP-1 — главный тест «современное-первым»: контракт проходит на современном store без PHP;
> PHP лишь **дополнительно** проходит те же тесты как сменный адаптер.

## Что нового и какие кирпичики
*(спека — технический документ; раздел краток, для трассировки)*
Новизны игровой идеи нет — документ **детализирует** [NX-INN-003]/[NX-SPEC-003] до **исполняемого
стек-агностичного контракта**. Что добавлено сверх [NX-SPEC-003]: (1) явная **гексагональная**
граница ядро/адаптеры с инвариантом «ядро не импортирует адаптеры»; (2) **изоморфный валидатор**
(одна валидация для клиента и сервера); (3) формальная **модель ошибок** `Result<T>`/`ErrorCode` с
маппингом на HTTP; (4) **законы дедупа/идемпотентности** как проверяемые свойства; (5) **критерии
приёмки + минимальные тест-кейсы** как исполняемая спецификация. Проверенные кирпичики: ports &
adapters (hexagonal), DI, content-addressable дедуп (`contentKey`), idempotent upsert, top-N+decay,
Web Crypto/IndexedDB/`fetch` как современное ядро, HMAC-токен личности ([NX-SYS-002]). «Современное-
первым»: ядро на актуальных браузерных API, **PHP — опциональный адаптер за портом**, не фундамент
([NX-STRAT-004#принцип-современное-первым]).

## Риски, открытые вопросы
- **Двойная валидация рассинхронизируется.** Если клиент и сервер случайно соберут разные версии
  `EchoValidator`, изоморфность (AC-7) ломается. Митигировать: валидатор — **общий пакет**, версия в
  `schemaVersion`; тест T-ISO-1 в CI обеих сторон.
- **Транзакционность `chargeCost`↔`insertIfAbsent` через порт.** Контракт требует атомарности
  (L-CHARGE-ATOMIC), но `EchoStore` — два метода. Открыто: либо ввести `store.publishBuild(rec)`
  как один транзакционный метод, либо `withTransaction(fn)`-обёртку в порту. Рекомендация —
  транзакционный метод в адаптере; для `MemoryStore` он тривиален.
- **`contentKey`-квантование.** Шаг квантования позиции на комнату наследуется из [NX-SPEC-003#riski]
  (грубо — схлопнёт разные эхо; точно — не схлопнёт одинаковые). Контракт фиксирует *где* считается
  (`codec.contentKey`), но не сам шаг — это баланс-параметр.
- **Секрет HMAC в браузере.** `WebCryptoHmacIdentity` на клиенте может только **проверять** ответы,
  но не подписывать токены доверенно — issue токена остаётся **серверной** операцией
  ([NX-SYS-002#riski]: управление секретом). Клиентский адаптер реализует лишь `verify` опционально.
- **Зрелость.** Это `proposed`/`analyzed`: ни ядра, ни адаптеров в коде нет (в репозитории — только
  presence-poll и чат, [NX-SPEC-003#riski]). Контракт готов к передаче «второму рою».
- **Коллизия имени `NX-SPEC-005`.** [NX-SPEC-004] и [NX-INN-008] ссылались на `NX-SPEC-005` как на
  *другие* темы (fraction/nemesis-сим; диалог-система LLM). Эти форвард-ссылки следует
  **перенаправить** на новые ID отдельным правочным `NX-CMT-###`/обновлением INDEX — данный документ
  закрывает зарегистрированную в [INDEX.md](../00-meta/INDEX.md) висячую ссылку именно как
  эхо-контракт (по заданию роя). Перенумерация выполнена: fraction/nemesis-сим → [NX-SPEC-011], диалог-система LLM → [NX-SPEC-012].

## Комментарии
Документ — самый частный, исполняемый слой ветки эхо: концепция [NX-INN-003] → сетевая модель
[NX-SYS-002] → форматы/псевдокод [NX-SPEC-003] → **стек-агностичный контракт с приёмкой и тестами
здесь**. Он комментирует [NX-SPEC-003#detali-i-chastnye-sluchai] (поднимает PHP-псевдокод до портов)
и применяет принцип «современное-первым» [NX-STRAT-004#принцип-современное-первым]. Возражения и
альтернативы сигнатурам — отдельными `NX-CMT-###`.

## Связанные документы
- [NX-INN-003 Асинхронный эхо-мультиплеер](../20-innovation/NX-INN-003-echo-multiplayer.md) — концепция (что течёт)
- [NX-SPEC-003 Эхо-протокол: форматы/псевдокод](NX-SPEC-003-echo-protocol.md) — детальные форматы (depends_on, этот документ их поднимает до контракта)
- [NX-SYS-002 Сеть и эхо-слой](../30-systems/NX-SYS-002-netcode-echo-layer.md) — контуры/эндпоинты/outbox (depends_on)
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — принцип «современное-первым, легаси не блокирует»
- [NX-VIS-004 Мета-слой Койне](../10-vision/NX-VIS-004-meta-layer-koine.md) — эхо как линза над субстратом записей
- [NX-SYS-004 Рендер-абстракция] — эхо рендер-независимы, единая СК
- [NX-SPEC-001 EventBus 2.0](NX-SPEC-001-eventbus-2.md) — событие `echo:received`, валидатор-приоритет
- [NX-SYS-006 Версионирование сейвов/данных] — политика `schemaVersion`/миграций
- [Конституция](../00-meta/CONSTITUTION.md) · [Шаблон](../00-meta/TEMPLATE.md) · [INDEX](../00-meta/INDEX.md)
