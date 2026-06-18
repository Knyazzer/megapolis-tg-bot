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
