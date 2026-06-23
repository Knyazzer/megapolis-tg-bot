import { query, queryOne } from '../db/mysql.js';
import { formatSqlDate, shiftDate } from '../utils/dates.js';

export class EventsRepository {
  async listUpcoming() {
    const threshold = formatSqlDate(shiftDate(new Date(), -24 * 60 * 60 * 1000));
    return query(
      `SELECT *
       FROM events
       WHERE is_active = 1 AND date_end >= :threshold
       ORDER BY date_start ASC
       LIMIT 10`,
      { threshold },
    );
  }

  async listRecordingsArchive() {
    const now = formatSqlDate(new Date());
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    const cutoff = formatSqlDate(cutoffDate);

    return query(
      `SELECT *
       FROM events
       WHERE is_active = 1
         AND date_end < :now
         AND date_end >= :cutoff
         AND (
          (facecast_event_id IS NOT NULL AND facecast_event_id <> '' AND facecast_url IS NOT NULL AND facecast_url <> '')
          OR (recording_url IS NOT NULL AND recording_url <> '')
         )
       ORDER BY date_end DESC
       LIMIT 10`,
      { now, cutoff },
    );
  }

  async findRecordingById(id) {
    const now = formatSqlDate(new Date());
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    const cutoff = formatSqlDate(cutoffDate);

    return queryOne(
      `SELECT *
       FROM events
       WHERE id = :id
         AND is_active = 1
         AND date_end < :now
         AND date_end >= :cutoff
         AND (
          (facecast_event_id IS NOT NULL AND facecast_event_id <> '' AND facecast_url IS NOT NULL AND facecast_url <> '')
          OR (recording_url IS NOT NULL AND recording_url <> '')
         )
       LIMIT 1`,
      { id, now, cutoff },
    );
  }

  async findById(id) {
    return queryOne('SELECT * FROM events WHERE id = :id LIMIT 1', { id });
  }
}

export function eventSupportsOffline(event) {
  return Boolean(
    String(event?.address ?? '').trim() ||
      (event?.offline_capacity !== null && event?.offline_capacity !== undefined && String(event.offline_capacity) !== ''),
  );
}

export function eventSupportsOnline(event) {
  return Boolean(
    String(event?.online_start ?? '').trim() ||
      String(event?.facecast_event_id ?? '').trim() ||
      String(event?.facecast_url ?? '').trim(),
  );
}

export function eventFormatLabel(event) {
  const offline = eventSupportsOffline(event);
  const online = eventSupportsOnline(event);
  if (offline && online) {
    return 'офлайн + онлайн';
  }
  if (offline) {
    return 'только офлайн';
  }
  if (online) {
    return 'только онлайн';
  }
  return 'уточняется';
}
