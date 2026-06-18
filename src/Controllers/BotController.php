<?php

declare(strict_types=1);

namespace Megapolis\Controllers;

use Megapolis\Services\FacecastClient;
use Megapolis\Services\ReminderPlanner;
use Megapolis\Services\TelegramClient;
use Megapolis\Support\Db;
use PDO;
use Throwable;

final class BotController
{
    private PDO $db;
    private TelegramClient $telegram;
    private FacecastClient $facecast;
    private ReminderPlanner $planner;

    public function __construct()
    {
        $this->db = Db::pdo();
        $this->telegram = new TelegramClient();
        $this->facecast = new FacecastClient();
        $this->planner = new ReminderPlanner();
    }

    public function handle(array $update): void
    {
        try {
            if (isset($update['callback_query'])) {
                $this->handleCallback($update['callback_query']);
                return;
            }

            if (isset($update['message'])) {
                $this->handleMessage($update['message']);
            }
        } catch (Throwable $e) {
            log_line('Bot error: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
        }
    }

    private function handleMessage(array $message): void
    {
        $from = $message['from'] ?? [];
        if (empty($from['id']) || empty($message['chat']['id'])) {
            return;
        }

        $chatId = (int) $message['chat']['id'];
        $person = $this->upsertPerson($from);
        $text = trim((string) ($message['text'] ?? ''));

        if (isset($message['video_note']) && $this->isAdminTelegramId((int) $from['id'])) {
            $fileId = (string) ($message['video_note']['file_id'] ?? '');
            $this->telegram->sendMessage($chatId, "File ID кружка:\n<code>" . h($fileId) . '</code>');
            return;
        }

        if ($text === '/start' || $text === 'Главное меню') {
            $this->sendWelcomeOrMenu($chatId, $person);
            return;
        }

        if ($text === '/menu') {
            $this->sendMainMenu($chatId);
            return;
        }

        if ($text === '/events' || $text === 'Ближайшие мероприятия') {
            $this->sendEvents($chatId);
            return;
        }

        if (!$this->profileComplete($person)) {
            $this->continueRegistration($chatId, $person, $message);
            return;
        }

        $this->sendMainMenu($chatId);
    }

    private function handleCallback(array $callback): void
    {
        $from = $callback['from'] ?? [];
        $message = $callback['message'] ?? [];
        $chatId = (int) ($message['chat']['id'] ?? $from['id'] ?? 0);
        $data = (string) ($callback['data'] ?? '');

        if (!empty($callback['id'])) {
            $this->telegram->answerCallbackQuery((string) $callback['id']);
        }

        if ($chatId === 0 || empty($from['id'])) {
            return;
        }

        $person = $this->upsertPerson($from);

        if ($data === 'start_registration') {
            $this->setState((int) $person['id'], 'awaiting_consent');
            $this->sendConsent($chatId);
            return;
        }

        if ($data === 'consent_accept') {
            $this->acceptConsent((int) $person['id']);
            $this->setState((int) $person['id'], 'ask_name');
            $this->telegram->sendMessage($chatId, 'Спасибо! Давайте познакомимся 🙂 Напишите, пожалуйста, имя и фамилию.');
            return;
        }

        if ($data === 'main_menu') {
            $this->sendMainMenu($chatId);
            return;
        }

        if ($data === 'events') {
            if (!$this->ensureProfileReady($chatId, $person)) {
                return;
            }
            $this->sendEvents($chatId);
            return;
        }

        if (str_starts_with($data, 'event:')) {
            if (!$this->ensureProfileReady($chatId, $person)) {
                return;
            }
            $event = $this->findEvent((int) substr($data, 6));
            if ($event) {
                $this->sendEventDetails($chatId, $event);
            }
            return;
        }

        if (str_starts_with($data, 'reg_online:')) {
            if (!$this->ensureProfileReady($chatId, $person)) {
                return;
            }
            $event = $this->findEvent((int) substr($data, 11));
            if ($event) {
                $this->registerOnline($chatId, $person, $event);
            }
            return;
        }

        if (str_starts_with($data, 'reg_offline:')) {
            if (!$this->ensureProfileReady($chatId, $person)) {
                return;
            }
            $event = $this->findEvent((int) substr($data, 12));
            if ($event) {
                $this->registerOffline($chatId, $person, $event);
            }
            return;
        }

        if (str_starts_with($data, 'cant_come:')) {
            $this->switchRegistrationToOnline($chatId, $person, (int) substr($data, 10));
            return;
        }

        if (str_starts_with($data, 'still_come:')) {
            $this->telegram->sendMessage($chatId, 'Отлично, держим вас в списке гостей. Ждём на площадке 🙂');
            return;
        }

        if (str_starts_with($data, 'credentials:')) {
            $registration = $this->findRegistration((int) substr($data, 12));
            if ($registration && (int) $registration['person_id'] === (int) $person['id']) {
                $event = $this->findEvent((int) $registration['event_id']);
                if ($event) {
                    $this->sendOnlineAccess($chatId, $event, $registration);
                }
            }
        }
    }

    private function continueRegistration(int $chatId, array $person, array $message): void
    {
        $state = (string) ($person['state'] ?? 'new');
        $text = trim((string) ($message['text'] ?? ''));

        if ($state === 'new') {
            $this->sendWelcome($chatId);
            return;
        }

        if ($state === 'awaiting_consent') {
            $this->sendConsent($chatId);
            return;
        }

        if ($state === 'ask_name') {
            if (mb_strlen($text) < 2) {
                $this->telegram->sendMessage($chatId, 'Напишите, пожалуйста, имя и фамилию текстом, чтобы мы корректно оформили регистрацию.');
                return;
            }
            $this->updatePerson((int) $person['id'], ['full_name' => $text]);
            $this->setState((int) $person['id'], 'ask_company');
            $this->telegram->sendMessage($chatId, 'Из какой вы компании?');
            return;
        }

        if ($state === 'ask_company') {
            $this->updatePerson((int) $person['id'], ['company' => $text]);
            $this->setState((int) $person['id'], 'ask_position');
            $this->telegram->sendMessage($chatId, 'А какая у вас должность?');
            return;
        }

        if ($state === 'ask_position') {
            $this->updatePerson((int) $person['id'], ['position_title' => $text]);
            $this->setState((int) $person['id'], 'ask_phone');
            $this->telegram->sendMessage($chatId, 'Поделитесь, пожалуйста, номером телефона. Можно отправить его кнопкой ниже.', [
                'keyboard' => [[['text' => 'Отправить телефон', 'request_contact' => true]]],
                'resize_keyboard' => true,
                'one_time_keyboard' => true,
            ]);
            return;
        }

        if ($state === 'ask_phone') {
            $phone = (string) ($message['contact']['phone_number'] ?? $text);
            if (mb_strlen($phone) < 6) {
                $this->telegram->sendMessage($chatId, 'Кажется, это не номер телефона. Пришлите номер текстом или кнопкой, пожалуйста.');
                return;
            }
            $this->updatePerson((int) $person['id'], ['phone' => $phone]);
            $this->setState((int) $person['id'], 'ask_email');
            $this->telegram->sendMessage($chatId, 'И последний шаг: напишите вашу почту.', ['remove_keyboard' => true]);
            return;
        }

        if ($state === 'ask_email') {
            if (!filter_var($text, FILTER_VALIDATE_EMAIL)) {
                $this->telegram->sendMessage($chatId, 'Почта выглядит непривычно. Напишите email в формате name@example.com.');
                return;
            }
            $this->updatePerson((int) $person['id'], ['email' => mb_strtolower($text)]);
            $this->setState((int) $person['id'], 'registered');
            $this->telegram->sendMessage($chatId, 'Готово, спасибо! Теперь можно выбрать мероприятие ✨', $this->eventsMenuKeyboard());
            return;
        }

        $this->sendMainMenu($chatId);
    }

    private function sendWelcomeOrMenu(int $chatId, array $person): void
    {
        if ($this->profileComplete($person)) {
            $this->sendMainMenu($chatId);
            return;
        }

        $this->sendWelcome($chatId);
    }

    private function sendWelcome(int $chatId): void
    {
        $text = "Здравствуйте! Это бот Мегаполис Медиа 👋\n\n"
            . "Здесь можно зарегистрироваться на наши митапы, эфиры и деловые встречи.\n\n"
            . "Давайте познакомимся, чтобы мы могли корректно оформить вашу регистрацию.";

        $this->telegram->sendMessage($chatId, $text, [
            'inline_keyboard' => [
                [['text' => 'Зарегистрироваться', 'callback_data' => 'start_registration']],
                [['text' => 'Главное меню', 'callback_data' => 'main_menu']],
            ],
        ]);
    }

    private function sendConsent(int $chatId): void
    {
        $this->telegram->sendMessage($chatId, $this->consentText(), [
            'inline_keyboard' => [
                [['text' => 'Даю согласие', 'callback_data' => 'consent_accept']],
                [['text' => 'Главное меню', 'callback_data' => 'main_menu']],
            ],
        ]);
    }

    private function sendMainMenu(int $chatId): void
    {
        $this->telegram->sendMessage($chatId, 'Что посмотрим дальше? Мы рядом в соцсетях и на сайте 🙂', [
            'inline_keyboard' => [
                [['text' => 'Телеграм канал', 'url' => (string) env('TELEGRAM_CHANNEL_URL', 'https://t.me/megapolismedia')]],
                [['text' => 'Сайт', 'url' => (string) env('COMPANY_SITE_URL', 'https://megapolis.media')]],
                [['text' => 'Ближайшие мероприятия', 'callback_data' => 'events']],
            ],
        ]);
    }

    private function sendEvents(int $chatId): void
    {
        $stmt = $this->db->prepare("
            SELECT *
            FROM events
            WHERE is_active = 1 AND date_end >= :threshold
            ORDER BY date_start ASC
            LIMIT 10
        ");
        $stmt->execute(['threshold' => date('Y-m-d H:i:s', strtotime('-1 day'))]);
        $events = $stmt->fetchAll();

        if ($events === []) {
            $this->telegram->sendMessage($chatId, 'Пока ближайших мероприятий нет. Как только появится новое событие, мы обязательно расскажем 🙂', $this->mainMenuKeyboard());
            return;
        }

        if (count($events) === 1) {
            $this->sendEventDetails($chatId, $events[0]);
            return;
        }

        $buttons = [];
        foreach ($events as $event) {
            $buttons[] = [[
                'text' => $event['title'] . ' - ' . $this->formatDate((string) $event['date_start']),
                'callback_data' => 'event:' . $event['id'],
            ]];
        }
        $buttons[] = [['text' => 'Главное меню', 'callback_data' => 'main_menu']];

        $this->telegram->sendMessage($chatId, 'Выберите мероприятие, на которое хотите зарегистрироваться:', ['inline_keyboard' => $buttons]);
    }

    private function sendEventDetails(int $chatId, array $event): void
    {
        $buttons = $this->eventFormatKeyboard($event);
        $text = "Отлично, вот что запланировано:\n\n"
            . '<b>Название:</b> ' . h((string) $event['title']) . "\n"
            . '<b>Дата:</b> ' . h($this->formatDate((string) $event['date_start'])) . "\n"
            . '<b>Время:</b> ' . h($this->formatTimeRange((string) $event['date_start'], (string) $event['date_end'])) . "\n"
            . '<b>Формат:</b> ' . h($this->eventFormatLabel($event)) . "\n\n"
            . h((string) $event['description']);

        if (count($buttons['inline_keyboard']) > 1) {
            $text .= "\n\nВыберите удобный формат участия:";
        } else {
            $text .= "\n\nСейчас регистрация на это событие недоступна. Можно вернуться в меню.";
        }

        $this->telegram->sendMessage($chatId, $text, $buttons);
    }

    private function registerOffline(int $chatId, array $person, array $event): void
    {
        if (!$this->eventSupportsOffline($event)) {
            $this->telegram->sendMessage($chatId, 'Для этого события офлайн-участие не предусмотрено. Выберите другой доступный формат, пожалуйста.', $this->eventFormatKeyboard($event));
            return;
        }

        $existing = $this->findRegistrationForPersonEvent((int) $person['id'], (int) $event['id']);
        if ($existing && (string) $existing['attendance'] === 'offline') {
            if ((string) $existing['status'] === 'pending') {
                $this->telegram->sendMessage($chatId, 'Ваша заявка на офлайн-участие уже на проверке. Как только модератор подтвердит список гостей, мы пришлём детали 🙂', $this->mainMenuKeyboard());
                return;
            }

            if (in_array((string) $existing['status'], ['approved', 'visited'], true)) {
                $this->sendOfflineAlreadyConfirmed($chatId, $event);
                return;
            }
        }

        $registration = $this->upsertRegistration((int) $person['id'], (int) $event['id'], 'offline', 'pending');
        $this->planner->cancelAll($registration);

        $text = "Спасибо, заявка на офлайн-участие принята 🏢\n\n"
            . "Организаторы проверят список гостей и пришлют подтверждение. Адрес и детали площадки отправим после аппрува.";

        $this->telegram->sendMessage($chatId, $text, $this->mainMenuKeyboard());
        $this->notifyAdminsAboutOfflineRequest($person, $event, $registration);
    }

    private function registerOnline(int $chatId, array $person, array $event): void
    {
        if (!$this->eventSupportsOnline($event)) {
            $this->telegram->sendMessage($chatId, 'Для этого события онлайн-участие не предусмотрено. Выберите другой доступный формат, пожалуйста.', $this->eventFormatKeyboard($event));
            return;
        }

        $existing = $this->findRegistrationForPersonEvent((int) $person['id'], (int) $event['id']);
        if ($existing
            && (string) $existing['attendance'] === 'online'
            && (string) $existing['status'] === 'approved'
            && trim((string) $existing['facecast_login']) !== ''
        ) {
            $this->sendOnlineAccess($chatId, $event, $existing);
            return;
        }

        $registration = $this->upsertRegistration((int) $person['id'], (int) $event['id'], 'online', 'approved');
        $credentials = $this->facecast->registerViewer($event, $person);

        $this->db->prepare("
            UPDATE registrations
            SET facecast_login = :login,
                facecast_password = :password,
                facecast_url = :url,
                approved_at = COALESCE(approved_at, :now),
                updated_at = :now
            WHERE id = :id
        ")->execute([
            'login' => $credentials['login'],
            'password' => $credentials['password'],
            'url' => $credentials['url'],
            'now' => now(),
            'id' => $registration['id'],
        ]);

        $registration = $this->findRegistration((int) $registration['id']);
        $this->planner->planOnline($registration, $event);
        $this->sendOnlineAccess($chatId, $event, $registration);
    }

    private function switchRegistrationToOnline(int $chatId, array $person, int $registrationId): void
    {
        $registration = $this->findRegistration($registrationId);
        if (!$registration || (int) $registration['person_id'] !== (int) $person['id']) {
            $this->telegram->sendMessage($chatId, 'Не нашли вашу регистрацию. Откройте ближайшие мероприятия из меню, пожалуйста.');
            return;
        }

        $event = $this->findEvent((int) $registration['event_id']);
        if (!$event) {
            return;
        }

        if (!$this->eventSupportsOnline($event)) {
            $this->telegram->sendMessage($chatId, 'Понимаем, планы меняются. У этого события нет онлайн-формата, поэтому просто снимем вас с офлайн-списка у модераторов.');
            $this->db->prepare("
                UPDATE registrations
                SET status = 'cancelled', updated_at = :now
                WHERE id = :id
            ")->execute(['now' => now(), 'id' => $registrationId]);
            $this->planner->cancelAll($registration);
            return;
        }

        $this->telegram->sendMessage($chatId, 'Конечно, планы меняются. Переключаем вас на онлайн-участие 💻');
        $this->db->prepare("
            UPDATE registrations
            SET attendance = 'online', status = 'approved', updated_at = :now
            WHERE id = :id
        ")->execute(['now' => now(), 'id' => $registrationId]);

        $this->registerOnline($chatId, $person, $event);
    }

    private function sendOnlineAccess(int $chatId, array $event, array $registration): void
    {
        $url = (string) ($registration['facecast_url'] ?: $event['facecast_url'] ?: env('FACECAST_DEFAULT_STREAM_URL', ''));

        $text = "Готово, вы зарегистрированы онлайн! 💻\n\n"
            . "Данные для подключения:\n"
            . '<b>Логин:</b> ' . h((string) $registration['facecast_login']) . "\n"
            . '<b>Пароль:</b> ' . h((string) $registration['facecast_password']) . "\n"
            . '<b>Название:</b> ' . h((string) $event['title']) . "\n"
            . '<b>Дата:</b> ' . h($this->formatDate((string) $event['date_start'])) . "\n"
            . '<b>Время подключения:</b> ' . h(date('H:i', strtotime((string) ($event['online_start'] ?: $event['date_start'])))) . "\n\n"
            . "Сохраните сообщение, а перед эфиром мы напомним о старте.";

        $buttons = [];
        if ($url !== '') {
            $buttons[] = [['text' => 'Ссылка на эфир', 'url' => $url]];
        }
        $buttons[] = [['text' => 'Главное меню', 'callback_data' => 'main_menu']];

        $this->telegram->sendMessage($chatId, $text, ['inline_keyboard' => $buttons]);
    }

    private function sendOfflineAlreadyConfirmed(int $chatId, array $event): void
    {
        $text = "Вы уже в списке офлайн-гостей 🏢\n\n"
            . "Ждём вас на мероприятии:\n"
            . '<b>Название:</b> ' . h((string) $event['title']) . "\n"
            . '<b>Дата:</b> ' . h($this->formatDate((string) $event['date_start'])) . "\n"
            . '<b>Время:</b> ' . h($this->formatTimeRange((string) $event['date_start'], (string) $event['date_end'])) . "\n"
            . '<b>Наш адрес:</b> ' . h((string) $event['address']) . "\n"
            . '<b>Формат:</b> офлайн';

        $this->telegram->sendMessage($chatId, $text, $this->mainMenuKeyboard());
    }

    private function notifyAdminsAboutOfflineRequest(array $person, array $event, array $registration): void
    {
        $ids = $this->adminTelegramIds();
        if ($ids === []) {
            return;
        }

        $text = "Новая офлайн-регистрация:\n\n"
            . '<b>Мероприятие:</b> ' . h((string) $event['title']) . "\n"
            . '<b>Участник:</b> ' . h((string) $person['full_name']) . "\n"
            . '<b>Компания:</b> ' . h((string) $person['company']) . "\n"
            . '<b>Должность:</b> ' . h((string) $person['position_title']) . "\n"
            . '<b>Телефон:</b> ' . h((string) $person['phone']) . "\n"
            . '<b>Email:</b> ' . h((string) $person['email']) . "\n\n"
            . 'Аппрув делается в админке: ' . h(app_url('/?page=registrations&event_id=' . $event['id']));

        foreach ($ids as $id) {
            $this->telegram->sendMessage($id, $text);
        }
    }

    private function ensureProfileReady(int $chatId, array $person): bool
    {
        if ($this->profileComplete($person)) {
            return true;
        }

        $this->telegram->sendMessage($chatId, 'Сначала давайте познакомимся, чтобы корректно оформить регистрацию.', [
            'inline_keyboard' => [
                [['text' => 'Зарегистрироваться', 'callback_data' => 'start_registration']],
            ],
        ]);

        return false;
    }

    private function upsertPerson(array $from): array
    {
        $telegramId = (int) $from['id'];
        $stmt = $this->db->prepare('SELECT * FROM people WHERE telegram_id = :telegram_id LIMIT 1');
        $stmt->execute(['telegram_id' => $telegramId]);
        $person = $stmt->fetch();

        if ($person) {
            $this->db->prepare("
                UPDATE people
                SET username = :username,
                    first_name = :first_name,
                    last_name = :last_name,
                    last_seen_at = :now,
                    updated_at = :now
                WHERE id = :id
            ")->execute([
                'username' => $from['username'] ?? null,
                'first_name' => $from['first_name'] ?? null,
                'last_name' => $from['last_name'] ?? null,
                'now' => now(),
                'id' => $person['id'],
            ]);

            $stmt->execute(['telegram_id' => $telegramId]);
            return $stmt->fetch();
        }

        $this->db->prepare("
            INSERT INTO people
                (telegram_id, username, first_name, last_name, state, last_seen_at, created_at, updated_at)
            VALUES
                (:telegram_id, :username, :first_name, :last_name, 'new', :now, :now, :now)
        ")->execute([
            'telegram_id' => $telegramId,
            'username' => $from['username'] ?? null,
            'first_name' => $from['first_name'] ?? null,
            'last_name' => $from['last_name'] ?? null,
            'now' => now(),
        ]);

        $stmt->execute(['telegram_id' => $telegramId]);
        return $stmt->fetch();
    }

    private function upsertRegistration(int $personId, int $eventId, string $attendance, string $status): array
    {
        $driver = (string) $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $sql = "
                INSERT INTO registrations
                    (person_id, event_id, attendance, status, approved_at, created_at, updated_at)
                VALUES
                    (:person_id, :event_id, :attendance, :status, :approved_at, :now, :now)
                ON CONFLICT(person_id, event_id) DO UPDATE SET
                    attendance = excluded.attendance,
                    status = excluded.status,
                    approved_at = excluded.approved_at,
                    updated_at = excluded.updated_at
            ";
        } else {
            $sql = "
                INSERT INTO registrations
                    (person_id, event_id, attendance, status, approved_at, created_at, updated_at)
                VALUES
                    (:person_id, :event_id, :attendance, :status, :approved_at, :now, :now)
                ON DUPLICATE KEY UPDATE
                    attendance = VALUES(attendance),
                    status = VALUES(status),
                    approved_at = VALUES(approved_at),
                    updated_at = VALUES(updated_at)
            ";
        }

        $this->db->prepare($sql)->execute([
            'person_id' => $personId,
            'event_id' => $eventId,
            'attendance' => $attendance,
            'status' => $status,
            'approved_at' => $status === 'approved' ? now() : null,
            'now' => now(),
        ]);

        $stmt = $this->db->prepare('SELECT * FROM registrations WHERE person_id = :person_id AND event_id = :event_id LIMIT 1');
        $stmt->execute(['person_id' => $personId, 'event_id' => $eventId]);
        return $stmt->fetch();
    }

