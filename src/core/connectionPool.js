/**
 * connectionPool.js — Multi-host connection pool / load balancer for Ollama.
 *
 * Distributes requests across multiple Ollama instances using round-robin
 * scheduling with health checks and automatic failover.
 *
 * Features:
 *   - Round-robin load balancing
 *   - Periodic health checks (30s interval)
 *   - Automatic failover to healthy hosts
 *   - Request queuing with configurable concurrency
 *   - Transparent single-host fallback (no overhead when only 1 host is configured)
 */

import { OllamaClient } from '../ollama/client.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('connection-pool');

export class ConnectionPool {
  /**
   * @param {string[]} hosts - Array of Ollama host URLs
   * @param {object} [options]
   * @param {number} [options.maxConcurrentPerHost=2]
   * @param {number} [options.healthCheckIntervalMs=30000]
   * @param {number} [options.healthCheckTimeoutMs=5000]
   */
  constructor(hosts, options = {}) {
    this.maxConcurrentPerHost = options.maxConcurrentPerHost ?? 2;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30_000;
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5_000;

    // Create a pool entry for each host
    this._pool = hosts.map((host) => ({
      host: host.replace(/\/$/, ''),
      client: new OllamaClient(host),
      healthy: true,
      activeRequests: 0,
      totalRequests: 0,
      totalErrors: 0,
      lastHealthCheck: 0,
    }));

    this._roundRobinIndex = 0;
    this._healthCheckTimer = null;

    // Start health checks if multiple hosts are configured
    if (this._pool.length > 1) {
      this._startHealthChecks();
    }

    logger.debug(
      `ConnectionPool initialized: ${this._pool.length} host(s), ` +
      `maxConcurrent=${this.maxConcurrentPerHost}`
    );
  }

  /**
   * Returns the underlying host URL (for compatibility with code expecting a .host property).
   * Returns the first healthy host.
   */
  get host() {
    const entry = this._getNextHealthy();
    return entry ? entry.host : this._pool[0]?.host ?? 'http://localhost:11434';
  }

  // ─── Delegated Client Methods ──────────────────────────────────────────────
  // These mirror the OllamaClient API, distributing requests across the pool.

  async listModels() {
    return this._execute((client) => client.listModels());
  }

  async showModel(name) {
    return this._execute((client) => client.showModel(name));
  }

  async chat(model, messages, options = {}) {
    return this._execute((client) => client.chat(model, messages, options));
  }

  async streamChat(model, messages, onToken, onDone, options = {}) {
    return this._execute((client) =>
      client.streamChat(model, messages, onToken, onDone, options)
    );
  }

  async generate(model, prompt, options = {}) {
    return this._execute((client) => client.generate(model, prompt, options));
  }

  async embed(model, text) {
    return this._execute((client) => client.embed(model, text));
  }

  // ─── Pool Stats ────────────────────────────────────────────────────────────

  /**
   * Returns pool status for debugging and /memory display.
   * @returns {object[]}
   */
  getPoolStats() {
    return this._pool.map((entry) => ({
      host: entry.host,
      healthy: entry.healthy,
      activeRequests: entry.activeRequests,
      totalRequests: entry.totalRequests,
      totalErrors: entry.totalErrors,
    }));
  }

  /**
   * Shuts down the pool (clears health check timers).
   */
  shutdown() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
    logger.debug('ConnectionPool shut down');
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Executes a request on the next available healthy host.
   * Includes retry logic with failover.
   * @param {(client: OllamaClient) => Promise<T>} fn
   * @returns {Promise<T>}
   * @template T
   */
  async _execute(fn) {
    const tried = new Set();

    while (tried.size < this._pool.length) {
      const entry = this._getNextHealthy(tried);

      if (!entry) {
        // All hosts have been tried or are unhealthy; try the first host anyway
        const fallback = this._pool[0];
        logger.warn(`All hosts unhealthy/tried, falling back to ${fallback.host}`);
        return fn(fallback.client);
      }

      tried.add(entry.host);
      entry.activeRequests++;
      entry.totalRequests++;

      try {
        const result = await fn(entry.client);
        entry.activeRequests--;
        return result;
      } catch (err) {
        entry.activeRequests--;
        entry.totalErrors++;

        // Mark as unhealthy on connection errors
        if (err.name === 'OllamaConnectionError') {
          entry.healthy = false;
          logger.warn(`Host ${entry.host} marked unhealthy: ${err.message}`);
        } else {
          // Non-connection errors (e.g. 404, model not found) should not trigger failover
          throw err;
        }
      }
    }

    throw new Error('All Ollama hosts are unreachable');
  }

