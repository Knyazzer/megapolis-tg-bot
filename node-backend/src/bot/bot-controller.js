import { config } from '../config.js';
import {
  eventFormatLabel,
  eventSupportsOffline,
  eventSupportsOnline,
  EventsRepository,
} from '../repositories/events-repository.js';
import { PeopleRepository, profileComplete } from '../repositories/people-repository.js';
import { RegistrationsRepository } from '../repositories/registrations-repository.js';
import { RecordingAccessesRepository } from '../repositories/recording-accesses-repository.js';
import { GiveawaysRepository } from '../repositories/giveaways-repository.js';
import { ChatRepository } from '../repositories/chat-repository.js';
import { FacecastClient } from '../services/facecast-client.js';
import { ReminderPlanner } from '../services/reminder-planner.js';
import { TelegramClient } from '../services/telegram-client.js';
import { dateShort, nowSql, shiftDate, timeOnly, timeRange } from '../utils/dates.js';
import { h } from '../utils/html.js';
import { logger } from '../utils/logger.js';
import {
  consentKeyboard,
  eventsMenuKeyboard,
  inlineKeyboard,
  mainMenuKeyboard,
  phoneKeyboard,
  removeKeyboard,
  startRegistrationKeyboard,
} from './keyboards.js';

const ACTIVE_OFFLINE_STATUSES = new Set(['pending', 'approved', 'visited']);

export class BotController {
  constructor({ telegram }) {
    this.telegram = telegram;
    this.outboundTelegram = new TelegramClient();
    this.people = new PeopleRepository();
    this.events = new EventsRepository();
    this.registrations = new RegistrationsRepository();
    this.recordingAccesses = new RecordingAccessesRepository();
    this.giveaways = new GiveawaysRepository();
    this.chat = new ChatRepository();
    this.facecast = new FacecastClient();
    this.planner = new ReminderPlanner();
  }

