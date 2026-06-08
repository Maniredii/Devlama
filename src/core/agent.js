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
import { SemanticCache } from './semanticCache.js';
import { startSpinner, stopSpinner } from '../cli/ui.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

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

    // Initialize semantic cache
    this.cache = new SemanticCache(this.client, {
      enabled: this.config.get('cacheEnabled') ?? true,
      similarityThreshold: this.config.get('cacheSimilarityThreshold') ?? 0.92,
      ttlMinutes: this.config.get('cacheTTLMinutes') ?? 30,
      maxSize: this.config.get('cacheMaxSize') ?? 100,
    });

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

  _getCommonOptions(customContextSize = null) {
    const contextSize = customContextSize ?? (this.currentModel.isSmall ? 2048 : (this.config.get('contextWindowTokens') ?? 4096));
    return {
      numGpu: this.config.get('numGpu'),
      numThread: this.config.get('numThread'),
      keepAlive: this.config.get('keepAlive'),
      contextSize,
    };
  }

  async resolveMentions(userInput) {
    const projectPath = this.session?.projectPath ?? process.cwd();
    const fileTree = this.session?.projectInfo?.fileTree;

    const fileRegex = /@([a-zA-Z0-9_\-\.\/\\:]+)/g;
    const folderRegex = /#([a-zA-Z0-9_\-\.\/\\:]+)/g;

    const fileMentions = [...new Set([...userInput.matchAll(fileRegex)].map(m => m[1]))];
    const folderMentions = [...new Set([...userInput.matchAll(folderRegex)].map(m => m[1]))];

    let resolvedText = userInput;
    let attachmentsText = '';

    for (const rawPath of fileMentions) {
      const resolvedPath = await this._resolvePath(rawPath, projectPath, fileTree, false);
      if (resolvedPath) {
        try {
          const content = await fs.promises.readFile(resolvedPath, 'utf-8');
          const linesCount = content.split('\n').length;
          const rel = path.relative(projectPath, resolvedPath).replace(/\\/g, '/');
          console.log(chalk.gray(`  📎 Attached file: ${rel} (${linesCount} lines)`));
          attachmentsText += `\n\n[ATTACHED FILE: ${rel}]\n\`\`\`\n${content}\n\`\`\``;
        } catch (err) {
          console.log(chalk.red(`  ⚠️  Failed to read file @${rawPath}: ${err.message}`));
        }
      } else {
        console.log(chalk.yellow(`  ⚠️  Could not find file: @${rawPath}`));
      }
    }

    for (const rawPath of folderMentions) {
      const resolvedPath = await this._resolvePath(rawPath, projectPath, fileTree, true);
      if (resolvedPath) {
        try {
          const rel = path.relative(projectPath, resolvedPath).replace(/\\/g, '/');
          const items = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
          const IGNORE_DIRS = new Set([
            'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next',
            '__pycache__', '.venv', 'venv', 'env', '.env', 'target',
            'vendor', 'coverage', '.nyc_output', '.cache', 'tmp', 'temp'
          ]);
          const listed = items
            .filter(item => !IGNORE_DIRS.has(item.name) && !item.name.startsWith('.'))
            .map(item => `  - ${item.name}${item.isDirectory() ? '/' : ''}`)
            .join('\n');

          console.log(chalk.gray(`  📁 Attached folder: ${rel}/ (${items.length} items)`));
          attachmentsText += `\n\n[ATTACHED FOLDER: ${rel}/]\nContents:\n${listed || '  (empty)'}`;
        } catch (err) {
          console.log(chalk.red(`  ⚠️  Failed to read folder #${rawPath}: ${err.message}`));
        }
      } else {
        console.log(chalk.yellow(`  ⚠️  Could not find folder: #${rawPath}`));
      }
    }

    if (attachmentsText) {
      resolvedText += attachmentsText;
    }

    return resolvedText;
  }

  async _resolvePath(rawPath, projectPath, fileTree, isDirTarget) {
    // 1. Direct match relative or absolute
    if (fs.existsSync(rawPath)) {
      const stat = fs.statSync(rawPath);
      if (isDirTarget === stat.isDirectory()) return rawPath;
    }
    const relativeToProj = path.join(projectPath, rawPath);
    if (fs.existsSync(relativeToProj)) {
      const stat = fs.statSync(relativeToProj);
      if (isDirTarget === stat.isDirectory()) return relativeToProj;
    }

    // 2. Search in scanned fileTree
    if (fileTree && Array.isArray(fileTree)) {
      const matched = fileTree.find(f => {
        const pathMatches = f.path === rawPath || f.name === rawPath || f.path.endsWith('/' + rawPath) || f.path.endsWith('\\' + rawPath);
        return pathMatches && (isDirTarget === f.isDir);
      });
      if (matched) {
        return path.join(projectPath, matched.path);
      }
    }

    // 3. Fallback: recursive search
    const targetName = path.basename(rawPath);
    return await this._findInDir(projectPath, targetName, isDirTarget);
  }

  async _findInDir(currentDir, targetName, isDirTarget) {
    const IGNORE_DIRS = new Set([
      'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next',
      '__pycache__', '.venv', 'venv', 'env', '.env', 'target',
      'vendor', 'coverage', '.nyc_output', '.cache', 'tmp', 'temp'
    ]);

    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.name.toLowerCase() === targetName.toLowerCase()) {
        const isDir = entry.isDirectory();
        if (isDirTarget === isDir) {
          return fullPath;
        }
      }
      if (entry.isDirectory()) {
        const found = await this._findInDir(fullPath, targetName, isDirTarget);
        if (found) return found;
      }
    }
    return null;
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
    const response = await this.client.chat(this.currentModel.name, [{ role: 'user', content: prompt }], this._getCommonOptions(2048));
    return response.content.trim();
  }

  /**
   * Runs the agent loop synchronously (returns final answer).
   * @param {string} userInput 
   * @returns {Promise<string>}
   */
  async run(userInput) {
    const processedInput = await this.resolveMentions(userInput);
    this.memory.addMessage('user', processedInput);

    // ── Semantic cache check ──────────────────────────────────────────────
    const cacheResult = await this.cache.lookup(userInput);
    if (cacheResult.hit) {
      logger.debug(`Cache hit (similarity=${cacheResult.similarity?.toFixed(3)})`);
      this.memory.addMessage('assistant', cacheResult.response);
      return cacheResult.response;
    }

    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      const context = this.memory.getContext();
      
      // Use streaming internally for faster time-to-first-byte.
      // Ollama's streaming mode starts generating immediately,
      // whereas non-streaming waits for the full response.
      let text = '';
      try {
        text = await this.client.streamChat(
          this.currentModel.name,
          context,
          () => {},  // Silently accumulate (no token output)
          () => {},   // No-op onDone
          this._getCommonOptions()
        );
      } catch {
        // Fallback to non-streaming if streamChat fails
        const response = await this.client.chat(this.currentModel.name, context, this._getCommonOptions());
        text = response.content;
      }

      this.memory.addMessage('assistant', text);

      if (hasFinalAnswer(text)) {
        const answer = parseFinalAnswer(text) || text;
        // Store in cache for future similar queries
        await this.cache.store(userInput, answer);
        return answer;
      }

      if (hasToolCall(text)) {
        const toolResult = await this._executeToolFromText(text);
        this.memory.addMessage('user', `Tool Result:\n${toolResult}`);
      } else {
        // Model didn't call a tool and didn't output final answer.
        // We'll treat it as a conversational final answer.
        await this.cache.store(userInput, text);
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
    const processedInput = await this.resolveMentions(userInput);
    this.memory.addMessage('user', processedInput);

    // ── Semantic cache check ──────────────────────────────────────────────
    const cacheResult = await this.cache.lookup(userInput);
    if (cacheResult.hit) {
      logger.debug(`Stream cache hit (similarity=${cacheResult.similarity?.toFixed(3)})`);
      // Simulate streaming by emitting the cached response with a prefix
      onToken(chalk.gray('[cached] '));
      onToken(cacheResult.response);
      this.memory.addMessage('assistant', cacheResult.response);
      return;
    }

    await this.continueStreaming(onToken);

    // Cache the final response (last assistant message)
    const lastMsg = this.memory._messages[this.memory._messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      await this.cache.store(userInput, lastMsg.content);
    }
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
      },
      this._getCommonOptions()
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