    private function eventFormatKeyboard(array $event): array
    {
        $buttons = [];
        if ($this->eventSupportsOffline($event)) {
            $buttons[] = [['text' => '🏢 Прийти офлайн', 'callback_data' => 'reg_offline:' . $event['id']]];
        }
        if ($this->eventSupportsOnline($event)) {
            $buttons[] = [['text' => '💻 Смотреть онлайн', 'callback_data' => 'reg_online:' . $event['id']]];
        }
        $buttons[] = [['text' => 'Главное меню', 'callback_data' => 'main_menu']];

        return ['inline_keyboard' => $buttons];
    }

    private function eventFormatLabel(array $event): string
    {
        $offline = $this->eventSupportsOffline($event);
        $online = $this->eventSupportsOnline($event);

        if ($offline && $online) {
            return 'офлайн + онлайн';
        }
        if ($offline) {
            return 'только офлайн';
        }
        if ($online) {
            return 'только онлайн';
        }

        return 'уточняется';
    }

    private function eventSupportsOffline(array $event): bool
    {
        return trim((string) ($event['address'] ?? '')) !== ''
            || (($event['offline_capacity'] ?? null) !== null && (string) $event['offline_capacity'] !== '');
    }

    private function eventSupportsOnline(array $event): bool
    {
        return trim((string) ($event['online_start'] ?? '')) !== ''
            || trim((string) ($event['facecast_event_id'] ?? '')) !== ''
            || trim((string) ($event['facecast_url'] ?? '')) !== '';
    }

