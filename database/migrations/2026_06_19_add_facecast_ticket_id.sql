SET @facecast_ticket_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'registrations'
    AND COLUMN_NAME = 'facecast_ticket_id'
);

SET @facecast_ticket_id_sql := IF(
  @facecast_ticket_id_exists = 0,
  'ALTER TABLE registrations ADD COLUMN facecast_ticket_id VARCHAR(255) NULL AFTER facecast_password',
  'SELECT 1'
);

PREPARE facecast_ticket_id_stmt FROM @facecast_ticket_id_sql;
EXECUTE facecast_ticket_id_stmt;
DEALLOCATE PREPARE facecast_ticket_id_stmt;
