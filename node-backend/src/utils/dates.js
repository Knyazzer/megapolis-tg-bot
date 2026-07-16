import { config } from '../config.js';

const MONTHS_RU = [
  '',
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function nowSql() {
  const date = new Date();
  return formatSqlDate(date);
}

export function formatSqlDate(date) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function parseDate(value) {
  if (value instanceof Date) {
    return value;
  }

  const raw = String(value || '').trim();
  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localMatch) {
    return zonedTimeToDate({
      year: Number(localMatch[1]),
      month: Number(localMatch[2]),
      day: Number(localMatch[3]),
      hour: Number(localMatch[4] || 0),
      minute: Number(localMatch[5] || 0),
      second: Number(localMatch[6] || 0),
    });
  }

  return new Date(raw.replace(' ', 'T'));
}

export function dateShort(value) {
  const parts = dateParts(value);
  return `${Number(parts.day)} ${MONTHS_RU[Number(parts.month)]}`;
}

export function timeOnly(value) {
  const parts = dateParts(value);
  return `${parts.hour}:${parts.minute}`;
}

export function timeRange(start, end) {
  return `с ${timeOnly(start)} до ${timeOnly(end)}`;
}

export function isValidDate(value) {
  try {
    const date = parseDate(value);
    if (!Number.isFinite(date.getTime())) {
      return false;
    }
    if (value instanceof Date) {
      return true;
    }

    const raw = String(value || '').trim();
    const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!localMatch) {
      return true;
    }

    const expected = `${localMatch[1]}-${localMatch[2]}-${localMatch[3]} `
      + `${localMatch[4] || '00'}:${localMatch[5] || '00'}:${localMatch[6] || '00'}`;
    return formatSqlDate(date) === expected;
  } catch {
    return false;
  }
}

export function dateShortSafe(value, fallback = 'уточняется') {
  return isValidDate(value) ? dateShort(value) : fallback;
}

export function timeOnlySafe(value, fallback = 'уточняется') {
  return isValidDate(value) ? timeOnly(value) : fallback;
}

export function timeRangeSafe(start, end, fallback = 'уточняется') {
  if (!isValidDate(start)) {
    return fallback;
  }
  if (!isValidDate(end)) {
    return `с ${timeOnly(start)}`;
  }
  return timeRange(start, end);
}

export function shiftDate(value, milliseconds) {
  return new Date(parseDate(value).getTime() + milliseconds);
}

function dateParts(value) {
  const date = parseDate(value);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function zonedTimeToDate(parts) {
  let utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  for (let index = 0; index < 2; index += 1) {
    const actual = datePartsFromTimestamp(utc);
    const actualUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    );
    const expectedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utc -= actualUtc - expectedUtc;
  }

  return new Date(utc);
}

function datePartsFromTimestamp(timestamp) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  return Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}
