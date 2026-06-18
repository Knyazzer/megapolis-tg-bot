import { config } from '../config.js';
import {
  eventFormatLabel,
  eventSupportsOffline,
  eventSupportsOnline,
  EventsRepository,
} from '../repositories/events-repository.js';
import { PeopleRepository, profileComplete } from '../repositories/people-repository.js';
import { RegistrationsRepository } from '../repositories/registrations-repository.js';
import { FacecastClient } from '../services/facecast-client.js';
import { ReminderPlanner } from '../services/reminder-planner.js';
import { TelegramClient } from '../services/telegram-client.js';
import { dateShort, nowSql, timeOnly, timeRange } from '../utils/dates.js';
import { h } from '../utils/html.js';
import { logger } from '../utils/logger.js';
import { eventsMenuKeyboard, inlineKeyboard, mainMenuKeyboard, phoneKeyboard, removeKeyboard } from './keyboards.js';

export class BotController {
  constructor({ telegram }) {
    this.telegram = telegram;
    this.outboundTelegram = new TelegramClient();
    this.people = new PeopleRepository();
    this.events = new EventsRepository();
    this.registrations = new RegistrationsRepository();
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

    if (message.video_note && this.isAdminTelegramId(from.id)) {
      const fileId = String(message.video_note.file_id || '');
      await this.telegram.sendMessage(chatId, `File ID кружка:\n<code>${h(fileId)}</code>`);
      return;
    }

    if (text === '/start' || text === 'Главное меню') {
      await this.sendWelcomeOrMenu(chatId, person);
      return;
    }

    if (text === '/menu') {
      await this.sendMainMenu(chatId);
      return;
    }

    if (text === '/events' || text === 'Ближайшие мероприятия') {
      await this.sendEvents(chatId);
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
      await this.people.acceptConsent(person.id);
      await this.people.setState(person.id, 'ask_name');
      await this.telegram.sendMessage(chatId, 'Спасибо! Давайте познакомимся 🙂 Напишите, пожалуйста, имя и фамилию.');
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
      await this.sendConsent(chatId);
      return;
    }

    if (state === 'ask_name') {
      if (text.length < 2) {
        await this.telegram.sendMessage(chatId, 'Напишите, пожалуйста, имя и фамилию текстом, чтобы мы корректно оформили регистрацию.');
        return;
      }
      await this.people.updateFields(person.id, { full_name: text });
      await this.people.setState(person.id, 'ask_company');
      await this.telegram.sendMessage(chatId, 'Из какой вы компании?');
      return;
    }

    if (state === 'ask_company') {
      await this.people.updateFields(person.id, { company: text });
      await this.people.setState(person.id, 'ask_position');
      await this.telegram.sendMessage(chatId, 'А какая у вас должность?');
      return;
    }

    if (state === 'ask_position') {
      await this.people.updateFields(person.id, { position_title: text });
      await this.people.setState(person.id, 'ask_phone');
      await this.telegram.sendMessage(chatId, 'Поделитесь, пожалуйста, номером телефона. Можно отправить его кнопкой ниже.', phoneKeyboard());
      return;
    }

    if (state === 'ask_phone') {
      const phone = String(message.contact?.phone_number || text);
      if (phone.length < 6) {
        await this.telegram.sendMessage(chatId, 'Кажется, это не номер телефона. Пришлите номер текстом или кнопкой, пожалуйста.');
        return;
      }
      await this.people.updateFields(person.id, { phone });
      await this.people.setState(person.id, 'ask_email');
      await this.telegram.sendMessage(chatId, 'И последний шаг: напишите вашу почту.', removeKeyboard());
      return;
    }

    if (state === 'ask_email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        await this.telegram.sendMessage(chatId, 'Почта выглядит непривычно. Напишите email в формате name@example.com.');
        return;
      }
      await this.people.updateFields(person.id, { email: text.toLowerCase() });
      await this.people.setState(person.id, 'registered');
      await this.telegram.sendMessage(chatId, 'Готово, спасибо! Теперь можно выбрать мероприятие ✨', eventsMenuKeyboard());
      return;
    }

