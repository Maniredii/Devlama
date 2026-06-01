/**
 * session.js — Manages session lifecycle and persistence.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '../utils/logger.js';

const logger = new Logger('session');

export class SessionManager {
  /**
   * @param {import('../utils/config.js').ConfigManager} config
   */
  constructor(config) {
    this.config = config;
    this.sessionId = randomUUID();
    this.projectPath = null;
    this.projectName = null;
    this.projectInfo = null;
    this._commandHistory = []; // Readline command history
  }

  async init() {
    this.sessionsDir = this.config.get('sessionDir');
    // Load most recent session history if available
    await this._loadLatestHistory();
  }

  /**
   * Sets the current active project.
   * @param {string} path
   * @param {import('../tools/scanner.js').ProjectInfo} info
   */
  setProject(path, info) {
    this.projectPath = path;
    this.projectName = info.name;
    this.projectInfo = info;
  }

  /**
   * Adds a command to the session history.
   * @param {string} command
   */
  addToHistory(command) {
    this._commandHistory.push(command);
  }

  /**
   * Gets the command history.
   * @returns {string[]}
   */
  getHistory() {
    return this._commandHistory;
  }

  /**
   * Saves the current session to disk.
   */
  async save() {
    if (!this.sessionsDir) {return;}

    const sessionFile = join(this.sessionsDir, `${this.sessionId}.json`);
    const data = {
      id: this.sessionId,
      timestamp: new Date().toISOString(),
      projectPath: this.projectPath,
      projectName: this.projectName,
      history: this._commandHistory.slice(-this.config.get('historySize')),
    };

    try {
      await writeFile(sessionFile, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug(`Session saved: ${this.sessionId}`);
      await this._cleanupOldSessions();
    } catch (err) {
      logger.warn(`Failed to save session: ${err.message}`);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _loadLatestHistory() {
    if (!this.sessionsDir || !existsSync(this.sessionsDir)) {return;}

    try {
      const files = await readdir(this.sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      
      if (jsonFiles.length === 0) {return;}

      // Sort by modified time (using filename/timestamp approach - for now just stat)
      // Simpler approach: assume lexicographical order of UUID is random, need to read them to find latest timestamp
      // For performance on startup, we might skip deep parsing if there are many.
      // Assuming a small number of sessions due to cleanup.
      
      let latestSession = null;
      let latestTime = 0;

      for (const file of jsonFiles) {
        const content = await readFile(join(this.sessionsDir, file), 'utf-8');
        try {
          const parsed = JSON.parse(content);
          const time = new Date(parsed.timestamp).getTime();
          if (time > latestTime) {
            latestTime = time;
            latestSession = parsed;
          }
        } catch { /* ignore malformed */ }
      }

      if (latestSession && latestSession.history) {
        this._commandHistory = latestSession.history;
        logger.debug(`Loaded history from session: ${latestSession.id}`);
      }
    } catch (err) {
      logger.debug(`Could not load latest history: ${err.message}`);
    }
  }

  async _cleanupOldSessions(maxSessions = 10) {
    try {
      const files = await readdir(this.sessionsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      if (jsonFiles.length <= maxSessions) {return;}

      const sessionsWithTime = await Promise.all(jsonFiles.map(async (file) => {
        try {
          const content = await readFile(join(this.sessionsDir, file), 'utf-8');
          const parsed = JSON.parse(content);
          return { file, time: new Date(parsed.timestamp).getTime() };
        } catch {
          return { file, time: 0 };
        }
      }));

      sessionsWithTime.sort((a, b) => b.time - a.time); // Newest first

      const toDelete = sessionsWithTime.slice(maxSessions);
      for (const { file } of toDelete) {
        await unlink(join(this.sessionsDir, file));
      }
    } catch (err) {
      logger.debug(`Cleanup error: ${err.message}`);
    }
  }
}
