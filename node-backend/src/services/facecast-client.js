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
    if (this.shouldUseDemoCredentials()) {
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
    if (!streamUrl) {
      throw new FacecastApiError('Facecast stream URL is empty');
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

    const key = this.extractViewerKey(response);
    if (!this.isSuccessResponse(response) || !key) {
      throw new FacecastApiError('Facecast did not return a personal viewer key', {
        payload: response,
      });
    }

    return {
      login: email,
      password: key,
      ticketId: this.extractTicketId(response),
      url: this.viewerUrl(this.extractViewerUrl(response) || streamUrl, key, config.facecast.accessQueryParam || 'key'),
      source: 'facecast',
    };
  }

  async registerKeyViewer(event, person) {
    const password = this.viewerPassword(event, person);
    const streamUrl = String(event.facecast_url || config.facecast.defaultStreamUrl || '');
    if (!streamUrl) {
      throw new FacecastApiError('Facecast stream URL is empty');
    }
    try {
      await this.insertKey(event, person, password);
    } catch (error) {
      if (error.status === 406 && config.facecast.directLinkFallback && streamUrl) {
        if (this.isProduction()) {
          throw new FacecastApiError('Facecast direct link fallback is forbidden in production', {
            status: error.status,
            payload: error.payload,
          });
        }
        logger.warn('facecast event does not support API passwords, using direct link fallback', {
          eventId: event.facecast_event_id || event.id,
          viewModeError: error.message,
        });
        return {
          login: String(person.email || ''),
          password: '',
          url: streamUrl,
          source: 'direct_link_fallback',
        };
      }
      throw error;
    }

    return {
      login: String(person.email || ''),
      password,
      ticketId: '',
      url: this.viewerUrl(streamUrl, password, config.facecast.passwordQueryParam || 'password'),
      source: 'facecast',
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
      source: 'demo',
    };
  }

  shouldUseDemoCredentials() {
    if (config.facecast.demoMode) {
      if (this.isProduction()) {
        throw new FacecastApiError('FACECAST_DEMO_MODE must be false in production');
      }
      return true;
    }

    if (!config.facecast.uid || !config.facecast.apiKey) {
      if (this.isProduction()) {
        throw new FacecastApiError('FACECAST_UID and FACECAST_API_KEY are required in production');
      }
      return true;
    }

    return false;
  }

  isExistingPersonalAccess(registration, event, person) {
    const url = String(registration?.facecast_url || '').trim();
    const password = String(registration?.facecast_password || '').trim();
    if (!url || !password) {
      return false;
    }
    const eventUrl = String(event?.facecast_url || config.facecast.defaultStreamUrl || '').trim();
    if (url === eventUrl) {
      return false;
    }

    if (this.isDemoUserregAccess(password, event, person)) {
      return false;
    }

    return this.urlHasAccessValue(url, password);
  }

  isPersonalCredentials(credentials, event, person) {
    const url = String(credentials?.url || '').trim();
    const password = String(credentials?.password || '').trim();
    if (!url || !password) {
      return false;
    }
    if (this.isDemoUserregAccess(password, event, person)) {
      return false;
    }
    return this.urlHasAccessValue(url, password);
  }

  isDemoUserregAccess(password, event, person) {
    return this.registrationMode() === 'userreg'
      && !this.allowDemoAccess()
      && password === this.viewerPassword(event, person);
  }

  urlHasAccessValue(url, value) {
    if (!url || !value) {
      return false;
    }

    try {
      const parsed = new URL(url);
      const params = [
        config.facecast.accessQueryParam || 'key',
        config.facecast.passwordQueryParam || 'password',
        'key',
        'password',
      ];
      return params.some((param) => parsed.searchParams.get(param) === value);
    } catch {
      return url.includes(encodeURIComponent(value)) || url.includes(value);
    }
  }

  extractViewerKey(response) {
    const candidates = [
      response?.key,
      response?.viewer_key,
      response?.access_key,
      response?.password,
      response?.ticket?.key,
      response?.ticket?.password,
      response?.data?.key,
      response?.data?.viewer_key,
      response?.data?.access_key,
      response?.data?.password,
      response?.result?.key,
      response?.result?.viewer_key,
      response?.result?.access_key,
      response?.result?.password,
    ];
    return this.firstString(candidates);
  }

  extractTicketId(response) {
    return this.firstString([
      response?.ticket_id,
      response?.ticketId,
      response?.ticket?.id,
      response?.data?.ticket_id,
      response?.data?.ticketId,
      response?.data?.ticket?.id,
      response?.result?.ticket_id,
      response?.result?.ticketId,
      response?.result?.ticket?.id,
    ]);
  }

  extractViewerUrl(response) {
    return this.firstString([
      response?.url,
      response?.link,
      response?.viewer_url,
      response?.personal_url,
      response?.data?.url,
      response?.data?.link,
      response?.data?.viewer_url,
      response?.data?.personal_url,
      response?.result?.url,
      response?.result?.link,
      response?.result?.viewer_url,
      response?.result?.personal_url,
    ]);
  }

  firstString(values) {
    for (const value of values) {
      const text = String(value || '').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  isSuccessResponse(response) {
    if (!response) {
      return false;
    }
    if (response.ok === false || response.success === false || response.error) {
      return false;
    }
    return true;
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

  isProduction() {
    return String(config.nodeEnv || '').toLowerCase() === 'production';
  }

  allowDemoAccess() {
    return config.facecast.demoMode && !this.isProduction();
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
