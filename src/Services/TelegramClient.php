<?php

declare(strict_types=1);

namespace Megapolis\Services;

use RuntimeException;

final class TelegramClient
{
    private static bool $webhookReplyMode = false;
    private static int|string|null $webhookChatId = null;
    private static ?array $webhookReplyPayload = null;

    public function __construct(private readonly ?string $token = null)
    {
    }

    public static function beginWebhookReplyMode(int|string|null $chatId = null): void
    {
        self::$webhookReplyMode = true;
        self::$webhookChatId = $chatId;
        self::$webhookReplyPayload = null;
    }

    public static function consumeWebhookReply(): ?array
    {
        $payload = self::$webhookReplyPayload;
        self::$webhookReplyMode = false;
        self::$webhookChatId = null;
        self::$webhookReplyPayload = null;

        return $payload;
    }

    public function sendMessage(int|string $chatId, string $text, array $replyMarkup = [], array $extra = []): array
    {
        $chunks = $this->splitText($text);
        $result = [];

        foreach ($chunks as $index => $chunk) {
            $payload = array_merge([
                'chat_id' => $chatId,
                'text' => $chunk,
                'parse_mode' => 'HTML',
                'disable_web_page_preview' => true,
            ], $extra);

            if ($replyMarkup !== [] && $index === count($chunks) - 1) {
                $payload['reply_markup'] = json_encode($replyMarkup, JSON_UNESCAPED_UNICODE);
            }

            $result = $this->api('sendMessage', $payload);
        }

        return $result;
    }

    public function editMessageText(int|string $chatId, int $messageId, string $text, array $replyMarkup = []): array
    {
        $payload = [
            'chat_id' => $chatId,
            'message_id' => $messageId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
        ];

        if ($replyMarkup !== []) {
            $payload['reply_markup'] = json_encode($replyMarkup, JSON_UNESCAPED_UNICODE);
        }

        return $this->api('editMessageText', $payload);
    }

    public function answerCallbackQuery(string $callbackQueryId, string $text = ''): array
    {
        return $this->api('answerCallbackQuery', [
            'callback_query_id' => $callbackQueryId,
            'text' => $text,
            'show_alert' => false,
        ]);
    }

    public function sendVideoNote(int|string $chatId, string $fileId): array
    {
        return $this->api('sendVideoNote', [
            'chat_id' => $chatId,
            'video_note' => $fileId,
        ]);
    }

    public function sendPhoto(int|string $chatId, string $photo, string $caption = ''): array
    {
        $payload = [
            'chat_id' => $chatId,
            'photo' => $photo,
            'parse_mode' => 'HTML',
        ];

        if ($caption !== '') {
            $payload['caption'] = $caption;
        }

        return $this->api('sendPhoto', $payload);
    }

    public function sendVenue(int|string $chatId, float $lat, float $lng, string $title, string $address): array
    {
        return $this->api('sendVenue', [
            'chat_id' => $chatId,
            'latitude' => $lat,
            'longitude' => $lng,
            'title' => $title,
            'address' => $address,
        ]);
    }

    public function api(string $method, array $payload): array
    {
        if (self::$webhookReplyMode && $this->queueWebhookReply($method, $payload)) {
            return ['ok' => true, 'result' => ['webhook_reply' => true]];
        }

        $token = $this->token ?? (string) env('TELEGRAM_BOT_TOKEN', '');
        if ((bool) env('TELEGRAM_DRY_RUN', false)) {
            log_line('Telegram dry run: ' . $method, $payload);
            return ['ok' => true, 'result' => ['dry_run' => true]];
        }

        if ($token === '') {
            throw new RuntimeException('TELEGRAM_BOT_TOKEN is empty');
        }

        $url = "https://api.telegram.org/bot{$token}/{$method}";
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
        ]);
        if (defined('CURL_IPRESOLVE_V4')) {
            curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        }

        $response = curl_exec($ch);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            throw new RuntimeException('Telegram request failed: ' . $error);
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded) || empty($decoded['ok'])) {
            throw new RuntimeException('Telegram API error: ' . $response);
        }

        return $decoded;
    }

    private function queueWebhookReply(string $method, array $payload): bool
    {
        if ($method === 'answerCallbackQuery') {
            return true;
        }

        if (!in_array($method, ['sendMessage', 'sendPhoto', 'sendVideoNote', 'sendVenue'], true)) {
            return false;
        }

        $chatId = $payload['chat_id'] ?? null;
        if (self::$webhookChatId !== null && (string) $chatId !== (string) self::$webhookChatId) {
            log_line('Telegram webhook reply skipped non-user chat: ' . $method, ['chat_id' => $chatId]);
            return true;
        }

        $reply = array_merge(['method' => $method], $payload);
        if (isset($reply['reply_markup']) && is_string($reply['reply_markup'])) {
            $decodedMarkup = json_decode($reply['reply_markup'], true);
            if (is_array($decodedMarkup)) {
                $reply['reply_markup'] = $decodedMarkup;
            }
        }

        if (
            self::$webhookReplyPayload !== null
            && self::$webhookReplyPayload['method'] === 'sendMessage'
            && $method === 'sendMessage'
        ) {
            self::$webhookReplyPayload['text'] = trim((string) self::$webhookReplyPayload['text'] . "\n\n" . (string) $reply['text']);
            if (isset($reply['reply_markup'])) {
                self::$webhookReplyPayload['reply_markup'] = $reply['reply_markup'];
            }

            return true;
        }

        if (self::$webhookReplyPayload === null) {
            self::$webhookReplyPayload = $reply;
        } else {
            log_line('Telegram webhook reply skipped extra method: ' . $method);
        }

        return true;
    }

    private function splitText(string $text): array
    {
        if (mb_strlen($text) <= 3900) {
            return [$text];
        }

        $chunks = [];
        $current = '';
        foreach (preg_split('/\R/u', $text) ?: [] as $line) {
            if (mb_strlen($current . "\n" . $line) > 3900) {
                $chunks[] = $current;
                $current = $line;
            } else {
                $current .= ($current === '' ? '' : "\n") . $line;
            }
        }

        if ($current !== '') {
            $chunks[] = $current;
        }

        return $chunks;
    }
}
