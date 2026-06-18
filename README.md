# Megapolis Event Bot

Node.js/MySQL-проект для Telegram-бота регистрации на мероприятия, админки модератора, рассылок, ресепшна и сценарной карты.

## Что внутри

- `node-backend/src/server.js` - HTTP-сервер, админка, Telegram webhook, health и privacy.
- `node-backend/src/worker.js` - отправка напоминаний и рассылок.
- `node-backend/src/bot/` - сценарий Telegram-бота.
- `node-backend/src/admin/` - админка модератора на Node.js.
- `database/schema.sql` - структура MySQL.
- `database/seed.sql` - стартовое мероприятие "Митап: Человек труда".
- `database/migrations/` - точечные SQL-обновления для уже созданной базы.
- `node-backend/README.md` - подробный запуск на VDS.

## Быстрый запуск на VDS

```bash
cd node-backend
npm ci
cp .env.example .env
nano .env
npm run check
npm start
```

Worker для напоминаний и рассылок:

```bash
npm run worker:loop
```

Webhook Telegram:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://martis.pro/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Полная инструкция по Nginx/systemd лежит в `node-backend/README.md`.

## Важное по секретам

`node-backend/.env` не хранится в Git. Если Telegram-токен был отправлен в чат, лучше перевыпустить его в BotFather перед продакшеном.

## Facecast

Публичная ссылка `https://facecast.net/api/v1` не раскрывает список методов без дополнительной документации или ключа. Поэтому интеграция сделана через настраиваемый адаптер:

- `FACECAST_API_BASE`
- `FACECAST_API_TOKEN`
- `FACECAST_REGISTRATION_ENDPOINT`
- `FACECAST_DEFAULT_STREAM_URL`
- `FACECAST_DEMO_MODE`

Когда будет известен точный endpoint регистрации зрителя, достаточно заполнить переменные окружения или немного поправить `node-backend/src/services/facecast-client.js`.
