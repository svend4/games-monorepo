---
id: NX-SPEC-003
title: Эхо-протокол клиент/сервер — формат записи, валидация, выборка, дедуп (псевдокод)
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [echo, protocol, format, json-schema, anti-cheat, validation, dedup, top-n, decay, hmac, idempotent, async-mp, backend, php, contract]
relates_to: [NX-INN-003, NX-SYS-002, NX-VIS-001, NX-SPEC-001, NX-SYS-004, NX-INN-002, NX-SYS-006]
depends_on: [NX-SYS-002]
comments_on: [NX-INN-003#realizaciya, NX-SYS-002#kontrakt-endpointov, NX-REVIEW#sec3-4]
superseded_by: null
language: ru
---

# Эхо-протокол клиент/сервер — формат записи, валидация, выборка, дедуп

## TL;DR
Детальная спека «эхо»-обмена для асинхронного мультиплеера [NX-INN-003] поверх двухконтурной
сети [NX-SYS-002]: единый **формат эхо-записи** `{ type, pose, payload, sig, meta }`
(рендер-независимый, [NX-SYS-004]), **серверная валидация** против читов (личность по
HMAC-токену, sanity-коридор, словарь фраз, легальность позиции, списанная стоимость),
**выборка релевантных эхо** по зоне/времени (top-N = `likes·W + freshness·W`, decay в SQL) и
**дедуп** по идемпотентному `echoUid` (upsert `ON DUPLICATE KEY`, уже в коде presence). Это
единственный источник истины по форматам пакетов и JSON-Schema эхо; контуры и эндпоинты —
в [NX-SYS-002], концепция — в [NX-INN-003].

## Краткое содержание
[NX-INN-003] описал, *что* течёт по асинхронному мультиплееру (послания, призраки, постройки,
последствия), а [NX-SYS-002] — *по каким двум контурам* и *с какой авторитетностью*. Оба
документа сознательно **вынесли детальные форматы пакетов и JSON-Schema сюда**, чтобы не
дублировать (правило §7 [Конституции](../00-meta/CONSTITUTION.md)). Этот документ закрывает
последний, самый частный слой «от общего к частному»: конкретные поля, типы, единицы, коды
ошибок и псевдокод четырёх операций — `publish` / `fetch` / `like` / `decay`.

Ключевая инженерная задача спеки — **анти-чит в асинхронной модели**. В отличие от
realtime-MMO, где сервер симулирует мир и видит каждый шаг, здесь сервер видит эхо лишь в
момент публикации — и обязан принять решение «правомерно ли это эхо» по одной записи, не
доверяя клиенту вообще ([NX-REVIEW#sec3-4]: клиентский `session_id` — не личность, поля
приходят от клиента). Поэтому валидация — не постобработка, а **ворота записи**: невалидное
эхо не попадает в БД и не отравляет чужой опыт ([NX-VIS-001#riski]).

## Расширенное содержание (общее)

### Эхо — это рендер-независимая запись о следе игрока
Эхо хранится как одна строка в таблице `echoes` (предложена в [NX-SYS-002#realizaciya],
развилка B). Запись **не знает** про 2D/2.5D/3D: координаты мировые (`worldX/worldZ`),
семантика — словарём ID, а не текстом. Это делает v1/v2/v3 «окнами в один мир»
([NX-SYS-004]): один и тот же `pose` каждый клиент проецирует по-своему.

Эхо-запись состоит из пяти блоков:

| Блок | Назначение | Кто заполняет | Доверие |
|---|---|---|---|
| `type` | вид эхо (`message`/`ghost`/`build`) | клиент | низкое (валидируется по enum) |
| `pose` | где и как в мире (worldX/Z, dir, zone) | клиент | низкое (sanity-коридор) |
| `payload` | содержимое по типу (phraseIds / track / buildSpec) | клиент | низкое (схема + словарь) |
| `sig` | личность и идемпотентность (token, echoUid, schemaVersion) | клиент шлёт, **сервер переписывает author** | author — серверное; echoUid — клиентское |
| `meta` | производное (author, expires, likes, createdAt) | **только сервер** | высокое (клиент не пишет) |

Инвариант протокола: **клиент никогда не задаёт `meta.author`, `meta.expires`, `meta.likes`,
`meta.createdAt`** — это серверные поля. Любая попытка их прислать игнорируется. Это прямой
фикс «полного доверия клиенту» из [NX-REVIEW#sec3-4].

### Четыре операции протокола
Все операции — батч-HTTP по контуру B [NX-SYS-002], никаких сокетов и per-frame трафика.

1. **`echo.publish`** — клиент публикует эхо (из outbox, оптимистично уже отрисованное).
   Сервер валидирует и делает идемпотентный upsert. Возвращает `ok`/код ошибки.
2. **`echo.fetch`** — клиент входит в зону / фоновой рефреш. Сервер отдаёт top-N живых эхо
   зоны, локализуя послания на язык читателя.
3. **`echo.like`** — «лайк» Death Stranding-петли: продлевает жизнь эхо и даёт автору
   диегетичную награду; идемпотентен (один игрок = один лайк на эхо).
4. **`decay`** (серверный таймер, не клиент) — чистит истёкшие эхо тем же кроном, что
   presence-cleanup [NX-SYS-002], вместо самоубийственного `cleanup()` на каждый запрос
   ([NX-REVIEW#sec3-4]).

### Три уровня валидации (ворота записи)
Валидация идёт по возрастанию стоимости — дешёвые проверки раньше, чтобы отсечь мусор до
дорогих ([NX-SPEC-001]: приоритеты слушателей — тот же принцип «валидатор раньше эффектов»):

1. **Личность (L1, дёшево).** `id = verifyToken(token)`; нет/битый → `401`. Личность —
   серверная, не `session_id` клиента ([NX-SYS-002#chto-znachit-avtoritetnyy]).
2. **Структура (L2, дёшево).** Эхо валидно против JSON-Schema своего `type` и `schemaVersion`
   (enum-поля, диапазоны, обязательные поля). Не прошло → `422`.
3. **Семантика и правомерность (L3, дороже).** Легальная позиция (в границах зоны, не в
   стене), `phraseIds` только из словаря, `buildSpec` на легальном месте и не дубль, стоимость
   списана у автора, sanity-коридор позы относительно последнего доверенного состояния. Не
   прошло → `422` с причиной (для `markRejectedLocally`, [NX-SYS-002#klientskiy-outbox]).

## Детали и частные случаи

### Каноническая JSON-форма эхо-записи (wire-format)
```json
{
  "type": "message",
  "schemaVersion": 1,
  "echoUid": "8f14e45f-ceea-467a-9c4f-3b2d1a6e0c11",
  "token": "<HMAC-токен из join>",
  "pose": {
    "zone": "marsh-of-echoes",
    "worldX": 1920.0,
    "worldZ": 1888.5,
    "dir": 4,
    "tile": null
  },
  "payload": {
    "phraseIds": [12, 47, 3],
    "emoteId": 5
  },
  "clientTs": 1751200000
}
```
Сервер в ответ возвращает уже **обогащённую** запись (для `fetch`):
```json
{
  "echoUid": "8f14e45f-...",
  "type": "message",
  "pose": { "zone": "marsh-of-echoes", "worldX": 1920.0, "worldZ": 1888.5, "dir": 4 },
  "text": "Берегись слева — ловушка",
  "likes": 14,
  "expiresIn": 412300,
  "ageMs": 88200
}
```
Заметь: исходящий пакет несёт `phraseIds` (ID), входящий для чтения — уже `text`,
**локализованный на язык читателя** сервером (`renderPhrase`, [NX-INN-003#poslaniya]). Текст
никогда не хранится — хранятся ID. Это анти-токсичность + автолокализация + анти-чит за один
приём ([NX-INN-003]).

### Поля `pose` (общие для всех типов)
| Поле | Тип | Единицы | Валидация |
|---|---|---|---|
| `zone` | string | id зоны | существует в реестре зон; ≤64 симв. |
| `worldX`, `worldZ` | float | мировые координаты (как `x/y` в коде, см. `nexus_setup.sql`) | в bbox зоны; не в непроходимой клетке |
| `dir` | int | 0–7 (8 направлений) | `0 ≤ dir ≤ 7` |
| `tile` | int? | опц. индекс клетки для tile-привязки (v1) | в диапазоне сетки зоны или `null` |

`worldX/worldZ` намеренно совпадают по смыслу с `players.x/players.y` уже существующей схемы
(`nexus_setup.sql:15-16`) — единая система координат контуров A и B ([NX-SYS-002#riski]:
«расхождение = призрак не там»).

### Payload по типам
**`message` (канал 1, послания):**
| Поле | Тип | Валидация |
|---|---|---|
| `phraseIds` | int[] | каждый ID есть в словаре; длина 1–4; шаблон собирается только в легальную грамматику |
| `emoteId` | int? | ID из словаря эмоций или `null` |

Свободный текст **запрещён на уровне схемы** (нет поля `text` во входящем пакете). Это
ключевой анти-чит/анти-токсичность: из словаря нельзя собрать оскорбление или наводку на
греф, если словарь спроектирован осторожно ([NX-INN-003#riski]).

**`ghost` (канал 2, призраки-эхо):**
| Поле | Тип | Валидация |
|---|---|---|
| `track` | point[] | компактный трек: 8–64 ключевых точки `{worldX,worldZ,dir,tMs}`; монотонный `tMs`; шаги в пределах макс-скорости (sanity) |
| `events` | tag[] | подмножество `{entered, died, solved, looted}`; ≤8 |
| `seedDay` | int? | для daily-ghost-режима (Spelunky) или `null` для bloodstain-режима |

Трек **не влияет** на симуляцию — чистая тень без коллизий ([NX-INN-003#prizraki]). Sanity по
скорости в треке — это анти-чит «телепортирующего призрака» (тот же sanity-коридор, что для
presence в [NX-SYS-002]).

**`build` (канал 3, постройки):**
| Поле | Тип | Валидация |
|---|---|---|
| `buildType` | enum | из реестра построек (`bridge`/`path`/`camp`/`marker`/`repair`) |
| `cells` | cell[] | занимаемые клетки; все легальны, связны, не пересекают существующие постройки/стены |
| `cost` | int | соответствует реестру для `buildType`; списан у автора **до** публикации |

Дубль постройки (та же `buildType` на тех же `cells`) → не вторая запись, а
идемпотентный no-op/«ремонт» (продлить `hp`/`expires`), см. дедуп ниже.

> **Канал 4 (последствия) не публикуется как эхо.** Это производная: офлайн-симуляция
> [NX-INN-002] читает **агрегаты** уже существующих эхо (`SUM(impact)`), а не отдельную
> запись ([NX-INN-003#posledstviya]). Поэтому в протоколе `publish` его нет — только в `decay`/
> агрегации на стороне живого мира.

### Дедупликация и идемпотентность
Каждое эхо несёт клиентский `echoUid` (UUIDv4). Это даёт два уровня дедупа:
1. **Транспортный** (повтор из outbox после обрыва сети): upsert `ON DUPLICATE KEY (echoUid)`
   — повторная отправка не создаёт дубль ([NX-SYS-002#detali]: «идемпотентность», кирпичик
   `ON DUPLICATE KEY` уже работает для presence в `nexus_api.php`).
2. **Семантический** (две *разные* записи об одном и том же объекте мира, напр. два игрока
   «починили» один алтарь): дедуп по **контент-ключу** `contentKey = hash(type, zone,
   normalizedCells|quantizedPos, buildType)`. Совпал — не вторая постройка, а инкремент
   «подтверждений»/продление жизни. Для `message` контент-ключ включает `phraseIds`, чтобы
   идентичные послания рядом схлопывались.

### Decay, top-N и релевантность выборки
- **Срок жизни** задаётся типом: `lifetimeFor(type)` (напр. `message` базово 3 дня, `build` —
  недели, `ghost` — день). Низкий рейтинг ускоряет таяние; `like` продлевает (`+EXTEND`).
- **Релевантность** при `fetch`: `score = likes·W_LIKE + freshness·W_FRESH + proximity·W_NEAR`,
  где `freshness = clamp(1 - ageMs/maxAge)`, `proximity` — близость к точке входа игрока в
  зону. Сортировка и лимит — в SQL ([NX-INN-003], [NX-SYS-002]).
- **Лимиты на зону** (анти-свалка, [NX-INN-003#byudzhety]): `perTypeCap = {message: 20,
  ghost: 5, build: 50}`. Выдаём top-N по `score`, остальное не шлём — клиент не захлёбывается.
- **Decay-крон** удаляет `expires < now` тем же таймером, что presence-cleanup (раз в ~60 с),
  **не** на каждый запрос ([NX-SYS-002#kontur-a], фикс self-DoS [NX-REVIEW#sec3-4]).

### Коды ошибок протокола
| Код | Когда | Действие клиента |
|---|---|---|
| `200` | ok | `outbox.remove(echoUid)` |
| `401` | нет/битый/истёкший токен | `token = rejoin()`, не теряя outbox ([NX-SYS-002]) |
| `409` | дубль `echoUid` (уже принято) | трактовать как успех, `outbox.remove` |
| `422` | провал L2/L3 (схема/семантика/чит) | `markRejectedLocally`, убрать из outbox, показать причину |
| `429` | rate-limit на `publish/like` (спам-вектор) | экспоненциальный backoff, держать в outbox |
| `5xx` | сетевой/серверный сбой | оставить в outbox, повтор позже |

### Версионирование схемы эхо
Эхо несёт `schemaVersion`. Сервер читает `N` и `N-1`, старшие игнорирует с warning
([NX-SYS-002#granichnye-sluchai]). Миграции форматов эхо — частный случай общей политики
версионирования сейвов/данных [NX-SYS-006] и пробела «версионирование сейвов»
[NX-REVIEW#sec3-5]. Правило: **новые поля только опциональные**; удаление поля = новая мажорная
версия + `migrate(N→N+1)` на сервере при чтении.

## Предложения и варианты реализации

Псевдокод ниже — заготовка для второго роя (PHP-бэкенд + JS-клиент). Совместим с эндпоинтами
из [NX-SYS-002#kontrakt-endpointov] и событием `echo:received` из каталога [NX-SPEC-001].

### Серверная валидация (ворота записи)
```pseudo
// ── echo.publish — сервер (PHP). Ворота: L1 личность → L2 схема → L3 семантика ──
function handlePublish(req):
    // L1: личность (НЕ доверяем session_id клиента — NX-REVIEW#sec3-4)
    id = verifyToken(req.token)                 // HMAC, NX-SYS-002
    if not id: return http(401, "bad token")

    echo = req.echo
    // L2: структура по JSON-Schema конкретного типа и версии
    if echo.schemaVersion > MAX_VER: return http(422, "schema too new")
    schema = loadSchema(echo.type, echo.schemaVersion)
    if not validateSchema(echo, schema): return http(422, "schema mismatch")

    // L3: семантика и правомерность (анти-чит)
    if not zoneExists(echo.pose.zone): return http(422, "no such zone")
    if not inZoneBounds(echo.pose): return http(422, "pos out of bounds")
    if isBlocked(echo.pose): return http(422, "pos in wall")
    if not poseSane(id, echo.pose): return http(422, "implausible move")  // sanity-коридор

    switch echo.type:
      case "message":
        if not phrasesLegal(echo.payload.phraseIds):   // все ID в словаре + легальная грамматика
            return http(422, "bad phrase")
      case "ghost":
        if not trackSane(echo.payload.track):          // монотонный tMs, шаги ≤ vMax
            return http(422, "bad track")
      case "build":
        if not buildPlaceable(echo.payload, echo.pose): return http(422, "bad placement")
        if not chargeCost(id, echo.payload.cost):       // списать стоимость АТОМАРНО
            return http(422, "cannot afford")

    // дедуп: транспортный (echoUid) + семантический (contentKey)
    ck = contentKey(echo)
    existing = db.find("echoes", contentKey = ck, alive = true)
    if existing:
        db.update("echoes", existing.id,                 // схлопывание: продлить, не дублить
                  confirms = confirms + 1,
                  expires  = max(expires, now() + lifetimeFor(echo.type)))
        return http(200, { echoUid: existing.echoUid, merged: true })

    // серверные поля — ТОЛЬКО сервер (клиентские meta игнорируются)
    row = {
      echoUid:       echo.echoUid,                 // клиентский uid — ключ идемпотентности
      contentKey:    ck,
      type:          echo.type,
      zone:          echo.pose.zone,
      worldX:        echo.pose.worldX,
      worldZ:        echo.pose.worldZ,
      payloadJson:   serialize(echo.payload),      // phraseIds/track/buildSpec — без сырого текста
      schemaVersion: echo.schemaVersion,
      author:        id,                           // СЕРВЕРНАЯ личность, не клиент
      expires:       now() + lifetimeFor(echo.type),
      likes:         0,
      confirms:      1,
      createdAt:     now()
    }
    // upsert by echoUid → транспортный дедуп (повтор из outbox)
    db.upsertByUid("echoes", row)                  // ON DUPLICATE KEY (echoUid) DO NOTHING
    return http(200, { echoUid: echo.echoUid })
```

### Выборка релевантных эхо по зоне/времени
```pseudo
// ── echo.fetch — сервер. top-N живых эхо зоны, локализация на язык читателя ──
function handleFetch(req):
    zone       = req.zone
    viewerLang = req.viewerLang
    near       = req.entryPos                      // точка входа игрока (для proximity)

    out = []
    for type in ["message", "ghost", "build"]:
        rows = db.query("""
            SELECT echoUid, type, worldX, worldZ, payloadJson, likes, createdAt, expires,
                   ( likes * :W_LIKE
                   + GREATEST(0, 1 - (now() - createdAt) / :maxAge) * :W_FRESH
                   + proximity(worldX, worldZ, :nx, :nz)         * :W_NEAR ) AS score
            FROM echoes
            WHERE zone = :zone AND type = :type AND expires > now()
            ORDER BY score DESC
            LIMIT :cap
        """, zone, type, near, perTypeCap[type])   // ≤20 msg / ≤5 ghost / ≤50 build

        for r in rows:
            payload = deserialize(r.payloadJson)
            if r.type == "message":
                r.text = renderPhrase(payload.phraseIds, viewerLang)  // локализация из ID
                delete r.payloadJson                                  // не светим внутренности
            else:
                r.payload = payload
            r.expiresIn = r.expires - now()
            r.ageMs     = now() - r.createdAt
            out.push(r)
    return http(200, { echoes: out, serverTs: now() })
```

### Лайк (Death Stranding-петля) и decay-крон
```pseudo
// ── echo.like — идемпотентно: один игрок = один лайк ──
function handleLike(req):
    id = verifyToken(req.token); if not id: return http(401)
    if db.exists("echo_likes", echoUid = req.echoUid, voter = id):
        return http(200, { ok: true })             // уже лайкал — идемпотентно
    db.insert("echo_likes", { echoUid: req.echoUid, voter: id })
    db.update("echoes", byUid(req.echoUid),
              likes = likes + 1, expires = expires + EXTEND)
    grantAuthorReputation(authorOf(req.echoUid), +1)   // награда — ресурс/репутация, не очки
    return http(200, { ok: true })

// ── decay — серверный таймер, НЕ на каждый запрос (фикс self-DoS, NX-REVIEW#sec3-4) ──
EVERY ~60s (cron или вероятностно if rand() < 0.02):
    db.exec("DELETE FROM echoes      WHERE expires   < now()")
    db.exec("DELETE FROM echo_likes  WHERE echoUid NOT IN (SELECT echoUid FROM echoes)")
    db.exec("DELETE FROM players     WHERE last_seen < now() - 30s")   // контур A, NX-SYS-002
```

### Клиентская сторона: подпись пакета, outbox, событие шины
```pseudo
// Сборка эхо-пакета на клиенте (sig = личность + идемпотентность)
function buildEcho(type, pose, payload):
    return {
      type, schemaVersion: CLIENT_SCHEMA_VER,
      echoUid: uuid(),                 // ключ дедупа
      token:   session.token,          // личность выдаёт сервер (NX-SYS-002)
      pose, payload,
      clientTs: now()
    }
    // ВНИМАНИЕ: клиент НЕ кладёт author/expires/likes — это серверные meta

// Приём эхо из fetch → в шину как echo:received (каталог NX-SPEC-001)
function onFetched(resp):
    for e in resp.echoes:
        EventBus.emit('echo:received',
            { kind: e.type, payload: e, fromSession: null, validated: true })
        // validated:true — пришло с сервера, прошло ворота; локальный валидатор
        // (priority:100, NX-SPEC-001) может ещё раз отсеять подделку транспорта
```

### Предлагаемая схема таблиц (детализация [NX-SYS-002], развилка B)
```pseudo
TABLE echoes (
  id           INT PK AUTO,
  echoUid      CHAR(36) UNIQUE,          -- транспортный дедуп (идемпотентность)
  contentKey   CHAR(64) INDEX,           -- семантический дедуп (схлопывание)
  type         ENUM('message','ghost','build') INDEX,
  zone         VARCHAR(64) INDEX,        -- выборка по зоне
  worldX       FLOAT, worldZ FLOAT,      -- единая СК с players.x/y (nexus_setup.sql)
  payloadJson  JSON,                     -- phraseIds/track/buildSpec, БЕЗ сырого текста
  schemaVersion SMALLINT,
  author       VARCHAR(64) INDEX,        -- СЕРВЕРНАЯ личность (HMAC), не session_id клиента
  likes        INT DEFAULT 0,
  confirms     INT DEFAULT 1,
  createdAt    DATETIME, expires DATETIME INDEX,   -- decay по expires
  INDEX idx_zone_type_expires (zone, type, expires)  -- горячий путь fetch
)
TABLE echo_likes ( echoUid CHAR(36), voter VARCHAR(64), UNIQUE(echoUid, voter) )
```

### Развилки реализации
- **A. MVP — только `message`** ([NX-INN-003#razvilki] A): одна таблица `echoes`, три
  эндпоинта (`publish/fetch/like`), словарь фраз, decay-крон. Минимальная валидация L1+L2 +
  `phrasesLegal`. **Рекомендую первым** — мгновенно оживляет мир, нулевой риск грефа.
- **B. + `build`** (тёплый кооп): добавить `buildPlaceable`/`chargeCost`/семантический дедуп
  по `cells`. Лайки становятся основной механикой помощи.
- **C. + `ghost`** и стык с живым миром: `trackSane`, агрегаты для канала 4 (читает
  [NX-INN-002], не клиент). Эволюция, не переписывание.

Все три аддитивны; формат записи (`type/pose/payload/sig/meta`) единый с самого начала — новые
типы добавляют только свою ветку в `payload` и в `switch` валидатора.

## Что нового и какие кирпичики
*(спека — технический документ, а не NX-INN; раздел оставлен кратко для трассировки источников)*
Спека не вводит новую игровую идею — она **детализирует** инновацию [NX-INN-003] до уровня
байтов. Проверенные кирпичики, собранные здесь: **идемпотентный upsert** (`ON DUPLICATE KEY`,
уже в коде presence), **HMAC-токен личности** ([NX-SYS-002]), **JSON-Schema-валидация на
воротах записи**, **top-N + decay в SQL**, **контент-адресуемый дедуп** (`contentKey` —
приём из контент-адресуемых хранилищ/Git), **словарь фраз вместо свободного текста**
(локализация-через-ID — приём из старых текстовых движков и i18n-практики). Новизна — не в
кирпичиках, а в их **сборке под анти-чит асинхронной модели**: сервер судит о правомерности
эхо по одной записи, без realtime-симуляции мира.

## Риски, открытые вопросы
- **Проектирование словаря фраз.** Из шаблонов `[сущ]+[глагол]+[направление]` нельзя дать
  собрать оскорбление/наводку на греф ([NX-INN-003#riski]). Открыто: грамматика словаря и
  процесс модерации новых фраз.
- **Sanity-коридор для `pose` и `track`.** Нужны числа из баланса ([NX-SYS-001]): макс-скорость,
  допустимый Δ за `Δt`, чтобы не блокировать легальные рывки (телепорт-способность).
- **Атомарность `chargeCost` ↔ publish.** Списание стоимости и вставка эхо должны быть в одной
  транзакции, иначе чит «построил, откатил списание». Открыто: транзакционная граница на PHP.
- **Стоимость хранения `echoes`** при росте аудитории ([NX-INN-003#riski], [NX-SYS-002#riski]):
  decay + top-N + партиционирование по `zone`. Открыто: ретеншн `echo_likes`.
- **Rate-limit на `publish/like`** (спам-вектор при CORS `*` без auth, [NX-REVIEW#sec3-4]):
  токен сужает, но политику лимита (`429`) надо задать явно — на токен и на IP.
- **`contentKey`-коллизии.** Слишком грубое квантование позиции схлопнёт *разные* эхо; слишком
  точное — не схлопнёт *одинаковые*. Открыт подбор шага квантования на зону.
- Это **proposed/idea-уровень**: ни таблицы `echoes`, ни валидатора, ни словаря в коде нет
  ([NX-REVIEW#sec3-4] — в коде только presence-poll и чат). Зрелость — `analyzed`, не `prototyped`.

## Комментарии
Документ — самый частный («detailed») слой ветки эхо: концепция [NX-INN-003] → сетевая модель
[NX-SYS-002] → форматы и псевдокод здесь. Он закрывает явные отсылки «детальные форматы — в
[NX-SPEC-003]» из обоих родителей ([NX-INN-003#realizaciya], [NX-SYS-002#kontrakt-endpointov]) и
комментирует раздел безопасности ревью ([NX-REVIEW#sec3-4]): анти-чит реализуется как ворота
записи, а не постобработка. Возражения и альтернативы форматам — отдельными `NX-CMT-###`.

## Связанные документы
- [NX-INN-003 Асинхронный эхо-мультиплеер](../20-innovation/NX-INN-003-echo-multiplayer.md) — концепция (что течёт по протоколу)
- [NX-SYS-002 Сеть и эхо-слой](../30-systems/NX-SYS-002-netcode-echo-layer.md) — контуры/эндпоинты (depends_on)
- [NX-SPEC-001 EventBus 2.0](NX-SPEC-001-eventbus-2.md) — событие `echo:received`, валидатор-приоритет
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md) — столп «Эхо-мир», анти-грубое-доверие
- [NX-SYS-004 Рендер-абстракция 2D/2.5D/3D] — эхо рендер-независимы, единая СК
- [NX-INN-002 Живая экология](../20-innovation/NX-INN-002-living-world-ecology.md) — читает агрегаты эхо (канал 4)
- [NX-SYS-006 Версионирование сейвов/данных] — политика `schemaVersion`/миграций
- [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) (NX-REVIEW) · [Конституция](../00-meta/CONSTITUTION.md)
</content>
</invoke>
