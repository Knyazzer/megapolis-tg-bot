<?php

declare(strict_types=1);

namespace Megapolis\Support;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $connection = (string) env('DB_CONNECTION', 'mysql');
        if ($connection === 'sqlite') {
            $database = (string) env('DB_DATABASE', storage_path('demo.sqlite'));
            self::$pdo = new PDO('sqlite:' . $database, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            self::$pdo->exec('PRAGMA foreign_keys = ON');

            return self::$pdo;
        }

        $host = (string) env('DB_HOST', 'localhost');
        $port = (string) env('DB_PORT', '3306');
        $database = (string) env('DB_DATABASE', '');
        $username = (string) env('DB_USERNAME', '');
        $password = (string) env('DB_PASSWORD', '');

        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
        self::$pdo = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return self::$pdo;
    }
}
