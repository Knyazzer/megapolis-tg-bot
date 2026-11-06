import { setTimeout as delay } from 'node:timers/promises';

export async function runWorkerLoop({ runOnce, intervalMs, logger, wait = waitForNextPass, signal }) {
  while (!signal?.aborted) {
    // The first pass must be recoverable too: a temporary database outage at
    // startup should not terminate a worker that is meant to keep retrying.
    try {
      await runOnce();
    } catch (error) {
      logger.error('worker pass failed', { message: error.message, stack: error.stack });
    }

    if (signal?.aborted) {
      return;
    }
    try {
      await wait(intervalMs, signal);
    } catch (error) {
      if (signal?.aborted && error.name === 'AbortError') {
        return;
      }
      throw error;
    }
  }
}

function waitForNextPass(intervalMs, signal) {
  return delay(intervalMs, undefined, { signal });
}
