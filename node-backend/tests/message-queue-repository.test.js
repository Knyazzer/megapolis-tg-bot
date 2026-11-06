import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_CONNECTION = 'sqlite';
process.env.DB_DATABASE = ':memory:';
process.env.TELEGRAM_DRY_RUN = 'true';
process.env.FACECAST_DEMO_MODE = 'true';

const { execute, queryOne } = await import('../src/db/mysql.js');
const { MessageQueueRepository } = await import('../src/repositories/message-queue-repository.js');
const queue = new MessageQueueRepository();
let nextPerson = 800_000;

async function message(kind) {
  const person = await execute(
    `INSERT INTO people (telegram_id, created_at, updated_at)
     VALUES (:telegramId, :now, :now)`,
    { telegramId: nextPerson++, now: '2020-01-01 00:00:00' },
  );
  if (kind === 'scheduled') {
    const result = await execute(
      `INSERT INTO scheduled_messages (person_id, type, send_at, created_at, updated_at)
       VALUES (:personId, 'postpromo', :now, :now, :now)`,
      { personId: person.insertId, now: '2020-01-01 00:00:00' },
    );
    return result.insertId;
  }
  const campaign = await execute(
    `INSERT INTO broadcast_campaigns (title, audience, created_at, updated_at)
     VALUES ('Test', 'all', :now, :now)`,
    { now: '2020-01-01 00:00:00' },
  );
  const result = await execute(
    `INSERT INTO broadcast_messages (campaign_id, person_id, telegram_id, created_at, updated_at)
     VALUES (:campaignId, :personId, :telegramId, :now, :now)`,
    { campaignId: campaign.insertId, personId: person.insertId, telegramId: nextPerson - 1, now: '2020-01-01 00:00:00' },
  );
  return result.insertId;
}

for (const kind of ['scheduled', 'broadcast']) {
  const table = kind === 'scheduled' ? 'scheduled_messages' : 'broadcast_messages';
  const read = (id) => queryOne(`SELECT * FROM ${table} WHERE id = :id`, { id });

  test(`${kind}: only one racing consumer owns a row; expired claims retain progress`, async () => {
    const id = await message(kind);
    const tokens = await Promise.all([queue.claim(kind, id), queue.claim(kind, id)]);
    assert.equal(tokens.filter(Boolean).length, 1);
    const owner = tokens.find(Boolean);
    assert.equal(await queue.checkpoint(kind, id, 'wrong-token', 1), false);
    assert.equal(await queue.checkpoint(kind, id, owner, 2), true);
    assert.equal(await queue.checkpoint(kind, id, owner, 1), true);
    assert.equal((await read(id)).delivery_step, 2);
    assert.equal(await queue.renew(kind, id, owner), true);

    await execute(`UPDATE ${table} SET locked_until = :past WHERE id = :id`, { id, past: '2020-01-01 00:00:00' });
    const newOwner = await queue.claim(kind, id);
    assert.ok(newOwner);
    assert.notEqual(newOwner, owner);
    assert.equal(await queue.complete(kind, id, owner), false);
    assert.equal(await queue.retry(kind, id, owner, new Error('stale owner'), '2020-01-01 00:00:00'), false);
    assert.equal((await read(id)).attempt_count, 2);
    assert.equal((await read(id)).delivery_step, 2);
    assert.equal(await queue.complete(kind, id, newOwner), true);
    const sent = await read(id);
    assert.ok(sent.sent_at);
    assert.equal(sent.lock_token, null);
    assert.equal(sent.locked_until, null);
    assert.equal(await queue.claim(kind, id), null);
  });

  test(`${kind}: retry deadlines persist and terminal failures cannot be reclaimed`, async () => {
    const id = await message(kind);
    const token = await queue.claim(kind, id);
    assert.equal(await queue.retry(kind, id, token, new Error('temporary'), '2099-01-01 00:00:00'), true);
    const waiting = await read(id);
    assert.equal(waiting.next_attempt_at, '2099-01-01 00:00:00');
    assert.equal(waiting.error, 'temporary');
    assert.equal(waiting.lock_token, null);
    assert.equal(await queue.claim(kind, id), null);

    await execute(`UPDATE ${table} SET next_attempt_at = :past WHERE id = :id`, { id, past: '2020-01-01 00:00:00' });
    const newOwner = await queue.claim(kind, id);
    assert.ok(newOwner);
    assert.equal(await queue.fail(kind, id, newOwner, new Error('permanent')), true);
    const failed = await read(id);
    assert.equal(failed.error, 'permanent');
    assert.equal(failed.next_attempt_at, null);
    assert.equal(failed.lock_token, null);
    assert.equal(kind === 'scheduled' ? Boolean(failed.failed_at) : failed.status === 'failed', true);
    assert.equal(await queue.claim(kind, id), null);
  });
}

