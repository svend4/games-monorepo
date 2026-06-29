<?php
/**
 * NEXUS WORLD — Multiplayer API
 * Эндпоинты: join | sync | leave | chat
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── DB Config ──────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'nexus_world');
define('DB_USER', 'root');
define('DB_PASS', '');            // XAMPP default: пустой пароль

function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function json_out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function cleanup(): void {
    // Удалить игроков, которых не было 30 секунд
    db()->exec("DELETE FROM players WHERE last_seen < DATE_SUB(NOW(), INTERVAL 30 SECOND)");
    // Удалить старые сообщения чата (старше 5 минут)
    db()->exec("DELETE FROM chat_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
}

// ── Input ──────────────────────────────────────────────────
$action = trim($_GET['action'] ?? '');
$body   = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true) ?? [];
}

try {
    cleanup();

    // ── JOIN ───────────────────────────────────────────────
    if ($action === 'join') {
        $session = trim($_GET['session'] ?? '');
        $name    = mb_substr(trim($_GET['name'] ?? 'Wanderer'), 0, 50);
        if (!$session) json_out(['error' => 'no session'], 400);

        db()->prepare("
            INSERT INTO players (session_id, name, x, y, hp, max_hp, level, last_seen)
            VALUES (?, ?, 1920, 1920, 100, 100, 1, NOW())
            ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen = NOW()
        ")->execute([$session, $name]);

        $online = (int) db()->query("SELECT COUNT(*) FROM players")->fetchColumn();
        json_out(['ok' => true, 'online' => $online]);
    }

    // ── SYNC ───────────────────────────────────────────────
    if ($action === 'sync') {
        $session = trim($body['session'] ?? '');
        if (!$session) json_out(['error' => 'no session'], 400);

        $name   = mb_substr(trim($body['name']  ?? 'Wanderer'), 0, 50);
        $x      = (float)  ($body['x']      ?? 1920);
        $y      = (float)  ($body['y']      ?? 1920);
        $hp     = (int)    ($body['hp']     ?? 100);
        $maxHp  = (int)    ($body['maxHp']  ?? 100);
        $level  = (int)    ($body['level']  ?? 1);
        $zone   = mb_substr(trim($body['zone'] ?? ''), 0, 100);

        // Ограничения: координаты в пределах карты (80*48=3840)
        $x = max(0, min(3840, $x));
        $y = max(0, min(3840, $y));
        $hp = max(0, min(9999, $hp));
        $maxHp = max(1, min(9999, $maxHp));
        $level = max(1, min(999, $level));

        db()->prepare("
            INSERT INTO players (session_id, name, x, y, hp, max_hp, level, zone, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              name = VALUES(name), x = VALUES(x), y = VALUES(y),
              hp = VALUES(hp), max_hp = VALUES(max_hp),
              level = VALUES(level), zone = VALUES(zone),
              last_seen = NOW()
        ")->execute([$session, $name, $x, $y, $hp, $maxHp, $level, $zone]);

        // Получить других игроков (активных за последние 15 сек)
        $stmt = db()->prepare("
            SELECT session_id, name, x, y, hp, max_hp, level, zone
            FROM players
            WHERE session_id != ?
              AND last_seen > DATE_SUB(NOW(), INTERVAL 15 SECOND)
            LIMIT 50
        ");
        $stmt->execute([$session]);
        $players = $stmt->fetchAll();

        // Последние сообщения чата
        $chatStmt = db()->prepare("
            SELECT name, message, created_at
            FROM chat_messages
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)
            ORDER BY created_at ASC
            LIMIT 20
        ");
        $chatStmt->execute();
        $chat = $chatStmt->fetchAll();

        json_out(['players' => $players, 'chat' => $chat]);
    }

    // ── CHAT ───────────────────────────────────────────────
    if ($action === 'chat') {
        $session = trim($body['session'] ?? '');
        $name    = mb_substr(trim($body['name']    ?? 'Wanderer'), 0, 50);
        $message = mb_substr(trim($body['message'] ?? ''),         0, 200);
        if (!$session || !$message) json_out(['error' => 'missing data'], 400);

        db()->prepare("
            INSERT INTO chat_messages (session_id, name, message)
            VALUES (?, ?, ?)
        ")->execute([$session, $name, $message]);

        json_out(['ok' => true]);
    }

    // ── LEAVE ──────────────────────────────────────────────
    if ($action === 'leave') {
        $session = trim($_GET['session'] ?? '');
        if ($session) {
            db()->prepare("DELETE FROM players WHERE session_id = ?")->execute([$session]);
        }
        json_out(['ok' => true]);
    }

    // ── STATUS (debug) ─────────────────────────────────────
    if ($action === 'status') {
        $online = (int) db()->query("SELECT COUNT(*) FROM players")->fetchColumn();
        $players = db()->query("SELECT name, level, zone, last_seen FROM players ORDER BY last_seen DESC")->fetchAll();
        json_out(['online' => $online, 'players' => $players]);
    }

    json_out(['error' => 'unknown action'], 400);

} catch (PDOException $e) {
    json_out(['error' => 'DB error: ' . $e->getMessage()], 500);
} catch (Throwable $e) {
    json_out(['error' => $e->getMessage()], 500);
}
