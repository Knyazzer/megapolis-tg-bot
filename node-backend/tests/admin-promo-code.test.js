import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminController } from '../src/admin/admin-controller.js';

const controller = () => new AdminController({ session: { csrfToken: 'test-csrf' }, response: {} });
const maliciousCode = '<img src=x onerror="alert(1)">&\'CODE';
const escapedCode = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#039;CODE';
const timestamp = '2026-11-06 12:00:00';

test('People renders a promo code as escaped text inside the existing contact cell', () => {
  const admin = controller();
  const html = admin.peopleTableRow({
    id: 1, telegram_id: 12345, full_name: 'Test Person', promo_code: maliciousCode, created_at: timestamp,
  }, []);
  assert.ok(html.includes(`<span class="cell-sub">Промокод: ${escapedCode}</span>`));
  assert.ok(!html.includes(maliciousCode));
  assert.doesNotMatch(html, /<img\b/);
  assert.equal((html.match(/<td(?:\s[^>]*)?>/g) || []).length, 7, 'the existing table column count stays intact');
});

test('People does not add an empty promo-code line for participants without a code', () => {
  const admin = controller();
  for (const promoCode of [undefined, null, '']) {
    const html = admin.peopleTableRow({
      id: 1, telegram_id: 12345, full_name: 'Test Person', promo_code: promoCode, created_at: timestamp,
    }, []);
    assert.doesNotMatch(html, /Промокод:/);
  }
});

test('registration details show the saved promo code with HTML escaping', () => {
  const html = controller().registrationDetailsHtml({
    id: 1,
    person_id: 1,
    telegram_id: 12345,
    full_name: 'Test Person',
    attendance: 'offline',
    status: 'approved',
    title: 'Test Event',
    date_start: timestamp,
    created_at: timestamp,
    promo_code: maliciousCode,
  }, [], []);
  assert.ok(html.includes(`<span>Промокод</span><strong>${escapedCode}</strong>`));
  assert.ok(!html.includes(maliciousCode));
  assert.doesNotMatch(html, /<img\b/);
});

test('People promo-code lookup uses the existing bound search parameter', () => {
  const admin = controller();
  const code = "PROMO' OR 1=1 --";
  const params = {};
  const filters = admin.peopleFilters(new URL(`http://localhost/?page=people&q=${encodeURIComponent(code)}`));
  const sql = admin.peopleWhere(filters, params).join(' AND ');
  assert.match(sql, /p\.promo_code LIKE :search/);
  assert.equal(params.search, `%${code}%`);
  assert.ok(!sql.includes(code));
  assert.match(admin.peopleFilterPanel(filters, 1, 1), /placeholder="Имя, компания, телефон, email, промокод"/);
});

test('scenario and simulator recognise the optional promo-code step', () => {
  const admin = controller();
  assert.equal(admin.profileStateLabel('ask_promo_code'), 'ждём промокод');
  assert.equal(admin.flowStageForRow({ state: 'ask_promo_code' }), 'profile');
  const profile = JSON.stringify(admin.flowNodes().profile);
  assert.match(profile, /Шаг 6 из 6/);
  assert.match(profile, /Промокод/);
  assert.match(profile, /Пропустить/);
  assert.doesNotMatch(profile, /из 5/);
});
