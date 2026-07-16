import { isSqlite, query } from '../db/mysql.js';
import { formatSqlDate, nowSql, parseDate, shiftDate } from '../utils/dates.js';

const OFFLINE_TYPES = ['offline_1day', 'offline_2hours', 'offline_started'];
const ONLINE_TYPES = ['online_15min', 'online_started'];
const POSTPROMO_TYPES = ['postpromo'];
const ALL_TYPES = [...OFFLINE_TYPES, ...ONLINE_TYPES, ...POSTPROMO_TYPES];

export class ReminderPlanner {
  async planOnline(registration, event) {
    await this.cancelOffline(registration);
    await this.cancelOnline(registration);
    const onlineStart = event.online_start || event.date_start;
    await this.schedule(registration, event, 'online_15min', this.eventSendAt(event, 'online_15min_send_at', shiftDate(onlineStart, -15 * 60 * 1000)));
    await this.schedule(registration, event, 'online_started', this.eventSendAt(event, 'online_started_send_at', parseDate(onlineStart)));
    await this.planPostPromo(registration, event);
  }

  async planOfflineApproved(registration, event) {
    await this.cancelOnline(registration);
    await this.cancelOffline(registration);
    await this.schedule(registration, event, 'offline_1day', this.eventSendAt(event, 'offline_1day_send_at', shiftDate(event.date_start, -24 * 60 * 60 * 1000)));
    await this.schedule(registration, event, 'offline_2hours', this.eventSendAt(event, 'offline_2hours_send_at', shiftDate(event.date_start, -2 * 60 * 60 * 1000)));
    await this.schedule(registration, event, 'offline_started', this.eventSendAt(event, 'offline_started_send_at', parseDate(event.date_start)));
    await this.planPostPromo(registration, event);
  }

  async planOfflineApprovalNoticeRetry(registration, event, sendAt = shiftDate(nowSql(), 60 * 1000)) {
    await this.schedule(registration, event, 'offline_approved', sendAt, { attempts: 0 });
  }

  async planPostPromo(registration, event) {
    await this.cancelTypes(registration, POSTPROMO_TYPES);
    const message = String(event?.postpromo_message || '').trim();
    const sendAt = event?.postpromo_send_at ? parseDate(event.postpromo_send_at) : null;
    const status = String(registration?.status || '');
    if (!message || !sendAt || !['approved', 'visited'].includes(status) || registration?.archived_at) {
      return;
    }
    await this.schedule(registration, event, 'postpromo', sendAt);
  }

  eventSendAt(event, field, fallback) {
    const custom = String(event?.[field] || '').trim();
    return custom ? parseDate(custom) : fallback;
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

  async schedule(registration, event, type, sendAt, payload = null) {
    if (sendAt <= new Date()) {
      return;
    }

    const now = nowSql();
    const payloadText = payload === null ? null : JSON.stringify(payload);
    if (isSqlite()) {
      await query(
        `INSERT INTO scheduled_messages
          (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
         VALUES
          (:registrationId, :personId, :eventId, :type, :sendAt, :payload, :now, :now)
         ON CONFLICT(registration_id, type) DO UPDATE SET
          send_at = excluded.send_at,
          payload = excluded.payload,
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
          payload: payloadText,
          now,
        },
      );
      return;
    }

    await query(
      `INSERT INTO scheduled_messages
        (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
       VALUES
        (:registrationId, :personId, :eventId, :type, :sendAt, :payload, :now, :now)
       ON DUPLICATE KEY UPDATE
        send_at = VALUES(send_at),
        payload = VALUES(payload),
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
        payload: payloadText,
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
