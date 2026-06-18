<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$database = storage_path('demo.sqlite');
if (is_file($database)) {
    unlink($database);
}

$pdo = new PDO('sqlite:' . $database);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(file_get_contents(base_path('database/sqlite_demo_schema.sql')));

$now = date('Y-m-d H:i:s');

$pdo->prepare("
    INSERT INTO events
        (title, slug, description, date_start, date_end, online_start, address, venue_lat, venue_lng,
         offline_capacity, facecast_url, recording_url, photo_album_url, is_active, created_at, updated_at)
    VALUES
        (:title, :slug, :description, :date_start, :date_end, :online_start, :address, :venue_lat, :venue_lng,
         :offline_capacity, :facecast_url, :recording_url, :photo_album_url, 1, :now, :now)
")->execute([
    'title' => 'Митап: Человек труда',
    'slug' => 'mitap-chelovek-truda-2026-06-23',
    'description' => "⚡Как превратить человека труда в героя, и зачем это бизнесу\n\n🔗Кто такой человек труда сегодня, и как он меняется.\n🔗Как внедрять культуру признания в командах.\n🔗Как говорить с молодыми талантами и превращать профессию в выбор, а не в компромисс.\n🔗Какие нестандартные имиджевые инструменты помогают привлечь внимание к рабочим профессиям и повысить их статус.\n🔗Почему профессиональные праздники — это стратегический актив бизнеса.\n🔗Как вовлечь детей сотрудников и растить гордость за дело родителей.\n\n😊 Мегаполис Медиа напоминает: каждый человек труда достоин стать его героем.",
    'date_start' => '2026-06-23 17:30:00',
    'date_end' => '2026-06-23 21:00:00',
    'online_start' => '2026-06-23 18:00:00',
    'address' => 'Знаменка 13с1, этаж 7, офис 25',
    'venue_lat' => 55.751244,
    'venue_lng' => 37.618423,
    'offline_capacity' => 60,
    'facecast_url' => 'https://facecast.net/demo',
    'recording_url' => 'https://facecast.net/demo/record',
    'photo_album_url' => 'https://megapolis.media',
    'now' => $now,
]);

$eventId = (int) $pdo->lastInsertId();

$people = [
    [
        1001001,
        'ivan_demo',
        'Иван Петров',
        'СтройТех',
        'HRD',
        '+7 999 111-22-33',
        'ivan@example.com',
        'offline',
        'pending',
        null,
        null,
        null,
    ],
    [
        1001002,
        'anna_demo',
        'Анна Смирнова',
        'ПромМедиа',
        'Директор по коммуникациям',
        '+7 999 444-55-66',
        'anna@example.com',
        'online',
        'approved',
        'anna@example.com',
        'MM-DEMO123',
        'https://facecast.net/demo',
    ],
    [
        1001003,
        null,
        'Сергей Волков',
        'Завод Север',
        'Руководитель PR',
        '+7 999 777-88-99',
        'sergey@example.com',
        'offline',
        'approved',
        null,
        null,
        null,
    ],
];

$insertPerson = $pdo->prepare("
    INSERT INTO people
        (telegram_id, username, first_name, last_name, full_name, company, position_title, phone, email,
         consent_accepted_at, state, last_seen_at, created_at, updated_at)
    VALUES
        (:telegram_id, :username, '', '', :full_name, :company, :position_title, :phone, :email,
         :now, 'registered', :now, :now, :now)
");
$insertRegistration = $pdo->prepare("
    INSERT INTO registrations
        (person_id, event_id, attendance, status, facecast_login, facecast_password, facecast_url, approved_at, created_at, updated_at)
    VALUES
        (:person_id, :event_id, :attendance, :status, :facecast_login, :facecast_password, :facecast_url, :approved_at, :now, :now)
");

foreach ($people as $person) {
    [$telegramId, $username, $name, $company, $position, $phone, $email, $attendance, $status, $login, $password, $url] = $person;
    $insertPerson->execute([
        'telegram_id' => $telegramId,
        'username' => $username,
        'full_name' => $name,
        'company' => $company,
        'position_title' => $position,
        'phone' => $phone,
        'email' => $email,
        'now' => $now,
    ]);
    $insertRegistration->execute([
        'person_id' => (int) $pdo->lastInsertId(),
        'event_id' => $eventId,
        'attendance' => $attendance,
        'status' => $status,
        'facecast_login' => $login,
        'facecast_password' => $password,
        'facecast_url' => $url,
        'approved_at' => $status === 'approved' ? $now : null,
        'now' => $now,
    ]);
}

echo "Demo SQLite database created: {$database}\n";
