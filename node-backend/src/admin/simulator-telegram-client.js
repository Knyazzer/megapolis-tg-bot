export class SimulatorTelegramClient {
  constructor({ history, captureChatId = null, fallback = null }) {
    this.history = history;
    this.captureChatId = captureChatId === null ? null : Number(captureChatId);
    this.fallback = fallback;
  }

  async sendMessage(chatId, text, replyMarkup = {}, extra = {}) {
    if (!this.shouldCapture(chatId)) {
      return this.fallback?.sendMessage(chatId, text, replyMarkup, extra) || ok();
    }

    this.push({
      direction: 'bot',
      type: 'message',
      text: String(text || ''),
      replyMarkup,
    });
    return ok();
  }

  async answerCallbackQuery() {
    return ok();
  }

  async sendVenue(chatId, latitude, longitude, title, address) {
    if (!this.shouldCapture(chatId)) {
      return this.fallback?.sendVenue(chatId, latitude, longitude, title, address) || ok();
    }

    this.push({
      direction: 'bot',
      type: 'venue',
      text: `${title}\n${address}`,
      venue: { latitude, longitude, title, address },
    });
    return ok();
  }

  async sendPhoto(chatId, photo, caption = '', replyMarkup = {}, extra = {}) {
    if (!this.shouldCapture(chatId)) {
      return this.fallback?.sendPhoto(chatId, photo, caption, replyMarkup, extra) || ok();
    }

    this.push({
      direction: 'bot',
      type: 'photo',
      text: caption || 'Картинка',
      media: String(photo || ''),
      replyMarkup,
    });
    return ok();
  }

  async sendVideoNote(chatId, videoNote, replyMarkup = {}, extra = {}) {
    if (!this.shouldCapture(chatId)) {
      return this.fallback?.sendVideoNote(chatId, videoNote, replyMarkup, extra) || ok();
    }

    this.push({
      direction: 'bot',
      type: 'video_note',
      text: 'Кружок',
      media: String(videoNote || ''),
      replyMarkup,
    });
    return ok();
  }

  shouldCapture(chatId) {
    return this.captureChatId === null || Number(chatId) === this.captureChatId;
  }

  push(entry) {
    this.history.push({
      id: `${Date.now()}-${this.history.length + 1}`,
      at: new Date().toISOString(),
      ...entry,
    });
  }
}

function ok() {
  return { ok: true, result: { simulator: true } };
}
