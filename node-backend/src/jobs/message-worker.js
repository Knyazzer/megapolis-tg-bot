import { query, queryOne } from '../db/mysql.js';
import { ChatRepository } from '../repositories/chat-repository.js';
import { FacecastClient } from '../services/facecast-client.js';
import { isTelegramRetryableError, TelegramClient } from '../services/telegram-client.js';
import {
  dateShortSafe,
  formatSqlDate,
  isValidDate,
  nowSql,
  shiftDate,
  timeOnly,
  timeOnlySafe,
  timeRangeSafe,
} from '../utils/dates.js';
import { h } from '../utils/html.js';
import { logger } from '../utils/logger.js';

const facecast = new FacecastClient();
const chat = new ChatRepository();
const RETRYABLE_SCHEDULED_TYPES = new Set(['offline_approved']);
const MAX_TRANSACTIONAL_RETRY_ATTEMPTS = 6;
const TRANSACTIONAL_RETRY_DELAY_MS = 5 * 60 * 1000;

export async function processDueMessages({ limit = 50, broadcastCampaignId = null } = {}) {
  const telegram = new TelegramClient();
  const safeLimit = sqlLimit(limit);
  const scheduled = broadcastCampaignId
    ? { picked: 0, sent: 0, skipped: 0, failed: 0 }
    : await processScheduledMessages(telegram, safeLimit);
  const broadcasts = await processBroadcastMessages(telegram, Math.max(safeLimit, 60), broadcastCampaignId);
  const facecastStats = broadcastCampaignId
    ? { picked: 0, updated: 0, visited: 0, failed: 0 }
    : await syncFacecastWatchStats(Math.min(safeLimit, 20));
  return { scheduled, broadcasts, facecastStats };
}

async function syncFacecastWatchStats(limit) {
  const rowLimit = sqlLimit(limit);
  const now = nowSql();
  const staleBefore = formatSqlDate(shiftDate(now, -60 * 60 * 1000));
  const rows = await query(
    `SELECT r.*, e.facecast_event_id, e.slug, e.title, e.date_start
     FROM registrations r
     JOIN events e ON e.id = r.event_id
     WHERE r.attendance = 'online'
       AND r.archived_at IS NULL
       AND r.facecast_password IS NOT NULL
       AND r.facecast_password != ''
       AND r.status NOT IN ('rejected','cancelled')
       AND e.date_start <= :now
       AND (r.facecast_stats_synced_at IS NULL OR r.facecast_stats_synced_at <= :staleBefore)
     ORDER BY r.facecast_stats_synced_at IS NULL DESC, r.created_at DESC
     LIMIT ${rowLimit}`,
    { now, staleBefore },
  );

  let updated = 0;
  let visited = 0;
  let failed = 0;
  const activitiesByEvent = new Map();

  for (const row of rows) {
    try {
      const eventKey = String(row.facecast_event_id || row.slug || row.event_id);
      if (!activitiesByEvent.has(eventKey)) {
        activitiesByEvent.set(eventKey, await facecast.eventActivity(row));
      }
      const activity = facecast.viewerActivityFromRows(activitiesByEvent.get(eventKey), row);
      const hasWatched = Number(activity.totalWatchMinutes || 0) > 0;
      await query(
        `UPDATE registrations
         SET facecast_watch_minutes = :watchMinutes,
          facecast_total_watch_minutes = :totalWatchMinutes,
          facecast_stats_synced_at = :now,
          status = CASE WHEN :hasWatched = 1 THEN 'visited' ELSE status END,
          updated_at = :now
         WHERE id = :id`,
        {
          id: row.id,
          watchMinutes: activity.watchMinutes,
          totalWatchMinutes: activity.totalWatchMinutes,
          hasWatched: hasWatched ? 1 : 0,
          now,
        },
      );
      updated += 1;
      if (hasWatched) visited += 1;
    } catch (error) {
      failed += 1;
      logger.warn('facecast watch stats sync failed', {
        registrationId: row.id,
        eventId: row.event_id,
        message: error.message,
      });
    }
  }

  return { picked: rows.length, updated, visited, failed };
}

