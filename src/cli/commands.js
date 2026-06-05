/**
 * commands.js — Commander CLI program + slash-command dispatcher.
 * Handles /help, /exit, /model, /project, /read, /edit, /fix, /git, etc.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  printHelp, printError, printInfo, printSuccess, printDivider
} from './ui.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('commands');

// Read package version for --version flag
const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dir, '../../package.json'), 'utf-8'));

// ─── Commander Program ────────────────────────────────────────────────────────

export const program = new Command();

program
  .name('oai')
  .description('DevLama CLI — Local AI Coding Agent powered by Ollama')
  .version(pkg.version, '-v, --version', 'Print version')
  .option('--model <name>', 'Specify the Ollama model to use')
  .option('--host <url>', 'Ollama host URL (default: http://localhost:11434)')
  .option('--debug', 'Enable debug logging')
  .option('--no-stream', 'Disable streaming responses')
  .option('--yes', 'Auto-approve all file operations (no confirmation prompts)');

program
  .command('models')
  .description('List all installed Ollama models')
  .action(async () => {
    const { OllamaDetector } = await import('../ollama/detector.js');
    const { OllamaClient } = await import('../ollama/client.js');
    const { ModelManager } = await import('../ollama/models.js');

    const detector = new OllamaDetector();
    const serverInfo = await detector.detect();

    if (!serverInfo.running) {
      printError('Ollama server not found. Run: ollama serve');
      process.exit(1);
    }

    const client = new OllamaClient(serverInfo.host);
    const manager = new ModelManager(client);
    const models = await manager.getInstalledModels();
    manager.printModels(models);
    process.exit(0);
  });

program
  .command('chat')
  .description('Start an interactive chat session')
  .option('--model <name>', 'Model to use')
  .action(async (options) => {
    // Delegates to the main REPL flow
    const { ConfigManager } = await import('../utils/config.js');
    const { OllamaDetector } = await import('../ollama/detector.js');
    const { startInteractiveSession } = await import('./prompt.js');
    const { printBanner } = await import('./ui.js');

    printBanner();
    const config = new ConfigManager();
    await config.init();

    if (options.model) {
      await config.set('defaultModel', options.model);
    }

    const detector = new OllamaDetector(config);
    const serverInfo = await detector.detect();

    if (!serverInfo.running) {
      printError('Ollama server not found. Run: ollama serve');
      process.exit(1);
    }

    await startInteractiveSession(config, serverInfo);
  });

program
  .command('run')
  .description('Auto-scan the project and run a prompt immediately')
  .argument('<prompt...>', 'The prompt/task to execute')
  .option('--model <name>', 'Model to use')
  .action(async (promptParts, options) => {
    const { ConfigManager } = await import('../utils/config.js');
    const { OllamaDetector } = await import('../ollama/detector.js');
    const { startWithPrompt } = await import('./prompt.js');
    const { printBanner } = await import('./ui.js');

    printBanner();
    const config = new ConfigManager();
    await config.init();

    if (options.model) {
      await config.set('defaultModel', options.model);
    }

    const detector = new OllamaDetector(config);
    const serverInfo = await detector.detect();

    if (!serverInfo.running) {
      printError('Ollama server not found. Run: ollama serve');
      process.exit(1);
    }

    const userPrompt = promptParts.join(' ');
    await startWithPrompt(config, serverInfo, userPrompt);
  });

// ─── Slash-Command Dispatcher ─────────────────────────────────────────────────

export class CommandDispatcher {
  /**
   * @param {{ agent, session, memory, config, client, modelManager }} deps
   */
  constructor(deps) {
    this.agent = deps.agent;
    this.session = deps.session;
    this.memory = deps.memory;
    this.config = deps.config;
    this.client = deps.client;
    this.modelManager = deps.modelManager;
  }

  /**
   * Dispatches a slash command string to the appropriate handler.
   * @param {string} input - e.g. "/git status"
   * @param {{ currentModel, models }} context
   * @returns {Promise<{ type: string } | null>}
   */
  async dispatch(input, context) {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    logger.debug(`Dispatching command: /${cmd} args=${args.join(' ')}`);

    switch (cmd) {
      case 'help':
        return this._cmdHelp();

      case 'exit':
      case 'quit':
        return { type: 'exit' };

      case 'clear':
        return this._cmdClear();

      case 'model':
        return this._cmdModel(args, context);

      case 'models':
        return this._cmdModels(context);

      case 'project':
        return this._cmdProject(args);

      case 'read':
        return this._cmdRead(args);

      case 'edit':
        return this._cmdEdit(args);

      case 'fix':
        return this._cmdFix(args);

      case 'architect':
        return this._cmdArchitect(args);

      case 'git':
        return this._cmdGit(args);

      case 'commit':
        return this._cmdCommit();

      case 'memory':
        return this._cmdMemory();

      case 'plugin':
        return this._cmdPlugin(args);

      case 'config':
        return this._cmdConfig(args);

      default:
        printError(`Unknown command: /${cmd}. Type /help for available commands.`);
        return null;
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  _cmdHelp() {
    printHelp();
    return null;
  }

  _cmdClear() {
    process.stdout.write('\x1Bc'); // ANSI clear screen
    return null;
  }

  async _cmdModel(args, { currentModel, models }) {
    if (args.length > 0) {
      const name = args.join(' ');
      const found = models.find((m) => m.name === name || m.name.startsWith(name));
      if (!found) {
        printError(`Model not found: ${name}`);
        return null;
      }
      return { type: 'model_change', model: found };
    }

    // Interactive selection
    const selected = await this.modelManager.selectModelInteractively(models);
    if (selected && selected.name !== currentModel.name) {
      return { type: 'model_change', model: selected };
    }
    return null;
  }

  async _cmdModels({ models }) {
    this.modelManager.printModels(models);
    return null;
  }

  async _cmdProject(args) {
    const { ProjectScanner } = await import('../tools/scanner.js');
    const projectPath = args[0] ?? process.cwd();

    const { startSpinner, stopSpinner } = await import('./ui.js');
    const spinner = startSpinner('Scanning project...');

    try {
      const scanner = new ProjectScanner();
      const info = await scanner.scan(projectPath);
      stopSpinner('succeed', 'Project scanned');

      this.session.setProject(projectPath, info);

      console.log(chalk.bold.cyan('\n📁 Project Summary\n'));
      printDivider();
      console.log(`  Framework   : ${chalk.green(info.framework ?? 'Unknown')}`);
      console.log(`  Language    : ${chalk.green(info.language ?? 'Unknown')}`);
      console.log(`  Pkg Manager : ${chalk.green(info.packageManager ?? 'N/A')}`);
      console.log(`  Files       : ${chalk.white(info.totalFiles)}`);
      console.log(`  Directories : ${chalk.white(info.totalDirs)}`);

      if (info.dependencies?.length > 0) {
        console.log(`  Key Deps    : ${chalk.gray(info.dependencies.slice(0, 5).join(', '))}`);
      }
      printDivider();
      console.log();

      printSuccess(`Project set to: ${projectPath}`);
    } catch (err) {
      stopSpinner('fail', 'Scan failed');
      printError(err.message);
    }

    return null;
  }

  async _cmdRead(args) {
    if (args.length === 0) {
      printError('Usage: /read <file-path>');
      return null;
    }

    const filePath = args.join(' ');
    const { FileReader } = await import('../tools/fileReader.js');
    const { startSpinner, stopSpinner } = await import('./ui.js');

    const spinner = startSpinner(`Reading ${filePath}...`);
    try {
      const reader = new FileReader();
      const content = await reader.readFile(filePath);
      stopSpinner('succeed');

      // Add file to context and ask agent to analyze
      const prompt = `Please analyze this file and provide insights:\n\nFile: ${filePath}\n\`\`\`\n${content}\n\`\`\``;
      await this.agent.addUserMessage(prompt);
      console.log(chalk.bold.cyan('\nAssistant: '));
      await this.agent.continueStreaming((token) => process.stdout.write(chalk.white(token)));
      console.log('\n');
    } catch (err) {
      stopSpinner('fail', 'Read failed');
      printError(err.message);
    }

    return null;
  }

  async _cmdEdit(args) {
    const description = args.join(' ');
    if (!description) {
      printError('Usage: /edit <description of changes>');
      return null;
    }

    await this.agent.run(`/edit: ${description}`);
    return null;
  }

  async _cmdFix(args) {
    const error = args.join(' ');
    if (!error) {
      printError('Usage: /fix <error message or description>');
      return null;
    }

    await this.agent.run(`/fix: ${error}`);
    return null;
  }

  async _cmdArchitect(args) {
    const description = args.join(' ');
    if (!description) {
      printError('Usage: /architect <project description>');
      return null;
    }

    await this.agent.run(`/architect: ${description}`);
    return null;
  }

  async _cmdGit(args) {
    if (args.length === 0) {
      printError('Usage: /git <status|diff|log|branch>');
      return null;
    }

    const { GitTool } = await import('../tools/gitTool.js');
    const git = new GitTool(this.session.projectPath ?? process.cwd());
    const subCmd = args[0].toLowerCase();

    try {
      switch (subCmd) {
        case 'status': {
          const status = await git.status();
          printInfo('Git Status:');
          console.log(chalk.white(JSON.stringify(status, null, 2)));
          break;
        }
        case 'diff': {
          const diff = await git.diff();
          const { printDiff } = await import('./ui.js');
          printDiff(diff);
          break;
        }
        case 'log': {
          const log = await git.log(10);
          printInfo('Recent commits:');
          log.forEach((c) => {
            console.log(`  ${chalk.yellow(c.hash.slice(0, 7))} ${chalk.gray(c.date)} ${chalk.white(c.message)}`);
          });
          break;
        }
        case 'branch': {
          const branches = await git.branches();
          printInfo('Branches:');
          branches.all.forEach((b) => {
            const isCurrent = b === branches.current;
            console.log(`  ${isCurrent ? chalk.green('* ') : '  '}${chalk.white(b)}`);
          });
          break;
        }
        case 'push': {
          const { startSpinner, stopSpinner } = await import('./ui.js');
          startSpinner('Pushing...');
          await git.push();
          stopSpinner('succeed', 'Pushed successfully');
          break;
        }
        default:
          printError(`Unknown git sub-command: ${subCmd}`);
      }
    } catch (err) {
      printError(`Git error: ${err.message}`);
    }

    return null;
  }

  async _cmdCommit() {
    const { GitTool } = await import('../tools/gitTool.js');
    const { startSpinner, stopSpinner } = await import('./ui.js');

    const git = new GitTool(this.session.projectPath ?? process.cwd());

    startSpinner('Generating AI commit message...');
    try {
      const diff = await git.diff();
      stopSpinner();

      if (!diff.trim()) {
        printWarning('No staged changes to commit. Run: git add <files>');
        return null;
      }

      const message = await this.agent.generateCommitMessage(diff);
      stopSpinner();

      console.log(chalk.bold.cyan('\nGenerated commit message:\n'));
      console.log(chalk.white(`  "${message}"\n`));

      // Auto-commit or ask for confirmation
      const autoApprove = this.config.get('autoApprove');
      if (autoApprove) {
        startSpinner('Committing...');
        await git.commit(message);
        stopSpinner('succeed', 'Committed!');
      } else {
        const confirmed = await this._confirm(`Commit with this message?`);
        if (confirmed) {
          startSpinner('Committing...');
          await git.commit(message);
          stopSpinner('succeed', 'Committed!');
        } else {
          printInfo('Commit cancelled.');
        }
      }
    } catch (err) {
      stopSpinner('fail');
      printError(`Commit failed: ${err.message}`);
    }

    return null;
  }

  _cmdMemory() {
    const stats = this.memory.getStats();
    console.log(chalk.bold.cyan('\n🧠 Session Memory\n'));
    printDivider();
    console.log(`  Messages     : ${chalk.white(stats.messageCount)}`);
    console.log(`  Est. Tokens  : ${chalk.white(stats.estimatedTokens)}`);
    console.log(`  Budget Used  : ${chalk.white(stats.budgetPercent + '%')}`);
    console.log(`  Model        : ${chalk.green(stats.model)}`);
    console.log(`  Mode         : ${chalk.yellow(stats.mode)}`);

    if (this.session.projectName) {
      console.log(`  Project      : ${chalk.yellow(this.session.projectName)}`);
    }
    printDivider();
    console.log();
    return null;
  }

  async _cmdPlugin(args) {
    const { PluginManager } = await import('../plugins/pluginManager.js');
    const pm = new PluginManager(this.config);
    const sub = args[0]?.toLowerCase();

    switch (sub) {
      case 'list': {
        const plugins = pm.list();
        if (plugins.length === 0) {
          printInfo('No plugins installed. Use: /plugin install <name>');
        } else {
          console.log(chalk.bold.cyan('\n🔌 Installed Plugins:\n'));
          plugins.forEach((p) => {
            console.log(`  ${chalk.green(p.name.padEnd(20))} ${chalk.gray(p.description)}`);
          });
          console.log();
        }
        break;
      }
      case 'install': {
        const name = args[1];
        if (!name) {
          printError('Usage: /plugin install <name>');
          break;
        }
        const { startSpinner, stopSpinner } = await import('./ui.js');
        startSpinner(`Installing plugin: ${name}...`);
        try {
          await pm.install(name);
          stopSpinner('succeed', `Plugin installed: ${name}`);
        } catch (err) {
          stopSpinner('fail', err.message);
        }
        break;
      }
      case 'uninstall': {
        const name = args[1];
        if (!name) { printError('Usage: /plugin uninstall <name>'); break; }
        pm.uninstall(name);
        printSuccess(`Plugin removed: ${name}`);
        break;
      }
      default:
        printInfo('Usage: /plugin <list|install|uninstall> [name]');
    }

    return null;
  }

  async _cmdConfig(args) {
    if (args.length === 0) {
      const all = this.config.getAll();
      console.log(chalk.bold.cyan('\n⚙️  Configuration\n'));
      printDivider();
      for (const [key, val] of Object.entries(all)) {
        console.log(`  ${chalk.cyan(key.padEnd(25))} ${chalk.white(JSON.stringify(val))}`);
      }
      printDivider();
      console.log();
    } else if (args.length === 2) {
      const [key, value] = args;
      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      await this.config.set(key, parsed);
      printSuccess(`Config updated: ${key} = ${JSON.stringify(parsed)}`);
    } else {
      printError('Usage: /config  OR  /config <key> <value>');
    }
    return null;
  }

  // ─── Shared Helpers ────────────────────────────────────────────────────────

  async _confirm(question) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(chalk.yellow(`\n  ${question} [y/N] `), (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === 'y');
      });
    });
  }
}
