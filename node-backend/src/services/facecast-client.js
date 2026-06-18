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
      url: this.viewerUrl(streamUrl, password),
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

  async postForm(endpoint, body, { duplicateIsSuccess = false } = {}) {
    const url = `${config.facecast.apiBase}/${String(endpoint).replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams(body),
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
      url: this.viewerUrl(streamUrl, password),
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

  viewerUrl(streamUrl, password) {
    if (!streamUrl || !password) {
      return streamUrl;
    }

    try {
      const url = new URL(streamUrl);
      url.searchParams.set(config.facecast.passwordQueryParam || 'password', password);
      return url.toString();
    } catch {
      const separator = streamUrl.includes('?') ? '&' : '?';
      return `${streamUrl}${separator}${encodeURIComponent(config.facecast.passwordQueryParam || 'password')}=${encodeURIComponent(password)}`;
    }
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
}
