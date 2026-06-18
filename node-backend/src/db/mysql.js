import mysql from 'mysql2/promise';
import { config } from '../config.js';

let pool;

export function db() {
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
  const [rows] = await db().execute(sql, params);
  return rows;
}

export async function execute(sql, params = {}) {
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
