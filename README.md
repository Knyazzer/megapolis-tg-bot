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
- `compose.yaml` - Docker Compose для backend, worker и MySQL.
- `docs/` - аудит проекта, gap-анализ Nexus, план доработок и инструкции по деплою.
- `docs/DOCKER_DEPLOY.md` - инструкция Docker-деплоя на VDS/ODS.

## Быстрый запуск на VDS

Через Docker:

```bash
cp .env.docker.example .env
nano .env
docker compose up -d --build
```

Подробно: `docs/DOCKER_DEPLOY.md`.

Без Docker:

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

Онлайн-регистрация подключена через Facecast API `https://facecast.net/api/v1`.
Для события "Митап: Человек труда" в `.env` используются:

- `FACECAST_UID`
- `FACECAST_API_KEY`
- `FACECAST_REGISTRATION_ENDPOINT=insert_key`
- `FACECAST_CHANNEL_ID=11110`
- `FACECAST_DEFAULT_STREAM_URL=https://facecast.net/w/6k2njf`
- `FACECAST_DIRECT_LINK_FALLBACK=true`
- `FACECAST_DEMO_MODE=false` на продакшене

Метод `insert_key` создает персональный пароль для эфира, если событие Facecast работает в режиме с паролями. Если Facecast отвечает, что текущий режим события не поддерживает пароли, бот сохраняет онлайн-регистрацию и отправляет прямую ссылку на эфир.
