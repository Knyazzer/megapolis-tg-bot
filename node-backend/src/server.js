import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AdminController } from './admin/admin-controller.js';
import { loadSession } from './admin/admin-auth.js';
import { BotController } from './bot/bot-controller.js';
import { pingDb, queryOne } from './db/mysql.js';
import { mysqlSchemaDiagnostics } from './db/schema-checks.js';
import { TelegramClient } from './services/telegram-client.js';
import { h } from './utils/html.js';
import { logger } from './utils/logger.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = normalize(join(currentDir, '../public'));
const FORM_BODY_LIMIT = 60 * 1024 * 1024;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

    if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
      await handleStatic(response, url.pathname);
      return;
    }

    if (request.method === 'GET' && ['/health', '/health.php'].includes(url.pathname)) {
      await handleHealth(response, url);
      return;
    }

    if (request.method === 'GET' && ['/privacy', '/privacy.php'].includes(url.pathname)) {
      handlePrivacy(response);
      return;
    }

    if (request.method === 'POST' && ['/telegram/webhook', '/webhook', '/webhook.php'].includes(url.pathname)) {
      await handleTelegramWebhook(request, response);
      return;
    }

    if ((request.method === 'GET' || request.method === 'POST') && ['/', '/index.html'].includes(url.pathname)) {
      const session = loadSession(request, response);
      let form = {};
      if (request.method === 'POST') {
        try {
          form = await readFormBody(request);
        } catch (error) {
          if (error.status === 413 && session.adminLoggedIn) {
            session.flash = {
              message: 'Файл слишком большой для загрузки. Попробуйте файл меньше или проверьте лимит загрузки на сервере.',
              type: 'error',
            };
            sendResult(response, redirect(safeRefererPath(request, url)));
            return;
          }
          throw error;
        }
      }
      const result = await new AdminController({ session, response }).handle({
        method: request.method,
        url,
        form,
      });
      sendResult(response, result);
      return;
    }

    json(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    logger.error('http error', { message: error.message, stack: error.stack });
    if (error.status === 419) {
      text(response, 419, 'CSRF token mismatch');
    } else if (error.status === 413) {
      text(response, 413, 'Файл слишком большой');
    } else {
      json(response, 500, { ok: false, error: 'Internal server error' });
    }
  }
});

server.listen(config.port, config.host, () => {
  logger.info(`Node bot backend is listening on ${config.host}:${config.port}`);
});

async function handleStatic(response, pathname) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = normalize(join(publicDir, safePath));
  if (!path.startsWith(publicDir)) {
    text(response, 403, 'Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': contentType(path) });
    response.end(body);
  } catch {
    text(response, 404, 'Not found');
  }
}

