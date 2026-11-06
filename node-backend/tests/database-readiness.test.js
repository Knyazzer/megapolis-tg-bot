import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseReadiness } from '../src/db/readiness.js';

function fixture(options = {}) {
  const state = { time: 0, up: true, schema: { ok: true, driver: 'test' }, pings: 0, diagnoses: 0 };
  const check = createDatabaseReadiness({
    ping: async () => { state.pings += 1; return state.up; },
    diagnose: async () => { state.diagnoses += 1; return state.schema; },
    now: () => state.time,
    ...options,
  });
  return { state, check };
}

test('readiness caches a complete result briefly, then pings again while retaining a successful schema', async () => {
  const { state, check } = fixture();
  assert.deepEqual(await check(), { ok: true, db: { ok: true }, schema: state.schema });
  state.time = 999;
  assert.equal((await check()).ok, true);
  assert.equal(state.pings, 1);
  assert.equal(state.diagnoses, 1);

  state.time = 1000;
  assert.equal((await check()).ok, true);
  assert.equal(state.pings, 2);
  assert.equal(state.diagnoses, 1);

  state.time = 30_000;
  assert.equal((await check()).ok, true);
  assert.equal(state.pings, 3);
  assert.equal(state.diagnoses, 2);
});

test('forceSchema bypasses both caches and refreshes the schema lifetime', async () => {
  const { state, check } = fixture();
  await check();
  state.time = 50;
  assert.equal((await check({ forceSchema: true })).ok, true);
  assert.equal(state.pings, 2);
  assert.equal(state.diagnoses, 2);
  state.time = 30_000;
  assert.equal((await check()).ok, true);
  assert.equal(state.diagnoses, 2, 'a forced successful diagnosis refreshes schema expiry');
  state.time = 31_000;
  assert.equal((await check()).ok, true);
  assert.equal(state.diagnoses, 3);
});

test('DB failure returns unavailable and invalidates the successful schema cache for recovery', async () => {
  const { state, check } = fixture();
  await check();
  state.up = false;
  state.time = 1000;
  assert.deepEqual(await check(), {
    ok: false,
    db: { ok: false, error: 'Database ping failed' },
    error: 'database_unavailable',
  });
  assert.equal(state.diagnoses, 1, 'a failed ping must not invoke schema queries');

  state.up = true;
  state.time = 2000;
  assert.equal((await check()).ok, true);
  assert.equal(state.pings, 3);
  assert.equal(state.diagnoses, 2, 'recovery must inspect schema instead of trusting the former cache');
});

test('ping exceptions become readiness results without leaking an exception or stack', async () => {
  let diagnoses = 0;
  const check = createDatabaseReadiness({
    ping: async () => { throw new Error('Connection refused'); },
    diagnose: async () => { diagnoses += 1; return { ok: true }; },
  });
  assert.deepEqual(await check(), {
    ok: false,
    db: { ok: false, error: 'Connection refused' },
    error: 'database_unavailable',
  });
  assert.equal(diagnoses, 0);
});

test('diagnostic exceptions identify schema unavailability and recover without restart', async () => {
  let time = 0;
  let diagnoseFails = false;
  let diagnoses = 0;
  const check = createDatabaseReadiness({
    ping: async () => true,
    diagnose: async () => {
      diagnoses += 1;
      if (diagnoseFails) throw new Error('Metadata query failed');
      return { ok: true };
    },
    now: () => time,
  });
  await check();
  diagnoseFails = true;
  assert.deepEqual(await check({ forceSchema: true }), {
    ok: false,
    db: { ok: true },
    schema: { ok: false, error: 'Metadata query failed' },
    error: 'schema_unavailable',
  });
  diagnoseFails = false;
  time = 1000;
  assert.equal((await check()).ok, true);
  assert.equal(diagnoses, 3);
});

test('schema mismatch does not stay cached beyond one second after a repair', async () => {
  const { state, check } = fixture({ resultTtlMs: 5000 });
  state.schema = { ok: false, missing_columns: ['broadcast_messages.delivery_step'] };
  assert.deepEqual(await check(), {
    ok: false, db: { ok: true }, schema: state.schema, error: 'schema_mismatch',
  });
  state.schema = { ok: true, missing_columns: [] };
  state.time = 999;
  assert.equal((await check()).ok, false);
  assert.equal(state.diagnoses, 1);
  state.time = 1000;
  assert.equal((await check()).ok, true);
  assert.equal(state.diagnoses, 2);
});

test('concurrent checks collapse into one inspection including forced requests', async () => {
  let releasePing;
  let pings = 0;
  let diagnoses = 0;
  const pingGate = new Promise((resolve) => { releasePing = resolve; });
  const check = createDatabaseReadiness({
    ping: async () => { pings += 1; await pingGate; return true; },
    diagnose: async () => { diagnoses += 1; return { ok: true }; },
  });
  const pending = [check(), check(), check({ forceSchema: true })];
  assert.equal(pings, 1);
  releasePing();
  const results = await Promise.all(pending);
  assert.ok(results.every((result) => result.ok));
  assert.equal(pings, 1);
  assert.equal(diagnoses, 1);
});

test('zero TTL permits immediate dependency rechecks', async () => {
  const { state, check } = fixture({ resultTtlMs: 0, schemaTtlMs: 0 });
  await check();
  await check();
  assert.equal(state.pings, 2);
  assert.equal(state.diagnoses, 2);
});
