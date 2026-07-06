# megapolis-tg-bot (Megapolis Event Bot)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Telegram-бот регистрации на мероприятия Megapolis: сценарий бота (webhook), админка модератора, worker напоминаний и рассылок, ресепшн и сценарная карта. Node.js + MySQL. **Единственное приложение на NL-сервере** `vds-77-233-214-80` (домен `bot.knzteam.ru`) — см. `_knowledge/drafts/infra-vds-77-233-214-80.md`. До 2026-07-05 репозиторий жил только на GitHub (github.com/Knyazzer/megapolis-tg-bot) и на сервере; пустышка `MegaBot` в коллекции — вероятно, заброшенная заготовка.

## Команды

```bash
# Docker (основной путь на VDS)
cp .env.docker.example .env   # заполнить
docker compose up -d --build  # backend + worker + MySQL

# Без Docker
cd node-backend
npm ci
cp .env.example .env
npm run check                 # проверка конфигурации
npm start                     # HTTP-сервер (админка + webhook)
npm run worker:loop           # worker напоминаний/рассылок
```

Подробный деплой: `docs/DOCKER_DEPLOY.md`; запуск на VDS: `node-backend/README.md`.

## Структура

- `node-backend/src/server.js` — HTTP-сервер: админка, Telegram webhook, /health, privacy.
- `node-backend/src/worker.js` — отправка напоминаний и рассылок.
- `node-backend/src/bot/` — сценарий Telegram-бота.
- `node-backend/src/admin/` — админка модератора.
- `database/schema.sql` + `seed.sql` + `migrations/` — структура MySQL, стартовое мероприятие, точечные обновления.
- `compose.yaml` / `compose.prod.yml` — Docker Compose (backend, worker, MySQL).
- `docs/` — аудит проекта, gap-анализ Nexus, план доработок, деплой; `RULES.md` — свои правила репо.

## Порты и окружение

- Секреты и конфиг — `.env` (шаблоны `.env.docker.example`, `node-backend/.env.example`); реальный `.env` только на сервере.
- Telegram работает через **webhook** → на сервере нужен HTTPS до `bot.knzteam.ru` (кто терминирует SSL на NL-VDS — уточнить, см. infra-черновик).
- MySQL — контейнером из compose.

## Заметки для агентов

- Прод живёт на отдельном NL-сервере, не на основном VDS 147.45.97.124.
- В `docs/` есть gap-анализ по интеграции с Nexus — читать перед задачами на стыке с экосистемой Megapolis.
- Свой `RULES.md` в корне репо — соблюдать его наравне с правилами коллекции.
