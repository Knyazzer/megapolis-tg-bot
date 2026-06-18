import { config } from '../config.js';
import { BotController } from '../bot/bot-controller.js';
import { execute, isSqlite, query, queryOne, withTransaction } from '../db/mysql.js';
import {
  eventFormatLabel,
  eventSupportsOffline,
  eventSupportsOnline,
} from '../repositories/events-repository.js';
import { ReminderPlanner } from '../services/reminder-planner.js';
import { TelegramClient } from '../services/telegram-client.js';
import { dateShort, formatSqlDate, nowSql, parseDate, timeOnly, timeRange } from '../utils/dates.js';
import { h } from '../utils/html.js';
import { logger } from '../utils/logger.js';
import { attemptLogin, csrfField, destroySession, verifyCsrf } from './admin-auth.js';
import { seedDemoData } from './demo-data.js';
import { SimulatorTelegramClient } from './simulator-telegram-client.js';

const FLOW_NODE_WIDTH = 300;
const FLOW_NODE_HEIGHT = 286;
const FLOW_CONNECTOR_GAP = 24;
const FLOW_BOARD_WIDTH = 3720;
const FLOW_BOARD_HEIGHT = 1460;
const FLOW_EDGE_LABEL_OFFSET = 26;

export class AdminController {
  constructor({ session, response }) {
    this.session = session;
    this.response = response;
    this.telegram = this.adminTelegramClient();
    this.planner = new ReminderPlanner();
  }

  async handle({ method, url, form }) {
    this.currentUrl = `${url.pathname}${url.search}`;
    const action = String(form.action || url.searchParams.get('action') || '');

    if (action === 'login') {
      return this.login(form);
    }

    if (action === 'logout') {
      destroySession(this.session, this.response);
      return redirect('/?page=login');
    }

    if (!this.session.adminLoggedIn) {
      return html(this.renderLogin());
    }

    if (method === 'POST') {
      verifyCsrf(this.session, form);
      return this.handlePost(action, form);
    }

    const page = String(url.searchParams.get('page') || 'registrations');
    const content = await this.page(page, url);
    return html(this.layout(this.pageTitle(page), content, page));
  }

  login(form) {
    if (attemptLogin(form.login, form.password)) {
      this.session.adminLoggedIn = true;
      this.session.flash = { message: 'Добро пожаловать', type: 'ok' };
      return redirect('/');
    }

    return html(this.renderLogin('Неверный логин или пароль'));
  }

  async handlePost(action, form) {
    const isAjax = String(form._ajax || '') === '1';
    try {
      if (action === 'save_event') {
        await this.saveEvent(form);
      } else if (action === 'approve_registration') {
        await this.approveRegistration(form);
      } else if (action === 'reject_registration') {
        await this.rejectRegistration(form);
      } else if (action === 'archive_registration') {
        await this.archiveRegistration(form);
      } else if (action === 'restore_registration') {
        await this.restoreRegistration(form);
      } else if (action === 'mark_visited') {
        await this.markVisited(form);
      } else if (action === 'undo_visited') {
        await this.undoVisited(form);
      } else if (action === 'create_broadcast') {
        await this.createBroadcast(form);
      } else if (action === 'seed_demo') {
        await this.seedDemo();
      } else if (action === 'simulator_reset') {
        await this.resetSimulator();
      } else if (action === 'simulator_start') {
        await this.sendSimulatorMessage('/start');
      } else if (action === 'simulator_send') {
        await this.sendSimulatorMessage(String(form.text || '').trim());
      } else if (action === 'simulator_contact') {
        await this.sendSimulatorContact();
      } else if (action === 'simulator_callback') {
        await this.sendSimulatorCallback(String(form.data || ''), String(form.label || ''));
      } else {
        this.flash('Неизвестное действие', 'error');
      }
    } catch (error) {
      logger.error('admin action failed', { action, message: error.message, stack: error.stack });
      if (isAjax) {
        return json({ ok: false, error: error.message }, 500);
      }
      this.flash(`Ошибка: ${error.message}`, 'error');
    }

    if (isAjax) {
      return this.ajaxActionResult(action, form);
    }

    return redirect(String(form._return || '/'));
  }

  async ajaxActionResult(action, form) {
    this.session.flash = null;
    if ([
      'approve_registration',
      'reject_registration',
      'archive_registration',
      'restore_registration',
    ].includes(action)) {
      const row = await this.registrationRow(Number(form.id || 0));
      return json({
        ok: true,
        kind: 'registration',
        action,
        id: Number(form.id || 0),
        status: row ? this.registrationState(row) : '',
        archived: Boolean(row?.archived_at),
        attendance: row?.attendance || '',
        createdAt: row?.created_at || '',
        cardHtml: row ? this.registrationCard(row) : '',
        tableRowHtml: row ? this.registrationTableRow(row, true) : '',
      });
    }

    return json({ ok: true, action });
  }

  async page(page, url) {
    if (page === 'events') return this.eventsPage();
    if (page === 'event_edit') return this.eventEditPage(Number(url.searchParams.get('id') || 0));
    if (page === 'people') return this.peoplePage();
    if (page === 'reception') return this.receptionPage(url);
    if (page === 'broadcasts') return this.broadcastsPage();
    if (page === 'flow') return this.flowPage();
    if (page === 'simulator') return this.simulatorPage();
    return this.registrationsPage(url);
  }

