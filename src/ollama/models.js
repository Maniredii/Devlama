/**
 * models.js — Ollama model listing, selection, and classification.
 */

import readline from 'readline';
import chalk from 'chalk';
import { OllamaClient } from './client.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('models');

/**
 * Parameter count thresholds for model size classification (in billions).
 * Model names often contain size hints like "3b", "7b", "70b".
 */
const SMALL_MODEL_PATTERNS = [
  /tinyllama/i,
  /phi[-_]?(mini|1|2|3(?!\.5))/i,
  /gemma[-_]?2b/i,
  /qwen[-_]?0\.5b/i,
  /qwen[-_]?1\.5b/i,
  /smollm/i,
  /:0\.5b/i,
  /:1b/i,
  /:1\.5b/i,
  /:2b/i,
  /:3b/i,
];

const LARGE_MODEL_PATTERNS = [
  /:13b/i,
  /:14b/i,
  /:30b/i,
  /:32b/i,
  /:34b/i,
  /:70b/i,
  /:72b/i,
  /llama3\.1:70/i,
  /mixtral/i,
];

export class ModelManager {
  /**
   * @param {OllamaClient} client
   */
  constructor(client) {
    this.client = client;
    this._cachedModels = null;
  }

  /**
   * Fetches and caches the list of installed models.
   * @returns {Promise<ModelInfo[]>}
   */
  async getInstalledModels() {
    if (this._cachedModels) {
      return this._cachedModels;
    }

    const raw = await this.client.listModels();
    this._cachedModels = raw.map((m) => this._enrichModel(m));
    logger.debug(`Found ${this._cachedModels.length} installed models`);
    return this._cachedModels;
  }

  /**
   * Clears the model cache (call after installing/removing models).
   */
  invalidateCache() {
    this._cachedModels = null;
  }

  /**
   * Returns model size classification.
   * @param {string} modelName
   * @returns {'small' | 'medium' | 'large'}
   */
  classifySize(modelName) {
    if (SMALL_MODEL_PATTERNS.some((p) => p.test(modelName))) {
      return 'small';
    }
    if (LARGE_MODEL_PATTERNS.some((p) => p.test(modelName))) {
      return 'large';
    }
    return 'medium';
  }

  /**
   * Interactive model selector using readline.
   * @param {ModelInfo[]} [models] - Pre-fetched models, or fetch fresh
   * @returns {Promise<ModelInfo | null>}
   */
  async selectModelInteractively(models = null) {
    const list = models ?? (await this.getInstalledModels());

    if (list.length === 0) {
      console.log(chalk.yellow('\nNo models installed. Run: ollama pull <model>\n'));
      return null;
    }

    if (list.length === 1) {
      console.log(chalk.green(`\n✓ Using only available model: ${list[0].name}\n`));
      return list[0];
    }

    console.log(chalk.bold.cyan('\n📦 Installed Ollama Models:\n'));
    list.forEach((m, i) => {
      const sizeLabel = this._sizeLabel(m.size);
      const classLabel = this._classLabel(m.sizeClass);
      console.log(
        `  ${chalk.bold.white(`[${i + 1}]`)} ${chalk.green(m.name.padEnd(30))} ${sizeLabel} ${classLabel}`
      );
    });

    console.log();

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(chalk.cyan('Select model (number or name): '), (answer) => {
        rl.close();
        const trimmed = answer.trim();

        // By number
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= list.length) {
          resolve(list[num - 1]);
          return;
        }

        // By exact name
        const byName = list.find(
          (m) => m.name === trimmed || m.name.startsWith(trimmed)
        );
        if (byName) {
          resolve(byName);
          return;
        }

        console.log(chalk.yellow('Invalid selection. Using first model.'));
        resolve(list[0]);
      });
    });
  }

  /**
   * Prints a formatted model list to the console.
   * @param {ModelInfo[]} models
   */
  printModels(models) {
    if (models.length === 0) {
      console.log(chalk.yellow('No models installed.'));
      return;
    }

    console.log(chalk.bold.cyan('\n📦 Installed Ollama Models:\n'));
    console.log(
      chalk.gray(
        `  ${'#'.padEnd(4)}${'Name'.padEnd(35)}${'Size'.padEnd(12)}${'Class'.padEnd(10)}Modified`
      )
    );
    console.log(chalk.gray('  ' + '─'.repeat(75)));

    models.forEach((m, i) => {
      const num = chalk.gray(`${i + 1}.`.padEnd(4));
      const name = chalk.green(m.name.padEnd(35));
      const size = chalk.white(this._sizeLabel(m.size).padEnd(12));
      const cls = this._classLabel(m.sizeClass).padEnd(10);
      const modified = chalk.gray(new Date(m.modifiedAt).toLocaleDateString());
      console.log(`  ${num}${name}${size}${cls}${modified}`);
    });

    console.log();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _enrichModel(raw) {
    const sizeClass = this.classifySize(raw.name);
    return {
      name: raw.name,
      size: raw.size ?? 0,
      digest: raw.digest ?? '',
      modifiedAt: raw.modified_at ?? new Date().toISOString(),
      sizeClass,
      isSmall: sizeClass === 'small',
      isLarge: sizeClass === 'large',
    };
  }

  _sizeLabel(bytes) {
    if (!bytes) {
      return 'unknown';
    }
    const gb = bytes / (1024 ** 3);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
  }

  _classLabel(cls) {
    switch (cls) {
      case 'small':
        return chalk.yellow('small');
      case 'large':
        return chalk.magenta('large');
      default:
        return chalk.blue('medium');
    }
  }
}

/**
 * @typedef {{ name: string, size: number, digest: string, modifiedAt: string, sizeClass: 'small'|'medium'|'large', isSmall: boolean, isLarge: boolean }} ModelInfo
 */
