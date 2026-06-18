<?php

declare(strict_types=1);

namespace Megapolis\Services;

use DateInterval;
use DateTimeImmutable;
use Megapolis\Support\Db;

final class ReminderPlanner
{
    private const OFFLINE_TYPES = ['offline_1day', 'offline_2hours', 'offline_started'];
    private const ONLINE_TYPES = ['online_15min', 'online_started'];
    private const ALL_REGISTRATION_TYPES = ['offline_1day', 'offline_2hours', 'offline_started', 'online_15min', 'online_started', 'postpromo'];

    public function planOnline(array $registration, array $event): void
    {
        $this->cancelOffline($registration);

        $onlineStart = $event['online_start'] ?: $event['date_start'];
        $this->schedule($registration, $event, 'online_15min', $this->shift($onlineStart, '-PT15M'));
        $this->schedule($registration, $event, 'online_started', new DateTimeImmutable($onlineStart));
        $this->schedule($registration, $event, 'postpromo', $this->shift((string) $event['date_end'], 'PT1H'));
    }

    public function planOfflineApproved(array $registration, array $event): void
    {
        $this->schedule($registration, $event, 'offline_1day', $this->shift((string) $event['date_start'], '-P1D'));
        $this->schedule($registration, $event, 'offline_2hours', $this->shift((string) $event['date_start'], '-PT2H'));
        $this->schedule($registration, $event, 'offline_started', new DateTimeImmutable((string) $event['date_start']));
        $this->schedule($registration, $event, 'postpromo', $this->shift((string) $event['date_end'], 'PT1H'));
    }

    public function cancelOffline(array $registration): void
    {
        $this->cancelTypes($registration, self::OFFLINE_TYPES);
    }

    public function cancelOnline(array $registration): void
    {
        $this->cancelTypes($registration, self::ONLINE_TYPES);
    }

    public function cancelAll(array $registration): void
    {
        $this->cancelTypes($registration, self::ALL_REGISTRATION_TYPES);
    }

    private function schedule(array $registration, array $event, string $type, DateTimeImmutable $sendAt): void
    {
        if ($sendAt <= new DateTimeImmutable('now')) {
            return;
        }

        $pdo = Db::pdo();
        $driver = (string) $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME);

        if ($driver === 'sqlite') {
            $sql = "
                INSERT INTO scheduled_messages
                    (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
                VALUES
                    (:registration_id, :person_id, :event_id, :type, :send_at, NULL, :now, :now)
                ON CONFLICT(registration_id, type) DO UPDATE SET
                    send_at = excluded.send_at,
                    sent_at = NULL,
                    failed_at = NULL,
                    error = NULL,
                    updated_at = excluded.updated_at
            ";
        } else {
            $sql = "
                INSERT INTO scheduled_messages
                    (registration_id, person_id, event_id, type, send_at, payload, created_at, updated_at)
                VALUES
                    (:registration_id, :person_id, :event_id, :type, :send_at, NULL, :now, :now)
                ON DUPLICATE KEY UPDATE
                    send_at = VALUES(send_at),
                    sent_at = NULL,
                    failed_at = NULL,
                    error = NULL,
                    updated_at = VALUES(updated_at)
            ";
        }

        $pdo->prepare($sql)->execute([
            'registration_id' => $registration['id'],
            'person_id' => $registration['person_id'],
            'event_id' => $event['id'] ?? $event['event_id'],
            'type' => $type,
            'send_at' => $sendAt->format('Y-m-d H:i:s'),
            'now' => now(),
        ]);
    }

    private function cancelTypes(array $registration, array $types): void
    {
        if ($types === [] || empty($registration['id'])) {
            return;
        }

        $placeholders = [];
        $params = [
            'registration_id' => $registration['id'],
            'now' => now(),
        ];

        foreach (array_values($types) as $index => $type) {
            $key = 'type' . $index;
            $placeholders[] = ':' . $key;
            $params[$key] = $type;
        }

        Db::pdo()->prepare("
            UPDATE scheduled_messages
            SET sent_at = :now,
                updated_at = :now
            WHERE registration_id = :registration_id
              AND sent_at IS NULL
              AND failed_at IS NULL
              AND type IN (" . implode(', ', $placeholders) . ")
        ")->execute($params);
    }

    private function shift(string $date, string $spec): DateTimeImmutable
    {
        $dt = new DateTimeImmutable($date);
        $negative = str_starts_with($spec, '-');
        $interval = new DateInterval(ltrim($spec, '-'));

        return $negative ? $dt->sub($interval) : $dt->add($interval);
    }
}
