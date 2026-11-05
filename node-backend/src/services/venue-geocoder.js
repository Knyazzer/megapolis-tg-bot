import { config } from '../config.js';

const cache = new Map();
const pending = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_INTERVAL_MS = 1100;
let lastRequestAt = 0;
let requestQueue = Promise.resolve();

// All moderators share one queue and cache to respect the public geocoder's limit.
export async function geocodeVenue(params) {
  const lat = coordinate(params.get('lat'), 90);
  const lng = coordinate(params.get('lng'), 180);
  const reverse = params.has('lat') || params.has('lng');
  const address = String(params.get('q') || '').trim();
  if (reverse ? lat === null || lng === null : address.length < 3 || address.length > 500) {
    const error = new Error(reverse ? 'Некорректная точка на карте.' : 'Укажите город, улицу и дом.');
    error.status = 400;
    throw error;
  }

  const url = new URL(`${config.maps.geocoderUrl}/${reverse ? 'reverse' : 'search'}`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('accept-language', 'ru');
  if (reverse) {
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lng.toFixed(6));
    url.searchParams.set('zoom', '18');
  } else {
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');
  }

  const key = url.href;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.place;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 10) {
    const error = new Error('Поиск адресов занят. Повторите через несколько секунд.');
    error.status = 429;
    throw error;
  }

  const request = requestQueue.then(async () => {
    const delay = lastRequestAt + REQUEST_INTERVAL_MS - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': `MegapolisEventBot/1.0 (+${config.links.companySite})`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('geocoder unavailable');
      const data = await response.json();
      const item = reverse ? data : data[0];
      const place = item && !item.error
        && coordinate(item.lat, 90) !== null && coordinate(item.lon, 180) !== null
        ? { lat: Number(item.lat), lng: Number(item.lon), address: String(item.display_name || '') }
        : null;
      if (cache.size >= 300) cache.delete(cache.keys().next().value);
      cache.set(key, { place, expiresAt: Date.now() + CACHE_TTL_MS });
      return place;
    } catch {
      throw new Error('Поиск адреса временно недоступен. Адрес можно ввести вручную.');
    }
  });
  pending.set(key, request);
  requestQueue = request.catch(() => {});
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

function coordinate(value, max) {
  if (value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null;
}
