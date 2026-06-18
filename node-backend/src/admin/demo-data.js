import { execute, queryOne } from '../db/mysql.js';
import { RegistrationsRepository } from '../repositories/registrations-repository.js';
import { ReminderPlanner } from '../services/reminder-planner.js';
import { nowSql } from '../utils/dates.js';

const EVENTS = [
  {
    title: 'Митап: Человек труда',
    slug: 'mitap-chelovek-truda-2026-06-23',
    description: '⚡Как превратить человека труда в героя, и зачем это бизнесу\n\n🔗Кто такой человек труда сегодня, и как он меняется.\n🔗Как внедрять культуру признания в командах.\n🔗Как говорить с молодыми талантами и превращать профессию в выбор, а не в компромисс.\n🔗Какие нестандартные имиджевые инструменты помогают привлечь внимание к рабочим профессиям и повысить их статус.\n🔗Почему профессиональные праздники — это стратегический актив бизнеса.\n🔗Как вовлечь детей сотрудников и растить гордость за дело родителей.\n\n😊 Мегаполис Медиа напоминает: каждый человек труда достоин стать его героем.',
    date_start: '2026-06-23 17:30:00',
    date_end: '2026-06-23 21:00:00',
    online_start: '2026-06-23 18:00:00',
    address: 'Знаменка 13с1, этаж 7, офис 25',
    venue_lat: '55.7521910',
    venue_lng: '37.6049070',
    offline_capacity: 80,
    facecast_event_id: '186673',
    facecast_url: 'https://facecast.net/w/6k2njf',
    recording_url: 'https://megapolis.media/materials/labor-hero',
    photo_album_url: 'https://megapolis.media/photo/labor-hero',
  },
  {
    title: 'Онлайн-эфир: Медиа для HR-бренда',
    slug: 'online-hr-brand-media-2026-06-26',
    description: 'Практический эфир о том, как превращать корпоративные истории в сильный HR-контент и поддерживать интерес аудитории после трансляции.',
    date_start: '2026-06-26 16:00:00',
    date_end: '2026-06-26 18:00:00',
    online_start: '2026-06-26 16:00:00',
    address: '',
    venue_lat: null,
    venue_lng: null,
    offline_capacity: null,
    facecast_event_id: 'demo-hr-brand',
    facecast_url: 'https://facecast.net/demo/megapolis-hr-brand',
    recording_url: 'https://megapolis.media/materials/hr-brand',
    photo_album_url: '',
  },
  {
    title: 'Закрытая офлайн-встреча: Коммуникации производства',
    slug: 'offline-production-comms-2026-06-30',
    description: 'Камерная встреча для коммуникационных команд промышленных компаний: кейсы, вопросы к экспертам и нетворкинг.',
    date_start: '2026-06-30 18:30:00',
    date_end: '2026-06-30 21:00:00',
    online_start: null,
    address: 'Знаменка 13с1, этаж 7, офис 25',
    venue_lat: '55.7521910',
    venue_lng: '37.6049070',
    offline_capacity: 35,
    facecast_event_id: '',
    facecast_url: '',
    recording_url: '',
    photo_album_url: 'https://megapolis.media/photo/production-comms',
  },
];

const PEOPLE = [
  ['demo_anna', 910001, 'Анна Смирнова', 'Северсталь', 'Руководитель внутренних коммуникаций', '+7 999 100-10-01', 'anna.demo@example.com'],
  ['demo_sergey', 910002, 'Сергей Орлов', 'НЛМК', 'HR BP', '+7 999 100-10-02', 'sergey.demo@example.com'],
  ['demo_maria', 910003, 'Мария Кузнецова', 'РЖД', 'PR-директор', '+7 999 100-10-03', 'maria.demo@example.com'],
  ['demo_dmitry', 910004, 'Дмитрий Егоров', 'Ростех', 'Руководитель проекта', '+7 999 100-10-04', 'dmitry.demo@example.com'],
  ['demo_irina', 910005, 'Ирина Морозова', 'Сибур', 'Event-менеджер', '+7 999 100-10-05', 'irina.demo@example.com'],
  ['demo_pavel', 910006, 'Павел Никифоров', 'Газпром нефть', 'Специалист по бренду работодателя', '+7 999 100-10-06', 'pavel.demo@example.com'],
  ['demo_olga', 910007, 'Ольга Ветрова', 'Металлоинвест', 'Коммуникационный стратег', '+7 999 100-10-07', 'olga.demo@example.com'],
  ['demo_elena', 910008, 'Елена Алексеева', 'ЕВРАЗ', 'Директор по персоналу', '+7 999 100-10-08', 'elena.demo@example.com'],
  ['demo_artem', 910009, 'Артем Волков', 'ПромМедиа', 'Продюсер эфиров', '+7 999 100-10-09', 'artem.demo@example.com'],
];

