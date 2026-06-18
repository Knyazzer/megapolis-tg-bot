# Docker-деплой на VDS/ODS

Проект можно выкатывать одним `docker compose`: отдельно поднимаются Node.js backend, worker напоминаний/рассылок и MySQL.

## 1. Установка Docker на Ubuntu

Официальная инструкция Docker: https://docs.docker.com/engine/install/ubuntu/

Короткий вариант для чистого сервера:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

Чтобы запускать Docker без `sudo`:

```bash
sudo usermod -aG docker $USER
```

После этого нужно перелогиниться в SSH.

## 2. Подготовка проекта

```bash
git clone https://github.com/Knyazzer/megapolis-tg-bot.git
cd megapolis-tg-bot
git switch Development
cp .env.docker.example .env
nano .env
```

В `.env` обязательно заменить:

- `APP_URL=https://martis.pro`
- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `ADMIN_PASSWORD_HASH`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `ADMIN_TELEGRAM_IDS`, если нужны уведомления модераторам
- `FACECAST_UID` и `FACECAST_API_KEY`
- `FACECAST_REGISTRATION_ENDPOINT=insert_key`
- `FACECAST_CHANNEL_ID=11110`
- `FACECAST_DEFAULT_STREAM_URL=https://facecast.net/w/6k2njf`
- `FACECAST_DIRECT_LINK_FALLBACK=true` для текущего режима Facecast "Сбор контактов"
- `FACECAST_DEMO_MODE=false`

Хеш пароля админки можно получить локально или на сервере:

```bash
cd node-backend
npm ci
npm run hash-password -- "ваш-пароль"
```

Затем вставить результат в `ADMIN_PASSWORD_HASH`.

## 3. Первый запуск

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

При первом старте MySQL автоматически импортирует:

- `database/schema.sql`
- `database/seed.sql`
- `database/migrations/2026_06_18_add_photo_broadcast_type.sql`

Важно: init SQL выполняется только при пустом volume `mysql_data`. Если нужно пересоздать тестовую базу с нуля:

```bash
docker compose down -v
docker compose up -d --build
```

На боевом сервере `down -v` удалит базу, поэтому использовать только осознанно.

## 4. Проверки

```bash
curl -s http://127.0.0.1:3000/health
docker compose logs --tail=100 app
docker compose logs --tail=100 worker
docker compose logs --tail=100 db
```

Админка будет доступна через локальный порт контейнера:

```text
http://127.0.0.1:3000/
```

Снаружи её должен отдавать Nginx по домену.

## 5. Nginx

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

SSL:

```bash
sudo certbot --nginx -d martis.pro
```

## 6. Telegram webhook

После того как `https://martis.pro/health` возвращает `ok: true`, включить webhook:

```bash
set -a
source .env
set +a

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://martis.pro/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Проверить:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## 7. Обновление версии

```bash
git pull
docker compose up -d --build
docker compose ps
```

Если появятся новые SQL-миграции для уже существующей базы, их нужно применять отдельно:

```bash
docker compose exec -T db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < database/migrations/<file>.sql
```
