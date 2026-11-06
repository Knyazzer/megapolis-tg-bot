import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWorkerLoop } from '../src/jobs/worker-loop.js';

test('the first failed worker pass is logged and retried after the configured interval', async () => {
  const controller = new AbortController();
  const errors = [];
  const waits = [];
  let passes = 0;
  await runWorkerLoop({
    intervalMs: 1234,
    signal: controller.signal,
    logger: { error: (...args) => errors.push(args) },
    wait: async (ms) => waits.push(ms),
    runOnce: async () => {
      passes += 1;
      if (passes === 1) throw new Error('database unavailable');
      controller.abort();
    },
  });
  assert.equal(passes, 2);
  assert.deepEqual(waits, [1234]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'worker pass failed');
  assert.equal(errors[0][1].message, 'database unavailable');
});

test('passes cannot overlap and every interval starts after completion', async () => {
  const controller = new AbortController();
  const events = [];
  let finishPass;
  let finishWait;
  let passes = 0;
  const loop = runWorkerLoop({
    intervalMs: 42,
    signal: controller.signal,
    logger: { error() { assert.fail('unexpected worker error'); } },
    wait: async (ms) => {
      events.push(`wait:${ms}`);
      await new Promise((resolve) => { finishWait = resolve; });
    },
    runOnce: async () => {
      const current = ++passes;
      events.push(`start:${current}`);
      if (current === 1) {
        await new Promise((resolve) => { finishPass = resolve; });
      } else {
        controller.abort();
      }
      events.push(`end:${current}`);
    },
  });
  assert.deepEqual(events, ['start:1']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:1']);
  finishPass();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:1', 'end:1', 'wait:42']);
  assert.equal(passes, 1);
  finishWait();
  await loop;
  assert.deepEqual(events, ['start:1', 'end:1', 'wait:42', 'start:2', 'end:2']);
});

test('an unready pass does not terminate the loop and later failures also recover', async () => {
  const controller = new AbortController();
  let passes = 0;
  let waits = 0;
  let errors = 0;
  await runWorkerLoop({
    intervalMs: 10,
    signal: controller.signal,
    logger: { error() { errors += 1; } },
    wait: async () => { waits += 1; },
    runOnce: async () => {
      passes += 1;
      if (passes === 1) return false;
      if (passes === 2) throw new Error('temporary failure');
      controller.abort();
      return true;
    },
  });
  assert.equal(passes, 3);
  assert.equal(waits, 2);
  assert.equal(errors, 1);
});

test('a stop signal interrupts the default wait without starting another pass', async () => {
  const controller = new AbortController();
  let passes = 0;
  const loop = runWorkerLoop({
    intervalMs: 60_000,
    signal: controller.signal,
    logger: { error() { assert.fail('unexpected worker error'); } },
    runOnce: async () => { passes += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await loop;
  assert.equal(passes, 1);
});
