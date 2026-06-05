/**
 * prompt.js — Interactive REPL (Read-Eval-Print Loop) for DevLama CLI.
 * Handles user input, command routing, and streaming AI responses.
 */

import readline from 'readline';
import chalk from 'chalk';
import { ModelManager } from '../ollama/models.js';
import { OllamaClient } from '../ollama/client.js';
import { Agent } from '../core/agent.js';
import { SessionManager } from '../core/session.js';
import { MemoryManager } from '../core/memory.js';
import { ProjectScanner } from '../tools/scanner.js';
import {
  printToken, endStream,
  printError, printSuccess, printInfo,
  getPromptString, startSpinner, stopSpinner, printDivider
} from './ui.js';
import { CommandDispatcher } from './commands.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('prompt');

/**
 * Starts the interactive DevLama CLI session.
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ running: boolean, host: string, version: string | null }} serverInfo
 */
/**
 * Bootstraps common dependencies (client, model, session, memory, agent, dispatcher).
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ running: boolean, host: string, version: string | null }} serverInfo
 * @returns {Promise<{ client, modelManager, models, currentModel, session, memory, agent, dispatcher }>}
 */
async function bootstrap(config, serverInfo) {
  const client = new OllamaClient(serverInfo.host);
  const modelManager = new ModelManager(client);

  // Fetch and select model
  const models = await modelManager.getInstalledModels();
  if (models.length === 0) {
    console.log(chalk.red('\n❌  No Ollama models found. Run: ollama pull <model>\n'));
    process.exit(1);
  }

  let currentModel = config.get('defaultModel')
    ? models.find((m) => m.name === config.get('defaultModel')) ?? models[0]
    : await modelManager.selectModelInteractively(models);

  if (!currentModel) {
    currentModel = models[0];
  }

  // Bootstrap core systems
  const session = new SessionManager(config);
  await session.init();

  const memory = new MemoryManager(config, currentModel);
  const agent = new Agent({ client, memory, session, config, currentModel });
  const dispatcher = new CommandDispatcher({ agent, session, memory, config, client, modelManager });

  return { client, modelManager, models, currentModel, session, memory, agent, dispatcher };
}

/**
 * Auto-scans the current working directory and sets it as the active project.
 * @param {SessionManager} session
 */
async function autoScanProject(session) {
  const projectPath = process.cwd();
  const spinner = startSpinner('Scanning project directory...');

  try {
    const scanner = new ProjectScanner();
    const info = await scanner.scan(projectPath);
    stopSpinner('succeed', 'Project scanned');

    session.setProject(projectPath, info);

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
    logger.warn('Auto-scan failed, continuing without project context:', err.message);
    printInfo('Could not auto-scan project. Use /project <path> to set manually.');
  }
}

/**
 * Starts the interactive DevLama CLI session.
 * Automatically scans the current directory on startup.
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ running: boolean, host: string, version: string | null }} serverInfo
 */
export async function startInteractiveSession(config, serverInfo) {
  const deps = await bootstrap(config, serverInfo);
  const currentModel = deps.currentModel;

  // Auto-scan the current working directory
  await autoScanProject(deps.session);

  enterREPL(config, deps, currentModel);
}

/**
 * Starts a session, auto-scans the project, runs a single prompt, then enters the REPL.
 * This powers the `devlama run "prompt"` and `devlama "prompt"` experience.
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ running: boolean, host: string, version: string | null }} serverInfo
 * @param {string} userPrompt
 */
export async function startWithPrompt(config, serverInfo, userPrompt) {
  const deps = await bootstrap(config, serverInfo);
  const currentModel = deps.currentModel;

  // Auto-scan the current working directory
  await autoScanProject(deps.session);

  // Run the user's prompt immediately
  console.log(chalk.gray(`\n▶ Running: ${userPrompt}\n`));
  await runAgentTurn(userPrompt, deps.agent, config);

  // Drop into the interactive REPL for follow-ups
  printInfo('Task complete. You can continue chatting or type /exit to quit.\n');
  enterREPL(config, deps, currentModel);
}

/**
 * Enters the interactive REPL loop.
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ agent, session, memory, dispatcher, models, modelManager }} deps
 * @param {object} currentModel
 */
function enterREPL(config, deps, currentModel) {
  const { agent, session, memory, dispatcher, models } = deps;

  // Setup readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: config.get('historySize') ?? 100,
  });

  // Store history in memory for cross-session persistence
  const savedHistory = session.getHistory();
  if (savedHistory.length > 0 && rl.history) {
    rl.history.push(...savedHistory.slice().reverse());
  }

  const prompt = () => rl.question(getPromptString(currentModel.name, session.projectName), handleInput);

  async function handleInput(input) {
    const trimmed = input.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    // Save to readline history
    session.addToHistory(trimmed);

    try {
      if (trimmed.startsWith('/')) {
        // ── Slash command ──
        const result = await dispatcher.dispatch(trimmed, { currentModel, models });

        if (result?.type === 'model_change') {
          currentModel = result.model;
          memory.updateModel(currentModel);
          agent.updateModel(currentModel);
          console.log(chalk.green(`\n✓ Switched to model: ${currentModel.name}\n`));
        }

        if (result?.type === 'exit') {
          await shutdown(session, rl);
          return;
        }
      } else {
        // ── Chat / agent mode ──
        await runAgentTurn(trimmed, agent, config);
      }
    } catch (err) {
      printError(err.message);
      logger.error('Error handling input', err);
    }

    prompt();
  }

  // Handle Ctrl+C
  rl.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nInterrupted. Type /exit to quit.\n'));
    prompt();
  });

  rl.on('close', async () => {
    await shutdown(session, rl);
  });

  // Show a simple, welcoming message instead of the full help dump
  console.log(
    chalk.bold.cyan('\n  Ready! ') +
    chalk.white('Just type what you need. ') +
    chalk.gray('(type /help for commands, /exit to quit)\n')
  );
  prompt();
}

/**
 * Runs a single agent turn — streams the response token by token.
 * @param {string} userInput
 * @param {Agent} agent
 * @param {import('../utils/config.js').ConfigManager} config
 */
async function runAgentTurn(userInput, agent, config) {
  console.log(); // spacing

  const streamingEnabled = config.get('streamingEnabled') ?? true;

  if (streamingEnabled) {
    process.stdout.write(chalk.bold.cyan('Assistant: '));
    await agent.runStreaming(userInput, (token) => printToken(token));
    endStream();
  } else {
    const response = await agent.run(userInput);
    console.log(chalk.bold.cyan('Assistant: ') + chalk.white(response));
  }

  console.log();
}

/**
 * Graceful shutdown — saves session and exits.
 * @param {SessionManager} session
 * @param {readline.Interface} rl
 */
async function shutdown(session, rl) {
  console.log(chalk.cyan('\n\n👋 Saving session... Goodbye!\n'));
  try {
    await session.save();
  } catch (err) {
    logger.warn('Could not save session', err.message);
  }
  rl.close();
  process.exit(0);
}
