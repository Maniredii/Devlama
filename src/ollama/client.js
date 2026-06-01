/**
 * OllamaClient — HTTP client wrapping the Ollama REST API.
 * Handles chat completions, streaming, and model management.
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('ollama-client');

export class OllamaClient {
  /**
   * @param {string} host - e.g. "http://localhost:11434"
   */
  constructor(host = 'http://localhost:11434') {
    this.host = host.replace(/\/$/, '');
  }

  // ─── Models ───────────────────────────────────────────────────────────────

  /**
   * Lists all installed models.
   * @returns {Promise<OllamaModel[]>}
   */
  async listModels() {
    const res = await this._request('GET', '/api/tags');
    return res.models ?? [];
  }

  /**
   * Shows detailed info for a specific model.
   * @param {string} name
   * @returns {Promise<object>}
   */
  async showModel(name) {
    return this._request('POST', '/api/show', { name });
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  /**
   * Sends a chat completion request (non-streaming).
   * @param {string} model
   * @param {ChatMessage[]} messages
   * @param {object} [options]
   * @returns {Promise<{ content: string, done: boolean }>}
   */
  async chat(model, messages, options = {}) {
    const body = {
      model,
      messages,
      stream: false,
      options: this._buildOptions(options),
    };

    logger.debug(`chat() model=${model} messages=${messages.length}`);
    const res = await this._request('POST', '/api/chat', body);

    return {
      content: res.message?.content ?? '',
      done: res.done ?? true,
      model: res.model,
      totalDuration: res.total_duration,
    };
  }

  /**
   * Sends a streaming chat completion request.
   * Calls onToken for each token, onDone when finished.
   *
   * @param {string} model
   * @param {ChatMessage[]} messages
   * @param {(token: string) => void} onToken
   * @param {(fullText: string) => void} onDone
   * @param {object} [options]
   * @returns {Promise<string>} - Full accumulated response
   */
  async streamChat(model, messages, onToken, onDone, options = {}) {
    const body = {
      model,
      messages,
      stream: true,
      options: this._buildOptions(options),
    };

    logger.debug(`streamChat() model=${model}`);

    const response = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new OllamaError(`Ollama API error ${response.status}: ${errText}`, response.status);
    }

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const chunk = JSON.parse(line);
          const token = chunk.message?.content ?? '';

          if (token) {
            fullText += token;
            onToken(token);
          }

          if (chunk.done) {
            onDone(fullText);
            return fullText;
          }
        } catch (parseErr) {
          logger.debug(`Failed to parse stream chunk: ${line}`);
        }
      }
    }

    onDone(fullText);
    return fullText;
  }

  // ─── Generate (raw completion) ────────────────────────────────────────────

  /**
   * Raw text generation (non-chat format), useful for simple prompts.
   * @param {string} model
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async generate(model, prompt, options = {}) {
    const body = {
      model,
      prompt,
      stream: false,
      options: this._buildOptions(options),
    };

    const res = await this._request('POST', '/api/generate', body);
    return res.response ?? '';
  }

  // ─── Embeddings ───────────────────────────────────────────────────────────

  /**
   * Gets embeddings for a piece of text.
   * @param {string} model
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embed(model, text) {
    const res = await this._request('POST', '/api/embeddings', {
      model,
      prompt: text,
    });
    return res.embedding ?? [];
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async _request(method, path, body = null) {
    const url = `${this.host}${path}`;
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body !== null) {
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new OllamaConnectionError(
        `Cannot connect to Ollama at ${this.host}. Is it running? (ollama serve)`,
        err
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new OllamaError(`Ollama API error ${response.status}: ${text}`, response.status);
    }

    return response.json();
  }

  _buildOptions(options) {
    const defaults = {
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.9,
    };

    if (options.maxTokens) {
      defaults.num_predict = options.maxTokens;
    }
    if (options.contextSize) {
      defaults.num_ctx = options.contextSize;
    }
    if (options.seed !== undefined) {
      defaults.seed = options.seed;
    }

    return defaults;
  }
}

// ─── Error Classes ────────────────────────────────────────────────────────────

export class OllamaError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'OllamaError';
    this.statusCode = statusCode;
  }
}

export class OllamaConnectionError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'OllamaConnectionError';
    this.cause = cause;
  }
}

/**
 * @typedef {{ role: 'system' | 'user' | 'assistant', content: string }} ChatMessage
 * @typedef {{ name: string, size: number, digest: string, modified_at: string }} OllamaModel
 */
