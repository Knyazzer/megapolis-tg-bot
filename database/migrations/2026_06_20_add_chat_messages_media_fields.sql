SET @schema_name = DATABASE();

SET @add_media_file_id = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE chat_messages ADD COLUMN media_file_id VARCHAR(500) NULL AFTER text',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'chat_messages'
    AND COLUMN_NAME = 'media_file_id'
);
PREPARE stmt FROM @add_media_file_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_media_name = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE chat_messages ADD COLUMN media_name VARCHAR(255) NULL AFTER media_file_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'chat_messages'
    AND COLUMN_NAME = 'media_name'
);
PREPARE stmt FROM @add_media_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_media_mime = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE chat_messages ADD COLUMN media_mime VARCHAR(100) NULL AFTER media_name',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'chat_messages'
    AND COLUMN_NAME = 'media_mime'
);
PREPARE stmt FROM @add_media_mime;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
