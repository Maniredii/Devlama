#!/usr/bin/env node
/**
 * OllamaAgent CLI — Entry Point
 * Bootstraps the CLI application and hands off to the commander program.
 */

import { program } from '../src/cli/commands.js';
import { Logger } from '../src/utils/logger.js';
import { OllamaDetector } from '../src/ollama/detector.js';
import { startInteractiveSession } from '../src/cli/prompt.js';
import { printBanner } from '../src/cli/ui.js';
import { ConfigManager } from '../src/utils/config.js';

const logger = new Logger('bootstrap');

async function main() {
  try {
    // Print the startup banner
    printBanner();

    // Ensure config directory exists
    const config = new ConfigManager();
    await config.init();

    // Parse arguments — commander handles --help, --version etc.
    program.parse(process.argv);

    // If no sub-command was given, start the interactive REPL
    if (process.argv.length <= 2) {
      await launchREPL(config);
    }
  } catch (err) {
    logger.error('Fatal error during startup', err);
    process.exit(1);
  }
}

async function launchREPL(config) {
  const detector = new OllamaDetector();
  const serverInfo = await detector.detect();

  if (!serverInfo.running) {
    console.error('\n❌  Ollama server not found. Please run: ollama serve\n');
    process.exit(1);
  }

  await startInteractiveSession(config, serverInfo);
}

main();
