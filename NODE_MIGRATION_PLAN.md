# План перехода backend с PHP на Node.js

Цель: перенести серверную часть Telegram-бота, админки, cron-задач и интеграций на Node.js без потери текущей логики, данных и возможности работать на проде.

## 1. Рекомендуемый стек Node.js

- Runtime: Node.js 20 LTS или новее.
- Backend framework: Fastify или NestJS.
- Telegram bot: `grammy` или `telegraf`.
- Database: MySQL 8 / MariaDB.
- ORM/query builder: Prisma или Kysely.
- Validation: Zod.
- Templates/admin frontend:
  - быстрый переход: server-rendered HTML + CSS + vanilla JS;
  - следующий этап: React/Vite или Next.js только для админки.
- Jobs/cron:
  - на VPS: BullMQ + Redis или node-cron;
  - на shared hosting без долгого процесса: отдельные CLI-скрипты, запускаемые cron.
- Config: `.env` + typed config layer.
- Logging: Pino.
- Tests: Vitest + Supertest.

## 2. Что переносим из текущего PHP

### Публичные endpoints

- `GET /` - админка.
- `POST /webhook.php` или `POST /telegram/webhook` - Telegram webhook.
- `GET /privacy.php` или `GET /privacy` - согласие на персональные данные.
- `GET /health.php` или `GET /health` - диагностика.

### Сервисы

- Telegram API client.
- Facecast client.
- Reminder planner.
- Broadcast sender.
- Bitrix24 client, когда начнем CRM-интеграцию.

### Доменные сущности

- People.
- Events.
- Registrations.
- Scheduled messages.
- Broadcast campaigns.
- Broadcast messages.
- Bot logs.

## 3. Миграция базы

Текущая MySQL-схема уже подходит для Node.js. На первом этапе лучше не менять таблицы, чтобы:

- не переносить данные вручную;
- не ломать админку во время перехода;
- можно было временно держать PHP и Node параллельно.

Порядок:

1. Описать текущую схему в Prisma/Kysely.
2. Сделать read-only smoke-test подключения к продовой MySQL.
3. Перенести бизнес-логику без изменения таблиц.
4. После стабилизации добавить новые миграции для Bitrix24-полей и служебных sync-статусов.

## 4. Этапы перехода

### Этап 0. Заморозить PHP-версию

- Зафиксировать текущий PHP-код в Git.
- Зафиксировать SQL-схему.
- Не менять одновременно UX и backend.
- Сохранить production `.env` отдельно, без коммита в Git.

### Этап 1. Node.js каркас

- Создать `package.json`.
- Добавить Fastify/NestJS.
- Добавить health endpoint.
- Добавить конфиг `.env`.
- Добавить подключение к MySQL.
- Добавить базовый logger.

Критерий готовности: `GET /health` показывает статус приложения, БД и версии.

### Этап 2. Telegram webhook

- Перенести обработку `/start`.
- Перенести callback-кнопки.
- Перенести сценарий анкеты.
- Перенести быстрый webhook reply.
- Добавить fallback на обычный Telegram API, если сервер может ходить к `api.telegram.org`.

Критерий готовности: пользователь может пройти регистрацию до выбора мероприятия.

### Этап 3. Регистрация на мероприятия

- Перенести список событий.
- Перенести выбор онлайн/офлайн.
- Перенести онлайн-доступ Facecast.
- Перенести офлайн-заявку и уведомления админам.
- Перенести защиту от дублей и повторных кликов.

Критерий готовности: онлайн и офлайн регистрации создаются в той же MySQL.

### Этап 4. Админка

Вариант A, быстрее:

- оставить server-rendered HTML;
- перенести PHP templates в Node render-функции;
- сохранить CSS/JS почти без изменений.

Вариант B, лучше долгосрочно:

- сделать API на Node;
- админку вынести в React/Vite;
- добавить нормальные состояния загрузки, фильтры, формы и роли.

Критерий готовности: регистрации, канбан, ресепшн, мероприятия, рассылки и сценарий работают как в PHP-версии.

### Этап 5. Напоминания и рассылки

- Перенести `cron/run.php` в Node CLI script.
- Сохранить запуск раз в минуту через cron.
- Обработать scheduled messages.
- Обработать broadcast campaigns.
- Добавить retry и логирование ошибок.

Критерий готовности: напоминания и рассылки уходят из Node без PHP.

### Этап 6. Bitrix24

- Добавить `Bitrix24Client`.
- Добавить миграции `bitrix_contact_id`, `bitrix_deal_id`, sync timestamps/errors.
- Синхронизировать:
  - анкету;
  - онлайн-регистрацию;
  - офлайн pending;
  - офлайн approved;
  - visited.

Критерий готовности: регистрация в боте появляется в нужной воронке Bitrix24.

### Этап 7. Cutover

- На тестовом домене поднять Node.js.
- Прогнать сценарии Telegram.
- Переключить webhook Telegram на Node URL.
- Выключить PHP-слой: админка, webhook и worker работают на Node.js.
- Проверить cron и рассылки.

## 5. Важное ограничение Reg.ru

Если текущий shared hosting Reg.ru не может стабильно принимать Telegram webhook или ходить к `api.telegram.org`, Node.js на том же shared hosting проблему не решит.

Для Node.js backend лучше:

- VDS/VPS;
- Render/Fly.io/Railway;
- Selectel/Timeweb Cloud;
- отдельный serverless webhook relay.

После решения перейти на зарубежную VDS админка, бот и worker должны жить в одном Node.js-приложении.

## 6. Риски

- Одновременная работа PHP и Node может создать дубли, если оба принимают webhook.
- Нужно аккуратно мигрировать состояния пользователей.
- Нельзя коммитить `.env`, deploy-папки и архивы.
- Cron-задачи должны запускаться только в одном backend.
- Bitrix24 синхронизация должна быть идемпотентной.

## 7. Предлагаемый порядок работ

1. Закоммитить текущую PHP-версию как baseline.
2. Решить, где будет жить Node.js backend.
3. Поднять минимальный Node health endpoint.
4. Подключить MySQL.
5. Перенести Telegram webhook.
6. Перенести регистрацию.
7. Перенести админку.
8. Перенести cron.
9. Добавить Bitrix24.
10. Переключить production webhook.

## 8. Текущий прогресс

Создана папка `node-backend` с полной Node.js-версией:

- Node.js 20 backend без привязки к shared hosting.
- MySQL-подключение через `mysql2`.
- Telegram webhook `POST /telegram/webhook`.
- Health-check `GET /health` и `GET /health?telegram=1`.
- Перенесен основной сценарий бота: согласие, анкета, список событий, онлайн/офлайн регистрация.
- Перенесена админка: регистрации, канбан/список, ресепшн, мероприятия, люди, рассылки и сценарная карта.
- Перенесено планирование напоминаний.
- Добавлен Node worker для `scheduled_messages` и `broadcast_messages`.
- Подготовлены инструкции `README.md`, `DEPLOY_VDS.md` и `node-backend/README.md` для VDS, Nginx, systemd и webhook.

PHP-файлы удалены из tracked-проекта. Следующий технический шаг: поднять Node.js на VDS, подключить MySQL и прогнать админку, webhook, регистрацию, ресепшн и worker.
