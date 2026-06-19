# Как разрабатывать и деплоить (megapolis-tg-bot)

Это главный документ для разработки. Прочитай его и `RULES.md` целиком перед любыми изменениями.

## Веточная модель

На удалённом репозитории **ровно две ветки**:

- **`master`** — продакшен. Деплоится автоматически. Напрямую сюда **не пушим**.
- **`dev`** — разработка. Сюда пушим изменения.

Новые ветки создавать **нельзя** (запрещено правилом репозитория — может только владелец). Вся работа идёт в `dev`.

```
dev (разработка)  ──PR──▶  master  ──автодеплой──▶  VDS (прод)
```

## Что нужно один раз (первичная настройка)

```bash
git clone git@github.com:Knyazzer/megapolis-tg-bot.git
cd megapolis-tg-bot
git checkout dev
git pull origin dev
```

> ⚠️ **Первым делом**: подтяни нашу систему (`git pull origin dev`) и положи свои локальные изменения **поверх** неё. Дай своей нейронке прочитать `RULES.md` и `docs/STACK.md`, чтобы она работала по нашим правилам, а не переписывала структуру.

## Цикл разработки (каждое изменение)

```bash
git checkout dev
git pull origin dev                      # 1. всегда сначала подтянуть последнее

# 2. вносишь изменения в код ...

npm --prefix node-backend ci             # один раз / при смене зависимостей
npm --prefix node-backend run check      # 3. локальная проверка синтаксиса (как в CI)

git add -A
git commit -m "feat: краткое описание"
git push origin dev                      # 4. пуш в dev (это НЕ деплой)
```

Пуш в `dev` **ничего не деплоит** — это просто сохранение работы на удалёнке.

## Деплой в прод (только через PR `dev → master`)

```bash
# 1. открыть PR из dev в master
gh pr create --base master --head dev --title "deploy: что катим"
#   (или через веб: кнопка Compare & pull request)

# 2. дождаться зелёного CI (npm check + docker build) — он запустится сам на PR

# 3. смёржить PR  (gh pr merge <N> --merge   ИЛИ кнопка Merge на GitHub)
```

Мёрж в `master` → **автоматический деплой на VDS** (GitHub Actions собирает образ → GHCR → разворачивает на сервере).

## Проверка после деплоя

```bash
curl -s https://bot.knzteam.ru/health      # ждём "ok": true, "db": { "ok": true }
```
Если `ok:false` или бот не отвечает — смотри логи деплоя в GitHub → Actions, и откатывай (см. ниже).

## Локальный запуск (для отладки до деплоя)

Нужен Docker. В корне:
```bash
cp .env.docker.example .env     # заполнить пароли/токен (см. docs/DOCKER_DEPLOY.md)
docker compose up -d --build    # поднимет app + worker + MySQL локально
curl -s http://127.0.0.1:3000/health
```
`compose.yaml` = локальная сборка (build). `compose.prod.yml` = прод (готовый образ из GHCR). **Меняешь окружение в одном — синхронизируй в другом.**

## Откат прода (если деплой сломал)

На VDS:
```bash
cd /opt/megapolis-tg-bot
git checkout <рабочий-коммит>        # напр. предыдущий sha из master
docker compose up -d --build
docker compose ps
```

## CI/CD кратко

- **CI** (`.github/workflows/ci.yml`): на каждый PR и пуш в `dev` — `npm ci` + `npm run check` + `docker build`. Красный CI блокирует мёрж.
- **CD** (`.github/workflows/cd.yml`): push в `master` → сборка образа `ghcr.io/knyazzer/megapolis-tg-bot` → SSH-деплой на VDS (`compose.prod.yml`, `pull && up -d`).

Подробности деплоя инфраструктуры — `docs/DOCKER_DEPLOY.md`. Стек и устройство приложения — `docs/STACK.md`. Правила разработки — `RULES.md`.
