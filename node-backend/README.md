# Megapolis Event Bot

Полная Node.js-версия проекта: админка, Telegram webhook, сценарий регистрации, Facecast-доступ, планирование напоминаний и отправка рассылок через MySQL.

## Что внутри

- `GET /` - админка модератора.
- `POST /telegram/webhook` - Telegram webhook.
- `GET /health` - диагностика Node backend и MySQL.
- `GET /health?telegram=1` - диагностика с запросом к Telegram API.
- `GET /privacy.php` - согласие на обработку персональных данных.
- Анкета пользователя, согласие, выбор мероприятия, онлайн/офлайн регистрация.
- Необязательный промокод после email: сохранить введённый код или пропустить шаг.
- Онлайн-регистрация без модератора.
- Офлайн-заявка со статусом `pending`.
- Регистрации, канбан/список, ресепшн, мероприятия, люди, рассылки и сценарная карта в админке.
- Очередь напоминаний и рассылок: `npm run worker` или `npm run worker:loop`.

PHP на сервере не нужен.

## Подготовка VDS

Минимум:

- Ubuntu 22.04/24.04.
- Node.js 20 LTS или новее.
- Nginx.
- MySQL/MariaDB или доступ к удаленной MySQL.
- SSL через Let's Encrypt.

Пример установки Node.js через NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
```

## Настройка проекта

```bash
cd /var/www/megapolis-bot/node-backend
npm install
cp .env.example .env
nano .env
npm run check
npm run migrate
npm start
```

В `.env` нужно заполнить:

- `APP_URL=https://martis.pro` или домен VDS.
- `HOST=127.0.0.1` и `PORT=3000` для работы за Nginx.
- `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`.
- `DB_CONNECTION=mysql` для VDS/MySQL.
- `ADMIN_LOGIN` и `ADMIN_PASSWORD_HASH`.
- `TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_WEBHOOK_SECRET` - длинная случайная строка.
- `ADMIN_TELEGRAM_IDS` - Telegram ID модераторов через запятую.
- `PRIVACY_URL=https://martis.pro/privacy.php`.
- `FACECAST_UID` и `FACECAST_API_KEY`.
- `FACECAST_REGISTRATION_MODE=userreg`.
- `FACECAST_USERREG_ENDPOINT=https://kassa.facecast.net/api/viewers/register`.
- `FACECAST_CHANNEL_ID=11110`.
- `FACECAST_DEFAULT_STREAM_URL=https://facecast.net/w/6k2njf`.
- `FACECAST_ACCESS_QUERY_PARAM=key`.
- `FACECAST_DEMO_MODE=false` для живой онлайн-регистрации.

Хеш пароля админки можно сгенерировать без PHP:

```bash
npm run hash-password -- "новый-пароль"
```

## Локальная проверка без MySQL

Чтобы не трогать параллельно запущенный MySQL на компьютере, можно поднять админку и webhook на отдельной SQLite-базе:

```bash
npm run local
```

Локальный адрес: `http://127.0.0.1:4199/`. Файл базы создаётся в `node-backend/data/local.sqlite` и не попадает в Git. Этот режим нужен только для разработки; на VDS оставляем `.env` с `DB_CONNECTION=mysql`.

## Промокод в анкете

После email бот предлагает ввести промокод или нажать «Пропустить». Код
сохраняется в `people.promo_code` без проверки по списку, с исходным регистром
и без пробелов по краям (до 128 символов). Скидки и другие условия не применяются.
Промокод виден в разделе «Люди» и в карточке регистрации; поиск по людям
также учитывает код. Уже заполненные анкеты без промокода остаются готовыми.

Для существующей MySQL-базы добавлена идемпотентная миграция
`database/migrations/2026_11_06_add_people_promo_code.sql`; то же поле включено
в явную команду `npm run migrate`. Публикация и миграция production выполняются
отдельно от локальных правок.

## Запуск и миграции

`npm start`, `npm run worker` и `npm run worker:loop` запускают только процессы.
Миграции выполняются отдельно командой `npm run migrate`. При ошибке команда
возвращает код 1, закрывает соединения и выводит причину; повторный запуск
безопасен для уже выполненных шагов. Базовые таблицы должны быть созданы из
`database/schema.sql`, как при первом запуске MySQL в Compose.

Перед будущим обновлением схемы выполните миграцию из новой версии приложения
отдельным шагом. Для локального Compose после сборки образа:

```bash
docker compose run --rm app npm run migrate
docker compose up -d
```

Для production используется `compose.prod.yml` и готовый образ новой версии.
Текущий CD workflow сам миграцию не запускает: этот шаг нужно выполнить отдельно
при подготовке будущего деплоя. CI/CD и Compose в рамках исправления не менялись.

