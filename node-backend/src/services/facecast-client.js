import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

class FacecastApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'FacecastApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class FacecastClient {
  async registerViewer(event, person) {
    if (config.facecast.demoMode || !config.facecast.uid || !config.facecast.apiKey) {
      return this.demoCredentials(event, person);
    }

    if (this.registrationMode() === 'userreg') {
      return this.registerUserregViewer(event, person);
    }

    return this.registerKeyViewer(event, person);
  }

  async registerUserregViewer(event, person) {
    const eventId = String(event.facecast_event_id || '').trim();
    const streamUrl = String(event.facecast_url || config.facecast.defaultStreamUrl || '');
    if (!eventId) {
      throw new FacecastApiError('Facecast event_id is empty');
    }

    const email = this.email(person.email);
    const fullName = this.truncate(person.full_name, 64);
    const phone = this.phoneForUserreg(person.phone);
    const response = await this.postForm(config.facecast.userregEndpoint, {
      ajaj: '1',
      event_id: eventId,
      email,
      phone,
      user_name: fullName,
      user_chat_name: fullName,
      use_name_in_chat: 'true',
      viewer_data: JSON.stringify([
        fullName,
        email,
        this.truncate(person.company, 64),
        this.truncate(person.position_title, 64),
        phone || this.truncate(person.phone, 32),
      ]),
      ref: 'telegram-bot',
      lang: 'ru',
    }, {
      referer: streamUrl,
    });

    if (!response?.ok || !response?.key) {
      throw new FacecastApiError('Facecast did not return a personal viewer key', {
        payload: response,
      });
    }

    const key = String(response.key);
    return {
      login: email,
      password: key,
      ticketId: String(response.ticket_id || ''),
      url: this.viewerUrl(streamUrl, key, config.facecast.accessQueryParam || 'key'),
    };
  }

  async registerKeyViewer(event, person) {
    const password = this.viewerPassword(event, person);
    const streamUrl = String(event.facecast_url || config.facecast.defaultStreamUrl || '');
    try {
      await this.insertKey(event, person, password);
    } catch (error) {
      if (error.status === 406 && config.facecast.directLinkFallback && streamUrl) {
        logger.warn('facecast event does not support API passwords, using direct link fallback', {
          eventId: event.facecast_event_id || event.id,
          viewModeError: error.message,
        });
        return {
          login: String(person.email || ''),
          password: '',
          url: streamUrl,
        };
      }
      throw error;
    }

    return {
      login: String(person.email || ''),
      password,
      ticketId: '',
      url: this.viewerUrl(streamUrl, password, config.facecast.passwordQueryParam || 'password'),
    };
  }

  async insertKey(event, person, password) {
    const eventId = String(event.facecast_event_id || '').trim();
    const eventCode = !eventId ? String(event.slug || '').trim() : '';
    if (!eventId && !eventCode) {
      throw new FacecastApiError('Facecast event_id or event_code is empty');
    }

    const body = {
      uid: config.facecast.uid,
      api_key: config.facecast.apiKey,
      key: password,
      multiple_vpp: '0',
      email: this.truncate(person.email, 64),
      name: this.truncate(person.full_name, 64),
    };
    if (eventId) body.event_id = eventId;
    else body.event_code = eventCode;

    const phone = this.phone(person.phone);
    if (phone) body.phone = phone;

    await this.postForm(config.facecast.registrationEndpoint || 'insert_key', body, {
      duplicateIsSuccess: true,
    });
  }

  async postForm(endpoint, body, { duplicateIsSuccess = false, referer = '' } = {}) {
    const url = this.endpointUrl(endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const headers = { Accept: 'application/json' };
    if (referer) {
      headers.Origin = 'https://facecast.net';
      headers.Referer = referer;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams(body),
        headers,
        signal: controller.signal,
      });

      const decoded = await this.decodeJson(response);
      if (!response.ok) {
        const message = String(decoded?.error || decoded?.message || response.statusText || 'Facecast API error');
        if (duplicateIsSuccess && response.status === 409 && message.toLowerCase().includes('duplicate')) {
          return decoded;
        }
        throw new FacecastApiError(`Facecast registration failed: ${message}`, {
          status: response.status,
          payload: decoded,
        });
      }

      return decoded;
    } finally {
      clearTimeout(timeout);
    }
  }

  async decodeJson(response) {
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 500) };
    }
  }

  demoCredentials(event, person) {
    const password = this.viewerPassword(event, person);
    const streamUrl = String(event.facecast_url || config.facecast.defaultStreamUrl || '');

    return {
      login: String(person.email || `viewer-${person.telegram_id}`),
      password,
      ticketId: '',
      url: this.viewerUrl(streamUrl, password, this.registrationMode() === 'userreg'
        ? config.facecast.accessQueryParam || 'key'
        : config.facecast.passwordQueryParam || 'password'),
    };
  }

  viewerPassword(event, person) {
    const seed = createHash('sha256')
      .update(`${config.facecast.uid || 'demo'}:${event.facecast_event_id || event.id}:${person.telegram_id || person.id}`)
      .digest('hex')
      .slice(0, 10)
      .toUpperCase();
    return `MM${seed}`;
  }

  viewerUrl(streamUrl, key, queryParam) {
    if (!streamUrl || !key) {
      return streamUrl;
    }
    const param = queryParam || config.facecast.accessQueryParam || 'key';

    try {
      const url = new URL(streamUrl);
      url.searchParams.set(param, key);
      return url.toString();
    } catch {
      const separator = streamUrl.includes('?') ? '&' : '?';
      return `${streamUrl}${separator}${encodeURIComponent(param)}=${encodeURIComponent(key)}`;
    }
  }

  endpointUrl(endpoint) {
    const raw = String(endpoint || '').trim();
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return `${config.facecast.apiBase}/${raw.replace(/^\/+/, '')}`;
  }

  registrationMode() {
    const mode = String(config.facecast.registrationMode || 'userreg').toLowerCase();
    return mode === 'insert_key' || mode === 'key' || mode === 'password' ? 'insert_key' : 'userreg';
  }

  email(value) {
    return this.truncate(String(value || '').trim().toLowerCase(), 64);
  }

  truncate(value, max) {
    const text = String(value || '').trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  phone(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    if (digits.length < 10 || digits.length > 15) {
      return '';
    }
    return digits;
  }

  phoneForUserreg(value) {
    const digits = this.phone(value);
    if (!digits) {
      return '';
    }
    return String(value || '').trim().startsWith('+') ? `+${digits}` : digits;
  }
}
