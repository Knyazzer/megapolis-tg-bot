import { migrateMysqlSchema } from '../src/db/schema-checks.js';

async function main() {
  await migrateMysqlSchema();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
