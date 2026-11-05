import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geocodeVenue } from '../src/services/venue-geocoder.js';
import { AdminController } from '../src/admin/admin-controller.js';

test('venue lookup validates input, shares requests, caches results and limits request frequency', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, time: Date.now() });
    return {
      ok: true,
      json: async () => url.pathname.endsWith('reverse')
        ? { lat: '55.75', lon: '37.61', display_name: 'Moscow venue' }
        : [{ lat: '55.75', lon: '37.61', display_name: 'Moscow venue' }],
    };
  };
  try {
    await assert.rejects(geocodeVenue(new URLSearchParams({ q: 'a' })), { status: 400 });
    await assert.rejects(geocodeVenue(new URLSearchParams({ lat: '', lng: '37' })), { status: 400 });
    await assert.rejects(geocodeVenue(new URLSearchParams({ lat: '91', lng: '37' })), { status: 400 });
    assert.equal(calls.length, 0);

    const params = new URLSearchParams({ q: 'Moscow test venue' });
    const [first, second] = await Promise.all([geocodeVenue(params), geocodeVenue(params)]);
    assert.deepEqual(first, { lat: 55.75, lng: 37.61, address: 'Moscow venue' });
    assert.deepEqual(second, first);
    assert.deepEqual(await geocodeVenue(params), first);
    assert.equal(calls.length, 1);
    assert.match(calls[0].options.headers['User-Agent'], /MegapolisEventBot/);

    const reverse = await geocodeVenue(new URLSearchParams({ lat: '55.75', lng: '37.61' }));
    assert.deepEqual(reverse, first);
    assert.ok(calls[1].time - calls[0].time >= 1000);
    assert.equal(calls[1].url.searchParams.get('lat'), '55.750000');
    assert.equal(calls[1].url.searchParams.get('lon'), '37.610000');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('venue search is only accessible to a signed-in moderator', async () => {
  const controller = new AdminController({ session: {}, response: {} });
  const result = await controller.handle({
    method: 'GET',
    url: new URL('http://localhost/?action=venue_geocode&q=Moscow'),
    form: {},
  });
  assert.match(result.body, /name="password"/);
  assert.doesNotMatch(result.body, /"place"/);
});