    private function findEvent(int $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM events WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $event = $stmt->fetch();

        return $event ?: null;
    }

    private function findRegistration(int $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM registrations WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $registration = $stmt->fetch();

        return $registration ?: null;
    }

    private function findRegistrationForPersonEvent(int $personId, int $eventId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM registrations WHERE person_id = :person_id AND event_id = :event_id LIMIT 1');
        $stmt->execute(['person_id' => $personId, 'event_id' => $eventId]);
        $registration = $stmt->fetch();

        return $registration ?: null;
    }

    private function updatePerson(int $id, array $fields): void
    {
        $allowed = ['full_name', 'company', 'position_title', 'phone', 'email'];
        $sets = [];
        $params = ['id' => $id, 'now' => now()];

        foreach ($fields as $field => $value) {
            if (!in_array($field, $allowed, true)) {
                continue;
            }
            $sets[] = "{$field} = :{$field}";
            $params[$field] = $value;
        }

        if ($sets === []) {
            return;
        }

        $sql = 'UPDATE people SET ' . implode(', ', $sets) . ', updated_at = :now WHERE id = :id';
        $this->db->prepare($sql)->execute($params);
    }

    private function setState(int $personId, string $state): void
    {
        $this->db->prepare('UPDATE people SET state = :state, updated_at = :now WHERE id = :id')
            ->execute(['state' => $state, 'now' => now(), 'id' => $personId]);
    }

