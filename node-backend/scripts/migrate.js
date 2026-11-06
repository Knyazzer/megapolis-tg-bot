import { migrateMysqlSchema } from '../src/db/schema-checks.js';
import { closeDb } from '../src/db/mysql.js';

try {
  await migrateMysqlSchema();
  console.log('Migrations completed');
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await closeDb();
  } catch (error) {
    console.error(`Migration cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
