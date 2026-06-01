/**
 * ConfigManager — Manages user configuration for DevLama CLI.
 * Config is stored at ~/.devlama/config.json
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const DEFAULT_CONFIG = {
  ollamaHost: 'http://localhost:11434',
  defaultModel: null,
  theme: 'dark',
  autoApprove: false,
  contextWindowTokens: 4096,
  streamingEnabled: true,
  sessionDir: null, // filled in after init
  pluginsDir: null,
  historySize: 100,
  smallModelThreshold: 4, // billions of params — below this = small model mode
  debug: false,
};

export class ConfigManager {
  constructor() {
    this.configDir = join(homedir(), '.devlama');
    this.configPath = join(this.configDir, 'config.json');
    this._config = null;
  }

  async init() {
    // Ensure all required directories exist
    const dirs = [
      this.configDir,
      join(this.configDir, 'sessions'),
      join(this.configDir, 'plugins'),
      join(this.configDir, 'backups'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Load or create config
    if (existsSync(this.configPath)) {
      const raw = await readFile(this.configPath, 'utf-8');
      const saved = JSON.parse(raw);
      this._config = { ...DEFAULT_CONFIG, ...saved };
    } else {
      this._config = {
        ...DEFAULT_CONFIG,
        sessionDir: join(this.configDir, 'sessions'),
        pluginsDir: join(this.configDir, 'plugins'),
      };
      await this._save();
    }

    // Always ensure derived dirs are set
    if (!this._config.sessionDir) {
      this._config.sessionDir = join(this.configDir, 'sessions');
    }
    if (!this._config.pluginsDir) {
      this._config.pluginsDir = join(this.configDir, 'plugins');
    }
  }

  get(key) {
    this._assertInitialized();
    return this._config[key];
  }

  getAll() {
    this._assertInitialized();
    return { ...this._config };
  }

  async set(key, value) {
    this._assertInitialized();
    this._config[key] = value;
    await this._save();
  }

  async setMany(updates) {
    this._assertInitialized();
    Object.assign(this._config, updates);
    await this._save();
  }

  async reset() {
    this._config = {
      ...DEFAULT_CONFIG,
      sessionDir: join(this.configDir, 'sessions'),
      pluginsDir: join(this.configDir, 'plugins'),
    };
    await this._save();
  }

  async _save() {
    await writeFile(this.configPath, JSON.stringify(this._config, null, 2), 'utf-8');
  }

  _assertInitialized() {
    if (!this._config) {
      throw new Error('ConfigManager not initialized. Call init() first.');
    }
  }
}