  renderLogin(error = '') {
    const errorHtml = error ? `<div class="notice notice-error">${h(error)}</div>` : '';
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход - Megapolis Bot</title><link rel="stylesheet" href="/assets/admin.css"></head><body class="login-body">
<main class="login-card"><h1>Megapolis Bot</h1><p>Админка регистрации на мероприятия</p>${errorHtml}
<form method="post" action="/"><input type="hidden" name="action" value="login">
<label>Логин<input name="login" autocomplete="username" required></label>
<label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
<button class="button button-primary" type="submit">Войти</button></form></main></body></html>`;
  }

  async eventsPage() {
    const events = await query('SELECT * FROM events ORDER BY date_start DESC');
    let body = '<section class="panel"><div class="panel-head"><h2>Мероприятия</h2><a class="button button-primary" href="/?page=event_edit">Создать</a></div>';
    body += '<table><thead><tr><th>Название</th><th>Дата</th><th>Формат</th><th>Статус</th><th></th></tr></thead><tbody>';
    for (const event of events) {
      body += `<tr><td><strong>${h(event.title)}</strong><div class="muted">${h(event.slug)}</div></td>`;
      body += `<td>${h(this.dateTime(event.date_start))}</td><td>${h(eventFormatLabel(event))}</td>`;
      body += `<td>${Number(event.is_active) === 1 ? '<span class="badge ok">Активно</span>' : '<span class="badge">Скрыто</span>'}</td>`;
      body += `<td><a class="button" href="/?page=event_edit&id=${Number(event.id)}">Открыть</a></td></tr>`;
    }
    return `${body}</tbody></table></section>`;
  }

  async eventEditPage(id) {
    const blank = {
      id: 0,
      title: '',
      slug: '',
      description: '',
      date_start: '',
      date_end: '',
      online_start: '',
      address: '',
      venue_lat: '',
      venue_lng: '',
      offline_capacity: '',
      facecast_event_id: '',
      facecast_url: '',
      recording_url: '',
      photo_album_url: '',
      is_active: 1,
    };
    const event = id > 0 ? (await queryOne('SELECT * FROM events WHERE id = :id LIMIT 1', { id })) || blank : blank;
    let body = `<section class="panel narrow"><h2>${id > 0 ? 'Редактировать мероприятие' : 'Создать мероприятие'}</h2>`;
    body += '<form method="post" class="form-grid">';
    body += `${csrfField(this.session)}<input type="hidden" name="action" value="save_event"><input type="hidden" name="_return" value="/?page=events"><input type="hidden" name="id" value="${Number(event.id)}">`;
    body += this.input('Название', 'title', event.title, true);
    body += this.input('Slug', 'slug', event.slug, true);
    body += this.textarea('Описание для бота', 'description', event.description);
    body += this.input('Начало', 'date_start', this.datetimeLocal(event.date_start), true, 'datetime-local');
    body += this.input('Окончание', 'date_end', this.datetimeLocal(event.date_end), true, 'datetime-local');
    body += this.input('Старт онлайна', 'online_start', this.datetimeLocal(event.online_start), false, 'datetime-local');
    body += this.input('Адрес', 'address', event.address);
    body += `<div class="form-row two">${this.input('Широта', 'venue_lat', event.venue_lat, false, 'text', true)}${this.input('Долгота', 'venue_lng', event.venue_lng, false, 'text', true)}</div>`;
    body += this.input('Лимит офлайн-мест', 'offline_capacity', event.offline_capacity, false, 'number');
    body += this.input('Facecast event id', 'facecast_event_id', event.facecast_event_id);
    body += this.input('Ссылка Facecast', 'facecast_url', event.facecast_url, false, 'url');
    body += this.input('Запись эфира', 'recording_url', event.recording_url, false, 'url');
    body += this.input('Фотоальбом', 'photo_album_url', event.photo_album_url, false, 'url');
    body += `<label class="check"><input type="checkbox" name="is_active" value="1" ${Number(event.is_active) === 1 ? 'checked' : ''}> Активно</label>`;
    return `${body}<div class="actions"><button class="button button-primary" type="submit">Сохранить</button><a class="button" href="/?page=events">Назад</a></div></form></section>`;
  }

  async peoplePage() {
    const people = await query('SELECT * FROM people ORDER BY created_at DESC LIMIT 300');
    const histories = await this.peopleHistories(people);
    let body = '<section class="panel"><div class="panel-head"><h2>Люди</h2><span class="muted">Последние 300 контактов</span></div>';
    body += '<table><thead><tr><th>Контакт</th><th>Компания</th><th>Телефон</th><th>Email</th><th>Согласие</th><th>История</th></tr></thead><tbody>';
    for (const person of people) {
      const username = person.username ? `@${person.username}` : `ID ${person.telegram_id}`;
      body += `<tr><td><strong>${h(person.full_name)}</strong><div class="muted">${h(username)}</div></td>`;
      body += `<td>${h(person.company)}<div class="muted">${h(person.position_title)}</div></td><td>${h(person.phone)}</td><td>${h(person.email)}</td>`;
      body += `<td>${person.consent_accepted_at ? '<span class="badge ok">Есть</span>' : '<span class="badge warn">Нет</span>'}</td><td>${this.personHistory(histories.get(Number(person.id)) || [])}</td></tr>`;
    }
    return `${body}</tbody></table></section>`;
  }

  async peopleHistories(people) {
    if (people.length === 0) {
      return new Map();
    }

    const params = {};
    const placeholders = people.map((person, index) => {
      const key = `person${index}`;
      params[key] = Number(person.id);
      return `:${key}`;
    });
    const rows = await query(
      `SELECT r.person_id, r.attendance, r.status, r.created_at, r.updated_at, e.title
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.person_id IN (${placeholders.join(', ')})
       ORDER BY r.created_at DESC, r.id DESC`,
      params,
    );
    const histories = new Map();

    for (const row of rows) {
      const personId = Number(row.person_id);
      if (!histories.has(personId)) histories.set(personId, []);
      const entries = histories.get(personId);

      if (row.attendance === 'online') {
        entries.push({
          type: 'online',
          date: row.created_at,
          title: row.title,
          label: 'Зарегистрировался онлайн',
        });
      } else {
        entries.push({
          type: 'offline',
          date: row.created_at,
          title: row.title,
          label: 'Зарегистрировался на мероприятие',
        });
        if (row.status === 'visited') {
          entries.push({
            type: 'visited',
            date: row.updated_at || row.created_at,
            title: row.title,
            label: 'Пришел на мероприятие',
          });
        }
      }
    }

    for (const entries of histories.values()) {
      entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    return histories;
  }

  personHistory(entries) {
    if (entries.length === 0) {
      return '<span class="muted">Пока нет действий</span>';
    }

    let body = '<ol class="person-history">';
    for (const entry of entries) {
      body += `<li class="person-history-item type-${h(entry.type)}"><span class="history-dot"></span><div><strong>${h(entry.label)}</strong><span>${h(entry.title)}</span><time>${h(this.dateTime(entry.date))}</time></div></li>`;
    }
    return `${body}</ol>`;
  }

  async registrationsPage(url) {
    const eventId = Number(url.searchParams.get('event_id') || 0);
    const view = ['all', 'online', 'offline', 'archived'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'all';
    const layout = ['list', 'kanban'].includes(url.searchParams.get('layout')) ? url.searchParams.get('layout') : (view === 'all' ? 'kanban' : 'list');
    const events = await query('SELECT id, title FROM events ORDER BY date_start DESC');
    const where = [];
    const params = {};
    if (eventId > 0) {
      where.push('r.event_id = :eventId');
      params.eventId = eventId;
    }
    if (view === 'online') where.push("r.attendance = 'online'");
    if (view === 'offline') where.push("r.attendance = 'offline'");
    if (view === 'archived') {
      where.push('r.archived_at IS NOT NULL');
    } else {
      where.push('r.archived_at IS NULL');
    }

    let sql = `SELECT r.*, p.full_name, p.company, p.position_title, p.phone, p.email, p.telegram_id, e.title, e.date_start, e.date_end, e.address
      FROM registrations r JOIN people p ON p.id = r.person_id JOIN events e ON e.id = r.event_id`;
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY r.created_at DESC LIMIT 500';
    const registrations = await query(sql, params);
    const counts = await this.registrationCounts(eventId);

    let body = `<section class="panel registrations-workspace"><div class="panel-head"><h2>Регистрации</h2><span class="muted">${registrations.length} записей</span></div>`;
    body += `<div class="registrations-toolbar">${this.registrationViewTabs(view, eventId, counts, layout)}${this.registrationLayoutToggle(view, eventId, layout)}</div>`;
    body += `<form class="filters" method="get"><input type="hidden" name="page" value="registrations"><input type="hidden" name="view" value="${h(view)}"><input type="hidden" name="layout" value="${h(layout)}"><label>Мероприятие<select name="event_id"><option value="0">Все</option>`;
    for (const event of events) {
      body += `<option value="${Number(event.id)}" ${eventId === Number(event.id) ? 'selected' : ''}>${h(event.title)}</option>`;
    }
    body += '</select></label><button class="button" type="submit">Показать</button></form>';
    body += layout === 'kanban' ? this.registrationsKanban(registrations, view) : this.registrationsTable(registrations, true);
    return `${body}</section>`;
  }

  async receptionPage(url) {
    const eventId = Number(url.searchParams.get('event_id') || 0);
    const events = await query('SELECT id, title, date_start FROM events ORDER BY date_start DESC');
    let registrations = [];
    let selectedEvent = null;
    if (eventId > 0) {
      selectedEvent = events.find((event) => Number(event.id) === eventId) || null;
      registrations = await query(
        `SELECT r.*, p.full_name, p.company, p.position_title, e.title, e.date_start
         FROM registrations r
         JOIN people p ON p.id = r.person_id
         JOIN events e ON e.id = r.event_id
         WHERE r.event_id = :eventId AND r.attendance = 'offline' AND r.status IN ('approved','visited') AND r.archived_at IS NULL
         ORDER BY CASE r.status WHEN 'approved' THEN 0 WHEN 'visited' THEN 1 ELSE 2 END, p.full_name ASC
         LIMIT 1000`,
        { eventId },
      );
    }
    const visited = registrations.filter((row) => row.status === 'visited').length;
    let body = `<section class="panel reception-workspace"><div class="panel-head"><h2>Ресепшн</h2><span class="muted">${eventId > 0 ? `${visited} из ${registrations.length} пришли` : 'Выберите мероприятие'}</span></div>`;
    body += '<form class="reception-filter" method="get" data-autosubmit-select><input type="hidden" name="page" value="reception">';
    body += '<label>Мероприятие<select name="event_id"><option value="0">Выберите мероприятие</option>';
    for (const event of events) {
      body += `<option value="${Number(event.id)}" ${eventId === Number(event.id) ? 'selected' : ''}>${h(`${event.title} - ${dateShort(event.date_start)}`)}</option>`;
    }
    body += '</select></label></form>';
    if (eventId <= 0) body += '<p class="empty">Выберите мероприятие, чтобы открыть список подтвержденных офлайн-гостей.</p>';
    else if (!selectedEvent) body += '<p class="empty">Мероприятие не найдено.</p>';
    else body += this.receptionChecklist(registrations, this.currentReceptionUrl(url));
    return `${body}</section>`;
  }

  async broadcastsPage() {
    const events = await query('SELECT id, title FROM events ORDER BY date_start DESC');
    const campaigns = await query('SELECT c.*, e.title AS event_title FROM broadcast_campaigns c LEFT JOIN events e ON e.id = c.event_id ORDER BY c.created_at DESC LIMIT 50');
    let body = '<section class="panel narrow"><h2>Новая рассылка</h2><form method="post" class="form-grid">';
    body += `${csrfField(this.session)}<input type="hidden" name="action" value="create_broadcast"><input type="hidden" name="_return" value="/?page=broadcasts">`;
    body += this.input('Название рассылки', 'title', '', true);
    body += '<label>Аудитория<select name="audience" required>';
    for (const [key, label] of Object.entries(this.audiences())) body += `<option value="${h(key)}">${h(label)}</option>`;
    body += '</select></label><label>Мероприятие<select name="event_id"><option value="0">Не привязывать</option>';
    for (const event of events) body += `<option value="${Number(event.id)}">${h(event.title)}</option>`;
    body += '</select></label><label>Тип<select name="content_type"><option value="text">Текст</option><option value="photo">Картинка + текст</option><option value="video_note">Кружок + текст</option></select></label>';
    body += this.textarea('Текст сообщения', 'body', '');
    body += this.input('Telegram file_id или URL медиа', 'media_file_id', '');
    body += '<p class="hint">Для картинки можно вставить HTTPS-ссылку или Telegram file_id. Для кружка нужен именно file_id: отправьте кружок боту от Telegram ID, указанного в ADMIN_TELEGRAM_IDS.</p>';
    body += '<div class="actions"><button class="button button-primary" type="submit">Поставить в очередь</button></div></form></section>';
    body += '<section class="panel"><h2>История рассылок</h2><table><thead><tr><th>Название</th><th>Аудитория</th><th>Статус</th><th>Создана</th></tr></thead><tbody>';
    const audiences = this.audiences();
    for (const campaign of campaigns) {
      body += `<tr><td><strong>${h(campaign.title)}</strong><div class="muted">${h(campaign.event_title)}</div></td><td>${h(audiences[campaign.audience] || campaign.audience)}</td><td>${h(campaign.status)}</td><td>${h(this.dateTime(campaign.created_at))}</td></tr>`;
    }
    return `${body}</tbody></table></section>`;
  }

  async flowPage() {
    const nodes = this.flowNodes();
    const edges = this.flowEdges();
    const users = await this.flowUsers(nodes);
    const queues = await this.flowQueues(nodes);
    let body = '<section class="panel flow-panel"><div class="panel-head"><h2>Сценарий бота</h2><span class="muted">Живая карта переходов</span></div>';
    body += '<div class="flow-legend"><span><i class="legend-dot users"></i>пользователи на этапе</span><span><i class="legend-dot queue"></i>запланированные сообщения</span><span><i class="legend-line"></i>переходы по кнопкам и действиям модератора</span></div>';
    body += `<div class="journey-board" style="--board-width: ${FLOW_BOARD_WIDTH}px; --board-height: ${FLOW_BOARD_HEIGHT}px;">`;
    body += this.flowScaffold();
    body += this.flowSvg(edges, nodes);
    for (const [id, node] of Object.entries(nodes)) {
      body += this.flowNode(id, node, users[id] || [], queues[id] || []);
    }
    return `${body}</div>${this.flowModal()}</section>`;
  }

  async simulatorPage() {
    this.ensureDevToolsEnabled();
    const simulator = this.simulatorState();
    const person = await queryOne('SELECT * FROM people WHERE telegram_id = :telegramId LIMIT 1', {
      telegramId: simulator.telegramId,
    });
    const registration = person
      ? await queryOne(
        `SELECT r.*, e.title
         FROM registrations r
         JOIN events e ON e.id = r.event_id
         WHERE r.person_id = :personId
         ORDER BY r.updated_at DESC
         LIMIT 1`,
        { personId: person.id },
      )
      : null;

    let body = '<section class="panel simulator-workspace">';
    body += '<div class="panel-head"><div><h2>Тест-чат</h2><span class="muted">Отдельный стенд для прохождения сценария бота</span></div>';
    body += `<form method="post">${csrfField(this.session)}<input type="hidden" name="action" value="seed_demo"><input type="hidden" name="_return" value="/?page=simulator"><button class="button" type="submit">Заполнить демо-данными</button></form></div>`;
    body += '<div class="simulator-grid">';
    body += '<aside class="simulator-side">';
    body += `<div class="simulator-stat"><span>Тестовый Telegram ID</span><strong>${Number(simulator.telegramId)}</strong></div>`;
    body += `<div class="simulator-stat"><span>Состояние профиля</span><strong>${h(person?.state || 'новый')}</strong></div>`;
    body += `<div class="simulator-stat"><span>Последняя регистрация</span><strong>${registration ? `${h(registration.title)} · ${h(this.registrationStatusPlain(registration))}` : 'нет'}</strong></div>`;
    body += `<form method="post" class="simulator-action">${csrfField(this.session)}<input type="hidden" name="action" value="simulator_reset"><input type="hidden" name="_return" value="/?page=simulator"><button class="button danger" type="submit">Сбросить тестовый чат</button></form>`;
    body += `<form method="post" class="simulator-action">${csrfField(this.session)}<input type="hidden" name="action" value="simulator_start"><input type="hidden" name="_return" value="/?page=simulator"><button class="button button-primary" type="submit">Запустить /start</button></form>`;
    body += '</aside>';
    body += '<div class="simulator-phone">';
    body += '<div class="simulator-phone-head"><strong>Megapolis Bot</strong><span>test mode</span></div>';
    body += '<div class="sim-chat-feed">';
    if (simulator.history.length === 0) {
      body += '<p class="sim-empty">Нажмите /start, чтобы начать тестовый диалог.</p>';
    } else {
      for (const message of simulator.history) body += this.simulatorBubble(message);
    }
    body += '</div>';
    body += `<form method="post" class="sim-chat-form">${csrfField(this.session)}<input type="hidden" name="action" value="simulator_send"><input type="hidden" name="_return" value="/?page=simulator"><input name="text" placeholder="Написать сообщение" autocomplete="off"><button class="button button-primary" type="submit">Отправить</button></form>`;
    body += '</div></div></section>';
    return body;
  }

  async seedDemo() {
    this.ensureDevToolsEnabled();
    const result = await seedDemoData();
    this.flash(`Демо-данные готовы: ${result.events} события, ${result.people} людей, ${result.registrations} регистраций`);
  }

  async resetSimulator() {
    this.ensureDevToolsEnabled();
    const simulator = this.simulatorState();
    const person = await queryOne('SELECT id FROM people WHERE telegram_id = :telegramId LIMIT 1', {
      telegramId: simulator.telegramId,
    });
    if (person) {
      await execute('DELETE FROM people WHERE id = :id', { id: person.id });
    }
    simulator.history = [];
    this.flash('Тестовый чат сброшен');
  }

  async sendSimulatorMessage(text) {
    this.ensureDevToolsEnabled();
    if (!text) {
      this.flash('Введите сообщение для тестового чата', 'error');
      return;
    }

    const simulator = this.simulatorState();
    this.pushSimulatorUserMessage(text);
    await this.runSimulatorUpdate({
      message: {
        message_id: simulator.history.length,
        date: Math.floor(Date.now() / 1000),
        text,
        chat: { id: simulator.telegramId, type: 'private' },
        from: this.simulatorFrom(),
      },
    });
  }

  async sendSimulatorContact() {
    this.ensureDevToolsEnabled();
    const simulator = this.simulatorState();
    const phone = '+7 999 777-55-33';
    this.pushSimulatorUserMessage(phone);
    await this.runSimulatorUpdate({
      message: {
        message_id: simulator.history.length,
        date: Math.floor(Date.now() / 1000),
        text: phone,
        contact: {
          phone_number: phone,
          first_name: 'Тестовый',
          last_name: 'Гость',
          user_id: simulator.telegramId,
        },
        chat: { id: simulator.telegramId, type: 'private' },
        from: this.simulatorFrom(),
      },
    });
  }

  async sendSimulatorCallback(data, label) {
    this.ensureDevToolsEnabled();
    if (!data) {
      return;
    }

    const simulator = this.simulatorState();
    this.pushSimulatorUserMessage(label || data, 'button');
    await this.runSimulatorUpdate({
      callback_query: {
        id: `sim-${Date.now()}`,
        data,
        from: this.simulatorFrom(),
        message: {
          message_id: simulator.history.length,
          chat: { id: simulator.telegramId, type: 'private' },
        },
      },
    });
  }

  async runSimulatorUpdate(update) {
    const simulator = this.simulatorState();
    const telegram = new SimulatorTelegramClient({
      history: simulator.history,
      captureChatId: simulator.telegramId,
    });
    await new BotController({ telegram }).handle(update);
  }

  async saveEvent(form) {
    const id = Number(form.id || 0);
    const data = {
      title: String(form.title || '').trim(),
      slug: String(form.slug || '').trim(),
      description: String(form.description || '').trim(),
      date_start: this.fromDatetimeLocal(form.date_start),
      date_end: this.fromDatetimeLocal(form.date_end),
      online_start: this.fromDatetimeLocal(form.online_start),
      address: String(form.address || '').trim(),
      venue_lat: form.venue_lat ? String(form.venue_lat) : null,
      venue_lng: form.venue_lng ? String(form.venue_lng) : null,
      offline_capacity: form.offline_capacity ? Number(form.offline_capacity) : null,
      facecast_event_id: String(form.facecast_event_id || '').trim(),
      facecast_url: String(form.facecast_url || '').trim(),
      recording_url: String(form.recording_url || '').trim(),
      photo_album_url: String(form.photo_album_url || '').trim(),
      is_active: form.is_active ? 1 : 0,
      now: nowSql(),
    };
    if (!data.title || !data.slug || !data.date_start || !data.date_end) {
      throw new Error('Заполните название, slug, начало и окончание');
    }
    if (id > 0) {
      await execute(
        `UPDATE events SET title = :title, slug = :slug, description = :description, date_start = :date_start,
         date_end = :date_end, online_start = :online_start, address = :address, venue_lat = :venue_lat,
         venue_lng = :venue_lng, offline_capacity = :offline_capacity, facecast_event_id = :facecast_event_id,
         facecast_url = :facecast_url, recording_url = :recording_url, photo_album_url = :photo_album_url,
         is_active = :is_active, updated_at = :now WHERE id = :id`,
        { ...data, id },
      );
    } else {
      await execute(
        `INSERT INTO events
         (title, slug, description, date_start, date_end, online_start, address, venue_lat, venue_lng,
          offline_capacity, facecast_event_id, facecast_url, recording_url, photo_album_url, is_active, created_at, updated_at)
         VALUES
         (:title, :slug, :description, :date_start, :date_end, :online_start, :address, :venue_lat, :venue_lng,
          :offline_capacity, :facecast_event_id, :facecast_url, :recording_url, :photo_album_url, :is_active, :now, :now)`,
        data,
      );
    }
    this.flash('Мероприятие сохранено');
  }

  async approveRegistration(form) {
    let registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration) throw new Error('Регистрация не найдена');
    await execute("UPDATE registrations SET status = 'approved', archived_at = NULL, approved_at = :now, updated_at = :now WHERE id = :id", {
      id: registration.id,
      now: nowSql(),
    });
    registration = await this.registrationWithDetails(Number(registration.id));
    await this.planner.planOfflineApproved(registration, registration);
    await this.sendOfflineApproved(registration);
    this.flash('Офлайн-регистрация подтверждена');
  }

  async rejectRegistration(form) {
    const registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration) throw new Error('Регистрация не найдена');
    await execute("UPDATE registrations SET status = 'rejected', archived_at = NULL, rejection_reason = :reason, updated_at = :now WHERE id = :id", {
      id: registration.id,
      reason: 'Места на офлайн закончились',
      now: nowSql(),
    });
    await this.sendOfflineRejected(registration);
    this.flash('Отказ отправлен участнику');
  }

  async archiveRegistration(form) {
    const registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration) throw new Error('Регистрация не найдена');
    await execute('UPDATE registrations SET archived_at = :now, updated_at = :now WHERE id = :id', {
      id: registration.id,
      now: nowSql(),
    });
    this.flash('Регистрация отправлена в архив');
  }

  async restoreRegistration(form) {
    const registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration) throw new Error('Регистрация не найдена');
    await execute('UPDATE registrations SET archived_at = NULL, updated_at = :now WHERE id = :id', {
      id: registration.id,
      now: nowSql(),
    });
    this.flash('Регистрация восстановлена');
  }

  async markVisited(form) {
    const registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration || registration.attendance !== 'offline') throw new Error('Офлайн-регистрация не найдена');
    await execute("UPDATE registrations SET status = 'visited', updated_at = :now WHERE id = :id", {
      id: registration.id,
      now: nowSql(),
    });
    this.flash('Гость отмечен как пришедший');
  }

  async undoVisited(form) {
    const registration = await this.registrationWithDetails(Number(form.id || 0));
    if (!registration || registration.attendance !== 'offline') throw new Error('Офлайн-регистрация не найдена');
    await execute("UPDATE registrations SET status = 'approved', updated_at = :now WHERE id = :id", {
      id: registration.id,
      now: nowSql(),
    });
    this.flash('Отметка прихода снята');
  }

  async createBroadcast(form) {
    const title = String(form.title || '').trim();
    const audience = String(form.audience || '');
    const eventId = Number(form.event_id || 0);
    const contentType = ['video_note', 'photo'].includes(form.content_type) ? form.content_type : 'text';
    const body = String(form.body || '').trim();
    const mediaFileId = String(form.media_file_id || '').trim();
    if (!title || (!body && !mediaFileId)) throw new Error('Заполните название и текст или file_id');

    const recipients = await this.broadcastRecipients(audience, eventId);
    await withTransaction(async (tx) => {
      const inserted = await tx.execute(
        `INSERT INTO broadcast_campaigns
         (title, audience, event_id, content_type, body, media_file_id, status, created_at, updated_at)
         VALUES (:title, :audience, :eventId, :contentType, :body, :mediaFileId, 'queued', :now, :now)`,
        {
          title,
          audience,
          eventId: eventId > 0 ? eventId : null,
          contentType,
          body,
          mediaFileId,
          now: nowSql(),
        },
      );
      for (const recipient of recipients) {
        await tx.execute(
          `${isSqlite() ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO broadcast_messages
           (campaign_id, person_id, telegram_id, status, created_at, updated_at)
           VALUES (:campaignId, :personId, :telegramId, 'queued', :now, :now)`,
          {
            campaignId: inserted.insertId,
            personId: recipient.id,
            telegramId: recipient.telegram_id,
            now: nowSql(),
          },
        );
      }
    });
    this.flash(`Рассылка поставлена в очередь: ${recipients.length} получателей`);
  }

  async registrationWithDetails(id) {
    return queryOne(
      `SELECT r.*, p.telegram_id, p.full_name, p.company, p.position_title, p.phone, p.email,
        e.id AS event_id, e.title, e.slug, e.description, e.date_start, e.date_end, e.online_start,
        e.address, e.venue_lat, e.venue_lng, e.facecast_event_id, e.facecast_url, e.recording_url, e.photo_album_url
       FROM registrations r
       JOIN people p ON p.id = r.person_id
       JOIN events e ON e.id = r.event_id
       WHERE r.id = :id LIMIT 1`,
      { id },
    );
  }

  async broadcastRecipients(audience, eventId) {
    const params = {};
    let sql = 'SELECT DISTINCT p.id, p.telegram_id FROM people p';
    if (audience !== 'all') {
      sql += ' JOIN registrations r ON r.person_id = p.id';
      params.eventId = eventId;
    }
    const where = ['p.consent_accepted_at IS NOT NULL'];
    if (audience !== 'all') {
      if (eventId <= 0) throw new Error('Для этой аудитории нужно выбрать мероприятие');
      where.push('r.event_id = :eventId', 'r.archived_at IS NULL');
    }
    if (audience === 'event_online') {
      where.push("r.attendance = 'online'", "r.status = 'approved'");
    } else if (audience === 'event_offline_approved') {
      where.push("r.attendance = 'offline'", "r.status = 'approved'");
    } else if (audience === 'event_offline_pending') {
      where.push("r.attendance = 'offline'", "r.status = 'pending'");
    } else if (audience === 'event_all') {
      where.push("r.status NOT IN ('cancelled','rejected')");
    }
    return query(`${sql} WHERE ${where.join(' AND ')} ORDER BY p.id ASC LIMIT 5000`, params);
  }

  async sendOfflineApproved(row) {
    const text = 'Готово, офлайн-участие подтверждено 🏢\n\n'
      + 'Ждём вас на мероприятии:\n'
      + `<b>Название:</b> ${h(row.title)}\n`
      + `<b>Дата:</b> ${h(dateShort(row.date_start))}\n`
      + `<b>Время:</b> ${h(timeRange(row.date_start, row.date_end))}\n`
      + `<b>Наш адрес:</b> ${h(row.address || '')}\n`
      + '<b>Формат:</b> офлайн\n\n'
      + 'Перед событием пришлём напоминание.';
    await this.telegram.sendMessage(Number(row.telegram_id), text);
    if (row.venue_lat !== null && row.venue_lng !== null) {
      await this.telegram.sendVenue(Number(row.telegram_id), Number(row.venue_lat), Number(row.venue_lng), 'Мегаполис Медиа', String(row.address || ''));
    }
  }

  async sendOfflineRejected(row) {
    if (!eventSupportsOnline(row)) {
      await this.telegram.sendMessage(
        Number(row.telegram_id),
        'К сожалению, сейчас не можем подтвердить офлайн-участие. Если появится альтернативный формат или новые места, мы сообщим.',
        this.mainMenuKeyboard(),
      );
      return;
    }
    await this.telegram.sendMessage(
      Number(row.telegram_id),
      'К сожалению, сейчас не можем подтвердить офлайн-участие, но вы можете присоединиться онлайн. Так вы точно не пропустите эфир 💻',
      { inline_keyboard: [[{ text: 'Буду смотреть онлайн', callback_data: `reg_online:${row.event_id}` }]] },
    );
  }

  async registrationCounts(eventId) {
    const where = eventId > 0 ? 'WHERE event_id = :eventId' : '';
    const row = await queryOne(
      `SELECT
        COALESCE(SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END), 0) AS total,
        COALESCE(SUM(CASE WHEN archived_at IS NULL AND attendance = 'online' THEN 1 ELSE 0 END), 0) AS online,
        COALESCE(SUM(CASE WHEN archived_at IS NULL AND attendance = 'offline' THEN 1 ELSE 0 END), 0) AS offline,
        COALESCE(SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS archived
       FROM registrations ${where}`,
      { eventId },
    );
    return {
      all: Number(row?.total || 0),
      online: Number(row?.online || 0),
      offline: Number(row?.offline || 0),
      archived: Number(row?.archived || 0),
    };
  }

  registrationViewTabs(view, eventId, counts, layout) {
    const tabs = { all: 'Все', online: 'Онлайн', offline: 'Офлайн', archived: 'Архив' };
    let body = '<nav class="view-tabs">';
    for (const [key, label] of Object.entries(tabs)) {
      body += `<a class="${view === key ? 'active' : ''}" href="${h(this.registrationsUrl(key, eventId, layout))}"><span>${h(label)}</span><strong>${Number(counts[key] || 0)}</strong></a>`;
    }
    return `${body}</nav>`;
  }

  registrationLayoutToggle(view, eventId, layout) {
    const labels = { list: 'Список', kanban: 'Канбан' };
    let body = '<nav class="layout-toggle" aria-label="Вид регистраций">';
    for (const [key, label] of Object.entries(labels)) {
      body += `<a class="${layout === key ? 'active' : ''}" href="${h(this.registrationsUrl(view, eventId, key))}">${h(label)}</a>`;
    }
    return `${body}</nav>`;
  }

  registrationsUrl(view, eventId, layout) {
    const params = new URLSearchParams({ page: 'registrations', view, layout });
    if (eventId > 0) params.set('event_id', String(eventId));
    return `/?${params.toString()}`;
  }

  currentRegistrationsUrl() {
    if (this.currentUrl && (this.currentUrl === '/' || this.currentUrl.startsWith('/?page=registrations'))) {
      return this.currentUrl;
    }
    return '/?page=registrations';
  }

  currentReceptionUrl(url) {
    const eventId = Number(url.searchParams.get('event_id') || 0);
    const params = new URLSearchParams({ page: 'reception' });
    if (eventId > 0) params.set('event_id', String(eventId));
    return `/?${params.toString()}`;
  }

  registrationsKanban(registrations, view) {
    const columns = view === 'archived'
      ? { archived: 'Архив' }
      : view === 'online'
      ? { online: 'Онлайн зарегистрированы' }
      : view === 'offline'
        ? { pending: 'На проверке', approved: 'Офлайн подтверждены', visited: 'Пришли', rejected: 'Отказ', cancelled: 'Отменены', no_show: 'Не пришли' }
        : { online: 'Онлайн', pending: 'На проверке', approved: 'Офлайн подтверждены', visited: 'Пришли', rejected: 'Отказ', cancelled: 'Отменены', no_show: 'Не пришли' };
    const grouped = Object.fromEntries(Object.keys(columns).map((key) => [key, []]));
    for (const row of registrations) {
      let key = view === 'archived' ? 'archived' : (row.attendance === 'online' ? 'online' : (Object.hasOwn(grouped, row.status) ? row.status : 'cancelled'));
      if (!Object.hasOwn(grouped, key)) key = Object.keys(grouped)[0];
      grouped[key].push(row);
    }
    for (const rows of Object.values(grouped)) rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    let body = `<div class="kanban" style="--kanban-columns: ${Object.keys(columns).length}">`;
    for (const [status, label] of Object.entries(columns)) {
      body += `<section class="kanban-column status-${h(status)}" data-kanban-column data-status="${h(status)}"><header><span>${h(label)}</span><strong>${grouped[status].length}</strong></header><div class="kanban-list" data-kanban-list>`;
      if (grouped[status].length === 0) body += '<p class="kanban-empty">Пусто</p>';
      for (const row of grouped[status]) body += this.registrationCard(row);
      body += '</div></section>';
    }
    return `${body}</div>`;
  }

  async registrationRow(id) {
    if (!id) return null;
    return queryOne(
      `SELECT r.*, p.full_name, p.company, p.position_title, p.phone, p.email, p.telegram_id, e.title, e.date_start, e.date_end, e.address
       FROM registrations r
       JOIN people p ON p.id = r.person_id
       JOIN events e ON e.id = r.event_id
       WHERE r.id = :id`,
      { id },
    );
  }

  registrationState(row) {
    if (row.archived_at) return 'archived';
    return row.attendance === 'online' ? 'online' : row.status;
  }

  registrationCard(row) {
    const attendance = row.attendance === 'offline' ? 'офлайн' : 'онлайн';
    const attendanceClass = row.attendance === 'offline' ? 'offline' : 'online';
    const state = this.registrationState(row);
    let body = `<article class="registration-card ${row.archived_at ? 'is-archived' : ''}" data-registration-card data-registration-id="${Number(row.id)}" data-status="${h(state)}" data-created-at="${h(row.created_at || '')}">`;
    body += `<div class="card-top"><span class="format-pill ${attendanceClass}">${h(attendance)}</span><span class="muted">${h(this.dateTime(row.created_at))}</span></div>`;
    body += `<h3>${h(row.full_name)}</h3><p class="card-company">${h(row.company)}</p>`;
    if (row.position_title) body += `<p class="muted">${h(row.position_title)}</p>`;
    body += `<dl><div><dt>Событие</dt><dd>${h(row.title)}</dd></div><div><dt>Телефон</dt><dd>${h(row.phone)}</dd></div><div><dt>Email</dt><dd>${h(row.email)}</dd></div></dl>`;
    const actions = this.registrationActions(row);
    if (actions !== '<span class="muted">-</span>') body += `<div class="card-actions">${actions}</div>`;
    return `${body}</article>`;
  }

  registrationsTable(registrations, withActions) {
    if (registrations.length === 0) return '<p class="empty">Пока нет записей.</p>';
    let body = '<table><thead><tr><th>Участник</th><th>Мероприятие</th><th>Формат</th><th>Статус</th><th>Дата</th>';
    if (withActions) body += '<th>Действия</th>';
    body += '</tr></thead><tbody>';
    for (const row of registrations) {
      body += this.registrationTableRow(row, withActions);
    }
    return `${body}</tbody></table>`;
  }

  registrationTableRow(row, withActions) {
    const attendance = row.attendance === 'offline' ? 'офлайн' : 'онлайн';
    const state = this.registrationState(row);
    let body = `<tr data-registration-row data-registration-id="${Number(row.id)}" data-status="${h(state)}" data-created-at="${h(row.created_at || '')}"><td><strong>${h(row.full_name)}</strong><div class="muted">${h(row.company)}</div><div class="muted">${h(row.email)}</div></td>`;
    body += `<td>${h(row.title)}</td><td>${h(attendance)}</td><td>${this.registrationStatusLabel(row)}</td><td>${h(this.dateTime(row.created_at))}</td>`;
    if (withActions) body += `<td class="actions-cell">${this.registrationActions(row)}</td>`;
    return `${body}</tr>`;
  }

  receptionChecklist(registrations, returnUrl) {
    if (registrations.length === 0) return '<p class="empty">Нет подтвержденных офлайн-гостей для ресепшна.</p>';
    const waiting = registrations
      .filter((row) => row.status !== 'visited')
      .sort((a, b) => this.receptionName(a).localeCompare(this.receptionName(b), 'ru'));
    const arrived = registrations
      .filter((row) => row.status === 'visited')
      .sort((a, b) => this.receptionName(a).localeCompare(this.receptionName(b), 'ru'));

    let body = '<div class="reception-list" data-reception-board>';
    body += this.receptionGroup('Ожидаем гостей', waiting, 'approved', returnUrl);
    body += this.receptionGroup('Пришли', arrived, 'visited', returnUrl);
    return `${body}</div>`;
  }

  receptionGroup(title, registrations, status, returnUrl) {
    let body = `<section class="reception-group" data-reception-group data-status="${h(status)}"><header><span>${h(title)}</span><strong>${registrations.length}</strong></header><div class="reception-group-list" data-reception-list data-status="${h(status)}">`;
    if (registrations.length === 0) body += '<p class="reception-empty">Пусто</p>';
    for (const row of registrations) {
      const visited = row.status === 'visited';
      const statusKey = visited ? 'visited' : 'approved';
      body += `<article class="reception-row ${visited ? 'is-visited' : ''}" data-reception-row data-status="${h(statusKey)}" data-person-name="${h(this.receptionName(row))}"><div class="reception-main"><strong>${h(row.full_name)}</strong><span>${h(row.company)}</span><span class="muted">${h(row.position_title)}</span></div><div class="reception-action">${this.visitToggleForm(row, visited, returnUrl)}</div></article>`;
    }
    return `${body}</div></section>`;
  }

  receptionName(row) {
    return String(row.full_name || '').trim().toLocaleLowerCase('ru-RU');
  }

  visitToggleForm(row, visited, returnUrl = null) {
    const action = visited ? 'undo_visited' : 'mark_visited';
    const label = visited ? 'Пришел' : 'Отметить приход';
    const targetStatus = visited ? 'approved' : 'visited';
    const ret = returnUrl || this.currentRegistrationsUrl();
    return `<form method="post" class="inline-form" data-reception-action="${h(action)}" data-target-status="${h(targetStatus)}">${csrfField(this.session)}<input type="hidden" name="action" value="${h(action)}"><input type="hidden" name="_return" value="${h(ret)}"><input type="hidden" name="id" value="${Number(row.id)}"><button class="checkin-toggle ${visited ? 'is-on' : ''}" type="submit"><span class="check-box"></span>${h(label)}</button></form>`;
  }

  registrationActions(row) {
    if (row.archived_at) {
      return this.registrationActionForm(row, 'restore_registration', 'Восстановить', 'button button-primary', row.attendance === 'online' ? 'online' : row.status);
    }

    const actions = [];
    const ret = this.currentRegistrationsUrl();
    if (row.attendance === 'offline' && row.status === 'pending') {
      actions.push(this.registrationActionForm(row, 'approve_registration', 'Подтвердить', 'button button-primary', 'approved', ret));
      actions.push(this.registrationActionForm(row, 'reject_registration', 'Отказать', 'button danger', 'rejected', ret));
    }
    actions.push(this.registrationActionForm(row, 'archive_registration', 'В архив', 'button muted-button', 'archived', ret));
    return actions.length > 0 ? actions.join('') : '<span class="muted">-</span>';
  }

  registrationActionForm(row, action, label, buttonClass, targetStatus, returnUrl = null) {
    const ret = returnUrl || this.currentRegistrationsUrl();
    return `<form method="post" class="inline-form" data-registration-action="${h(action)}" data-target-status="${h(targetStatus || '')}">${csrfField(this.session)}<input type="hidden" name="action" value="${h(action)}"><input type="hidden" name="_return" value="${h(ret)}"><input type="hidden" name="id" value="${Number(row.id)}"><button class="${h(buttonClass)}" type="submit">${h(label)}</button></form>`;
  }

  audiences() {
    return {
      all: 'Все контакты',
      event_all: 'Все участники события',
      event_online: 'Онлайн-участники события',
      event_offline_approved: 'Подтвержденный офлайн',
      event_offline_pending: 'Офлайн на модерации',
    };
  }

  statusLabel(status) {
    const labels = {
      pending: '<span class="badge warn">На проверке</span>',
      approved: '<span class="badge ok">Подтверждено</span>',
      visited: '<span class="badge ok">Пришел</span>',
      no_show: '<span class="badge danger">Не пришел</span>',
      rejected: '<span class="badge danger">Отказ</span>',
      cancelled: '<span class="badge">Отменено</span>',
    };
    return labels[status] || `<span class="badge">${h(status)}</span>`;
  }

  registrationStatusLabel(row) {
    if (row.archived_at) return '<span class="badge">Архив</span>';
    if (row.attendance === 'online' && row.status === 'approved') return '<span class="badge ok">Зарегистрирован</span>';
    return this.statusLabel(row.status);
  }

  input(label, name, value = '', required = false, type = 'text') {
    return `<label>${h(label)}<input type="${h(type)}" name="${h(name)}" value="${h(value ?? '')}" ${required ? 'required' : ''}></label>`;
  }

  textarea(label, name, value = '') {
    return `<label>${h(label)}<textarea name="${h(name)}" rows="8">${h(value ?? '')}</textarea></label>`;
  }

  datetimeLocal(value) {
    if (!value) return '';
    const date = parseDate(value);
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  fromDatetimeLocal(value) {
    if (!value) return null;
    return formatSqlDate(new Date(String(value)));
  }

  dateTime(value) {
    if (!value) return '';
    const date = parseDate(value);
    return `${date.toLocaleDateString('ru-RU')} ${timeOnly(date)}`;
  }

  mainMenuKeyboard() {
    return { inline_keyboard: [[{ text: 'Главное меню', callback_data: 'main_menu' }]] };
  }

  registrationStatusPlain(row) {
    if (row.archived_at) return 'в архиве';
    if (row.attendance === 'online' && row.status === 'approved') return 'онлайн зарегистрирован';
    const labels = {
      pending: 'на проверке',
      approved: 'подтверждено',
      visited: 'пришел',
      no_show: 'не пришел',
      rejected: 'отказ',
      cancelled: 'отменено',
    };
    return labels[row.status] || String(row.status || '');
  }

  simulatorState() {
    if (!this.session.simulator) {
      const seed = Number.parseInt(String(this.session.id || '0').slice(0, 8), 16) || Date.now();
      this.session.simulator = {
        telegramId: 920000000 + (seed % 999999),
        history: [],
      };
    }

    if (!Array.isArray(this.session.simulator.history)) {
      this.session.simulator.history = [];
    }

    return this.session.simulator;
  }

  simulatorFrom() {
    const simulator = this.simulatorState();
    return {
      id: simulator.telegramId,
      is_bot: false,
      first_name: 'Тестовый',
      last_name: 'Гость',
      username: `test_guest_${simulator.telegramId}`,
      language_code: 'ru',
    };
  }

  pushSimulatorUserMessage(text, type = 'message') {
    const simulator = this.simulatorState();
    simulator.history.push({
      id: `${Date.now()}-${simulator.history.length + 1}`,
      at: new Date().toISOString(),
      direction: 'user',
      type,
      text,
    });
  }

  simulatorBubble(message) {
    const isUser = message.direction === 'user';
    let body = `<article class="sim-bubble ${isUser ? 'is-user' : 'is-bot'}">`;
    if (message.type === 'venue') {
      body += '<span class="sim-kind">Карта</span>';
    } else if (message.type === 'photo') {
      body += '<span class="sim-kind">Картинка</span>';
    } else if (message.type === 'video_note') {
      body += '<span class="sim-kind">Кружок</span>';
    } else if (message.type === 'button') {
      body += '<span class="sim-kind">Нажата кнопка</span>';
    }
    body += `<div class="sim-text">${this.telegramHtml(message.text || '')}</div>`;
    if (message.media) {
      body += `<div class="sim-media">${h(message.media)}</div>`;
    }
    body += this.simulatorButtons(message.replyMarkup);
    return `${body}</article>`;
  }

  simulatorButtons(replyMarkup = {}) {
    if (!replyMarkup || Object.keys(replyMarkup).length === 0) {
      return '';
    }

    if (Array.isArray(replyMarkup.inline_keyboard)) {
      let body = '<div class="sim-buttons">';
      for (const row of replyMarkup.inline_keyboard) {
        for (const button of row) {
          if (button.url) {
            body += `<a class="sim-button" href="${h(button.url)}" target="_blank" rel="noreferrer">${h(button.text)}</a>`;
          } else if (button.callback_data) {
            body += `<form method="post">${csrfField(this.session)}<input type="hidden" name="action" value="simulator_callback"><input type="hidden" name="_return" value="/?page=simulator"><input type="hidden" name="data" value="${h(button.callback_data)}"><input type="hidden" name="label" value="${h(button.text)}"><button class="sim-button" type="submit">${h(button.text)}</button></form>`;
          }
        }
      }
      return `${body}</div>`;
    }

    if (Array.isArray(replyMarkup.keyboard)) {
      let body = '<div class="sim-buttons">';
      for (const row of replyMarkup.keyboard) {
        for (const button of row) {
          const text = typeof button === 'string' ? button : button.text;
          const action = button.request_contact ? 'simulator_contact' : 'simulator_send';
          body += `<form method="post">${csrfField(this.session)}<input type="hidden" name="action" value="${h(action)}"><input type="hidden" name="_return" value="/?page=simulator">`;
          if (!button.request_contact) body += `<input type="hidden" name="text" value="${h(text)}">`;
          body += `<button class="sim-button" type="submit">${h(text)}</button></form>`;
        }
      }
      return `${body}</div>`;
    }

    return '';
  }

  telegramHtml(text) {
    return h(text)
      .replaceAll('&lt;b&gt;', '<b>')
      .replaceAll('&lt;/b&gt;', '</b>')
      .replaceAll('&lt;strong&gt;', '<strong>')
      .replaceAll('&lt;/strong&gt;', '</strong>')
      .replaceAll('&lt;code&gt;', '<code>')
      .replaceAll('&lt;/code&gt;', '</code>');
  }

  adminTelegramClient() {
    const simulator = this.session?.simulator;
    if (!simulator?.telegramId || !Array.isArray(simulator.history)) {
      return new TelegramClient();
    }

    return new SimulatorTelegramClient({
      history: simulator.history,
      captureChatId: simulator.telegramId,
      fallback: new TelegramClient(),
    });
  }

  ensureDevToolsEnabled() {
    if (!config.devTools.enabled) {
      throw new Error('Тестовый стенд отключен');
    }
  }

  pageTitle(page) {
    return {
      events: 'Мероприятия',
      event_edit: 'Мероприятие',
      people: 'Люди',
      registrations: 'Регистрации',
      reception: 'Ресепшн',
      broadcasts: 'Рассылки',
      flow: 'Сценарий',
      simulator: 'Тест-чат',
    }[page] || 'Регистрации';
  }

  flash(message, type = 'ok') {
    this.session.flash = { message, type };
  }

  layout(title, content, page) {
    const flash = this.session.flash;
    this.session.flash = null;
    const pageClass = String(page || 'registrations').replace(/[^a-z0-9_-]+/gi, '-') || 'registrations';
    const activePage = page === 'event_edit' ? 'events' : page;
    let body = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    body += `<title>${h(title)} - Megapolis Bot</title><script>try{if(localStorage.getItem("mm_sidebar_collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}</script><link rel="stylesheet" href="/assets/admin.css"></head><body class="admin-page admin-page-${h(pageClass)}">`;
    body += `<aside class="sidebar"><div class="sidebar-head"><div class="brand"><span class="brand-mark">MM</span><span class="brand-text">Megapolis Bot</span></div><button class="sidebar-toggle" type="button" aria-label="Свернуть меню" aria-expanded="true" title="Свернуть меню">${this.icon('panel')}</button></div><nav>`;
    for (const item of [
      ['registrations', '/', 'Регистрации', 'registrations'],
      ['reception', '/?page=reception', 'Ресепшн', 'reception'],
      ['people', '/?page=people', 'Люди', 'people'],
      ['events', '/?page=events', 'Мероприятия', 'events'],
      ['broadcasts', '/?page=broadcasts', 'Рассылки', 'broadcasts'],
      ['flow', '/?page=flow', 'Сценарий', 'flow'],
      ...(config.devTools.enabled ? [['simulator', '/?page=simulator', 'Тест-чат', 'simulator']] : []),
    ]) {
      const [key, href, label, icon] = item;
      body += `<a${activePage === key ? ' class="active"' : ''} href="${h(href)}" title="${h(label)}">${this.icon(icon)}<span class="nav-label">${h(label)}</span></a>`;
    }
    body += `</nav><a class="logout" href="/?action=logout" title="Выйти">${this.icon('logout')}<span class="nav-label">Выйти</span></a></aside>`;
    body += `<main class="main"><header class="topbar"><h1>${h(title)}</h1><span>${h(config.appUrl)}</span></header>`;
    if (flash) body += `<div class="notice notice-${h(flash.type)}">${h(flash.message)}</div>`;
    return `${body}<div class="main-content">${content}</div></main><script src="/assets/admin.js"></script></body></html>`;
  }

  icon(name) {
    const paths = {
      registrations: '<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 9h8M8 13h5"></path>',
      reception: '<path d="M9 11l2 2 4-5"></path><rect x="5" y="4" width="14" height="16" rx="2"></rect><path d="M9 18h6"></path>',
      people: '<path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4"></path><circle cx="12" cy="9" r="3"></circle><path d="M20 19c0-1.8-1.1-3.2-2.7-3.8M16.5 6.4a2.5 2.5 0 0 1 0 4.2"></path>',
      events: '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"></path>',
      broadcasts: '<path d="M4 12h3l9-5v10l-9-5H4z"></path><path d="M18 9.5a4 4 0 0 1 0 5"></path>',
      flow: '<circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle><path d="M8 6h8M7 8l4 8M17 8l-4 8"></path>',
      simulator: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-5 4v-4.5A2.5 2.5 0 0 1 4 13.5z"></path><path d="M8 9h8M8 12h5"></path>',
      logout: '<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M14 4h5v16h-5"></path>',
      panel: '<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M10 5v14M14 9l-3 3 3 3"></path>',
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || '<circle cx="12" cy="12" r="6"></circle>'}</svg>`;
  }

  flowScaffold() {
    const lanes = [
      ['Общий путь регистрации', 116, 356],
      ['Офлайн-гости и ресепшн', 510, 356],
      ['Онлайн, напоминания и материалы', 904, 516],
    ];
    const columns = [
      ['Старт', 96],
      ['Согласие', 560],
      ['Анкета', 1024],
      ['Событие', 1488],
      ['Выбор формата', 1952],
      ['Подтверждение', 2416],
      ['День события', 2880],
      ['Материалы', 3344],
    ];
    let body = '<div class="flow-scaffold" aria-hidden="true">';
    for (const [title, top, height] of lanes) body += `<div class="flow-lane" style="top:${top}px;height:${height}px;"><span>${h(title)}</span></div>`;
    for (const [title, x] of columns) body += `<div class="flow-column-marker" style="left:${x}px;">${h(title)}</div>`;
    return `${body}</div>`;
  }

  flowNodes() {
    return {
      start: this.flowNodeData('1', 'Первое касание', 'Бот', 96, 154, [['/start', 'Здравствуйте! Это бот Мегаполис Медиа 👋\n\nЗдесь можно зарегистрироваться на наши митапы, эфиры и деловые встречи.\n\nДавайте познакомимся, чтобы мы могли корректно оформить вашу регистрацию.']], ['Зарегистрироваться', 'Главное меню']),
      consent: this.flowNodeData('2', 'Согласие', 'Данные', 560, 154, [['Перед анкетой', `Перед регистрацией нужно согласие на обработку персональных данных.\n\nМы будем использовать ФИО, компанию, должность, телефон и email для регистрации на мероприятия, коммуникации, допуска к эфиру и отправки материалов.\n\nПолный текст: ${config.links.privacy}`]], ['Даю согласие', 'Главное меню']),
      profile: this.flowNodeData('3', 'Анкета', 'Данные', 1024, 154, [['Имя', 'Спасибо! Давайте познакомимся 🙂 Напишите, пожалуйста, имя и фамилию.'], ['Компания', 'Из какой вы компании?'], ['Должность', 'А какая у вас должность?'], ['Телефон', 'Поделитесь, пожалуйста, номером телефона. Можно отправить его кнопкой ниже.'], ['Email', 'И последний шаг: напишите вашу почту.'], ['Финал анкеты', 'Готово, спасибо! Теперь можно выбрать мероприятие ✨']], ['Ответ текстом', 'Отправить телефон']),
      events: this.flowNodeData('4', 'Выбор мероприятия', 'Регистрация', 1488, 154, [['Список событий', 'Выберите мероприятие, на которое хотите зарегистрироваться.\n\nАдрес на этом шаге не показываем: человек сначала выбирает событие.'], ['Если событий нет', 'Пока ближайших мероприятий нет. Как только появится новое событие, мы обязательно расскажем 🙂']], ['Выбрать событие', 'Главное меню']),
      format_choice: this.flowNodeData('5', 'Выбор формата', 'Регистрация', 1952, 154, [['После выбора события', 'Отлично, вот что запланировано:\n\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nФормат: {офлайн + онлайн / только офлайн / только онлайн}\n\n{описание мероприятия}\n\nВыберите удобный формат участия:']], ['Прийти офлайн', 'Смотреть онлайн', 'Главное меню']),
      offline_pending: this.flowNodeData('6A', 'Офлайн на проверке', 'Модерация', 2416, 154, [['После выбора офлайна', 'Спасибо, заявка на офлайн-участие принята 🏢\n\nОрганизаторы проверят список гостей и пришлют подтверждение. Адрес и детали площадки отправим после подтверждения участия.']], ['Модератор: подтвердить', 'Модератор: отказ']),
      offline_rejected: this.flowNodeData('6A-', 'Офлайн отказ', 'Модерация', 2880, 154, [['Отказ модератора', 'К сожалению, сейчас не можем подтвердить офлайн-участие, но вы можете присоединиться онлайн. Так вы точно не пропустите эфир 💻']], ['Буду смотреть онлайн']),
      offline_approved: this.flowNodeData('7A', 'Офлайн подтвержден', 'Офлайн', 2416, 548, [['Подтверждение модератора', 'Готово, офлайн-участие подтверждено 🏢\n\nЖдём вас на мероприятии:\nНазвание: {название}\nДата: {дата}\nВремя: {время}\nНаш адрес: {адрес}\nФормат: офлайн\n\nПеред событием пришлём напоминание.'], ['Если есть координаты', 'После сообщения бот отправляет venue-карту с адресом площадки.']], ['Ресепшн', 'Напоминания']),
      reception: this.flowNodeData('7B', 'Ресепшн', 'Офлайн', 2880, 548, [['Системное действие', 'Пользователю сообщение не отправляется. Модератор на ресепшне ставит галочку в админке.']], ['Отметить приход']),
      visited: this.flowNodeData('7C', 'Пришел', 'Офлайн', 3344, 548, [['Системное действие', 'Статус нужен для отчетности и дальнейшей рассылки материалов.']], ['Постпромо']),
      online_access: this.flowNodeData('6B', 'Онлайн зарегистрирован', 'Онлайн', 2416, 942, [['Доступ к эфиру', 'Готово, вы зарегистрированы онлайн! 💻\n\nДанные для подключения:\n{персональная ссылка / логин и пароль, если эфир работает по паролю}\nНазвание: {название}\nДата: {дата}\nВремя подключения: {время старта онлайна}\n\nСохраните сообщение, а перед эфиром мы напомним о старте.']], ['Ссылка на эфир', 'Напомнить доступ']),
      reminders: this.flowNodeData('8', 'Напоминания', 'Автоматизация', 2880, 942, [['Офлайн за день', 'Напоминаем о встрече завтра 🏢'], ['Офлайн за 2 часа', 'До офлайн-встречи осталось около двух часов 🙂'], ['Онлайн за 15 минут', 'Напоминаем про эфир: начинаем через 15 минут 💻'], ['Онлайн старт', 'Мы начали! Добро пожаловать в прямой эфир 💻']], ['Открыть эфир', 'Не смогу офлайн']),
      postpromo: this.flowNodeData('9', 'Постпромо', 'Материалы', 3344, 942, [['После события', 'Спасибо, что были с нами ✨\n\nДелимся материалами и яркими моментами прошедшего мероприятия.']], ['Ссылка на эфир', 'Подборка фото']),
      menu: this.flowNodeData('10', 'Главное меню', 'Навигация', 1488, 942, [['Главное меню', 'Что посмотрим дальше? Мы рядом в соцсетях и на сайте 🙂']], ['Телеграм канал', 'Сайт', 'Ближайшие мероприятия']),
    };
  }

  flowNodeData(step, title, phase, x, y, messages, options) {
    return { step, title, phase, x, y, messages: messages.map(([messageTitle, text]) => ({ title: messageTitle, text })), options };
  }

  flowEdges() {
    return [
      ['start', 'consent', 'Зарегистрироваться'],
      ['consent', 'profile', 'Даю согласие'],
      ['profile', 'events', 'Анкета заполнена'],
      ['events', 'format_choice', 'Выбрано событие'],
      ['format_choice', 'offline_pending', 'Прийти офлайн'],
      ['format_choice', 'online_access', 'Смотреть онлайн', 'bottom', 'left', [[2102, 852], [2292, 852], [2292, 1085]]],
      ['events', 'menu', 'Главное меню', 'bottom', 'top', [], { labelSide: 'right' }],
      ['offline_pending', 'offline_approved', 'Подтвердить', 'bottom', 'top', [], { labelSide: 'right' }],
      ['offline_pending', 'offline_rejected', 'Отказ'],
      ['offline_rejected', 'online_access', 'Буду онлайн', 'bottom', 'top', [[3030, 866], [2566, 866]], { labelSide: 'above' }],
      ['offline_approved', 'reception', 'День события'],
      ['reception', 'visited', 'Пришел'],
      ['offline_approved', 'reminders', 'Напоминания', 'bottom', 'top', [[2802, 858], [2802, 908], [3030, 908]], { labelSide: 'below' }],
      ['online_access', 'reminders', 'Напоминания'],
      ['reminders', 'online_access', 'Не смогу офлайн', 'bottom', 'bottom', [[3030, 1318], [2566, 1318]], { labelSide: 'below' }],
      ['reminders', 'postpromo', 'После события'],
      ['visited', 'postpromo', 'Материалы', 'bottom', 'top'],
      ['postpromo', 'menu', 'Главное меню', 'bottom', 'bottom', [[3494, 1374], [1638, 1374]], { labelSide: 'below' }],
    ].map(([from, to, label, fromAnchor = 'right', toAnchor = 'left', via = [], options = {}]) => ({ from, to, label, fromAnchor, toAnchor, via, ...options }));
  }

  flowSvg(edges, nodes) {
    let body = `<svg class="journey-lines" width="${FLOW_BOARD_WIDTH}" height="${FLOW_BOARD_HEIGHT}" viewBox="0 0 ${FLOW_BOARD_WIDTH} ${FLOW_BOARD_HEIGHT}" aria-hidden="true">`;
    body += '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><polygon points="0 0, 10 5, 0 10"></polygon></marker></defs>';
    for (const edge of edges) {
      const points = this.flowEdgePoints(edge, nodes);
      const path = this.flowPath(points);
      const [x, y] = points[0];
      body += '<g class="journey-edge">';
      body += `<path class="edge-halo" d="${h(path)}"></path><path class="edge-line" d="${h(path)}" marker-end="url(#arrow)"><title>${h(edge.label)}</title></path><circle class="connector-dot" cx="${x}" cy="${y}" r="3"></circle>`;
      body += this.flowEdgeLabel(edge, points);
      body += '</g>';
    }
    return `${body}</svg>`;
  }

  flowEdgePoints(edge, nodes) {
    return [
      this.flowAnchor(nodes[edge.from], edge.fromAnchor || 'right', 'from'),
      ...(edge.via || []),
      this.flowAnchor(nodes[edge.to], edge.toAnchor || 'left', 'to'),
    ];
  }

  flowAnchor(node, anchor, endpoint = 'from') {
    const x = Number(node.x);
    const y = Number(node.y);
    const centerX = x + FLOW_NODE_WIDTH / 2;
    const centerY = y + FLOW_NODE_HEIGHT / 2;
    const gap = endpoint === 'from' ? FLOW_CONNECTOR_GAP : 0;
    if (anchor === 'left') return [x - gap, centerY];
    if (anchor === 'top') return [centerX, y - gap];
    if (anchor === 'bottom') return [centerX, y + FLOW_NODE_HEIGHT + gap];
    return [x + FLOW_NODE_WIDTH + gap, centerY];
  }

  flowPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
    const radius = 22;
    let path = `M ${points[0][0]} ${points[0][1]}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const [prevX, prevY] = points[index - 1];
      const [x, y] = points[index];
      const [nextX, nextY] = points[index + 1];
      const before = this.roundedPoint(x, y, prevX, prevY, radius);
      const after = this.roundedPoint(x, y, nextX, nextY, radius);
      path += ` L ${before[0]} ${before[1]} Q ${x} ${y} ${after[0]} ${after[1]}`;
    }
    const last = points[points.length - 1];
    path += ` L ${last[0]} ${last[1]}`;
    return path;
  }

  roundedPoint(x, y, targetX, targetY, radius) {
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const offset = Math.min(radius, distance / 2);
    return [
      Math.round(x + (dx / distance) * offset),
      Math.round(y + (dy / distance) * offset),
    ];
  }

  flowEdgeLabel(edge, points) {
    if (!edge.label || points.length < 2) return '';
    const label = edge.shortLabel || edge.label;
    const width = Math.min(Math.max(label.length * 6.2 + 18, 54), 144);
    const height = 22;
    const placement = this.flowLabelPlacement(edge, points, width);
    return `<g class="edge-label"><rect x="${Math.round(placement.x - width / 2)}" y="${Math.round(placement.y - height / 2)}" width="${Math.round(width)}" height="${height}" rx="11"></rect><text x="${Math.round(placement.x)}" y="${Math.round(placement.y + 4)}" text-anchor="middle">${h(label)}</text></g>`;
  }

  flowLabelPlacement(edge, points, width) {
    let chosen = [points[0], points[1]];
    let chosenLength = 0;
    for (let index = 1; index < points.length; index += 1) {
      const segment = [points[index - 1], points[index]];
      const length = Math.hypot(segment[1][0] - segment[0][0], segment[1][1] - segment[0][1]);
      if (length > chosenLength) {
        chosen = segment;
        chosenLength = length;
      }
    }
    const dx = chosen[1][0] - chosen[0][0];
    const dy = chosen[1][1] - chosen[0][1];
    const isHorizontal = Math.abs(dx) >= Math.abs(dy);
    let x = (chosen[0][0] + chosen[1][0]) / 2;
    let y = (chosen[0][1] + chosen[1][1]) / 2;
    const side = edge.labelSide || (isHorizontal ? 'above' : 'right');

    if (isHorizontal) {
      y += side === 'below' ? FLOW_EDGE_LABEL_OFFSET : -FLOW_EDGE_LABEL_OFFSET;
    } else {
      const sideOffset = Math.max(FLOW_EDGE_LABEL_OFFSET, width / 2 + 14);
      x += side === 'left' ? -sideOffset : sideOffset;
    }

    return { x, y };
  }

  flowNode(id, node, users, queue) {
    let body = `<article class="journey-node" style="left:${Number(node.x)}px;top:${Number(node.y)}px;">`;
    body += `<div class="node-head"><span class="node-step">${h(node.step)}</span><span class="node-phase">${h(node.phase)}</span></div><h3>${h(node.title)}</h3>`;
    body += this.flowMessages(node.messages);
    body += '<div class="node-options">';
    for (const option of node.options) body += `<span>${h(option)}</span>`;
    body += `</div>${this.flowPeopleList('Сейчас здесь', users, 'users')}`;
    if (queue.length > 0) body += this.flowPeopleList('В очереди сообщений', queue, 'queue');
    return `${body}</article>`;
  }

  flowMessages(messages) {
    let body = '<div class="node-message-list"><strong>Сообщения пользователю</strong>';
    for (const message of messages) {
      body += `<button class="node-message-button" type="button" data-message-title="${h(message.title)}" data-message-text="${h(message.text)}"><span>${h(message.title)}</span><em>Открыть</em></button>`;
    }
    return `${body}</div>`;
  }

  flowModal() {
    return '<div class="flow-modal" hidden aria-hidden="true"><div class="flow-modal-backdrop" data-flow-modal-close></div><section class="flow-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title"><button class="flow-modal-close" type="button" data-flow-modal-close aria-label="Закрыть">×</button><span class="flow-modal-kicker">Сообщение пользователю</span><h3 id="flow-modal-title"></h3><div class="flow-modal-text"></div></section></div>';
  }

  flowPeopleList(title, people, type) {
    let body = `<div class="node-people ${h(type)}"><div><strong>${h(title)}</strong><span>${people.length}</span></div>`;
    if (people.length === 0 || type === 'queue') return `${body}</div>`;
    body += '<ul>';
    for (const person of people.slice(0, 3)) body += `<li>${h(person)}</li>`;
    if (people.length > 3) body += `<li>+${people.length - 3} еще</li>`;
    return `${body}</ul></div>`;
  }

  async flowUsers(nodes) {
    const users = Object.fromEntries(Object.keys(nodes).map((key) => [key, []]));
    const rows = await query(
      `SELECT p.id AS person_id, p.full_name, p.username, p.state, r.id AS registration_id,
        r.attendance, r.status, r.created_at AS registration_created_at, e.title AS event_title
       FROM people p
       LEFT JOIN registrations r ON r.person_id = p.id AND r.archived_at IS NULL
       LEFT JOIN events e ON e.id = r.event_id
       ORDER BY COALESCE(r.created_at, p.created_at) DESC
       LIMIT 1000`,
    );
    for (const row of rows) {
      const stage = this.flowStageForRow(row);
      const label = this.flowPersonLabel(row);
      if (!users[stage].includes(label)) users[stage].push(label);
    }
    return users;
  }

  async flowQueues(nodes) {
    const queues = Object.fromEntries(Object.keys(nodes).map((key) => [key, []]));
    const rows = await query(
      `SELECT sm.type, p.full_name, p.username, e.title AS event_title
       FROM scheduled_messages sm
       JOIN people p ON p.id = sm.person_id
       LEFT JOIN events e ON e.id = sm.event_id
       WHERE sm.sent_at IS NULL AND sm.failed_at IS NULL
       ORDER BY sm.send_at ASC
       LIMIT 200`,
    );
    for (const row of rows) {
      const stage = row.type === 'postpromo' ? 'postpromo' : 'reminders';
      let label = String(row.full_name || (row.username ? `@${row.username}` : 'ID')).trim();
      if (row.event_title) label += ` - ${row.event_title}`;
      queues[stage].push(label);
    }
    return queues;
  }

  flowStageForRow(row) {
    if (row.registration_id) {
      if (row.attendance === 'online') return 'online_access';
      return { pending: 'offline_pending', approved: 'offline_approved', visited: 'visited', rejected: 'offline_rejected' }[row.status] || 'menu';
    }
    return {
      awaiting_consent: 'consent',
      ask_name: 'profile',
      ask_company: 'profile',
      ask_position: 'profile',
      ask_phone: 'profile',
      ask_email: 'profile',
      registered: 'events',
    }[row.state] || 'start';
  }

  flowPersonLabel(row) {
    let name = String(row.full_name || (row.username ? `@${row.username}` : `ID ${row.person_id}`)).trim();
    if (row.event_title) name += ` - ${row.event_title}`;
    return name;
  }
}

function redirect(location) {
  return { status: 302, headers: { Location: location }, body: '' };
}

function json(payload, status = 200) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function html(body, status = 200) {
  return { status, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body };
}
