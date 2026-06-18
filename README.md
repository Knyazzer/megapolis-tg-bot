# Megapolis Event Bot

Минимальный PHP/MySQL-проект для Telegram-бота регистрации на мероприятия и админки модератора на обычном хостинге REG.RU.

## Что внутри

- `public/webhook.php` - Telegram webhook.
- `public/index.php` - админка для `martis.pro`.
- `cron/run.php` - отправка напоминаний и рассылок.
- `database/schema.sql` - структура MySQL.
- `database/seed.sql` - стартовое мероприятие "Митап: Человек труда".
- `database/migrations/` - точечные SQL-обновления для уже созданной базы.
- `tools/hash_password.php` - генерация хеша пароля администратора.
- `tools/set_webhook.php` - установка webhook в Telegram.

## Установка на REG.RU

Подробный чеклист для ISPmanager лежит в `DEPLOY_REG_RU.md`.

1. Создать MySQL-базу и пользователя в панели REG.RU.
2. Импортировать `database/schema.sql`, затем `database/seed.sql` через phpMyAdmin.
3. Скопировать проект на хостинг так, чтобы web-root смотрел в папку `public`.
4. Скопировать `.env.example` в `.env` и заполнить значения.
5. Сгенерировать хеш пароля:

```bash
php tools/hash_password.php 'your-admin-password'
```

6. Вставить результат в `ADMIN_PASSWORD_HASH`.
7. Установить webhook:

```bash
php tools/set_webhook.php
```

8. Добавить cron-задачу раз в минуту:

```bash
* * * * * /usr/bin/php /path/to/project/cron/run.php >/dev/null 2>&1
```

## Важное по секретам

Не храните реальный токен Telegram в репозитории. Если токен был отправлен в чат, лучше перевыпустить его в BotFather и заменить в `.env`.

## Facecast

Публичная ссылка `https://facecast.net/api/v1` не раскрывает список методов без дополнительной документации или ключа. Поэтому интеграция сделана через настраиваемый адаптер:

- `FACECAST_API_BASE`
- `FACECAST_API_TOKEN`
- `FACECAST_REGISTRATION_ENDPOINT`
- `FACECAST_DEFAULT_STREAM_URL`
- `FACECAST_DEMO_MODE`

Когда будет известен точный endpoint регистрации зрителя, достаточно заполнить переменные окружения или немного поправить `src/Services/FacecastClient.php`.
