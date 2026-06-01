/**
 * ui.js — Terminal UI helpers: banner, spinners, colors, diff display, status.
 */

import chalk from 'chalk';
import ora from 'ora';
import { formatDiff } from '../utils/helpers.js';

// ─── Banner ───────────────────────────────────────────────────────────────────

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██████╗ ██╗      █████╗  █████╗')}                  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██╔═══██╗██║     ██╔══██╗██╔══██╗')}                 ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║   ██║██║     ███████║███████║')}                 ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║   ██║██║     ██╔══██║██╔══██║')}                 ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('╚██████╔╝███████╗██║  ██║██║  ██║')} ${chalk.cyan('AGENT CLI')}       ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝')}                ${chalk.cyan('║')}
${chalk.cyan('║')}                                                    ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('Local AI Coding Agent  •  Powered by Ollama')}      ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════╝')}
`;

/**
 * Prints the startup banner to stdout.
 */
export function printBanner() {
  console.log(BANNER);
}

/**
 * Prints a compact status line showing model and project.
 * @param {string} model
 * @param {string | null} project
 */
export function printStatusLine(model, project) {
  const modelStr = chalk.green(`⚡ ${model}`);
  const projectStr = project ? chalk.yellow(`📁 ${project}`) : chalk.gray('📁 no project');
  console.log(`  ${modelStr}  ${projectStr}\n`);
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

let _activeSpinner = null;

/**
 * Starts an ora spinner with the given message.
 * @param {string} text
 * @returns {import('ora').Ora}
 */
export function startSpinner(text) {
  stopSpinner(); // ensure no orphan spinner
  _activeSpinner = ora({
    text: chalk.cyan(text),
    color: 'cyan',
    spinner: 'dots',
  }).start();
  return _activeSpinner;
}

/**
 * Stops the active spinner with an optional success/fail message.
 * @param {'succeed' | 'fail' | 'stop'} [type]
 * @param {string} [message]
 */
export function stopSpinner(type = 'stop', message = '') {
  if (!_activeSpinner) {
    return;
  }
  if (type === 'succeed') {
    _activeSpinner.succeed(chalk.green(message || 'Done'));
  } else if (type === 'fail') {
    _activeSpinner.fail(chalk.red(message || 'Failed'));
  } else {
    _activeSpinner.stop();
  }
  _activeSpinner = null;
}

/**
 * Updates the spinner text without stopping it.
 * @param {string} text
 */
export function updateSpinner(text) {
  if (_activeSpinner) {
    _activeSpinner.text = chalk.cyan(text);
  }
}

// ─── Output Helpers ───────────────────────────────────────────────────────────

export function printSuccess(message) {
  console.log(chalk.green(`✅  ${message}`));
}

export function printError(message) {
  console.error(chalk.red(`❌  ${message}`));
}

export function printWarning(message) {
  console.warn(chalk.yellow(`⚠️   ${message}`));
}

export function printInfo(message) {
  console.log(chalk.cyan(`ℹ️   ${message}`));
}

export function printStep(step, message) {
  console.log(chalk.bold.blue(`\n[${step}]`) + chalk.white(` ${message}`));
}

export function printDivider() {
  console.log(chalk.gray('─'.repeat(60)));
}

export function printNewLine() {
  console.log();
}

// ─── Streaming Token Printer ──────────────────────────────────────────────────

/**
 * Writes a streaming token directly to stdout without newline.
 * @param {string} token
 */
export function printToken(token) {
  process.stdout.write(chalk.white(token));
}

/**
 * Finalizes streaming output with a newline.
 */
export function endStream() {
  process.stdout.write('\n');
}

// ─── Diff Display ─────────────────────────────────────────────────────────────

/**
 * Displays a formatted diff to the console.
 * @param {string} diff
 * @param {string} filename
 */
export function printDiff(diff, filename = '') {
  console.log();
  if (filename) {
    console.log(chalk.bold.cyan(`📄 Changes to: ${filename}`));
  }
  printDivider();
  console.log(formatDiff(diff));
  printDivider();
  console.log();
}

// ─── Box Display ─────────────────────────────────────────────────────────────

/**
 * Displays text in a colored box.
 * @param {string} title
 * @param {string[]} lines
 * @param {chalk.Chalk} [color]
 */
export function printBox(title, lines, color = chalk.cyan) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4;
  const border = color('─'.repeat(width));
  console.log(color(`╭─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 2))}╮`));
  for (const line of lines) {
    console.log(color('│') + ` ${line.padEnd(width - 2)} ` + color('│'));
  }
  console.log(color(`╰${border}╯`));
}

// ─── Help Display ─────────────────────────────────────────────────────────────

export function printHelp() {
  console.log(chalk.bold.cyan('\n📖 OllamaAgent CLI — Available Commands\n'));

  const commands = [
    ['/help', 'Show this help message'],
    ['/exit, /quit', 'Exit the session'],
    ['/model', 'Switch to a different model'],
    ['/models', 'List all installed models'],
    ['/project [path]', 'Scan and set the current project'],
    ['/read <file>', 'Read and analyze a file'],
    ['/edit', 'Edit files in the current project'],
    ['/fix <error>', 'Debug and fix an error'],
    ['/architect', 'Generate project architecture plan'],
    ['/git <cmd>', 'Git operations (status, commit, push)'],
    ['/commit', 'Generate AI commit message and commit'],
    ['/memory', 'Show session memory and context usage'],
    ['/clear', 'Clear the screen'],
    ['/plugin list', 'List installed plugins'],
    ['/plugin install <name>', 'Install a plugin'],
    ['/config', 'View or set configuration'],
  ];

  for (const [cmd, desc] of commands) {
    console.log(
      `  ${chalk.green(cmd.padEnd(28))} ${chalk.gray(desc)}`
    );
  }
  console.log();
}

// ─── Prompt Prefix ───────────────────────────────────────────────────────────

/**
 * Returns the styled REPL input prompt string.
 * @param {string} model
 * @param {string | null} project
 * @returns {string}
 */
export function getPromptString(model, project) {
  const m = chalk.cyan(model.split(':')[0]);
  const p = project ? chalk.yellow(` (${project})`) : '';
  return `${m}${p} ${chalk.bold.white('❯')} `;
}