function handlePrivacy(response) {
  html(response, 200, `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Согласие на обработку персональных данных</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #101828; background: #f6f8fb; }
    main { max-width: 760px; margin: 12vh auto; padding: 32px; background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0 0 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Согласие на обработку персональных данных</h1>
    <p>Настоящим пользователь даёт согласие ООО «Мегаполис Медиа» на обработку персональных данных, переданных при регистрации на мероприятия: ФИО, компанию, должность, телефон, email и Telegram-идентификатор.</p>
    <p>Данные используются для регистрации на мероприятия, коммуникации с участником, допуска к онлайн-эфирам и офлайн-площадке, отправки напоминаний и материалов после мероприятия.</p>
    <p>Согласие действует 3 года и может быть отозвано пользователем в порядке, предусмотренном законодательством РФ.</p>
    <p>Оператор: ООО «Мегаполис Медиа», ИНН 7710750836, ОГРН 1097746299034.</p>
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
    if (url.searchParams.get('schema') === '1') {
      payload.schema = await mysqlSchemaDiagnostics();
      payload.ok = payload.ok && payload.schema.ok;
    }
    if (url.searchParams.get('facecast') === '1') {
      const event = await queryOne(
        `SELECT id, title, facecast_event_id, facecast_url
         FROM events
         WHERE is_active = 1
         ORDER BY date_start ASC
         LIMIT 1`,
      );
      const facecastMissing = facecastMissingSettings(event);
      payload.facecast = {
        ready: facecastMissing.length === 0,
        missing_settings: facecastMissing,
        demo_mode: config.facecast.demoMode,
        uid_configured: Boolean(config.facecast.uid),
        api_key_configured: Boolean(config.facecast.apiKey),
        registration_mode: config.facecast.registrationMode,
        channel_id_configured: Boolean(config.facecast.channelId),
        default_stream_url_configured: Boolean(config.facecast.defaultStreamUrl),
        active_event: event
          ? {
              id: Number(event.id),
              title: event.title,
              facecast_event_id_configured: Boolean(String(event.facecast_event_id || '').trim()),
              facecast_url_configured: Boolean(String(event.facecast_url || '').trim()),
            }
          : null,
      };
    }
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

function facecastMissingSettings(event) {
  const missing = [];
  if (config.facecast.demoMode) missing.push('FACECAST_DEMO_MODE=false');
  if (!config.facecast.uid) missing.push('FACECAST_UID');
  if (!config.facecast.apiKey) missing.push('FACECAST_API_KEY');
  if (String(config.facecast.registrationMode || '').trim() !== 'userreg') {
    missing.push('FACECAST_REGISTRATION_MODE=userreg');
  }
  if (!config.facecast.userregEndpoint) missing.push('FACECAST_USERREG_ENDPOINT');
  if (!config.facecast.channelId) missing.push('FACECAST_CHANNEL_ID');
  if (!config.facecast.defaultStreamUrl) missing.push('FACECAST_DEFAULT_STREAM_URL');
  if (!event) {
    missing.push('active_event');
    return missing;
  }
  if (!String(event.facecast_event_id || '').trim()) missing.push('event.facecast_event_id');
  if (!String(event.facecast_url || '').trim()) missing.push('event.facecast_url');
  return missing;
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

async function readFormBody(request) {
  if (requestBodyTooLarge(request, FORM_BODY_LIMIT)) {
    throw httpError(413, 'Request body is too large');
  }

  const contentTypeHeader = String(request.headers['content-type'] || '');
  if (contentTypeHeader.toLowerCase().startsWith('multipart/form-data')) {
    const boundary = multipartBoundary(contentTypeHeader);
    if (!boundary) {
      return {};
    }
    const raw = await readRawBuffer(request, FORM_BODY_LIMIT);
    return parseMultipartForm(raw, boundary);
  }

  const raw = await readRawBody(request, FORM_BODY_LIMIT);
  return Object.fromEntries(new URLSearchParams(raw));
}

function requestBodyTooLarge(request, limit) {
  const contentLength = Number(request.headers['content-length'] || 0);
  return Number.isFinite(contentLength) && contentLength > limit;
}

function readRawBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(httpError(413, 'Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function readRawBuffer(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        reject(httpError(413, 'Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseMultipartForm(buffer, boundary) {
  const form = {};
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let position = 0;

  while (position < buffer.length) {
    const boundaryStart = buffer.indexOf(boundaryBuffer, position);
    if (boundaryStart === -1) break;
    let partStart = boundaryStart + boundaryBuffer.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2;
    }

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const headerText = buffer.subarray(partStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    if (nextBoundary === -1) break;

    let dataEnd = nextBoundary;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) {
      dataEnd -= 2;
    }

    const disposition = headerText.match(/^content-disposition:\s*form-data;\s*(.+)$/im);
    const name = disposition ? multipartHeaderParam(disposition[1], 'name') : '';
    if (name) {
      const filename = multipartHeaderParam(disposition[1], 'filename');
      const data = buffer.subarray(dataStart, dataEnd);
      if (filename !== null) {
        if (filename !== '' && data.length > 0) {
          const mimeType = headerText.match(/^content-type:\s*(.+)$/im)?.[1]?.trim() || 'application/octet-stream';
          form[name] = {
            filename: safeUploadFilename(filename),
            mimeType,
            size: data.length,
            buffer: Buffer.from(data),
          };
        }
      } else {
        form[name] = data.toString('utf8');
      }
    }

    position = nextBoundary;
  }

  return form;
}

function multipartBoundary(contentTypeHeader) {
  const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? String(match[1] || match[2] || '').trim() : '';
}

function multipartHeaderParam(value, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(value || '').match(new RegExp(`${escapedName}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function safeUploadFilename(filename) {
  return String(filename || 'media.bin').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180) || 'media.bin';
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeRefererPath(request, currentUrl) {
  try {
    const referer = new URL(String(request.headers.referer || ''), currentUrl);
    if (referer.origin === currentUrl.origin) {
      return `${referer.pathname}${referer.search}` || '/';
    }
  } catch {
    // Fall back below.
  }

  return `${currentUrl.pathname}${currentUrl.search}` || '/';
}

function redirect(location) {
  return { status: 302, headers: { Location: location }, body: '' };
}

function sendResult(response, result) {
  const headers = result.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    const existing = response.getHeader(key);
    if (existing && key.toLowerCase() === 'set-cookie') {
      response.setHeader(key, Array.isArray(existing) ? [...existing, value] : [existing, value]);
    } else {
      response.setHeader(key, value);
    }
  }
  response.writeHead(result.status || 200);
  response.end(result.body || '');
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(payload);
}

function text(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(payload);
}

function contentType(path) {
  const ext = extname(path);
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
