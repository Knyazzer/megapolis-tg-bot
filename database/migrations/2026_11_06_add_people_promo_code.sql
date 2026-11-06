-- Optional promo code supplied during registration. Values are saved as entered.
SET @people_promo_code_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people'
    AND COLUMN_NAME = 'promo_code'
);

SET @people_promo_code_sql = IF(
  @people_promo_code_exists = 0,
  'ALTER TABLE people ADD COLUMN promo_code VARCHAR(128) NULL AFTER email',
  'SELECT 1'
);

PREPARE people_promo_code_stmt FROM @people_promo_code_sql;
EXECUTE people_promo_code_stmt;
DEALLOCATE PREPARE people_promo_code_stmt;
