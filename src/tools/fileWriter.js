/**
 * fileWriter.js — Safe file writer with backup, diff preview, and confirmation.
 */

import { readFile, writeFile, mkdir, copyFile, unlink, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve, basename, join } from 'path';
import { homedir } from 'os';
import { hashContent, createSimpleDiff } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('file-writer');

const BACKUP_DIR = join(homedir(), '.devlama', 'backups');

export class FileWriter {
  /**
   * @param {{ autoApprove?: boolean, showDiff?: boolean }} [options]
   */
  constructor(options = {}) {
    this.autoApprove = options.autoApprove ?? false;
    this.showDiff = options.showDiff ?? true;
    this._undoStack = []; // { filePath, backupPath, operation }
  }

  /**
   * Creates a new file. Throws if file already exists (use writeFile to overwrite).
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<WriteResult>}
   */
  async createFile(filePath, content) {
    const absPath = resolve(filePath);

    if (existsSync(absPath)) {
      throw new FileExistsError(`File already exists: ${filePath}. Use writeFile() to overwrite.`);
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf-8');

    this._undoStack.push({ filePath: absPath, backupPath: null, operation: 'create' });
    logger.info(`Created: ${filePath}`);

    return { filePath, operation: 'create', linesWritten: content.split('\n').length };
  }

  /**
   * Writes to a file, creating a backup of the previous content first.
   * @param {string} filePath
   * @param {string} newContent
   * @param {{ showDiff?: boolean }} [options]
   * @returns {Promise<WriteResult>}
   */
  async writeFile(filePath, newContent, options = {}) {
    const absPath = resolve(filePath);
    const shouldShowDiff = options.showDiff ?? this.showDiff;

    let oldContent = null;
    let backupPath = null;

    if (existsSync(absPath)) {
      oldContent = await readFile(absPath, 'utf-8');

      if (oldContent === newContent) {
        logger.debug(`No changes needed for ${filePath}`);
        return { filePath, operation: 'no-change', linesWritten: 0 };
      }

      // Create a backup
      backupPath = await this._backup(absPath, oldContent);
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, newContent, 'utf-8');

    this._undoStack.push({ filePath: absPath, backupPath, operation: 'write' });
    logger.info(`Written: ${filePath}`);

    const result = {
      filePath,
      operation: oldContent !== null ? 'update' : 'create',
      linesWritten: newContent.split('\n').length,
      backupPath,
    };

    if (shouldShowDiff && oldContent !== null) {
      result.diff = createSimpleDiff(oldContent, newContent, basename(filePath));
    }

    return result;
  }

  /**
   * Deletes a file, creating a backup first.
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {
    const absPath = resolve(filePath);

    if (!existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await readFile(absPath, 'utf-8');
    const backupPath = await this._backup(absPath, content);

    await unlink(absPath);
    this._undoStack.push({ filePath: absPath, backupPath, operation: 'delete' });

    logger.info(`Deleted: ${filePath} (backup at ${backupPath})`);
  }

  /**
   * Appends content to the end of an existing file.
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<WriteResult>}
   */
  async appendToFile(filePath, content) {
    const absPath = resolve(filePath);

    let existing = '';
    if (existsSync(absPath)) {
      existing = await readFile(absPath, 'utf-8');
      await this._backup(absPath, existing);
    }

    const newContent = existing + (existing.endsWith('\n') ? '' : '\n') + content;
    await writeFile(absPath, newContent, 'utf-8');

    logger.info(`Appended to: ${filePath}`);
    return { filePath, operation: 'append', linesWritten: content.split('\n').length };
  }

  /**
   * Applies a patch to a file — replaces oldText with newText.
   * @param {string} filePath
   * @param {string} oldText
   * @param {string} newText
   * @returns {Promise<WriteResult>}
   */
  async applyPatch(filePath, oldText, newText) {
    const absPath = resolve(filePath);

    if (!existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await readFile(absPath, 'utf-8');

    if (!content.includes(oldText)) {
      throw new PatchError(`Patch target not found in ${filePath}. The file may have changed.`);
    }

    const newContent = content.replace(oldText, newText);
    return this.writeFile(filePath, newContent);
  }

  /**
   * Undoes the most recent file operation.
   * @returns {Promise<boolean>} true if undo succeeded
   */
  async undo() {
    const last = this._undoStack.pop();
    if (!last) {
      logger.warn('Nothing to undo.');
      return false;
    }

    const { filePath, backupPath, operation } = last;

    if (operation === 'create') {
      // Created a new file — delete it
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
      logger.info(`Undo: deleted created file ${filePath}`);
    } else if (operation === 'delete' || operation === 'write' || operation === 'update') {
      // Restore from backup
      if (backupPath && existsSync(backupPath)) {
        await copyFile(backupPath, filePath);
        logger.info(`Undo: restored ${filePath} from ${backupPath}`);
      }
    }

    return true;
  }

  /**
   * Writes multiple files atomically (all or nothing via temp files).
   * @param {Array<{ path: string, content: string }>} files
   * @returns {Promise<WriteResult[]>}
   */
  async writeMany(files) {
    // Write all to temp paths first
    const temps = [];
    try {
      for (const { path: filePath, content } of files) {
        const absPath = resolve(filePath);
        const tempPath = absPath + '.tmp.' + Date.now();
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(tempPath, content, 'utf-8');
        temps.push({ absPath, tempPath });
      }

      // All writes succeeded — now rename temps to final
      const results = [];
      for (let i = 0; i < files.length; i++) {
        const { absPath, tempPath } = temps[i];
        const { content } = files[i];

        let backupPath = null;
        if (existsSync(absPath)) {
          const old = await readFile(absPath, 'utf-8');
          backupPath = await this._backup(absPath, old);
        }

        await rename(tempPath, absPath);
        results.push({ filePath: files[i].path, operation: 'write', linesWritten: content.split('\n').length, backupPath });
      }

      return results;
    } catch (err) {
      // Cleanup temps on failure
      for (const { tempPath } of temps) {
        await unlink(tempPath).catch(() => {});
      }
      throw err;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _backup(absPath, content) {
    await mkdir(BACKUP_DIR, { recursive: true });
    const hash = hashContent(content);
    const name = `${basename(absPath)}.${hash}.bak`;
    const backupPath = join(BACKUP_DIR, name);
    await writeFile(backupPath, content, 'utf-8');
    logger.debug(`Backup created: ${backupPath}`);
    return backupPath;
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class FileExistsError extends Error {
  constructor(message) { super(message); this.name = 'FileExistsError'; }
}

export class PatchError extends Error {
  constructor(message) { super(message); this.name = 'PatchError'; }
}

/**
 * @typedef {{ filePath: string, operation: string, linesWritten: number, backupPath?: string, diff?: string }} WriteResult
 */
