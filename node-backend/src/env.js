import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(file = '.env') {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function env(key, fallback = undefined) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }
  if (value.toLowerCase() === 'null') {
    return null;
  }

  return value;
}
