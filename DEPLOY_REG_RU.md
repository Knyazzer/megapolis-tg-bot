# Выгрузка на REG.RU / ISPmanager

Проект рассчитан на обычный PHP-хостинг: админка живет на `https://martis.pro`, Telegram webhook на `https://martis.pro/webhook.php`, база данных - MySQL.

## 1. Что проверить на хостинге

- PHP 8.1 или новее.
- Расширения PHP: `pdo_mysql`, `curl`, `mbstring`, `json`, `openssl`.
- Для домена включен HTTPS-сертификат.
- Доступен cron с запуском раз в минуту.
- Доступ к phpMyAdmin или импорту SQL в ISPmanager.

## 2. Что создать в ISPmanager

### База данных

В ISPmanager откройте раздел `Базы данных` и создайте новую MySQL-базу:

- Имя базы: можно `martis_bot` или `megapolis_bot`.
- Пользователь: отдельный пользователь только для этой базы.
- Пароль: длинный случайный пароль.
- Кодировка/сравнение, если есть выбор: `utf8mb4` / `utf8mb4_unicode_ci`.

Пользователю нужны права на эту базу: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `DROP`.

После создания нужно импортировать:

1. `database/schema.sql`
2. `database/seed.sql`
3. все файлы из `database/migrations/`, если база уже была создана раньше и схема обновлялась

Для новой чистой базы обычно достаточно `schema.sql` и `seed.sql`.

## 3. Как расположить файлы

Лучший вариант: настроить корневую папку домена на папку `public`.

Пример структуры:

```text
/var/www/.../mm-bot/
  .env
  src/
  database/
  cron/
  public/
    index.php
    webhook.php
    privacy.php
    assets/
  storage/
```

DocumentRoot домена должен смотреть в:

```text
/var/www/.../mm-bot/public
```

Если в ISPmanager нельзя поменять корневую папку на `public`, можно загрузить проект в корень сайта вместе с текущим `.htaccess`. Он закрывает доступ к служебным папкам и прокидывает запросы в `public`.

## 4. Файл `.env` на сервере

На сервере создается файл `.env` на основе `.env.example`.

Минимальный продакшен-набор:

```env
APP_NAME="Megapolis Event Bot"
APP_URL=https://martis.pro
APP_TIMEZONE=Europe/Moscow

DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=имя_базы_из_ispmanager
DB_USERNAME=имя_пользователя_базы
DB_PASSWORD=пароль_пользователя_базы

ADMIN_LOGIN=admin
ADMIN_PASSWORD_HASH=сюда_хеш_пароля

TELEGRAM_BOT_TOKEN=новый_токен_бота
TELEGRAM_WEBHOOK_SECRET=случайная_секретная_строка
TELEGRAM_DRY_RUN=false
ADMIN_TELEGRAM_IDS=telegram_id_админов_через_запятую

FACECAST_API_BASE=https://facecast.net/api/v1
FACECAST_API_TOKEN=
FACECAST_REGISTRATION_ENDPOINT=
FACECAST_DEFAULT_STREAM_URL=
FACECAST_DEMO_MODE=true

TELEGRAM_CHANNEL_URL=https://t.me/megapolismedia
COMPANY_SITE_URL=https://megapolis.media
PRIVACY_URL=https://martis.pro/privacy.php
```

Хеш пароля админки генерируется командой:

```bash
php tools/hash_password.php 'ваш-пароль-для-админки'
```

Секрет webhook можно сделать любой длинной случайной строкой, например 40-60 символов.

## 5. Cron

В ISPmanager нужно добавить cron-задачу раз в минуту:

```cron
* * * * * /usr/bin/php /полный/путь/к/mm-bot/cron/run.php >/dev/null 2>&1
```

Если PHP на хостинге лежит по другому пути, в ISPmanager обычно можно выбрать версию PHP в интерфейсе cron или посмотреть путь в справке хостинга.

## 6. Webhook Telegram

После загрузки файлов и заполнения `.env` нужно выполнить:

```bash
php tools/set_webhook.php
```

Ожидаемый ответ Telegram:

```json
{
  "ok": true,
  "result": true
}
```

После этого Telegram будет отправлять события на:

```text
https://martis.pro/webhook.php
```

## 7. Что прислать для настройки

Не присылайте пароль от ISPmanager. Нужны только значения для `.env`:

- `DB_HOST`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USERNAME`
- `DB_PASSWORD`
- какой путь на сервере будет у проекта, если уже знаете
- какой логин хотите для админки
- временный пароль для админки или готовый `ADMIN_PASSWORD_HASH`
- новый `TELEGRAM_BOT_TOKEN`
- Telegram ID админов для уведомлений
- данные Facecast, если они уже есть: API token, endpoint регистрации, ссылка эфира по умолчанию

Важно: токен Telegram, который уже был отправлен в чат, лучше перевыпустить в BotFather перед продакшеном.
