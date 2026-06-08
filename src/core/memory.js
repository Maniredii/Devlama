/**
 * memory.js — Sliding window context management for session memory.
 */

import { estimateTokens, truncateToTokens } from '../utils/helpers.js';
import { ContextOptimizer } from './contextOptimizer.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('memory');

export class MemoryManager {
  /**
   * @param {import('../utils/config.js').ConfigManager} config
   * @param {import('../ollama/models.js').ModelInfo} currentModel
   * @param {import('../ollama/client.js').OllamaClient} [client] - Required for context optimization
   */
  constructor(config, currentModel, client = null) {
    this.config = config;
    this.currentModel = currentModel;
    this.client = client;
    
    // Config values
    this.maxContextTokens = currentModel.isSmall ? 2048 : (config.get('contextWindowTokens') ?? 4096);
    
    // In-memory state
    this._messages = []; // { role, content, tokens }
    this._systemPrompt = null; // { role: 'system', content, tokens }
    this._optimizing = false; // Prevent concurrent optimization

    // Context optimizer (only if client is provided and feature is enabled)
    this._optimizer = null;
    if (client && config.get('contextOptimizationEnabled') !== false) {
      this._optimizer = new ContextOptimizer(client, {
        budgetThreshold: config.get('contextBudgetThreshold') ?? 0.75,
      });
    }
  }

  /**
   * Sets the master system prompt (always retained).
   * @param {string} content
   */
  setSystemPrompt(content) {
    this._systemPrompt = {
      role: 'system',
      content,
      tokens: estimateTokens(content),
    };
  }

  /**
   * Adds a user or assistant message to the memory.
   * @param {'user' | 'assistant'} role
   * @param {string} content
   */
  addMessage(role, content) {
    this._messages.push({
      role,
      content,
      tokens: estimateTokens(content),
    });
  }

  /**
   * Gets the current context window (messages to send to the model).
   * Evicts older messages if the token limit is exceeded.
   * @returns {import('../ollama/client.js').ChatMessage[]}
   */
  getContext() {
    // Trigger async optimization if needed (runs in background, result used next time)
    this._maybeOptimize();

    let budget = this.maxContextTokens;
    const context = [];

    // 1. Reserve tokens for system prompt
    if (this._systemPrompt) {
      budget -= this._systemPrompt.tokens;
    }

    // 2. Reserve tokens for model's response (e.g., 500 tokens)
    budget -= 500;

    if (budget <= 0) {
      // Degraded state: system prompt alone exceeds budget
      return this._systemPrompt ? [{ role: this._systemPrompt.role, content: truncateToTokens(this._systemPrompt.content, this.maxContextTokens - 100) }] : [];
    }

    // 3. Work backwards through recent messages, taking as many as fit
    let i = this._messages.length - 1;
    while (i >= 0) {
      const msg = this._messages[i];
      if (budget - msg.tokens >= 0) {
        context.unshift({ role: msg.role, content: msg.content });
        budget -= msg.tokens;
      } else {
        // We can't fit the whole message. If it's the *only* user message we're trying to send, truncate it.
        // Otherwise, stop here to avoid partial messages.
        if (context.length === 0 && msg.role === 'user') {
           context.unshift({ role: msg.role, content: truncateToTokens(msg.content, budget) });
        }
        break;
      }
      i--;
    }

    // 4. Prepend system prompt
    if (this._systemPrompt) {
      context.unshift({ role: this._systemPrompt.role, content: this._systemPrompt.content });
    }

    return context;
  }

  /**
   * Updates the current model (re-evaluates context budget if needed).
   * @param {import('../ollama/models.js').ModelInfo} newModel
   */
  updateModel(newModel) {
    this.currentModel = newModel;
    this.maxContextTokens = newModel.isSmall ? 2048 : (this.config.get('contextWindowTokens') ?? 4096);
  }

  /**
   * Returns memory stats for the /memory command.
   * @returns {object}
   */
  getStats() {
    const totalTokens = (this._systemPrompt ? this._systemPrompt.tokens : 0) + 
      this._messages.reduce((acc, m) => acc + m.tokens, 0);
    
    return {
      messageCount: this._messages.length,
      estimatedTokens: totalTokens,
      budgetPercent: Math.min(100, Math.round((totalTokens / this.maxContextTokens) * 100)),
      model: this.currentModel.name,
      mode: this.currentModel.isSmall ? 'adaptive (small)' : 'full context (large)',
    };
  }

  /**
   * Clears all messages (keeps system prompt).
   */
  clear() {
    this._messages = [];
  }

  // ─── Context Optimization ──────────────────────────────────────────────────

  /**
   * Checks if context optimization should run, and triggers it asynchronously.
   * The optimized result will be used on the *next* call to getContext().
   */
  _maybeOptimize() {
    if (!this._optimizer || this._optimizing) {
      return;
    }

    const totalTokens = this._messages.reduce((acc, m) => acc + m.tokens, 0);
    const systemTokens = this._systemPrompt ? this._systemPrompt.tokens : 0;
    const usedTokens = totalTokens + systemTokens;

    if (this._optimizer.shouldOptimize(usedTokens, this.maxContextTokens, this._messages.length)) {
      this._optimizing = true;
      logger.debug('Context optimization triggered');

      this._optimizer
        .optimize(this._messages, this.currentModel.name)
        .then((optimized) => {
          this._messages = optimized;
          this._optimizing = false;
          logger.debug(`Context optimized: ${optimized.length} messages remaining`);
        })
        .catch((err) => {
          this._optimizing = false;
          logger.debug(`Context optimization failed: ${err.message}`);
        });
    }
  }
}
