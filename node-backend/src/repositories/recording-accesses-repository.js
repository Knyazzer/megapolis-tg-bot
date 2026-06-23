import { isSqlite, query, queryOne } from '../db/mysql.js';
import { formatSqlDate, nowSql } from '../utils/dates.js';

export class RecordingAccessesRepository {
  async findByPersonEvent(personId, eventId) {
    return queryOne(
      'SELECT * FROM recording_accesses WHERE person_id = :personId AND event_id = :eventId LIMIT 1',
      { personId, eventId },
    );
  }

  async listByPerson(personId) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    const cutoff = formatSqlDate(cutoffDate);

    return query(
      `SELECT ra.*, e.title, e.date_start, e.date_end, e.recording_url, e.facecast_url AS event_facecast_url
       FROM recording_accesses ra
       JOIN events e ON e.id = ra.event_id
       WHERE ra.person_id = :personId AND e.date_end >= :cutoff
       ORDER BY e.date_end DESC, ra.created_at DESC
       LIMIT 10`,
      { personId, cutoff },
    );
  }

  async upsert(personId, eventId, fields = {}) {
    const now = nowSql();
    const params = {
      personId,
      eventId,
      source: fields.source || 'facecast',
      facecastLogin: fields.facecast_login ?? null,
      facecastPassword: fields.facecast_password ?? null,
      facecastTicketId: fields.facecast_ticket_id ?? null,
      facecastUrl: fields.facecast_url ?? null,
      now,
    };

    if (isSqlite()) {
      await query(
        `INSERT INTO recording_accesses
          (person_id, event_id, source, facecast_login, facecast_password, facecast_ticket_id, facecast_url, created_at, updated_at)
         VALUES
          (:personId, :eventId, :source, :facecastLogin, :facecastPassword, :facecastTicketId, :facecastUrl, :now, :now)
         ON CONFLICT(person_id, event_id) DO UPDATE SET
          source = excluded.source,
          facecast_login = excluded.facecast_login,
          facecast_password = excluded.facecast_password,
          facecast_ticket_id = excluded.facecast_ticket_id,
          facecast_url = excluded.facecast_url,
          updated_at = excluded.updated_at`,
        params,
      );

      return this.findByPersonEvent(personId, eventId);
    }

    await query(
      `INSERT INTO recording_accesses
        (person_id, event_id, source, facecast_login, facecast_password, facecast_ticket_id, facecast_url, created_at, updated_at)
       VALUES
        (:personId, :eventId, :source, :facecastLogin, :facecastPassword, :facecastTicketId, :facecastUrl, :now, :now)
       ON DUPLICATE KEY UPDATE
        source = VALUES(source),
        facecast_login = VALUES(facecast_login),
        facecast_password = VALUES(facecast_password),
        facecast_ticket_id = VALUES(facecast_ticket_id),
        facecast_url = VALUES(facecast_url),
        updated_at = VALUES(updated_at)`,
      params,
    );

    return this.findByPersonEvent(personId, eventId);
  }
}
