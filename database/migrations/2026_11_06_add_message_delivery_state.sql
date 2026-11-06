-- Durable retries, exclusive delivery leases and multipart progress.
-- Safe to apply again to an existing database.

CREATE TABLE IF NOT EXISTS message_queue_control (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  paused_until DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_messages' AND COLUMN_NAME = 'attempt_count'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE scheduled_messages ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_messages' AND COLUMN_NAME = 'next_attempt_at'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE scheduled_messages ADD COLUMN next_attempt_at DATETIME NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_messages' AND COLUMN_NAME = 'lock_token'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE scheduled_messages ADD COLUMN lock_token VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_messages' AND COLUMN_NAME = 'locked_until'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE scheduled_messages ADD COLUMN locked_until DATETIME NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_messages' AND COLUMN_NAME = 'delivery_step'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE scheduled_messages ADD COLUMN delivery_step INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'broadcast_messages' AND COLUMN_NAME = 'attempt_count'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE broadcast_messages ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'broadcast_messages' AND COLUMN_NAME = 'next_attempt_at'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE broadcast_messages ADD COLUMN next_attempt_at DATETIME NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'broadcast_messages' AND COLUMN_NAME = 'lock_token'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE broadcast_messages ADD COLUMN lock_token VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'broadcast_messages' AND COLUMN_NAME = 'locked_until'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE broadcast_messages ADD COLUMN locked_until DATETIME NULL',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'broadcast_messages' AND COLUMN_NAME = 'delivery_step'
);
SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE broadcast_messages ADD COLUMN delivery_step INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE message_delivery_stmt FROM @migration_sql;
EXECUTE message_delivery_stmt;
DEALLOCATE PREPARE message_delivery_stmt;
