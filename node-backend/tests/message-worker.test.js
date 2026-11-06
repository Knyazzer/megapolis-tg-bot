import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

// Isolate the queue from the configured database and use a fake Telegram client.
// Optional MySQL coverage uses only the local disposable test database.
const mysqlPort = process.env.MESSAGE_QUEUE_TEST_MYSQL_PORT;
if (mysqlPort && !/^\d+$/.test(mysqlPort)) throw new Error('Invalid local MySQL test port');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_CONNECTION: mysqlPort ? 'mysql' : 'sqlite',
  DB_DATABASE: mysqlPort ? 'megapolis_queue_test' : ':memory:',
  DB_HOST: '127.0.0.1',
  DB_PORT: mysqlPort || '3306',
  DB_USERNAME: 'root',
  DB_PASSWORD: 'queue-test-only',
  TELEGRAM_DRY_RUN: 'true',
  TELEGRAM_BOT_TOKEN: 'test-token',
  FACECAST_DEMO_MODE: 'true',
  APP_TIMEZONE: 'Europe/Moscow',
});

const { db, query, queryOne } = await import('../src/db/mysql.js');
const { processDueMessages } = await import('../src/jobs/message-worker.js');
const { TelegramApiError, TelegramTransportError, splitTelegramText } = await import('../src/services/telegram-client.js');
const { AdminController } = await import('../src/admin/admin-controller.js');
const { ReminderPlanner } = await import('../src/services/reminder-planner.js');
const { nowSql, parseDate } = await import('../src/utils/dates.js');
const PAST = '2000-01-01 00:00:00';
const FUTURE = '2099-01-01 00:00:00';
let telegramId = 1000;

beforeEach(async () => {
  await query('DELETE FROM message_queue_control');
  await query('DELETE FROM broadcast_campaigns');
  await query('DELETE FROM scheduled_messages');
  await query('DELETE FROM registrations');
  await query('DELETE FROM people');
  if (!(await queryOne('SELECT id FROM events LIMIT 1'))) {
    await query(
      `INSERT INTO events (title, slug, date_start, date_end, created_at, updated_at)
       VALUES (:title, :slug, :eventDate, :eventDate, :now, :now)`,
      { title: 'Queue Test Event', slug: 'queue-test-event', eventDate: FUTURE, now: nowSql() },
    );
  }
});

after(async () => {
  if (mysqlPort) await db().end();
});

async function person() {
  const recipientTelegramId = ++telegramId;
  const result = await query(
    'INSERT INTO people (telegram_id, full_name, created_at, updated_at) VALUES (:telegramId, :name, :now, :now)',
    { telegramId: recipientTelegramId, name: 'Queue Test', now: nowSql() },
  );
  return { id: result.insertId, telegramId: recipientTelegramId };
}

async function broadcast({ contentType = 'text', body = 'Test broadcast', recipients = 1 } = {}) {
  const result = await query(
    `INSERT INTO broadcast_campaigns
      (title, audience, content_type, body, media_file_id, status, created_at, updated_at)
     VALUES (:title, 'all', :contentType, :body, :media, 'queued', :now, :now)`,
    { title: 'Queue test', contentType, body, media: contentType === 'text' ? null : 'test-file-id', now: nowSql() },
  );
  const campaignId = result.insertId;
  const messages = [];
  for (let i = 0; i < recipients; i += 1) {
    const recipient = await person();
    const message = await query(
      `INSERT INTO broadcast_messages
        (campaign_id, person_id, telegram_id, status, created_at, updated_at)
       VALUES (:campaignId, :personId, :telegramId, 'queued', :now, :now)`,
      { campaignId, personId: recipient.id, telegramId: recipient.telegramId, now: nowSql() },
    );
    messages.push({ id: message.insertId, personId: recipient.id, telegramId: recipient.telegramId });
  }
  return { campaignId, messages };
}

async function scheduled(type = 'offline_1day') {
  const recipient = await person();
  const event = await queryOne('SELECT id FROM events ORDER BY id LIMIT 1');
  const registration = await query(
    `INSERT INTO registrations
      (person_id, event_id, attendance, status, created_at, updated_at)
     VALUES (:personId, :eventId, 'offline', 'approved', :now, :now)`,
    { personId: recipient.id, eventId: event.id, now: nowSql() },
  );
  const result = await query(
    `INSERT INTO scheduled_messages
      (registration_id, person_id, event_id, type, send_at, created_at, updated_at)
     VALUES (:registrationId, :personId, :eventId, :type, :sendAt, :now, :now)`,
    { registrationId: registration.insertId, personId: recipient.id, eventId: event.id, type, sendAt: PAST, now: nowSql() },
  );
  return { id: result.insertId, telegramId: recipient.telegramId };
}

