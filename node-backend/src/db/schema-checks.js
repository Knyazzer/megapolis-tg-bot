import { execute, isSqlite, queryOne } from './mysql.js';

const REQUIRED_COLUMNS = [
  ['people', 'username', 'VARCHAR(255) NULL AFTER telegram_id'],
  ['people', 'first_name', 'VARCHAR(255) NULL AFTER username'],
  ['people', 'last_name', 'VARCHAR(255) NULL AFTER first_name'],
  ['people', 'full_name', 'VARCHAR(255) NULL AFTER last_name'],
  ['people', 'company', 'VARCHAR(255) NULL AFTER full_name'],
  ['people', 'position_title', 'VARCHAR(255) NULL AFTER company'],
  ['people', 'phone', 'VARCHAR(64) NULL AFTER position_title'],
  ['people', 'email', 'VARCHAR(255) NULL AFTER phone'],
  ['people', 'consent_accepted_at', 'DATETIME NULL AFTER email'],
  ['people', 'state', "VARCHAR(64) NOT NULL DEFAULT 'new' AFTER consent_accepted_at"],
  ['people', 'state_payload', 'JSON NULL AFTER state'],
  ['people', 'last_seen_at', 'DATETIME NULL AFTER state_payload'],
  ['people', 'created_at', 'DATETIME NULL AFTER last_seen_at'],
  ['people', 'updated_at', 'DATETIME NULL AFTER created_at'],

  ['events', 'slug', 'VARCHAR(255) NULL AFTER title'],
  ['events', 'description', 'TEXT NULL AFTER slug'],
  ['events', 'date_end', 'DATETIME NULL AFTER date_start'],
  ['events', 'online_start', 'DATETIME NULL AFTER date_end'],
  ['events', 'address', 'VARCHAR(500) NULL AFTER online_start'],
  ['events', 'venue_lat', 'DECIMAL(10, 7) NULL AFTER address'],
  ['events', 'venue_lng', 'DECIMAL(10, 7) NULL AFTER venue_lat'],
  ['events', 'offline_capacity', 'INT UNSIGNED NULL AFTER venue_lng'],
  ['events', 'facecast_event_id', 'VARCHAR(255) NULL AFTER offline_capacity'],
  ['events', 'facecast_url', 'VARCHAR(500) NULL AFTER facecast_event_id'],
  ['events', 'recording_url', 'VARCHAR(500) NULL AFTER facecast_url'],
  ['events', 'photo_album_url', 'VARCHAR(500) NULL AFTER recording_url'],
  ['events', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER photo_album_url'],
  ['events', 'created_at', 'DATETIME NULL AFTER is_active'],
  ['events', 'updated_at', 'DATETIME NULL AFTER created_at'],

  ['registrations', 'attendance', "ENUM('online','offline') NOT NULL DEFAULT 'online' AFTER event_id"],
  ['registrations', 'status', "ENUM('pending','approved','rejected','cancelled','visited','no_show') NOT NULL DEFAULT 'pending' AFTER attendance"],
  ['registrations', 'facecast_login', 'VARCHAR(255) NULL AFTER status'],
  ['registrations', 'facecast_password', 'VARCHAR(255) NULL AFTER facecast_login'],
  ['registrations', 'facecast_ticket_id', 'VARCHAR(255) NULL AFTER facecast_password'],
  ['registrations', 'facecast_url', 'VARCHAR(500) NULL AFTER facecast_ticket_id'],
  ['registrations', 'rejection_reason', 'VARCHAR(500) NULL AFTER facecast_url'],
  ['registrations', 'approved_at', 'DATETIME NULL AFTER rejection_reason'],
  ['registrations', 'archived_at', 'DATETIME NULL AFTER approved_at'],
  ['registrations', 'created_at', 'DATETIME NULL AFTER archived_at'],
  ['registrations', 'updated_at', 'DATETIME NULL AFTER created_at'],

  ['scheduled_messages', 'payload', 'JSON NULL AFTER send_at'],
  ['scheduled_messages', 'sent_at', 'DATETIME NULL AFTER payload'],
  ['scheduled_messages', 'failed_at', 'DATETIME NULL AFTER sent_at'],
  ['scheduled_messages', 'error', 'TEXT NULL AFTER failed_at'],
  ['scheduled_messages', 'created_at', 'DATETIME NULL AFTER error'],
  ['scheduled_messages', 'updated_at', 'DATETIME NULL AFTER created_at'],

  ['broadcast_campaigns', 'content_type', "ENUM('text','video_note','photo','video') NOT NULL DEFAULT 'text' AFTER event_id"],
  ['broadcast_campaigns', 'body', 'TEXT NULL AFTER content_type'],
  ['broadcast_campaigns', 'media_file_id', 'VARCHAR(500) NULL AFTER body'],
  ['broadcast_campaigns', 'status', "ENUM('draft','queued','sending','sent','failed') NOT NULL DEFAULT 'queued' AFTER media_file_id"],
  ['broadcast_campaigns', 'created_at', 'DATETIME NULL AFTER status'],
  ['broadcast_campaigns', 'updated_at', 'DATETIME NULL AFTER created_at'],

  ['broadcast_messages', 'status', "ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued' AFTER telegram_id"],
  ['broadcast_messages', 'sent_at', 'DATETIME NULL AFTER status'],
  ['broadcast_messages', 'error', 'TEXT NULL AFTER sent_at'],
  ['broadcast_messages', 'created_at', 'DATETIME NULL AFTER error'],
  ['broadcast_messages', 'updated_at', 'DATETIME NULL AFTER created_at'],
];

const REQUIRED_INDEXES = [
  ['people', 'idx_people_state', 'CREATE INDEX idx_people_state ON people (state)'],
  ['people', 'idx_people_email', 'CREATE INDEX idx_people_email ON people (email)'],
  ['events', 'idx_events_active_start', 'CREATE INDEX idx_events_active_start ON events (is_active, date_start)'],
  ['registrations', 'idx_registrations_event_status', 'CREATE INDEX idx_registrations_event_status ON registrations (event_id, status)'],
  ['registrations', 'idx_registrations_attendance', 'CREATE INDEX idx_registrations_attendance ON registrations (attendance)'],
  ['registrations', 'idx_registrations_archived', 'CREATE INDEX idx_registrations_archived ON registrations (archived_at)'],
  ['scheduled_messages', 'idx_scheduled_due', 'CREATE INDEX idx_scheduled_due ON scheduled_messages (send_at, sent_at, failed_at)'],
  ['broadcast_campaigns', 'idx_campaigns_status', 'CREATE INDEX idx_campaigns_status ON broadcast_campaigns (status)'],
  ['broadcast_messages', 'idx_broadcast_messages_queue', 'CREATE INDEX idx_broadcast_messages_queue ON broadcast_messages (status, id)'],
];

export async function migrateMysqlSchema() {
  if (isSqlite()) {
    return;
  }

  for (const [table, column, definition] of REQUIRED_COLUMNS) {
    await ensureColumn(table, column, definition);
  }

  await ensureEnumValue(
    'registrations',
    'status',
    ['pending', 'approved', 'rejected', 'cancelled', 'visited', 'no_show'],
    "ALTER TABLE registrations MODIFY status ENUM('pending','approved','rejected','cancelled','visited','no_show') NOT NULL DEFAULT 'pending'",
  );
  await ensureEnumValue(
    'broadcast_campaigns',
    'content_type',
    ['text', 'video_note', 'photo', 'video'],
    "ALTER TABLE broadcast_campaigns MODIFY content_type ENUM('text','video_note','photo','video') NOT NULL DEFAULT 'text'",
  );

  for (const [table, indexName, sql] of REQUIRED_INDEXES) {
    await ensureIndex(table, indexName, sql);
  }

  await execute('UPDATE people SET state = COALESCE(state, :state)', { state: 'new' });
  await execute('UPDATE events SET is_active = COALESCE(is_active, 1)');
  await execute('UPDATE events SET date_end = date_start WHERE date_end IS NULL AND date_start IS NOT NULL');
}

export async function mysqlSchemaDiagnostics() {
  if (isSqlite()) {
    return { ok: true, driver: 'sqlite', missing_columns: [], missing_indexes: [] };
  }

  const missingColumns = [];
  for (const [table, column] of REQUIRED_COLUMNS) {
    if (!(await columnExists(table, column))) {
      missingColumns.push(`${table}.${column}`);
    }
  }

  const missingIndexes = [];
  for (const [table, indexName] of REQUIRED_INDEXES) {
    if (!(await indexExists(table, indexName))) {
      missingIndexes.push(`${table}.${indexName}`);
    }
  }

  const enumIssues = [];
  if (!(await enumHasValues('registrations', 'status', ['visited', 'no_show']))) {
    enumIssues.push('registrations.status');
  }
  if (!(await enumHasValues('broadcast_campaigns', 'content_type', ['photo', 'video']))) {
    enumIssues.push('broadcast_campaigns.content_type');
  }

  return {
    ok: missingColumns.length === 0 && missingIndexes.length === 0 && enumIssues.length === 0,
    driver: 'mysql',
    missing_columns: missingColumns,
    missing_indexes: missingIndexes,
    enum_issues: enumIssues,
  };
}

async function ensureColumn(table, column, definition) {
  if (await columnExists(table, column)) {
    return;
  }

  try {
    await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Applied migration: add ${table}.${column}`);
  } catch (error) {
    if (error?.code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }
}

async function ensureIndex(table, indexName, sql) {
  if (await indexExists(table, indexName)) {
    return;
  }

  try {
    await execute(sql);
    console.log(`Applied migration: add ${table}.${indexName}`);
  } catch (error) {
    if (error?.code !== 'ER_DUP_KEYNAME') {
      throw error;
    }
  }
}

async function ensureEnumValue(table, column, values, sql) {
  if (await enumHasValues(table, column, values)) {
    return;
  }

  await execute(sql);
  console.log(`Applied migration: update ${table}.${column} enum`);
}

async function columnExists(table, column) {
  const row = await queryOne(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column`,
    { table, column },
  );
  return Number(row?.total || 0) > 0;
}

async function indexExists(table, indexName) {
  const row = await queryOne(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND INDEX_NAME = :indexName`,
    { table, indexName },
  );
  return Number(row?.total || 0) > 0;
}

async function enumHasValues(table, column, values) {
  const row = await queryOne(
    `SELECT COLUMN_TYPE AS columnType
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    { table, column },
  );
  const type = String(row?.columnType || '');
  return values.every((value) => type.includes(`'${value}'`));
}
