/**
 * agent.js — Core orchestrator.
 * Manages the Think -> Act -> Observe loop, tool execution, and prompt building.
 */

import { generateSystemPrompt } from '../prompts/system.js';
import { parseToolCall, parseFinalAnswer, hasToolCall, hasFinalAnswer } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';
import { FileReader } from '../tools/fileReader.js';
import { FileWriter } from '../tools/fileWriter.js';
import { Terminal } from '../tools/terminal.js';
import { startSpinner, stopSpinner } from '../cli/ui.js';
import chalk from 'chalk';

const logger = new Logger('agent');

export class Agent {
  /**
   * @param {{ client, memory, session, config, currentModel }} deps 
   */
  constructor(deps) {
    this.client = deps.client;
    this.memory = deps.memory;
    this.session = deps.session;
    this.config = deps.config;
    this.currentModel = deps.currentModel;
    this.pluginManager = deps.pluginManager;

    // Initialize tools
    this.tools = {
      read_file: new FileReader(),
      write_file: new FileWriter({ autoApprove: this.config.get('autoApprove') }),
      run_command: new Terminal({ cwd: this.session.projectPath ?? process.cwd() }),
    };

    this._initializeSystemPrompt();
  }

  updateModel(model) {
    this.currentModel = model;
    this._initializeSystemPrompt(); // Re-init as prompt adapts to model size
  }

  _initializeSystemPrompt() {
    let prompt = generateSystemPrompt(this.session.projectInfo, this.currentModel);
    
    if (this.pluginManager) {
      const extensions = this.pluginManager.getSystemPromptExtensions();
      if (extensions) {
        prompt += '\n' + extensions;
      }
    }

    // Also inject custom tool definitions into the prompt if there are any
    const customTools = Object.values(this.tools).filter(t => t.execute);
    if (customTools.length > 0) {
      prompt += '\n\nAVAILABLE CUSTOM TOOLS:\n';
      customTools.forEach(t => {
        prompt += `- ${t.name}: ${t.description}\n  Arguments: ${JSON.stringify(t.args)}\n`;
      });
    }

    this.memory.setSystemPrompt(prompt);
  }

  /**
   * Reloads system prompts and tools from the plugin manager.
   */
  reloadPlugins() {
    if (!this.pluginManager) {
      return;
    }
    
    // Register custom tools from plugins
    for (const plugin of this.pluginManager.plugins.values()) {
      if (typeof plugin.getTools === 'function') {
        const pluginTools = plugin.getTools();
        for (const t of pluginTools) {
          this.tools[t.name] = t;
        }
      }
    }
    
    this._initializeSystemPrompt();
  }

  /**
   * Manually adds a user message to the memory context.
   * @param {string} text 
   */
  async addUserMessage(text) {
    this.memory.addMessage('user', text);
  }

  /**
   * Generates a commit message using the current model.
   * Special isolated request that doesn't affect main memory.
   * @param {string} diff 
   */
  async generateCommitMessage(diff) {
    const prompt = `Generate a concise, conventional git commit message for the following diff. Only output the commit message, no explanations.\n\n${diff}`;
    const response = await this.client.chat(this.currentModel.name, [{ role: 'user', content: prompt }]);
    return response.content.trim();
  }

  /**
   * Runs the agent loop synchronously (returns final answer).
   * @param {string} userInput 
   * @returns {Promise<string>}
   */
  async run(userInput) {
    this.memory.addMessage('user', userInput);
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      const context = this.memory.getContext();
      
      const response = await this.client.chat(this.currentModel.name, context);
      const text = response.content;

      this.memory.addMessage('assistant', text);

      if (hasFinalAnswer(text)) {
        return parseFinalAnswer(text) || text; // Fallback to raw text if parsing fails slightly
      }

      if (hasToolCall(text)) {
        const toolResult = await this._executeToolFromText(text);
        this.memory.addMessage('user', `Tool Result:\n${toolResult}`);
      } else {
        // Model didn't call a tool and didn't output final answer.
        // We'll treat it as a conversational final answer.
        return text;
      }
    }

