import { isSqlite, query, queryOne } from '../db/mysql.js';
import { nowSql } from '../utils/dates.js';

const REGISTRATION_FIELDS = [
  'attendance',
  'status',
  'facecast_login',
  'facecast_password',
  'facecast_url',
  'rejection_reason',
  'approved_at',
  'archived_at',
];

export class RegistrationsRepository {
  async findById(id) {
    return queryOne('SELECT * FROM registrations WHERE id = :id LIMIT 1', { id });
  }

  async findByPersonEvent(personId, eventId) {
    return queryOne(
      'SELECT * FROM registrations WHERE person_id = :personId AND event_id = :eventId LIMIT 1',
      { personId, eventId },
    );
  }

  async upsert(personId, eventId, attendance, status) {
    const now = nowSql();
    if (isSqlite()) {
      await query(
        `INSERT INTO registrations
          (person_id, event_id, attendance, status, approved_at, archived_at, created_at, updated_at)
         VALUES
          (:personId, :eventId, :attendance, :status, :approvedAt, NULL, :now, :now)
         ON CONFLICT(person_id, event_id) DO UPDATE SET
          attendance = excluded.attendance,
          status = excluded.status,
          approved_at = excluded.approved_at,
          archived_at = NULL,
          updated_at = excluded.updated_at`,
        {
          personId,
          eventId,
          attendance,
          status,
          approvedAt: status === 'approved' ? now : null,
          now,
        },
      );

      return this.findByPersonEvent(personId, eventId);
    }

    await query(
      `INSERT INTO registrations
        (person_id, event_id, attendance, status, approved_at, archived_at, created_at, updated_at)
       VALUES
        (:personId, :eventId, :attendance, :status, :approvedAt, NULL, :now, :now)
       ON DUPLICATE KEY UPDATE
        attendance = VALUES(attendance),
        status = VALUES(status),
        approved_at = VALUES(approved_at),
        archived_at = NULL,
        updated_at = VALUES(updated_at)`,
      {
        personId,
        eventId,
        attendance,
        status,
        approvedAt: status === 'approved' ? now : null,
        now,
      },
    );

    return this.findByPersonEvent(personId, eventId);
  }

  async update(id, fields) {
    const entries = Object.entries(fields).filter(([field]) => REGISTRATION_FIELDS.includes(field));
    if (entries.length === 0) {
      return;
    }

    const params = { id, now: nowSql() };
    const sets = entries.map(([field, value]) => {
      params[field] = value;
      return `${field} = :${field}`;
    });
    sets.push('updated_at = :now');

    await query(`UPDATE registrations SET ${sets.join(', ')} WHERE id = :id`, params);
  }
}