const REGISTRATIONS = [
  ['demo_anna', 'mitap-chelovek-truda-2026-06-23', 'offline', 'pending'],
  ['demo_sergey', 'mitap-chelovek-truda-2026-06-23', 'offline', 'pending'],
  ['demo_maria', 'mitap-chelovek-truda-2026-06-23', 'offline', 'approved'],
  ['demo_dmitry', 'mitap-chelovek-truda-2026-06-23', 'offline', 'approved'],
  ['demo_irina', 'mitap-chelovek-truda-2026-06-23', 'offline', 'visited'],
  ['demo_pavel', 'mitap-chelovek-truda-2026-06-23', 'online', 'approved'],
  ['demo_olga', 'online-hr-brand-media-2026-06-26', 'online', 'approved'],
  ['demo_elena', 'mitap-chelovek-truda-2026-06-23', 'offline', 'rejected'],
  ['demo_artem', 'offline-production-comms-2026-06-30', 'offline', 'approved'],
];

export async function seedDemoData() {
  const eventIds = {};
  for (const event of EVENTS) {
    eventIds[event.slug] = await upsertEvent(event);
  }

  const peopleIds = {};
  for (const person of PEOPLE) {
    peopleIds[person[0]] = await upsertPerson(person);
  }

  const registrations = new RegistrationsRepository();
  const planner = new ReminderPlanner();
  for (const [personKey, eventSlug, attendance, status] of REGISTRATIONS) {
    const personId = peopleIds[personKey];
    const eventId = eventIds[eventSlug];
    let registration = await registrations.upsert(personId, eventId, attendance, status);
    const extra = extraRegistrationFields(personKey, attendance, status);
    await registrations.update(registration.id, extra);
    if (['visited', 'no_show'].includes(status)) {
      await execute('UPDATE registrations SET status = :status, updated_at = :now WHERE id = :id', {
        id: registration.id,
        status,
        now: nowSql(),
      });
    }
    registration = await registrations.findById(registration.id);
    const event = await queryOne('SELECT * FROM events WHERE id = :id LIMIT 1', { id: eventId });
    if (attendance === 'online' && status === 'approved') {
      await planner.planOnline(registration, event);
    }
    if (attendance === 'offline' && ['approved', 'visited'].includes(status)) {
      await planner.planOfflineApproved(registration, event);
    }
  }

  await upsertDemoBroadcast(eventIds['mitap-chelovek-truda-2026-06-23']);

  return {
    events: EVENTS.length,
    people: PEOPLE.length,
    registrations: REGISTRATIONS.length,
  };
}

async function upsertEvent(event) {
  const existing = await queryOne('SELECT id FROM events WHERE slug = :slug LIMIT 1', { slug: event.slug });
  const now = nowSql();
  const params = {
    ...event,
    is_active: 1,
    now,
  };

  if (existing) {
    await execute(
      `UPDATE events SET
        title = :title,
        description = :description,
        date_start = :date_start,
        date_end = :date_end,
        online_start = :online_start,
        address = :address,
        venue_lat = :venue_lat,
        venue_lng = :venue_lng,
        offline_capacity = :offline_capacity,
        facecast_event_id = :facecast_event_id,
        facecast_url = :facecast_url,
        recording_url = :recording_url,
        photo_album_url = :photo_album_url,
        is_active = :is_active,
        updated_at = :now
       WHERE id = :id`,
      { ...params, id: existing.id },
    );
    return Number(existing.id);
  }

  const inserted = await execute(
    `INSERT INTO events
      (title, slug, description, date_start, date_end, online_start, address, venue_lat, venue_lng,
       offline_capacity, facecast_event_id, facecast_url, recording_url, photo_album_url, is_active, created_at, updated_at)
     VALUES
      (:title, :slug, :description, :date_start, :date_end, :online_start, :address, :venue_lat, :venue_lng,
       :offline_capacity, :facecast_event_id, :facecast_url, :recording_url, :photo_album_url, :is_active, :now, :now)`,
    params,
  );
  return Number(inserted.insertId);
}

