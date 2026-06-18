import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, loadEnv } from './env.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(currentDir, '../.env'));
loadEnv();

export const config = {
  nodeEnv: String(env('NODE_ENV', 'development')),
  host: String(env('HOST', '127.0.0.1')),
  port: Number(env('PORT', 3000)),
  appUrl: String(env('APP_URL', 'http://127.0.0.1:3000')).replace(/\/+$/, ''),
  timezone: String(env('APP_TIMEZONE', 'Europe/Moscow')),
  db: {
    host: String(env('DB_HOST', '127.0.0.1')),
    port: Number(env('DB_PORT', 3306)),
    database: String(env('DB_DATABASE', '')),
    user: String(env('DB_USERNAME', '')),
    password: String(env('DB_PASSWORD', '')),
  },
  telegram: {
    token: String(env('TELEGRAM_BOT_TOKEN', '')),
    webhookSecret: String(env('TELEGRAM_WEBHOOK_SECRET', '')),
    replyMode: String(env('TELEGRAM_REPLY_MODE', 'webhook')),
    dryRun: Boolean(env('TELEGRAM_DRY_RUN', false)),
    adminIds: String(env('ADMIN_TELEGRAM_IDS', ''))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  facecast: {
    apiBase: String(env('FACECAST_API_BASE', 'https://facecast.net/api/v1')).replace(/\/+$/, ''),
    token: String(env('FACECAST_API_TOKEN', '')),
    registrationEndpoint: String(env('FACECAST_REGISTRATION_ENDPOINT', '')),
    defaultStreamUrl: String(env('FACECAST_DEFAULT_STREAM_URL', '')),
    demoMode: Boolean(env('FACECAST_DEMO_MODE', true)),
  },
  links: {
    telegramChannel: String(env('TELEGRAM_CHANNEL_URL', 'https://t.me/megapolismedia')),
    companySite: String(env('COMPANY_SITE_URL', 'https://megapolis.media')),
    privacy: String(env('PRIVACY_URL', 'https://martis.pro/privacy.php')),
  },
};
