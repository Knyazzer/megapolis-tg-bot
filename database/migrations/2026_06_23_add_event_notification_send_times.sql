SET @schema_name = DATABASE();

SET @add_offline_1day_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN offline_1day_send_at DATETIME NULL AFTER postpromo_send_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'offline_1day_send_at'
);
PREPARE stmt FROM @add_offline_1day_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_offline_2hours_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN offline_2hours_send_at DATETIME NULL AFTER offline_1day_send_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'offline_2hours_send_at'
);
PREPARE stmt FROM @add_offline_2hours_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_offline_started_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN offline_started_send_at DATETIME NULL AFTER offline_2hours_send_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'offline_started_send_at'
);
PREPARE stmt FROM @add_offline_started_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_online_15min_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN online_15min_send_at DATETIME NULL AFTER offline_started_send_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'online_15min_send_at'
);
PREPARE stmt FROM @add_online_15min_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_online_started_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN online_started_send_at DATETIME NULL AFTER online_15min_send_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'online_started_send_at'
);
PREPARE stmt FROM @add_online_started_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
