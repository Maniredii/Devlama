/**
 * terminal.js — Cross-platform shell command executor with streaming output.
 */

import { spawn } from 'child_process';
import { platform } from 'os';
import { Logger } from '../utils/logger.js';

const logger = new Logger('terminal');

const IS_WINDOWS = platform() === 'win32';

// Commands blocked for safety
const BLOCKED_COMMANDS = new Set([
  'rm -rf /', 'rmdir /s /q C:\\', 'format c:', 'mkfs',
  'dd if=/dev/zero', ':(){:|:&};:',
]);

export class Terminal {
  /**
   * @param {{ cwd?: string, timeout?: number, allowedCommands?: string[] }} [options]
   */
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeout = options.timeout ?? 30_000; // 30s default
    this.allowedCommands = options.allowedCommands ?? null; // null = allow all
  }

  /**
   * Runs a shell command and returns the full output.
   * @param {string} command
   * @param {{ cwd?: string, timeout?: number, env?: object }} [options]
   * @returns {Promise<CommandResult>}
   */
  async run(command, options = {}) {
    this._assertSafe(command);

    const cwd = options.cwd ?? this.cwd;
    const timeout = options.timeout ?? this.timeout;
    const env = { ...process.env, ...(options.env ?? {}) };

    logger.debug(`Running: ${command} (cwd: ${cwd})`);

    return new Promise((resolve, reject) => {
      const [shell, shellFlag] = IS_WINDOWS
        ? ['cmd.exe', '/c']
        : ['/bin/sh', '-c'];

      const child = spawn(shell, [shellFlag, command], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new CommandTimeoutError(`Command timed out after ${timeout}ms: ${command}`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        const result = {
          command,
          exitCode: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
        };
        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new CommandError(`Failed to start command "${command}": ${err.message}`));
      });
    });
  }

  /**
   * Runs a command and streams stdout/stderr in real time.
   * @param {string} command
   * @param {(line: string, type: 'stdout' | 'stderr') => void} onLine
   * @param {{ cwd?: string, timeout?: number }} [options]
   * @returns {Promise<CommandResult>}
   */
  async runStreaming(command, onLine, options = {}) {
    this._assertSafe(command);

    const cwd = options.cwd ?? this.cwd;
    const timeout = options.timeout ?? this.timeout;

    logger.debug(`Streaming: ${command}`);

    return new Promise((resolve, reject) => {
      const [shell, shellFlag] = IS_WINDOWS
        ? ['cmd.exe', '/c']
        : ['/bin/sh', '-c'];

      const child = spawn(shell, [shellFlag, command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      const handleData = (chunk, type) => {
        const text = chunk.toString();
        if (type === 'stdout') { stdout += text; }
        else { stderr += text; }

        // Split into lines and emit each
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim()) { onLine(line, type); }
        }
      };

      child.stdout.on('data', (c) => handleData(c, 'stdout'));
      child.stderr.on('data', (c) => handleData(c, 'stderr'));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new CommandTimeoutError(`Command timed out: ${command}`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new CommandError(`Command failed: ${err.message}`));
      });
    });
  }

  /**
   * Runs a command and throws if it exits with non-zero.
   * @param {string} command
   * @param {{ cwd?: string }} [options]
   * @returns {Promise<string>} stdout
   */
  async runOrThrow(command, options = {}) {
    const result = await this.run(command, options);
    if (!result.success) {
      throw new CommandError(
        `Command failed (exit ${result.exitCode}): ${command}\n${result.stderr}`
      );
    }
    return result.stdout;
  }

  /**
   * Checks whether a CLI tool is available on PATH.
   * @param {string} toolName
   * @returns {Promise<boolean>}
   */
  async isAvailable(toolName) {
    const checkCmd = IS_WINDOWS ? `where ${toolName}` : `which ${toolName}`;
    try {
      const result = await this.run(checkCmd, { timeout: 5000 });
      return result.success;
    } catch {
      return false;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _assertSafe(command) {
    const normalized = command.toLowerCase().trim();
    for (const blocked of BLOCKED_COMMANDS) {
      if (normalized.includes(blocked)) {
        throw new DangerousCommandError(`Blocked dangerous command: ${command}`);
      }
    }

    if (this.allowedCommands !== null) {
      const allowed = this.allowedCommands.some((prefix) =>
        normalized.startsWith(prefix.toLowerCase())
      );
      if (!allowed) {
        throw new CommandError(
          `Command not in allowed list: ${command}`
        );
      }
    }
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class CommandError extends Error {
  constructor(message) { super(message); this.name = 'CommandError'; }
}

export class CommandTimeoutError extends Error {
  constructor(message) { super(message); this.name = 'CommandTimeoutError'; }
}

export class DangerousCommandError extends Error {
  constructor(message) { super(message); this.name = 'DangerousCommandError'; }
}

/**
 * @typedef {{ command: string, exitCode: number, stdout: string, stderr: string, success: boolean }} CommandResult
 */
