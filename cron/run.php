<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Megapolis\Services\TelegramClient;
use Megapolis\Support\Db;

$db = Db::pdo();
$telegram = new TelegramClient();

processScheduledMessages($db, $telegram);
processBroadcastMessages($db, $telegram);

function processScheduledMessages(PDO $db, TelegramClient $telegram): void
{
    $stmt = $db->query("
        SELECT
            sm.*,
            p.telegram_id,
            r.attendance,
            r.status,
            r.facecast_login,
            r.facecast_password,
            r.facecast_url,
            e.title,
            e.date_start,
            e.date_end,
            e.online_start,
            e.address,
            e.facecast_url AS event_facecast_url,
            e.recording_url,
            e.photo_album_url
        FROM scheduled_messages sm
        JOIN people p ON p.id = sm.person_id
        LEFT JOIN registrations r ON r.id = sm.registration_id
        LEFT JOIN events e ON e.id = sm.event_id
        WHERE sm.sent_at IS NULL
          AND sm.failed_at IS NULL
          AND sm.send_at <= CURRENT_TIMESTAMP
        ORDER BY sm.send_at ASC
        LIMIT 50
    ");

    foreach ($stmt->fetchAll() as $row) {
        try {
            if (scheduledMessageIsStale($row)) {
                $db->prepare('UPDATE scheduled_messages SET sent_at = :now, updated_at = :now WHERE id = :id')
                    ->execute(['now' => now(), 'id' => $row['id']]);
                continue;
            }

            [$text, $keyboard] = scheduledMessagePayload($row);
            $telegram->sendMessage((int) $row['telegram_id'], $text, $keyboard);
            $db->prepare('UPDATE scheduled_messages SET sent_at = :now, updated_at = :now WHERE id = :id')
                ->execute(['now' => now(), 'id' => $row['id']]);
        } catch (Throwable $e) {
            $db->prepare('UPDATE scheduled_messages SET failed_at = :now, error = :error, updated_at = :now WHERE id = :id')
                ->execute(['now' => now(), 'error' => $e->getMessage(), 'id' => $row['id']]);
        }
    }
}

function scheduledMessageIsStale(array $row): bool
{
    $type = (string) $row['type'];
    $attendance = (string) ($row['attendance'] ?? '');
    $status = (string) ($row['status'] ?? '');

    if (in_array($status, ['cancelled', 'rejected', 'no_show'], true)) {
        return true;
    }

    if (str_starts_with($type, 'offline_')) {
        return $attendance !== 'offline' || !in_array($status, ['approved', 'visited'], true);
    }

    if (str_starts_with($type, 'online_')) {
        return $attendance !== 'online' || $status !== 'approved';
    }

    if ($type === 'postpromo') {
        return !in_array($status, ['approved', 'visited'], true);
    }

    return false;
}

function processBroadcastMessages(PDO $db, TelegramClient $telegram): void
{
    $rows = $db->query("
        SELECT bm.*, c.content_type, c.body, c.media_file_id
        FROM broadcast_messages bm
        JOIN broadcast_campaigns c ON c.id = bm.campaign_id
        WHERE bm.status = 'queued'
        ORDER BY bm.id ASC
        LIMIT 60
    ")->fetchAll();

    foreach ($rows as $row) {
        try {
            if ($row['content_type'] === 'video_note' && $row['media_file_id']) {
                $telegram->sendVideoNote((int) $row['telegram_id'], (string) $row['media_file_id']);
            } elseif ($row['content_type'] === 'photo' && $row['media_file_id']) {
                $telegram->sendPhoto((int) $row['telegram_id'], (string) $row['media_file_id'], (string) $row['body']);
                $row['body'] = '';
            }

            if (trim((string) $row['body']) !== '') {
                $telegram->sendMessage((int) $row['telegram_id'], (string) $row['body']);
            }

            $db->prepare("UPDATE broadcast_messages SET status = 'sent', sent_at = :now, updated_at = :now WHERE id = :id")
                ->execute(['now' => now(), 'id' => $row['id']]);
        } catch (Throwable $e) {
            $db->prepare("UPDATE broadcast_messages SET status = 'failed', error = :error, updated_at = :now WHERE id = :id")
                ->execute(['error' => $e->getMessage(), 'now' => now(), 'id' => $row['id']]);
        }
    }

    $campaignIds = array_values(array_unique(array_map(static fn (array $row): int => (int) $row['campaign_id'], $rows)));
    foreach ($campaignIds as $campaignId) {
        $pending = $db->prepare("SELECT COUNT(*) FROM broadcast_messages WHERE campaign_id = :id AND status = 'queued'");
        $pending->execute(['id' => $campaignId]);
        if ((int) $pending->fetchColumn() === 0) {
            $failed = $db->prepare("SELECT COUNT(*) FROM broadcast_messages WHERE campaign_id = :id AND status = 'failed'");
            $failed->execute(['id' => $campaignId]);
            $status = (int) $failed->fetchColumn() > 0 ? 'failed' : 'sent';
            $db->prepare("UPDATE broadcast_campaigns SET status = :status, updated_at = :now WHERE id = :id")
                ->execute(['status' => $status, 'now' => now(), 'id' => $campaignId]);
        }
    }
}

function scheduledMessagePayload(array $row): array
{
    $url = (string) ($row['facecast_url'] ?: $row['event_facecast_url'] ?: env('FACECAST_DEFAULT_STREAM_URL', ''));
    $eventTitle = (string) $row['title'];
    $date = dateShort((string) $row['date_start']);
    $timeRange = 'с ' . date('H:i', strtotime((string) $row['date_start'])) . ' до ' . date('H:i', strtotime((string) $row['date_end']));
    $regId = (int) $row['registration_id'];

    return match ($row['type']) {
        'offline_1day' => [
            "Напоминаем о встрече завтра 🏢\n\n"
            . "Будем рады видеть вас на площадке:\n"
            . "<b>Название:</b> " . h($eventTitle) . "\n"
            . "<b>Дата:</b> " . h($date) . "\n"
            . "<b>Время:</b> " . h($timeRange) . "\n"
            . "<b>Адрес:</b> " . h((string) $row['address']) . "\n"
            . "<b>Формат:</b> офлайн",
            confirmKeyboard($regId),
        ],
        'offline_2hours' => [
            "До офлайн-встречи осталось около двух часов 🙂\n\n"
            . "Пожалуйста, заложите время на дорогу и ресепшн.\n\n"
            . "<b>Название:</b> " . h($eventTitle) . "\n"
            . "<b>Дата:</b> " . h($date) . "\n"
            . "<b>Время:</b> " . h($timeRange) . "\n"
            . "<b>Адрес:</b> " . h((string) $row['address']) . "\n"
            . "<b>Формат:</b> офлайн",
            confirmKeyboard($regId),
        ],
        'offline_started' => [
            "Начинаем! Рады видеть вас на мероприятии ✨\n\nЖелаем хорошего настроя, полезных знакомств и живого разговора.",
            [],
        ],
        'online_15min' => [
            'Напоминаем про эфир: начинаем через 15 минут 💻',
            onlineKeyboard($regId, $url),
        ],
        'online_started' => [
            "Мы начали! Добро пожаловать в прямой эфир 💻\n\nЗадавайте вопросы спикерам в чате трансляции.",
            onlineKeyboard($regId, $url),
        ],
        'postpromo' => [
            postpromoText($row),
            postpromoKeyboard($row, $url),
        ],
        default => ['Напоминание о мероприятии: ' . h($eventTitle), []],
    };
}

function confirmKeyboard(int $registrationId): array
{
    return [
        'inline_keyboard' => [
            [['text' => 'Всё ок! Буду.', 'callback_data' => 'still_come:' . $registrationId]],
            [['text' => 'Планы поменялись, не смогу.', 'callback_data' => 'cant_come:' . $registrationId]],
        ],
    ];
}

function onlineKeyboard(int $registrationId, string $url): array
{
    $buttons = [];
    if ($url !== '') {
        $buttons[] = [['text' => 'Ссылка на эфир', 'url' => $url]];
    }
    $buttons[] = [['text' => 'Напомнить логин и пароль', 'callback_data' => 'credentials:' . $registrationId]];
    $buttons[] = [['text' => 'Главное меню', 'callback_data' => 'main_menu']];

    return ['inline_keyboard' => $buttons];
}

function postpromoText(array $row): string
{
    $text = "Спасибо, что были с нами ✨\n\nДелимся материалами и яркими моментами прошедшего мероприятия.";

    if (!empty($row['recording_url'])) {
        $text .= "\n\nТакже можно посмотреть запись эфира, если хочется вернуться к главным мыслям.";
    }

    if (!empty($row['facecast_login'])) {
        $text .= "\n\n<b>Логин:</b> " . h((string) $row['facecast_login'])
            . "\n<b>Пароль:</b> " . h((string) $row['facecast_password']);
    }

    return $text . "\n\n<b>Название:</b> " . h((string) $row['title']);
}

function postpromoKeyboard(array $row, string $url): array
{
    $buttons = [];
    if ($url !== '') {
        $buttons[] = [['text' => 'Ссылка на эфир', 'url' => $url]];
    }
    if (!empty($row['photo_album_url'])) {
        $buttons[] = [['text' => 'Подборка фото', 'url' => (string) $row['photo_album_url']]];
    }
    $buttons[] = [['text' => 'Главное меню', 'callback_data' => 'main_menu']];

    return ['inline_keyboard' => $buttons];
}

function dateShort(string $value): string
{
    $months = [1 => 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    $ts = strtotime($value);
    return (int) date('j', $ts) . ' ' . $months[(int) date('n', $ts)];
}
