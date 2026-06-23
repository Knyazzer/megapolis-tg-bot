SET @schema_name = DATABASE();

SET @add_chat_read_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE people ADD COLUMN chat_read_at DATETIME NULL AFTER chat_mode_updated_at',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'people'
    AND COLUMN_NAME = 'chat_read_at'
);
PREPARE stmt FROM @add_chat_read_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE people SET chat_read_at = NOW() WHERE chat_read_at IS NULL;
