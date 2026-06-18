<?php

declare(strict_types=1);

namespace Megapolis\Controllers;

use Megapolis\Services\ReminderPlanner;
use Megapolis\Services\TelegramClient;
use Megapolis\Support\Auth;
use Megapolis\Support\Csrf;
use Megapolis\Support\Db;
use PDO;
use Throwable;

final class AdminController
{
    private const FLOW_NODE_WIDTH = 320;
    private const FLOW_NODE_HEIGHT = 330;
    private const FLOW_CONNECTOR_GAP = 10;

    private PDO $db;
    private TelegramClient $telegram;
    private ReminderPlanner $planner;

    public function __construct()
    {
        $this->db = Db::pdo();
        $this->telegram = new TelegramClient();
        $this->planner = new ReminderPlanner();
    }

    public function handle(): void
    {
        Auth::start();

        $action = (string) ($_POST['action'] ?? $_GET['action'] ?? '');

        if ($action === 'login') {
            $this->login();
            return;
        }

        if ($action === 'logout') {
            Auth::logout();
            redirect('/?page=login');
        }

        if (!Auth::check()) {
            $this->renderLogin();
            return;
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            Csrf::verify();
            $this->handlePost($action);
            return;
        }

        $page = (string) ($_GET['page'] ?? 'registrations');
        $content = match ($page) {
            'events' => $this->eventsPage(),
            'event_edit' => $this->eventEditPage((int) ($_GET['id'] ?? 0)),
            'people' => $this->peoplePage(),
            'registrations' => $this->registrationsPage(),
            'reception' => $this->receptionPage(),
            'broadcasts' => $this->broadcastsPage(),
            'flow' => $this->flowPage(),
            default => $this->registrationsPage(),
        };

        $this->layout($this->pageTitle($page), $content, $page);
    }

    private function handlePost(string $action): void
    {
        try {
            match ($action) {
                'save_event' => $this->saveEvent(),
                'approve_registration' => $this->approveRegistration(),
                'reject_registration' => $this->rejectRegistration(),
                'mark_visited' => $this->markVisited(),
                'undo_visited' => $this->undoVisited(),
                'create_broadcast' => $this->createBroadcast(),
                default => $this->flash('Неизвестное действие', 'error'),
            };
        } catch (Throwable $e) {
            log_line('Admin action failed: ' . $e->getMessage());
            $this->flash('Ошибка: ' . $e->getMessage(), 'error');
        }

        redirect((string) ($_POST['_return'] ?? '/'));
    }

    private function login(): void
    {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->renderLogin();
            return;
        }

        if (Auth::attempt((string) ($_POST['login'] ?? ''), (string) ($_POST['password'] ?? ''))) {
            redirect('/');
        }

