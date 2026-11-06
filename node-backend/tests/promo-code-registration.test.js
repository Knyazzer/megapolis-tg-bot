import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: ':memory:',
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_DRY_RUN: 'true',
  ADMIN_TELEGRAM_IDS: '0',
  FACECAST_DEMO_MODE: 'true',
  APP_TIMEZONE: 'Europe/Moscow',
});

const { query, queryOne } = await import('../src/db/mysql.js');
const { BotController } = await import('../src/bot/bot-controller.js');
const { SimulatorTelegramClient } = await import('../src/admin/simulator-telegram-client.js');
const { profileComplete } = await import('../src/repositories/people-repository.js');
const { nowSql } = await import('../src/utils/dates.js');
const PROMO_PROMPT = /промо.?код/i;
let nextTelegramId = 60000;

beforeEach(async () => {
  await query('DELETE FROM people');
});

function conversation() {
  const telegramId = ++nextTelegramId;
  let sequence = 0;
  const history = [];
  const controller = new BotController({
    telegram: new SimulatorTelegramClient({ history }),
    throwErrors: true,
  });
  const from = { id: telegramId, first_name: 'Test', username: `promo_test_${telegramId}` };
  return {
    telegramId, history, controller,
    async message(value) {
      sequence += 1;
      await controller.handle({
        update_id: sequence,
        message: {
          message_id: sequence, from, chat: { id: telegramId, type: 'private' },
          ...(typeof value === 'string' ? { text: value } : value),
        },
      });
    },
    async callback(data) {
      sequence += 1;
      await controller.handle({
        update_id: sequence,
        callback_query: { id: `callback-${sequence}`, from, data, message: { chat: { id: telegramId, type: 'private' } } },
      });
    },
    person() {
      return queryOne('SELECT * FROM people WHERE telegram_id = :telegramId', { telegramId });
    },
  };
}

async function reachPromoPrompt(chat) {
  for (const text of ['/start', '🚀 Зарегистрироваться', '✅ Даю согласие', 'Иван Тестов', 'Тестовая компания', 'Менеджер']) {
    await chat.message(text);
  }
  await chat.message({ contact: { phone_number: '+79990000000', user_id: chat.telegramId } });
  assert.equal((await chat.person()).state, 'ask_email');
  await chat.message('User@Example.COM');
  const person = await chat.person();
  assert.equal(person.email, 'user@example.com');
  assert.equal(person.state, 'ask_promo_code');
  assert.equal(person.promo_code, null);
  assert.equal(profileComplete(person), false, 'the optional question must be answered or explicitly skipped');
  assert.match(chat.history.at(-1).text, PROMO_PROMPT);
}

test('after email the optional promo question appears, and an arbitrary code is saved with case preserved', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  const buttons = chat.history.at(-1).replyMarkup.keyboard.flat().map((button) => button.text);
  assert.ok(buttons.includes('Пропустить'));
  await chat.message('  MiXeD-2026 /Тест  ');
  const person = await chat.person();
  assert.equal(person.promo_code, 'MiXeD-2026 /Тест');
  assert.equal(person.state, 'registered');
  assert.equal(profileComplete(person), true);
  assert.match(chat.history.at(-1).text, /готово|анкета собрана/i);
});

test('explicit skip completes registration and leaves promo_code NULL', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  await chat.message('Пропустить');
  const person = await chat.person();
  assert.equal(person.promo_code, null);
  assert.equal(person.state, 'registered');
  assert.equal(profileComplete(person), true);
});

test('restart and menu navigation resume the pending promo question', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  for (const text of ['/start', '/menu', '🏠 Главное меню', '🚀 Зарегистрироваться']) {
    chat.history.length = 0;
    await chat.message(text);
    assert.equal((await chat.person()).state, 'ask_promo_code', text);
    assert.equal((await chat.person()).promo_code, null, text);
    assert.match(chat.history.at(-1).text, PROMO_PROMPT, text);
  }
  chat.history.length = 0;
  await chat.callback('main_menu');
  assert.equal((await chat.person()).state, 'ask_promo_code');
  assert.match(chat.history.at(-1).text, PROMO_PROMPT);
});

