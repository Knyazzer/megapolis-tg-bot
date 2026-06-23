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
