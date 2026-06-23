SET @schema_name = DATABASE();

SET @add_postpromo_message = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN postpromo_message TEXT NULL AFTER photo_album_url',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'postpromo_message'
);
PREPARE stmt FROM @add_postpromo_message;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_postpromo_send_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE events ADD COLUMN postpromo_send_at DATETIME NULL AFTER postpromo_message',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'postpromo_send_at'
);
PREPARE stmt FROM @add_postpromo_send_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
