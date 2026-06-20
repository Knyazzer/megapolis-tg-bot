SET @schema_name = DATABASE();

SET @add_chat_mode = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE people ADD COLUMN chat_mode VARCHAR(20) NOT NULL DEFAULT ''bot'' AFTER state_payload',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'people'
    AND COLUMN_NAME = 'chat_mode'
);
PREPARE stmt FROM @add_chat_mode;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_chat_mode_updated_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE people ADD COLUMN chat_mode_updated_at DATETIME NULL AFTER chat_mode',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'people'
    AND COLUMN_NAME = 'chat_mode_updated_at'
);
PREPARE stmt FROM @add_chat_mode_updated_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE people SET chat_mode = 'bot' WHERE chat_mode IS NULL OR chat_mode = '';
