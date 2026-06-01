/**
 * scanner.js — Project scanner for detecting frameworks, languages, and structure.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('scanner');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next',
  '__pycache__', '.venv', 'venv', 'env', '.env', 'target',
  'vendor', 'coverage', '.nyc_output', '.cache', 'tmp', 'temp',
  'android', 'ios', '.dart_tool', '.flutter-plugins',
]);

// Framework detection rules: { name, files, packageDeps, score }
const FRAMEWORK_RULES = [
  { name: 'Next.js',     files: ['next.config.js', 'next.config.ts'],    packageDeps: ['next'],          score: 10 },
  { name: 'Nuxt.js',    files: ['nuxt.config.js', 'nuxt.config.ts'],    packageDeps: ['nuxt'],          score: 10 },
  { name: 'SvelteKit',  files: ['svelte.config.js'],                     packageDeps: ['@sveltejs/kit'], score: 10 },
  { name: 'Remix',      files: ['remix.config.js'],                      packageDeps: ['@remix-run/react'], score: 10 },
  { name: 'Astro',      files: ['astro.config.mjs', 'astro.config.ts'],  packageDeps: ['astro'],         score: 10 },
  { name: 'React',      files: [],                                        packageDeps: ['react', 'react-dom'], score: 7 },
  { name: 'Vue',        files: ['vue.config.js'],                        packageDeps: ['vue'],           score: 7 },
  { name: 'Angular',    files: ['angular.json'],                         packageDeps: ['@angular/core'], score: 9 },
  { name: 'Express',    files: [],                                        packageDeps: ['express'],       score: 6 },
  { name: 'Fastify',    files: [],                                        packageDeps: ['fastify'],       score: 6 },
  { name: 'NestJS',     files: ['nest-cli.json'],                        packageDeps: ['@nestjs/core'],  score: 9 },
  { name: 'Django',     files: ['manage.py', 'settings.py'],             packageDeps: [],                score: 9 },
  { name: 'Flask',      files: ['app.py', 'wsgi.py'],                    packageDeps: [],                score: 7 },
  { name: 'FastAPI',    files: ['main.py'],                              packageDeps: [],                score: 5 },
  { name: 'Flutter',    files: ['pubspec.yaml'],                         packageDeps: [],                score: 10 },
  { name: 'Electron',   files: ['electron-builder.yml'],                 packageDeps: ['electron'],      score: 8 },
  { name: 'Vite',       files: ['vite.config.js', 'vite.config.ts'],     packageDeps: ['vite'],          score: 8 },
  { name: 'Webpack',    files: ['webpack.config.js'],                    packageDeps: ['webpack'],       score: 5 },
];

// Language detection by file extension
const LANG_EXTENSIONS = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
};

// Package manager detection
const PKG_MANAGER_FILES = [
  { file: 'pnpm-lock.yaml',  manager: 'pnpm' },
  { file: 'yarn.lock',       manager: 'yarn' },
  { file: 'bun.lockb',       manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'Pipfile',         manager: 'pipenv' },
  { file: 'poetry.lock',     manager: 'poetry' },
  { file: 'Cargo.lock',      manager: 'cargo' },
  { file: 'go.sum',          manager: 'go modules' },
  { file: 'pubspec.lock',    manager: 'pub (Flutter)' },
];

export class ProjectScanner {
  /**
   * Scans a project directory and returns structured metadata.
   * @param {string} projectPath
   * @returns {Promise<ProjectInfo>}
   */
  async scan(projectPath) {
    logger.debug(`Scanning project at: ${projectPath}`);

    const [
      fileTree,
      packageJson,
      langCounts,
      packageManager,
    ] = await Promise.all([
      this._buildFileTree(projectPath),
      this._readPackageJson(projectPath),
      this._countLanguages(projectPath),
      this._detectPackageManager(projectPath),
    ]);

    const framework = this._detectFramework(fileTree, packageJson);
    const language = this._detectPrimaryLanguage(langCounts);
    const dependencies = this._extractDependencies(packageJson);
    const totalFiles = fileTree.filter((f) => !f.isDir).length;
    const totalDirs = fileTree.filter((f) => f.isDir).length;

    return {
      path: projectPath,
      name: projectPath.split(/[\\/]/).pop(),
      framework,
      language,
      packageManager,
      dependencies,
      totalFiles,
      totalDirs,
      langCounts,
      fileTree: fileTree.slice(0, 200), // limit size for context
      hasTests: fileTree.some((f) => /\btest[s]?\b|__tests__|spec/i.test(f.path)),
      hasDocker: fileTree.some((f) => /Dockerfile|docker-compose/i.test(f.path)),
      hasGit: existsSync(join(projectPath, '.git')),
      packageJson,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  async _buildFileTree(rootPath, depth = 0, maxDepth = 8) {
    const entries = [];

    if (depth > maxDepth) {
      return entries;
    }

    let items;
    try {
      items = await readdir(rootPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    for (const item of items) {
      if (IGNORE_DIRS.has(item.name) || item.name.startsWith('.') && depth > 0) {
        continue;
      }

      const fullPath = join(rootPath, item.name);
      const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        entries.push({ path: relPath, isDir: true, name: item.name });
        const children = await this._buildFileTree(fullPath, depth + 1, maxDepth);
        entries.push(...children);
      } else {
        entries.push({ path: relPath, isDir: false, name: item.name, ext: extname(item.name) });
      }
    }

    return entries;
  }

  async _readPackageJson(projectPath) {
    const pkgPath = join(projectPath, 'package.json');
    if (!existsSync(pkgPath)) {
      return null;
    }
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _detectPackageManager(projectPath) {
    for (const { file, manager } of PKG_MANAGER_FILES) {
      if (existsSync(join(projectPath, file))) {
        return manager;
      }
    }
    return null;
  }

  async _countLanguages(projectPath) {
    const counts = {};
    const files = await this._buildFileTree(projectPath);

    for (const f of files) {
      if (f.isDir) {continue;}
      const lang = LANG_EXTENSIONS[f.ext];
      if (lang) {
        counts[lang] = (counts[lang] ?? 0) + 1;
      }
    }

    return counts;
  }

  _detectFramework(fileTree, packageJson) {
    const fileNames = new Set(fileTree.map((f) => f.name));
    const filePaths = new Set(fileTree.map((f) => f.path));
    const deps = {
      ...(packageJson?.dependencies ?? {}),
      ...(packageJson?.devDependencies ?? {}),
    };

    let best = null;
    let bestScore = 0;

    for (const rule of FRAMEWORK_RULES) {
      let score = 0;

      // File match
      for (const file of rule.files) {
        if (fileNames.has(file) || filePaths.has(file)) {
          score += rule.score;
        }
      }

      // Dependency match
      for (const dep of rule.packageDeps) {
        if (dep in deps) {
          score += rule.score;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = rule.name;
      }
    }

    return best ?? 'Node.js';
  }

  _detectPrimaryLanguage(langCounts) {
    if (Object.keys(langCounts).length === 0) {
      return 'Unknown';
    }
    return Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0][0];
  }

  _extractDependencies(packageJson) {
    if (!packageJson) {
      return [];
    }
    return [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
  }
}

/**
 * @typedef {{
 *   path: string, name: string, framework: string, language: string,
 *   packageManager: string | null, dependencies: string[],
 *   totalFiles: number, totalDirs: number, langCounts: Record<string, number>,
 *   fileTree: Array<{ path: string, isDir: boolean, name: string }>,
 *   hasTests: boolean, hasDocker: boolean, hasGit: boolean,
 *   packageJson: object | null
 * }} ProjectInfo
 */
