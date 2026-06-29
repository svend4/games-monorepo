-- NEXUS WORLD — Database Setup
-- Запустить в phpMyAdmin или через MySQL консоль

CREATE DATABASE IF NOT EXISTS nexus_world
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nexus_world;

-- Таблица онлайн-игроков (автоочистка через PHP каждые 30 сек)
CREATE TABLE IF NOT EXISTS players (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)  NOT NULL,
  name        VARCHAR(50)  NOT NULL DEFAULT 'Wanderer',
  x           FLOAT        NOT NULL DEFAULT 1920,
  y           FLOAT        NOT NULL DEFAULT 1920,
  hp          INT          NOT NULL DEFAULT 100,
  max_hp      INT          NOT NULL DEFAULT 100,
  level       INT          NOT NULL DEFAULT 1,
  zone        VARCHAR(100) NOT NULL DEFAULT '',
  last_seen   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY  uk_session   (session_id),
  INDEX       idx_seen     (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Таблица чата (опционально)
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64)  NOT NULL,
  name       VARCHAR(50)  NOT NULL,
  message    VARCHAR(200) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'nexus_world database ready!' AS status;
