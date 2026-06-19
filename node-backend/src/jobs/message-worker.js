import { query } from '../db/mysql.js';
import { FacecastClient } from '../services/facecast-client.js';
import { TelegramClient } from '../services/telegram-client.js';
import { dateShort, nowSql, timeOnly, timeRange } from '../utils/dates.js';
import { h } from '../utils/html.js';
import { logger } from '../utils/logger.js';

const facecast = new FacecastClient();

export async function processDueMessages({ limit = 50 } = {}) {
  const telegram = new TelegramClient();
  const scheduled = await processScheduledMessages(telegram, limit);
  const broadcasts = await processBroadcastMessages(telegram, Math.max(limit, 60));
  return { scheduled, broadcasts };
}

async function processScheduledMessages(telegram, limit) {
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
       e.online_start,
       e.address,
       e.facecast_event_id,
       e.facecast_url AS event_facecast_url,
       e.recording_url,
       e.photo_album_url
     FROM scheduled_messages sm
     JOIN people p ON p.id = sm.person_id
     LEFT JOIN registrations r ON r.id = sm.registration_id
     LEFT JOIN events e ON e.id = sm.event_id
     WHERE sm.sent_at IS NULL
       AND sm.failed_at IS NULL
       AND sm.send_at <= CURRENT_TIMESTAMP
     ORDER BY sm.send_at ASC
     LIMIT :limit`,
    { limit },
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (scheduledMessageIsStale(row)) {
        await markScheduledSent(row.id);
        skipped += 1;
        continue;
      }

      const [text, keyboard] = scheduledMessagePayload(row);
      await telegram.sendMessage(Number(row.telegram_id), text, keyboard);
      await markScheduledSent(row.id);
      sent += 1;
    } catch (error) {
      await markScheduledFailed(row.id, error);
      failed += 1;
      logger.warn('scheduled message failed', { id: row.id, message: error.message });
    }
  }

  return { picked: rows.length, sent, skipped, failed };
}

async function processBroadcastMessages(telegram, limit) {
  const rows = await query(
    `SELECT bm.*, c.content_type, c.body, c.media_file_id, c.id AS campaign_id
     FROM broadcast_messages bm
     JOIN broadcast_campaigns c ON c.id = bm.campaign_id
     WHERE bm.status = 'queued'
     ORDER BY bm.id ASC
     LIMIT :limit`,
    { limit },
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (row.content_type === 'video_note' && row.media_file_id) {
        await telegram.sendVideoNote(Number(row.telegram_id), String(row.media_file_id));
      } else if (row.content_type === 'photo' && row.media_file_id) {
        await telegram.sendPhoto(Number(row.telegram_id), String(row.media_file_id), String(row.body || ''));
        row.body = '';
      }

      if (String(row.body || '').trim() !== '') {
        await telegram.sendMessage(Number(row.telegram_id), String(row.body));
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

function scheduledMessageIsStale(row) {
  const type = String(row.type || '');
  const attendance = String(row.attendance || '');
  const status = String(row.status || '');

  if (row.archived_at) {
    return true;
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

  if (type === 'postpromo') {
    return !['approved', 'visited'].includes(status);
  }

  return false;
}

function scheduledMessagePayload(row) {
  const url = validPersonalFacecastUrl(row);
  const eventTitle = String(row.title || 'мероприятие');
  const date = dateShort(row.date_start);
  const range = timeRange(row.date_start, row.date_end);
  const registrationId = Number(row.registration_id);

  if (row.type === 'offline_1day') {
    return [
      'Напоминаем о встрече завтра 🏢\n\n'
        + 'Будем рады видеть вас на площадке:\n'
        + `<b>Название:</b> ${h(eventTitle)}\n`
        + `<b>Дата:</b> ${h(date)}\n`
        + `<b>Время:</b> ${h(range)}\n`
        + `<b>Адрес:</b> ${h(row.address || '')}\n`
        + '<b>Формат:</b> офлайн',
      confirmKeyboard(registrationId),
    ];
  }

  if (row.type === 'offline_2hours') {
    return [
      'До офлайн-встречи осталось около двух часов 🙂\n\n'
        + 'Пожалуйста, заложите время на дорогу и ресепшн.\n\n'
        + `<b>Название:</b> ${h(eventTitle)}\n`
        + `<b>Дата:</b> ${h(date)}\n`
        + `<b>Время:</b> ${h(range)}\n`
        + `<b>Адрес:</b> ${h(row.address || '')}\n`
        + '<b>Формат:</b> офлайн',
      confirmKeyboard(registrationId),
    ];
  }

  if (row.type === 'offline_started') {
    return [
      'Начинаем! Рады видеть вас на мероприятии ✨\n\nЖелаем хорошего настроя, полезных знакомств и живого разговора.',
      {},
    ];
  }

  if (row.type === 'online_15min') {
    return ['Напоминаем про эфир: начинаем через 15 минут 💻', onlineKeyboard(registrationId, url)];
  }

  if (row.type === 'online_started') {
    return [
      'Мы начали! Добро пожаловать в прямой эфир 💻\n\nЗадавайте вопросы спикерам в чате трансляции.',
      onlineKeyboard(registrationId, url),
    ];
  }

  if (row.type === 'postpromo') {
    return [postpromoText(row), postpromoKeyboard(row, url)];
  }

  return [`Напоминание о мероприятии: ${h(eventTitle)} в ${h(timeOnly(row.date_start))}`, {}];
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

function postpromoText(row) {
  let text = 'Спасибо, что были с нами ✨\n\nДелимся материалами и яркими моментами прошедшего мероприятия.';

  if (row.recording_url) {
    text += '\n\nТакже можно посмотреть запись эфира, если хочется вернуться к главным мыслям.';
  }

  return `${text}\n\n<b>Название:</b> ${h(row.title || '')}`;
}

function postpromoKeyboard(row, url) {
  const buttons = [];
  if (url) {
    buttons.push([{ text: 'Персональная ссылка на эфир', url }]);
  }
  if (row.photo_album_url) {
    buttons.push([{ text: 'Подборка фото', url: String(row.photo_album_url) }]);
  }
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

async function refreshCampaignStatuses(rows) {
  const campaignIds = [...new Set(rows.map((row) => Number(row.campaign_id)).filter(Boolean))];

  for (const campaignId of campaignIds) {
    const pending = await query(
      "SELECT COUNT(*) AS total FROM broadcast_messages WHERE campaign_id = :campaignId AND status = 'queued'",
      { campaignId },
    );
    if (Number(pending[0]?.total || 0) > 0) {
      continue;
    }

    const failed = await query(
      "SELECT COUNT(*) AS total FROM broadcast_messages WHERE campaign_id = :campaignId AND status = 'failed'",
      { campaignId },
    );
    const status = Number(failed[0]?.total || 0) > 0 ? 'failed' : 'sent';
    await query(
      'UPDATE broadcast_campaigns SET status = :status, updated_at = :now WHERE id = :campaignId',
      { campaignId, status, now: nowSql() },
    );
  }
}