    private function acceptConsent(int $personId): void
    {
        $this->db->prepare('UPDATE people SET consent_accepted_at = :now, updated_at = :now WHERE id = :id')
            ->execute(['now' => now(), 'id' => $personId]);
    }

    private function profileComplete(array $person): bool
    {
        return !empty($person['consent_accepted_at'])
            && !empty($person['full_name'])
            && !empty($person['company'])
            && !empty($person['position_title'])
            && !empty($person['phone'])
            && !empty($person['email']);
    }

    private function mainMenuKeyboard(): array
    {
        return [
            'inline_keyboard' => [
                [['text' => 'Главное меню', 'callback_data' => 'main_menu']],
            ],
        ];
    }

    private function eventsMenuKeyboard(): array
    {
        return [
            'inline_keyboard' => [
                [['text' => 'Ближайшие мероприятия', 'callback_data' => 'events']],
                [['text' => 'Главное меню', 'callback_data' => 'main_menu']],
            ],
        ];
    }

    private function formatDate(string $date): string
    {
        $months = [
            1 => 'января',
            2 => 'февраля',
            3 => 'марта',
            4 => 'апреля',
            5 => 'мая',
            6 => 'июня',
            7 => 'июля',
            8 => 'августа',
            9 => 'сентября',
            10 => 'октября',
            11 => 'ноября',
            12 => 'декабря',
        ];

        $ts = strtotime($date);
        return (int) date('j', $ts) . ' ' . $months[(int) date('n', $ts)];
    }