  /**
   * Gets the next healthy pool entry using round-robin.
   * @param {Set<string>} [exclude] - Hosts to skip
   * @returns {PoolEntry | null}
   */
  _getNextHealthy(exclude = new Set()) {
    const poolSize = this._pool.length;

    // Single-host fast path
    if (poolSize === 1 && !exclude.has(this._pool[0].host)) {
      return this._pool[0];
    }

    for (let i = 0; i < poolSize; i++) {
      const idx = (this._roundRobinIndex + i) % poolSize;
      const entry = this._pool[idx];

      if (entry.healthy && !exclude.has(entry.host) && entry.activeRequests < this.maxConcurrentPerHost) {
        this._roundRobinIndex = (idx + 1) % poolSize;
        return entry;
      }
    }

    // If all healthy hosts are at max concurrency, pick the healthiest one anyway
    for (let i = 0; i < poolSize; i++) {
      const idx = (this._roundRobinIndex + i) % poolSize;
      const entry = this._pool[idx];
      if (entry.healthy && !exclude.has(entry.host)) {
        this._roundRobinIndex = (idx + 1) % poolSize;
        return entry;
      }
    }

    return null;
  }

  /**
   * Runs periodic health checks on all pool members.
   */
  _startHealthChecks() {
    this._healthCheckTimer = setInterval(async () => {
      for (const entry of this._pool) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.healthCheckTimeoutMs);

          const res = await fetch(`${entry.host}/api/tags`, {
            method: 'GET',
            signal: controller.signal,
          });

          clearTimeout(timeout);

          const wasHealthy = entry.healthy;
          entry.healthy = res.ok;
          entry.lastHealthCheck = Date.now();

          if (!wasHealthy && entry.healthy) {
            logger.info(`Host ${entry.host} recovered and is now healthy`);
          }
        } catch {
          entry.healthy = false;
          entry.lastHealthCheck = Date.now();
        }
      }
    }, this.healthCheckIntervalMs);

    // Don't prevent process exit
    if (this._healthCheckTimer.unref) {
      this._healthCheckTimer.unref();
    }
  }
}

/**
 * Creates a ConnectionPool or a plain OllamaClient depending on config.
 * @param {import('../utils/config.js').ConfigManager} config
 * @returns {ConnectionPool | OllamaClient}
 */
export function createClientFromConfig(config) {
  const hosts = config.get('ollamaHosts');
  const singleHost = config.get('ollamaHost');
  const maxConcurrent = config.get('maxConcurrentRequests') ?? 2;

  // If multiple hosts are configured, use the connection pool
  if (hosts && Array.isArray(hosts) && hosts.length > 1) {
    logger.info(`Using connection pool with ${hosts.length} hosts`);
    return new ConnectionPool(hosts, { maxConcurrentPerHost: maxConcurrent });
  }

  // Single-host mode: use plain OllamaClient for zero overhead
  const host = (hosts && hosts[0]) || singleHost || 'http://localhost:11434';
  return new OllamaClient(host);
}

/**
 * @typedef {{
 *   host: string,
 *   client: OllamaClient,
 *   healthy: boolean,
 *   activeRequests: number,
 *   totalRequests: number,
 *   totalErrors: number,
 *   lastHealthCheck: number
 * }} PoolEntry
 */
