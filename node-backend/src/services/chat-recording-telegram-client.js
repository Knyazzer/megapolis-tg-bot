import { queryOne } from '../db/mysql.js';
import { ChatRepository } from '../repositories/chat-repository.js';
import { logger } from '../utils/logger.js';

export class ChatRecordingTelegramClient {
  constructor(telegram) {
    this.telegram = telegram;
    this.chat = new ChatRepository();
  }

  consumeWebhookReply() {
    return this.telegram.consumeWebhookReply();
  }

  async sendMessage(chatId, text, replyMarkup = {}, extra = {}) {
    return this.withRecording({
      chatId,
      text,
      messageType: 'bot',
      send: () => this.telegram.sendMessage(chatId, text, replyMarkup, extra),
    });
  }

  async sendVenue(chatId, latitude, longitude, title, address) {
    return this.withRecording({
      chatId,
      text: [title, address].filter(Boolean).join('\n'),
      messageType: 'bot_venue',
      send: () => this.telegram.sendVenue(chatId, latitude, longitude, title, address),
    });
  }

  async sendPhoto(chatId, photo, caption = '', replyMarkup = {}, extra = {}) {
    return this.withRecording({
      chatId,
      text: caption || 'Картинка',
      messageType: 'bot_photo',
      mediaFileId: typeof photo === 'string' ? photo : null,
      mediaName: typeof photo === 'string' ? 'photo' : photo?.filename || 'photo',
      mediaMime: typeof photo === 'string' ? null : photo?.mimeType || null,
      send: () => this.telegram.sendPhoto(chatId, photo, caption, replyMarkup, extra),
    });
  }

  async sendVideo(chatId, video, caption = '', replyMarkup = {}, extra = {}) {
    return this.withRecording({
      chatId,
      text: caption || 'Видео',
      messageType: 'bot_video',
      mediaFileId: typeof video === 'string' ? video : null,
      mediaName: typeof video === 'string' ? 'video' : video?.filename || 'video',
      mediaMime: typeof video === 'string' ? null : video?.mimeType || null,
      send: () => this.telegram.sendVideo(chatId, video, caption, replyMarkup, extra),
    });
  }

  async sendVideoNote(chatId, videoNote, replyMarkup = {}, extra = {}) {
    return this.withRecording({
      chatId,
      text: 'Кружок',
      messageType: 'bot_video_note',
      mediaFileId: typeof videoNote === 'string' ? videoNote : null,
      mediaName: typeof videoNote === 'string' ? 'video_note' : videoNote?.filename || 'video_note',
      mediaMime: typeof videoNote === 'string' ? null : videoNote?.mimeType || null,
      send: () => this.telegram.sendVideoNote(chatId, videoNote, replyMarkup, extra),
    });
  }

  async sendDocument(chatId, document, caption = '', replyMarkup = {}, extra = {}) {
    return this.withRecording({
      chatId,
      text: caption || 'Файл',
      messageType: 'bot_document',
      mediaFileId: typeof document === 'string' ? document : null,
      mediaName: typeof document === 'string' ? 'document' : document?.filename || 'document',
      mediaMime: typeof document === 'string' ? null : document?.mimeType || null,
      send: () => this.telegram.sendDocument(chatId, document, caption, replyMarkup, extra),
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    return this.telegram.answerCallbackQuery(callbackQueryId, text);
  }

  async withRecording({ chatId, text, messageType, mediaFileId = null, mediaName = null, mediaMime = null, send }) {
    let result = null;
    try {
      result = await send();
      await this.record({
        chatId,
        text,
        messageType,
        mediaFileId,
        mediaName,
        mediaMime,
        status: 'sent',
      });
      return result;
    } catch (error) {
      await this.record({
        chatId,
        text,
        messageType,
        mediaFileId,
        mediaName,
        mediaMime,
        status: 'failed',
        error: error.message,
      });
      throw error;
    }
  }

  async record({ chatId, text, messageType, mediaFileId, mediaName, mediaMime, status, error = null }) {
    const telegramId = Number(chatId || 0);
    if (!telegramId) {
      return;
    }

    try {
      const person = await queryOne('SELECT id FROM people WHERE telegram_id = :telegramId LIMIT 1', { telegramId });
      if (!person) {
        return;
      }

      await this.chat.recordOutgoing({
        personId: person.id,
        telegramId,
        text,
        messageType,
        mediaFileId,
        mediaName,
        mediaMime,
        status,
        error,
      });
    } catch (recordError) {
      logger.warn('failed to record bot chat message', { telegramId, message: recordError.message });
    }
  }
}