function fakeTelegram(handler = async () => {}) {
  const calls = [];
  const telegram = { calls };
  for (const method of ['sendMessage', 'sendPhoto', 'sendVideo', 'sendVideoNote']) {
    telegram[method] = async (...args) => {
      const call = { method, args };
      calls.push(call);
      await handler(call);
      return { ok: true, result: { message_id: calls.length } };
    };
  }
  return telegram;
}

function apiError(code, retryAfter = undefined) {
  return new TelegramApiError('sendMessage', code, {
    error_code: code,
    description: code === 429 ? 'Too Many Requests' : 'Test Telegram failure',
    parameters: retryAfter === undefined ? undefined : { retry_after: retryAfter },
  });
}

async function makeBroadcastDue(id) {
  await query('UPDATE message_queue_control SET paused_until = :past', { past: PAST });
  await query('UPDATE broadcast_messages SET next_attempt_at = :past WHERE id = :id', { id, past: PAST });
}

async function makeScheduledDue(id) {
  await query('UPDATE scheduled_messages SET next_attempt_at = :past WHERE id = :id', { id, past: PAST });
}

test('concurrent processors send a broadcast recipient only once', async () => {
  const { messages } = await broadcast();
  let release;
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const telegram = fakeTelegram(async () => { enter(); await gate; });
  const first = processDueMessages({ telegram });
  await entered;
  try {
    const second = await processDueMessages({ telegram });
    assert.equal(second.broadcasts.sent, 0);
    assert.equal(telegram.calls.length, 1);
  } finally {
    release();
  }
  assert.equal((await first).broadcasts.sent, 1);
  const row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'sent');
  assert.equal(row.lock_token, null);
});

test('concurrent processors send a scheduled reminder only once', async () => {
  await scheduled();
  let release;
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const telegram = fakeTelegram(async () => { enter(); await gate; });
  const first = processDueMessages({ telegram });
  await entered;
  try {
    assert.equal((await processDueMessages({ telegram })).scheduled.sent, 0);
    assert.equal(telegram.calls.length, 1);
  } finally {
    release();
  }
  assert.equal((await first).scheduled.sent, 1);
});

test('429 persists retry_after, prevents early retry and succeeds on a later pass', async () => {
  const { campaignId, messages } = await broadcast();
  let fail = true;
  const telegram = fakeTelegram(async () => { if (fail) throw apiError(429, 120); });
  const started = Date.now();
  const first = await processDueMessages({ telegram });
  assert.equal(first.broadcasts.retried, 1);
  assert.equal(first.broadcasts.failed, 0);
  let row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempt_count, 1);
  assert.equal(row.lock_token, null);
  assert.ok(parseDate(row.next_attempt_at).getTime() >= started + 119_000);
  assert.notEqual((await queryOne('SELECT status FROM broadcast_campaigns WHERE id = :id', { id: campaignId })).status, 'sent');
  fail = false;
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 1, 'retry date must be respected after the failed pass');
  await makeBroadcastDue(messages[0].id);
  assert.equal((await processDueMessages({ telegram })).broadcasts.sent, 1);
  row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'sent');
  assert.equal(row.attempt_count, 2);
  assert.equal(row.error, null);
  assert.equal((await queryOne('SELECT status FROM broadcast_campaigns WHERE id = :id', { id: campaignId })).status, 'sent');
});

test('503 and transport errors are deferred instead of becoming permanent failures', async () => {
  for (const error of [apiError(503), new TelegramTransportError('sendMessage', new Error('socket disconnected'))]) {
    const { messages } = await broadcast();
    const telegram = fakeTelegram(async () => { throw error; });
    const result = await processDueMessages({ telegram });
    assert.equal(result.broadcasts.retried, 1);
    assert.equal(result.broadcasts.failed, 0);
    const row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
    assert.equal(row.status, 'queued');
    assert.ok(parseDate(row.next_attempt_at).getTime() > Date.now());
    await query('DELETE FROM broadcast_campaigns');
  }
});

test('403 is a permanent failure and is not picked on the next pass', async () => {
  const { messages } = await broadcast();
  const telegram = fakeTelegram(async () => { throw apiError(403); });
  const first = await processDueMessages({ telegram });
  assert.equal(first.broadcasts.failed, 1);
  assert.equal(first.broadcasts.retried, 0);
  const row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'failed');
  assert.equal(row.lock_token, null);
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 1);
});

test('sixth failed attempt exhausts automatic retries', async () => {
  const { messages } = await broadcast();
  await query('UPDATE broadcast_messages SET attempt_count = 5 WHERE id = :id', messages[0]);
  const telegram = fakeTelegram(async () => { throw apiError(503); });
  const result = await processDueMessages({ telegram });
  assert.equal(result.broadcasts.failed, 1);
  assert.equal(result.broadcasts.retried, 0);
  const row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'failed');
  assert.equal(row.attempt_count, 6);
});

