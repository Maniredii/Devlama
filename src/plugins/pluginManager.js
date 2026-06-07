/**
 * pluginManager.js — Loads and manages DevLama plugins.
 */

import { readdir } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';
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
   * Installs a plugin via NPM.
   * @param {string} name 
   */
  async install(name) {
    if (!this.userDir) {
      throw new Error('Plugins directory not configured in user config.');
    }
    
    if (!existsSync(this.userDir)) {
      mkdirSync(this.userDir, { recursive: true });
    }

    const packageName = `devlama-plugin-${name}`;
    logger.info(`Installing plugin ${packageName}...`);
    
    try {
      // Install into the user's plugin directory
      execSync(`npm install --prefix "${this.userDir}" ${packageName}`, { stdio: 'ignore' });
      logger.info(`Successfully installed ${packageName}.`);
    } catch (err) {
      logger.error(`Failed to install ${packageName}:`, err);
      throw new Error(`Failed to install plugin '${name}'. Ensure the package '${packageName}' exists on NPM.`);
    }
  }

  /**
   * Uninstalls a plugin.
   * @param {string} name 
   */
  uninstall(name) {
    if (this.plugins.has(name)) {
      this.plugins.delete(name);
    }
    
    if (this.userDir && existsSync(this.userDir)) {
      const packageName = `devlama-plugin-${name}`;
      try {
        execSync(`npm uninstall --prefix "${this.userDir}" ${packageName}`, { stdio: 'ignore' });
        logger.info(`Successfully uninstalled ${packageName}.`);
      } catch (err) {
        logger.warn(`Failed to uninstall npm package ${packageName}: ${err.message}`);
      }
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
            // If the directory was a node_module package, the entry path might be inside node_modules
            const nodeModulesEntry = join(dir, 'node_modules', item.name, 'index.js');
            
            const targetPath = existsSync(nodeModulesEntry) ? nodeModulesEntry : (existsSync(entryPath) ? entryPath : null);

            if (targetPath) {
              // Convert to file URL for dynamic import on Windows
              const fileUrl = pathToFileURL(targetPath).href;
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
