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
  online_start TEXT NULL,
  address TEXT NULL,
  venue_lat REAL NULL,
  venue_lng REAL NULL,
  offline_capacity INTEGER NULL,
  facecast_event_id TEXT NULL,
  facecast_url TEXT NULL,
  recording_url TEXT NULL,
  photo_album_url TEXT NULL,
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
  facecast_url TEXT NULL,
  rejection_reason TEXT NULL,
  approved_at TEXT NULL,
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

CREATE TABLE IF NOT EXISTS bot_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT NULL,
  created_at TEXT NOT NULL
);
