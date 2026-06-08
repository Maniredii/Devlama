/**
 * semanticCache.js — Embedding-based response cache for DevLama.
 *
 * Uses Ollama's own embeddings to compute cosine similarity between
 * user queries. If a new query is sufficiently similar to a cached one,
 * the cached response is returned instantly — skipping the LLM entirely.
 *
 * Features:
 *   - Cosine similarity matching (configurable threshold)
 *   - TTL-based expiry
 *   - LRU eviction when max cache size is reached
 *   - Zero external dependencies (no Redis required)
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('semantic-cache');

export class SemanticCache {
  /**
   * @param {import('../ollama/client.js').OllamaClient} client
   * @param {object} [options]
   * @param {boolean}  [options.enabled=true]
   * @param {number}   [options.similarityThreshold=0.92]
   * @param {number}   [options.ttlMinutes=30]
   * @param {number}   [options.maxSize=100]
   * @param {string}   [options.embeddingModel] - Model to use for embeddings (auto-detected if omitted)
   */
  constructor(client, options = {}) {
    this.client = client;
    this.enabled = options.enabled ?? true;
    this.similarityThreshold = options.similarityThreshold ?? 0.92;
    this.ttlMs = (options.ttlMinutes ?? 30) * 60 * 1000;
    this.maxSize = options.maxSize ?? 100;
    this.embeddingModel = options.embeddingModel ?? null;

    /** @type {CacheEntry[]} */
    this._entries = [];

    logger.debug(
      `SemanticCache initialized: enabled=${this.enabled}, threshold=${this.similarityThreshold}, ` +
      `ttl=${this.ttlMs / 60000}min, maxSize=${this.maxSize}`
    );
  }

  /**
   * Attempts to find a cached response for the given query.
   * @param {string} query - The user's input text
   * @returns {Promise<{ hit: boolean, response?: string, similarity?: number }>}
   */
  async lookup(query) {
    if (!this.enabled || this._entries.length === 0) {
      return { hit: false };
    }

    // Evict expired entries first
    this._evictExpired();

    if (this._entries.length === 0) {
      return { hit: false };
    }

    try {
      const queryEmbedding = await this._getEmbedding(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return { hit: false };
      }

      let bestMatch = null;
      let bestSimilarity = -1;

      for (const entry of this._entries) {
        const similarity = this._cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = entry;
        }
      }

      if (bestMatch && bestSimilarity >= this.similarityThreshold) {
        // Move to front (LRU)
        bestMatch.lastAccessed = Date.now();
        logger.debug(
          `Cache HIT (similarity=${bestSimilarity.toFixed(4)}): "${query.slice(0, 60)}..."`
        );
        return {
          hit: true,
          response: bestMatch.response,
          similarity: bestSimilarity,
        };
      }

      logger.debug(
        `Cache MISS (best similarity=${bestSimilarity.toFixed(4)}): "${query.slice(0, 60)}..."`
      );
      return { hit: false };
    } catch (err) {
      logger.debug(`Cache lookup error: ${err.message}`);
      return { hit: false };
    }
  }

  /**
   * Stores a query-response pair in the cache.
   * @param {string} query
   * @param {string} response
   */
  async store(query, response) {
    if (!this.enabled) {
      return;
    }

    try {
      const embedding = await this._getEmbedding(query);
      if (!embedding || embedding.length === 0) {
        return;
      }

      // Evict LRU entry if full
      if (this._entries.length >= this.maxSize) {
        this._evictLRU();
      }

      this._entries.push({
        query,
        response,
        embedding,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
      });

      logger.debug(`Cached response for: "${query.slice(0, 60)}..." (total=${this._entries.length})`);
    } catch (err) {
      logger.debug(`Cache store error: ${err.message}`);
    }
  }

  /**
   * Clears the entire cache.
   */
  clear() {
    const count = this._entries.length;
    this._entries = [];
    logger.debug(`Cache cleared (${count} entries removed)`);
  }

  /**
   * Returns cache statistics.
   * @returns {{ size: number, maxSize: number, enabled: boolean }}
   */
  getStats() {
    return {
      size: this._entries.length,
      maxSize: this.maxSize,
      enabled: this.enabled,
      threshold: this.similarityThreshold,
      ttlMinutes: this.ttlMs / 60000,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Gets an embedding vector for the given text.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async _getEmbedding(text) {
    const model = this.embeddingModel || 'nomic-embed-text';
    try {
      return await this.client.embed(model, text);
    } catch {
      // If the embedding model isn't installed, try with whatever model is active
      // by falling back to a simple hash-based "embedding" for basic deduplication
      logger.debug(`Embedding model "${model}" unavailable, using hash fallback`);
      return this._hashFallbackEmbedding(text);
    }
  }

  /**
   * Fallback: creates a simple pseudo-embedding from a text hash.
   * Much less accurate than real embeddings but catches exact/near-exact duplicates.
   * @param {string} text
   * @returns {number[]}
   */
  _hashFallbackEmbedding(text) {
    // Normalize the text
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    const words = normalized.split(' ');

    // Create a simple bag-of-words vector of fixed size
    const vecSize = 128;
    const vec = new Array(vecSize).fill(0);

    for (const word of words) {
      // Simple hash to bucket
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      const bucket = Math.abs(hash) % vecSize;
      vec[bucket] += 1;
    }

    // Normalize the vector
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vecSize; i++) {
        vec[i] /= magnitude;
      }
    }

    return vec;
  }

  /**
   * Computes cosine similarity between two vectors.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} Similarity in range [-1, 1]
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Removes entries older than TTL.
   */
  _evictExpired() {
    const now = Date.now();
    const before = this._entries.length;
    this._entries = this._entries.filter((e) => now - e.createdAt < this.ttlMs);
    const evicted = before - this._entries.length;
    if (evicted > 0) {
      logger.debug(`Evicted ${evicted} expired cache entries`);
    }
  }

  /**
   * Removes the least recently used entry.
   */
  _evictLRU() {
    if (this._entries.length === 0) {
      return;
    }

    let oldestIdx = 0;
    let oldestTime = this._entries[0].lastAccessed;

    for (let i = 1; i < this._entries.length; i++) {
      if (this._entries[i].lastAccessed < oldestTime) {
        oldestTime = this._entries[i].lastAccessed;
        oldestIdx = i;
      }
    }

    const removed = this._entries.splice(oldestIdx, 1)[0];
    logger.debug(`LRU evicted: "${removed.query.slice(0, 40)}..."`);
  }
}

/**
 * @typedef {{
 *   query: string,
 *   response: string,
 *   embedding: number[],
 *   createdAt: number,
 *   lastAccessed: number
 * }} CacheEntry
 */
