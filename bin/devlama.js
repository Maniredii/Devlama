#!/usr/bin/env node
/**
 * DevLama CLI — Entry Point
 * Bootstraps the CLI application and hands off to the commander program.
 *
 * Usage:
 *   devlama                          → starts interactive chat (auto-scans project)
 *   devlama chat                     → same as above
 *   devlama run "write banking code" → auto-scan + execute prompt + REPL
 *   devlama "write banking code"     → shorthand for `devlama run`
 *   devlama models                   → list installed models
 */

import { program } from '../src/cli/commands.js';
import { Logger } from '../src/utils/logger.js';
import { OllamaDetector } from '../src/ollama/detector.js';
import { startInteractiveSession } from '../src/cli/prompt.js';
import { startWithPrompt } from '../src/cli/prompt.js';
import { printBanner, printError } from '../src/cli/ui.js';
import { ConfigManager } from '../src/utils/config.js';

const logger = new Logger('bootstrap');

// Known sub-commands that Commander will handle
const KNOWN_COMMANDS = ['chat', 'models', 'run', 'help'];

async function main() {
  try {
    const userArgs = process.argv.slice(2);

    // If no args at all → launch interactive REPL (with auto-scan)
    if (userArgs.length === 0) {
      printBanner();
      const config = new ConfigManager();
      await config.init();
      await launchREPL(config);
      return;
    }

    // If the first arg is a known command, let Commander handle it
    const firstArg = userArgs[0];
    if (KNOWN_COMMANDS.includes(firstArg) || firstArg.startsWith('-')) {
      printBanner();
      const config = new ConfigManager();
      await config.init();
      await program.parseAsync(process.argv);
      return;
    }

    // Otherwise, treat all args as a prompt → auto-scan + run prompt + REPL
    printBanner();
    const config = new ConfigManager();
    await config.init();
    const userPrompt = userArgs.join(' ');
    await launchWithPrompt(config, userPrompt);
  } catch (err) {
    logger.error('Fatal error during startup', err);
    process.exit(1);
  }
}

async function launchREPL(config) {
  const detector = new OllamaDetector();
  const serverInfo = await detector.detect();

  if (!serverInfo.running) {
    printError('Ollama server not found. Please run: ollama serve');
    process.exit(1);
  }

  await startInteractiveSession(config, serverInfo);
}

async function launchWithPrompt(config, userPrompt) {
  const detector = new OllamaDetector();
  const serverInfo = await detector.detect();

  if (!serverInfo.running) {
    printError('Ollama server not found. Please run: ollama serve');
    process.exit(1);
  }

  await startWithPrompt(config, serverInfo, userPrompt);
}

main();
