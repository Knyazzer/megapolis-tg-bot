import { execute } from '../db/mysql.js';
import { nowSql } from '../utils/dates.js';

export class ChatRepository {
  async recordIncoming({ personId, telegramId, text, messageType = 'text' }) {
    await execute(
      `INSERT INTO chat_messages
       (person_id, telegram_id, direction, message_type, text, status, created_at)
       VALUES (:personId, :telegramId, 'in', :messageType, :text, 'received', :now)`,
      {
        personId,
        telegramId,
        messageType,
        text: normalizeChatText(text),
        now: nowSql(),
      },
    );
  }

  async recordOutgoing({ personId, telegramId, text, status = 'sent', error = null }) {
    const now = nowSql();
    await execute(
      `INSERT INTO chat_messages
       (person_id, telegram_id, direction, message_type, text, status, error, sent_at, created_at)
       VALUES (:personId, :telegramId, 'out', 'text', :text, :status, :error, :sentAt, :now)`,
      {
        personId,
        telegramId,
        text: normalizeChatText(text),
        status,
        error,
        sentAt: status === 'sent' ? now : null,
        now,
      },
    );
  }
}

function normalizeChatText(text) {
  const value = String(text || '').trim();
  return value === '' ? null : value;
}