    private function formatTimeRange(string $start, string $end): string
    {
        return 'с ' . date('H:i', strtotime($start)) . ' до ' . date('H:i', strtotime($end));
    }

    private function adminTelegramIds(): array
    {
        $raw = (string) env('ADMIN_TELEGRAM_IDS', '');
        if ($raw === '') {
            return [];
        }

        return array_values(array_filter(array_map(
            static fn (string $id): int => (int) trim($id),
            explode(',', $raw)
        )));
    }

    private function isAdminTelegramId(int $telegramId): bool
    {
        return in_array($telegramId, $this->adminTelegramIds(), true);
    }

    private function consentText(): string
    {
        return 'Перед регистрацией нужно согласие на обработку персональных данных. '
            . 'Мы будем использовать ваши ФИО, компанию, должность, телефон и email для регистрации на мероприятия, коммуникации, допуска к эфиру и отправки материалов. '
            . 'Оператор: ООО «Мегаполис Медиа», ИНН 7710750836, ОГРН 1097746299034. '
            . 'Согласие действует 3 года и может быть отозвано в порядке, предусмотренном законодательством РФ.'
            . "\n\nПолный текст: " . h($this->privacyUrl());
    }

    private function privacyUrl(): string
    {
        $url = trim((string) env('PRIVACY_URL', ''));
        return $url !== '' ? $url : 'https://martis.pro/privacy.php';
    }
}
