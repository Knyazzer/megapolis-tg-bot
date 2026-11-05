import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../public/assets/admin.js', import.meta.url), 'utf8');
const widgetSource = source.slice(source.indexOf("  var locationWidget ="), source.indexOf('  function initRegistrationDetailsModal()'));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function widget() {
  function element(value = '') {
    return {
      value, hidden: false, disabled: false, handlers: {},
      classList: { toggle() {} },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      focus() {},
    };
  }
  const form = element();
  const address = Object.assign(element(), { form });
  const lat = element();
  const lng = element();
  const button = element();
  const mapNode = element();
  const status = element();
  const elements = {
    '[data-location-address]': address,
    'input[name="venue_lat"]': lat,
    'input[name="venue_lng"]': lng,
    '[data-location-geocode]': button,
    '[data-location-map]': mapNode,
    '[data-location-status]': status,
  };
  const map = {
    handlers: {}, view: null,
    setView(coords) { this.view = coords; return this; },
    getZoom() { return 16; },
    on(name, handler) { this.handlers[name] = handler; },
    removeLayer() {},
  };
  const requests = [];
  const context = {
    URLSearchParams, AbortController,
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })),
    document: {
      querySelector: () => ({ dataset: { mapTileUrl: 'https://tiles.example/{z}/{x}/{y}' }, querySelector: (selector) => elements[selector] }),
      createElement: () => ({}),
      head: { appendChild: (node) => queueMicrotask(() => node.onload()) },
    },
    window: {
      setTimeout, clearTimeout,
      L: {
        map: () => map,
        tileLayer: () => ({ addTo() {} }),
        marker: () => ({ addTo() { return this; }, on() {}, setLatLng() {} }),
      },
    },
  };
  vm.runInNewContext(widgetSource, context);
  return { address, lat, lng, button, status, map, form, requests };
}

function reply(request, place) {
  request.resolve({ ok: true, json: async () => ({ ok: true, place }) });
}

test('empty coordinates stay empty; typing does not send geocoding requests', async () => {
  const w = widget();
  await flush();
  assert.equal(w.lat.value, '');
  assert.equal(w.lng.value, '');
  assert.equal(w.map.view[0], 55.7558);
  w.address.value = 'Moscow, test venue, office 25';
  w.address.handlers.input();
  assert.equal(w.requests.length, 0);
});

test('lookup keeps manual address details and saves coordinates; stale responses are ignored', async () => {
  const w = widget();
  await flush();
  w.address.value = 'Moscow, test venue, office 25';
  w.button.handlers.click();
  let prevented = false;
  w.form.handlers.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  reply(w.requests[0], { lat: 55.75, lng: 37.61, address: 'Moscow building' });
  await flush();
  assert.equal(w.address.value, 'Moscow, test venue, office 25');
  assert.equal(w.lat.value, '55.75');
  assert.equal(w.lng.value, '37.61');

  w.button.handlers.click();
  w.address.value = 'A different venue';
  w.address.handlers.input();
  reply(w.requests[1], { lat: 56, lng: 38, address: 'Old result' });
  await flush();
  assert.equal(w.address.value, 'A different venue');
  assert.equal(w.lat.value, '');
  assert.equal(w.lng.value, '');
});

test('clicking the map replaces the old address with the selected point address', async () => {
  const w = widget();
  await flush();
  w.address.value = 'Old venue';
  w.map.handlers.click({ latlng: { lat: 55.75, lng: 37.61 } });
  assert.equal(w.address.value, '');
  reply(w.requests[0], { lat: 55.749, lng: 37.609, address: 'Selected venue' });
  await flush();
  assert.equal(w.address.value, 'Selected venue');
  assert.equal(w.lat.value, '55.75');
  assert.equal(w.lng.value, '37.61');
});
