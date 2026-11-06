import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: ':memory:',
  TELEGRAM_DRY_RUN: 'true',
  FACECAST_DEMO_MODE: 'true',
  APP_TIMEZONE: 'Europe/Moscow',
});

const { AdminController } = await import('../src/admin/admin-controller.js');
const { query, queryOne, closeDb } = await import('../src/db/mysql.js');
const { processDueMessages } = await import('../src/jobs/message-worker.js');

test('the full guest address survives saving, reopening, approval, venue and reminder delivery', async () => {
  const address = 'Москва, Знаменка 13с1, этаж 7, офис 25';
  const controller = new AdminController({ session: { csrfToken: 'test' }, response: {} });
  const texts = [];
  const venues = [];
  const telegram = {
    async sendMessage(_chatId, text) { texts.push(text); return { ok: true }; },
    async sendVenue(...args) { venues.push(args); return { ok: true }; },
  };
  controller.telegram = telegram;
  try {
    await controller.saveEvent({
      title: 'Guest address test', date_start: '2099-07-31T18:00', duration_minutes: '120',
      address, venue_lat: '55.752191', venue_lng: '37.604907', is_active: '1',
    });
    const event = await queryOne('SELECT * FROM events WHERE title = :title', { title: 'Guest address test' });
    assert.equal(event.address, address);
    assert.match(await controller.eventEditPage(event.id), /Знаменка 13с1, этаж 7, офис 25/);
    const person = await query(
      'INSERT INTO people (telegram_id, created_at, updated_at) VALUES (:telegramId, :now, :now)',
      { telegramId: 12345, now: '2099-01-01 00:00:00' },
    );
    const registration = await query(
      `INSERT INTO registrations (person_id, event_id, attendance, status, created_at, updated_at)
       VALUES (:personId, :eventId, 'offline', 'pending', :now, :now)`,
      { personId: person.insertId, eventId: event.id, now: '2099-01-01 00:00:00' },
    );
    await controller.approveRegistration({ id: registration.insertId });
    assert.ok(texts[0].includes(address));
    assert.equal(venues[0][4], address);
    await query(
      'UPDATE scheduled_messages SET send_at = :past WHERE registration_id = :id AND type = :type',
      { past: '2000-01-01 00:00:00', id: registration.insertId, type: 'offline_1day' },
    );
    const result = await processDueMessages({ telegram });
    assert.equal(result.scheduled.sent, 1);
    assert.ok(texts[1].includes(address));
  } finally {
    await closeDb();
  }
});
