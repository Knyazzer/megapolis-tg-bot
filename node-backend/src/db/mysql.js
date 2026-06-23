import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { nowSql } from '../utils/dates.js';

const require = createRequire(import.meta.url);

let pool;
let sqlite;

export function db() {
  if (isSqlite()) {
    return sqliteDb();
  }

  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      charset: 'utf8mb4',
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: '+03:00',
    });
  }

  return pool;
}

export async function query(sql, params = {}) {
  if (isSqlite()) {
    const statement = sqliteDb().prepare(sql);
    const sqliteParams = namedParams(sql, params);
    if (returnsRows(sql)) {
      return statement.all(sqliteParams);
    }
    const result = statement.run(sqliteParams);
    return {
      affectedRows: Number(result.changes || 0),
      insertId: Number(result.lastInsertRowid || 0),
    };
  }

  const [rows] = await db().execute(sql, params);
  return rows;
}

export async function execute(sql, params = {}) {
  if (isSqlite()) {
    const result = sqliteDb().prepare(sql).run(namedParams(sql, params));
    return {
      affectedRows: Number(result.changes || 0),
      insertId: Number(result.lastInsertRowid || 0),
    };
  }

  const [result] = await db().execute(sql, params);
  return result;
}

export async function queryOne(sql, params = {}) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