  async handle(update) {
    try {
      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
        return;
      }

      if (update.message) {
        await this.handleMessage(update.message);
      }
    } catch (error) {
      logger.error('bot error', { message: error.message, stack: error.stack });
    }
  }

  async handleMessage(message) {
    const from = message.from || {};
    const chatId = Number(message.chat?.id || from.id || 0);
    if (!from.id || !chatId) {
      return;
    }

    const person = await this.people.upsertFromTelegram(from);
    const text = String(message.text || '').trim();
    const messageText = String(message.text || message.caption || '').trim();
    const state = String(person.state || 'new');
    const delayCreativeBriefRecord = this.shouldDelayCreativeBriefRecord(person, state, text, messageText);
    if (!delayCreativeBriefRecord) {
      await this.recordIncomingChatMessage(person, chatId, message);
    }

    if (this.isAdminTelegramId(from.id)) {
      const media = this.adminMediaFileId(message);
      if (media) {
        await this.telegram.sendMessage(chatId, `File ID ${h(media.label)}:\n<code>${h(media.fileId)}</code>\n\nВставьте это значение в поле «Медиа» в рассылке.`);
        return;
      }
    }

    if (this.isHumanChatMode(person)) {
      return;
    }

    if (this.isMainMenuText(text)) {
      const menuPerson = await this.restoreCreativeBriefStateIfNeeded(person);
      await this.sendWelcomeOrMenu(chatId, menuPerson);
      return;
    }

    if (text === '/menu') {
      await this.restoreCreativeBriefStateIfNeeded(person);
      await this.sendMainMenu(chatId);
      return;
    }

    if (this.isCreativeIdeaText(text)) {
      await this.startCreativeBrief(chatId, person);
      return;
    }

    if (this.isCreativeBriefState(state)) {
      await this.receiveCreativeBrief(chatId, person, message);
      return;
    }

    if (this.isStartRegistrationText(text)) {
      if (profileComplete(person)) {
        await this.sendMainMenu(chatId);
        return;
      }

      if (person.consent_accepted_at) {
        await this.sendCurrentProfilePrompt(chatId, person);
        return;
      }

      await this.people.setState(person.id, 'awaiting_consent');
      await this.sendConsent(chatId);
      return;
    }

    if (this.isConsentText(text) && !profileComplete(person)) {
      if (!person.consent_accepted_at || ['new', 'awaiting_consent'].includes(state)) {
        await this.acceptConsentAndAskName(chatId, person);
      } else {
        await this.sendCurrentProfilePrompt(chatId, person);
      }
      return;
    }

    if (this.isEventsText(text)) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendEvents(chatId);
      return;
    }

    if (this.isRecordingsArchiveText(text)) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendRecordingsArchive(chatId);
      return;
    }

    if (this.isGiveawayText(text)) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendGiveaways(chatId, person);
      return;
    }

    if (this.isSocialsText(text)) {
      await this.sendSocialLinks(chatId);
      return;
    }

    if (this.isMyRegistrationsText(text)) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendMyRegistrations(chatId, person);
      return;
    }

    if (!profileComplete(person)) {
      await this.continueRegistration(chatId, person, message);
      return;
    }

    await this.sendMainMenu(chatId);
  }

  async handleCallback(callback) {
    const from = callback.from || {};
    const message = callback.message || {};
    const chatId = Number(message.chat?.id || from.id || 0);
    const data = String(callback.data || '');

    if (callback.id) {
      await this.telegram.answerCallbackQuery(callback.id);
    }

    if (!chatId || !from.id) {
      return;
    }

    const person = await this.people.upsertFromTelegram(from);

    if (data === 'start_registration') {
      await this.people.setState(person.id, 'awaiting_consent');
      await this.sendConsent(chatId);
      return;
    }

    if (data === 'consent_accept') {
      await this.acceptConsentAndAskName(chatId, person);
      return;
    }

    if (data === 'main_menu') {
      await this.sendMainMenu(chatId);
      return;
    }

    if (data === 'events') {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendEvents(chatId);
      return;
    }

    if (data === 'recordings_archive') {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendRecordingsArchive(chatId);
      return;
    }

    if (data === 'giveaways') {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      await this.sendGiveaways(chatId, person);
      return;
    }

    if (data.startsWith('giveaway:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const giveaway = await this.giveaways.findActiveById(Number(data.slice(9)));
      if (giveaway) {
        await this.sendGiveawayDetails(chatId, person, giveaway);
      } else {
        await this.sendGiveawayUnavailable(chatId);
      }
      return;
    }

    if (data.startsWith('giveaway_enter:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const giveaway = await this.giveaways.findActiveById(Number(data.slice(15)));
      if (giveaway) {
        await this.enterGiveaway(chatId, person, giveaway);
      } else {
        await this.sendGiveawayUnavailable(chatId);
      }
      return;
    }

    if (data.startsWith('recording_event:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const event = await this.events.findRecordingById(Number(data.slice(16)));
      if (event) {
        await this.sendRecordingDetails(chatId, event);
      } else {
        await this.sendRecordingUnavailable(chatId);
      }
      return;
    }

    if (data.startsWith('recording_access:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const event = await this.events.findRecordingById(Number(data.slice(17)));
      if (event) {
        await this.registerRecordingAccess(chatId, person, event);
      } else {
        await this.sendRecordingUnavailable(chatId);
      }
      return;
    }

    if (data.startsWith('event:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const event = await this.events.findById(Number(data.slice(6)));
      if (event) {
        await this.sendEventDetails(chatId, event);
      }
      return;
    }

    if (data.startsWith('reg_online:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const event = await this.events.findById(Number(data.slice(11)));
      if (event) {
        await this.registerOnline(chatId, person, event);
      }
      return;
    }

    if (data.startsWith('reg_offline:')) {
      if (!(await this.ensureProfileReady(chatId, person))) {
        return;
      }
      const event = await this.events.findById(Number(data.slice(12)));
      if (event) {
        await this.registerOffline(chatId, person, event);
      }
      return;
    }

    if (data.startsWith('cant_come:')) {
      await this.switchRegistrationToOnline(chatId, person, Number(data.slice(10)));
      return;
    }

    if (data.startsWith('still_come:')) {
      await this.telegram.sendMessage(chatId, 'Отлично, держим вас в списке гостей. Ждём на площадке 🙂');
      return;
    }

    if (data.startsWith('credentials:')) {
      const registration = await this.registrations.findById(Number(data.slice(12)));
      if (registration && Number(registration.person_id) === Number(person.id)) {
        const event = await this.events.findById(Number(registration.event_id));
        if (event) {
          if (
            registration.attendance === 'offline' &&
            ACTIVE_OFFLINE_STATUSES.has(String(registration.status || ''))
          ) {
            await this.ensureOfflineBackupOnlineAccess(chatId, person, event, registration);
            return;
          }
          if (
            registration.attendance === 'online' &&
            registration.status === 'approved' &&
            !this.facecast.isExistingPersonalAccess(registration, event, person)
          ) {
            await this.registerOnline(chatId, person, event);
            return;
          }
          await this.sendOnlineAccess(chatId, event, registration);
        }
      }
    }
  }

  async continueRegistration(chatId, person, message) {
    const state = String(person.state || 'new');
    const text = String(message.text || '').trim();

    if (state === 'new') {
      await this.sendWelcome(chatId);
      return;
    }

    if (state === 'awaiting_consent') {
      if (this.isConsentText(text)) {
        await this.acceptConsentAndAskName(chatId, person);
        return;
      }

      await this.sendConsent(chatId);
      return;
    }

    if (state === 'ask_name') {
      if (text.length < 2) {
        await this.telegram.sendMessage(chatId, '<b>Анкета, шаг 1 из 5</b>\n\nНапишите, пожалуйста, имя и фамилию текстом, чтобы мы корректно оформили регистрацию.', removeKeyboard());
        return;
      }
      await this.people.updateFields(person.id, { full_name: text });
      await this.people.setState(person.id, 'ask_company');
      await this.telegram.sendMessage(chatId, '<b>Шаг 2 из 5</b>\n\nИз какой вы компании?', removeKeyboard());
      return;
    }

    if (state === 'ask_company') {
      await this.people.updateFields(person.id, { company: text });
      await this.people.setState(person.id, 'ask_position');
      await this.telegram.sendMessage(chatId, '<b>Шаг 3 из 5</b>\n\nА какая у вас должность?', removeKeyboard());
      return;
    }

    if (state === 'ask_position') {
      await this.people.updateFields(person.id, { position_title: text });
      await this.people.setState(person.id, 'ask_phone');
      await this.telegram.sendMessage(chatId, '<b>Шаг 4 из 5</b>\n\nПоделитесь, пожалуйста, номером телефона. Можно отправить его кнопкой ниже.', phoneKeyboard());
      return;
    }

    if (state === 'ask_phone') {
      const phone = String(message.contact?.phone_number || text);
      if (!message.contact && this.isPhoneButtonText(text)) {
        await this.telegram.sendMessage(chatId, 'Нажмите кнопку ниже, чтобы Telegram передал номер, или напишите телефон текстом.', phoneKeyboard());
        return;
      }

      if (phone.length < 6) {
        await this.telegram.sendMessage(chatId, 'Кажется, это не номер телефона. Пришлите номер текстом или кнопкой, пожалуйста.', phoneKeyboard());
        return;
      }
      await this.people.updateFields(person.id, { phone });
      await this.people.setState(person.id, 'ask_email');
      await this.telegram.sendMessage(chatId, '<b>Шаг 5 из 5</b>\n\nИ последний шаг: напишите вашу почту.', removeKeyboard());
      return;
    }

    if (state === 'ask_email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        await this.telegram.sendMessage(chatId, 'Почта выглядит непривычно. Напишите email в формате name@example.com.', removeKeyboard());
        return;
      }
      await this.people.updateFields(person.id, { email: text.toLowerCase() });
      await this.people.setState(person.id, 'registered');
      await this.telegram.sendMessage(chatId, '<b>Готово, спасибо!</b> ✨\n\nАнкета собрана. Теперь можно выбрать мероприятие.', eventsMenuKeyboard());
      return;
    }

    await this.sendMainMenu(chatId);
  }

  async sendCurrentProfilePrompt(chatId, person) {
    const state = String(person.state || 'new');

    if (state === 'ask_name') {
      await this.telegram.sendMessage(chatId, '<b>Согласие принято.</b>\n\nНапишите, пожалуйста, имя и фамилию.', removeKeyboard());
      return;
    }

    if (state === 'ask_company') {
      await this.telegram.sendMessage(chatId, '<b>Согласие принято.</b>\n\nИз какой вы компании?', removeKeyboard());
      return;
    }

    if (state === 'ask_position') {
      await this.telegram.sendMessage(chatId, '<b>Согласие принято.</b>\n\nА какая у вас должность?', removeKeyboard());
      return;
    }

    if (state === 'ask_phone') {
      await this.telegram.sendMessage(chatId, '<b>Согласие принято.</b>\n\nПоделитесь, пожалуйста, номером телефона.', phoneKeyboard());
      return;
    }

    if (state === 'ask_email') {
      await this.telegram.sendMessage(chatId, '<b>Согласие принято.</b>\n\nНапишите вашу почту.', removeKeyboard());
      return;
    }

    await this.sendWelcome(chatId);
  }

  async sendWelcomeOrMenu(chatId, person) {
    if (profileComplete(person)) {
      await this.sendMainMenu(chatId);
      return;
    }

    if (person.consent_accepted_at) {
      await this.sendCurrentProfilePrompt(chatId, person);
      return;
    }

    await this.sendWelcome(chatId);
  }

  async sendWelcome(chatId) {
    const text = '<b>Мегаполис Медиа на связи 👋</b>\n\n'
      + 'Здесь можно зарегистрироваться на митапы, эфиры и деловые встречи.\n\n'
      + 'Сначала коротко познакомимся: это нужно для регистрации, допуска к эфиру и связи с вами. Анкета без марафона, обещаем 🙂';

    await this.telegram.sendMessage(chatId, text, startRegistrationKeyboard());
  }

  async sendConsent(chatId) {
    await this.telegram.sendMessage(chatId, this.consentText(), consentKeyboard());
  }

  async acceptConsentAndAskName(chatId, person) {
    await this.people.acceptConsent(person.id);
    await this.people.setState(person.id, 'ask_name');
    await this.telegram.sendMessage(chatId, '<b>Спасибо!</b>\n\nДавайте познакомимся 🙂 Напишите, пожалуйста, имя и фамилию.', removeKeyboard());
  }

  async sendMainMenu(chatId) {
    await this.telegram.sendMessage(chatId, '<b>Главное меню</b>\n\nВыберите действие на клавиатуре ниже 🙂', mainMenuKeyboard());
  }

  async startCreativeBrief(chatId, person) {
    const previousState = this.isCreativeBriefState(person.state)
      ? this.creativeBriefPreviousState(person.state)
      : String(person.state || 'new');
    await this.people.setState(person.id, `awaiting_creative_brief:${previousState}`);
    const text = '<b>Давайте найдём идею для вашей задачи 💡</b>\n\n'
      + 'Опишите её в нескольких предложениях. Чтобы менеджер быстрее попал в точку, можно указать:\n'
      + '- что за продукт, проект, кампания или мероприятие;\n'
      + '- для кого это делается;\n'
      + '- какую цель нужно решить: запуск, вовлечение, продажи, имидж, объяснение сложной темы;\n'
      + '- где будет жить креатив: Telegram, видео, сайт, эфир, презентация, офлайн-событие;\n'
      + '- какой тон нужен: смелый, деликатный, экспертный, праздничный, молодой;\n'
      + '- сроки, ограничения или важные детали.\n\n'
      + 'Пишите свободно, как в заметках. Мы разберёмся и вернёмся с идеями или уточняющими вопросами.';
    await this.telegram.sendMessage(chatId, text, removeKeyboard());
  }

  async receiveCreativeBrief(chatId, person, message) {
    const text = String(message.text || message.caption || '').trim();
    if (text.length < 15) {
      await this.recordIncomingChatMessage(person, chatId, message);
      await this.telegram.sendMessage(
        chatId,
        'Поймали, но нужно чуть больше контекста 🙂\n\nНапишите хотя бы пару предложений: что за проект, для кого он и какую задачу должен решить креатив.',
        removeKeyboard(),
      );
      return;
    }

    await this.recordIncomingChatMessage(person, chatId, message, { messageType: 'creative_request' });
    const nextState = this.creativeBriefPreviousState(person.state);
    await this.people.setState(person.id, nextState || (profileComplete(person) ? 'registered' : 'new'));
    await this.notifyAdminsAboutCreativeRequest(person, text);
    await this.telegram.sendMessage(
      chatId,
      '<b>Спасибо, заявка на идею принята 💡</b>\n\nМенеджер посмотрит задачу и свяжется с вами здесь: пришлёт первые мысли, материалы или задаст уточняющие вопросы.',
      mainMenuKeyboard(),
    );
  }

  async restoreCreativeBriefStateIfNeeded(person) {
    if (!this.isCreativeBriefState(person.state)) {
      return person;
    }

    const nextState = this.creativeBriefPreviousState(person.state) || (profileComplete(person) ? 'registered' : 'new');
    await this.people.setState(person.id, nextState);
    return { ...person, state: nextState };
  }

  async sendSocialLinks(chatId) {
    await this.telegram.sendMessage(chatId, '<b>Мы рядом</b>\n\nНовости, анонсы и материалы публикуем здесь:', inlineKeyboard([
      [{ text: 'Телеграм канал', url: config.links.telegramChannel }],
      [{ text: 'Сайт', url: config.links.companySite }],
    ]));
  }

  async sendMyRegistrations(chatId, person) {
    const rows = await this.registrations.listByPerson(person.id);
    const recordingRows = await this.recordingAccesses.listByPerson(person.id);
    if (rows.length === 0 && recordingRows.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        '<b>Активных регистраций и доступных записей пока нет.</b>\n\nОткройте ближайшие мероприятия и выберите удобный формат участия 🙂',
        mainMenuKeyboard(),
      );
      return;
    }

    const lines = rows.map((row) => {
      const format = row.attendance === 'online' ? 'онлайн' : 'офлайн';
      const time = row.attendance === 'online'
        ? timeOnly(row.online_start || row.date_start)
        : timeRange(row.date_start, row.date_end);

      return `- <b>${h(row.title)}</b>\n`
        + `  ${h(dateShort(row.date_start))}, ${h(time)}\n`
        + `  Формат: ${h(format)}\n`
        + `  Статус: ${h(this.registrationStatusText(row))}`;
    });

    const recordingLines = recordingRows.map((row) => {
      const access = String(row.facecast_url || '').trim() ? 'ссылка готова' : 'можно запросить в архиве';
      return `- <b>${h(row.title)}</b>\n`
        + `  Эфир от ${h(dateShort(row.date_start))}\n`
        + `  Запись: ${h(access)}`;
    });

    const sections = [];
    if (lines.length > 0) {
      sections.push(`<b>Активные регистрации</b>\n\n${lines.join('\n\n')}`);
    }
    if (recordingLines.length > 0) {
      sections.push(`<b>Записи эфиров</b>\n\n${recordingLines.join('\n\n')}`);
    }

    const recordingButtons = recordingRows
      .filter((row) => String(row.facecast_url || '').trim())
      .map((row) => [{
        text: `Смотреть: ${this.shortButtonText(row.title)}`,
        url: String(row.facecast_url).trim(),
      }]);
    recordingButtons.push([{ text: 'Записи эфиров', callback_data: 'recordings_archive' }]);
    recordingButtons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(
      chatId,
      `<b>Ваши мероприятия</b>\n\n${sections.join('\n\n')}`,
      recordingRows.length > 0 ? inlineKeyboard(recordingButtons) : mainMenuKeyboard(),
    );
  }

  async sendEvents(chatId) {
    const events = await this.events.listUpcoming();
    if (events.length === 0) {
      await this.telegram.sendMessage(chatId, '<b>Пока ближайших мероприятий нет.</b>\n\nКак только появится новое событие, мы обязательно расскажем 🙂', mainMenuKeyboard());
      return;
    }

    if (events.length === 1) {
      await this.sendEventDetails(chatId, events[0]);
      return;
    }

    const buttons = events.map((event) => [{
      text: `${event.title} - ${dateShort(event.date_start)}`,
      callback_data: `event:${event.id}`,
    }]);
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(chatId, '<b>Ближайшие мероприятия</b>\n\nВыберите событие, на которое хотите зарегистрироваться:', inlineKeyboard(buttons));
  }

  async sendRecordingsArchive(chatId) {
    const events = await this.events.listRecordingsArchive();
    if (events.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        '<b>Архив эфиров пока пуст.</b>\n\nЗаписи появляются здесь после завершения трансляций и доступны в течение 6 месяцев.',
        mainMenuKeyboard(),
      );
      return;
    }

    const buttons = events.map((event) => [{
      text: `${event.title} - ${dateShort(event.date_start)}`,
      callback_data: `recording_event:${event.id}`,
    }]);
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(
      chatId,
      '<b>Записи эфиров 🎬</b>\n\nВыберите трансляцию. Мы оформим доступ и пришлём ссылку на просмотр записи.',
      inlineKeyboard(buttons),
    );
  }

  async sendGiveaways(chatId, person) {
    const giveaways = await this.giveaways.listActive();
    if (giveaways.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        '<b>Активных розыгрышей пока нет.</b>\n\nКак только появится новая акция, мы расскажем здесь и в канале Мегаполис Медиа.',
        mainMenuKeyboard(),
      );
      return;
    }

    if (giveaways.length === 1) {
      await this.sendGiveawayDetails(chatId, person, giveaways[0]);
      return;
    }

    const buttons = giveaways.map((giveaway) => [{
      text: this.shortButtonText(giveaway.title),
      callback_data: `giveaway:${giveaway.id}`,
    }]);
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);
    await this.telegram.sendMessage(
      chatId,
      '<b>Активные розыгрыши 🎁</b>\n\nВыберите розыгрыш, в котором хотите участвовать.',
      inlineKeyboard(buttons),
    );
  }

  async sendGiveawayDetails(chatId, person, giveaway) {
    const existing = await this.giveaways.findEntry(giveaway.id, person.id);
    const buttons = [];
    if (!existing || existing.status === 'cancelled') {
      buttons.push([{
        text: this.giveawayEnterButtonText(giveaway),
        callback_data: `giveaway_enter:${giveaway.id}`,
      }]);
    }
    buttons.push([{ text: 'Телеграм канал', url: config.links.telegramChannel }]);
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    const text = this.giveawayDetailsText(giveaway)
      + (existing && existing.status !== 'cancelled'
        ? '\n\n<b>Вы уже участвуете.</b> Заявка принята, дополнительно ничего нажимать не нужно.'
        : '');
    await this.telegram.sendMessage(chatId, text, inlineKeyboard(buttons));
  }

  async enterGiveaway(chatId, person, giveaway) {
    const result = await this.giveaways.enter(giveaway.id, person.id);
    const intro = result.created
      ? '<b>Готово, вы участвуете в розыгрыше 🎁</b>'
      : '<b>Вы уже участвуете в розыгрыше 🎁</b>';
    const drawDate = giveaway.draw_at ? dateShort(giveaway.draw_at) : 'дату сообщим отдельно';
    const prize = giveaway.prize || giveaway.title || 'приз розыгрыша';
    await this.telegram.sendMessage(
      chatId,
      `${intro}\n\n<b>Разыгрываем:</b>\n${h(prize)}\n\n<b>Дата события:</b> ${h(drawDate)}\n\nИтоги подведём рандомайзером, а запись розыгрыша опубликуем в Telegram-канале Мегаполис Медиа.\n\nДержим за вас кулачки, но делаем вид, что это деловая переписка 🙂`,
      inlineKeyboard([
        [{ text: 'Телеграм канал Мегаполис Медиа', url: config.links.telegramChannel }],
        [{ text: 'Главное меню', callback_data: 'main_menu' }],
      ]),
    );
  }

  giveawayEnterButtonText(giveaway) {
    if (giveaway.slug === 'intercomm-2026-naekk') {
      return 'Участвовать в розыгрыше 2 билетов на премию ИнтерКомм';
    }

    return 'Участвовать в розыгрыше';
  }

  giveawayDetailsText(giveaway) {
    const drawDate = giveaway.draw_at ? dateShort(giveaway.draw_at) : 'дату сообщим отдельно';
    return `<b>${h(giveaway.title || 'Розыгрыш')} 🎁</b>\n\n`
      + `${h(giveaway.description || 'Нажмите кнопку ниже, чтобы принять участие.')}\n\n`
      + '<b>Что разыгрываем:</b>\n'
      + `${h(giveaway.prize || 'Приз розыгрыша')}\n\n`
      + `<b>Когда событие:</b> ${h(drawDate)}\n\n`
      + 'Чтобы участвовать, нажмите кнопку ниже. Итоги подведём среди тех, кто нажал кнопку участия. Запись розыгрыша рандомайзером выложим в Telegram-канале Мегаполис Медиа.';
  }

  async sendGiveawayUnavailable(chatId) {
    await this.telegram.sendMessage(
      chatId,
      '<b>Этот розыгрыш сейчас недоступен.</b>\n\nПроверьте активные розыгрыши в главном меню.',
      mainMenuKeyboard(),
    );
  }

  async sendRecordingDetails(chatId, event) {
    const description = String(event.description || '').trim();
    const preview = description.length > 700 ? `${description.slice(0, 700).trim()}...` : description;
    let text = '<b>Запись эфира</b>\n\n'
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата эфира:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Доступ:</b> 6 месяцев после эфира\n\n`;

    if (preview) {
      text += `${h(preview)}\n\n`;
    }

    text += 'Нажмите кнопку ниже, и мы подготовим вашу ссылку на просмотр записи.';

    await this.telegram.sendMessage(chatId, text, inlineKeyboard([
      [{ text: 'Получить ссылку на запись', callback_data: `recording_access:${event.id}` }],
      [{ text: 'Все записи эфиров', callback_data: 'recordings_archive' }],
      [{ text: 'Главное меню', callback_data: 'main_menu' }],
    ]));
  }

  async registerRecordingAccess(chatId, person, event) {
    const existing = await this.recordingAccesses.findByPersonEvent(person.id, event.id);
    if (existing) {
      if (existing.source === 'public_recording' && String(existing.facecast_url || '').trim()) {
        await this.sendRecordingAccess(chatId, event, existing);
        return;
      }

      if (this.facecast.isExistingPersonalAccess(existing, event, person)) {
        await this.sendRecordingAccess(chatId, event, existing);
        return;
      }
    }

    const canUseFacecast = String(event.facecast_event_id || '').trim() && String(event.facecast_url || '').trim();
    if (canUseFacecast) {
      try {
        const credentials = await this.facecast.registerViewer(event, person);
        if (this.facecast.isPersonalCredentials(credentials, event, person)) {
          const access = await this.recordingAccesses.upsert(person.id, event.id, {
            source: 'facecast',
            facecast_login: credentials.login,
            facecast_password: credentials.password,
            facecast_ticket_id: credentials.ticketId,
            facecast_url: credentials.url,
          });
          await this.sendRecordingAccess(chatId, event, access);
          return;
        }

        logger.warn('facecast returned unusable recording access', {
          eventId: event.id,
          facecastEventId: event.facecast_event_id,
          personId: person.id,
          source: credentials.source || '',
        });
      } catch (error) {
        logger.warn('facecast recording access failed', {
          eventId: event.id,
          facecastEventId: event.facecast_event_id,
          personId: person.id,
          message: error.message,
        });
      }
    }

    const recordingUrl = String(event.recording_url || '').trim();
    if (recordingUrl) {
      const access = await this.recordingAccesses.upsert(person.id, event.id, {
        source: 'public_recording',
        facecast_login: person.email || '',
        facecast_password: '',
        facecast_ticket_id: '',
        facecast_url: recordingUrl,
      });
      await this.sendRecordingAccess(chatId, event, access);
      return;
    }

    await this.telegram.sendMessage(
      chatId,
      '<b>Сейчас не получилось создать доступ к записи.</b>\n\nМы уже видим проблему и вернёмся со ссылкой чуть позже.',
      mainMenuKeyboard(),
    );
  }

  async sendRecordingAccess(chatId, event, access) {
    const url = String(access.facecast_url || event.recording_url || '').trim();
    const sourceLine = access.source === 'public_recording'
      ? 'Ссылка на запись готова.'
      : 'Персональная ссылка на просмотр записи готова.';
    const text = '<b>Доступ к записи готов 🎬</b>\n\n'
      + `${sourceLine}\n\n`
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата эфира:</b> ${h(dateShort(event.date_start))}\n`
      + '<b>Срок доступа:</b> 6 месяцев после эфира\n\n'
      + 'Сохраните это сообщение, чтобы вернуться к просмотру в удобное время.';

    const buttons = [];
    if (url) {
      buttons.push([{ text: 'Смотреть запись', url }]);
    }
    buttons.push([{ text: 'Записи эфиров', callback_data: 'recordings_archive' }]);
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(chatId, text, inlineKeyboard(buttons));
  }

  async sendRecordingUnavailable(chatId) {
    await this.telegram.sendMessage(
      chatId,
      '<b>Запись сейчас недоступна.</b>\n\nВозможно, срок хранения уже закончился или запись ещё не опубликована.',
      inlineKeyboard([
        [{ text: 'Все записи эфиров', callback_data: 'recordings_archive' }],
        [{ text: 'Главное меню', callback_data: 'main_menu' }],
      ]),
    );
  }

  async sendEventDetails(chatId, event) {
    const buttons = this.eventFormatKeyboard(event);
    let text = '<b>Отлично, вот что запланировано</b>\n\n'
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время:</b> ${h(timeRange(event.date_start, event.date_end))}\n`
      + `<b>Формат:</b> ${h(eventFormatLabel(event))}\n\n`
      + h(event.description || '');

    if (buttons.inline_keyboard.length > 1) {
      text += '\n\nВыберите удобный формат участия:';
    } else {
      text += '\n\nСейчас регистрация на это событие недоступна. Можно вернуться в меню.';
    }

    await this.telegram.sendMessage(chatId, text, buttons);
  }

  async registerOffline(chatId, person, event) {
    if (!eventSupportsOffline(event)) {
      await this.telegram.sendMessage(chatId, '<b>Офлайн-формат для этого события не предусмотрен.</b>\n\nВыберите другой доступный формат, пожалуйста.', this.eventFormatKeyboard(event));
      return;
    }

    const existing = await this.registrations.findByPersonEvent(person.id, event.id);
    if (existing && existing.attendance === 'offline') {
      if (existing.status === 'pending') {
        await this.telegram.sendMessage(chatId, '<b>Заявка на офлайн уже на проверке.</b>\n\nКак только модератор подтвердит список гостей, мы пришлём детали. Держим место в поле зрения 🙂', mainMenuKeyboard());
        return;
      }

      if (['approved', 'visited'].includes(existing.status)) {
        await this.sendOfflineAlreadyConfirmed(chatId, event);
        return;
      }
    }

    const registration = await this.registrations.upsert(person.id, event.id, 'offline', 'pending');
    await this.planner.cancelAll(registration);

    const text = '<b>Заявка на офлайн-участие принята 🏢</b>\n\n'
      + 'Организаторы проверят список гостей и пришлют подтверждение.\n\n'
      + 'Адрес и детали площадки отправим после подтверждения участия, чтобы у вас не было лишних квестов с навигацией раньше времени.';

    await this.telegram.sendMessage(chatId, text, mainMenuKeyboard());
    await this.notifyAdminsAboutOfflineRequest(person, event, registration);
  }

  async registerOnline(chatId, person, event, { replaceOffline = false } = {}) {
    if (!eventSupportsOnline(event)) {
      await this.telegram.sendMessage(chatId, '<b>Онлайн-формат для этого события не предусмотрен.</b>\n\nВыберите другой доступный формат, пожалуйста.', this.eventFormatKeyboard(event));
      return;
    }

    const existing = await this.registrations.findByPersonEvent(person.id, event.id);
    if (
      existing &&
      existing.attendance === 'offline' &&
      replaceOffline &&
      this.facecast.isExistingPersonalAccess(existing, event, person)
    ) {
      let registration = await this.registrations.upsert(person.id, event.id, 'online', 'approved');
      registration = await this.registrations.findById(registration.id);
      await this.planner.planOnline(registration, event);
      await this.sendOnlineAccess(chatId, event, registration);
      return;
    }

    if (
      existing &&
      existing.attendance === 'offline' &&
      ACTIVE_OFFLINE_STATUSES.has(String(existing.status || '')) &&
      !replaceOffline
    ) {
      await this.ensureOfflineBackupOnlineAccess(chatId, person, event, existing);
      return;
    }

    if (
      existing &&
      existing.attendance === 'online' &&
      existing.status === 'approved' &&
      this.facecast.isExistingPersonalAccess(existing, event, person)
    ) {
      await this.sendOnlineAccess(chatId, event, existing);
      return;
    }

    let credentials;
    try {
      credentials = await this.facecast.registerViewer(event, person);
    } catch (error) {
      logger.warn('facecast online registration failed', {
        eventId: event.id,
        facecastEventId: event.facecast_event_id,
        personId: person.id,
        message: error.message,
      });
      await this.telegram.sendMessage(
        chatId,
        '<b>Сейчас не получилось создать доступ к онлайн-трансляции.</b>\n\nМы уже видим проблему и вернёмся с ссылкой чуть позже.',
        mainMenuKeyboard(),
      );
      return;
    }

    if (!this.facecast.isPersonalCredentials(credentials, event, person)) {
      logger.warn('facecast returned unusable personal access', {
        eventId: event.id,
        facecastEventId: event.facecast_event_id,
        personId: person.id,
        source: credentials.source || '',
      });
      await this.telegram.sendMessage(
        chatId,
        '<b>Сейчас не получилось создать персональную ссылку на трансляцию.</b>\n\nМы уже видим проблему и вернёмся с ссылкой чуть позже.',
        mainMenuKeyboard(),
      );
      return;
    }

    let registration = await this.registrations.upsert(person.id, event.id, 'online', 'approved');
    await this.registrations.update(registration.id, {
      facecast_login: credentials.login,
      facecast_password: credentials.password,
      facecast_ticket_id: credentials.ticketId,
      facecast_url: credentials.url,
      approved_at: registration.approved_at || nowSql(),
    });
    registration = await this.registrations.findById(registration.id);

    await this.planner.planOnline(registration, event);
    await this.sendOnlineAccess(chatId, event, registration);
  }

  async switchRegistrationToOnline(chatId, person, registrationId) {
    const registration = await this.registrations.findById(registrationId);
    if (!registration || Number(registration.person_id) !== Number(person.id)) {
      await this.telegram.sendMessage(chatId, '<b>Не нашли вашу регистрацию.</b>\n\nОткройте ближайшие мероприятия из меню, пожалуйста.');
      return;
    }

    const event = await this.events.findById(registration.event_id);
    if (!event) {
      return;
    }

    if (!eventSupportsOnline(event)) {
      await this.telegram.sendMessage(chatId, '<b>Понимаем, планы меняются.</b>\n\nУ этого события нет онлайн-формата, поэтому просто снимем вас с офлайн-списка у модераторов.');
      await this.registrations.update(registration.id, { status: 'cancelled' });
      await this.planner.cancelAll(registration);
      return;
    }

    await this.telegram.sendMessage(chatId, '<b>Конечно, планы меняются.</b>\n\nПереключаем вас на онлайн-участие 💻');
    await this.registerOnline(chatId, person, event, { replaceOffline: true });
  }

  async ensureOfflineBackupOnlineAccess(chatId, person, event, registration) {
    if (this.facecast.isExistingPersonalAccess(registration, event, person)) {
      await this.sendOfflineBackupOnlineAccess(chatId, event, registration);
      return;
    }

    let credentials;
    try {
      credentials = await this.facecast.registerViewer(event, person);
    } catch (error) {
      logger.warn('facecast backup online registration failed', {
        eventId: event.id,
        facecastEventId: event.facecast_event_id,
        personId: person.id,
        registrationId: registration.id,
        message: error.message,
      });
      await this.telegram.sendMessage(
        chatId,
        '<b>Офлайн-регистрация остаётся в силе.</b>\n\nСейчас не получилось создать запасную ссылку на онлайн-трансляцию. Мы уже видим проблему и вернёмся к ней чуть позже.',
        mainMenuKeyboard(),
      );
      return;
    }

    if (!this.facecast.isPersonalCredentials(credentials, event, person)) {
      logger.warn('facecast returned unusable backup online access', {
        eventId: event.id,
        facecastEventId: event.facecast_event_id,
        personId: person.id,
        registrationId: registration.id,
        source: credentials.source || '',
      });
      await this.telegram.sendMessage(
        chatId,
        '<b>Офлайн-регистрация остаётся в силе.</b>\n\nСейчас не получилось создать персональную запасную ссылку на трансляцию. Мы уже видим проблему и вернёмся к ней чуть позже.',
        mainMenuKeyboard(),
      );
      return;
    }

    await this.registrations.update(registration.id, {
      facecast_login: credentials.login,
      facecast_password: credentials.password,
      facecast_ticket_id: credentials.ticketId,
      facecast_url: credentials.url,
    });

    const updatedRegistration = await this.registrations.findById(registration.id);
    await this.sendOfflineBackupOnlineAccess(chatId, event, updatedRegistration);
  }

  async sendOnlineAccess(chatId, event, registration) {
    const url = String(registration.facecast_url || '').trim();
    const accessLine = url
      ? 'Персональная ссылка на просмотр будет в кнопке ниже.\n'
      : 'Персональная ссылка пока не сформировалась автоматически. Попробуйте получить её чуть позже или напишите организаторам.\n';
    const text = '<b>Готово, вы зарегистрированы онлайн! 💻</b>\n\n'
      + accessLine
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время подключения:</b> ${h(timeOnly(event.online_start || event.date_start))}\n\n`
      + 'Сохраните сообщение, а перед эфиром мы напомним о старте.';

    const buttons = [];
    if (url) {
      buttons.push([{ text: 'Персональная ссылка на эфир', url }]);
    } else if (registration.id) {
      buttons.push([{ text: 'Получить ссылку', callback_data: `credentials:${registration.id}` }]);
    }
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(chatId, text, inlineKeyboard(buttons));
  }

  async sendOfflineBackupOnlineAccess(chatId, event, registration) {
    const url = String(registration.facecast_url || '').trim();
    const isPending = String(registration.status || '') === 'pending';
    const intro = isPending
      ? '<b>Ваша заявка на офлайн-участие остаётся на проверке 🏢</b>'
      : '<b>Вы остаётесь в списке офлайн-гостей 🏢</b>';
    const priority = isPending
      ? 'Если модераторы подтвердят офлайн-участие, главным вариантом останется встреча на площадке.'
      : 'Главным вариантом оставляем офлайн-встречу, а ссылку держите как запасной доступ.';
    const accessLine = url
      ? 'Запасная персональная ссылка на эфир будет в кнопке ниже.\n'
      : 'Запасная персональная ссылка пока не сформировалась автоматически. Попробуйте получить её чуть позже или напишите организаторам.\n';
    const text = `${intro}\n\n`
      + `${accessLine}`
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время подключения:</b> ${h(timeOnly(event.online_start || event.date_start))}\n\n`
      + `${priority}`;

    const buttons = [];
    if (url) {
      buttons.push([{ text: 'Запасная ссылка на эфир', url }]);
    } else if (registration.id) {
      buttons.push([{ text: 'Получить ссылку', callback_data: `credentials:${registration.id}` }]);
    }
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(chatId, text, inlineKeyboard(buttons));
  }

  async sendOfflineAlreadyConfirmed(chatId, event) {
    const text = '<b>Вы уже в списке офлайн-гостей 🏢</b>\n\n'
      + 'Ждём вас на мероприятии:\n'
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время:</b> ${h(timeRange(event.date_start, event.date_end))}\n`
      + `<b>Сбор гостей:</b> ${h(this.offlineArrivalTime(event))}\n`
      + `<b>Наш адрес:</b> ${h(event.address || '')}\n`
      + '<b>Формат:</b> офлайн';

    await this.telegram.sendMessage(chatId, text, mainMenuKeyboard());
  }

  async notifyAdminsAboutOfflineRequest(person, event) {
    if (config.telegram.adminIds.length === 0) {
      return;
    }

    const text = '<b>Новая офлайн-регистрация</b>\n\n'
      + `<b>Мероприятие:</b> ${h(event.title)}\n`
      + `<b>Участник:</b> ${h(person.full_name)}\n`
      + `<b>Компания:</b> ${h(person.company)}\n`
      + `<b>Должность:</b> ${h(person.position_title)}\n`
      + `<b>Телефон:</b> ${h(person.phone)}\n`
      + `<b>Email:</b> ${h(person.email)}\n\n`
      + `${config.appUrl}/?page=registrations&event_id=${event.id}`;

    for (const adminId of config.telegram.adminIds) {
      try {
        await this.outboundTelegram.sendMessage(adminId, text);
      } catch (error) {
        logger.warn('failed to notify admin', { adminId, message: error.message });
      }
    }
  }

  async notifyAdminsAboutCreativeRequest(person, brief) {
    if (config.telegram.adminIds.length === 0) {
      return;
    }

    const text = '<b>Новая заявка на идею креатива 💡</b>\n\n'
      + `<b>Участник:</b> ${h(this.personNameForAdmin(person))}\n`
      + `<b>Компания:</b> ${h(person.company || 'не указана')}\n`
      + `<b>Должность:</b> ${h(person.position_title || 'не указана')}\n`
      + `<b>Телефон:</b> ${h(person.phone || 'не указан')}\n`
      + `<b>Email:</b> ${h(person.email || 'не указан')}\n\n`
      + `<b>Бриф:</b>\n${h(String(brief || '').slice(0, 3000))}\n\n`
      + `${config.appUrl}/?page=messages&person_id=${Number(person.id)}`;

    for (const adminId of config.telegram.adminIds) {
      try {
        await this.outboundTelegram.sendMessage(adminId, text);
      } catch (error) {
        logger.warn('failed to notify admin about creative request', { adminId, message: error.message });
      }
    }
  }

  offlineArrivalTime(event) {
    const value = String(event.guest_arrival_at || '').trim();
    return timeOnly(value || shiftDate(event.date_start, -30 * 60 * 1000));
  }

  async ensureProfileReady(chatId, person) {
    if (profileComplete(person)) {
      return true;
    }

    await this.telegram.sendMessage(
      chatId,
      '<b>Сначала давайте познакомимся.</b>\n\nТак мы корректно оформим регистрацию и не потеряем вас в списке гостей.',
      startRegistrationKeyboard(),
    );

    return false;
  }

  eventFormatKeyboard(event) {
    const buttons = [];
    if (eventSupportsOffline(event)) {
      buttons.push([{ text: '🏢 Прийти офлайн', callback_data: `reg_offline:${event.id}` }]);
    }
    if (eventSupportsOnline(event)) {
      buttons.push([{ text: '💻 Смотреть онлайн', callback_data: `reg_online:${event.id}` }]);
    }
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);
    return inlineKeyboard(buttons);
  }

  registrationStatusText(row) {
    if (row.status === 'pending') return 'на проверке';
    if (row.status === 'approved') return 'зарегистрированы';
    if (row.status === 'visited') return row.attendance === 'online' ? 'смотрели эфир' : 'пришли';
    if (row.status === 'no_show') return row.attendance === 'online' ? 'не смотрели эфир' : 'не пришли';
    if (row.status === 'rejected') return 'отказ';
    if (row.status === 'cancelled') return 'отменено';
    return row.status || 'без статуса';
  }

  shortButtonText(value) {
    const text = String(value || '').trim();
    if (text.length <= 34) {
      return text || 'запись';
    }

    return `${text.slice(0, 31).trim()}...`;
  }

  isMainMenuText(text) {
    return ['/start', 'Главное меню', '🏠 Главное меню'].includes(text);
  }

  isStartRegistrationText(text) {
    return ['Зарегистрироваться', '🚀 Зарегистрироваться'].includes(text);
  }

  isConsentText(text) {
    return ['Даю согласие', '✅ Даю согласие'].includes(text);
  }

  isEventsText(text) {
    return ['/events', 'Ближайшие мероприятия', '🗓 Мероприятия'].includes(text);
  }

  isRecordingsArchiveText(text) {
    return ['/recordings', 'Записи эфиров', '🎬 Записи эфиров', 'Архив эфиров', '🎬 Архив эфиров'].includes(text);
  }

  isGiveawayText(text) {
    return [
      '/giveaway',
      '/giveaways',
      'Розыгрыш',
      '🎁 Розыгрыш',
      'Розыгрыши',
      '🎁 Розыгрыши',
      'Розыгрыш ИнтерКомм',
      '🎁 Розыгрыш ИнтерКомм',
      'Участвовать в розыгрыше 2 билетов на премию ИнтерКомм',
    ].includes(text);
  }

  isSocialsText(text) {
    return ['Соцсети', '🌐 Соцсети'].includes(text);
  }

  isMyRegistrationsText(text) {
    return ['Мои регистрации', '👤 Мои регистрации'].includes(text);
  }

  isCreativeIdeaText(text) {
    return ['Получить идею', '💡 Получить идею', 'Идея креатива', '💡 Идея креатива', '/creative'].includes(text);
  }

  isCreativeBriefState(state) {
    return String(state || '').startsWith('awaiting_creative_brief');
  }

  shouldDelayCreativeBriefRecord(person, state, text, messageText) {
    if (!this.isCreativeBriefState(state) || !messageText || this.isHumanChatMode(person)) {
      return false;
    }

    return !this.isMainMenuText(text) && text !== '/menu' && !this.isCreativeIdeaText(text);
  }

  creativeBriefPreviousState(state) {
    const value = String(state || '');
    if (!this.isCreativeBriefState(value)) return '';
    const previous = value.split(':').slice(1).join(':').trim();
    return previous && previous.length <= 48 ? previous : 'registered';
  }

  isPhoneButtonText(text) {
    return ['Отправить телефон', '📱 Отправить телефон'].includes(text);
  }

  isAdminTelegramId(telegramId) {
    return config.telegram.adminIds.includes(String(telegramId));
  }

  adminMediaFileId(message) {
    if (message.video_note?.file_id) {
      return { label: 'кружка', fileId: String(message.video_note.file_id) };
    }

    if (message.video?.file_id) {
      return { label: 'видео', fileId: String(message.video.file_id) };
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      if (photo?.file_id) {
        return { label: 'картинки', fileId: String(photo.file_id) };
      }
    }

    return null;
  }

  async recordIncomingChatMessage(person, chatId, message, options = {}) {
    try {
      await this.chat.recordIncoming({
        personId: person.id,
        telegramId: chatId,
        messageType: options.messageType || this.chatMessageType(message),
        text: this.chatMessageText(message),
        ...this.chatMessageMedia(message),
      });
    } catch (error) {
      logger.warn('failed to record incoming chat message', { personId: person.id, message: error.message });
    }
  }

  chatMessageType(message) {
    if (message.video_note) return 'video_note';
    if (message.video) return 'video';
    if (message.photo) return 'photo';
    if (message.contact) return 'contact';
    if (message.document) return 'document';
    if (message.voice) return 'voice';
    if (message.text) return 'text';
    return 'message';
  }

  chatMessageText(message) {
    const caption = String(message.caption || '').trim();
    if (message.text) return String(message.text);
    if (message.contact) {
      return `Контакт: ${message.contact.phone_number || ''}`.trim();
    }
    if (message.video_note) return caption || 'Кружок';
    if (message.video) return caption || 'Видео';
    if (message.photo) return caption || 'Картинка';
    if (message.document) return caption || `Файл: ${message.document.file_name || ''}`.trim();
    if (message.voice) return caption || 'Голосовое сообщение';
    return 'Сообщение без текста';
  }

  chatMessageMedia(message) {
    if (message.video_note?.file_id) {
      return {
        mediaFileId: String(message.video_note.file_id),
        mediaName: 'video_note.mp4',
        mediaMime: 'video/mp4',
      };
    }

    if (message.video?.file_id) {
      return {
        mediaFileId: String(message.video.file_id),
        mediaName: message.video.file_name || 'video.mp4',
        mediaMime: message.video.mime_type || 'video/mp4',
      };
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      return {
        mediaFileId: String(photo.file_id || ''),
        mediaName: 'photo.jpg',
        mediaMime: 'image/jpeg',
      };
    }

    if (message.document?.file_id) {
      return {
        mediaFileId: String(message.document.file_id),
        mediaName: message.document.file_name || 'document',
        mediaMime: message.document.mime_type || 'application/octet-stream',
      };
    }

    if (message.voice?.file_id) {
      return {
        mediaFileId: String(message.voice.file_id),
        mediaName: 'voice.ogg',
        mediaMime: message.voice.mime_type || 'audio/ogg',
      };
    }

    return {};
  }

  personNameForAdmin(person) {
    return String(person.full_name || person.first_name || person.username || `Telegram ID ${person.telegram_id}`).trim();
  }

  isHumanChatMode(person) {
    return String(person.chat_mode || 'bot') === 'human';
  }

  consentText() {
    return '<b>Согласие на обработку персональных данных</b>\n\n'
      + 'Перед регистрацией нужно ваше согласие.\n\n'
      + 'Мы используем ФИО, компанию, должность, телефон и email для регистрации на мероприятия, коммуникации, допуска к эфиру и отправки материалов.\n\n'
      + 'Оператор: ООО «Мегаполис Медиа», ИНН 7710750836, ОГРН 1097746299034.\n'
      + 'Согласие действует 3 года и может быть отозвано в порядке, предусмотренном законодательством РФ.'
      + `\n\nПолный текст: ${h(config.links.privacy)}`;
  }
}
