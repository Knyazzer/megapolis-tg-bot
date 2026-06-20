SET @schema_name = DATABASE();

SET @add_media_blob = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE broadcast_campaigns ADD COLUMN media_blob MEDIUMBLOB NULL AFTER media_file_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'broadcast_campaigns'
    AND COLUMN_NAME = 'media_blob'
);
PREPARE stmt FROM @add_media_blob;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_media_mime = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE broadcast_campaigns ADD COLUMN media_mime VARCHAR(100) NULL AFTER media_blob',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'broadcast_campaigns'
    AND COLUMN_NAME = 'media_mime'
);
PREPARE stmt FROM @add_media_mime;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_media_name = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE broadcast_campaigns ADD COLUMN media_name VARCHAR(255) NULL AFTER media_mime',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'broadcast_campaigns'
    AND COLUMN_NAME = 'media_name'
);
PREPARE stmt FROM @add_media_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_media_size = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE broadcast_campaigns ADD COLUMN media_size INT UNSIGNED NULL AFTER media_name',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'broadcast_campaigns'
    AND COLUMN_NAME = 'media_size'
);
PREPARE stmt FROM @add_media_size;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
