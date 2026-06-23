import { processDueMessages } from './jobs/message-worker.js';
import { db } from './db/mysql.js';
import { logger } from './utils/logger.js';

const loop = process.argv.includes('--loop');
const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 60_000);

async function runOnce() {
  const result = await processDueMessages();
  logger.info('worker pass complete', result);
}

async function runLoop() {
  await runOnce();
  setInterval(() => {
    runOnce().catch((error) => {
      logger.error('worker pass failed', { message: error.message, stack: error.stack });
    });
  }, intervalMs);
}

try {
  if (loop) {
    await runLoop();
  } else {
    await runOnce();
    await closeDb();
  }
} catch (error) {
  logger.error('worker failed', { message: error.message, stack: error.stack });
  await closeDb();
  process.exitCode = 1;
}

async function closeDb() {
  const database = db();
  if (typeof database.end === 'function') {
    await database.end();
  } else if (typeof database.close === 'function') {
    database.close();
  }
}
