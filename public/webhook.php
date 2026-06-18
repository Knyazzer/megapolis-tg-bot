<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Megapolis\Services\TelegramClient;

header('X-MM-Bot-Webhook-Version: reply-mode-20260618');

$secret = (string) env('TELEGRAM_WEBHOOK_SECRET', '');
if ($secret !== '') {
    $header = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
    if (!hash_equals($secret, (string) $header)) {
        http_response_code(403);
        echo 'Forbidden';
        exit;
    }
}

$raw = file_get_contents('php://input') ?: '';
$update = json_decode($raw, true);
if (!is_array($update)) {
    http_response_code(400);
    echo 'Bad request';
    exit;
}

$chatId = webhook_chat_id($update);
TelegramClient::beginWebhookReplyMode($chatId);

(new Megapolis\Controllers\BotController())->handle($update);

$reply = TelegramClient::consumeWebhookReply();
if ($reply !== null) {
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($reply, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

echo 'OK';

function webhook_chat_id(array $update): int|string|null
{
    if (isset($update['message']['chat']['id'])) {
        return $update['message']['chat']['id'];
    }

    if (isset($update['callback_query']['message']['chat']['id'])) {
        return $update['callback_query']['message']['chat']['id'];
    }

    if (isset($update['callback_query']['from']['id'])) {
        return $update['callback_query']['from']['id'];
    }

    return null;
}
