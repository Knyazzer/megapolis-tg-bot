import { randomUUID } from 'node:crypto';
import { execute, isSqlite } from '../db/mysql.js';
import { formatSqlDate, nowSql, shiftDate } from '../utils/dates.js';

const LEASE_MS = 5 * 60 * 1000;
const NOT_PAUSED = `NOT EXISTS (
  SELECT 1 FROM message_queue_control WHERE id = 1 AND paused_until > :now
)`;
const QUEUES = Object.freeze({
  scheduled: {
    table: 'scheduled_messages',
    pending: 'sent_at IS NULL AND failed_at IS NULL',
    due: 'AND send_at <= :now',
  },
  broadcast: {
    table: 'broadcast_messages',
    pending: `status = 'queued' AND EXISTS (
      SELECT 1 FROM broadcast_campaigns c
      WHERE c.id = broadcast_messages.campaign_id AND c.status != 'cancelled'
    )`,
    due: '',
  },
});

// All entry points (worker and admin) claim the same database row. The lease
// recovers interrupted work without holding a transaction over Telegram calls.
export class MessageQueueRepository {
  async claim(kind, id) {
    const queue = queueFor(kind);
    const token = randomUUID();
    const now = nowSql();
    const result = await execute(
      `UPDATE ${queue.table}
       SET lock_token = :token, locked_until = :lockedUntil,
           attempt_count = attempt_count + 1, updated_at = :now
       WHERE id = :id AND ${queue.pending}
         ${queue.due}
         AND (next_attempt_at IS NULL OR next_attempt_at <= :now)
         AND (locked_until IS NULL OR locked_until <= :now)
         AND ${NOT_PAUSED}`,
      { id, token, now, lockedUntil: formatSqlDate(shiftDate(now, LEASE_MS)) },
    );
    return result.affectedRows === 1 ? token : null;
  }

  async renew(kind, id, token) {
    return this.updateOwned(kind, id, token, 'locked_until = :lockedUntil', {}, true);
  }

  async release(kind, id, token) {
    return this.updateOwned(kind, id, token, 'lock_token = NULL, locked_until = NULL', {});
  }

  async checkpoint(kind, id, token, step) {
    if (!Number.isSafeInteger(step) || step < 0) {
      throw new Error('Invalid message delivery step');
    }
    return this.updateOwned(
      kind, id, token,
      `delivery_step = CASE WHEN delivery_step < :step THEN :step ELSE delivery_step END,
       locked_until = :lockedUntil`,
      { step },
    );
  }

  async complete(kind, id, token) {
    const state = kind === 'broadcast' ? "status = 'sent'," : '';
    return this.updateOwned(
      kind, id, token,
      `${state} sent_at = :now, error = NULL, next_attempt_at = NULL,
       lock_token = NULL, locked_until = NULL`,
      {},
    );
  }

  async fail(kind, id, token, error) {
    const state = kind === 'broadcast' ? "status = 'failed'" : 'failed_at = :now';
    return this.updateOwned(
      kind, id, token,
      `${state}, error = :error, next_attempt_at = NULL,
       lock_token = NULL, locked_until = NULL`,
      { error: errorMessage(error) },
    );
  }

  async retry(kind, id, token, error, retryAt) {
    return this.updateOwned(
      kind, id, token,
      `next_attempt_at = CASE
         WHEN next_attempt_at IS NULL OR next_attempt_at < :retryAt THEN :retryAt
         ELSE next_attempt_at END, error = :error,
       lock_token = NULL, locked_until = NULL`,
      { retryAt, error: errorMessage(error) },
    );
  }

  async deferPendingUntil(retryAt) {
    if (isSqlite()) {
      return execute(
        `INSERT INTO message_queue_control (id, paused_until) VALUES (1, :retryAt)
         ON CONFLICT(id) DO UPDATE SET paused_until = CASE
           WHEN paused_until < excluded.paused_until THEN excluded.paused_until
           ELSE paused_until END`,
        { retryAt },
      );
    }
    return execute(
      `INSERT INTO message_queue_control (id, paused_until) VALUES (1, :retryAt)
       ON DUPLICATE KEY UPDATE paused_until = CASE
         WHEN paused_until < VALUES(paused_until) THEN VALUES(paused_until)
         ELSE paused_until END`,
      { retryAt },
    );
  }

  async updateOwned(kind, id, token, assignments, params, requireDue = false) {
    const queue = queueFor(kind);
    const now = nowSql();
    const result = await execute(
      `UPDATE ${queue.table}
       SET ${assignments}, updated_at = :now
       WHERE id = :id AND lock_token = :token AND ${queue.pending}
         ${requireDue ? `AND (next_attempt_at IS NULL OR next_attempt_at <= :now) AND ${NOT_PAUSED}` : ''}`,
      { ...params, id, token, now, lockedUntil: formatSqlDate(shiftDate(now, LEASE_MS)) },
    );
    return result.affectedRows === 1;
  }
}

function queueFor(kind) {
  if (!Object.hasOwn(QUEUES, kind)) {
    throw new Error('Invalid message queue kind');
  }
  return QUEUES[kind];
}

function errorMessage(error) {
  return String(error?.message || error || 'Message delivery failed');
}
