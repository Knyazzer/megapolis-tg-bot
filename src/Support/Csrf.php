<?php

declare(strict_types=1);

namespace Megapolis\Support;

final class Csrf
{
    public static function token(): string
    {
        Auth::start();
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return $_SESSION['csrf_token'];
    }

    public static function field(): string
    {
        return '<input type="hidden" name="_token" value="' . h(self::token()) . '">';
    }

    public static function verify(): void
    {
        Auth::start();
        $token = $_POST['_token'] ?? '';
        if (!is_string($token) || !hash_equals((string) ($_SESSION['csrf_token'] ?? ''), $token)) {
            http_response_code(419);
            echo 'CSRF token mismatch';
            exit;
        }
    }
}
