/**
 * OllamaDetector — Detects a running Ollama server and its capabilities.
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('detector');

const DEFAULT_HOSTS = [
  'http://localhost:11434',
  'http://127.0.0.1:11434',
];

export class OllamaDetector {
  constructor(config = null) {
    this._customHost = config?.get?.('ollamaHost') || process.env.OLLAMA_HOST || null;
  }

  /**
   * Attempts to detect a running Ollama server.
   * @returns {Promise<{ running: boolean, host: string, version: string | null }>}
   */
  async detect() {
    const hostsToTry = this._customHost
      ? [this._customHost, ...DEFAULT_HOSTS]
      : DEFAULT_HOSTS;

    for (const host of hostsToTry) {
      const result = await this._pingHost(host);
      if (result.running) {
        logger.info(`Ollama detected at ${host} (version: ${result.version ?? 'unknown'})`);
        return result;
      }
    }

    logger.warn('No Ollama server found on any default host.');
    return { running: false, host: null, version: null };
  }

  /**
   * Pings a single host to check if Ollama is running.
   * @param {string} host
   * @returns {Promise<{ running: boolean, host: string, version: string | null }>}
   */
  async _pingHost(host) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${host}/api/version`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return { running: false, host, version: null };
      }

      const data = await res.json().catch(() => ({}));
      return { running: true, host, version: data.version ?? null };
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.debug(`Ping failed for ${host}: ${err.message}`);
      }
      return { running: false, host, version: null };
    }
  }
}
