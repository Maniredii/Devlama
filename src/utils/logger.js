/**
 * Logger — Leveled, colored logger for DevLama CLI.
 * Supports DEBUG / INFO / WARN / ERROR levels with chalk colors.
 */

import chalk from 'chalk';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_STYLES = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red.bold,
};

const LEVEL_PREFIXES = {
  debug: '🔍 DEBUG',
  info: '💡 INFO ',
  warn: '⚠️  WARN ',
  error: '❌ ERROR',
};

// Global log level — can be set via env var OLLAMA_AGENT_LOG_LEVEL
let globalLevel = process.env.OLLAMA_AGENT_LOG_LEVEL
  ? (LEVELS[process.env.OLLAMA_AGENT_LOG_LEVEL.toLowerCase()] ?? 1)
  : 1;

export class Logger {
  /**
   * @param {string} namespace - Component name shown in log prefix
   */
  constructor(namespace) {
    this.namespace = namespace;
  }

  static setLevel(level) {
    const numeric = typeof level === 'string' ? LEVELS[level.toLowerCase()] : level;
    if (numeric === undefined) {
      throw new Error(`Unknown log level: ${level}`);
    }
    globalLevel = numeric;
  }

  static enableDebug() {
    globalLevel = 0;
  }

  debug(message, ...args) {
    this._log('debug', message, ...args);
  }

  info(message, ...args) {
    this._log('info', message, ...args);
  }

  warn(message, ...args) {
    this._log('warn', message, ...args);
  }

  error(message, errorOrArgs, ...rest) {
    if (errorOrArgs instanceof Error) {
      this._log('error', `${message}: ${errorOrArgs.message}`);
      if (globalLevel === 0) {
        console.error(chalk.gray(errorOrArgs.stack));
      }
    } else {
      this._log('error', message, errorOrArgs, ...rest);
    }
  }

  _log(level, message, ...args) {
    if (LEVELS[level] < globalLevel) {
      return;
    }
    const style = LEVEL_STYLES[level];
    const prefix = LEVEL_PREFIXES[level];
    const namespace = chalk.magenta(`[${this.namespace}]`);
    const timestamp = chalk.gray(new Date().toISOString().slice(11, 23));
    const formatted = args.length > 0 ? `${message} ${args.map(String).join(' ')}` : message;
    process.stderr.write(`${timestamp} ${prefix} ${namespace} ${style(formatted)}\n`);
  }
}
