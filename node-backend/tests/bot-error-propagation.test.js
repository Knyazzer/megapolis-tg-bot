import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BotController } from '../src/bot/bot-controller.js';
import { logger } from '../src/utils/logger.js';

const update = {
  message: { from: { id: 12345 }, chat: { id: 12345 }, text: 'A message for the manager' },
};

function humanChatController(options = {}) {
  const sent = [];
  const recorded = [];
  const controller = new BotController({
    telegram: { sendMessage: async (...args) => { sent.push(args); } },
    ...options,
  });
  controller.people = {
    upsertFromTelegram: async () => ({ id: 17, telegram_id: 12345, state: 'registered', chat_mode: 'human' }),
  };
  controller.chat = { recordIncoming: async (message) => { recorded.push(message); } };
  return { controller, sent, recorded };
}

// Error logging is expected in these tests; keep fake failures out of test output.
async function withoutErrorLogs(callback) {
  const originalWarn = logger.warn;
  const originalError = logger.error;
  logger.warn = () => {};
  logger.error = () => {};
  try {
    await callback();
  } finally {
    logger.warn = originalWarn;
    logger.error = originalError;
  }
}

test('webhook mode propagates an incoming persistence failure before human-chat handling can acknowledge it', async () => {
  const { controller, sent } = humanChatController({ throwErrors: true });
  const failure = new Error('Chat INSERT failed');
  let attemptedRecords = 0;
  controller.chat.recordIncoming = async () => { attemptedRecords += 1; throw failure; };
  await withoutErrorLogs(async () => {
    await assert.rejects(controller.handle(update), (error) => error === failure);
  });
  assert.equal(attemptedRecords, 1);
  assert.deepEqual(sent, []);
});

test('successful human-chat input is persisted without generating a bot response', async () => {
  const { controller, sent, recorded } = humanChatController({ throwErrors: true });
  await controller.handle(update);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].personId, 17);
  assert.equal(recorded[0].telegramId, 12345);
  assert.equal(recorded[0].text, update.message.text);
  assert.deepEqual(sent, []);
});

test('default simulator mode still absorbs incoming persistence failures', async () => {
  const { controller, sent } = humanChatController();
  controller.chat.recordIncoming = async () => { throw new Error('Simulator persistence failure'); };
  await withoutErrorLogs(async () => {
    await assert.doesNotReject(controller.handle(update));
  });
  assert.deepEqual(sent, []);
});

test('webhook mode also propagates failures before incoming persistence begins', async () => {
  const { controller, recorded } = humanChatController({ throwErrors: true });
  const failure = new Error('People lookup failed');
  controller.people.upsertFromTelegram = async () => { throw failure; };
  await withoutErrorLogs(async () => {
    await assert.rejects(controller.handle(update), (error) => error === failure);
  });
  assert.deepEqual(recorded, []);
});