async function processScheduledMessages(telegram, limit) {
  const rowLimit = sqlLimit(limit);
  const rows = await query(
    `SELECT
       sm.*,
       p.id AS person_id,
       p.telegram_id,
       p.email,
       r.attendance,
       r.status,
       r.archived_at,
       r.facecast_login,
       r.facecast_password,
       r.facecast_url,
       e.title,
       e.date_start,
       e.date_end,
       e.guest_arrival_at,
       e.online_start,
       e.address,
       e.facecast_event_id,
       e.facecast_url AS event_facecast_url,
       e.recording_url,
       e.photo_album_url,
       e.postpromo_message,
       e.postpromo_send_at
     FROM scheduled_messages sm
     JOIN people p ON p.id = sm.person_id
     LEFT JOIN registrations r ON r.id = sm.registration_id
     LEFT JOIN events e ON e.id = sm.event_id
     WHERE sm.sent_at IS NULL
       AND sm.failed_at IS NULL
       AND sm.send_at <= :now
     ORDER BY sm.send_at ASC
     LIMIT ${rowLimit}`,
    { now: nowSql() },
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    let text = '';
    try {
      if (scheduledMessageIsStale(row)) {
        await markScheduledSent(row.id);
        skipped += 1;
        continue;
      }

      const [payloadText, keyboard] = scheduledMessagePayload(row);
      text = payloadText;
      await telegram.sendMessage(Number(row.telegram_id), text, keyboard);
      await recordScheduledOutgoing(row, text, 'sent');
      await markScheduledSent(row.id);
      sent += 1;
    } catch (error) {
      if (scheduledMessageShouldRetry(row, error)) {
        await rescheduleScheduledRetry(row, error);
      } else {
        await recordScheduledOutgoing(row, text, 'failed', error);
        await markScheduledFailed(row.id, error);
      }
      failed += 1;
      logger.warn('scheduled message failed', { id: row.id, message: error.message });
    }
  }

  return { picked: rows.length, sent, skipped, failed };
}

async function processBroadcastMessages(telegram, limit, campaignId = null) {
  const rowLimit = sqlLimit(limit);
  const campaignFilter = Number(campaignId || 0) > 0 ? 'AND bm.campaign_id = :campaignId' : '';
  const rows = await query(
    `SELECT bm.*, c.audience, c.event_id, c.content_type, c.body, c.media_file_id, c.media_mime, c.media_name, c.media_size, c.id AS campaign_id
     FROM broadcast_messages bm
     JOIN broadcast_campaigns c ON c.id = bm.campaign_id
     WHERE bm.status = 'queued'
       AND c.status != 'cancelled'
       ${campaignFilter}
     ORDER BY bm.id ASC
     LIMIT ${rowLimit}`,
    campaignFilter ? { campaignId: Number(campaignId) } : {},
  );

  let sent = 0;
  let failed = 0;
  const cachedMediaFileIds = new Map();
  const cachedMediaUploads = new Map();

  for (const row of rows) {
    try {
      let telegramResult = null;
      const media = await broadcastMedia(row, cachedMediaFileIds, cachedMediaUploads);
      const replyMarkup = broadcastReplyMarkup(row);
      const hasBody = String(row.body || '').trim() !== '';
      if (row.content_type === 'video_note' && media) {
        telegramResult = await telegram.sendVideoNote(Number(row.telegram_id), media, hasBody ? {} : replyMarkup);
      } else if (row.content_type === 'photo' && media) {
        const caption = telegramMediaCaption(row.body);
        telegramResult = await telegram.sendPhoto(Number(row.telegram_id), media, caption, caption || !hasBody ? replyMarkup : {});
        if (caption) row.body = '';
      } else if (row.content_type === 'video' && media) {
        const caption = telegramMediaCaption(row.body);
        telegramResult = await telegram.sendVideo(Number(row.telegram_id), media, caption, caption || !hasBody ? replyMarkup : {});
        if (caption) row.body = '';
      }

      await rememberTelegramFileId(row, telegramResult, cachedMediaFileIds);

      if (String(row.body || '').trim() !== '') {
        await telegram.sendMessage(Number(row.telegram_id), String(row.body), replyMarkup);
      }

      await query(
        "UPDATE broadcast_messages SET status = 'sent', sent_at = :now, updated_at = :now WHERE id = :id",
        { id: row.id, now: nowSql() },
      );
      sent += 1;
    } catch (error) {
      await query(
        "UPDATE broadcast_messages SET status = 'failed', error = :error, updated_at = :now WHERE id = :id",
        { id: row.id, error: error.message, now: nowSql() },
      );
      failed += 1;
      logger.warn('broadcast message failed', { id: row.id, message: error.message });
    }
  }

  await refreshCampaignStatuses(rows);
  return { picked: rows.length, sent, failed };
}

