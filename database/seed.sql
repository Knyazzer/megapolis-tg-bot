SET NAMES utf8mb4;
SET time_zone = '+03:00';

INSERT INTO events (
  title,
  slug,
  description,
  date_start,
  date_end,
  online_start,
  address,
  offline_capacity,
  facecast_event_id,
  facecast_url,
  is_active,
  created_at,
  updated_at
) VALUES (
  'Митап: Человек труда',
  'mitap-chelovek-truda-2026-06-23',
  '⚡Как превратить человека труда в героя, и зачем это бизнесу\n\n🔗Кто такой человек труда сегодня, и как он меняется.\n🔗Как внедрять культуру признания в командах.\n🔗Как говорить с молодыми талантами и превращать профессию в выбор, а не в компромисс.\n🔗Какие нестандартные имиджевые инструменты помогают привлечь внимание к рабочим профессиям и повысить их статус.\n🔗Почему профессиональные праздники — это стратегический актив бизнеса.\n🔗Как вовлечь детей сотрудников и растить гордость за дело родителей.\n\n😊 Мегаполис Медиа напоминает: каждый человек труда достоин стать его героем.',
  '2026-06-23 17:30:00',
  '2026-06-23 21:00:00',
  '2026-06-23 18:00:00',
  'Знаменка 13с1, этаж 7, офис 25',
  NULL,
  '186673',
  'https://facecast.net/w/6k2njf',
  1,
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  date_start = VALUES(date_start),
  date_end = VALUES(date_end),
  online_start = VALUES(online_start),
  address = VALUES(address),
  facecast_event_id = VALUES(facecast_event_id),
  facecast_url = VALUES(facecast_url),
  updated_at = NOW();
