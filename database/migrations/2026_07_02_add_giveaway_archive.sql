SET @giveaways_archived_at_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'giveaways'
    AND COLUMN_NAME = 'archived_at'
);

SET @giveaways_archived_at_sql = IF(
  @giveaways_archived_at_exists = 0,
  'ALTER TABLE giveaways ADD COLUMN archived_at DATETIME NULL AFTER is_active',
  'SELECT 1'
);

PREPARE giveaways_archived_at_stmt FROM @giveaways_archived_at_sql;
EXECUTE giveaways_archived_at_stmt;
DEALLOCATE PREPARE giveaways_archived_at_stmt;

SET @giveaways_archived_idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'giveaways'
    AND INDEX_NAME = 'idx_giveaways_archived'
);

SET @giveaways_archived_idx_sql = IF(
  @giveaways_archived_idx_exists = 0,
  'CREATE INDEX idx_giveaways_archived ON giveaways (archived_at, is_active)',
  'SELECT 1'
);

PREPARE giveaways_archived_idx_stmt FROM @giveaways_archived_idx_sql;
EXECUTE giveaways_archived_idx_stmt;
DEALLOCATE PREPARE giveaways_archived_idx_stmt;
