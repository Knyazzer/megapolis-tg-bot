import { execute, isSqlite, query, queryOne } from '../db/mysql.js';
import { nowSql } from '../utils/dates.js';

export class GiveawaysRepository {
  async listActive() {
    return query(
      `SELECT *
       FROM giveaways
       WHERE is_active = 1 AND archived_at IS NULL
       ORDER BY COALESCE(draw_at, created_at) ASC, id ASC
       LIMIT 20`,
    );
  }

  async listWithCounts({ archived = false } = {}) {
    return query(
      `SELECT g.*,
        COUNT(ge.id) AS entries_count,
        MAX(ge.created_at) AS last_entry_at
       FROM giveaways g
       LEFT JOIN giveaway_entries ge ON ge.giveaway_id = g.id AND ge.status = 'entered'
       WHERE g.archived_at IS ${archived ? 'NOT' : ''} NULL
       GROUP BY g.id
       ORDER BY ${archived ? 'g.archived_at DESC,' : 'g.is_active DESC,'} COALESCE(g.draw_at, g.created_at) DESC, g.id DESC
       LIMIT 100`,
    );
  }

  async findById(id) {
    return queryOne('SELECT * FROM giveaways WHERE id = :id LIMIT 1', { id: Number(id) });
  }

  async findActiveById(id) {
    return queryOne(
      'SELECT * FROM giveaways WHERE id = :id AND is_active = 1 AND archived_at IS NULL LIMIT 1',
      { id: Number(id) },
    );
  }

  async save(data) {
    const id = Number(data.id || 0);
    const params = {
      slug: data.slug,
      title: data.title,
      description: data.description,
      prize: data.prize,
      draw_at: data.draw_at,
      result_url: data.result_url,
      is_active: Number(data.is_active) === 1 ? 1 : 0,
      now: nowSql(),
    };

    if (id > 0) {
      await execute(
        `UPDATE giveaways
         SET slug = :slug,
          title = :title,
          description = :description,
          prize = :prize,
          draw_at = :draw_at,
          result_url = :result_url,
          is_active = :is_active,
          updated_at = :now
         WHERE id = :id`,
        { ...params, id },
      );
      return id;
    }

    const inserted = await execute(
      `INSERT INTO giveaways
        (slug, title, description, prize, draw_at, result_url, is_active, created_at, updated_at)
       VALUES
        (:slug, :title, :description, :prize, :draw_at, :result_url, :is_active, :now, :now)`,
      params,
    );
    return Number(inserted.insertId || 0);
  }

  async setActive(id, isActive) {
    await execute(
      'UPDATE giveaways SET is_active = :isActive, updated_at = :now WHERE id = :id',
      { id: Number(id), isActive: Number(isActive) === 1 ? 1 : 0, now: nowSql() },
    );
  }

  async archive(id) {
    await execute(
      'UPDATE giveaways SET archived_at = :now, is_active = 0, updated_at = :now WHERE id = :id',
      { id: Number(id), now: nowSql() },
    );
  }

  async restore(id) {
    await execute(
      'UPDATE giveaways SET archived_at = NULL, updated_at = :now WHERE id = :id',
      { id: Number(id), now: nowSql() },
    );
  }

  async findEntry(giveawayId, personId) {
    return queryOne(
      'SELECT * FROM giveaway_entries WHERE giveaway_id = :giveawayId AND person_id = :personId LIMIT 1',
      { giveawayId: Number(giveawayId), personId: Number(personId) },
    );
  }

  async enter(giveawayId, personId) {
    const existing = await this.findEntry(giveawayId, personId);
    if (existing && existing.status === 'entered') {
      return { entry: existing, created: false };
    }

    const now = nowSql();
    if (isSqlite()) {
      await query(
        `INSERT INTO giveaway_entries
          (giveaway_id, person_id, status, source, created_at, updated_at)
         VALUES
          (:giveawayId, :personId, 'entered', 'bot', :now, :now)
         ON CONFLICT(giveaway_id, person_id) DO UPDATE SET
          status = 'entered',
          updated_at = excluded.updated_at`,
        { giveawayId: Number(giveawayId), personId: Number(personId), now },
      );
      return { entry: await this.findEntry(giveawayId, personId), created: true };
    }

    await query(
      `INSERT INTO giveaway_entries
        (giveaway_id, person_id, status, source, created_at, updated_at)
       VALUES
        (:giveawayId, :personId, 'entered', 'bot', :now, :now)
       ON DUPLICATE KEY UPDATE
        status = 'entered',
        updated_at = VALUES(updated_at)`,
      { giveawayId: Number(giveawayId), personId: Number(personId), now },
    );
    return { entry: await this.findEntry(giveawayId, personId), created: true };
  }

  async listEntries(giveawayId) {
    return query(
      `SELECT ge.*, p.telegram_id, p.username, p.full_name, p.company, p.position_title, p.phone, p.email
       FROM giveaway_entries ge
       JOIN people p ON p.id = ge.person_id
       WHERE ge.giveaway_id = :giveawayId
       ORDER BY ge.created_at ASC, ge.id ASC
       LIMIT 5000`,
      { giveawayId: Number(giveawayId) },
    );
  }
}