test('empty, nontext and overlong answers do not complete or change the promo field', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  for (const value of ['', '   ', { photo: [{ file_id: 'test-photo' }], caption: 'CAPTION-IS-NOT-AN-ANSWER' }, '😀'.repeat(129)]) {
    chat.history.length = 0;
    await chat.message(value);
    const person = await chat.person();
    assert.equal(person.state, 'ask_promo_code');
    assert.equal(person.promo_code, null);
    assert.equal(profileComplete(person), false);
    assert.ok(chat.history.length > 0, 'invalid input must produce an explanation or repeat the question');
  }
});

test('the 128-character limit counts Unicode code points rather than UTF-16 code units', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  const code = '😀'.repeat(128);
  await chat.message(code);
  const person = await chat.person();
  assert.equal(person.promo_code, code);
  assert.equal(person.state, 'registered');
});

test('existing complete profiles without a promo code are not asked to register again', async () => {
  const chat = conversation();
  await query(
    `INSERT INTO people
      (telegram_id, full_name, company, position_title, phone, email, consent_accepted_at, state, created_at, updated_at)
     VALUES (:telegramId, :name, :company, :position, :phone, :email, :now, 'registered', :now, :now)`,
    {
      telegramId: chat.telegramId, name: 'Существующий участник', company: 'Компания', position: 'Директор',
      phone: '+79990000001', email: 'existing@example.com', now: nowSql(),
    },
  );
  assert.equal(profileComplete(await chat.person()), true);
  for (const text of ['/start', '/menu', '🚀 Зарегистрироваться']) {
    chat.history.length = 0;
    await chat.message(text);
    const person = await chat.person();
    assert.equal(person.state, 'registered');
    assert.equal(person.promo_code, null);
    assert.doesNotMatch(chat.history.at(-1).text, PROMO_PROMPT);
  }
  for (const data of ['start_registration', 'consent_accept']) {
    chat.history.length = 0;
    await chat.callback(data);
    assert.equal((await chat.person()).state, 'registered');
    assert.doesNotMatch(chat.history.at(-1).text, PROMO_PROMPT);
  }
});

test('event actions and stale registration callbacks cannot bypass the pending promo question', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  const event = await queryOne('SELECT id FROM events ORDER BY id LIMIT 1');
  for (const data of ['events', `event:${event.id}`, `reg_online:${event.id}`, `reg_offline:${event.id}`, 'start_registration', 'consent_accept']) {
    chat.history.length = 0;
    await chat.callback(data);
    const person = await chat.person();
    assert.equal(person.state, 'ask_promo_code', data);
    assert.equal(person.promo_code, null, data);
    assert.match(chat.history.at(-1).text, PROMO_PROMPT, data);
  }
  const registrations = await queryOne('SELECT COUNT(*) AS total FROM registrations');
  assert.equal(registrations.total, 0);
});

test('creative-brief navigation restores the pending promo question', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  await chat.message('💡 Получить идею');
  const wrapped = await chat.person();
  assert.equal(wrapped.state, 'awaiting_creative_brief:ask_promo_code');
  assert.equal(profileComplete(wrapped), false);
  chat.history.length = 0;
  await chat.message('/start');
  assert.equal((await chat.person()).state, 'ask_promo_code');
  assert.match(chat.history.at(-1).text, PROMO_PROMPT);
  for (const data of ['start_registration', 'consent_accept', 'main_menu']) {
    await chat.message('💡 Получить идею');
    await chat.callback(data);
    assert.equal((await chat.person()).state, 'ask_promo_code', data);
    assert.match(chat.history.at(-1).text, PROMO_PROMPT, data);
  }
});

test('repeated code, skip and restart messages after completion do not overwrite the saved promo code', async () => {
  const chat = conversation();
  await reachPromoPrompt(chat);
  await chat.message('First-CoDe');
  for (const text of ['First-CoDe', 'Another-Code', 'Пропустить', '/start']) {
    await chat.message(text);
    const person = await chat.person();
    assert.equal(person.state, 'registered');
    assert.equal(person.promo_code, 'First-CoDe');
  }
  for (const data of ['start_registration', 'consent_accept']) {
    await chat.callback(data);
    assert.equal((await chat.person()).state, 'registered');
    assert.equal((await chat.person()).promo_code, 'First-CoDe');
  }
});
