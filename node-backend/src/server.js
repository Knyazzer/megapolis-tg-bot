import { createServer } from 'node:http';
import { config } from './config.js';
import { BotController } from './bot/bot-controller.js';
import { pingDb, queryOne } from './db/mysql.js';
import { TelegramClient } from './services/telegram-client.js';
import { h } from './utils/html.js';
import { logger } from './utils/logger.js';

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

    if (request.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
      await handleIndex(response);
      return;
    }

    if (request.method === 'GET' && ['/health', '/health.php'].includes(url.pathname)) {
      await handleHealth(response, url);
      return;
    }

    if (request.method === 'GET' && ['/privacy', '/privacy.php'].includes(url.pathname)) {
      redirect(response, config.links.privacy);
      return;
    }

    if (request.method === 'POST' && ['/telegram/webhook', '/webhook', '/webhook.php'].includes(url.pathname)) {
      await handleTelegramWebhook(request, response);
      return;
    }

    json(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    logger.error('http error', { message: error.message, stack: error.stack });
    json(response, 500, { ok: false, error: 'Internal server error' });
  }
});

server.listen(config.port, config.host, () => {
  logger.info(`Node bot backend is listening on ${config.host}:${config.port}`);
});

async function handleIndex(response) {
  html(response, 200, `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Megapolis Event Bot</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #101828; background: #f6f8fb; }
    main { max-width: 760px; margin: 12vh auto; padding: 32px; background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    code { background: #eef2f6; border-radius: 6px; padding: 2px 6px; }
    a { color: #175cd3; }
  </style>
</head>
<body>
  <main>
    <h1>Megapolis Event Bot backend</h1>
    <p>Node.js backend работает. Telegram webhook: <code>/telegram/webhook</code>.</p>
    <p>Диагностика: <a href="/health">/health</a>. Проверка Telegram API: <a href="/health?telegram=1">/health?telegram=1</a>.</p>
    <p>Согласие на персональные данные: <a href="${h(config.links.privacy)}">${h(config.links.privacy)}</a>.</p>
  </main>
</body>
</html>`);
}

async function handleHealth(response, url) {
  const payload = {
    ok: true,
    time: new Date().toISOString(),
    node_env: config.nodeEnv,
    app_url: config.appUrl,
    telegram_reply_mode: config.telegram.replyMode,
    telegram_dry_run: config.telegram.dryRun,
    db: {
      ok: false,
      events: null,
    },
  };

  try {
    payload.db.ok = await pingDb();
    const row = await queryOne('SELECT COUNT(*) AS total FROM events');
    payload.db.events = Number(row?.total || 0);
  } catch (error) {
    payload.ok = false;
    payload.db.error = error.message;
  }

  if (url.searchParams.get('telegram') === '1') {
    try {
      const result = await new TelegramClient().api('getMe', {});
      payload.telegram_api = { ok: true, username: result.result?.username || null };
    } catch (error) {
      payload.ok = false;
      payload.telegram_api = { ok: false, error: error.message };
    }
  }

  json(response, payload.ok ? 200 : 500, payload);
}

async function handleTelegramWebhook(request, response) {
  if (config.telegram.webhookSecret) {
    const actualSecret = String(request.headers['x-telegram-bot-api-secret-token'] || '');
    if (actualSecret !== config.telegram.webhookSecret) {
      json(response, 403, { ok: false, error: 'Forbidden' });
      return;
    }
  }

  const update = await readJsonBody(request);
  const chatId = extractChatId(update);
  const telegram = new TelegramClient({
    webhookChatId: chatId,
    preferWebhookReply: config.telegram.replyMode === 'webhook',
  });

  await new BotController({ telegram }).handle(update);

  const webhookReply = telegram.consumeWebhookReply();
  if (webhookReply) {
    json(response, 200, webhookReply);
    return;
  }

  json(response, 200, { ok: true });
}

function extractChatId(update) {
  return Number(
    update?.message?.chat?.id ||
      update?.callback_query?.message?.chat?.id ||
      update?.callback_query?.from?.id ||
      0,
  );
}

function readJsonBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (body.trim() === '') {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(payload);
}
