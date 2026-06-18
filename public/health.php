<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Megapolis\Services\TelegramClient;
use Megapolis\Support\Db;

$secret = (string) env('TELEGRAM_WEBHOOK_SECRET', '');
if ($secret !== '' && !hash_equals($secret, (string) ($_GET['key'] ?? ''))) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$result = [
    'ok' => true,
    'time' => now(),
    'app_url' => env('APP_URL'),
    'telegram_dry_run' => env('TELEGRAM_DRY_RUN', false),
    'telegram_client_reply_mode' => method_exists(TelegramClient::class, 'beginWebhookReplyMode'),
    'telegram_client_file' => (new ReflectionClass(TelegramClient::class))->getFileName(),
    'webhook_file' => __FILE__,
];

try {
    $result['db'] = [
        'driver' => Db::pdo()->getAttribute(PDO::ATTR_DRIVER_NAME),
        'events' => (int) Db::pdo()->query('SELECT COUNT(*) FROM events')->fetchColumn(),
    ];
} catch (Throwable $e) {
    $result['db_error'] = $e->getMessage();
}

$token = (string) env('TELEGRAM_BOT_TOKEN', '');
if ($token !== '') {
    $ch = curl_init('https://api.telegram.org/bot' . $token . '/getMe');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 6,
    ]);
    if (defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    $result['telegram_api'] = [
        'status' => $status,
        'ok' => $response !== false && $status < 400,
        'error' => $response === false ? $error : null,
        'response' => is_string($response) ? json_decode($response, true) : null,
    ];
}

header('Content-Type: application/json; charset=UTF-8');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
