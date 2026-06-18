# Megapolis Event Bot Node backend

Первый этап миграции с PHP на Node.js: Telegram webhook, сценарий регистрации, Facecast-доступ, планирование напоминаний и отправка рассылок через ту же MySQL-схему.

## Что уже перенесено

- `POST /telegram/webhook` - Telegram webhook.
- `GET /health` - диагностика Node backend и MySQL.
- `GET /health?telegram=1` - диагностика с запросом к Telegram API.
- Анкета пользователя, согласие, выбор мероприятия, онлайн/офлайн регистрация.
- Онлайн-регистрация без модератора.
- Офлайн-заявка со статусом `pending`.
- Очередь напоминаний и рассылок: `npm run worker` или `npm run worker:loop`.

Админка пока может оставаться на PHP и работать с этой же базой. Важно: Telegram webhook должен быть включен только на одном backend.

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

- `APP_URL=https://bot.martis.pro` или домен VDS.
- `HOST=127.0.0.1` и `PORT=3000` для работы за Nginx.
- `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`.
- `TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_WEBHOOK_SECRET` - длинная случайная строка.
- `ADMIN_TELEGRAM_IDS` - Telegram ID модераторов через запятую.
- `PRIVACY_URL=https://martis.pro/privacy.php`.
- `FACECAST_*`, когда будет точный метод Facecast для регистрации зрителей.

## Nginx reverse proxy

```nginx
server {
    server_name bot.martis.pro;

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
sudo certbot --nginx -d bot.martis.pro
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

После того как `https://bot.martis.pro/health?telegram=1` показывает `ok: true`, переключаем webhook:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://bot.martis.pro/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Проверка:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Следующий этап

1. Перенести действия админки на Node API: аппрув/отказ, ресепшн, мероприятия, рассылки.
2. Перенести HTML админки или сделать React/Vite frontend.
3. Добавить Bitrix24 sync worker.
4. После проверки выключить PHP webhook и PHP cron.
