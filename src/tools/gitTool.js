/**
 * gitTool.js — Git integration via simple-git with AI-assisted commit messages.
 */

import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('git-tool');

export class GitTool {
  /**
   * @param {string} repoPath - Path to the git repository root
   */
  constructor(repoPath = process.cwd()) {
    this.repoPath = repoPath;
    this._git = simpleGit(repoPath, {
      binary: 'git',
      maxConcurrentProcesses: 4,
      trimmed: true,
    });
  }

  /**
   * Checks whether the directory is a git repository.
   * @returns {Promise<boolean>}
   */
  async isRepo() {
    return existsSync(join(this.repoPath, '.git'));
  }

  /**
   * Returns the current git status.
   * @returns {Promise<import('simple-git').StatusResult>}
   */
  async status() {
    this._assertRepo();
    return this._git.status();
  }

  /**
   * Returns the current diff (staged or working tree).
   * @param {{ staged?: boolean }} [options]
   * @returns {Promise<string>}
   */
  async diff(options = {}) {
    this._assertRepo();
    if (options.staged) {
      return this._git.diff(['--cached']);
    }
    return this._git.diff();
  }

  /**
   * Stages files for commit.
   * @param {string | string[]} files - File paths, or '.' to stage all
   * @returns {Promise<void>}
   */
  async add(files = '.') {
    this._assertRepo();
    const targets = Array.isArray(files) ? files : [files];
    await this._git.add(targets);
    logger.info(`Staged: ${targets.join(', ')}`);
  }

  /**
   * Creates a commit with the given message.
   * @param {string} message
   * @param {{ noVerify?: boolean }} [options]
   * @returns {Promise<import('simple-git').CommitResult>}
   */
  async commit(message, options = {}) {
    this._assertRepo();
    const flags = [];
    if (options.noVerify) { flags.push('--no-verify'); }

    const result = await this._git.commit(message, undefined, flags.length ? flags : undefined);
    logger.info(`Committed: ${result.commit} — "${message}"`);
    return result;
  }

  /**
   * Pushes current branch to remote.
   * @param {string} [remote]
   * @param {string} [branch]
   * @returns {Promise<import('simple-git').PushResult>}
   */
  async push(remote = 'origin', branch = undefined) {
    this._assertRepo();
    const current = await this._git.branch();
    const targetBranch = branch ?? current.current;
    const result = await this._git.push(remote, targetBranch);
    logger.info(`Pushed to ${remote}/${targetBranch}`);
    return result;
  }

  /**
   * Pulls from remote.
   * @param {string} [remote]
   * @param {string} [branch]
   */
  async pull(remote = 'origin', branch = undefined) {
    this._assertRepo();
    const current = await this._git.branch();
    const targetBranch = branch ?? current.current;
    return this._git.pull(remote, targetBranch);
  }

  /**
   * Lists branches.
   * @returns {Promise<import('simple-git').BranchSummary>}
   */
  async branches() {
    this._assertRepo();
    return this._git.branch(['-a']);
  }

  /**
   * Creates and checks out a new branch.
   * @param {string} branchName
   * @returns {Promise<void>}
   */
  async createBranch(branchName) {
    this._assertRepo();
    await this._git.checkoutLocalBranch(branchName);
    logger.info(`Created and switched to branch: ${branchName}`);
  }

  /**
   * Checks out an existing branch.
   * @param {string} branchName
   */
  async checkout(branchName) {
    this._assertRepo();
    await this._git.checkout(branchName);
    logger.info(`Checked out: ${branchName}`);
  }

  /**
   * Returns recent commit log.
   * @param {number} [maxCount]
   * @returns {Promise<LogEntry[]>}
   */
  async log(maxCount = 20) {
    this._assertRepo();
    const result = await this._git.log({ maxCount });
    return result.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author: entry.author_name,
      email: entry.author_email,
    }));
  }

  /**
   * Returns the stash list.
   * @returns {Promise<string[]>}
   */
  async stashList() {
    this._assertRepo();
    const result = await this._git.stashList();
    return result.all.map((s) => s.message);
  }

  /**
   * Stashes current changes.
   * @param {string} [message]
   */
  async stash(message = undefined) {
    this._assertRepo();
    const args = message ? ['push', '-m', message] : [];
    await this._git.stash(args);
  }

  /**
   * Applies the most recent stash.
   */
  async stashPop() {
    this._assertRepo();
    await this._git.stash(['pop']);
  }

  /**
   * Gets the current branch name.
   * @returns {Promise<string>}
   */
  async currentBranch() {
    this._assertRepo();
    const result = await this._git.branch();
    return result.current;
  }

  /**
   * Returns the remote URL for a given remote name.
   * @param {string} [remote]
   * @returns {Promise<string | null>}
   */
  async remoteUrl(remote = 'origin') {
    this._assertRepo();
    try {
      return await this._git.remote(['get-url', remote]);
    } catch {
      return null;
    }
  }

  /**
   * Initialises a new git repository in repoPath.
   */
  async init() {
    await this._git.init();
    logger.info(`Initialised git repo at ${this.repoPath}`);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _assertRepo() {
    if (!existsSync(join(this.repoPath, '.git'))) {
      throw new NotAGitRepoError(
        `Not a git repository: ${this.repoPath}. Run \`git init\` or navigate to a repo.`
      );
    }
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class NotAGitRepoError extends Error {
  constructor(message) { super(message); this.name = 'NotAGitRepoError'; }
}

/**
 * @typedef {{ hash: string, date: string, message: string, author: string, email: string }} LogEntry
 */
