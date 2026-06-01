/**
 * prompt.js — Interactive REPL (Read-Eval-Print Loop) for OllamaAgent CLI.
 * Handles user input, command routing, and streaming AI responses.
 */

import readline from 'readline';
import chalk from 'chalk';
import { ModelManager } from '../ollama/models.js';
import { OllamaClient } from '../ollama/client.js';
import { Agent } from '../core/agent.js';
import { SessionManager } from '../core/session.js';
import { MemoryManager } from '../core/memory.js';
import { printStatusLine, printToken, endStream, printError, printHelp, getPromptString } from './ui.js';
import { CommandDispatcher } from './commands.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('prompt');

/**
 * Starts the interactive OllamaAgent CLI session.
 * @param {import('../utils/config.js').ConfigManager} config
 * @param {{ running: boolean, host: string, version: string | null }} serverInfo
 */
export async function startInteractiveSession(config, serverInfo) {
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

  printStatusLine(currentModel.name, session.projectName);

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

  printHelp();
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
