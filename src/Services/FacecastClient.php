<?php

declare(strict_types=1);

namespace Megapolis\Services;

use RuntimeException;

final class FacecastClient
{
    public function registerViewer(array $event, array $person): array
    {
        $demoMode = (bool) env('FACECAST_DEMO_MODE', true);
        $endpoint = trim((string) env('FACECAST_REGISTRATION_ENDPOINT', ''));

        if ($demoMode || $endpoint === '') {
            return $this->demoCredentials($event, $person);
        }

        $base = rtrim((string) env('FACECAST_API_BASE', 'https://facecast.net/api/v1'), '/');
        $url = $base . '/' . ltrim($endpoint, '/');
        $token = (string) env('FACECAST_API_TOKEN', '');

        $payload = [
            'event_id' => $event['facecast_event_id'] ?: $event['slug'],
            'viewer' => [
                'name' => $person['full_name'],
                'company' => $person['company'],
                'position' => $person['position_title'],
                'email' => $person['email'],
                'phone' => $person['phone'],
            ],
        ];

        $headers = ['Content-Type: application/json'];
        if ($token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 25,
        ]);

        $response = curl_exec($ch);
        $error = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($response === false || $status >= 400) {
            throw new RuntimeException('Facecast registration failed: ' . ($response ?: $error));
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Facecast returned invalid JSON');
        }

        return [
            'login' => (string) ($decoded['login'] ?? $decoded['email'] ?? $person['email']),
            'password' => (string) ($decoded['password'] ?? $decoded['access_password'] ?? ''),
            'url' => (string) ($decoded['url'] ?? $decoded['link'] ?? $decoded['viewer_url'] ?? $event['facecast_url'] ?? ''),
        ];
    }

    private function demoCredentials(array $event, array $person): array
    {
        $seed = substr(hash('sha256', (string) $person['telegram_id'] . ':' . (string) $event['id']), 0, 8);
        $streamUrl = (string) ($event['facecast_url'] ?: env('FACECAST_DEFAULT_STREAM_URL', ''));

        return [
            'login' => (string) ($person['email'] ?: ('viewer-' . $person['telegram_id'])),
            'password' => 'MM-' . strtoupper($seed),
            'url' => $streamUrl,
        ];
    }
}