test('scheduled messages cannot be claimed before their planned time', async () => {
  const id = await message('scheduled');
  await execute('UPDATE scheduled_messages SET send_at = :future WHERE id = :id', { id, future: '2099-01-01 00:00:00' });
  assert.equal(await queue.claim('scheduled', id), null);
});

test('cancelling a campaign invalidates existing leases and prevents claims', async () => {
  const id = await message('broadcast');
  const token = await queue.claim('broadcast', id);
  await execute(
    `UPDATE broadcast_campaigns SET status = 'cancelled'
     WHERE id = (SELECT campaign_id FROM broadcast_messages WHERE id = :id)`,
    { id },
  );
  assert.equal(await queue.renew('broadcast', id, token), false);
  assert.equal(await queue.checkpoint('broadcast', id, token, 1), false);
  assert.equal(await queue.complete('broadcast', id, token), false);
  assert.equal(await queue.fail('broadcast', id, token, new Error('temporary')), false);
  assert.equal(await queue.retry('broadcast', id, token, new Error('temporary'), '2020-01-01 00:00:00'), false);
  assert.equal(await queue.claim('broadcast', id), null);
});

test('only known queue kinds and nonnegative integer delivery steps are accepted', async () => {
  await assert.rejects(queue.claim('broadcast_messages; DELETE FROM people', 1), /Invalid message queue kind/);
  await assert.rejects(queue.checkpoint('scheduled', 1, 'token', -1), /Invalid message delivery step/);
});

test('a bot cooldown pauses both queues across consumers without shortening retry deadlines', async () => {
  const scheduledId = await message('scheduled');
  const broadcastId = await message('broadcast');
  const delayedId = await message('broadcast');
  const activeToken = await queue.claim('broadcast', broadcastId);
  await execute(
    'UPDATE broadcast_messages SET next_attempt_at = :future WHERE id = :id',
    { id: delayedId, future: '2099-02-01 00:00:00' },
  );
  await queue.deferPendingUntil('2099-01-01 00:00:00');
  await queue.deferPendingUntil('2098-01-01 00:00:00');
  const otherConsumer = new MessageQueueRepository();
  assert.equal(await otherConsumer.claim('scheduled', scheduledId), null);
  assert.equal(await otherConsumer.claim('broadcast', delayedId), null);
  assert.equal(await queue.renew('broadcast', broadcastId, activeToken), false);
  const newlyQueuedScheduled = await message('scheduled');
  const newlyQueuedBroadcast = await message('broadcast');
  assert.equal(await otherConsumer.claim('scheduled', newlyQueuedScheduled), null);
  assert.equal(await otherConsumer.claim('broadcast', newlyQueuedBroadcast), null);
  assert.equal((await queryOne('SELECT paused_until FROM message_queue_control WHERE id = 1')).paused_until, '2099-01-01 00:00:00');
  // An already acknowledged request must retain its progress during a pause.
  assert.equal(await queue.checkpoint('broadcast', broadcastId, activeToken, 1), true);
  const delayed = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', { id: delayedId });
  assert.equal(delayed.next_attempt_at, '2099-02-01 00:00:00');
  assert.equal(delayed.attempt_count, 0);
  const active = await queryOne('SELECT * FROM broadcast_messages WHERE id = :id', { id: broadcastId });
  assert.equal(active.delivery_step, 1);
  assert.equal(active.lock_token, activeToken);
  assert.equal(active.attempt_count, 1);
  assert.equal(await queue.release('broadcast', broadcastId, 'wrong-token'), false);
  assert.equal(await queue.release('broadcast', broadcastId, activeToken), true);
  assert.equal((await queryOne('SELECT lock_token FROM broadcast_messages WHERE id = :id', { id: broadcastId })).lock_token, null);
  assert.equal(await otherConsumer.claim('broadcast', broadcastId), null);
  await execute('DELETE FROM message_queue_control WHERE id = 1');
  assert.ok(await otherConsumer.claim('broadcast', newlyQueuedBroadcast));
});

test('rescheduling an owned message never shortens a later retry deadline', async () => {
  const id = await message('scheduled');
  const token = await queue.claim('scheduled', id);
  await execute('UPDATE scheduled_messages SET next_attempt_at = :future WHERE id = :id', { id, future: '2099-02-01 00:00:00' });
  assert.equal(await queue.retry('scheduled', id, token, new Error('temporary'), '2099-01-01 00:00:00'), true);
  assert.equal((await queryOne('SELECT next_attempt_at FROM scheduled_messages WHERE id = :id', { id })).next_attempt_at, '2099-02-01 00:00:00');
});
