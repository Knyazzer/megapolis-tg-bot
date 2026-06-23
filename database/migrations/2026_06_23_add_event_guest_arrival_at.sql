SET @schema_name = DATABASE();

SET @add_guest_arrival_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN guest_arrival_at DATETIME NULL AFTER date_end',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'guest_arrival_at'
);
PREPARE stmt FROM @add_guest_arrival_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
