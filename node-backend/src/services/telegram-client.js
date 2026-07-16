import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class TelegramApiError extends Error {
  constructor(method, responseStatus, payload = {}) {
    const description = String(payload.description || 'Unknown Telegram API error');
    super(`Telegram API error: ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.responseStatus = Number(responseStatus || 0);
    this.errorCode = Number(payload.error_code || 0);
    this.description = description;
    this.parameters = payload.parameters || null;
  }
}

export class TelegramClient {
  constructor({ webhookChatId = null, preferWebhookReply = false } = {}) {
    this.webhookChatId = webhookChatId;
    this.preferWebhookReply = preferWebhookReply;
    this.webhookReply = null;
  }

  consumeWebhookReply() {
    const reply = this.webhookReply;
    this.webhookReply = null;
    return reply;
  }

  async sendMessage(chatId, text, replyMarkup = {}, extra = {}) {
    const chunks = splitText(text);
    let result = null;

    for (const [index, chunk] of chunks.entries()) {
      const payload = {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
      };

      if (Object.keys(replyMarkup).length > 0 && index === chunks.length - 1) {
        payload.reply_markup = replyMarkup;
      }

      try {
        result = await this.api('sendMessage', payload);
      } catch (error) {
        if (!isTelegramParseError(error)) {
          throw error;
        }

        const plainPayload = {
          ...payload,
          text: telegramHtmlToPlainText(chunk),
        };
        delete plainPayload.parse_mode;
        logger.warn('telegram html rejected, retrying message as plain text', {
          chatId,
          description: error.description || error.message,
        });
        result = await this.api('sendMessage', plainPayload);
      }
    }

    return result;
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    return this.api('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });
  }

  async sendVenue(chatId, latitude, longitude, title, address) {
    return this.api('sendVenue', {
      chat_id: chatId,
      latitude,
      longitude,
      title,
      address,
    });
  }

  async sendPhoto(chatId, photo, caption = '', replyMarkup = {}, extra = {}) {
    const payload = {
      chat_id: chatId,
      parse_mode: 'HTML',
      ...extra,
    };

    if (caption) {
      payload.caption = caption;
    }

    if (Object.keys(replyMarkup).length > 0) {
      payload.reply_markup = replyMarkup;
    }

    if (isUploadFile(photo)) {
      return this.apiMultipart('sendPhoto', payload, 'photo', photo);
    }

    payload.photo = photo;
    return this.api('sendPhoto', payload);
  }

  async sendVideo(chatId, video, caption = '', replyMarkup = {}, extra = {}) {
    const payload = {
      chat_id: chatId,
      parse_mode: 'HTML',
      ...extra,
    };

    if (caption) {
      payload.caption = caption;
    }

    if (Object.keys(replyMarkup).length > 0) {
      payload.reply_markup = replyMarkup;
    }

    if (isUploadFile(video)) {
      return this.apiMultipart('sendVideo', payload, 'video', video);
    }

    payload.video = video;
    return this.api('sendVideo', payload);
  }

  async sendDocument(chatId, document, caption = '', replyMarkup = {}, extra = {}) {
    const payload = {
      chat_id: chatId,
      parse_mode: 'HTML',
      ...extra,
    };

    if (caption) {
      payload.caption = caption;
    }

    if (Object.keys(replyMarkup).length > 0) {
      payload.reply_markup = replyMarkup;
    }

    if (isUploadFile(document)) {
      return this.apiMultipart('sendDocument', payload, 'document', document);
    }

    payload.document = document;
    return this.api('sendDocument', payload);
  }

  async sendVideoNote(chatId, videoNote, replyMarkup = {}, extra = {}) {
    const payload = {
      chat_id: chatId,
      ...extra,
    };

    if (Object.keys(replyMarkup).length > 0) {
      payload.reply_markup = replyMarkup;
    }

    if (isUploadFile(videoNote)) {
      return this.apiMultipart('sendVideoNote', payload, 'video_note', videoNote);
    }

    payload.video_note = videoNote;
    return this.api('sendVideoNote', payload);
  }

  async api(method, payload) {
    if (this.preferWebhookReply && this.queueWebhookReply(method, payload)) {
      return { ok: true, result: { webhook_reply: true } };
    }

    if (config.telegram.dryRun) {
      logger.info(`telegram dry run: ${method}`, payload);
      return { ok: true, result: { dry_run: true } };
    }

    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is empty');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
        method: 'POST',
        body: new URLSearchParams(serializeTelegramPayload(payload)),
        signal: controller.signal,
      });
      const decoded = await response.json();
      if (!decoded.ok) {
        throw new TelegramApiError(method, response.status, decoded);
      }
      return decoded;
    } finally {
      clearTimeout(timeout);
    }
  }

  async apiMultipart(method, payload, fileField, file) {
    if (config.telegram.dryRun) {
      logger.info(`telegram dry run multipart: ${method}`, {
        ...payload,
        [fileField]: {
          filename: file.filename || 'media.bin',
          mimeType: file.mimeType || 'application/octet-stream',
          size: file.size || file.buffer?.length || 0,
        },
      });
      return { ok: true, result: { dry_run: true } };
    }

    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is empty');
    }

    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || []);
    const formData = new FormData();
    for (const [key, value] of Object.entries(serializeTelegramPayload(payload))) {
      formData.append(key, value);
    }
    formData.append(
      fileField,
      new Blob([buffer], { type: file.mimeType || 'application/octet-stream' }),
      file.filename || 'media.bin',
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      const decoded = await response.json();
      if (!decoded.ok) {
        throw new TelegramApiError(method, response.status, decoded);
      }
      return decoded;
    } finally {
      clearTimeout(timeout);
    }
  }

  queueWebhookReply(method, payload) {
    if (method === 'answerCallbackQuery') {
      return true;
    }

    if (!['sendMessage', 'sendVenue'].includes(method)) {
      return false;
    }

    const chatId = payload.chat_id;
    if (this.webhookChatId !== null && String(chatId) !== String(this.webhookChatId)) {
      logger.warn(`skipped webhook reply for another chat: ${method}`, { chatId });
      return true;
    }

    const reply = { method, ...payload };
    if (this.webhookReply?.method === 'sendMessage' && method === 'sendMessage') {
      this.webhookReply.text = `${this.webhookReply.text}\n\n${reply.text}`.trim();
      if (reply.reply_markup) {
        this.webhookReply.reply_markup = reply.reply_markup;
      }
      return true;
    }

    if (!this.webhookReply) {
      this.webhookReply = reply;
    } else {
      logger.warn(`skipped extra webhook reply: ${method}`);
    }

    return true;
  }
}

export function isTelegramParseError(error) {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }

  const description = error.description.toLowerCase();
  return description.includes("can't parse entities")
    || description.includes('cannot parse entities')
    || description.includes('unsupported start tag')
    || description.includes('unsupported end tag');
}

export function isTelegramRetryableError(error) {
  if (!(error instanceof TelegramApiError)) {
    return true;
  }

  if (error.errorCode === 429 || error.responseStatus === 429) {
    return true;
  }
  if (error.errorCode >= 500 || error.responseStatus >= 500) {
    return true;
  }

  return false;
}

export function telegramDeliveryErrorMessage(error) {
  if (!(error instanceof TelegramApiError)) {
    return 'Telegram временно недоступен. Сообщение можно повторить позже.';
  }

  const description = error.description.toLowerCase();
  if (description.includes('bot was blocked by the user')) {
    return 'Пользователь заблокировал бота. Telegram не сможет доставить ему подтверждение, пока он не разблокирует бота.';
  }
  if (description.includes('chat not found')) {
    return 'Telegram не нашёл чат участника. Попросите его снова открыть бота и нажать /start.';
  }
  if (description.includes('user is deactivated')) {
    return 'Telegram-аккаунт участника деактивирован, поэтому сообщение доставить нельзя.';
  }
  if (error.errorCode === 429) {
    return 'Telegram временно ограничил частоту отправки. Подтверждение поставлено в очередь.';
  }

  return `Telegram отклонил сообщение: ${error.description}`;
}

function isUploadFile(value) {
  return Boolean(value && typeof value === 'object' && value.buffer);
}

function serializeTelegramPayload(payload) {
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }
    result[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return result;
}

function splitText(text) {
  if (text.length <= 3900) {
    return [text];
  }

  const chunks = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    if (`${current}\n${line}`.length > 3900) {
      chunks.push(current);
      current = line;
    } else {
      current += `${current ? '\n' : ''}${line}`;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function telegramHtmlToPlainText(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&amp;/g, '&');
}
