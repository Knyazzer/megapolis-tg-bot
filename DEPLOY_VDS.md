# Деплой на VDS

Проект теперь полностью работает на Node.js. PHP на сервере не нужен.

## 1. Что должно быть на сервере

- Ubuntu 22.04/24.04.
- Node.js 20 LTS или новее.
- MySQL/MariaDB.
- Nginx.
- SSL через Let's Encrypt.

## 2. База данных

Создайте MySQL-базу и импортируйте:

```bash
mysql -u <user> -p <database> < database/schema.sql
mysql -u <user> -p <database> < database/seed.sql
mysql -u <user> -p <database> < database/migrations/2026_06_18_add_photo_broadcast_type.sql
```

## 3. Node backend

```bash
cd /var/www/megapolis-tg-bot/node-backend
npm ci
cp .env.example .env
nano .env
npm run check
```

Запустить руками:

```bash
npm start
```

Worker:

```bash
npm run worker:loop
```

## 4. Nginx

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

## 5. Проверки

```bash
curl -s https://martis.pro/health
curl -s https://martis.pro/health?telegram=1
```

После успешной проверки переключите Telegram webhook на:

```text
https://martis.pro/telegram/webhook
```
