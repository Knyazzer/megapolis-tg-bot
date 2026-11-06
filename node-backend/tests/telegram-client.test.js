import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../src/config.js';
import {
  isTelegramRetryableError,
  splitTelegramText,
  TelegramApiError,
  TelegramClient,
  TelegramTransportError,
  telegramRetryDelayMs,
} from '../src/services/telegram-client.js';

async function withFakeTelegram(fetch, callback) {
  const previousFetch = globalThis.fetch;
  const previousConfig = { ...config.telegram };
  globalThis.fetch = fetch;
  Object.assign(config.telegram, { token: 'test-token', dryRun: false });
  try {
    await callback(new TelegramClient({ maxAttempts: 1 }));
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config.telegram, previousConfig);
  }
}

const upload = { buffer: Buffer.from('test-image'), filename: 'test.jpg', mimeType: 'image/jpeg' };

test('a queue client makes one request on a transient JSON API failure', async () => {
  let requests = 0;
  await withFakeTelegram(async () => {
    requests += 1;
    throw new TypeError('fetch failed');
  }, async (client) => {
    await assert.rejects(client.sendMessage(123, 'Test'), (error) => {
      assert.ok(error instanceof TelegramTransportError);
      assert.equal(isTelegramRetryableError(error), true);
      return true;
    });
    assert.equal(requests, 1);
  });
});

test('multipart transport and non-JSON upstream failures are retryable', async () => {
  for (const response of [
    async () => { throw new TypeError('connection reset'); },
    async () => new Response('Service unavailable', { status: 503 }),
  ]) {
    await withFakeTelegram(response, async (client) => {
      await assert.rejects(client.sendPhoto(123, upload), (error) => {
        assert.ok(error instanceof TelegramTransportError);
        assert.equal(error.method, 'sendPhoto');
        assert.equal(isTelegramRetryableError(error), true);
        return true;
      });
    });
  }
});

test('multipart 429 and 5xx preserve Telegram errors while 403 is permanent', async () => {
  for (const code of [429, 500, 403]) {
    await withFakeTelegram(async () => new Response(JSON.stringify({
      ok: false,
      error_code: code,
      description: 'test error',
      parameters: code === 429 ? { retry_after: 1200 } : undefined,
    }), { status: code }), async (client) => {
      await assert.rejects(client.sendPhoto(123, upload), (error) => {
        assert.ok(error instanceof TelegramApiError);
        assert.equal(error.errorCode, code);
        assert.equal(error.responseStatus, code);
        assert.equal(isTelegramRetryableError(error), code !== 403);
        if (code === 429) {
          assert.equal(error.parameters.retry_after, 1200);
          assert.equal(telegramRetryDelayMs(error, 1), 1200 * 1000);
        }
        return true;
      });
    });
  }
});

test('successful multipart upload uses the shared Telegram response parser', async () => {
  await withFakeTelegram(async (_url, options) => {
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('chat_id'), '123');
    assert.equal(options.body.get('photo').name, 'test.jpg');
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }, async (client) => {
    assert.deepEqual(await client.sendPhoto(123, upload), { ok: true, result: { message_id: 1 } });
  });
});

test('durable retry delay backs off and never shortens a flood-control wait', () => {
  const transport = new TelegramTransportError('sendMessage', new Error('timeout'));
  assert.equal(telegramRetryDelayMs(transport, 0), 30_000);
  assert.equal(telegramRetryDelayMs(transport, 1), 30_000);
  assert.equal(telegramRetryDelayMs(transport, 2), 60_000);
  assert.equal(telegramRetryDelayMs(transport, 6), 900_000);
  assert.equal(telegramRetryDelayMs(transport, 100), 900_000);

  for (const retryAfter of [undefined, null, -10, NaN, Infinity, '30', true]) {
    const error = new TelegramApiError('sendMessage', 429, { error_code: 429, parameters: { retry_after: retryAfter } });
    assert.equal(telegramRetryDelayMs(error, 1), 30_000);
  }
  const limited = (seconds) => new TelegramApiError('sendMessage', 429, {
    error_code: 429, parameters: { retry_after: seconds },
  });
  assert.equal(telegramRetryDelayMs(limited(5), 2), 60_000);
  assert.equal(telegramRetryDelayMs(limited(1200), 2), 1_200_000);
});

test('text chunks are individually sendable without losing long lines or breaking emoji', () => {
  for (const text of ['short', 'a'.repeat(8500), `${'a'.repeat(3899)}😀${'b'.repeat(4000)}`, `${'a'.repeat(3890)}\n${'b'.repeat(4000)}`]) {
    const chunks = splitTelegramText(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 3900));
    assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
  }
});
