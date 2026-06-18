# Фаза 0 — Как устроен бэкенд

Объяснение «человеческим языком» для владельцев, которые не уверены в собственном
бэкенде. Все утверждения — со ссылками на код.

## Стек (определён по коду, не угадан)

- **HTTP без фреймворка** — чистый `node:http`: [server.js:17](../node-backend/src/server.js#L17).
  Нет Express/Fastify; нет grammY/Telegraf — Telegram дёргается напрямую через `fetch`.
- **БД — MySQL 8** через `mysql2/promise`, пул на 10 соединений, named placeholders:
  [mysql.js:18-28](../node-backend/src/db/mysql.js#L18-L28).
  Есть скрытый режим **SQLite** для локальной разработки: [mysql.js:114-131](../node-backend/src/db/mysql.js#L114-L131)
  (включается `DB_CONNECTION=sqlite`, см. скрипт `local` в package.json).
- **Режим Telegram — webhook** (не long-polling): [server.js:36](../node-backend/src/server.js#L36),
  [config.js:26](../node-backend/src/config.js#L26).
- **Язык** — JavaScript + ESM, без TypeScript. Зависимости только две: `bcryptjs`, `mysql2`.

## Точки входа: два процесса

1. **`server.js`** — HTTP-сервер. Маршруты:
   - `GET /assets/*` — статика админки ([server.js:21-24](../node-backend/src/server.js#L21-L24));
   - `GET /health`, `/health.php` — health + опционально проверка Telegram `getMe`
     ([server.js:111-145](../node-backend/src/server.js#L111-L145));
   - `GET /privacy`, `/privacy.php` — страница согласия на обработку ПДн;
   - `POST /telegram/webhook`, `/webhook`, `/webhook.php` — приём апдейтов Telegram;
   - `GET|POST /` — серверная HTML-админка модератора.
2. **`worker.js`** — отдельный процесс-петля (`--loop`), раз в `WORKER_INTERVAL_MS`
   (по умолчанию 60 c) рассылает напоминания и кампании: [worker.js:5-20](../node-backend/src/worker.js#L5-L20).

В Docker это два контейнера из одного образа — `app` и `worker` ([compose.yaml](../compose.yaml)).

## Поток обработки апдейта (webhook)

```
POST /telegram/webhook
  → проверка заголовка X-Telegram-Bot-Api-Secret-Token   server.js:148-153
  → парсинг JSON-тела (лимит 1 МБ)                        server.js:156, 183-208
  → BotController.handle(update)                          server.js:163
      ├─ update.callback_query → handleCallback           bot-controller.js:83-177
      └─ update.message        → handleMessage            bot-controller.js:44-81
  → ответ: либо «webhook-reply» (метод в теле HTTP-ответа),
           либо обычный POST к api.telegram.org           telegram-client.js:91-121
  → HTTP 200                                              server.js:165-171
```

«Webhook-reply» — оптимизация: первый `sendMessage` отдаётся прямо в теле ответа
на webhook, экономя один round-trip к Telegram ([telegram-client.js:123-154](../node-backend/src/services/telegram-client.js#L123-L154)).

## Где хранится состояние диалога (важно)

**FSM анкеты — в БД, не в памяти.** Текущий шаг лежит в `people.state`
([people-repository.js:76-82](../node-backend/src/repositories/people-repository.js#L76-L82)),
переходы — в [bot-controller.js:179-242](../node-backend/src/bot/bot-controller.js#L179-L242):

```
new → awaiting_consent → ask_name → ask_company → ask_position
    → ask_phone → ask_email → registered
```

Следствия:
- состояние **переживает рестарт** процесса;
- корректно работает при **нескольких инстансах** app;
- при параллельных апдейтах одного пользователя возможна лёгкая гонка
  (читает state → пишет state), но риск низкий и данные не рушатся.

**Контрпример: админ-сессии — в памяти процесса** (`Map`), а не в БД:
[admin-auth.js:5-28](../node-backend/src/admin/admin-auth.js#L5-L28). Это переживает
рестарт плохо (всех разлогинит) и ломает горизонтальное масштабирование app.
См. баг B8.

## Доменная модель и инварианты

| Таблица | Назначение | Ключевые инварианты |
|---------|-----------|---------------------|
| `people` | контакт + шаг FSM | `telegram_id` UNIQUE; `state` — текущий шаг анкеты |
| `events` | мероприятия | `slug` UNIQUE; формат (online/offline) выводится из заполненных полей, [events-repository.js:22-35](../node-backend/src/repositories/events-repository.js#L22-L35) |
| `registrations` | заявки | UNIQUE `(person_id, event_id)`; `attendance` online/offline; `status` pending/approved/rejected/cancelled/visited/no_show |
| `scheduled_messages` | персональные напоминания | UNIQUE `(registration_id, type)` — защита от дубля одного типа |
| `broadcast_campaigns` / `broadcast_messages` | массовые рассылки | UNIQUE `(campaign_id, person_id)` |
| `bot_logs` | лог (таблица есть, в Node-коде не используется) | — |

Схема аккуратная: индексы, FK с `ON DELETE CASCADE/SET NULL`, уникальные ключи —
[schema.sql](../database/schema.sql).

## Внешние интеграции

- **Telegram Bot API** — [telegram-client.js](../node-backend/src/services/telegram-client.js):
  `sendMessage` (с авто-разбивкой >3900 символов и HTML parse_mode), `sendPhoto`,
  `sendVideoNote`, `sendVenue`, `answerCallbackQuery`. Таймаут запроса 15 c.
- **Facecast** — выдача доступа к онлайн-эфиру: [facecast-client.js](../node-backend/src/services/facecast-client.js).
  **По умолчанию демо-режим** (`FACECAST_DEMO_MODE=true`): логин = email, пароль —
  детерминированный хеш от `telegram_id:event_id`. Боевой режим включается только
  при заданном `FACECAST_REGISTRATION_ENDPOINT`.

## Фоновая автоматизация

`ReminderPlanner` ставит задачи в `scheduled_messages` при регистрации
([reminder-planner.js](../node-backend/src/services/reminder-planner.js)):

- offline (после аппрува): за 1 день, за 2 часа, в момент старта, постпромо через час после конца;
- online: за 15 минут, в момент старта, постпромо.

Воркер забирает «дозревшие» (`send_at <= NOW()`, не отправленные) и шлёт; перед
отправкой проверяет «протух ли» статус регистрации ([message-worker.js:116-138](../node-backend/src/jobs/message-worker.js#L116-L138)).

## Главные точки отказа (детали — в Фазе 1)

1. Webhook делает **тяжёлые внешние вызовы синхронно до ответа 200** → риск
   передоставки апдейта Telegram'ом.
2. Воркер **без атомарного «захвата» задач** + `setInterval` без ожидания
   предыдущего прохода → риск двойной отправки.
3. **Нет обработки 429 / Retry-After** от Telegram → массовая рассылка частично
   уходит в `failed` без ретрая.