export async function pingDb() {
  const rows = await query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

export async function withTransaction(callback) {
  if (isSqlite()) {
    const database = sqliteDb();
    try {
      database.exec('BEGIN');
      const tx = { query, execute };
      const result = await callback(tx);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const tx = {
      async query(sql, params = {}) {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      async execute(sql, params = {}) {
        const [result] = await connection.execute(sql, params);
        return result;
      },
    };
    const result = await callback(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function isSqlite() {
  return config.db.connection === 'sqlite';
}

function sqliteDb() {
  if (sqlite) {
    return sqlite;
  }

  if (!config.db.database) {
    throw new Error('DB_DATABASE is empty for sqlite connection');
  }

  mkdirSync(new URL('../../data/', import.meta.url), { recursive: true });
  sqlite = createSqliteDatabase(config.db.database);
  ensureSqliteSchema(sqlite);
  return sqlite;
}

function createSqliteDatabase(path) {
  const module = require('node:sqlite');
  return new module.DatabaseSync(path);
}

function returnsRows(sql) {
  return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
}

function namedParams(sql, params) {
  if (!params || Array.isArray(params)) {
    return params;
  }

  const names = new Set();
  const matches = sql.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const match of matches) {
    names.add(match[1]);
  }

  const filtered = {};
  for (const name of names) {
    if (Object.hasOwn(params, name)) {
      filtered[name] = params[name];
    }
  }

  return filtered;
}

function ensureSqliteSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      username TEXT NULL,
      first_name TEXT NULL,
      last_name TEXT NULL,
      full_name TEXT NULL,
      company TEXT NULL,
      position_title TEXT NULL,
      phone TEXT NULL,
      email TEXT NULL,
      consent_accepted_at TEXT NULL,
      state TEXT NOT NULL DEFAULT 'new',
      state_payload TEXT NULL,
      chat_mode TEXT NOT NULL DEFAULT 'bot',
      chat_mode_updated_at TEXT NULL,
      chat_read_at TEXT NULL,
      last_seen_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NULL,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      guest_arrival_at TEXT NULL,
      online_start TEXT NULL,
      address TEXT NULL,
      venue_lat REAL NULL,
      venue_lng REAL NULL,
      offline_capacity INTEGER NULL,
      facecast_event_id TEXT NULL,
      facecast_url TEXT NULL,
      recording_url TEXT NULL,
      photo_album_url TEXT NULL,
      postpromo_message TEXT NULL,
      postpromo_send_at TEXT NULL,
      offline_1day_send_at TEXT NULL,
      offline_2hours_send_at TEXT NULL,
      offline_started_send_at TEXT NULL,
      online_15min_send_at TEXT NULL,
      online_started_send_at TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      attendance TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      facecast_login TEXT NULL,
      facecast_password TEXT NULL,
      facecast_ticket_id TEXT NULL,
      facecast_url TEXT NULL,
      rejection_reason TEXT NULL,
      approved_at TEXT NULL,
      archived_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (person_id, event_id),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NULL,
      person_id INTEGER NOT NULL,
      event_id INTEGER NULL,
      type TEXT NOT NULL,
      send_at TEXT NOT NULL,
      payload TEXT NULL,
      sent_at TEXT NULL,
      failed_at TEXT NULL,
      error TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (registration_id, type),
      FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS broadcast_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      audience TEXT NOT NULL,
      event_id INTEGER NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      body TEXT NULL,
      media_file_id TEXT NULL,
      media_blob BLOB NULL,
      media_mime TEXT NULL,
      media_name TEXT NULL,
      media_size INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS broadcast_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      telegram_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      sent_at TEXT NULL,
      error TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, person_id),
      FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      telegram_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      text TEXT NULL,
      media_file_id TEXT NULL,
      media_name TEXT NULL,
      media_mime TEXT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error TEXT NULL,
      sent_at TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_person_created ON chat_messages (person_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages (created_at);

    CREATE TABLE IF NOT EXISTS bot_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureSqliteColumn(database, 'registrations', 'archived_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'registrations', 'facecast_ticket_id', 'TEXT NULL');
  ensureSqliteColumn(database, 'people', 'chat_mode', "TEXT NOT NULL DEFAULT 'bot'");
  ensureSqliteColumn(database, 'people', 'chat_mode_updated_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'people', 'chat_read_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'guest_arrival_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'postpromo_message', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'postpromo_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'offline_1day_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'offline_2hours_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'offline_started_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'online_15min_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'events', 'online_started_send_at', 'TEXT NULL');
  ensureSqliteColumn(database, 'broadcast_campaigns', 'media_blob', 'BLOB NULL');
  ensureSqliteColumn(database, 'broadcast_campaigns', 'media_mime', 'TEXT NULL');
  ensureSqliteColumn(database, 'broadcast_campaigns', 'media_name', 'TEXT NULL');
  ensureSqliteColumn(database, 'broadcast_campaigns', 'media_size', 'INTEGER NULL');
  ensureSqliteColumn(database, 'chat_messages', 'media_file_id', 'TEXT NULL');
  ensureSqliteColumn(database, 'chat_messages', 'media_name', 'TEXT NULL');
  ensureSqliteColumn(database, 'chat_messages', 'media_mime', 'TEXT NULL');
  database.exec('CREATE INDEX IF NOT EXISTS idx_registrations_archived ON registrations (archived_at)');

  const count = database.prepare('SELECT COUNT(*) AS total FROM events').get();
  if (Number(count.total || 0) > 0) {
    return;
  }

  database.prepare(`
    INSERT INTO events
      (title, slug, description, date_start, date_end, online_start, address, offline_capacity, facecast_event_id, facecast_url, is_active, created_at, updated_at)
    VALUES
      (:title, :slug, :description, :dateStart, :dateEnd, :onlineStart, :address, NULL, :facecastEventId, :facecastUrl, 1, :now, :now)
  `).run({
    title: 'Митап: Человек труда',
    slug: 'mitap-chelovek-truda-2026-06-23',
    description: '⚡Как превратить человека труда в героя, и зачем это бизнесу\n\n🔗Кто такой человек труда сегодня, и как он меняется.\n🔗Как внедрять культуру признания в командах.\n🔗Как говорить с молодыми талантами и превращать профессию в выбор, а не в компромисс.\n🔗Какие нестандартные имиджевые инструменты помогают привлечь внимание к рабочим профессиям и повысить их статус.\n🔗Почему профессиональные праздники — это стратегический актив бизнеса.\n🔗Как вовлечь детей сотрудников и растить гордость за дело родителей.\n\n😊 Мегаполис Медиа напоминает: каждый человек труда достоин стать его героем.',
    dateStart: '2026-06-23 17:30:00',
    dateEnd: '2026-06-23 21:00:00',
    onlineStart: '2026-06-23 18:00:00',
    address: 'Знаменка 13с1, этаж 7, офис 25',
    facecastEventId: '186673',
    facecastUrl: 'https://facecast.net/w/6k2njf',
    now: nowSql(),
  });
}

function ensureSqliteColumn(database, table, column, definition) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error('Invalid sqlite schema identifier');
  }

  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => row.name === column)) {
    return;
  }

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
