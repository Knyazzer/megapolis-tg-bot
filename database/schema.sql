SET NAMES utf8mb4;
SET time_zone = '+03:00';

CREATE TABLE IF NOT EXISTS people (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username VARCHAR(255) NULL,
  first_name VARCHAR(255) NULL,
  last_name VARCHAR(255) NULL,
  full_name VARCHAR(255) NULL,
  company VARCHAR(255) NULL,
  position_title VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  consent_accepted_at DATETIME NULL,
  state VARCHAR(64) NOT NULL DEFAULT 'new',
  state_payload JSON NULL,
  chat_mode VARCHAR(20) NOT NULL DEFAULT 'bot',
  chat_mode_updated_at DATETIME NULL,
  chat_read_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_people_state (state),
  INDEX idx_people_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NULL,
  date_start DATETIME NOT NULL,
  date_end DATETIME NOT NULL,
  guest_arrival_at DATETIME NULL,
  online_start DATETIME NULL,
  address VARCHAR(500) NULL,
  venue_lat DECIMAL(10, 7) NULL,
  venue_lng DECIMAL(10, 7) NULL,
  offline_capacity INT UNSIGNED NULL,
  facecast_event_id VARCHAR(255) NULL,
  facecast_url VARCHAR(500) NULL,
  recording_url VARCHAR(500) NULL,
  photo_album_url VARCHAR(500) NULL,
  postpromo_message TEXT NULL,
  postpromo_send_at DATETIME NULL,
  offline_1day_send_at DATETIME NULL,
  offline_2hours_send_at DATETIME NULL,
  offline_started_send_at DATETIME NULL,
  online_15min_send_at DATETIME NULL,
  online_started_send_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_events_active_start (is_active, date_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registrations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  attendance ENUM('online','offline') NOT NULL,
  status ENUM('pending','approved','rejected','cancelled','visited','no_show') NOT NULL DEFAULT 'pending',
  facecast_login VARCHAR(255) NULL,
  facecast_password VARCHAR(255) NULL,
  facecast_ticket_id VARCHAR(255) NULL,
  facecast_url VARCHAR(500) NULL,
  facecast_watch_minutes INT UNSIGNED NULL,
  facecast_total_watch_minutes INT UNSIGNED NULL,
  facecast_stats_synced_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  approved_at DATETIME NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_registration_person_event (person_id, event_id),
  INDEX idx_registrations_event_status (event_id, status),
  INDEX idx_registrations_attendance (attendance),
  INDEX idx_registrations_archived (archived_at),
  CONSTRAINT fk_registrations_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT fk_registrations_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recording_accesses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'facecast',
  facecast_login VARCHAR(255) NULL,
  facecast_password VARCHAR(255) NULL,
  facecast_ticket_id VARCHAR(255) NULL,
  facecast_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_recording_access_person_event (person_id, event_id),
  INDEX idx_recording_access_event (event_id),
  INDEX idx_recording_access_source (source),
  CONSTRAINT fk_recording_access_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT fk_recording_access_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  registration_id BIGINT UNSIGNED NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  type VARCHAR(80) NOT NULL,
  send_at DATETIME NOT NULL,
  payload JSON NULL,
  sent_at DATETIME NULL,
  failed_at DATETIME NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_scheduled_registration_type (registration_id, type),
  INDEX idx_scheduled_due (send_at, sent_at, failed_at),
  CONSTRAINT fk_scheduled_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_scheduled_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT fk_scheduled_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  audience VARCHAR(80) NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  content_type ENUM('text','video_note','photo','video') NOT NULL DEFAULT 'text',
  body TEXT NULL,
  media_file_id VARCHAR(500) NULL,
  media_blob MEDIUMBLOB NULL,
  media_mime VARCHAR(100) NULL,
  media_name VARCHAR(255) NULL,
  media_size INT UNSIGNED NULL,
  status ENUM('draft','queued','sending','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_campaigns_status (status),
  CONSTRAINT fk_campaign_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  telegram_id BIGINT NOT NULL,
  status ENUM('queued','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
  sent_at DATETIME NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_campaign_person (campaign_id, person_id),
  INDEX idx_broadcast_messages_queue (status, id),
  CONSTRAINT fk_broadcast_campaign FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_broadcast_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT UNSIGNED NOT NULL,
  telegram_id BIGINT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  text TEXT NULL,
  media_file_id VARCHAR(500) NULL,
  media_name VARCHAR(255) NULL,
  media_mime VARCHAR(100) NULL,
  status ENUM('received','sent','failed') NOT NULL DEFAULT 'received',
  error TEXT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_chat_person_created (person_id, created_at),
  INDEX idx_chat_created (created_at),
  CONSTRAINT fk_chat_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level VARCHAR(20) NOT NULL,
  message VARCHAR(500) NOT NULL,
  context JSON NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_bot_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
