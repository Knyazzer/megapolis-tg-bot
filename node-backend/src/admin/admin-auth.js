import { randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const sessions = new Map();

export function loadSession(request, response) {
  const cookies = parseCookies(request.headers.cookie || '');
  const existingId = cookies.mm_session;
  if (existingId && sessions.has(existingId)) {
    const session = sessions.get(existingId);
    session.touchedAt = Date.now();
    return session;
  }

  const id = randomBytes(32).toString('hex');
  const session = {
    id,
    adminLoggedIn: false,
    flash: null,
    csrfToken: randomBytes(32).toString('hex'),
    touchedAt: Date.now(),
  };
  sessions.set(id, session);
  response.setHeader('Set-Cookie', cookie('mm_session', id));
  cleanupSessions();
  return session;
}

export function destroySession(session, response) {
  sessions.delete(session.id);
  response.setHeader('Set-Cookie', 'mm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function csrfField(session) {
  return `<input type="hidden" name="_token" value="${escapeHtml(session.csrfToken)}">`;
}

export function verifyCsrf(session, form) {
  const actual = String(form._token || '');
  const expected = String(session.csrfToken || '');
  if (!safeEquals(actual, expected)) {
    const error = new Error('CSRF token mismatch');
    error.status = 419;
    throw error;
  }
}

export function attemptLogin(login, password) {
  if (!safeEquals(String(login || ''), config.admin.login) || !config.admin.passwordHash) {
    return false;
  }

  const hash = config.admin.passwordHash.replace(/^\$2y\$/, '$2b$');
  return bcrypt.compareSync(String(password || ''), hash);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(value);
    }
  }
  return result;
}

function cookie(name, value) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function cleanupSessions() {
  const maxAge = 1000 * 60 * 60 * 24;
  const threshold = Date.now() - maxAge;
  for (const [id, session] of sessions) {
    if (session.touchedAt < threshold) {
      sessions.delete(id);
    }
  }
}

function safeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
