/**
 * contextOptimizer.js — LLM-powered conversation summarizer.
 *
 * When the conversation memory grows beyond a configurable threshold,
 * this module compresses older messages into a concise summary.
 * This keeps the context window lean, directly reducing the num_ctx
 * load on Ollama and producing faster responses.
 */

import { Logger } from '../utils/logger.js';
import { estimateTokens } from '../utils/helpers.js';

const logger = new Logger('context-optimizer');

/**
 * The prompt template used to ask the model to summarize conversation history.
 */
const SUMMARIZE_PROMPT = `You are a conversation summarizer. Summarize the following conversation into a single concise paragraph that captures the key context, decisions made, code discussed, files modified, and any important details. This summary will replace the original messages to save memory.

CONVERSATION TO SUMMARIZE:
{conversation}

OUTPUT:
Respond with ONLY the summary paragraph, nothing else.`;

export class ContextOptimizer {
  /**
   * @param {import('../ollama/client.js').OllamaClient} client
   * @param {object} [options]
   * @param {number} [options.budgetThreshold=0.75] - Trigger optimization when budget usage exceeds this ratio
   * @param {number} [options.keepRecentTurns=4] - Number of recent message pairs to preserve uncompressed
   * @param {number} [options.minMessagesToCompress=6] - Minimum messages before compression is attempted
   */
  constructor(client, options = {}) {
    this.client = client;
    this.budgetThreshold = options.budgetThreshold ?? 0.75;
    this.keepRecentTurns = options.keepRecentTurns ?? 4;
    this.minMessagesToCompress = options.minMessagesToCompress ?? 6;

    this._lastOptimizationTime = 0;
    this._cooldownMs = 60_000; // Don't optimize more than once per minute

    logger.debug(
      `ContextOptimizer initialized: threshold=${this.budgetThreshold}, ` +
      `keepRecent=${this.keepRecentTurns}, minMessages=${this.minMessagesToCompress}`
    );
  }

  /**
   * Checks whether optimization should be triggered.
   * @param {number} usedTokens - Current total token usage
   * @param {number} maxTokens - Maximum token budget
   * @param {number} messageCount - Number of messages in memory
   * @returns {boolean}
   */
  shouldOptimize(usedTokens, maxTokens, messageCount) {
    // Don't optimize if we're on cooldown
    if (Date.now() - this._lastOptimizationTime < this._cooldownMs) {
      return false;
    }

    // Don't optimize if there aren't enough messages to make it worthwhile
    if (messageCount < this.minMessagesToCompress) {
      return false;
    }

    // Trigger when budget usage exceeds threshold
    const usage = usedTokens / maxTokens;
    return usage > this.budgetThreshold;
  }

  /**
   * Compresses older messages into a summary.
   *
   * @param {Array<{role: string, content: string, tokens: number}>} messages - The full message array
   * @param {string} modelName - The model to use for summarization
   * @returns {Promise<Array<{role: string, content: string, tokens: number}>>} - Optimized message array
   */
  async optimize(messages, modelName) {
    if (messages.length < this.minMessagesToCompress) {
      return messages;
    }

    // Split messages into "old" (to compress) and "recent" (to keep)
    const keepCount = this.keepRecentTurns * 2; // Each turn = user + assistant
    const splitIndex = Math.max(0, messages.length - keepCount);

    if (splitIndex <= 1) {
      // Nothing meaningful to compress
      return messages;
    }

    const oldMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);

    logger.debug(
      `Optimizing context: compressing ${oldMessages.length} old messages, ` +
      `keeping ${recentMessages.length} recent messages`
    );

    try {
      const summary = await this._summarize(oldMessages, modelName);

      // Create a single summary message to replace the old ones
      const summaryMessage = {
        role: 'user',
        content: `[CONVERSATION SUMMARY — Previous ${oldMessages.length} messages compressed]\n${summary}`,
        tokens: estimateTokens(summary) + 20, // +20 for the prefix
      };

      const oldTokens = oldMessages.reduce((sum, m) => sum + m.tokens, 0);
      const newTokens = summaryMessage.tokens;
      const savedTokens = oldTokens - newTokens;

      logger.debug(
        `Context optimized: ${oldTokens} tokens → ${newTokens} tokens (saved ${savedTokens})`
      );

      this._lastOptimizationTime = Date.now();

      return [summaryMessage, ...recentMessages];
    } catch (err) {
      logger.warn(`Context optimization failed: ${err.message}. Keeping original messages.`);
      return messages;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Uses the LLM to produce a summary of the given messages.
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} modelName
   * @returns {Promise<string>}
   */
  async _summarize(messages, modelName) {
    // Format messages into a readable conversation transcript
    const conversation = messages
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n\n');

    const prompt = SUMMARIZE_PROMPT.replace('{conversation}', conversation);

    // Use generate() for a simple, one-shot summarization
    const summary = await this.client.generate(modelName, prompt, {
      temperature: 0.1, // Low temperature for factual summarization
      maxTokens: 300,   // Keep summaries concise
    });

    return summary.trim();
  }
}