async function broadcastMedia(row, cachedMediaFileIds, cachedMediaUploads) {
  const cachedFileId = cachedMediaFileIds.get(Number(row.campaign_id));
  const fileId = String(row.media_file_id || cachedFileId || '').trim();
  if (fileId) {
    return fileId;
  }

  const campaignId = Number(row.campaign_id);
  if (!cachedMediaUploads.has(campaignId)) {
    cachedMediaUploads.set(campaignId, await loadBroadcastMediaUpload(row));
  }

  return cachedMediaUploads.get(campaignId) || '';
}

async function loadBroadcastMediaUpload(row) {
  const media = await queryOne(
    'SELECT media_blob, media_mime, media_name, media_size FROM broadcast_campaigns WHERE id = :id LIMIT 1',
    { id: row.campaign_id },
  );
  const blob = media?.media_blob;
  if (!blob) {
    return '';
  }

  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buffer.length === 0) {
    return '';
  }

  return {
    buffer,
    filename: String(media.media_name || row.media_name || defaultBroadcastMediaName(row.content_type)),
    mimeType: String(media.media_mime || row.media_mime || defaultBroadcastMime(row.content_type)),
    size: Number(media.media_size || row.media_size || buffer.length),
  };
}

async function rememberTelegramFileId(row, telegramResult, cachedMediaFileIds) {
  if (String(row.media_file_id || '').trim() !== '') {
    return;
  }

  const fileId = extractTelegramFileId(row.content_type, telegramResult);
  if (!fileId) {
    return;
  }

  cachedMediaFileIds.set(Number(row.campaign_id), fileId);
  await query(
    `UPDATE broadcast_campaigns
     SET media_file_id = :fileId, updated_at = :now
     WHERE id = :campaignId AND (media_file_id IS NULL OR media_file_id = '')`,
    { campaignId: row.campaign_id, fileId, now: nowSql() },
  );
}

function extractTelegramFileId(contentType, response) {
  if (contentType === 'photo') {
    const photos = response?.result?.photo || [];
    return String(photos[photos.length - 1]?.file_id || '').trim();
  }
  if (contentType === 'video') {
    return String(response?.result?.video?.file_id || '').trim();
  }
  if (contentType === 'video_note') {
    return String(response?.result?.video_note?.file_id || '').trim();
  }
  return '';
}

function defaultBroadcastMediaName(contentType) {
  if (contentType === 'photo') return 'broadcast-image.jpg';
  if (contentType === 'video_note') return 'broadcast-video-note.mp4';
  return 'broadcast-video.mp4';
}

function defaultBroadcastMime(contentType) {
  return contentType === 'photo' ? 'image/jpeg' : 'video/mp4';
}

function telegramMediaCaption(text) {
  const caption = String(text || '').trim();
  return caption.length > 0 && caption.length <= 900 ? caption : '';
}

function broadcastReplyMarkup(row) {
  if (String(row.audience || '') !== 'event_not_registered') {
    return {};
  }

  const eventId = Number(row.event_id || 0);
  if (eventId <= 0) {
    return {};
  }

  return {
    inline_keyboard: [
      [{ text: 'Выбрать формат участия', callback_data: `event:${eventId}` }],
      [{ text: 'Главное меню', callback_data: 'main_menu' }],
    ],
  };
}

function sqlLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(500, Math.trunc(value)));
}

function scheduledMessageIsStale(row) {
  const type = String(row.type || '');
  const attendance = String(row.attendance || '');
  const status = String(row.status || '');

  if (row.archived_at) {
    return true;
  }

  if (type === 'postpromo') {
    return !String(row.postpromo_message || '').trim() || !['approved', 'visited'].includes(status);
  }

  if (['cancelled', 'rejected', 'no_show'].includes(status)) {
    return true;
  }

  if (type.startsWith('offline_')) {
    return attendance !== 'offline' || !['approved', 'visited'].includes(status);
  }

  if (type.startsWith('online_')) {
    return attendance !== 'online' || status !== 'approved';
  }

  return false;
}

