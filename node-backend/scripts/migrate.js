import { execute, isSqlite, queryOne } from '../src/db/mysql.js';

async function main() {
  if (isSqlite()) {
    return;
  }

  const row = await queryOne(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'registrations'
       AND COLUMN_NAME = 'facecast_ticket_id'`,
  );

  if (Number(row?.total || 0) === 0) {
    await execute('ALTER TABLE registrations ADD COLUMN facecast_ticket_id VARCHAR(255) NULL AFTER facecast_password');
    console.log('Applied migration: add registrations.facecast_ticket_id');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
