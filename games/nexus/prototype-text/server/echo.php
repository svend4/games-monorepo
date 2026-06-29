<?php
/**
 * NEXUS · prototype-text · server/echo.php
 * =========================================================================
 * ОПЦИОНАЛЬНЫЙ АДАПТЕР СИНКА ЭХО — ЭТО НЕ ЯДРО.
 *
 * Ядро прототипа («Койне» + столпы ЭХО/ЗНАНИЕ) работает целиком на современном
 * клиентском стеке (ES-модули + localStorage-субстрат) и НЕ зависит от этого файла.
 * По умолчанию эхо хранятся локально в субстрате (src/systems/echo.js,
 * локальный адаптер). Данный PHP-эндпоинт — лишь один из СМЕННЫХ адаптеров порта
 * хранилища эхо (ср. EchoStore / PhpMySqlStore в NX-SPEC-005), подключаемый
 * ЯВНО через echo.setAdapter(new PhpEchoAdapter('./server/echo.php')) и НЕ
 * блокирующий ядро, если PHP/MySQL недоступны.
 *
 * Принцип «современное-первым» (NX-STRAT-004): современное ядро — дефолт;
 * legacy (PHP/MySQL) — opt-in за интерфейсом, не фундамент.
 *
 * Безопасность (по урокам ревью NX-REVIEW#sec3-4):
 *   - CORS строго http://localhost (НЕ '*') — обслуживается по XAMPP/HTTP.
 *   - Только подготовленные выражения (prepared statements), без конкатенации.
 *   - Жёсткие лимиты ввода (text ≤ 300, room ≤ 64, author ≤ 64) + rate-limit.
 *   - Ответы об ошибках без getMessage()/деталей драйвера (без утечки внутренностей).
 *   - Нет БД → аккуратный {error}, ядро это переживает (адаптер опционален).
 *
 * Контракт HTTP (минимальный срез эхо для текстового прототипа):
 *   GET  ?action=list&room=<roomId>            → { ok, room, echoes:[{id,author,room,text,created_at}] }
 *   POST ?action=add   (JSON { author, room, text }) → { ok, echo:{...} }
 *
 * Таблица: echoes(id, author, room, text, created_at)
 * =========================================================================
 */

declare(strict_types=1);

// ── CORS строго http://localhost (НЕ '*') ───────────────────────────────────
// ES-модули требуют http; прототип живёт под http://localhost/01/...
$ALLOWED_ORIGIN = 'http://localhost';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin === $ALLOWED_ORIGIN) {
    header('Access-Control-Allow-Origin: ' . $ALLOWED_ORIGIN);
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Конфиг БД (XAMPP-дефолты) ───────────────────────────────────────────────
const DB_HOST = 'localhost';
const DB_NAME = 'nexus_world';   // переиспользуем БД проекта (nexus_setup.sql)
const DB_USER = 'root';
const DB_PASS = '';              // XAMPP по умолчанию: пустой пароль

// ── Лимиты (ворота записи: анти-спам/анти-флуд) ─────────────────────────────
const MAX_TEXT_LEN   = 300;      // ограничение длины эхо-текста
const MAX_ROOM_LEN   = 64;       // ≤64 симв. на id комнаты (как RoomId в NX-SPEC-005)
const MAX_AUTHOR_LEN = 64;       // ≤64 симв. на личность автора
const MAX_LIST_ROWS  = 50;       // top-N выдачи (анти-свалка)
const RATE_MAX       = 5;        // не более N записей add ...
const RATE_WINDOW    = 10;       // ... за RATE_WINDOW секунд с одного IP

/**
 * Единая точка JSON-ответа. Любая ошибка отдаётся как {ok:false, error:<код>}
 * БЕЗ деталей драйвера/исключений — наружу уходит только стабильный код.
 */
function json_out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $error, int $code = 400): void
{
    json_out(['ok' => false, 'error' => $error], $code);
}

/**
 * Ленивое подключение к БД. Если БД недоступна — НЕ роняем процесс стектрейсом,
 * а возвращаем аккуратный {error:'db_unavailable'}: адаптер опционален, ядро
 * продолжит работу на локальном субстрате.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,  // настоящие prepared statements
        ]);
    } catch (Throwable $e) {
        // НЕ светим getMessage() наружу — только стабильный код.
        fail('db_unavailable', 503);
    }
    return $pdo;
}

/**
 * Идемпотентное создание таблицы — чтобы адаптер «просто работал» на свежем
 * XAMPP без отдельного .sql. Совместимо со схемой эхо (NX-SPEC-003).
 */
function ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS echoes (
            id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            author     VARCHAR(64)  NOT NULL,
            room       VARCHAR(64)  NOT NULL,
            text       VARCHAR(300) NOT NULL,
            created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_room_created (room, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * Простейший rate-limit на IP по таблице echoes: считаем записи с этого IP-хеша
 * за окно. Чтобы не хранить IP в открытом виде, заводим вспомогательную таблицу
 * с хешем IP и временем. Лёгкая защита от флуда add (NX-SPEC-003#riski).
 */
function rate_ok(PDO $pdo): bool
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS echo_rate (
            ip_hash CHAR(64) NOT NULL,
            ts      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ip_ts (ip_hash, ts)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
    $ip     = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ipHash = hash('sha256', $ip);

    // Чистим устаревшие отметки (не self-DoS: дёшево, по индексу).
    $gc = $pdo->prepare('DELETE FROM echo_rate WHERE ts < (NOW() - INTERVAL :w SECOND)');
    $gc->bindValue(':w', RATE_WINDOW, PDO::PARAM_INT);
    $gc->execute();

    $q = $pdo->prepare(
        'SELECT COUNT(*) AS c FROM echo_rate
         WHERE ip_hash = :h AND ts >= (NOW() - INTERVAL :w SECOND)'
    );
    $q->bindValue(':h', $ipHash);
    $q->bindValue(':w', RATE_WINDOW, PDO::PARAM_INT);
    $q->execute();
    $count = (int) ($q->fetch()['c'] ?? 0);
    if ($count >= RATE_MAX) {
        return false;
    }

    $ins = $pdo->prepare('INSERT INTO echo_rate (ip_hash) VALUES (:h)');
    $ins->bindValue(':h', $ipHash);
    $ins->execute();
    return true;
}

// ── Разбор входа ────────────────────────────────────────────────────────────
$action = trim((string) ($_GET['action'] ?? ''));
$body   = [];
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $raw  = file_get_contents('php://input');
    $body = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
    if (!is_array($body)) {
        $body = [];
    }
}

try {
    $pdo = db();          // при недоступности БД отдаст {error} и выйдет
    ensure_schema($pdo);

    // ── LIST: GET ?action=list&room=<roomId> ────────────────────────────────
    if ($action === 'list') {
        $room = mb_substr(trim((string) ($_GET['room'] ?? '')), 0, MAX_ROOM_LEN);
        if ($room === '') {
            fail('room_required', 422);
        }

        $stmt = $pdo->prepare(
            'SELECT id, author, room, text, created_at
             FROM echoes
             WHERE room = :room
             ORDER BY created_at DESC, id DESC
             LIMIT :lim'
        );
        $stmt->bindValue(':room', $room);
        $stmt->bindValue(':lim', MAX_LIST_ROWS, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();

        json_out(['ok' => true, 'room' => $room, 'echoes' => $rows]);
    }

    // ── ADD: POST ?action=add  JSON { author, room, text } ──────────────────
    if ($action === 'add') {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            fail('method_not_allowed', 405);
        }
        if (!rate_ok($pdo)) {
            fail('rate_limited', 429);
        }

        // Серверная нормализация и жёсткие лимиты (ворота записи).
        $author = mb_substr(trim((string) ($body['author'] ?? '')), 0, MAX_AUTHOR_LEN);
        $room   = mb_substr(trim((string) ($body['room']   ?? '')), 0, MAX_ROOM_LEN);
        $text   = mb_substr(trim((string) ($body['text']   ?? '')), 0, MAX_TEXT_LEN);

        if ($author === '') {
            $author = 'anon';
        }
        if ($room === '') {
            fail('room_required', 422);
        }
        if ($text === '') {
            fail('text_required', 422);
        }

        $ins = $pdo->prepare(
            'INSERT INTO echoes (author, room, text)
             VALUES (:author, :room, :text)'
        );
        $ins->bindValue(':author', $author);
        $ins->bindValue(':room', $room);
        $ins->bindValue(':text', $text);
        $ins->execute();

        $id = (int) $pdo->lastInsertId();
        $sel = $pdo->prepare(
            'SELECT id, author, room, text, created_at FROM echoes WHERE id = :id'
        );
        $sel->bindValue(':id', $id, PDO::PARAM_INT);
        $sel->execute();
        $echo = $sel->fetch() ?: null;

        json_out(['ok' => true, 'echo' => $echo], 201);
    }

    // ── Неизвестное действие ────────────────────────────────────────────────
    fail('unknown_action', 404);

} catch (Throwable $e) {
    // Перехватываем ВСЁ: наружу — стабильный код, без getMessage()/стектрейса.
    // (При желании логировать — только в server-side error_log, не в ответ.)
    error_log('[echo.php] ' . $e->getMessage());
    fail('server_error', 500);
}
