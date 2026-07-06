CREATE TABLE IF NOT EXISTS giveaways (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(160) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  prize VARCHAR(255) NULL,
  draw_at DATETIME NULL,
  result_url VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_giveaways_active_draw (is_active, draw_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS giveaway_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  giveaway_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  status ENUM('entered','winner','cancelled') NOT NULL DEFAULT 'entered',
  source VARCHAR(32) NOT NULL DEFAULT 'bot',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_giveaway_person (giveaway_id, person_id),
  INDEX idx_giveaway_entries_status (giveaway_id, status),
  INDEX idx_giveaway_entries_person (person_id),
  CONSTRAINT fk_giveaway_entry_giveaway FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE,
  CONSTRAINT fk_giveaway_entry_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO giveaways
  (slug, title, description, prize, draw_at, result_url, is_active, created_at, updated_at)
SELECT
  'intercomm-2026-naekk',
  'Розыгрыш 2 билетов на премию ИнтерКомм 2026',
  'В честь коллаборации Мегаполис Медиа и НАЭКК и выхода подкаста «Ларисочная беседка» — разговор о корпоративных коммуникациях без глянца, про профессию, решения и людей, которые за ними стоят.',
  '2 билета на XVII Международную премию в области корпоративных коммуникаций ИнтерКомм 2026',
  '2026-11-12 00:00:00',
  NULL,
  1,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM giveaways WHERE slug = 'intercomm-2026-naekk'
);
