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
- `GET /live` — живой HTTP-процесс, независимо от состояния БД.
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

## Запуск при ошибках БД
- Миграции выполняются отдельной командой `npm run migrate`; старт app/worker не запускает DDL.
- `/health` проверяет БД и схему и возвращает 503 при неготовности; `/health?schema=1` обновляет подробную диагностику.
- HTTP остаётся жив, зависимые операции временно недоступны, воркер повторяет проверку после сбоя.
- После восстановления БД/схемы процессы продолжают работу без рестарта. Порядок будущего обновления — `docs/DEVELOPMENT.md`.

## Надёжность очереди
- Задания захватываются через БД с временным токеном; прогресс медиа и частей текста сохраняется.
- Временные ошибки Telegram повторяются с задержкой; 429 включает общую сохранённую паузу.
- Подробности, границы гарантии доставки и миграция — в `node-backend/README.md`, раздел «Очередь сообщений».
- Проверки: `npm --prefix node-backend test` (SQLite-тестам нужен Node.js 22.13+).
- Исторический аудит — `docs/02-bug-report.md`; его выводы относятся к ревизии от 2026-06-18.
