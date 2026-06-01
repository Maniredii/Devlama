/**
 * helpers.js — Shared utility functions for DevLama CLI.
 */

import { createHash } from 'crypto';
import { relative, resolve, sep } from 'path';
import chalk from 'chalk';

// ─── Token Estimation ─────────────────────────────────────────────────────────

/**
 * Rough token estimator: ~4 chars per token (GPT-style heuristic).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to a max token budget.
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
export function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + '\n...[truncated]';
}

// ─── Diff Formatting ──────────────────────────────────────────────────────────

/**
 * Renders a unified diff string with chalk colors.
 * @param {string} diff
 * @returns {string}
 */
export function formatDiff(diff) {
  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return chalk.bold(line);
      }
      if (line.startsWith('+')) {
        return chalk.green(line);
      }
      if (line.startsWith('-')) {
        return chalk.red(line);
      }
      if (line.startsWith('@@')) {
        return chalk.cyan(line);
      }
      return chalk.gray(line);
    })
    .join('\n');
}

/**
 * Creates a simple unified-diff-like string showing old vs new content.
 * @param {string} oldContent
 * @param {string} newContent
 * @param {string} filename
 * @returns {string}
 */
export function createSimpleDiff(oldContent, newContent, filename = 'file') {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const lines = [`--- a/${filename}`, `+++ b/${filename}`];

  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      lines.push(`+${newLine}`);
    } else if (newLine === undefined) {
      lines.push(`-${oldLine}`);
    } else if (oldLine !== newLine) {
      lines.push(`-${oldLine}`);
      lines.push(`+${newLine}`);
    } else {
      lines.push(` ${oldLine}`);
    }
  }

  return lines.join('\n');
}

// ─── File & Path Utilities ────────────────────────────────────────────────────

/**
 * Returns true if a path is inside the given root directory.
 * @param {string} root
 * @param {string} filePath
 * @returns {boolean}
 */
export function isInsideDirectory(root, filePath) {
  const rel = relative(resolve(root), resolve(filePath));
  return !rel.startsWith('..') && !rel.startsWith(sep);
}

/**
 * Generates a short content hash for cache-busting or backup names.
 * @param {string} content
 * @returns {string}
 */
export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * Formats a file size in bytes to human-readable.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Text Chunking ────────────────────────────────────────────────────────────

/**
 * Splits large text into chunks that fit within a token budget.
 * @param {string} text
 * @param {number} chunkTokens
 * @returns {string[]}
 */
export function chunkText(text, chunkTokens = 1024) {
  const chunkSize = chunkTokens * 4;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// ─── String Utilities ─────────────────────────────────────────────────────────

/**
 * Wraps text in a chalk-styled box.
 * @param {string} text
 * @param {chalk.Chalk} style
 * @returns {string}
 */
export function boxWrap(text, style = chalk.white) {
  const lines = text.split('\n');
  const maxLen = Math.max(...lines.map((l) => l.length));
  const border = style('─'.repeat(maxLen + 4));
  const top = style(`╭${border}╮`);
  const bottom = style(`╰${border}╯`);
  const body = lines.map((l) => style(`│  ${l.padEnd(maxLen)}  │`)).join('\n');
  return `${top}\n${body}\n${bottom}`;
}

/**
 * Pluralizes a word based on count.
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Parses tool calls from model output.
 * Models output: <tool>tool_name</tool><args>{"key":"value"}</args>
 * @param {string} text
 * @returns {{ tool: string, args: object } | null}
 */
export function parseToolCall(text) {
  const toolMatch = text.match(/<tool>([\s\S]*?)<\/tool>/);
  const argsMatch = text.match(/<args>([\s\S]*?)<\/args>/);

  if (!toolMatch) {
    return null;
  }

  const tool = toolMatch[1].trim();
  let args = {};

  if (argsMatch) {
    try {
      args = JSON.parse(argsMatch[1].trim());
    } catch {
      args = { raw: argsMatch[1].trim() };
    }
  }

  return { tool, args };
}

/**
 * Extracts a final answer from model output.
 * @param {string} text
 * @returns {string | null}
 */
export function parseFinalAnswer(text) {
  const match = text.match(/<final_answer>([\s\S]*?)<\/final_answer>/);
  return match ? match[1].trim() : null;
}

/**
 * Checks if the model output contains a tool call.
 * @param {string} text
 * @returns {boolean}
 */
export function hasToolCall(text) {
  return /<tool>/.test(text);
}

/**
 * Checks if the model output signals completion.
 * @param {string} text
 * @returns {boolean}
 */
export function hasFinalAnswer(text) {
  return /<final_answer>/.test(text) || text.includes('[DONE]');
}
