import { query, queryOne } from '../db/mysql.js';
import { nowSql } from '../utils/dates.js';

const PERSON_FIELDS = ['full_name', 'company', 'position_title', 'phone', 'email'];

export class PeopleRepository {
  async findByTelegramId(telegramId) {
    return queryOne('SELECT * FROM people WHERE telegram_id = :telegramId LIMIT 1', { telegramId });
  }

  async findById(id) {
    return queryOne('SELECT * FROM people WHERE id = :id LIMIT 1', { id });
  }

  async upsertFromTelegram(from) {
    const telegramId = Number(from.id);
    const existing = await this.findByTelegramId(telegramId);
    const now = nowSql();

    if (existing) {
      await query(
        `UPDATE people
         SET username = :username,
             first_name = :firstName,
             last_name = :lastName,
             last_seen_at = :now,
             updated_at = :now
         WHERE id = :id`,
        {
          id: existing.id,
          username: from.username ?? null,
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          now,
        },
      );

      return this.findByTelegramId(telegramId);
    }

    await query(
      `INSERT INTO people
        (telegram_id, username, first_name, last_name, state, last_seen_at, created_at, updated_at)
       VALUES
        (:telegramId, :username, :firstName, :lastName, 'new', :now, :now, :now)`,
      {
        telegramId,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        now,
      },
    );

    return this.findByTelegramId(telegramId);
  }

  async updateFields(id, fields) {
    const allowedEntries = Object.entries(fields).filter(([field]) => PERSON_FIELDS.includes(field));
    if (allowedEntries.length === 0) {
      return;
    }

    const params = { id, now: nowSql() };
    const sets = allowedEntries.map(([field, value]) => {
      params[field] = value;
      return `${field} = :${field}`;
    });

    await query(
      `UPDATE people SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`,
      params,
    );
  }

  async setState(id, state) {
    await query('UPDATE people SET state = :state, updated_at = :now WHERE id = :id', {
      id,
      state,
      now: nowSql(),
    });
  }

  async acceptConsent(id) {
    await query(
      'UPDATE people SET consent_accepted_at = :now, updated_at = :now WHERE id = :id',
      { id, now: nowSql() },
    );
  }
}

export function profileComplete(person) {
  return Boolean(
    person?.consent_accepted_at &&
      person?.full_name &&
      person?.company &&
      person?.position_title &&
      person?.phone &&
      person?.email,
  );
}