    return "Agent loop reached maximum iterations before arriving at a final answer.";
  }

  /**
   * Runs the agent loop and streams output.
   * Stops streaming when a tool is called, executes the tool, and recursively continues.
   * @param {string} userInput 
   * @param {(token: string) => void} onToken 
   */
  async runStreaming(userInput, onToken) {
    this.memory.addMessage('user', userInput);
    await this.continueStreaming(onToken);
  }

  /**
   * Continues the streaming loop from the current memory state.
   * @param {(token: string) => void} onToken 
   * @param {number} depth 
   */
  async continueStreaming(onToken, depth = 0) {
    if (depth > 10) {
      onToken('\n[Agent stopped: Max tool iteration depth reached]\n');
      return;
    }

    const context = this.memory.getContext();
    let isToolCall = false;
    let fullText = '';
    let spinnerStarted = false;

    await this.client.streamChat(
      this.currentModel.name,
      context,
      (token) => {
        fullText += token;
        
        // Naive heuristic: if we see '<tool', suppress streaming to console for the tool block
        if (fullText.includes('<tool>')) {
          isToolCall = true;
          if (!spinnerStarted) {
            spinnerStarted = true;
            process.stdout.write('\n'); // clear line
            startSpinner('Generating tool action...');
          }
        }

        // If it's a final answer tag, we don't necessarily want to stream the raw tags
        // But for a CLI, it's often fine to just stream everything. We'll strip tags visually if possible,
        // or just let them stream. For simplicity, we'll stream unless it's a tool block.
        if (!isToolCall) {
            // Very simple tag stripping for streaming:
            const stripped = token.replace(/<final_answer>/g, '').replace(/<\/final_answer>/g, '');
            if (stripped) {
              onToken(stripped);
            }
        }
      },
      () => { 
        if (spinnerStarted) {
          stopSpinner('stop');
        }
      }
    );

    this.memory.addMessage('assistant', fullText);

    if (hasToolCall(fullText)) {
      if (depth === 0) {
        onToken('\n'); // Ensure we start on a new line for tool output
      }
      
      const parsed = parseToolCall(fullText);
      if (parsed) {
        console.log(chalk.gray(`\n  [Agent executing tool: ${parsed.tool}]`));
      }

      const toolResult = await this._executeToolFromText(fullText);
      this.memory.addMessage('user', `Tool Result:\n${toolResult}`);
      
      console.log(chalk.gray(`  [Tool execution complete]\n`));
      
      // Recursive call for the next step in the loop
      await this.continueStreaming(onToken, depth + 1);
    }
  }

  // ─── Internal Tool Execution ────────────────────────────────────────────────

  async _executeToolFromText(text) {
    const call = parseToolCall(text);
    if (!call) {
      return 'Error: Malformed tool call in output.';
    }

    const { tool, args } = call;

    try {
      switch (tool) {
        case 'read_file':
          if (!args.path) {return 'Error: read_file requires a "path" argument.';}
          const content = await this.tools.read_file.readFile(args.path);
          return content;
        
        case 'write_file':
          if (!args.path || args.content === undefined) {return 'Error: write_file requires "path" and "content".';}
          const result = await this.tools.write_file.writeFile(args.path, args.content);
          return `Successfully wrote file to ${result.filePath}`;
        
        case 'run_command':
          if (!args.command) {return 'Error: run_command requires a "command" argument.';}
          const cmdRes = await this.tools.run_command.run(args.command);
          return `Exit Code: ${cmdRes.exitCode}\nStdout:\n${cmdRes.stdout}\nStderr:\n${cmdRes.stderr}`;
        
        default:
          if (this.tools[tool] && typeof this.tools[tool].execute === 'function') {
            return await this.tools[tool].execute(args);
          }
          return `Error: Unknown tool "${tool}"`;
      }
    } catch (err) {
      logger.debug(`Tool execution error (${tool}): ${err.message}`);
      return `Error executing ${tool}: ${err.message}`;
    }
  }
}