async function upsertPerson([key, telegramId, fullName, company, positionTitle, phone, email]) {
  const existing = await queryOne('SELECT id FROM people WHERE telegram_id = :telegramId LIMIT 1', { telegramId });
  const now = nowSql();
  const params = {
    telegramId,
    username: key,
    firstName: fullName.split(' ')[0] || fullName,
    lastName: fullName.split(' ').slice(1).join(' ') || '',
    fullName,
    company,
    positionTitle,
    phone,
    email,
    now,
  };

  if (existing) {
    await execute(
      `UPDATE people SET
        username = :username,
        first_name = :firstName,
        last_name = :lastName,
        full_name = :fullName,
        company = :company,
        position_title = :positionTitle,
        phone = :phone,
        email = :email,
        consent_accepted_at = :now,
        state = 'registered',
        last_seen_at = :now,
        updated_at = :now
       WHERE id = :id`,
      { ...params, id: existing.id },
    );
    return Number(existing.id);
  }

  const inserted = await execute(
    `INSERT INTO people
      (telegram_id, username, first_name, last_name, full_name, company, position_title, phone, email,
       consent_accepted_at, state, last_seen_at, created_at, updated_at)
     VALUES
      (:telegramId, :username, :firstName, :lastName, :fullName, :company, :positionTitle, :phone, :email,
       :now, 'registered', :now, :now, :now)`,
    params,
  );
  return Number(inserted.insertId);
}

function extraRegistrationFields(personKey, attendance, status) {
  if (attendance !== 'online') {
    return {
      rejection_reason: status === 'rejected' ? 'Места на офлайн закончились' : null,
      approved_at: ['approved', 'visited'].includes(status) ? nowSql() : null,
      archived_at: null,
    };
  }

  const email = PEOPLE.find(([key]) => key === personKey)?.[6] || `${personKey}@example.com`;
  return {
    facecast_login: email,
    facecast_password: `MM-DEMO-${personKey.replace('demo_', '').toUpperCase()}`,
    facecast_url: 'https://facecast.net/w/6k2njf',
    approved_at: nowSql(),
    archived_at: null,
  };
}

async function upsertDemoBroadcast(eventId) {
  const now = nowSql();
  const existing = await queryOne('SELECT id FROM broadcast_campaigns WHERE title = :title LIMIT 1', {
    title: 'Демо-рассылка: материалы перед событием',
  });
  if (existing) {
    await execute(
      `UPDATE broadcast_campaigns SET
        audience = 'event_all',
        event_id = :eventId,
        content_type = 'photo',
        body = :body,
        media_file_id = :mediaFileId,
        status = 'queued',
        updated_at = :now
       WHERE id = :id`,
      {
        id: existing.id,
        eventId,
        body: 'Демо-сообщение для проверки рассылок: готовим полезные материалы к встрече.',
        mediaFileId: 'https://megapolis.media/images/demo-event-cover.jpg',
        now,
      },
    );
    return;
  }

  await execute(
    `INSERT INTO broadcast_campaigns
      (title, audience, event_id, content_type, body, media_file_id, status, created_at, updated_at)
     VALUES
      (:title, 'event_all', :eventId, 'photo', :body, :mediaFileId, 'queued', :now, :now)`,
    {
      title: 'Демо-рассылка: материалы перед событием',
      eventId,
      body: 'Демо-сообщение для проверки рассылок: готовим полезные материалы к встрече.',
      mediaFileId: 'https://megapolis.media/images/demo-event-cover.jpg',
      now,
    },
  );
}
