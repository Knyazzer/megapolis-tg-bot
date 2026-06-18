<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Megapolis\Services\TelegramClient;

$url = app_url('/webhook.php');
$secret = (string) env('TELEGRAM_WEBHOOK_SECRET', '');

$payload = [
    'url' => $url,
    'allowed_updates' => json_encode(['message', 'callback_query'], JSON_UNESCAPED_UNICODE),
];

if ($secret !== '') {
    $payload['secret_token'] = $secret;
}

$response = (new TelegramClient())->api('setWebhook', $payload);
echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
