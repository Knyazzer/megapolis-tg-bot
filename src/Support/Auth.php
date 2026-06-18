<?php

declare(strict_types=1);

namespace Megapolis\Support;

final class Auth
{
    public static function start(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }
    }

    public static function check(): bool
    {
        self::start();
        return !empty($_SESSION['admin_logged_in']);
    }

    public static function attempt(string $login, string $password): bool
    {
        self::start();

        $expectedLogin = (string) env('ADMIN_LOGIN', 'admin');
        $hash = (string) env('ADMIN_PASSWORD_HASH', '');

        if (!hash_equals($expectedLogin, $login) || $hash === '') {
            return false;
        }

        if (!password_verify($password, $hash)) {
            return false;
        }

        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_login'] = $login;

        return true;
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        session_destroy();
    }
}
