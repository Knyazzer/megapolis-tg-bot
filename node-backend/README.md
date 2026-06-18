# Megapolis Event Bot

Полная Node.js-версия проекта: админка, Telegram webhook, сценарий регистрации, Facecast-доступ, планирование напоминаний и отправка рассылок через MySQL.

## Что внутри

- `GET /` - админка модератора.
- `POST /telegram/webhook` - Telegram webhook.
- `GET /health` - диагностика Node backend и MySQL.
- `GET /health?telegram=1` - диагностика с запросом к Telegram API.
- `GET /privacy.php` - согласие на обработку персональных данных.
- Анкета пользователя, согласие, выбор мероприятия, онлайн/офлайн регистрация.
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
- `FACECAST_REGISTRATION_ENDPOINT=insert_key`.
- `FACECAST_CHANNEL_ID=11110`.
- `FACECAST_DEFAULT_STREAM_URL=https://facecast.net/w/6k2njf`.
- `FACECAST_DIRECT_LINK_FALLBACK=true`, если текущее событие Facecast работает в режиме сбора контактов, а не в режиме мультипаролей.
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