    await this.sendMainMenu(chatId);
  }

  async sendWelcomeOrMenu(chatId, person) {
    if (profileComplete(person)) {
      await this.sendMainMenu(chatId);
      return;
    }

    await this.sendWelcome(chatId);
  }

  async sendWelcome(chatId) {
    const text = 'Здравствуйте! Это бот Мегаполис Медиа 👋\n\n'
      + 'Здесь можно зарегистрироваться на наши митапы, эфиры и деловые встречи.\n\n'
      + 'Давайте познакомимся, чтобы мы могли корректно оформить вашу регистрацию.';

    await this.telegram.sendMessage(chatId, text, inlineKeyboard([
      [{ text: 'Зарегистрироваться', callback_data: 'start_registration' }],
      [{ text: 'Главное меню', callback_data: 'main_menu' }],
    ]));
  }

  async sendConsent(chatId) {
    await this.telegram.sendMessage(chatId, this.consentText(), inlineKeyboard([
      [{ text: 'Даю согласие', callback_data: 'consent_accept' }],
      [{ text: 'Главное меню', callback_data: 'main_menu' }],
    ]));
  }

  async sendMainMenu(chatId) {
    await this.telegram.sendMessage(chatId, 'Что посмотрим дальше? Мы рядом в соцсетях и на сайте 🙂', inlineKeyboard([
      [{ text: 'Телеграм канал', url: config.links.telegramChannel }],
      [{ text: 'Сайт', url: config.links.companySite }],
      [{ text: 'Ближайшие мероприятия', callback_data: 'events' }],
    ]));
  }

  async sendEvents(chatId) {
    const events = await this.events.listUpcoming();
    if (events.length === 0) {
      await this.telegram.sendMessage(chatId, 'Пока ближайших мероприятий нет. Как только появится новое событие, мы обязательно расскажем 🙂', mainMenuKeyboard());
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

    await this.telegram.sendMessage(chatId, 'Выберите мероприятие, на которое хотите зарегистрироваться:', inlineKeyboard(buttons));
  }

  async sendEventDetails(chatId, event) {
    const buttons = this.eventFormatKeyboard(event);
    let text = 'Отлично, вот что запланировано:\n\n'
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
      await this.telegram.sendMessage(chatId, 'Для этого события офлайн-участие не предусмотрено. Выберите другой доступный формат, пожалуйста.', this.eventFormatKeyboard(event));
      return;
    }

    const existing = await this.registrations.findByPersonEvent(person.id, event.id);
    if (existing && existing.attendance === 'offline') {
      if (existing.status === 'pending') {
        await this.telegram.sendMessage(chatId, 'Ваша заявка на офлайн-участие уже на проверке. Как только модератор подтвердит список гостей, мы пришлём детали 🙂', mainMenuKeyboard());
        return;
      }

      if (['approved', 'visited'].includes(existing.status)) {
        await this.sendOfflineAlreadyConfirmed(chatId, event);
        return;
      }
    }

    const registration = await this.registrations.upsert(person.id, event.id, 'offline', 'pending');
    await this.planner.cancelAll(registration);

    const text = 'Спасибо, заявка на офлайн-участие принята 🏢\n\n'
      + 'Организаторы проверят список гостей и пришлют подтверждение. Адрес и детали площадки отправим после аппрува.';

    await this.telegram.sendMessage(chatId, text, mainMenuKeyboard());
    await this.notifyAdminsAboutOfflineRequest(person, event, registration);
  }

  async registerOnline(chatId, person, event) {
    if (!eventSupportsOnline(event)) {
      await this.telegram.sendMessage(chatId, 'Для этого события онлайн-участие не предусмотрено. Выберите другой доступный формат, пожалуйста.', this.eventFormatKeyboard(event));
      return;
    }

    const existing = await this.registrations.findByPersonEvent(person.id, event.id);
    if (existing && existing.attendance === 'online' && existing.status === 'approved' && existing.facecast_login) {
      await this.sendOnlineAccess(chatId, event, existing);
      return;
    }

    let registration = await this.registrations.upsert(person.id, event.id, 'online', 'approved');
    const credentials = await this.facecast.registerViewer(event, person);

    await this.registrations.update(registration.id, {
      facecast_login: credentials.login,
      facecast_password: credentials.password,
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
      await this.telegram.sendMessage(chatId, 'Не нашли вашу регистрацию. Откройте ближайшие мероприятия из меню, пожалуйста.');
      return;
    }

    const event = await this.events.findById(registration.event_id);
    if (!event) {
      return;
    }

    if (!eventSupportsOnline(event)) {
      await this.telegram.sendMessage(chatId, 'Понимаем, планы меняются. У этого события нет онлайн-формата, поэтому просто снимем вас с офлайн-списка у модераторов.');
      await this.registrations.update(registration.id, { status: 'cancelled' });
      await this.planner.cancelAll(registration);
      return;
    }

    await this.telegram.sendMessage(chatId, 'Конечно, планы меняются. Переключаем вас на онлайн-участие 💻');
    await this.registrations.update(registration.id, { attendance: 'online', status: 'approved' });
    await this.registerOnline(chatId, person, event);
  }

  async sendOnlineAccess(chatId, event, registration) {
    const url = registration.facecast_url || event.facecast_url || config.facecast.defaultStreamUrl || '';
    const text = 'Готово, вы зарегистрированы онлайн! 💻\n\n'
      + 'Данные для подключения:\n'
      + `<b>Логин:</b> ${h(registration.facecast_login || '')}\n`
      + `<b>Пароль:</b> ${h(registration.facecast_password || '')}\n`
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время подключения:</b> ${h(timeOnly(event.online_start || event.date_start))}\n\n`
      + 'Сохраните сообщение, а перед эфиром мы напомним о старте.';

    const buttons = [];
    if (url) {
      buttons.push([{ text: 'Ссылка на эфир', url }]);
    }
    buttons.push([{ text: 'Главное меню', callback_data: 'main_menu' }]);

    await this.telegram.sendMessage(chatId, text, inlineKeyboard(buttons));
  }

  async sendOfflineAlreadyConfirmed(chatId, event) {
    const text = 'Вы уже в списке офлайн-гостей 🏢\n\n'
      + 'Ждём вас на мероприятии:\n'
      + `<b>Название:</b> ${h(event.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(event.date_start))}\n`
      + `<b>Время:</b> ${h(timeRange(event.date_start, event.date_end))}\n`
      + `<b>Наш адрес:</b> ${h(event.address || '')}\n`
      + '<b>Формат:</b> офлайн';

    await this.telegram.sendMessage(chatId, text, mainMenuKeyboard());
  }

  async notifyAdminsAboutOfflineRequest(person, event) {
    if (config.telegram.adminIds.length === 0) {
      return;
    }

    const text = 'Новая офлайн-регистрация:\n\n'
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

  async ensureProfileReady(chatId, person) {
    if (profileComplete(person)) {
      return true;
    }

    await this.telegram.sendMessage(chatId, 'Сначала давайте познакомимся, чтобы корректно оформить регистрацию.', inlineKeyboard([
      [{ text: 'Зарегистрироваться', callback_data: 'start_registration' }],
    ]));

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

  isAdminTelegramId(telegramId) {
    return config.telegram.adminIds.includes(String(telegramId));
  }

  consentText() {
    return 'Перед регистрацией нужно согласие на обработку персональных данных. '
      + 'Мы будем использовать ваши ФИО, компанию, должность, телефон и email для регистрации на мероприятия, коммуникации, допуска к эфиру и отправки материалов. '
      + 'Оператор: ООО «Мегаполис Медиа», ИНН 7710750836, ОГРН 1097746299034. '
      + 'Согласие действует 3 года и может быть отозвано в порядке, предусмотренном законодательством РФ.'
      + `\n\nПолный текст: ${h(config.links.privacy)}`;
  }
}
