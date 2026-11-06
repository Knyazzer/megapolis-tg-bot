import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(backendDir, '../database/schema.sql');
const mysqlPort = process.env.STARTUP_TEST_MYSQL_PORT;
if (mysqlPort && !/^\d+$/.test(mysqlPort)) throw new Error('Invalid local MySQL test port');
const adminPassword = 'startup-test-password';
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '0',
  APP_URL: 'http://127.0.0.1',
  APP_TIMEZONE: 'Europe/Moscow',
  DB_CONNECTION: 'mysql',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1', // Refused local connection; never use the project's .env database.
  DB_DATABASE: 'megapolis_startup_test',
  DB_USERNAME: 'root',
  DB_PASSWORD: 'startup-test-only',
  ADMIN_LOGIN: 'startup-test-admin',
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(adminPassword, 4),
  TELEGRAM_WEBHOOK_SECRET: 'startup-test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'startup-test-token',
  TELEGRAM_DRY_RUN: 'true',
  FACECAST_DEMO_MODE: 'true',
  WORKER_INTERVAL_MS: '30',
};

function launchNpm(script, env = {}) {
  const child = spawn('npm', ['run', script, '--silent'], {
    cwd: backendDir,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  child.stdout.on('data', (data) => { output = `${output}${data}`.slice(-16384); });
  child.stderr.on('data', (data) => { output = `${output}${data}`.slice(-16384); });
  const finished = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  return { child, finished, get output() { return output; } };
}

async function stop(process) {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  try {
    if (globalThis.process.platform === 'win32') process.child.kill('SIGTERM');
    else globalThis.process.kill(-process.child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await Promise.race([process.finished, delay(2000, null, { ref: false })]);
  if (process.child.exitCode === null && process.child.signalCode === null) {
    try {
      if (globalThis.process.platform === 'win32') process.child.kill('SIGKILL');
      else globalThis.process.kill(-process.child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await process.finished;
  }
}

async function until(process, predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate(process.output);
    if (value) return value;
    assert.equal(process.child.exitCode, null, `${label}: process exited\n${process.output}`);
    assert.equal(process.child.signalCode, null, `${label}: process stopped\n${process.output}`);
    await delay(20);
  }
  assert.fail(`${label}: timed out\n${process.output}`);
}

async function startServer(t, env = {}) {
  const process = launchNpm('start', env);
  t.after(() => stop(process));
  const port = await until(process, (output) => output.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1], 'HTTP listener');
  assert.notEqual(port, '0', 'the server must report its actual ephemeral port');
  return { ...process, process, url: `http://127.0.0.1:${port}` };
}

async function request(server, path, options) {
  return fetch(`${server.url}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
}

async function runMigration(t, env = {}) {
  const process = launchNpm('migrate', env);
  t.after(() => stop(process));
  const outcome = await Promise.race([
    process.finished,
    delay(8000, null, { ref: false }).then(() => { throw new Error(`Migration timed out\n${process.output}`); }),
  ]);
  return { ...outcome, output: process.output };
}

test('start and worker commands do not implicitly run migrations', async () => {
  const pkg = JSON.parse(await readFile(resolve(backendDir, 'package.json'), 'utf8'));
  for (const script of ['start', 'worker', 'worker:loop']) {
    assert.doesNotMatch(pkg.scripts[script], /migrat/i, `${script} must not depend on DDL`);
  }
  assert.match(pkg.scripts.migrate, /scripts\/migrate\.js/);
});

test('npm start stays alive with DB down; migration failure does not stop public HTTP routes', { timeout: 20000 }, async (t) => {
  const server = await startServer(t);
  const pid = server.child.pid;
  assert.equal((await request(server, '/live')).status, 200);
  assert.equal((await request(server, '/privacy')).status, 200);
  assert.equal((await request(server, '/assets/admin.css')).status, 200);
  const login = await request(server, '/');
  assert.equal(login.status, 200);
  assert.match(await login.text(), /name="password"/);
  const sessionCookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(sessionCookie);

  const health = await request(server, '/health');
  assert.equal(health.status, 503);
  const readiness = await health.json();
  assert.equal(readiness.ok, false);
  assert.equal(readiness.db.ok, false);

  const badSecret = await request(server, '/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'incorrect' },
    body: JSON.stringify({ update_id: 1 }),
  });
  assert.equal(badSecret.status, 403, 'webhook authentication must run before DB readiness');
  const validUpdate = await request(server, '/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': baseEnv.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: 2, message: { from: { id: 100 }, chat: { id: 100 }, text: '/start' } }),
  });
  assert.equal(validUpdate.status, 503, 'unprocessed Telegram updates must not be acknowledged');

  const signedIn = await request(server, '/', {
    method: 'POST', redirect: 'manual',
    headers: { cookie: sessionCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'login', login: baseEnv.ADMIN_LOGIN, password: adminPassword }),
  });
  assert.equal(signedIn.status, 302, 'login itself must remain usable with DB down');
  const business = await request(server, '/?page=registrations', { headers: { cookie: sessionCookie } });
  assert.equal(business.status, 503, 'DB-dependent admin pages must return unavailable, not an internal error');

  const migration = await runMigration(t);
  assert.equal(migration.code, 1);
  assert.match(migration.output, /Migration failed/i);
  assert.equal(server.child.pid, pid);
  assert.equal(server.child.exitCode, null);
  assert.equal((await request(server, '/live')).status, 200);
  assert.equal((await request(server, '/health')).status, 503);
});

test('worker loop survives its first unavailable DB pass while one-shot worker reports failure', { timeout: 15000 }, async (t) => {
  const loop = launchNpm('worker:loop');
  t.after(() => stop(loop));
  await until(loop, (output) => (output.match(/worker waiting for database schema|worker pass failed/g) || []).length >= 2, 'repeated unavailable worker passes');
  assert.equal(loop.child.exitCode, null);
  assert.doesNotMatch(loop.output, /Migration failed/i);
  const oneShot = launchNpm('worker');
  t.after(() => stop(oneShot));
  const result = await Promise.race([
    oneShot.finished,
    delay(8000, null, { ref: false }).then(() => { throw new Error(`One-shot worker timed out\n${oneShot.output}`); }),
  ]);
  assert.equal(result.code, 1);
  assert.doesNotMatch(oneShot.output, /Migration failed/i);
});

test('explicit migrations recover schema readiness in the same HTTP process', { skip: !mysqlPort, timeout: 30000 }, async (t) => {
  // This database is created from base schema by the integration-test setup only.
  const env = { DB_PORT: mysqlPort };
  const connection = await mysql.createConnection({
    host: '127.0.0.1', port: Number(mysqlPort), user: 'root', password: 'startup-test-only',
    database: 'megapolis_startup_test', multipleStatements: true,
  });
  t.after(() => connection.end());
  // Keep the optional integration test repeatable on this disposable database.
  await connection.query('DROP TABLE IF EXISTS message_queue_control');
  const server = await startServer(t, env);
  const pid = server.child.pid;
  const before = await request(server, '/health?schema=1');
  assert.equal(before.status, 503);
  const [queueTables] = await connection.query(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'message_queue_control'",
  );
  assert.equal(Number(queueTables[0].total), 0, 'starting the app must not create schema');
  const migration = await runMigration(t, env);
  assert.equal(migration.code, 0, migration.output);
  assert.equal((await request(server, '/health?schema=1')).status, 200);
  assert.equal(server.child.pid, pid);

  // A genuinely failing DDL operation must leave HTTP alive and readiness false.
  const baseSchema = await readFile(schemaPath, 'utf8');
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await connection.query('DROP TABLE events');
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  }
  try {
    const failed = await runMigration(t, env);
    assert.equal(failed.code, 1, failed.output);
    assert.equal((await request(server, '/live')).status, 200);
    assert.equal((await request(server, '/health?schema=1')).status, 503);
    assert.equal(server.child.exitCode, null);
    assert.equal(server.child.pid, pid);
  } finally {
    await connection.query(baseSchema);
  }
  const restored = await runMigration(t, env);
  assert.equal(restored.code, 0, restored.output);
  assert.equal((await request(server, '/health?schema=1')).status, 200);
  assert.equal(server.child.pid, pid);
});
