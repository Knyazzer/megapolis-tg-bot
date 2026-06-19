# Стек и устройство приложения

## Стек
- **Runtime:** Node.js 20 (ESM). Без фреймворков — голый `node:http`.
- **БД:** MySQL 8 через `mysql2/promise` (пул, named placeholders).
- **Зависимости:** `mysql2`, `bcryptjs`. Больше ничего тяжёлого.
- **Контейнеризация:** Docker + Docker Compose. Образ `ghcr.io/knyazzer/megapolis-tg-bot`.
- **Прод:** VDS (Ubuntu 24.04), nginx reverse-proxy + Let's Encrypt, домен `bot.knzteam.ru`.

## Два процесса
- **`app`** (`node-backend/src/server.js`) — HTTP-сервер: админка модератора, Telegram webhook, `/health`, `/privacy`.
- **`worker`** (`node-backend/src/worker.js`) — фоновая отправка напоминаний и рассылок (`npm run worker:loop`).
- **`db`** — MySQL 8 (контейнер, volume `mysql_data`).

## Структура `node-backend/src/`
| Папка/файл | Назначение |
|---|---|
| `server.js` | HTTP-роутинг, webhook, health, privacy |
| `worker.js` | точка входа воркера |
| `bot/` | сценарий Telegram-бота (FSM регистрации), клавиатуры |
| `admin/` | серверная админка модератора + авторизация |
| `services/` | внешние API: `telegram-client.js`, `facecast-client.js`, `reminder-planner.js` |
| `repositories/` | доступ к БД: people / events / registrations |
| `jobs/` | `message-worker.js` — обработка очереди сообщений |
| `db/mysql.js` | пул соединений, `query`/`execute`/`withTransaction` |
| `utils/` | `dates.js`, `html.js` (экранирование), `logger.js` |
| `config.js`, `env.js` | конфиг из переменных окружения |

## HTTP-эндпоинты
- `GET /` — админка модератора (логин/пароль из `.env`).
- `POST /telegram/webhook` — приём апдейтов Telegram (защита секретом).
- `GET /health` — диагностика (app + MySQL); `?telegram=1` — проверка токена.
- `GET /privacy` — согласие на обработку ПДн.

## База данных (`database/`)
- `schema.sql` — таблицы: `people`, `events`, `registrations`, `scheduled_messages`, `broadcast_campaigns`, `broadcast_messages`, `bot_logs`.
- `seed.sql` — стартовое мероприятие.
- `migrations/` — точечные изменения схемы (применять отдельно на существующей БД).

## Docker
- `compose.yaml` — локальная разработка (сборка из исходников).
- `compose.prod.yml` — прод (тянет готовый образ из GHCR).
- `node-backend/Dockerfile` — многоэтапной сборки нет, простой: `npm ci` → `npm run check` → запуск.

## Конфиг
Всё через `.env` (шаблон `.env.docker.example`): `APP_URL`, `MYSQL_*`, `ADMIN_LOGIN`/`ADMIN_PASSWORD_HASH`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`, `FACECAST_*`. Секреты в Git не хранятся.

## Известные проблемы (см. `docs/02-bug-report.md`)
- Воркер: возможны дубли отправки (нет атомарного захвата задач) и нет обработки Telegram 429 — чинится на этапе стабилизации.
- Нет тестов и migration-runner — в плане доработок (`docs/04-remediation-plan.md`).