function scheduledMessagePayload(row) {
  const url = validPersonalFacecastUrl(row);
  const eventTitle = String(row.title || 'мероприятие');
  const date = dateShortSafe(row.date_start);
  const range = timeRangeSafe(row.date_start, row.date_end);
  const arrival = offlineArrivalTime(row);
  const registrationId = Number(row.registration_id);

  if (row.type === 'offline_1day') {
    return [
      '<b>Напоминаем о встрече завтра 🏢</b>\n\n'
        + 'Будем рады видеть вас на площадке:\n'
        + `<b>Название:</b> ${h(eventTitle)}\n`
        + `<b>Дата:</b> ${h(date)}\n`
        + `<b>Время:</b> ${h(range)}\n`
        + `<b>Сбор гостей:</b> ${h(arrival)}\n`
        + `<b>Адрес:</b> ${h(row.address || '')}\n`
        + '<b>Формат:</b> офлайн',
      confirmKeyboard(registrationId),
    ];
  }

  if (row.type === 'offline_approved') {
    return [
      '<b>Офлайн-участие подтверждено 🏢</b>\n\n'
        + 'Ждём вас на мероприятии:\n'
        + `<b>Название:</b> ${h(eventTitle)}\n`
        + `<b>Дата:</b> ${h(date)}\n`
        + `<b>Время:</b> ${h(range)}\n`
        + `<b>Сбор гостей:</b> ${h(arrival)}\n`
        + `<b>Наш адрес:</b> ${h(row.address || '')}\n`
        + '<b>Формат:</b> офлайн\n\n'
        + 'Перед событием пришлём напоминание. Маршрут держим под рукой, хорошее настроение тоже.',
      {},
    ];
  }

  if (row.type === 'offline_2hours') {
    return [
      '<b>До офлайн-встречи осталось около двух часов 🙂</b>\n\n'
        + 'Пожалуйста, заложите время на дорогу и ресепшн. Лучше прийти спокойно, чем соревноваться с городским трафиком.\n\n'
        + `<b>Название:</b> ${h(eventTitle)}\n`
        + `<b>Дата:</b> ${h(date)}\n`
        + `<b>Время:</b> ${h(range)}\n`
        + `<b>Сбор гостей:</b> ${h(arrival)}\n`
        + `<b>Адрес:</b> ${h(row.address || '')}\n`
        + '<b>Формат:</b> офлайн',
      confirmKeyboard(registrationId),
    ];
  }

  if (row.type === 'offline_started') {
    return [
      '<b>Начинаем!</b> ✨\n\nРады видеть вас на мероприятии. Желаем хорошего настроя, полезных знакомств и живого разговора.',
      {},
    ];
  }

  if (row.type === 'online_15min') {
    return ['<b>Напоминаем про эфир 💻</b>\n\nНачинаем через 15 минут. Можно налить чай и открыть ссылку заранее.', onlineKeyboard(registrationId, url)];
  }

  if (row.type === 'online_started') {
    return [
      '<b>Мы начали!</b> 💻\n\nДобро пожаловать в прямой эфир. Задавайте вопросы спикерам в чате трансляции.',
      onlineKeyboard(registrationId, url),
    ];
  }

  if (row.type === 'postpromo') {
    return [h(row.postpromo_message), {}];
  }

  return [`Напоминание о мероприятии: ${h(eventTitle)} в ${h(timeOnly(row.date_start))}`, {}];
}

function offlineArrivalTime(row) {
  const value = String(row.guest_arrival_at || '').trim();
  if (isValidDate(value)) {
    return timeOnly(value);
  }
  if (isValidDate(row.date_start)) {
    return timeOnly(shiftDate(row.date_start, -30 * 60 * 1000));
  }
  return timeOnlySafe(null);
}

function validPersonalFacecastUrl(row) {
  const registration = {
    facecast_url: row.facecast_url,
    facecast_password: row.facecast_password,
  };
  const event = {
    id: row.event_id,
    facecast_event_id: row.facecast_event_id,
    facecast_url: row.event_facecast_url,
  };
  const person = {
    id: row.person_id,
    telegram_id: row.telegram_id,
    email: row.email,
  };

  return facecast.isExistingPersonalAccess(registration, event, person)
    ? String(row.facecast_url || '')
    : '';
}

