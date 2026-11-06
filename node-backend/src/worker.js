import { processDueMessages } from './jobs/message-worker.js';
import { closeDb } from './db/mysql.js';
import { checkDatabaseReadiness } from './db/readiness.js';
import { runWorkerLoop } from './jobs/worker-loop.js';
import { logger } from './utils/logger.js';

const loop = process.argv.includes('--loop');
const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 60_000);

async function runOnce() {
  const readiness = await checkDatabaseReadiness();
  if (!readiness.ok) {
    logger.warn('worker waiting for database schema', readiness);
    return false;
  }
  const result = await processDueMessages();
  logger.info('worker pass complete', result);
  return true;
}

try {
  if (loop) {
    await runWorkerLoop({ runOnce, intervalMs, logger });
  } else {
    if (!(await runOnce())) process.exitCode = 1;
  }
} catch (error) {
  logger.error('worker failed', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  try {
    await closeDb();
  } catch (error) {
    logger.error('worker database close failed', { message: error.message });
    process.exitCode = 1;
  }
}
