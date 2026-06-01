/**
 * fileReader.js — Safe file and folder reader with ignore rules and chunking.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { chunkText, estimateTokens, formatBytes } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('file-reader');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor',
  'coverage', '.nyc_output', '.cache', '.dart_tool',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.lock',
]);

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export class FileReader {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Reads a single file's content.
   * @param {string} filePath
   * @param {{ useCache?: boolean }} [options]
   * @returns {Promise<string>}
   */
  async readFile(filePath, options = {}) {
    const absPath = resolve(filePath);

    if (!existsSync(absPath)) {
      throw new FileNotFoundError(`File not found: ${filePath}`);
    }

    if (options.useCache && this._cache.has(absPath)) {
      logger.debug(`Cache hit for ${filePath}`);
      return this._cache.get(absPath);
    }

    const info = await stat(absPath);

    if (info.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filePath}. Use readFolder() instead.`);
    }

    if (info.size > MAX_FILE_SIZE_BYTES) {
      throw new FileTooLargeError(
        `File too large (${formatBytes(info.size)}): ${filePath}. Max: ${formatBytes(MAX_FILE_SIZE_BYTES)}`
      );
    }

    const ext = extname(absPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      throw new BinaryFileError(`Cannot read binary file: ${filePath} (${ext})`);
    }

    const content = await readFile(absPath, 'utf-8');

    if (options.useCache) {
      this._cache.set(absPath, content);
    }

    logger.debug(`Read ${filePath} — ${formatBytes(info.size)}, ~${estimateTokens(content)} tokens`);
    return content;
  }

  /**
   * Reads a file and returns it chunked for small-model contexts.
   * @param {string} filePath
   * @param {number} chunkTokens
   * @returns {Promise<{ content: string, chunks: string[], totalTokens: number }>}
   */
  async readFileChunked(filePath, chunkTokens = 1024) {
    const content = await this.readFile(filePath);
    const totalTokens = estimateTokens(content);
    const chunks = totalTokens > chunkTokens ? chunkText(content, chunkTokens) : [content];

    return { content, chunks, totalTokens };
  }

  /**
   * Reads all readable files in a directory recursively.
   * @param {string} folderPath
   * @param {{ maxFiles?: number, maxTokensPerFile?: number }} [options]
   * @returns {Promise<FileEntry[]>}
   */
  async readFolder(folderPath, options = {}) {
    const absPath = resolve(folderPath);
    const { maxFiles = 100, maxTokensPerFile = 2048 } = options;

    if (!existsSync(absPath)) {
      throw new FileNotFoundError(`Folder not found: ${folderPath}`);
    }

    const entries = [];
    await this._walkDirectory(absPath, absPath, entries, maxFiles);

    const results = [];
    for (const entry of entries) {
      try {
        const content = await readFile(entry.absPath, 'utf-8');
        const tokens = estimateTokens(content);
        results.push({
          path: entry.relPath,
          absPath: entry.absPath,
          content: tokens > maxTokensPerFile
            ? content.slice(0, maxTokensPerFile * 4) + '\n...[truncated]'
            : content,
          tokens,
          truncated: tokens > maxTokensPerFile,
          size: entry.size,
        });
      } catch (err) {
        logger.debug(`Skipping ${entry.relPath}: ${err.message}`);
      }
    }

    logger.debug(`Read ${results.length} files from ${folderPath}`);
    return results;
  }

  /**
   * Returns a formatted string representing the folder's file tree.
   * @param {string} folderPath
   * @param {number} [maxDepth]
   * @returns {Promise<string>}
   */
  async getFileTree(folderPath, maxDepth = 5) {
    const absPath = resolve(folderPath);
    const lines = [];
    await this._buildTreeLines(absPath, '', lines, 0, maxDepth);
    return lines.join('\n');
  }

  /**
   * Searches files for a pattern.
   * @param {string} folderPath
   * @param {string | RegExp} pattern
   * @returns {Promise<SearchResult[]>}
   */
  async searchInFiles(folderPath, pattern) {
    const files = await this.readFolder(folderPath);
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
    const results = [];

    for (const file of files) {
      const lines = file.content.split('\n');
      const matches = [];

      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          matches.push({ line: idx + 1, content: line.trim() });
        }
        regex.lastIndex = 0; // reset for global regex
      });

      if (matches.length > 0) {
        results.push({ path: file.path, matches });
      }
    }

    return results;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _walkDirectory(rootPath, currentPath, entries, maxFiles) {
    if (entries.length >= maxFiles) {
      return;
    }

    let items;
    try {
      items = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (entries.length >= maxFiles) {
        break;
      }

      if (IGNORE_DIRS.has(item.name) || item.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(currentPath, item.name);

      if (item.isDirectory()) {
        await this._walkDirectory(rootPath, fullPath, entries, maxFiles);
      } else {
        const ext = extname(item.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          continue;
        }
        let fileSize = 0;
        try {
          const s = await stat(fullPath);
          fileSize = s.size;
          if (fileSize > MAX_FILE_SIZE_BYTES) {
            continue;
          }
        } catch {
          continue;
        }
        entries.push({
          absPath: fullPath,
          relPath: relative(rootPath, fullPath).replace(/\\/g, '/'),
          size: fileSize,
        });
      }
    }
  }

  async _buildTreeLines(currentPath, prefix, lines, depth, maxDepth) {
    if (depth > maxDepth) {
      return;
    }

    let items;
    try {
      items = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const filtered = items.filter(
      (i) => !IGNORE_DIRS.has(i.name) && !(i.name.startsWith('.') && depth > 0)
    );

    filtered.forEach((item, idx) => {
      const isLast = idx === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      lines.push(`${prefix}${connector}${item.name}`);

      if (item.isDirectory()) {
        const fullPath = join(currentPath, item.name);
        this._buildTreeLines(fullPath, prefix + childPrefix, lines, depth + 1, maxDepth);
      }
    });
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class FileNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

export class FileTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

export class BinaryFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BinaryFileError';
  }
}

/**
 * @typedef {{ path: string, absPath: string, content: string, tokens: number, truncated: boolean, size: number }} FileEntry
 * @typedef {{ path: string, matches: Array<{ line: number, content: string }> }} SearchResult
 */
