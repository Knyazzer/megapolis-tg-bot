import { execute, isSqlite, queryOne } from '../src/db/mysql.js';

async function main() {
  if (isSqlite()) {
    return;
  }

  await ensureColumn(
    'registrations',
    'archived_at',
    'ALTER TABLE registrations ADD COLUMN archived_at DATETIME NULL AFTER approved_at',
  );
  await ensureIndex(
    'registrations',
    'idx_registrations_archived',
    'CREATE INDEX idx_registrations_archived ON registrations (archived_at)',
  );
  await ensureColumn(
    'registrations',
    'facecast_ticket_id',
    'ALTER TABLE registrations ADD COLUMN facecast_ticket_id VARCHAR(255) NULL AFTER facecast_password',
  );
  await ensureBroadcastPhotoType();
}

async function ensureColumn(table, column, sql) {
  const exists = await queryOne(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column`,
    { table, column },
  );

  if (Number(exists?.total || 0) === 0) {
    try {
      await execute(sql);
      console.log(`Applied migration: add ${table}.${column}`);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') {
        throw error;
      }
    }
  }
}

async function ensureIndex(table, indexName, sql) {
  const exists = await queryOne(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND INDEX_NAME = :indexName`,
    { table, indexName },
  );

  if (Number(exists?.total || 0) === 0) {
    try {
      await execute(sql);
      console.log(`Applied migration: add ${table}.${indexName}`);
    } catch (error) {
      if (error?.code !== 'ER_DUP_KEYNAME') {
        throw error;
      }
    }
  }
}

async function ensureBroadcastPhotoType() {
  const row = await queryOne(
    `SELECT COLUMN_TYPE AS columnType
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'broadcast_campaigns'
       AND COLUMN_NAME = 'content_type'
     LIMIT 1`,
  );

  if (row?.columnType && !String(row.columnType).includes("'photo'")) {
    await execute("ALTER TABLE broadcast_campaigns MODIFY content_type ENUM('text','video_note','photo') NOT NULL DEFAULT 'text'");
    console.log('Applied migration: allow broadcast_campaigns.content_type photo');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
