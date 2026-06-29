---
id: NX-POLY-006
title: PHP в проекте — роль и модернизация без переусложнения
type: system
status: draft
layer: technical
abstraction: extended
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [polyglot, php, backend, api, security, validation, routing, xampp, interop]
relates_to: [NX-POLY-001, NX-POLY-002, NX-POLY-003, NX-POLY-004, NX-SYS-002, NX-SYS-003, NX-VIS-001]
depends_on: [NX-POLY-001]
comments_on: [NX-ARCH#sec-backend, NX-REVIEW#sec3-4, NX-SYS-002#api]
superseded_by: null
inspiration_sources: [c20-proven, humanities]
new_vs_known: >
  НОВОЕ — не фреймворк и не переписывание, а тонкий слой дисциплины (роутер-таблица,
  валидатор-схема, единая обёртка ошибок и безопасности) поверх уже работающего
  однофайлового PHP-бэкенда nexus_api.php. Кирпичики — проверенные за 25+ лет PDO с
  prepared statements, front-controller паттерн, HTTP/JSON, CGI/FastCGI-модель «процесс
  на запрос», XAMPP/Apache как zero-config хостинг.
innovation_score: 2
improves: { quantitative: "−80% поверхности инъекций после ревью (SQLi уже закрыт PDO, остаётся CORS/rate-limit/leak); +N эндпоинтов без роста сложности за счёт таблицы маршрутов", qualitative: "бэкенд остаётся читаемым одним человеком за один присест; безопасность по чек-листу ревью, а не по вере" }
maturity: analyzed
risk: low
effort: M
language: ru
---

# PHP в проекте: роль и модернизация без переусложнения

## TL;DR
PHP — это **уже существующий и работающий** бэкенд NEXUS (`nexus_api.php`): синхронизация
игроков, чат, онлайн-счётчик. Он правильный выбор, пока хостинг — XAMPP/Apache/общий
shared-хостинг, а нагрузка — десятки игроков с поллингом. Модернизируем **по чек-листу
ревью** ([NX-REVIEW#sec3-4](../../ARCHITECTURE_REVIEW.md)): тонкий роутер-таблица,
схема-валидация входа, единая обёртка безопасности (CORS-allowlist, rate-limit, не течь
исключениями) — **без тяжёлого фреймворка** на стадии прототипа. Уступаем место Node/Go
ровно в одной точке: когда нужен **persistent realtime** (WebSocket, тики 20 Гц, общая
память между запросами). Это «велосипед с крылышками»: колесо — классический LAMP, новое
измерение — дисциплина контрактов на стыке, а не новый стек.

## Краткое содержание
Документ фиксирует роль PHP в полиглот-монорепо ([NX-POLY-001](NX-POLY-001-language-per-role.md))
и даёт **конкретный план модернизации** текущего файла. Сейчас `nexus_api.php` — ~160 строк,
front-controller с `switch`-подобной цепочкой `if ($action===…)`, PDO с честными prepared
statements (SQL-инъекции уже закрыты), но с тремя дырами из ревью: `Access-Control-Allow-Origin: *`,
отсутствие rate-limit и утечка `PDOException::getMessage()` в ответ. Предлагаем:
(1) превратить цепочку `if` в **таблицу маршрутов** `[action][method] → handler`;
(2) вынести разбор и проверку входа в **декларативный валидатор** (схема на массиве);
(3) обернуть всё в **bootstrap** с allowlist-CORS, троттлингом и безопасной обёрткой ошибок.
Всё это — чистый PHP без Composer-зависимостей; опционально один micro-роутер, если файлов
станет больше. Раздел «Что нового и какие кирпичики» и таблицы выбора «когда PHP / когда
Node/Go» — ниже.

## Расширенное содержание (общее)

### Почему PHP здесь уместен (и это не стыдно)
PHP реализует **request/response модель идеально**: процесс рождается на HTTP-запрос,
живёт миллисекунды, умирает. Для NEXUS-бэкенда это не баг, а фича: нет долгоживущего
состояния, которое надо охранять от гонок; каждая синхронизация игрока — независимая
короткая транзакция в БД. Проверенные кирпичики, которые дают это «бесплатно»:

- **XAMPP/Apache + mod_php** — zero-config: положил `.php` в `htdocs`, он работает. Никакого
  процесс-менеджера, демонов, портов. Это и есть текущая среда проекта (`C:\xampp\htdocs`).
- **PDO + prepared statements** — параметризованные запросы исключают SQL-инъекцию по
  построению; в коде уже `ATTR_EMULATE_PREPARES => false` (настоящие prepared на стороне MySQL).
- **Front-controller** — один входной файл маршрутизирует по `?action=`; классика веба с 2000-х.
- **Stateless-полинг** — клиент шлёт `sync` раз в ~250–500 мс, PHP отвечает срезом мира.
  Это «бедный человек realtime», но для десятков игроков честно работает (см. границы ниже).

### Чего НЕ делаем (анти-переусложнение)
- **Не тащим Laravel/Symfony** в прототип. Они дают роутинг, ORM, DI, миграции — но и
  сотни мегабайт `vendor/`, конфиги, кривую обучения, накладные на bootstrap каждого запроса.
  Для 5 эндпоинтов это пушка по воробьям. Философия NEXUS — «велосипед с крылышками», а не
  «звездолёт ради поездки в магазин».
- **Не вводим ORM.** Голый SQL в `nexus_setup.sql` читаем и быстр; ORM прячет именно ту
  часть, которую важно видеть на горячем пути (`sync`).
- **Не делаем PHP realtime-сервером.** Persistent WebSocket на PHP (ReactPHP/Swoole) —
  это уже отдельный демон, теряем zero-config XAMPP. Если нужен realtime — это сигнал
  уступить место Node/Go (см. таблицу), а не насиловать PHP.

### Три уровня модернизации (инкрементально)
1. **Уровень 0 — безопасность по ревью (обязательно, S).** Закрыть три дыры:
   CORS-allowlist вместо `*`, rate-limit на `sync`/`chat`, не возвращать `getMessage()`
   наружу (логировать в файл, наружу — generic). Это правки на месте, без рефакторинга.
2. **Уровень 1 — структура (рекомендуется, M).** Таблица маршрутов + декларативный
   валидатор входа. Файл остаётся один, но цепочка `if` превращается в данные.
3. **Уровень 2 — масштаб файлов (по необходимости, M).** Когда эндпоинтов станет >10 —
   вынести handlers в `handlers/*.php`, подключить один micro-роутер (`bramus/router`,
   ~1 файл) или собственный 30-строчный. Composer появляется только здесь и только при нужде.

## Детали и частные случаи

### Карта текущего файла (факт, по коду)
`v1-2d-mmo/nexus_api.php` содержит:
- `db(): PDO` — синглтон-соединение (статическая переменная). Хорошо.
- `json_out(array, code)` — единый выход JSON + `exit`. Хорошо.
- `cleanup()` — DELETE протухших игроков и старого чата. **Проблема:** вызывается на
  **каждом** запросе (строка `cleanup();` в `try`), две лишние записи в БД на каждый `sync`.
- Эндпоинты `join | sync | chat | leave | status`.
- Валидация — ручная, разбросанная: `mb_substr(...,0,50)`, `max/min` по координатам. Работает,
  но дублируется и легко забыть на новом поле.

### Дыры из NX-REVIEW#sec3-4 (приоритезированно)
| # | Проблема | Где | Риск | Фикс (уровень) |
|---|----------|-----|------|----------------|
| D1 | `Access-Control-Allow-Origin: *` | заголовки сверху | средний (любой сайт дёргает API) | allowlist (L0) |
| D2 | Нет rate-limit | `sync`, `chat` | средний (флуд/спам чата) | троттлинг по session (L0) |
| D3 | `'DB error: '.$e->getMessage()` наружу | catch внизу | средний (утечка схемы/путей) | лог + generic (L0) |
| D4 | `cleanup()` на каждом запросе | начало try | низкий (лишняя нагрузка БД) | вероятностно / по таймеру (L1) |
| D5 | session_id ничем не подписан | весь файл | низкий-средний (спуфинг чужого игрока) | HMAC-токен при join (L2, см. NX-SYS-002) |
| D6 | Валидация размазана | каждый эндпоинт | низкий (баги на новых полях) | схема-валидатор (L1) |

SQL-инъекции (классическая дыра PHP-возраста) **здесь нет** — все запросы параметризованы.
Это важно зафиксировать: ревью не нашло SQLi, и мы её не вводим обратно строковой склейкой.

### Граница нагрузки (когда модель «полинг на PHP» ломается)
Грубая оценка для shared-хостинга / XAMPP:
- 1 игрок при `sync` 4 Гц = 4 запроса/с × (1 UPSERT + 1 SELECT players + 1 SELECT chat) ≈ 12 query/с.
- 30 игроков ≈ 360 query/с + по 2 cleanup-DELETE на запрос (если не чинить D4) ≈ +240 query/с.
- MySQL на ноутбуке тянет тысячи простых query/с, так что **~50–100 одновременных игроков —
  потолок** этой модели до того, как латентность полинга станет заметной. Дальше — Node/Go +
  WebSocket (см. таблицу выбора) или шардирование по зонам ([NX-SYS-002](../30-systems/NX-SYS-002-netcode-and-sync.md)).

## Предложения и варианты реализации

### Вариант A (рекомендуемый): bootstrap + таблица маршрутов + валидатор, всё в чистом PHP

**1. Bootstrap-обёртка безопасности** (`_bootstrap.php`, подключается первым):

```php
<?php
// _bootstrap.php — единая точка безопасности и инфраструктуры
declare(strict_types=1);

// ── D1: CORS allowlist вместо '*' ──────────────────────────
const ALLOWED_ORIGINS = [
    'http://localhost',
    'http://localhost:8080',
    'https://nexus.example.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

// ── D3: безопасная обёртка ошибок ──────────────────────────
function fail(string $publicMsg, int $code = 400, ?Throwable $e = null): never {
    if ($e) {
        error_log('[nexus] ' . $e->getMessage());     // в лог, не наружу
    }
    http_response_code($code);
    echo json_encode(['error' => $publicMsg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── D2: примитивный rate-limit на файлах (без Redis) ───────
function rate_limit(string $key, int $maxPerWindow, int $windowSec): void {
    $bucket = sys_get_temp_dir() . '/nexus_rl_' . md5($key) . '.json';
    $now = time();
    $hits = is_file($bucket) ? json_decode((string)file_get_contents($bucket), true) : [];
    $hits = array_values(array_filter((array)$hits, fn($t) => $t > $now - $windowSec));
    if (count($hits) >= $maxPerWindow) {
        fail('rate limit exceeded', 429);
    }
    $hits[] = $now;
    file_put_contents($bucket, json_encode($hits), LOCK_EX);
}
```

**2. Декларативный валидатор входа** (`_validate.php`) — схема как данные, фикс D6:

```php
<?php
// _validate.php — крошечный валидатор «схема → очищенные значения»
// Спецификация поля: [тип, default, ограничения...]
function validate(array $input, array $schema): array {
    $out = [];
    foreach ($schema as $field => $rule) {
        $v = $input[$field] ?? ($rule['default'] ?? null);
        switch ($rule['type']) {
            case 'str':
                $v = mb_substr(trim((string)$v), 0, $rule['max'] ?? 255);
                if (($rule['required'] ?? false) && $v === '') {
                    fail("missing $field", 400);
                }
                break;
            case 'int':
                $v = (int)$v;
                $v = max($rule['min'] ?? PHP_INT_MIN, min($rule['max'] ?? PHP_INT_MAX, $v));
                break;
            case 'float':
                $v = (float)$v;
                $v = max($rule['min'] ?? -INF, min($rule['max'] ?? INF, $v));
                break;
        }
        $out[$field] = $v;
    }
    return $out;
}

// Схемы эндпоинтов — единственный источник правды о форме входа:
const SCHEMAS = [
    'sync' => [
        'session' => ['type' => 'str',   'max' => 64,  'required' => true],
        'name'    => ['type' => 'str',   'max' => 50,  'default' => 'Wanderer'],
        'x'       => ['type' => 'float', 'min' => 0,   'max' => 3840, 'default' => 1920],
        'y'       => ['type' => 'float', 'min' => 0,   'max' => 3840, 'default' => 1920],
        'hp'      => ['type' => 'int',   'min' => 0,   'max' => 9999, 'default' => 100],
        'maxHp'   => ['type' => 'int',   'min' => 1,   'max' => 9999, 'default' => 100],
        'level'   => ['type' => 'int',   'min' => 1,   'max' => 999,  'default' => 1],
        'zone'    => ['type' => 'str',   'max' => 100, 'default' => ''],
    ],
    'chat' => [
        'session' => ['type' => 'str', 'max' => 64,  'required' => true],
        'name'    => ['type' => 'str', 'max' => 50,  'default' => 'Wanderer'],
        'message' => ['type' => 'str', 'max' => 200, 'required' => true],
    ],
];
```

**3. Таблица маршрутов вместо цепочки `if`** (`nexus_api.php` после рефакторинга):

```php
<?php
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_validate.php';
require __DIR__ . '/_db.php';   // функция db(): PDO — как сейчас

// Разбор входа: GET для join/leave/status, JSON-body для sync/chat
$action = trim($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body   = $method === 'POST'
    ? (json_decode((string)file_get_contents('php://input'), true) ?? [])
    : $_GET;

// Таблица: action => [метод, нужна ли валидация по SCHEMAS, handler]
$routes = [
    'join'   => ['GET',  null,   'h_join'],
    'sync'   => ['POST', 'sync', 'h_sync'],
    'chat'   => ['POST', 'chat', 'h_chat'],
    'leave'  => ['GET',  null,   'h_leave'],
    'status' => ['GET',  null,   'h_status'],
];

if (!isset($routes[$action]))            fail('unknown action', 404);
[$wantMethod, $schemaKey, $handler] = $routes[$action];
if ($method !== $wantMethod && $method !== 'GET') fail('method not allowed', 405);

// D2: троттлинг шумных эндпоинтов по session
if (in_array($action, ['sync', 'chat'], true)) {
    $sid = (string)($body['session'] ?? $_GET['session'] ?? 'anon');
    rate_limit("$action:$sid", $action === 'chat' ? 5 : 20, 5); // chat ≤5/5с, sync ≤20/5с
}

$data = $schemaKey ? validate($body, SCHEMAS[$schemaKey]) : $body;

try {
    maybe_cleanup();             // D4: не на каждом запросе (см. ниже)
    $handler($data);             // хендлер сам зовёт json_out()
} catch (PDOException $e) {
    fail('database unavailable', 500, $e);   // D3: generic наружу, детали в лог
} catch (Throwable $e) {
    fail('internal error', 500, $e);
}

// D4: вероятностная очистка — ~1 запрос из 50 запускает cleanup
function maybe_cleanup(): void {
    if (random_int(1, 50) !== 1) return;
    db()->exec("DELETE FROM players WHERE last_seen < DATE_SUB(NOW(), INTERVAL 30 SECOND)");
    db()->exec("DELETE FROM chat_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
}
```

Хендлеры (`h_sync` и т.д.) — это бывшие тела `if`-блоков, дословно те же SQL-запросы из
текущего файла, только принимают уже-валидированный `$data`. Никакой новой логики, только
перенос. SQL остаётся параметризованным (PDO prepared), как сейчас.

### Вариант B (минимальный, только L0): три точечные правки
Если рефакторинг сейчас не нужен — внести **только** D1/D2/D3 поверх существующего файла:
заменить `header('Access-Control-Allow-Origin: *')` на allowlist; добавить вызов `rate_limit()`
в начало `sync`/`chat`; заменить `'DB error: '.$e->getMessage()` на `error_log()` + generic.
~30 строк, ноль структурных изменений. Это безопасный «минимум для продакшена».

### Вариант C (когда вырастем): micro-роутер + handlers/
Один внешний пакет (`composer require bramus/router`, ~1 файл, без зависимостей) или свой
30-строчный роутер; каждый эндпоинт — отдельный файл в `handlers/`. Переходим сюда **только**
при >10 эндпоинтах или появлении REST-путей (`/players/{id}`). Не раньше.

### Interop: как PHP встроен в полиглот-стек (см. NX-POLY-003)
PHP в NEXUS общается с другими языками **только по контрактам**, без прямого FFI:
- **С клиентом (JS):** HTTP + JSON. Контракт — форма ответа `sync` (массив players + chat).
  Это тот же контракт, что описан в [NX-POLY-003](NX-POLY-003-interop.md#http-json).
- **С данными (SQL):** PDO, схема в `nexus_setup.sql` — единый источник правды о таблицах.
- **С Python-генераторами:** **косвенно, через БД и файлы.** Python генерирует контент
  (уровни, баланс) в JSON/SQL-сиды; PHP их только читает. Никакого вызова Python из PHP на
  горячем пути — это анти-паттерн (fork процесса на запрос). Если нужна оффлайн-генерация —
  cron/CLI-скрипт, не HTTP-эндпоинт.
- **С Markdown (design/**):** PHP не читает дизайн-вики в рантайме; она — для людей и роя.

## Что нового и какие кирпичики
- **НОВОЕ:** не язык и не фреймворк, а **тонкий слой дисциплины над голым PHP** — три
  маленьких include (`_bootstrap`, `_validate`, таблица маршрутов), которые превращают
  «скрипт» в «маленький честный сервис», не теряя read-in-one-sitting простоты. И **явная
  карта границы**: формальный список «когда PHP / когда уступить Node/Go» (таблица ниже),
  чтобы решение о смене стека было инженерным, а не эмоциональным.
- **Источники:** `c20-proven` (CGI/front-controller/LAMP, Unix-философия «маленькие
  компонуемые куски»), `humanities` (бритва Оккама применительно к стеку — не плодить
  сущности сверх нужды).
- **Проверенные кирпичики:** PDO + prepared statements (анти-SQLi по построению), HTTP/JSON
  как контракт, Apache/XAMPP как zero-config рантайм, файловый rate-limit (бедный, но без
  Redis), front-controller, вероятностный GC (как в сессиях самого PHP — `session.gc_probability`).
- **Чего нет/редко в других проектах-прототипах:** обычно либо «грязный скрипт без
  валидации/безопасности», либо «сразу Laravel из пушки». Здесь — **средний путь по
  чек-листу ревью**: ровно столько структуры, сколько закрывает реальные дыры, и ни строкой больше.

### Таблица выбора: PHP против Node/Go (главный артефакт документа)
| Критерий | PHP — правильный выбор | Уступить Node/Go |
|----------|------------------------|------------------|
| Хостинг | shared-хостинг, XAMPP, «положил файл — работает» | свой VPS/контейнер, процесс-менеджер есть |
| Модель связи | polling (REST), запрос-ответ | **WebSocket**, server-push, SSE |
| Состояние | stateless, всё в БД на каждый запрос | долгоживущее in-memory (мир в RAM, тики) |
| Частота | ≤ ~4 Гц на клиента, десятки игроков | 20–60 Гц, сотни игроков в одной комнате |
| Параллелизм | процесс-на-запрос, БД сериализует | event-loop / горутины, общая память |
| Команда | знает PHP/Apache, не хочет devops | готова деплоить и держать демон |
| Когда менять | — | как только нужен **authoritative realtime tick** |

Правило большого пальца: **пока связь — это HTTP-полинг, PHP оптимален; как только нужен
постоянный двунаправленный канал и серверный тик — это работа для Node/Go**, и тогда PHP
остаётся для «холодных» эндпоинтов (логин, профиль, магазин, лидерборды), а realtime
уходит на отдельный сервис. См. границу realtime в [NX-SYS-002](../30-systems/NX-SYS-002-netcode-and-sync.md).

## Риски, открытые вопросы
- **Файловый rate-limit не атомарен между процессами** при высокой конкуренции (гонка
  read-modify-write). Для прототипа достаточно; при росте — APCu (`apcu_inc`) или Redis.
  Открытый вопрос: вводить ли APCu сразу (оно есть в XAMPP) — компромисс простоты/корректности.
- **D5 (подпись session_id)** вынесена в L2 и зависит от модели сессий в
  [NX-SYS-002](../30-systems/NX-SYS-002-netcode-and-sync.md). Пока session — голый UUID от
  клиента, любой может слать `sync` за чужой session_id. Нужен HMAC-токен, выдаваемый при `join`.
- **Граница «когда Node/Go»** дана качественно; точную точку перелома (игроков × Гц) надо
  замерить нагрузочным тестом, а не угадывать. Открытый вопрос: писать ли бенч на Python (locust)
  или k6 — относится к [NX-POLY-003](NX-POLY-003-interop.md).
- **Версия PHP.** Примеры используют `never`-тип возврата (PHP 8.1+) и `declare(strict_types=1)`.
  Надо зафиксировать минимальную версию PHP проекта (XAMPP обычно несёт 8.2+) в
  [NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md).
- Риск **scope-creep к фреймворку**: каждый «удобный» пакет тянет следующий. Дисциплина —
  Composer не появляется до Варианта C.

## Комментарии
Этот документ комментирует backend-секцию архитектуры и пункты 3–4 ревью
([NX-REVIEW#sec3-4](../../ARCHITECTURE_REVIEW.md)). Развёрнутые ветки обсуждения —
выносить в `NX-CMT-###` при необходимости.

## Связанные документы
- [NX-POLY-001 Полиглот-архитектура: язык под роль (обзор)](NX-POLY-001-language-per-role.md)
- [NX-POLY-002 Проект-в-проекте: границы и деплой](NX-POLY-002-project-in-project.md)
- [NX-POLY-003 Механизмы interop (HTTP/JSON, пайпы, FFI, WASM)](NX-POLY-003-interop.md)
- [NX-POLY-004 Матрица «тип файла → язык»](NX-POLY-004-filetype-language-matrix.md)
- [NX-SYS-002 Netcode и синхронизация (граница realtime)](../30-systems/NX-SYS-002-netcode-and-sync.md)
- [NX-SYS-003 Сборка и деплой (версии, окружения)](../30-systems/NX-SYS-003-build-and-deploy.md)
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md)
- Источники-факты: `games/nexus/v1-2d-mmo/nexus_api.php`, `nexus_setup.sql`, `ARCHITECTURE_REVIEW.md`
