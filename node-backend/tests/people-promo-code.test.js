import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_CONNECTION = 'sqlite';
process.env.DB_DATABASE = ':memory:';
process.env.TELEGRAM_DRY_RUN = 'true';
process.env.FACECAST_DEMO_MODE = 'true';

const { PeopleRepository, profileComplete } = await import('../src/repositories/people-repository.js');
const people = new PeopleRepository();

test('promo codes are optional and stored literally without validation or SQL interpretation', async () => {
  const person = await people.upsertFromTelegram({ id: 820_001 });
  assert.equal(person.promo_code, null);
  const arbitraryCode = "any code ' ; DROP TABLE people; --";
  await people.updateFields(person.id, { promo_code: arbitraryCode });
  assert.equal((await people.findById(person.id)).promo_code, arbitraryCode);
  await people.updateFields(person.id, { promo_code: null });
  assert.equal((await people.findById(person.id)).promo_code, null);
});

test('the promo-code question stays incomplete while older profiles without codes remain ready', () => {
  const profile = {
    consent_accepted_at: '2026-01-01 00:00:00',
    full_name: 'Test Participant', company: 'Test Company', position_title: 'Test Role',
    phone: '+70000000000', email: 'test@example.invalid', state: 'registered', promo_code: null,
  };
  assert.equal(profileComplete(profile), true);
  assert.equal(profileComplete({ ...profile, promo_code: 'arbitrary code' }), true);
  assert.equal(profileComplete({ ...profile, state: 'ask_promo_code' }), false);
  assert.equal(profileComplete({ ...profile, state: 'ask_promo_code', promo_code: 'already typed' }), false);
  assert.equal(profileComplete({ ...profile, state: 'awaiting_creative_brief:ask_promo_code' }), false);
  assert.equal(profileComplete({ ...profile, state: 'awaiting_creative_brief:registered' }), true);
  assert.equal(profileComplete({ ...profile, email: null }), false);
  assert.equal(profileComplete(null), false);
});
