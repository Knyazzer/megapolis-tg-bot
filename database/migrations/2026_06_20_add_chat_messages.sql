CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT UNSIGNED NOT NULL,
  telegram_id BIGINT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  text TEXT NULL,
  status ENUM('received','sent','failed') NOT NULL DEFAULT 'received',
  error TEXT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_chat_person_created (person_id, created_at),
  INDEX idx_chat_created (created_at),
  CONSTRAINT fk_chat_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
