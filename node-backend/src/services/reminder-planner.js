import { isSqlite, query } from '../db/mysql.js';
import { formatSqlDate, nowSql, parseDate, shiftDate } from '../utils/dates.js';

const OFFLINE_TYPES = ['offline_1day', 'offline_2hours', 'offline_started'];
const ONLINE_TYPES = ['online_15min', 'online_started'];
// Keep legacy postpromo here so cancellations also close old queued records.
const ALL_TYPES = [...OFFLINE_TYPES, ...ONLINE_TYPES, 'postpromo'];

export class ReminderPlanner {
  async planOnline(registration, event) {
    await this.cancelOffline(registration);
    const onlineStart = event.online_start || event.date_start;
    await this.schedule(registration, event, 'online_15min', shiftDate(onlineStart, -15 * 60 * 1000));
    await this.schedule(registration, event, 'online_started', parseDate(onlineStart));
  }

  async planOfflineApproved(registration, event) {
    await this.schedule(registration, event, 'offline_1day', shiftDate(event.date_start, -24 * 60 * 60 * 1000));
    await this.schedule(registration, event, 'offline_2hours', shiftDate(event.date_start, -2 * 60 * 60 * 1000));
    await this.schedule(registration, event, 'offline_started', parseDate(event.date_start));
  }

  async cancelOffline(registration) {
    await this.cancelTypes(registration, OFFLINE_TYPES);
  }

  async cancelOnline(registration) {
    await this.cancelTypes(registration, ONLINE_TYPES);
  }

  async cancelAll(registration) {
    await this.cancelTypes(registration, ALL_TYPES);
  }

  async schedule(registration, event, type, sendAt) {
    if (sendAt <= new Date()) {
      return;
    }

    const now = nowSql();
    if (isSqlite()) {
      await query(
        `INSERT INTO scheduled_messages
          (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
         VALUES
          (:registrationId, :personId, :eventId, :type, :sendAt, NULL, :now, :now)
         ON CONFLICT(registration_id, type) DO UPDATE SET
          send_at = excluded.send_at,
          sent_at = NULL,
          failed_at = NULL,
          error = NULL,
          updated_at = excluded.updated_at`,
        {
          registrationId: registration.id,
          personId: registration.person_id,
          eventId: event.event_id || event.id,
          type,
          sendAt: formatSqlDate(sendAt),
          now,
        },
      );
      return;
    }

    await query(
      `INSERT INTO scheduled_messages
        (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
       VALUES
        (:registrationId, :personId, :eventId, :type, :sendAt, NULL, :now, :now)
       ON DUPLICATE KEY UPDATE
        send_at = VALUES(send_at),
        sent_at = NULL,
        failed_at = NULL,
        error = NULL,
        updated_at = VALUES(updated_at)`,
      {
        registrationId: registration.id,
        personId: registration.person_id,
        eventId: event.event_id || event.id,
        type,
        sendAt: formatSqlDate(sendAt),
        now,
      },
    );
  }

  async cancelTypes(registration, types) {
    if (!registration?.id || types.length === 0) {
      return;
    }

    await query(
      `UPDATE scheduled_messages
       SET sent_at = :now,
           updated_at = :now
       WHERE registration_id = :registrationId
         AND sent_at IS NULL
         AND failed_at IS NULL
         AND type IN (${types.map((_, index) => `:type${index}`).join(', ')})`,
      {
        registrationId: registration.id,
        now: nowSql(),
        ...Object.fromEntries(types.map((type, index) => [`type${index}`, type])),
      },
    );
  }
}