function confirmKeyboard(registrationId) {
  return {
    inline_keyboard: [
      [{ text: 'Всё ок! Буду.', callback_data: `still_come:${registrationId}` }],
      [{ text: 'Планы поменялись, не смогу.', callback_data: `cant_come:${registrationId}` }],
    ],
  };
}

function onlineKeyboard(registrationId, url) {
  const buttons = [];
  if (url) {
    buttons.push([{ text: 'Персональная ссылка на эфир', url }]);
  }
  buttons.push([{ text: 'Напомнить доступ', callback_data: `credentials:${registrationId}` }]);
  buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

  return { inline_keyboard: buttons };
}

async function markScheduledSent(id) {
  await query(
    'UPDATE scheduled_messages SET sent_at = :now, updated_at = :now WHERE id = :id',
    { id, now: nowSql() },
  );
}

async function markScheduledFailed(id, error) {
  await query(
    'UPDATE scheduled_messages SET failed_at = :now, error = :error, updated_at = :now WHERE id = :id',
    { id, error: error.message, now: nowSql() },
  );
}

async function recordScheduledOutgoing(row, text, status, error = null) {
  if (String(row.type || '') !== 'offline_approved') {
    return;
  }

  const personId = Number(row.person_id || 0);
  const telegramId = Number(row.telegram_id || 0);
  if (!personId || !telegramId || !String(text || '').trim()) {
    return;
  }

  try {
    await chat.recordOutgoing({
      personId,
      telegramId,
      text,
      messageType: 'bot',
      status,
      error: error?.message || null,
    });
  } catch (recordError) {
    logger.warn('failed to record scheduled bot message', {
      scheduledMessageId: row.id,
      personId,
      telegramId,
      message: recordError.message,
    });
  }
}

function scheduledMessageShouldRetry(row, error) {
  return RETRYABLE_SCHEDULED_TYPES.has(String(row.type || ''))
    && isTelegramRetryableError(error)
    && scheduledRetryAttempts(row) < MAX_TRANSACTIONAL_RETRY_ATTEMPTS;
}

async function rescheduleScheduledRetry(row, error) {
  const attempts = scheduledRetryAttempts(row) + 1;
  const retryAt = shiftDate(nowSql(), TRANSACTIONAL_RETRY_DELAY_MS);
  await query(
    `UPDATE scheduled_messages
     SET send_at = :sendAt,
         payload = :payload,
         failed_at = NULL,
         error = :error,
         updated_at = :now
     WHERE id = :id`,
    {
      id: row.id,
      sendAt: formatSqlDate(retryAt),
      payload: JSON.stringify({ attempts }),
      error: error.message,
      now: nowSql(),
    },
  );
}

function scheduledRetryAttempts(row) {
  try {
    const payload = JSON.parse(String(row.payload || '{}'));
    const attempts = Number(payload?.attempts || 0);
    return Number.isFinite(attempts) ? Math.max(0, attempts) : 0;
  } catch {
    return 0;
  }
}

async function refreshCampaignStatuses(rows) {
  const campaignIds = [...new Set(rows.map((row) => Number(row.campaign_id)).filter(Boolean))];

  for (const campaignId of campaignIds) {
    const stats = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM broadcast_messages
       WHERE campaign_id = :campaignId`,
      { campaignId },
    );
    const total = Number(stats[0]?.total || 0);
    const queued = Number(stats[0]?.queued || 0);
    const failed = Number(stats[0]?.failed || 0);
    const cancelled = Number(stats[0]?.cancelled || 0);
    if (queued > 0) {
      continue;
    }

    let status = 'sent';
    if (cancelled > 0 && cancelled === total) {
      status = 'cancelled';
    } else if (failed > 0) {
      status = 'failed';
    } else if (cancelled > 0) {
      status = 'cancelled';
    }
    await query(
      'UPDATE broadcast_campaigns SET status = :status, updated_at = :now WHERE id = :campaignId',
      { campaignId, status, now: nowSql() },
    );
  }
}
