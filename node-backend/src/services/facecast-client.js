import { createHash } from 'node:crypto';
import { config } from '../config.js';

export class FacecastClient {
  async registerViewer(event, person) {
    if (config.facecast.demoMode || !config.facecast.registrationEndpoint) {
      return this.demoCredentials(event, person);
    }

    const url = `${config.facecast.apiBase}/${config.facecast.registrationEndpoint.replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.facecast.token ? { Authorization: `Bearer ${config.facecast.token}` } : {}),
        },
        body: JSON.stringify({
          event_id: event.facecast_event_id || event.slug,
          viewer: {
            name: person.full_name,
            company: person.company,
            position: person.position_title,
            email: person.email,
            phone: person.phone,
          },
        }),
        signal: controller.signal,
      });

      const decoded = await response.json();
      if (!response.ok) {
        throw new Error(`Facecast registration failed: ${JSON.stringify(decoded)}`);
      }

      return {
        login: String(decoded.login || decoded.email || person.email),
        password: String(decoded.password || decoded.access_password || ''),
        url: String(decoded.url || decoded.link || decoded.viewer_url || event.facecast_url || ''),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  demoCredentials(event, person) {
    const seed = createHash('sha256')
      .update(`${person.telegram_id}:${event.id}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();

    return {
      login: String(person.email || `viewer-${person.telegram_id}`),
      password: `MM-${seed}`,
      url: String(event.facecast_url || config.facecast.defaultStreamUrl || ''),
    };
  }
}
