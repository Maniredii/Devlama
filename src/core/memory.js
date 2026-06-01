/**
 * memory.js — Sliding window context management for session memory.
 */

import { estimateTokens, truncateToTokens } from '../utils/helpers.js';

export class MemoryManager {
  /**
   * @param {import('../utils/config.js').ConfigManager} config
   * @param {import('../ollama/models.js').ModelInfo} currentModel
   */
  constructor(config, currentModel) {
    this.config = config;
    this.currentModel = currentModel;
    
    // Config values
    this.maxContextTokens = config.get('contextWindowTokens') ?? 4096;
    
    // In-memory state
    this._messages = []; // { role, content, tokens }
    this._systemPrompt = null; // { role: 'system', content, tokens }
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
}
