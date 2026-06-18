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
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(':');
}

export function parseDate(value) {
  if (value instanceof Date) {
    return value;
  }

  return new Date(String(value).replace(' ', 'T'));
}

export function dateShort(value) {
  const date = parseDate(value);
  return `${date.getDate()} ${MONTHS_RU[date.getMonth() + 1]}`;
}

export function timeOnly(value) {
  const date = parseDate(value);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function timeRange(start, end) {
  return `с ${timeOnly(start)} до ${timeOnly(end)}`;
}

export function shiftDate(value, milliseconds) {
  return new Date(parseDate(value).getTime() + milliseconds);
}