test('retry resumes after delivered media without sending the media again', async () => {
  const { messages } = await broadcast({ contentType: 'video_note', body: 'Text following the video' });
  let fail = true;
  const telegram = fakeTelegram(async ({ method }) => {
    if (method === 'sendMessage' && fail) throw apiError(503);
  });
  assert.equal((await processDueMessages({ telegram })).broadcasts.retried, 1);
  let row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.delivery_step, 1);
  fail = false;
  await makeBroadcastDue(messages[0].id);
  assert.equal((await processDueMessages({ telegram })).broadcasts.sent, 1);
  assert.deepEqual(telegram.calls.map((call) => call.method), ['sendVideoNote', 'sendMessage', 'sendMessage']);
  row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'sent');
});

test('retry resumes at the failed chunk of a long broadcast text', async () => {
  const body = `${'a'.repeat(3900)}${'b'.repeat(200)}`;
  const chunks = splitTelegramText(body);
  assert.equal(chunks.length, 2);
  const { messages } = await broadcast({ body });
  let fail = true;
  const telegram = fakeTelegram(async ({ args }) => {
    if (args[1] === chunks[1] && fail) throw apiError(429, 1);
  });
  assert.equal((await processDueMessages({ telegram })).broadcasts.retried, 1);
  assert.equal((await queryOne('SELECT delivery_step FROM broadcast_messages WHERE id = :id', messages[0])).delivery_step, 1);
  fail = false;
  await makeBroadcastDue(messages[0].id);
  assert.equal((await processDueMessages({ telegram })).broadcasts.sent, 1);
  assert.deepEqual(telegram.calls.map((call) => call.args[1]), [chunks[0], chunks[1], chunks[1]]);
});

test('a recipient cancelled after batch selection is skipped without overwriting cancellation', async () => {
  const { messages } = await broadcast({ recipients: 2 });
  const telegram = fakeTelegram(async ({ args }) => {
    if (args[0] === messages[0].telegramId) {
      await query("UPDATE broadcast_messages SET status = 'cancelled' WHERE id = :id", messages[1]);
    }
  });
  await processDueMessages({ telegram });
  assert.deepEqual(telegram.calls.map((call) => call.args[0]), [messages[0].telegramId]);
  assert.equal((await queryOne('SELECT status FROM broadcast_messages WHERE id = :id', messages[1])).status, 'cancelled');
});

test('cancellation during a send prevents the remaining chunks and keeps cancelled status', async () => {
  const { messages } = await broadcast({ body: 'a'.repeat(4100) });
  const telegram = fakeTelegram(async () => {
    await query("UPDATE broadcast_messages SET status = 'cancelled' WHERE id = :id", messages[0]);
  });
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 1);
  assert.equal((await queryOne('SELECT status FROM broadcast_messages WHERE id = :id', messages[0])).status, 'cancelled');
});

test('a flood pause also postpones other recipients and the scheduled queue', async () => {
  const { campaignId, messages } = await broadcast({ recipients: 2 });
  const reminder = await scheduled();
  const telegram = fakeTelegram(async () => { throw apiError(429, 120); });
  await processDueMessages({ telegram, broadcastCampaignId: campaignId });
  assert.equal(telegram.calls.length, 1, 'the remaining batch must respect the flood pause');
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 1, 'both queues must retain the flood pause between passes');
  const control = await queryOne('SELECT paused_until FROM message_queue_control');
  assert.ok(parseDate(control.paused_until).getTime() > Date.now());
  const untouchedBroadcast = await queryOne('SELECT attempt_count FROM broadcast_messages WHERE id = :id', messages[1]);
  const untouchedReminder = await queryOne('SELECT attempt_count FROM scheduled_messages WHERE id = :id', reminder);
  assert.equal(untouchedBroadcast.attempt_count, 0);
  assert.equal(untouchedReminder.attempt_count, 0);
});

test('new broadcasts and reminders cannot bypass a persisted Telegram flood pause', async () => {
  const original = await broadcast();
  const limited = fakeTelegram(async () => { throw apiError(429, 120); });
  await processDueMessages({ telegram: limited, broadcastCampaignId: original.campaignId });
  const addedBroadcast = await broadcast();
  const addedReminder = await scheduled();
  const telegram = fakeTelegram();
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 0, 'new queue rows must respect the persisted bot-wide pause');
  const broadcastRow = await queryOne('SELECT attempt_count FROM broadcast_messages WHERE id = :id', addedBroadcast.messages[0]);
  const reminderRow = await queryOne('SELECT attempt_count FROM scheduled_messages WHERE id = :id', addedReminder);
  assert.equal(broadcastRow.attempt_count, 0);
  assert.equal(reminderRow.attempt_count, 0);
  await query('UPDATE message_queue_control SET paused_until = :past', { past: PAST });
  const result = await processDueMessages({ telegram });
  assert.equal(result.broadcasts.sent, 1);
  assert.equal(result.scheduled.sent, 1);
  assert.equal(telegram.calls.length, 2);
});

