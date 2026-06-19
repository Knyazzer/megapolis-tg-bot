# Фаза 1 — Баги

Каждый пункт: severity, точное место (`файл:строка`), как воспроизвести,
последствие, рекомендованный фикс. Severity: critical / high / medium / low.

## Сводка

| # | Severity | Тема | Файл |
|---|----------|------|------|
| [B1](#b1) | High | Двойная отправка во воркере (нет атомарного claim) | jobs/message-worker.js, worker.js |
| [B2](#b2) | High | Нет обработки 429 / Retry-After, нет ретрая рассылки | services/telegram-client.js, jobs/message-worker.js |
| [B3](#b3) | Medium | Webhook обрабатывается синхронно до ответа 200 | server.js |
| [B4](#b4) | Medium | Регистрация в Facecast не идемпотентна (боевой режим) | bot/bot-controller.js |
| [B5](#b5) | Medium | Нет проверки типа чата (бот «работает» в группах) | bot/bot-controller.js |
| [B6](#b6) | Medium | Webhook «fail-open» при пустом секрете | server.js |
| [B7](#b7) | Medium | Нет fail-fast на отсутствующие секреты | config.js, services/telegram-client.js |
| [B8](#b8) | Medium | Админ-сессии в памяти процесса | admin/admin-auth.js |
| [B9](#b9) | Low-Med | Нет рейт-лимита на вход в админку | admin/admin-controller.js |
| [B10](#b10) | Low-Med | Хрупкость таймзон | utils/dates.js |
| [B11](#b11) | Low | `answerCallbackQuery` теряется в webhook-reply режиме | services/telegram-client.js |
| [B12](#b12) | Low | Схлопывание нескольких исходящих в одном апдейте | services/telegram-client.js |
| [B13](#b13) | Low | `Boolean(env(...))` для не-`true/false` значений | config.js |

> SQL-инъекций и XSS не найдено (см. раздел «Что проверено и чисто» внизу).

---

## B1 — Двойная отправка во воркере {#b1}

**Severity:** High
**Где:** [worker.js:15-19](../node-backend/src/worker.js#L15-L19),
[message-worker.js:14-42](../node-backend/src/jobs/message-worker.js#L14-L42),
[message-worker.js:70-79](../node-backend/src/jobs/message-worker.js#L70-L79)

**Суть.** Задачи выбираются `SELECT ... WHERE sent_at IS NULL` (или `status='queued'`),
затем в цикле отправляются и **только потом** помечаются отправленными. Между
`SELECT` и `UPDATE` нет блокировки/«захвата». Параллельно `runLoop` использует
`setInterval`, который запускает новый проход, **не дожидаясь** завершения предыдущего.

**Воспроизведение.** Кампания на 5000 адресатов + медленный ответ Telegram → проход
длится >60 c → следующий тик `setInterval` стартует и выбирает те же `queued`-строки
→ часть людей получает сообщение дважды.

**Последствие.** Дубли напоминаний и массовых рассылок (репутационный удар).

**Фикс.**
1. Атомарный claim перед отправкой: либо
   `UPDATE ... SET status='sending', ... WHERE status='queued' ORDER BY id LIMIT n`
   и затем выбирать захваченные строки, либо `SELECT ... FOR UPDATE SKIP LOCKED`
   внутри транзакции.
2. Заменить `setInterval` на рекурсивный `setTimeout`, который ставится **после**
   завершения прохода — исключает наложение.

---

## B2 — Нет обработки 429 / Retry-After и ретрая {#b2}

**Severity:** High
**Где:** [telegram-client.js:91-121](../node-backend/src/services/telegram-client.js#L91-L121),
[message-worker.js:60-64](../node-backend/src/jobs/message-worker.js#L60-L64),
[message-worker.js:102-110](../node-backend/src/jobs/message-worker.js#L102-L110)

**Суть.** `api()` бросает на любом `ok:false`, не разбирая `parameters.retry_after`.
В воркере любой `throw` помечает сообщение `failed` **навсегда** — ретрая нет.
Между сообщениями рассылки нет задержки.

**Воспроизведение.** Рассылка на 200+ адресатов → мгновенно упираемся в флуд-лимит
Telegram (~30 msg/s глобально) → часть сообщений получает 429 → они уходят в
`failed` и больше не отправляются.

**Последствие.** Массовая рассылка доходит частично; «потерянные» получатели.

**Фикс.** При 429 читать `retry_after`, ждать и повторять (экспоненциальный бэкофф,
ограниченное число попыток). Добавить throttle между сообщениями рассылки
(≈ не чаще 25–30/с глобально, ≤1/с на один чат). Различать временные (429/5xx,
ретраить) и постоянные (403 «bot blocked», не ретраить) ошибки.

---

## B3 — Webhook обрабатывается синхронно до ответа 200 {#b3}

**Severity:** Medium
**Где:** [server.js:147-172](../node-backend/src/server.js#L147-L172),
[bot-controller.js:359-372](../node-backend/src/bot/bot-controller.js#L359-L372)

**Суть.** Обработчик `await`-ит весь `BotController.handle` (включая вызовы Facecast
с таймаутом 25 c и Telegram 15 c) **до** возврата 200. Дедупликации по `update_id` нет.

**Воспроизведение.** Медленный Facecast/Telegram → суммарное время > таймаута
доставки Telegram → Telegram **передоставляет** тот же апдейт → повторная обработка.

**Последствие.** Повторные действия. Большинство записей идемпотентны (upsert по
уникальным ключам), но не всё — см. B4.

**Фикс.** Отвечать `200 OK` сразу после быстрой валидации, тяжёлую обработку
выполнять асинхронно. Завести таблицу обработанных `update_id` (или дедуп в БД)
для защиты от повторов.

---

## B4 — Facecast-регистрация не идемпотентна {#b4}

**Severity:** Medium (сейчас замаскировано демо-режимом)
**Где:** [bot-controller.js:359-368](../node-backend/src/bot/bot-controller.js#L359-L368)

**Суть.** `registerOnline` вызывает `facecast.registerViewer` при каждом тапе кнопки
«Смотреть онлайн» и при каждой передоставке апдейта (B3). В боевом режиме это
создаёт дублирующего зрителя и **перезаписывает** логин/пароль регистрации.

**Воспроизведение.** Только при `FACECAST_DEMO_MODE=false` и заданном endpoint.
В демо-режиме креды детерминированы ([facecast-client.js:48-60](../node-backend/src/services/facecast-client.js#L48-L60)),
поэтому сейчас проблема не видна.

**Последствие (в проде).** Дубли зрителей на стороне Facecast, смена выданных
кредов у пользователя.

**Фикс.** Не дёргать Facecast, если у регистрации уже есть `facecast_login`
(частичная проверка уже есть на [bot-controller.js:354](../node-backend/src/bot/bot-controller.js#L354) — расширить её на все ветки).

---

## B5 — Нет проверки типа чата {#b5}

**Severity:** Medium
**Где:** [bot-controller.js:44-81](../node-backend/src/bot/bot-controller.js#L44-L81)

**Суть.** `handleMessage` не проверяет `message.chat.type === 'private'`. `chatId`
берётся из `message.chat.id` ([bot-controller.js:46](../node-backend/src/bot/bot-controller.js#L46)).

**Воспроизведение.** Добавить бота в группу → сообщения участников трактуются как
ввод анкеты, бот отвечает в общий чат, пишет в `people` по `from.id`.

**Последствие.** Мусор в БД, странное поведение в группах, утечка приватных
сообщений (анкета) в общий чат.

**Фикс.** В начале `handleMessage`/`handleCallback` игнорировать чаты с
`type !== 'private'` (кроме явно поддерживаемых сценариев).

---

## B6 — Webhook «fail-open» при пустом секрете {#b6}

**Severity:** Medium
**Где:** [server.js:148-153](../node-backend/src/server.js#L148-L153)

**Суть.** Проверка `X-Telegram-Bot-Api-Secret-Token` выполняется **только если**
`config.telegram.webhookSecret` непустой. Пустой секрет → проверки нет → эндпоинт
принимает любой POST.

**Последствие.** При незаданном секрете кто угодно может слать боту фейковые
апдейты (фальшивые регистрации, спам действий).

**Фикс.** В production падать на старте, если секрет пуст (fail-fast, см. B7), и/или
всегда отклонять webhook без корректного секрета.

---

## B7 — Нет fail-fast на отсутствующие секреты {#b7}

**Severity:** Medium
**Где:** [config.js](../node-backend/src/config.js),
[telegram-client.js:101-103](../node-backend/src/services/telegram-client.js#L101-L103)

**Суть.** Приложение стартует без `TELEGRAM_BOT_TOKEN`, `ADMIN_PASSWORD_HASH`,
кредов БД и webhook-секрета. Ошибка всплывает лишь при первом обращении
(`telegram-client` бросит `TELEGRAM_BOT_TOKEN is empty`, вход в админку молча
невозможен при пустом хеше — [admin-auth.js:50](../node-backend/src/admin/admin-auth.js#L50)).

**Последствие.** «Зелёный» процесс, который на деле нерабочий; ошибки конфигурации
обнаруживаются поздно.

**Фикс.** Модуль `assertConfig()` на старте `server.js`/`worker.js`: проверять
обязательные переменные для текущего `NODE_ENV` и падать с понятным сообщением.

---

## B8 — Админ-сессии в памяти процесса {#b8}

**Severity:** Medium
**Где:** [admin-auth.js:5-28](../node-backend/src/admin/admin-auth.js#L5-L28)

**Суть.** Сессии и CSRF-токены хранятся в `const sessions = new Map()`.

**Последствие.** Рестарт app разлогинивает всех модераторов; масштабирование app
до >1 реплики ломает вход и CSRF (запросы попадают на разные процессы). Сейчас
compose с одним `app` это терпит — но это потолок.

**Фикс.** Хранить сессии в БД или Redis, либо перейти на подписанный
stateless-cookie (HMAC) с TTL.

---

## B9 — Нет рейт-лимита на вход в админку {#b9}

**Severity:** Low-Medium
**Где:** [admin-controller.js:56-64](../node-backend/src/admin/admin-controller.js#L56-L64),
[admin-auth.js:49-56](../node-backend/src/admin/admin-auth.js#L49-L56)

**Суть.** Нет ограничения числа попыток входа → перебор пароля. Смягчено `bcrypt`
и timing-safe сравнением логина ([admin-auth.js:88-95](../node-backend/src/admin/admin-auth.js#L88-L95)),
но лок-аута/задержки нет.

**Фикс.** Счётчик неудачных попыток по IP/логину с прогрессирующей задержкой или
временной блокировкой.

---

## B10 — Хрупкость таймзон {#b10}

**Severity:** Low-Medium
**Где:** [dates.js:17-41](../node-backend/src/utils/dates.js#L17-L41)

**Суть.** `nowSql`/`formatSqlDate` используют локальные `getHours()` и т.д.;
`parseDate` строит `new Date('YYYY-MM-DDTHH:mm:ss')` без зоны → трактуется как
локальное время процесса. Корректность держится на `TZ=Europe/Moscow` (выставлен в
[compose.yaml](../compose.yaml)) + `timezone:'+03:00'` пула ([mysql.js:27](../node-backend/src/db/mysql.js#L27)).

**Последствие.** На bare-metal без `TZ` или при смене таймзоны сервера — сдвиг
времени напоминаний.

**Фикс.** Считать и хранить во времени с явной зоной (UTC в БД, перевод в
Europe/Moscow на отображении) либо жёстко документировать обязательность `TZ`.

---

## B11 — `answerCallbackQuery` теряется в webhook-reply {#b11}

**Severity:** Low
**Где:** [telegram-client.js:123-126](../node-backend/src/services/telegram-client.js#L123-L126)

**Суть.** В webhook-reply режиме `answerCallbackQuery` возвращает «обработано», но
не кладётся в ответ (в теле webhook может быть только один метод, и им становится
`sendMessage`). В итоге callback не подтверждается — на кнопке короткое время висит
индикатор загрузки.

**Фикс.** Слать `answerCallbackQuery` отдельным быстрым API-вызовом, не через
webhook-reply.

---

## B12 — Схлопывание нескольких исходящих за апдейт {#b12}

**Severity:** Low
**Где:** [telegram-client.js:139-152](../node-backend/src/services/telegram-client.js#L139-L152)

**Суть.** В webhook-reply режиме два `sendMessage` в один чат конкатенируются, а
лишние методы (`sendVenue` после `sendMessage`) «skipped». Сейчас почти все
хендлеры шлют по одному сообщению, поэтому эффекта нет, но это латентная ловушка
при доработках.

**Фикс.** Для хендлеров с несколькими исходящими — отключать webhook-reply и слать
обычными API-вызовами (или явно поддержать очередь).

---

## B13 — `Boolean(env(...))` для нестандартных значений {#b13}

**Severity:** Low
**Где:** [config.js:27](../node-backend/src/config.js#L27),
[config.js:42](../node-backend/src/config.js#L42)

**Суть.** `env()` корректно приводит `'true'/'false'` к boolean
([env.js:39-44](../node-backend/src/env.js#L39-L44)), но `DRY_RUN=1` или `=yes`
вернётся строкой → `Boolean('1') === true`. Неожиданное включение dry-run/demo.

**Фикс.** Явный парсер булевых env (`'1'|'true'|'yes'|'on'`).

---

## Что проверено и оказалось чисто

- **SQL-инъекции — нет.** Все запросы параметризованы (named placeholders), а
  динамические имена полей берутся из белых списков `PERSON_FIELDS`
  ([people-repository.js:4](../node-backend/src/repositories/people-repository.js#L4),
  [:58-74](../node-backend/src/repositories/people-repository.js#L58-L74)) и
  `REGISTRATION_FIELDS` ([registrations-repository.js:4-12](../node-backend/src/repositories/registrations-repository.js#L4-L12),
  [:75-89](../node-backend/src/repositories/registrations-repository.js#L75-L89)).
- **XSS — нет.** Пользовательский ввод экранируется `h()`
  ([utils/html.js](../node-backend/src/utils/html.js)) и в админке, и в HTML-сообщениях бота.
- **BOLA по `callback_data` — закрыто.** Владение проверяется:
  `credentials:` ([bot-controller.js:170](../node-backend/src/bot/bot-controller.js#L170)),
  `cant_come:`/switch ([bot-controller.js:376](../node-backend/src/bot/bot-controller.js#L376)).
  ID парсятся через `Number()`; `findById(NaN)` возвращает null — безопасно.
- **Админ-команда выдачи file_id** (кружок) огорожена `isAdminTelegramId`
  ([bot-controller.js:54](../node-backend/src/bot/bot-controller.js#L54),
  [:477-479](../node-backend/src/bot/bot-controller.js#L477-L479)).
- **Лимит тела запроса** 1 МБ для webhook и форм ([server.js:183, 215](../node-backend/src/server.js#L183)).
- **Защита от path traversal** в статике ([server.js:68-74](../node-backend/src/server.js#L68-L74)).