        $this->renderLogin('Неверный логин или пароль');
    }

    private function renderLogin(string $error = ''): void
    {
        $errorHtml = $error === '' ? '' : '<div class="notice notice-error">' . h($error) . '</div>';
        echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<title>Вход - Megapolis Bot</title><link rel="stylesheet" href="/assets/admin.css"></head><body class="login-body">';
        echo '<main class="login-card"><h1>Megapolis Bot</h1><p>Админка регистрации на мероприятия</p>' . $errorHtml;
        echo '<form method="post" action="/"><input type="hidden" name="action" value="login">';
        echo '<label>Логин<input name="login" autocomplete="username" required></label>';
        echo '<label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>';
        echo '<button class="button button-primary" type="submit">Войти</button></form></main></body></html>';
    }

    private function eventsPage(): string
    {
        $events = $this->db->query('SELECT * FROM events ORDER BY date_start DESC')->fetchAll();
        $html = '<section class="panel"><div class="panel-head"><h2>Мероприятия</h2><a class="button button-primary" href="/?page=event_edit">Создать</a></div>';
        $html .= '<table><thead><tr><th>Название</th><th>Дата</th><th>Формат</th><th>Статус</th><th></th></tr></thead><tbody>';

        foreach ($events as $event) {
            $html .= '<tr>';
            $html .= '<td><strong>' . h((string) $event['title']) . '</strong><div class="muted">' . h((string) $event['slug']) . '</div></td>';
            $html .= '<td>' . h($this->dateTime((string) $event['date_start'])) . '</td>';
            $html .= '<td>' . h($this->eventFormatLabel($event)) . '</td>';
            $html .= '<td>' . ((int) $event['is_active'] === 1 ? '<span class="badge ok">Активно</span>' : '<span class="badge">Скрыто</span>') . '</td>';
            $html .= '<td><a class="button" href="/?page=event_edit&id=' . (int) $event['id'] . '">Открыть</a></td>';
            $html .= '</tr>';
        }

        $html .= '</tbody></table></section>';
        return $html;
    }

    private function eventEditPage(int $id): string
    {
        $event = [
            'id' => 0,
            'title' => '',
            'slug' => '',
            'description' => '',
            'date_start' => '',
            'date_end' => '',
            'online_start' => '',
            'address' => '',
            'venue_lat' => '',
            'venue_lng' => '',
            'offline_capacity' => '',
            'facecast_event_id' => '',
            'facecast_url' => '',
            'recording_url' => '',
            'photo_album_url' => '',
            'is_active' => 1,
        ];

        if ($id > 0) {
            $stmt = $this->db->prepare('SELECT * FROM events WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $id]);
            $event = $stmt->fetch() ?: $event;
        }

        $html = '<section class="panel narrow"><h2>' . ($id > 0 ? 'Редактировать мероприятие' : 'Создать мероприятие') . '</h2>';
        $html .= '<form method="post" class="form-grid">';
        $html .= Csrf::field() . '<input type="hidden" name="action" value="save_event"><input type="hidden" name="_return" value="/?page=events"><input type="hidden" name="id" value="' . (int) $event['id'] . '">';
        $html .= $this->input('Название', 'title', (string) $event['title'], true);
        $html .= $this->input('Slug', 'slug', (string) $event['slug'], true);
        $html .= $this->textarea('Описание для бота', 'description', (string) $event['description']);
        $html .= $this->input('Начало', 'date_start', $this->datetimeLocal((string) $event['date_start']), true, 'datetime-local');
        $html .= $this->input('Окончание', 'date_end', $this->datetimeLocal((string) $event['date_end']), true, 'datetime-local');
        $html .= $this->input('Старт онлайна', 'online_start', $this->datetimeLocal((string) $event['online_start']), false, 'datetime-local');
        $html .= $this->input('Адрес', 'address', (string) $event['address']);
        $html .= '<div class="form-row two">' . $this->input('Широта', 'venue_lat', (string) $event['venue_lat'], false, 'text', true) . $this->input('Долгота', 'venue_lng', (string) $event['venue_lng'], false, 'text', true) . '</div>';
        $html .= $this->input('Лимит офлайн-мест', 'offline_capacity', (string) $event['offline_capacity'], false, 'number');
        $html .= $this->input('Facecast event id', 'facecast_event_id', (string) $event['facecast_event_id']);
        $html .= $this->input('Ссылка Facecast', 'facecast_url', (string) $event['facecast_url'], false, 'url');
        $html .= $this->input('Запись эфира', 'recording_url', (string) $event['recording_url'], false, 'url');
        $html .= $this->input('Фотоальбом', 'photo_album_url', (string) $event['photo_album_url'], false, 'url');
        $html .= '<label class="check"><input type="checkbox" name="is_active" value="1" ' . ((int) $event['is_active'] === 1 ? 'checked' : '') . '> Активно</label>';
        $html .= '<div class="actions"><button class="button button-primary" type="submit">Сохранить</button><a class="button" href="/?page=events">Назад</a></div>';
        $html .= '</form></section>';

        return $html;
    }

    private function peoplePage(): string
    {
        $people = $this->db->query('SELECT * FROM people ORDER BY created_at DESC LIMIT 300')->fetchAll();
        $html = '<section class="panel"><div class="panel-head"><h2>Люди</h2><span class="muted">Последние 300 контактов</span></div>';
        $html .= '<table><thead><tr><th>Контакт</th><th>Компания</th><th>Телефон</th><th>Email</th><th>Согласие</th></tr></thead><tbody>';

        foreach ($people as $person) {
            $username = $person['username'] ? '@' . $person['username'] : 'ID ' . $person['telegram_id'];
            $html .= '<tr><td><strong>' . h((string) $person['full_name']) . '</strong><div class="muted">' . h($username) . '</div></td>';
            $html .= '<td>' . h((string) $person['company']) . '<div class="muted">' . h((string) $person['position_title']) . '</div></td>';
            $html .= '<td>' . h((string) $person['phone']) . '</td>';
            $html .= '<td>' . h((string) $person['email']) . '</td>';
            $html .= '<td>' . ($person['consent_accepted_at'] ? '<span class="badge ok">Есть</span>' : '<span class="badge warn">Нет</span>') . '</td></tr>';
        }

        $html .= '</tbody></table></section>';
        return $html;
    }

    private function registrationsPage(): string
    {
        $eventId = (int) ($_GET['event_id'] ?? 0);
        $view = (string) ($_GET['view'] ?? 'all');
        if (!in_array($view, ['all', 'online', 'offline'], true)) {
            $view = 'all';
        }
        $layout = (string) ($_GET['layout'] ?? '');
        if (!in_array($layout, ['list', 'kanban'], true)) {
            $layout = $view === 'all' ? 'kanban' : 'list';
        }

        $events = $this->db->query('SELECT id, title FROM events ORDER BY date_start DESC')->fetchAll();
        $where = [];
        $params = [];

        if ($eventId > 0) {
            $where[] = 'r.event_id = :event_id';
            $params['event_id'] = $eventId;
        }

        if ($view === 'online') {
            $where[] = "r.attendance = 'online'";
        } elseif ($view === 'offline') {
            $where[] = "r.attendance = 'offline'";
        }

        $sql = "
            SELECT r.*, p.full_name, p.company, p.position_title, p.phone, p.email, p.telegram_id, e.title, e.date_start, e.date_end, e.address
            FROM registrations r
            JOIN people p ON p.id = r.person_id
            JOIN events e ON e.id = r.event_id
        ";
        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }

        $sql .= ' ORDER BY r.created_at DESC LIMIT 500';

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $registrations = $stmt->fetchAll();
        $counts = $this->registrationCounts($eventId);

        $html = '<section class="panel registrations-workspace"><div class="panel-head"><h2>Регистрации</h2><span class="muted">' . count($registrations) . ' записей</span></div>';
        $html .= '<div class="registrations-toolbar">' . $this->registrationViewTabs($view, $eventId, $counts, $layout) . $this->registrationLayoutToggle($view, $eventId, $layout) . '</div>';
        $html .= '<form class="filters" method="get"><input type="hidden" name="page" value="registrations"><input type="hidden" name="view" value="' . h($view) . '"><input type="hidden" name="layout" value="' . h($layout) . '"><label>Мероприятие<select name="event_id"><option value="0">Все</option>';
        foreach ($events as $event) {
            $html .= '<option value="' . (int) $event['id'] . '" ' . ($eventId === (int) $event['id'] ? 'selected' : '') . '>' . h((string) $event['title']) . '</option>';
        }
        $html .= '</select></label><button class="button" type="submit">Показать</button></form>';

        if ($layout === 'kanban') {
            $html .= $this->registrationsKanban($registrations, $view);
        } else {
            $html .= $this->registrationsTable($registrations, true);
        }

        $html .= '</section>';

        return $html;
    }

    private function receptionPage(): string
    {
        $eventId = (int) ($_GET['event_id'] ?? 0);
        $events = $this->db->query('SELECT id, title, date_start FROM events ORDER BY date_start DESC')->fetchAll();
        $selectedEvent = null;
        $registrations = [];

        if ($eventId > 0) {
            foreach ($events as $event) {
                if ((int) $event['id'] === $eventId) {
                    $selectedEvent = $event;
                    break;
                }
            }

            $stmt = $this->db->prepare("
                SELECT r.*, p.full_name, p.company, p.position_title, e.title, e.date_start
                FROM registrations r
                JOIN people p ON p.id = r.person_id
                JOIN events e ON e.id = r.event_id
                WHERE r.event_id = :event_id
                  AND r.attendance = 'offline'
                  AND r.status IN ('approved','visited')
                ORDER BY CASE r.status WHEN 'approved' THEN 0 WHEN 'visited' THEN 1 ELSE 2 END, p.full_name ASC
                LIMIT 1000
            ");
            $stmt->execute(['event_id' => $eventId]);
            $registrations = $stmt->fetchAll();
        }

        $visited = count(array_filter($registrations, static fn (array $row): bool => (string) $row['status'] === 'visited'));

        $html = '<section class="panel reception-workspace"><div class="panel-head"><h2>Ресепшн</h2><span class="muted">';
        $html .= $eventId > 0 ? $visited . ' из ' . count($registrations) . ' пришли' : 'Выберите мероприятие';
        $html .= '</span></div>';

        $html .= '<form class="reception-filter" method="get"><input type="hidden" name="page" value="reception">';
        $html .= '<label>Мероприятие<select name="event_id"><option value="0">Выберите мероприятие</option>';
        foreach ($events as $event) {
            $label = (string) $event['title'] . ' - ' . $this->dateShort((string) $event['date_start']);
            $html .= '<option value="' . (int) $event['id'] . '" ' . ($eventId === (int) $event['id'] ? 'selected' : '') . '>' . h($label) . '</option>';
        }
        $html .= '</select></label><button class="button button-primary" type="submit">Открыть список</button></form>';

        if ($eventId <= 0) {
            $html .= '<p class="empty">Выберите мероприятие, чтобы открыть список подтвержденных офлайн-гостей.</p>';
        } elseif ($selectedEvent === null) {
            $html .= '<p class="empty">Мероприятие не найдено.</p>';
        } else {
            $html .= $this->receptionChecklist($registrations, $this->currentReceptionUrl());
        }

        return $html . '</section>';
    }

    private function registrationCounts(int $eventId): array
    {
        $where = '';
        $params = [];
        if ($eventId > 0) {
            $where = 'WHERE event_id = :event_id';
            $params['event_id'] = $eventId;
        }

        $stmt = $this->db->prepare("
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN attendance = 'online' THEN 1 ELSE 0 END), 0) AS online,
                COALESCE(SUM(CASE WHEN attendance = 'offline' THEN 1 ELSE 0 END), 0) AS offline
            FROM registrations
            {$where}
        ");
        $stmt->execute($params);
        $row = $stmt->fetch() ?: [];

        return [
            'all' => (int) ($row['total'] ?? 0),
            'online' => (int) ($row['online'] ?? 0),
            'offline' => (int) ($row['offline'] ?? 0),
        ];
    }

    private function registrationViewTabs(string $view, int $eventId, array $counts, string $layout): string
    {
        $tabs = [
            'all' => 'Все',
            'online' => 'Онлайн',
            'offline' => 'Офлайн',
        ];

        $html = '<nav class="view-tabs">';
        foreach ($tabs as $key => $label) {
            $url = $this->registrationsUrl($key, $eventId, $layout);
            $html .= '<a class="' . ($view === $key ? 'active' : '') . '" href="' . h($url) . '"><span>' . h($label) . '</span><strong>' . (int) ($counts[$key] ?? 0) . '</strong></a>';
        }

        return $html . '</nav>';
    }

    private function registrationLayoutToggle(string $view, int $eventId, string $layout): string
    {
        $labels = [
            'list' => 'Список',
            'kanban' => 'Канбан',
        ];

        $html = '<nav class="layout-toggle" aria-label="Вид регистраций">';
        foreach ($labels as $key => $label) {
            $html .= '<a class="' . ($layout === $key ? 'active' : '') . '" href="' . h($this->registrationsUrl($view, $eventId, $key)) . '">' . h($label) . '</a>';
        }

        return $html . '</nav>';
    }

    private function registrationsUrl(string $view, int $eventId, string $layout): string
    {
        $params = [
            'page' => 'registrations',
            'view' => $view,
            'layout' => $layout,
        ];
        if ($eventId > 0) {
            $params['event_id'] = $eventId;
        }

        return '/?' . http_build_query($params);
    }

    private function currentRegistrationsUrl(): string
    {
        $view = (string) ($_GET['view'] ?? 'all');
        if (!in_array($view, ['all', 'online', 'offline'], true)) {
            $view = 'all';
        }

        $layout = (string) ($_GET['layout'] ?? '');
        if (!in_array($layout, ['list', 'kanban'], true)) {
            $layout = $view === 'all' ? 'kanban' : 'list';
        }

        return $this->registrationsUrl($view, (int) ($_GET['event_id'] ?? 0), $layout);
    }

    private function currentReceptionUrl(): string
    {
        $params = ['page' => 'reception'];
        $eventId = (int) ($_GET['event_id'] ?? 0);
        if ($eventId > 0) {
            $params['event_id'] = $eventId;
        }

        return '/?' . http_build_query($params);
    }

    private function registrationsKanban(array $registrations, string $view): string
    {
        $columns = match ($view) {
            'online' => [
                'online' => 'Онлайн зарегистрированы',
            ],
            'offline' => [
                'pending' => 'На проверке',
                'approved' => 'Офлайн подтверждены',
                'visited' => 'Пришли',
                'rejected' => 'Отказ',
                'cancelled' => 'Отменены',
                'no_show' => 'Не пришли',
            ],
            default => [
                'online' => 'Онлайн',
                'pending' => 'На проверке',
                'approved' => 'Офлайн подтверждены',
                'visited' => 'Пришли',
                'rejected' => 'Отказ',
                'cancelled' => 'Отменены',
                'no_show' => 'Не пришли',
            ],
        };
        $grouped = array_fill_keys(array_keys($columns), []);

        foreach ($registrations as $row) {
            $key = (string) $row['attendance'] === 'online'
                ? 'online'
                : (array_key_exists((string) $row['status'], $grouped) ? (string) $row['status'] : 'cancelled');
            if (!array_key_exists($key, $grouped)) {
                $key = array_key_first($grouped);
            }
            $grouped[$key][] = $row;
        }

        $html = '<div class="kanban" style="--kanban-columns: ' . count($columns) . '">';
        foreach ($columns as $status => $label) {
            $html .= '<section class="kanban-column status-' . h($status) . '">';
            $html .= '<header><span>' . h($label) . '</span><strong>' . count($grouped[$status]) . '</strong></header>';
            $html .= '<div class="kanban-list">';

            if ($grouped[$status] === []) {
                $html .= '<p class="kanban-empty">Пусто</p>';
            }

            foreach ($grouped[$status] as $row) {
                $html .= $this->registrationCard($row);
            }

            $html .= '</div></section>';
        }

        return $html . '</div>';
    }

    private function registrationCard(array $row): string
    {
        $attendance = $row['attendance'] === 'offline' ? 'офлайн' : 'онлайн';
        $attendanceClass = $row['attendance'] === 'offline' ? 'offline' : 'online';

        $html = '<article class="registration-card">';
        $html .= '<div class="card-top"><span class="format-pill ' . $attendanceClass . '">' . h($attendance) . '</span><span class="muted">' . h($this->dateTime((string) $row['created_at'])) . '</span></div>';
        $html .= '<h3>' . h((string) $row['full_name']) . '</h3>';
        $html .= '<p class="card-company">' . h((string) $row['company']) . '</p>';
        if (!empty($row['position_title'])) {
            $html .= '<p class="muted">' . h((string) $row['position_title']) . '</p>';
        }
        $html .= '<dl>';
        $html .= '<div><dt>Событие</dt><dd>' . h((string) $row['title']) . '</dd></div>';
        $html .= '<div><dt>Телефон</dt><dd>' . h((string) ($row['phone'] ?? '')) . '</dd></div>';
        $html .= '<div><dt>Email</dt><dd>' . h((string) ($row['email'] ?? '')) . '</dd></div>';
        $html .= '</dl>';
        $actions = $this->registrationActions($row);
        if ($actions !== '<span class="muted">-</span>') {
            $html .= '<div class="card-actions">' . $actions . '</div>';
        }
        $html .= '</article>';

        return $html;
    }

    private function registrationsTable(array $registrations, bool $withActions): string
    {
        if ($registrations === []) {
            return '<p class="empty">Пока нет записей.</p>';
        }

        $html = '<table><thead><tr><th>Участник</th><th>Мероприятие</th><th>Формат</th><th>Статус</th><th>Дата</th>';
        if ($withActions) {
            $html .= '<th>Действия</th>';
        }
        $html .= '</tr></thead><tbody>';

        foreach ($registrations as $row) {
            $statusLabel = $this->registrationStatusLabel($row);
            $attendance = $row['attendance'] === 'offline' ? 'офлайн' : 'онлайн';
            $html .= '<tr>';
            $html .= '<td><strong>' . h((string) $row['full_name']) . '</strong><div class="muted">' . h((string) $row['company']) . '</div><div class="muted">' . h((string) ($row['email'] ?? '')) . '</div></td>';
            $html .= '<td>' . h((string) $row['title']) . '</td>';
            $html .= '<td>' . h($attendance) . '</td>';
            $html .= '<td>' . $statusLabel . '</td>';
            $html .= '<td>' . h($this->dateTime((string) $row['created_at'])) . '</td>';
            if ($withActions) {
                $html .= '<td class="actions-cell">' . $this->registrationActions($row) . '</td>';
            }
            $html .= '</tr>';
        }

        return $html . '</tbody></table>';
    }

    private function receptionChecklist(array $registrations, string $returnUrl): string
    {
        if ($registrations === []) {
            return '<p class="empty">Нет подтвержденных офлайн-гостей для ресепшна.</p>';
        }

        $html = '<div class="reception-list">';
        foreach ($registrations as $row) {
            $visited = (string) $row['status'] === 'visited';
            $html .= '<article class="reception-row ' . ($visited ? 'is-visited' : '') . '">';
            $html .= '<div class="reception-main">';
            $html .= '<strong>' . h((string) $row['full_name']) . '</strong>';
            $html .= '<span>' . h((string) $row['company']) . '</span>';
            $html .= '<span class="muted">' . h((string) $row['position_title']) . '</span>';
            $html .= '</div>';
            $html .= '<div class="reception-action">' . $this->visitToggleForm($row, $visited, $returnUrl) . '</div>';
            $html .= '</article>';
        }

        return $html . '</div>';
    }

    private function visitToggleForm(array $row, bool $visited, ?string $returnUrl = null): string
    {
        $action = $visited ? 'undo_visited' : 'mark_visited';
        $label = $visited ? 'Пришел' : 'Отметить приход';
        $return = $returnUrl ?? $this->currentRegistrationsUrl();

        $html = '<form method="post" class="inline-form">' . Csrf::field();
        $html .= '<input type="hidden" name="action" value="' . h($action) . '">';
        $html .= '<input type="hidden" name="_return" value="' . h($return) . '">';
        $html .= '<input type="hidden" name="id" value="' . (int) $row['id'] . '">';
        $html .= '<button class="checkin-toggle ' . ($visited ? 'is-on' : '') . '" type="submit"><span class="check-box"></span>' . h($label) . '</button></form>';

        return $html;
    }

    private function registrationActions(array $row): string
    {
        if ($row['attendance'] !== 'offline' || $row['status'] !== 'pending') {
            return '<span class="muted">-</span>';
        }

        $return = $this->currentRegistrationsUrl();
        $html = '<form method="post" class="inline-form">' . Csrf::field();
        $html .= '<input type="hidden" name="action" value="approve_registration"><input type="hidden" name="_return" value="' . h($return) . '"><input type="hidden" name="id" value="' . (int) $row['id'] . '">';
        $html .= '<button class="button button-primary" type="submit">Аппрув</button></form>';
        $html .= '<form method="post" class="inline-form">' . Csrf::field();
        $html .= '<input type="hidden" name="action" value="reject_registration"><input type="hidden" name="_return" value="' . h($return) . '"><input type="hidden" name="id" value="' . (int) $row['id'] . '">';
        $html .= '<button class="button danger" type="submit">Отказать</button></form>';

        return $html;
    }

    private function broadcastsPage(): string
    {
        $events = $this->db->query('SELECT id, title FROM events ORDER BY date_start DESC')->fetchAll();
        $campaigns = $this->db->query('SELECT c.*, e.title AS event_title FROM broadcast_campaigns c LEFT JOIN events e ON e.id = c.event_id ORDER BY c.created_at DESC LIMIT 50')->fetchAll();

        $html = '<section class="panel narrow"><h2>Новая рассылка</h2><form method="post" class="form-grid">';
        $html .= Csrf::field() . '<input type="hidden" name="action" value="create_broadcast"><input type="hidden" name="_return" value="/?page=broadcasts">';
        $html .= $this->input('Название рассылки', 'title', '', true);
        $html .= '<label>Аудитория<select name="audience" required>';
        foreach ($this->audiences() as $key => $label) {
            $html .= '<option value="' . h($key) . '">' . h($label) . '</option>';
        }
        $html .= '</select></label>';
        $html .= '<label>Мероприятие<select name="event_id"><option value="0">Не привязывать</option>';
        foreach ($events as $event) {
            $html .= '<option value="' . (int) $event['id'] . '">' . h((string) $event['title']) . '</option>';
        }
        $html .= '</select></label>';
        $html .= '<label>Тип<select name="content_type"><option value="text">Текст</option><option value="photo">Картинка + текст</option><option value="video_note">Кружок + текст</option></select></label>';
        $html .= $this->textarea('Текст сообщения', 'body', '');
        $html .= $this->input('Telegram file_id или URL медиа', 'media_file_id', '');
        $html .= '<p class="hint">Для картинки можно вставить HTTPS-ссылку или Telegram file_id. Для кружка нужен именно file_id: отправьте кружок боту от Telegram ID, указанного в ADMIN_TELEGRAM_IDS.</p>';
        $html .= '<div class="actions"><button class="button button-primary" type="submit">Поставить в очередь</button></div></form></section>';

        $html .= '<section class="panel"><h2>История рассылок</h2><table><thead><tr><th>Название</th><th>Аудитория</th><th>Статус</th><th>Создана</th></tr></thead><tbody>';
        foreach ($campaigns as $campaign) {
            $html .= '<tr><td><strong>' . h((string) $campaign['title']) . '</strong><div class="muted">' . h((string) $campaign['event_title']) . '</div></td>';
            $html .= '<td>' . h($this->audiences()[(string) $campaign['audience']] ?? (string) $campaign['audience']) . '</td>';
            $html .= '<td>' . h((string) $campaign['status']) . '</td>';
            $html .= '<td>' . h($this->dateTime((string) $campaign['created_at'])) . '</td></tr>';
        }
        $html .= '</tbody></table></section>';

        return $html;
    }

    private function flowPage(): string
    {
        $nodes = $this->flowNodes();
        $edges = $this->flowEdges();
        $users = $this->flowUsers();
        $queues = $this->flowQueues();

        $html = '<section class="panel flow-panel"><div class="panel-head"><h2>Сценарий бота</h2><span class="muted">Живая карта переходов</span></div>';
        $html .= '<div class="flow-legend"><span><i class="legend-dot users"></i>пользователи на этапе</span><span><i class="legend-dot queue"></i>запланированные сообщения</span><span><i class="legend-line"></i>переходы по кнопкам и действиям модератора</span></div>';
        $html .= '<div class="journey-board" style="--board-width: 3160px; --board-height: 1260px;">';
        $html .= $this->flowScaffold();
        $html .= $this->flowSvg($edges, $nodes);

        foreach ($nodes as $id => $node) {
            $html .= $this->flowNode($id, $node, $users[$id] ?? [], $queues[$id] ?? []);
        }

        $html .= '</div>' . $this->flowModal() . '</section>';

        return $html;
    }

    private function flowScaffold(): string
    {
        $lanes = [
            ['title' => 'Общий путь регистрации', 'top' => 112, 'height' => 370],
            ['title' => 'Офлайн-гости и ресепшн', 'top' => 472, 'height' => 370],
            ['title' => 'Онлайн, напоминания и материалы', 'top' => 822, 'height' => 370],
        ];
        $columns = [
            ['title' => 'Старт', 'x' => 70],
            ['title' => 'Согласие', 'x' => 450],
            ['title' => 'Анкета', 'x' => 830],
            ['title' => 'Событие', 'x' => 1210],
            ['title' => 'Выбор формата', 'x' => 1590],
            ['title' => 'Подтверждение', 'x' => 1970],
            ['title' => 'День события', 'x' => 2350],
            ['title' => 'Материалы', 'x' => 2730],
        ];

        $html = '<div class="flow-scaffold" aria-hidden="true">';
        foreach ($lanes as $lane) {
            $style = 'top:' . (int) $lane['top'] . 'px;height:' . (int) $lane['height'] . 'px;';
            $html .= '<div class="flow-lane" style="' . h($style) . '"><span>' . h((string) $lane['title']) . '</span></div>';
        }
        foreach ($columns as $column) {
            $style = 'left:' . (int) $column['x'] . 'px;';
            $html .= '<div class="flow-column-marker" style="' . h($style) . '">' . h((string) $column['title']) . '</div>';
        }

        return $html . '</div>';
    }

    private function flowNodes(): array
    {
        return [
            'start' => [
                'step' => '1',
                'title' => 'Первое касание',
                'phase' => 'Бот',
                'messages' => [
                    [
                        'title' => '/start',
                        'text' => "Здравствуйте! Это бот Мегаполис Медиа 👋\n\nЗдесь можно зарегистрироваться на наши митапы, эфиры и деловые встречи.\n\nДавайте познакомимся, чтобы мы могли корректно оформить вашу регистрацию.",
                    ],
                ],
                'options' => ['Зарегистрироваться', 'Главное меню'],
                'x' => 70,
                'y' => 150,
            ],
            'consent' => [
                'step' => '2',
                'title' => 'Согласие',
                'phase' => 'Данные',
                'messages' => [
                    [
                        'title' => 'Перед анкетой',
                        'text' => "Перед регистрацией нужно ваше согласие на обработку персональных данных.\n\nМы будем использовать ФИО, компанию, должность, телефон и email для регистрации на мероприятия, коммуникации, допуска к эфиру и отправки материалов.\n\nОператор: ООО «Мегаполис Медиа», ИНН 7710750836, ОГРН 1097746299034. Согласие действует 3 года и может быть отозвано в порядке, предусмотренном законодательством РФ.\n\nПолный текст: " . $this->privacyUrl(),
                    ],
                ],
                'options' => ['Даю согласие', 'Главное меню'],
                'x' => 450,
                'y' => 150,
            ],
            'profile' => [
                'step' => '3',
                'title' => 'Анкета',
                'phase' => 'Данные',
                'messages' => [
                    ['title' => 'Имя', 'text' => 'Спасибо! Давайте познакомимся 🙂 Напишите, пожалуйста, имя и фамилию.'],
                    ['title' => 'Компания', 'text' => 'Из какой вы компании?'],
                    ['title' => 'Должность', 'text' => 'А какая у вас должность?'],
                    ['title' => 'Телефон', 'text' => 'Поделитесь, пожалуйста, номером телефона. Можно отправить его кнопкой ниже.'],
                    ['title' => 'Email', 'text' => 'И последний шаг: напишите вашу почту.'],
                    ['title' => 'Финал анкеты', 'text' => 'Готово, спасибо! Теперь можно выбрать мероприятие ✨'],
                ],
                'options' => ['Ответ текстом', 'Отправить телефон'],
                'x' => 830,
                'y' => 150,
            ],
            'events' => [
                'step' => '4',
                'title' => 'Выбор мероприятия',
                'phase' => 'Регистрация',
                'messages' => [
                    [
                        'title' => 'Список событий',
                        'text' => "Выберите мероприятие, на которое хотите зарегистрироваться:\n\n• {название события 1} - {дата}\n• {название события 2} - {дата}\n\nНа этом шаге адрес не показываем: человек сначала выбирает событие.",
                    ],
                    [
                        'title' => 'Если событие одно',
                        'text' => "Если ближайшее событие одно, бот сразу показывает его карточку без адреса:\n\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nФормат: {офлайн + онлайн / только офлайн / только онлайн}\n\n{описание мероприятия}",
                    ],
                    ['title' => 'Если событий нет', 'text' => 'Пока ближайших мероприятий нет. Как только появится новое событие, мы обязательно расскажем 🙂'],
                ],
                'options' => ['Выбрать событие', 'Главное меню'],
                'x' => 1210,
                'y' => 150,
            ],
            'format_choice' => [
                'step' => '5',
                'title' => 'Выбор формата',
                'phase' => 'Регистрация',
                'messages' => [
                    [
                        'title' => 'После выбора события',
                        'text' => "Отлично, вот что запланировано:\n\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nФормат: {офлайн + онлайн / только офлайн / только онлайн}\n\n{описание мероприятия}\n\nВыберите удобный формат участия:",
                    ],
                    ['title' => 'Только офлайн', 'text' => 'Если у события есть только офлайн-формат, бот показывает одну кнопку: «🏢 Прийти офлайн». Адрес всё ещё не показываем до подтверждения модератора.'],
                    ['title' => 'Только онлайн', 'text' => 'Если у события есть только онлайн-формат, бот показывает одну кнопку: «💻 Смотреть онлайн». Модерация не нужна.'],
                ],
                'options' => ['Прийти офлайн', 'Смотреть онлайн', 'Главное меню'],
                'x' => 1590,
                'y' => 150,
            ],
            'offline_pending' => [
                'step' => '6A',
                'title' => 'Офлайн на проверке',
                'phase' => 'Модерация',
                'messages' => [
                    [
                        'title' => 'После выбора офлайна',
                        'text' => "Спасибо, заявка на офлайн-участие принята 🏢\n\nОрганизаторы проверят список гостей и пришлют подтверждение. Адрес и детали площадки отправим после аппрува.",
                    ],
                ],
                'options' => ['Модератор: аппрув', 'Модератор: отказ'],
                'x' => 1970,
                'y' => 150,
            ],
            'offline_rejected' => [
                'step' => '6A-',
                'title' => 'Офлайн отказ',
                'phase' => 'Модерация',
                'messages' => [
                    [
                        'title' => 'Отказ модератора',
                        'text' => 'К сожалению, сейчас не можем подтвердить офлайн-участие, но вы можете присоединиться онлайн. Так вы точно не пропустите эфир 💻',
                    ],
                ],
                'options' => ['Буду смотреть онлайн'],
                'x' => 2350,
                'y' => 150,
            ],
            'offline_approved' => [
                'step' => '7A',
                'title' => 'Офлайн подтвержден',
                'phase' => 'Офлайн',
                'messages' => [
                    [
                        'title' => 'Аппрув модератора',
                        'text' => "Готово, офлайн-участие подтверждено 🏢\n\nЖдём вас на мероприятии:\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nНаш адрес: {адрес}\nФормат: офлайн\n\nПеред событием пришлём напоминание.",
                    ],
                    ['title' => 'Если есть координаты', 'text' => 'После сообщения бот отправляет venue-карту с адресом площадки.'],
                ],
                'options' => ['Ресепшн', 'Напоминания'],
                'x' => 1970,
                'y' => 500,
            ],
            'reception' => [
                'step' => '7B',
                'title' => 'Ресепшн',
                'phase' => 'Офлайн',
                'messages' => [
                    ['title' => 'Системное действие', 'text' => 'Пользователю сообщение не отправляется. Модератор на ресепшне ставит галочку в админке.'],
                ],
                'options' => ['Отметить приход'],
                'x' => 2350,
                'y' => 500,
            ],
            'visited' => [
                'step' => '7C',
                'title' => 'Пришел',
                'phase' => 'Офлайн',
                'messages' => [
                    ['title' => 'Системное действие', 'text' => 'Пользователю сообщение не отправляется сразу. Статус нужен для отчетности и дальнейшей рассылки материалов.'],
                ],
                'options' => ['Постпромо'],
                'x' => 2730,
                'y' => 500,
            ],
            'online_access' => [
                'step' => '6B',
                'title' => 'Онлайн зарегистрирован',
                'phase' => 'Онлайн',
                'messages' => [
                    [
                        'title' => 'Доступ к эфиру',
                        'text' => "Готово, вы зарегистрированы онлайн! 💻\n\nДанные для подключения:\nЛогин: {facecast_login}\nПароль: {facecast_password}\nНазвание: {название}\nДата: {дата}\nВремя подключения: {время старта онлайна}\n\nСохраните сообщение, а перед эфиром мы напомним о старте.",
                    ],
                    ['title' => 'Если человек передумал идти офлайн', 'text' => 'Конечно, планы меняются. Переключаем вас на онлайн-участие 💻'],
                ],
                'options' => ['Ссылка на эфир', 'Напомнить логин и пароль', 'Главное меню'],
                'x' => 1970,
                'y' => 850,
            ],
            'reminders' => [
                'step' => '8',
                'title' => 'Напоминания',
                'phase' => 'Автоматизация',
                'messages' => [
                    [
                        'title' => 'Офлайн за день',
                        'text' => "Напоминаем о встрече завтра 🏢\n\nБудем рады видеть вас на площадке:\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nАдрес: {адрес}\nФормат: офлайн",
                    ],
                    [
                        'title' => 'Офлайн за 2 часа',
                        'text' => "До офлайн-встречи осталось около двух часов 🙂\n\nПожалуйста, заложите время на дорогу и ресепшн.\n\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nАдрес: {адрес}\nФормат: офлайн",
                    ],
                    ['title' => 'Офлайн старт', 'text' => "Начинаем! Рады видеть вас на мероприятии ✨\n\nЖелаем хорошего настроя, полезных знакомств и живого разговора."],
                    ['title' => 'Онлайн за 15 минут', 'text' => 'Напоминаем про эфир: начинаем через 15 минут 💻'],
                    ['title' => 'Онлайн старт', 'text' => "Мы начали! Добро пожаловать в прямой эфир 💻\n\nЗадавайте вопросы спикерам в чате трансляции."],
                ],
                'options' => ['Офлайн: всё ок', 'Офлайн: не смогу', 'Онлайн: открыть эфир'],
                'x' => 2350,
                'y' => 850,
            ],
            'postpromo' => [
                'step' => '9',
                'title' => 'Постпромо',
                'phase' => 'Материалы',
                'messages' => [
                    [
                        'title' => 'После события',
                        'text' => "Спасибо, что были с нами ✨\n\nДелимся материалами и яркими моментами прошедшего мероприятия.\n\nТакже можно посмотреть запись эфира, если хочется вернуться к главным мыслям.\n\nЛогин: {facecast_login}\nПароль: {facecast_password}\n\nНазвание: {название}",
                    ],
                ],
                'options' => ['Ссылка на эфир', 'Подборка фото', 'Главное меню'],
                'x' => 2730,
                'y' => 850,
            ],
            'menu' => [
                'step' => '10',
                'title' => 'Главное меню',
                'phase' => 'Навигация',
                'messages' => [
                    ['title' => 'Главное меню', 'text' => 'Что посмотрим дальше? Мы рядом в соцсетях и на сайте 🙂'],
                    ['title' => 'Если профиль не заполнен', 'text' => 'Сначала давайте познакомимся, чтобы корректно оформить регистрацию.'],
                ],
                'options' => ['Телеграм канал', 'Сайт', 'Ближайшие мероприятия'],
                'x' => 1210,
                'y' => 850,
            ],
        ];
    }

    private function flowEdges(): array
    {
        return [
            ['from' => 'start', 'to' => 'consent', 'label' => 'Зарегистрироваться'],
            ['from' => 'consent', 'to' => 'profile', 'label' => 'Даю согласие'],
            ['from' => 'profile', 'to' => 'events', 'label' => 'Анкета заполнена'],
            ['from' => 'events', 'to' => 'format_choice', 'label' => 'Выбрано событие'],
            ['from' => 'format_choice', 'to' => 'offline_pending', 'label' => 'Прийти офлайн'],
            ['from' => 'format_choice', 'to' => 'online_access', 'label' => 'Смотреть онлайн', 'via' => [[1920, 970]]],
            ['from' => 'events', 'to' => 'menu', 'label' => 'Главное меню', 'fromAnchor' => 'bottom', 'toAnchor' => 'top'],
            ['from' => 'offline_pending', 'to' => 'offline_approved', 'label' => 'Аппрув', 'fromAnchor' => 'bottom', 'toAnchor' => 'top'],
            ['from' => 'offline_pending', 'to' => 'offline_rejected', 'label' => 'Отказ'],
            ['from' => 'offline_rejected', 'to' => 'online_access', 'label' => 'Буду онлайн', 'fromAnchor' => 'bottom', 'toAnchor' => 'top', 'via' => [[2510, 430], [1940, 430], [1940, 840], [2130, 840]]],
            ['from' => 'offline_approved', 'to' => 'reception', 'label' => 'День события'],
            ['from' => 'reception', 'to' => 'visited', 'label' => 'Пришел'],
            ['from' => 'offline_approved', 'to' => 'reminders', 'label' => 'Напоминания', 'fromAnchor' => 'bottom', 'toAnchor' => 'left', 'via' => [[2130, 800], [2340, 800]]],
            ['from' => 'online_access', 'to' => 'reminders', 'label' => 'Напоминания'],
            ['from' => 'reminders', 'to' => 'online_access', 'label' => 'Не смогу офлайн', 'fromAnchor' => 'bottom', 'toAnchor' => 'bottom', 'via' => [[2510, 1160], [2130, 1160]]],
            ['from' => 'reminders', 'to' => 'postpromo', 'label' => 'После события'],
            ['from' => 'visited', 'to' => 'postpromo', 'label' => 'Материалы', 'fromAnchor' => 'bottom', 'toAnchor' => 'top'],
            ['from' => 'postpromo', 'to' => 'menu', 'label' => 'Главное меню', 'fromAnchor' => 'bottom', 'toAnchor' => 'bottom', 'via' => [[2890, 1180], [1370, 1180]]],
        ];
    }

    private function flowSvg(array $edges, array $nodes): string
    {
        $html = '<svg class="journey-lines" width="3160" height="1260" viewBox="0 0 3160 1260" aria-hidden="true">';
        $html .= '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><polygon points="0 0, 8 3.5, 0 7"></polygon></marker></defs>';

        foreach ($edges as $edge) {
            $points = $this->flowEdgePoints($edge, $nodes);
            $path = $this->flowPath($points);
            $start = $points[0];

            $html .= '<circle class="connector-dot" cx="' . $start[0] . '" cy="' . $start[1] . '" r="3"></circle>';
            $html .= '<path d="' . h($path) . '" marker-end="url(#arrow)"><title>' . h((string) $edge['label']) . '</title></path>';
        }

        return $html . '</svg>';
    }

    private function flowEdgePoints(array $edge, array $nodes): array
    {
        $points = [
            $this->flowAnchor($nodes[$edge['from']], (string) ($edge['fromAnchor'] ?? 'right')),
        ];

        foreach ($edge['via'] ?? [] as $point) {
            $points[] = [(int) $point[0], (int) $point[1]];
        }

        $points[] = $this->flowAnchor($nodes[$edge['to']], (string) ($edge['toAnchor'] ?? 'left'));

        return $points;
    }

    private function flowAnchor(array $node, string $anchor): array
    {
        $x = (int) $node['x'];
        $y = (int) $node['y'];
        $centerX = $x + (int) (self::FLOW_NODE_WIDTH / 2);
        $centerY = $y + (int) (self::FLOW_NODE_HEIGHT / 2);

        return match ($anchor) {
            'left' => [$x - self::FLOW_CONNECTOR_GAP, $centerY],
            'top' => [$centerX, $y - self::FLOW_CONNECTOR_GAP],
            'bottom' => [$centerX, $y + self::FLOW_NODE_HEIGHT + self::FLOW_CONNECTOR_GAP],
            default => [$x + self::FLOW_NODE_WIDTH + self::FLOW_CONNECTOR_GAP, $centerY],
        };
    }

    private function flowPath(array $points): string
    {
        $count = count($points);
        if ($count === 0) {
            return '';
        }
        if ($count === 1) {
            return 'M ' . $points[0][0] . ' ' . $points[0][1];
        }

        $radius = 18;
        $path = 'M ' . $points[0][0] . ' ' . $points[0][1];

        for ($i = 1; $i < $count; $i++) {
            $point = $points[$i];
            $next = $points[$i + 1] ?? null;

            if ($next !== null && $this->canRoundFlowCorner($points[$i - 1], $point, $next)) {
                $before = $this->flowCornerPoint($point, $points[$i - 1], $radius);
                $after = $this->flowCornerPoint($point, $next, $radius);
                $path .= ' L ' . $before[0] . ' ' . $before[1];
                $path .= ' Q ' . $point[0] . ' ' . $point[1] . ' ' . $after[0] . ' ' . $after[1];
                continue;
            }

            $path .= ' L ' . $point[0] . ' ' . $point[1];
        }

        return $path;
    }

    private function canRoundFlowCorner(array $previous, array $point, array $next): bool
    {
        $incomingStraight = $previous[0] === $point[0] || $previous[1] === $point[1];
        $outgoingStraight = $next[0] === $point[0] || $next[1] === $point[1];
        $sameAxis = ($previous[0] === $point[0] && $next[0] === $point[0])
            || ($previous[1] === $point[1] && $next[1] === $point[1]);

        return $incomingStraight && $outgoingStraight && !$sameAxis;
    }

    private function flowCornerPoint(array $corner, array $towards, int $radius): array
    {
        $x = (int) $corner[0];
        $y = (int) $corner[1];

        if ($towards[0] !== $corner[0]) {
            $x += $towards[0] > $corner[0] ? $radius : -$radius;
        }

        if ($towards[1] !== $corner[1]) {
            $y += $towards[1] > $corner[1] ? $radius : -$radius;
        }

        return [$x, $y];
    }

    private function flowLabelPoint(array $points): array
    {
        $segments = [];
        $total = 0.0;

        for ($i = 1, $count = count($points); $i < $count; $i++) {
            $from = $points[$i - 1];
            $to = $points[$i];
            $length = hypot($to[0] - $from[0], $to[1] - $from[1]);
            $segments[] = [$from, $to, $length];
            $total += $length;
        }

        $target = $total / 2;
        $walked = 0.0;

        foreach ($segments as [$from, $to, $length]) {
            if ($walked + $length >= $target && $length > 0) {
                $ratio = ($target - $walked) / $length;
                return [
                    (int) round($from[0] + (($to[0] - $from[0]) * $ratio)),
                    (int) round($from[1] + (($to[1] - $from[1]) * $ratio)) - 8,
                ];
            }
            $walked += $length;
        }

        $last = end($points);
        return [(int) $last[0], (int) $last[1] - 8];
    }

    private function flowNode(string $id, array $node, array $users, array $queue): string
    {
        $style = 'left:' . (int) $node['x'] . 'px;top:' . (int) $node['y'] . 'px;';
        $html = '<article class="journey-node" style="' . h($style) . '">';
        $html .= '<div class="node-head"><span class="node-step">' . h((string) $node['step']) . '</span><span class="node-phase">' . h((string) $node['phase']) . '</span></div>';
        $html .= '<h3>' . h((string) $node['title']) . '</h3>';
        $html .= $this->flowMessages($node['messages'] ?? [['title' => 'Сообщение', 'text' => (string) ($node['message'] ?? '')]]);
        $html .= '<div class="node-options">';
        foreach ($node['options'] as $option) {
            $html .= '<span>' . h((string) $option) . '</span>';
        }
        $html .= '</div>';
        $html .= $this->flowPeopleList('Сейчас здесь', $users, 'users');

        if ($queue !== []) {
            $html .= $this->flowPeopleList('В очереди сообщений', $queue, 'queue');
        }

        $html .= '</article>';

        return $html;
    }

    private function flowMessages(array $messages): string
    {
        $html = '<div class="node-message-list"><strong>Сообщения пользователю</strong>';
        foreach ($messages as $message) {
            $title = (string) ($message['title'] ?? 'Сообщение');
            $text = (string) ($message['text'] ?? '');
            $html .= '<button class="node-message-button" type="button" data-message-title="' . h($title) . '" data-message-text="' . h($text) . '">';
            $html .= '<span>' . h($title) . '</span><em>Открыть</em></button>';
        }

        return $html . '</div>';
    }

    private function flowModal(): string
    {
        return '<div class="flow-modal" hidden aria-hidden="true">'
            . '<div class="flow-modal-backdrop" data-flow-modal-close></div>'
            . '<section class="flow-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title">'
            . '<button class="flow-modal-close" type="button" data-flow-modal-close aria-label="Закрыть">×</button>'
            . '<span class="flow-modal-kicker">Сообщение пользователю</span>'
            . '<h3 id="flow-modal-title"></h3>'
            . '<div class="flow-modal-text"></div>'
            . '</section></div>';
    }

    private function flowPeopleList(string $title, array $people, string $type): string
    {
        $html = '<div class="node-people ' . h($type) . '"><div><strong>' . h($title) . '</strong><span>' . count($people) . '</span></div>';
        if ($people === [] || $type === 'queue') {
            return $html . '</div>';
        }

        $html .= '<ul>';
        foreach (array_slice($people, 0, 3) as $person) {
            $html .= '<li>' . h((string) $person) . '</li>';
        }
        if (count($people) > 3) {
            $html .= '<li>+' . (count($people) - 3) . ' еще</li>';
        }
        $html .= '</ul></div>';

        return $html;
    }

    private function flowUsers(): array
    {
        $users = array_fill_keys(array_keys($this->flowNodes()), []);
        $stmt = $this->db->query("
            SELECT
                p.id AS person_id,
                p.full_name,
                p.username,
                p.state,
                r.id AS registration_id,
                r.attendance,
                r.status,
                r.created_at AS registration_created_at,
                e.title AS event_title
            FROM people p
            LEFT JOIN registrations r ON r.person_id = p.id
            LEFT JOIN events e ON e.id = r.event_id
            ORDER BY COALESCE(r.created_at, p.created_at) DESC
            LIMIT 1000
        ");

        foreach ($stmt->fetchAll() as $row) {
            $stage = $this->flowStageForRow($row);
            $label = $this->flowPersonLabel($row);
            if (!in_array($label, $users[$stage] ?? [], true)) {
                $users[$stage][] = $label;
            }
        }

        return $users;
    }

    private function flowQueues(): array
    {
        $queues = array_fill_keys(array_keys($this->flowNodes()), []);
        $stmt = $this->db->query("
            SELECT sm.type, p.full_name, p.username, e.title AS event_title
            FROM scheduled_messages sm
            JOIN people p ON p.id = sm.person_id
            LEFT JOIN events e ON e.id = sm.event_id
            WHERE sm.sent_at IS NULL AND sm.failed_at IS NULL
            ORDER BY sm.send_at ASC
            LIMIT 200
        ");

        foreach ($stmt->fetchAll() as $row) {
            $stage = (string) $row['type'] === 'postpromo' ? 'postpromo' : 'reminders';
            $label = trim((string) ($row['full_name'] ?: ($row['username'] ? '@' . $row['username'] : 'ID')));
            if (!empty($row['event_title'])) {
                $label .= ' - ' . $row['event_title'];
            }
            $queues[$stage][] = $label;
        }

        return $queues;
    }

    private function flowStageForRow(array $row): string
    {
        if (!empty($row['registration_id'])) {
            if ((string) $row['attendance'] === 'online') {
                return 'online_access';
            }

            return match ((string) $row['status']) {
                'pending' => 'offline_pending',
                'approved' => 'offline_approved',
                'visited' => 'visited',
                'rejected' => 'offline_rejected',
                default => 'menu',
            };
        }

        return match ((string) $row['state']) {
            'awaiting_consent' => 'consent',
            'ask_name', 'ask_company', 'ask_position', 'ask_phone', 'ask_email' => 'profile',
            'registered' => 'events',
            default => 'start',
        };
    }

    private function flowPersonLabel(array $row): string
    {
        $name = trim((string) ($row['full_name'] ?: ($row['username'] ? '@' . $row['username'] : 'ID ' . $row['person_id'])));
        if (!empty($row['event_title'])) {
            return $name . ' - ' . $row['event_title'];
        }

        return $name;
    }

    private function saveEvent(): void
    {
        $id = (int) ($_POST['id'] ?? 0);
        $data = [
            'title' => trim((string) $_POST['title']),
            'slug' => trim((string) $_POST['slug']),
            'description' => trim((string) $_POST['description']),
            'date_start' => $this->fromDatetimeLocal((string) $_POST['date_start']),
            'date_end' => $this->fromDatetimeLocal((string) $_POST['date_end']),
            'online_start' => $this->fromDatetimeLocal((string) ($_POST['online_start'] ?? '')),
            'address' => trim((string) ($_POST['address'] ?? '')),
            'venue_lat' => $_POST['venue_lat'] === '' ? null : $_POST['venue_lat'],
            'venue_lng' => $_POST['venue_lng'] === '' ? null : $_POST['venue_lng'],
            'offline_capacity' => $_POST['offline_capacity'] === '' ? null : (int) $_POST['offline_capacity'],
            'facecast_event_id' => trim((string) ($_POST['facecast_event_id'] ?? '')),
            'facecast_url' => trim((string) ($_POST['facecast_url'] ?? '')),
            'recording_url' => trim((string) ($_POST['recording_url'] ?? '')),
            'photo_album_url' => trim((string) ($_POST['photo_album_url'] ?? '')),
            'is_active' => isset($_POST['is_active']) ? 1 : 0,
            'now' => now(),
        ];

        if ($id > 0) {
            $data['id'] = $id;
            $this->db->prepare("
                UPDATE events SET
                    title = :title, slug = :slug, description = :description, date_start = :date_start,
                    date_end = :date_end, online_start = :online_start, address = :address,
                    venue_lat = :venue_lat, venue_lng = :venue_lng, offline_capacity = :offline_capacity,
                    facecast_event_id = :facecast_event_id, facecast_url = :facecast_url,
                    recording_url = :recording_url, photo_album_url = :photo_album_url,
                    is_active = :is_active, updated_at = :now
                WHERE id = :id
            ")->execute($data);
        } else {
            $this->db->prepare("
                INSERT INTO events
                    (title, slug, description, date_start, date_end, online_start, address, venue_lat, venue_lng,
                     offline_capacity, facecast_event_id, facecast_url, recording_url, photo_album_url, is_active, created_at, updated_at)
                VALUES
                    (:title, :slug, :description, :date_start, :date_end, :online_start, :address, :venue_lat, :venue_lng,
                     :offline_capacity, :facecast_event_id, :facecast_url, :recording_url, :photo_album_url, :is_active, :now, :now)
            ")->execute($data);
        }

        $this->flash('Мероприятие сохранено');
    }

    private function approveRegistration(): void
    {
        $registration = $this->registrationWithDetails((int) $_POST['id']);
        if (!$registration) {
            throw new \RuntimeException('Регистрация не найдена');
        }

        $this->db->prepare("UPDATE registrations SET status = 'approved', approved_at = :now, updated_at = :now WHERE id = :id")
            ->execute(['now' => now(), 'id' => $registration['id']]);

        $registration = $this->registrationWithDetails((int) $registration['id']);
        $this->planner->planOfflineApproved($registration, $registration);
        $this->sendOfflineApproved($registration);
        $this->flash('Офлайн-регистрация подтверждена');
    }

    private function rejectRegistration(): void
    {
        $registration = $this->registrationWithDetails((int) $_POST['id']);
        if (!$registration) {
            throw new \RuntimeException('Регистрация не найдена');
        }

        $this->db->prepare("UPDATE registrations SET status = 'rejected', rejection_reason = :reason, updated_at = :now WHERE id = :id")
            ->execute(['reason' => 'Места на офлайн закончились', 'now' => now(), 'id' => $registration['id']]);

        $this->sendOfflineRejected($registration);
        $this->flash('Отказ отправлен участнику');
    }

    private function markVisited(): void
    {
        $registration = $this->registrationWithDetails((int) $_POST['id']);
        if (!$registration || (string) $registration['attendance'] !== 'offline') {
            throw new \RuntimeException('Офлайн-регистрация не найдена');
        }

        $this->db->prepare("UPDATE registrations SET status = 'visited', updated_at = :now WHERE id = :id")
            ->execute(['now' => now(), 'id' => $registration['id']]);

        $this->flash('Гость отмечен как пришедший');
    }

    private function undoVisited(): void
    {
        $registration = $this->registrationWithDetails((int) $_POST['id']);
        if (!$registration || (string) $registration['attendance'] !== 'offline') {
            throw new \RuntimeException('Офлайн-регистрация не найдена');
        }

        $this->db->prepare("UPDATE registrations SET status = 'approved', updated_at = :now WHERE id = :id")
            ->execute(['now' => now(), 'id' => $registration['id']]);

        $this->flash('Отметка прихода снята');
    }

    private function createBroadcast(): void
    {
        $title = trim((string) $_POST['title']);
        $audience = (string) $_POST['audience'];
        $eventId = (int) ($_POST['event_id'] ?? 0);
        $contentType = (string) $_POST['content_type'];
        $body = trim((string) ($_POST['body'] ?? ''));
        $mediaFileId = trim((string) ($_POST['media_file_id'] ?? ''));

        if ($title === '' || ($body === '' && $mediaFileId === '')) {
            throw new \RuntimeException('Заполните название и текст или file_id');
        }

        $this->db->beginTransaction();
        $this->db->prepare("
            INSERT INTO broadcast_campaigns
                (title, audience, event_id, content_type, body, media_file_id, status, created_at, updated_at)
            VALUES
                (:title, :audience, :event_id, :content_type, :body, :media_file_id, 'queued', :now, :now)
        ")->execute([
            'title' => $title,
            'audience' => $audience,
            'event_id' => $eventId > 0 ? $eventId : null,
            'content_type' => in_array($contentType, ['video_note', 'photo'], true) ? $contentType : 'text',
            'body' => $body,
            'media_file_id' => $mediaFileId,
            'now' => now(),
        ]);
        $campaignId = (int) $this->db->lastInsertId();

        $recipients = $this->broadcastRecipients($audience, $eventId);
        $insertVerb = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        $insert = $this->db->prepare("
            {$insertVerb} INTO broadcast_messages
                (campaign_id, person_id, telegram_id, status, created_at, updated_at)
            VALUES
                (:campaign_id, :person_id, :telegram_id, 'queued', :now, :now)
        ");

        foreach ($recipients as $recipient) {
            $insert->execute([
                'campaign_id' => $campaignId,
                'person_id' => $recipient['id'],
                'telegram_id' => $recipient['telegram_id'],
                'now' => now(),
            ]);
        }

        $this->db->commit();
        $this->flash('Рассылка поставлена в очередь: ' . count($recipients) . ' получателей');
    }

    private function sendOfflineApproved(array $row): void
    {
        $text = "Готово, офлайн-участие подтверждено 🏢\n\n"
            . "Ждём вас на мероприятии:\n"
            . '<b>Название:</b> ' . h((string) $row['title']) . "\n"
            . '<b>Дата:</b> ' . h($this->dateShort((string) $row['date_start'])) . "\n"
            . '<b>Время:</b> ' . h($this->timeRange((string) $row['date_start'], (string) $row['date_end'])) . "\n"
            . '<b>Наш адрес:</b> ' . h((string) $row['address']) . "\n"
            . '<b>Формат:</b> офлайн' . "\n\n"
            . "Перед событием пришлём напоминание.";

        $this->telegram->sendMessage((int) $row['telegram_id'], $text);

        if ($row['venue_lat'] !== null && $row['venue_lng'] !== null) {
            $this->telegram->sendVenue(
                (int) $row['telegram_id'],
                (float) $row['venue_lat'],
                (float) $row['venue_lng'],
                'Мегаполис Медиа',
                (string) $row['address']
            );
        }
    }

    private function sendOfflineRejected(array $row): void
    {
        if (!$this->eventSupportsOnline($row)) {
            $this->telegram->sendMessage(
                (int) $row['telegram_id'],
                'К сожалению, сейчас не можем подтвердить офлайн-участие. Если появится альтернативный формат или новые места, мы сообщим.',
                $this->mainMenuKeyboard()
            );
            return;
        }

        $text = 'К сожалению, сейчас не можем подтвердить офлайн-участие, но вы можете присоединиться онлайн. Так вы точно не пропустите эфир 💻';

        $this->telegram->sendMessage((int) $row['telegram_id'], $text, [
            'inline_keyboard' => [
                [['text' => 'Буду смотреть онлайн', 'callback_data' => 'reg_online:' . $row['event_id']]],
            ],
        ]);
    }

    private function registrationWithDetails(int $id): ?array
    {
        $stmt = $this->db->prepare("
            SELECT
                r.*,
                p.telegram_id, p.full_name, p.company, p.position_title, p.phone, p.email,
                e.id AS event_id, e.title, e.slug, e.description, e.date_start, e.date_end, e.online_start,
                e.address, e.venue_lat, e.venue_lng, e.facecast_event_id, e.facecast_url,
                e.recording_url, e.photo_album_url
            FROM registrations r
            JOIN people p ON p.id = r.person_id
            JOIN events e ON e.id = r.event_id
            WHERE r.id = :id
            LIMIT 1
        ");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    private function broadcastRecipients(string $audience, int $eventId): array
    {
        $params = [];
        $sql = 'SELECT DISTINCT p.id, p.telegram_id FROM people p';

        if ($audience !== 'all') {
            $sql .= ' JOIN registrations r ON r.person_id = p.id';
            $params['event_id'] = $eventId;
        }

        $where = ['p.consent_accepted_at IS NOT NULL'];

        if ($audience !== 'all') {
            if ($eventId <= 0) {
                throw new \RuntimeException('Для этой аудитории нужно выбрать мероприятие');
            }
            $where[] = 'r.event_id = :event_id';
        }

        if ($audience === 'event_online') {
            $where[] = "r.attendance = 'online'";
            $where[] = "r.status = 'approved'";
        } elseif ($audience === 'event_offline_approved') {
            $where[] = "r.attendance = 'offline'";
            $where[] = "r.status = 'approved'";
        } elseif ($audience === 'event_offline_pending') {
            $where[] = "r.attendance = 'offline'";
            $where[] = "r.status = 'pending'";
        } elseif ($audience === 'event_all') {
            $where[] = "r.status NOT IN ('cancelled','rejected')";
        }

        $sql .= ' WHERE ' . implode(' AND ', $where) . ' ORDER BY p.id ASC LIMIT 5000';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll();
    }

    private function audiences(): array
    {
        return [
            'all' => 'Все контакты',
            'event_all' => 'Все участники события',
            'event_online' => 'Онлайн-участники события',
            'event_offline_approved' => 'Подтвержденный офлайн',
            'event_offline_pending' => 'Офлайн на модерации',
        ];
    }

    private function statusLabel(string $status): string
    {
        return match ($status) {
            'pending' => '<span class="badge warn">На проверке</span>',
            'approved' => '<span class="badge ok">Подтверждено</span>',
            'visited' => '<span class="badge ok">Пришел</span>',
            'no_show' => '<span class="badge danger">Не пришел</span>',
            'rejected' => '<span class="badge danger">Отказ</span>',
            'cancelled' => '<span class="badge">Отменено</span>',
            default => '<span class="badge">' . h($status) . '</span>',
        };
    }

    private function registrationStatusLabel(array $row): string
    {
        if ((string) $row['attendance'] === 'online' && (string) $row['status'] === 'approved') {
            return '<span class="badge ok">Зарегистрирован</span>';
        }

        return $this->statusLabel((string) $row['status']);
    }

    private function input(string $label, string $name, string $value = '', bool $required = false, string $type = 'text', bool $bare = false): string
    {
        $html = '<label>' . h($label) . '<input type="' . h($type) . '" name="' . h($name) . '" value="' . h($value) . '" ' . ($required ? 'required' : '') . '></label>';
        return $bare ? $html : $html;
    }

    private function textarea(string $label, string $name, string $value): string
    {
        return '<label>' . h($label) . '<textarea name="' . h($name) . '" rows="8">' . h($value) . '</textarea></label>';
    }

    private function datetimeLocal(?string $value): string
    {
        if (!$value) {
            return '';
        }

        return date('Y-m-d\TH:i', strtotime($value));
    }

    private function fromDatetimeLocal(string $value): ?string
    {
        if ($value === '') {
            return null;
        }

        return date('Y-m-d H:i:s', strtotime($value));
    }

    private function dateTime(string $value): string
    {
        return $value === '' ? '' : date('d.m.Y H:i', strtotime($value));
    }

    private function privacyUrl(): string
    {
        $url = trim((string) env('PRIVACY_URL', ''));
        return $url !== '' ? $url : 'https://martis.pro/privacy.php';
    }

    private function dateShort(string $value): string
    {
        $months = [1 => 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        $ts = strtotime($value);
        return (int) date('j', $ts) . ' ' . $months[(int) date('n', $ts)];
    }

    private function timeRange(string $start, string $end): string
    {
        return 'с ' . date('H:i', strtotime($start)) . ' до ' . date('H:i', strtotime($end));
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

    private function mainMenuKeyboard(): array
    {
        return [
            'inline_keyboard' => [
                [['text' => 'Главное меню', 'callback_data' => 'main_menu']],
            ],
        ];
    }

    private function pageTitle(string $page): string
    {
        return [
            'events' => 'Мероприятия',
            'event_edit' => 'Мероприятие',
            'people' => 'Люди',
            'registrations' => 'Регистрации',
            'reception' => 'Ресепшн',
            'broadcasts' => 'Рассылки',
            'flow' => 'Сценарий',
        ][$page] ?? 'Регистрации';
    }

    private function flash(string $message, string $type = 'ok'): void
    {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
    }

    private function layout(string $title, string $content, string $page): void
    {
        $flash = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        $pageClass = preg_replace('/[^a-z0-9_-]+/i', '-', $page) ?: 'registrations';
        $activePage = $page === 'event_edit' ? 'events' : $page;

        echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<title>' . h($title) . ' - Megapolis Bot</title><script>try{if(localStorage.getItem("mm_sidebar_collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}</script><link rel="stylesheet" href="/assets/admin.css"></head><body class="admin-page admin-page-' . h($pageClass) . '">';
        echo '<aside class="sidebar"><div class="sidebar-head"><div class="brand"><span class="brand-mark">MM</span><span class="brand-text">Megapolis Bot</span></div><button class="sidebar-toggle" type="button" aria-label="Свернуть меню" aria-expanded="true" title="Свернуть меню">' . $this->icon('panel') . '</button></div><nav>';
        foreach ([
            ['key' => 'registrations', 'url' => '/', 'label' => 'Регистрации', 'icon' => 'registrations'],
            ['key' => 'reception', 'url' => '/?page=reception', 'label' => 'Ресепшн', 'icon' => 'reception'],
            ['key' => 'people', 'url' => '/?page=people', 'label' => 'Люди', 'icon' => 'people'],
            ['key' => 'events', 'url' => '/?page=events', 'label' => 'Мероприятия', 'icon' => 'events'],
            ['key' => 'broadcasts', 'url' => '/?page=broadcasts', 'label' => 'Рассылки', 'icon' => 'broadcasts'],
            ['key' => 'flow', 'url' => '/?page=flow', 'label' => 'Сценарий', 'icon' => 'flow'],
        ] as $item) {
            $class = $activePage === $item['key'] ? ' class="active"' : '';
            echo '<a' . $class . ' href="' . h($item['url']) . '" title="' . h($item['label']) . '">' . $this->icon($item['icon']) . '<span class="nav-label">' . h($item['label']) . '</span></a>';
        }
        echo '</nav><a class="logout" href="/?action=logout" title="Выйти">' . $this->icon('logout') . '<span class="nav-label">Выйти</span></a></aside>';
        echo '<main class="main"><header class="topbar"><h1>' . h($title) . '</h1><span>' . h((string) env('APP_URL', 'martis.pro')) . '</span></header>';
        if (is_array($flash)) {
            echo '<div class="notice notice-' . h((string) $flash['type']) . '">' . h((string) $flash['message']) . '</div>';
        }
        echo '<div class="main-content">' . $content . '</div></main><script src="/assets/admin.js"></script></body></html>';
    }

    private function icon(string $name): string
    {
        $paths = [
            'registrations' => '<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 9h8M8 13h5"></path>',
            'reception' => '<path d="M9 11l2 2 4-5"></path><rect x="5" y="4" width="14" height="16" rx="2"></rect><path d="M9 18h6"></path>',
            'people' => '<path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4"></path><circle cx="12" cy="9" r="3"></circle><path d="M20 19c0-1.8-1.1-3.2-2.7-3.8M16.5 6.4a2.5 2.5 0 0 1 0 4.2"></path>',
            'events' => '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"></path>',
            'broadcasts' => '<path d="M4 12h3l9-5v10l-9-5H4z"></path><path d="M18 9.5a4 4 0 0 1 0 5"></path>',
            'flow' => '<circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle><path d="M8 6h8M7 8l4 8M17 8l-4 8"></path>',
            'logout' => '<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M14 4h5v16h-5"></path>',
            'panel' => '<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M10 5v14M14 9l-3 3 3 3"></path>',
        ];
        $path = $paths[$name] ?? '<circle cx="12" cy="12" r="6"></circle>';

        return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' . $path . '</svg>';
    }
}