HTTP-сервер слушает порт независимо от состояния MySQL. `GET /live` проверяет
только живой процесс и отвечает 200; `GET /health` проверяет БД и требуемую схему
и отвечает 200 либо 503. `GET /health?schema=1` принудительно обновляет диагностику
и показывает отсутствующие элементы схемы. Проверки только читают БД и не
применяют DDL. Результат кешируется на 1 секунду, успешная схема — на 30 секунд.

При недоступной БД остаются доступны статические файлы, `/privacy` и вход в
админку. Зависимые от БД страницы и webhook возвращают 503; обновление Telegram
не подтверждается как обработанное. Ошибки, возникшие уже внутри сценария бота,
также передаются HTTP-обработчику для ответа с ошибкой. После восстановления БД
или исправления схемы готовность возвращается без перезапуска приложения.

Циклический воркер проверяет готовность перед каждым проходом. При неготовности
или ошибке, включая первую попытку, он пишет диагностику и повторяет проверку
через `WORKER_INTERVAL_MS`. Разовый `npm run worker` сообщает о неуспехе кодом 1.
Зависимость `depends_on: db: service_healthy` в Compose сохраняется: она регулирует
первый запуск контейнеров, а `/live` и `/health` описывают состояние самого процесса.

## Очередь сообщений: захват и повторы

Воркер и ручной запуск из админки атомарно захватывают каждую запись через БД.
Захват действует 5 минут и продлевается перед каждой отправкой. После остановки
процесса просроченный захват можно забрать, сохранив уже отправленные части.
Следующий проход воркера начинается после завершения предыдущего.

Для рассылок и всех типов напоминаний временные ошибки Telegram (429, 5xx,
сетевые сбои) откладывают следующую попытку. Всего допускается 6 попыток;
задержка растёт от 30 секунд до 15 минут. `retry_after` задаёт минимальную паузу,
даже если она больше 15 минут. После 429 общая пауза сохраняется в БД и действует
на обе очереди, включая новые сообщения и ручной запуск. Фактическая отправка
происходит на ближайшем проходе после окончания паузы. Постоянные ошибки,
например блокировка бота участником (403), завершаются без автоматического повтора.

После подтверждённой отправки медиа или очередной части длинного текста
сохраняется `delivery_step`: повтор продолжает с оставшейся части. Ручной повтор
ошибок в админке сбрасывает счётчик попыток, сохраняя этот прогресс.

Telegram не предоставляет ключ идемпотентности для отправки: при потере ответа
после принятия сообщения или падении между отправкой и записью прогресса
редкий повтор остаётся возможен. Захват защищает от параллельной обработки,
а сохранение прогресса — от повторов уже подтверждённых частей.

Перед будущим развёртыванием отдельно применить идемпотентную миграцию
`database/migrations/2026_11_06_add_message_delivery_state.sql` к существующей
MySQL-базе. Схема очереди также включена в существующий `schema-checks.js`.
Оба процесса (`app` и `worker`) должны использовать новую версию: старый код
не учитывает захват заданий. Изменение не требует новых переменных окружения.

Проверки локально (для SQLite-тестов нужен Node.js 22.13+; прод остаётся на Node.js 20):

```bash
npm --prefix node-backend run check
npm --prefix node-backend test
```

Тесты используют отдельную SQLite-базу в памяти и подменённый Telegram-клиент.
Для проверки очереди в отдельной тестовой MySQL-базе поддержан
`MESSAGE_QUEUE_TEST_MYSQL_PORT` — см. `tests/message-worker.test.js`.

## Nginx reverse proxy

```nginx
server {
    server_name martis.pro;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

После SSL:

```bash
sudo certbot --nginx -d martis.pro
```

## systemd для backend

`/etc/systemd/system/megapolis-bot.service`:

```ini
[Unit]
Description=Megapolis Telegram Bot Node backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/megapolis-bot/node-backend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## systemd для воркера

`/etc/systemd/system/megapolis-bot-worker.service`:

```ini
[Unit]
Description=Megapolis Telegram Bot worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/megapolis-bot/node-backend
ExecStart=/usr/bin/npm run worker:loop
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Запуск:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now megapolis-bot
sudo systemctl enable --now megapolis-bot-worker
sudo systemctl status megapolis-bot
sudo systemctl status megapolis-bot-worker
```

## Telegram webhook

После того как `https://martis.pro/health?telegram=1` показывает `ok: true`, переключаем webhook:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://martis.pro/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Проверка:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Следующий этап

1. Добавить Bitrix24 sync worker.
2. При необходимости заменить server-rendered админку на React/Vite frontend.
