/**
 * pluginManager.js — Loads and manages DevLama plugins.
 */

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('plugin-manager');
const __dir = dirname(fileURLToPath(import.meta.url));

export class PluginManager {
  /**
   * @param {import('../utils/config.js').ConfigManager} config 
   */
  constructor(config) {
    this.config = config;
    this.plugins = new Map(); // name -> instance
    
    // Built-in plugins dir
    this.builtInDir = resolve(__dir, '../../plugins');
    // User installed plugins dir
    this.userDir = this.config.get('pluginsDir');
  }

  /**
   * Discovers and loads all plugins.
   * @param {{ agent, session, config }} context 
   */
  async loadAll(context) {
    await this._loadFromDir(this.builtInDir, context);
    if (this.userDir && existsSync(this.userDir)) {
      await this._loadFromDir(this.userDir, context);
    }
    logger.debug(`Loaded ${this.plugins.size} plugins.`);
  }

  /**
   * Lists all loaded plugins.
   * @returns {Array<{ name: string, description: string }>}
   */
  list() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      description: p.description
    }));
  }

  /**
   * Installs a plugin (mock implementation for MVP).
   * @param {string} name 
   */
  async install(name) {
    throw new Error(`Plugin installation from registry not yet implemented. Cannot install '${name}'.`);
  }

  /**
   * Uninstalls a plugin.
   * @param {string} name 
   */
  uninstall(name) {
    if (this.plugins.has(name)) {
      this.plugins.delete(name);
      // Actual file deletion would go here
    }
  }

  /**
   * Collects all additional system prompt text from loaded plugins.
   * @returns {string}
   */
  getSystemPromptExtensions() {
    let extensions = '';
    for (const plugin of this.plugins.values()) {
      const ext = plugin.getSystemPromptExtensions();
      if (ext) {
        extensions += `\n[Plugin: ${plugin.name}]\n${ext}\n`;
      }
    }
    return extensions;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _loadFromDir(dir, context) {
    if (!existsSync(dir)) {return;}

    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          try {
            const entryPath = join(dir, item.name, 'index.js');
            if (existsSync(entryPath)) {
              // Convert to file URL for dynamic import on Windows
              const fileUrl = pathToFileURL(entryPath).href;
              const module = await import(fileUrl);
              
              if (module.default) {
                const pluginInstance = new module.default();
                await pluginInstance.initialize(context);
                this.plugins.set(pluginInstance.name, pluginInstance);
                logger.debug(`Loaded plugin: ${pluginInstance.name}`);
              }
            }
          } catch (err) {
            logger.warn(`Failed to load plugin from ${item.name}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      logger.error(`Error reading plugin directory ${dir}`, err);
    }
  }
}