test('active lease excludes another processor; expired lease is recovered', async () => {
  const { messages } = await broadcast();
  await query(
    'UPDATE broadcast_messages SET lock_token = :token, locked_until = :until WHERE id = :id',
    { id: messages[0].id, token: 'previous-worker', until: FUTURE },
  );
  const telegram = fakeTelegram();
  await processDueMessages({ telegram });
  assert.equal(telegram.calls.length, 0);
  await query('UPDATE broadcast_messages SET locked_until = :past WHERE id = :id', { id: messages[0].id, past: PAST });
  assert.equal((await processDueMessages({ telegram })).broadcasts.sent, 1);
  assert.equal(telegram.calls.length, 1);
});

test('temporary failures retry ordinary scheduled reminders as well as approval notices', async () => {
  const rows = await Promise.all([scheduled('offline_1day'), scheduled('offline_2hours'), scheduled('offline_approved')]);
  let fail = true;
  const telegram = fakeTelegram(async () => { if (fail) throw apiError(503); });
  const first = await processDueMessages({ telegram });
  assert.equal(first.scheduled.retried, 3);
  assert.equal(first.scheduled.failed, 0);
  for (const fixture of rows) {
    const row = await queryOne('SELECT * FROM scheduled_messages WHERE id = :id', fixture);
    assert.equal(row.failed_at, null);
    assert.equal(row.sent_at, null);
    assert.equal(row.attempt_count, 1);
    await makeScheduledDue(fixture.id);
  }
  fail = false;
  assert.equal((await processDueMessages({ telegram })).scheduled.sent, 3);
});

test('manual campaign retry resets failed attempts while preserving delivered media progress', async () => {
  const { campaignId, messages } = await broadcast({ contentType: 'video_note', body: 'Undelivered text' });
  await query(
    `UPDATE broadcast_messages SET status = 'failed', attempt_count = 6,
     delivery_step = 1, next_attempt_at = :future,
     lock_token = :token, locked_until = :future, error = :error WHERE id = :id`,
    { id: messages[0].id, future: FUTURE, token: 'obsolete-owner', error: 'Previous failure' },
  );
  await query("UPDATE broadcast_campaigns SET status = 'failed' WHERE id = :id", { id: campaignId });
  const admin = new AdminController({ session: {}, response: {} });
  await admin.retryBroadcastCampaign({ id: campaignId });
  const row = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', messages[0]);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempt_count, 0);
  assert.equal(row.next_attempt_at, null);
  assert.equal(row.lock_token, null);
  assert.equal(row.locked_until, null);
  assert.equal(row.error, null);
  assert.equal(row.delivery_step, 1);
  const telegram = fakeTelegram();
  assert.equal((await processDueMessages({ telegram })).broadcasts.sent, 1);
  assert.deepEqual(telegram.calls.map((call) => call.method), ['sendMessage']);
});

test('rescheduling a reminder resets delivery state and cancellation invalidates its lock', async () => {
  const fixture = await scheduled();
  const initial = await queryOne('SELECT * FROM scheduled_messages WHERE id = :id', fixture);
  const registration = await queryOne('SELECT * FROM registrations WHERE id = :id', { id: initial.registration_id });
  const event = await queryOne('SELECT * FROM events WHERE id = :id', { id: initial.event_id });
  await query(
    `UPDATE scheduled_messages SET attempt_count = 6, delivery_step = 2,
     next_attempt_at = :future, lock_token = :token, locked_until = :future,
     failed_at = :now, error = :error WHERE id = :id`,
    { id: fixture.id, future: FUTURE, token: 'obsolete-owner', now: nowSql(), error: 'Previous failure' },
  );
  const planner = new ReminderPlanner();
  await planner.schedule(registration, event, initial.type, parseDate(FUTURE));
  let row = await queryOne('SELECT * FROM scheduled_messages WHERE id = :id', fixture);
  assert.equal(row.attempt_count, 0);
  assert.equal(row.delivery_step, 0);
  assert.equal(row.next_attempt_at, null);
  assert.equal(row.lock_token, null);
  assert.equal(row.locked_until, null);
  assert.equal(row.failed_at, null);
  assert.equal(row.error, null);
  assert.equal(row.sent_at, null);
  await query(
    'UPDATE scheduled_messages SET lock_token = :token, locked_until = :future WHERE id = :id',
    { id: fixture.id, future: FUTURE, token: 'current-owner' },
  );
  await planner.cancelOffline(registration);
  row = await queryOne('SELECT * FROM scheduled_messages WHERE id = :id', fixture);
  assert.ok(row.sent_at);
  assert.equal(row.lock_token, null);
  assert.equal(row.locked_until, null);
});
