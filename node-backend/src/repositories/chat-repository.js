import { execute } from '../db/mysql.js';
import { nowSql } from '../utils/dates.js';

export class ChatRepository {
  async recordIncoming({ personId, telegramId, text, messageType = 'text', mediaFileId = null, mediaName = null, mediaMime = null }) {
    await execute(
      `INSERT INTO chat_messages
       (person_id, telegram_id, direction, message_type, text, media_file_id, media_name, media_mime, status, created_at)
       VALUES (:personId, :telegramId, 'in', :messageType, :text, :mediaFileId, :mediaName, :mediaMime, 'received', :now)`,
      {
        personId,
        telegramId,
        messageType,
        text: normalizeChatText(text),
        mediaFileId,
        mediaName,
        mediaMime,
        now: nowSql(),
      },
    );
  }

  async recordOutgoing({
    personId,
    telegramId,
    text,
    messageType = 'text',
    mediaFileId = null,
    mediaName = null,
    mediaMime = null,
    status = 'sent',
    error = null,
  }) {
    const now = nowSql();
    await execute(
      `INSERT INTO chat_messages
       (person_id, telegram_id, direction, message_type, text, media_file_id, media_name, media_mime, status, error, sent_at, created_at)
       VALUES (:personId, :telegramId, 'out', :messageType, :text, :mediaFileId, :mediaName, :mediaMime, :status, :error, :sentAt, :now)`,
      {
        personId,
        telegramId,
        messageType,
        text: normalizeChatText(text),
        mediaFileId,
        mediaName,
        mediaMime,
        status,
        error,
        sentAt: status === 'sent' ? now : null,
        now,
      },
    );
  }

  async setHumanMode(personId) {
    await execute(
      "UPDATE people SET chat_mode = 'human', chat_mode_updated_at = :now, updated_at = :now WHERE id = :personId",
      { personId, now: nowSql() },
    );
  }

  async setBotMode(personId) {
    await execute(
      "UPDATE people SET chat_mode = 'bot', chat_mode_updated_at = :now, updated_at = :now WHERE id = :personId",
      { personId, now: nowSql() },
    );
  }

  async markRead(personId) {
    await execute(
      'UPDATE people SET chat_read_at = :now, updated_at = :now WHERE id = :personId',
      { personId, now: nowSql() },
    );
  }
}

function normalizeChatText(text) {
  const value = String(text || '').trim();
  return value === '' ? null : value;
}
