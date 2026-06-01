# DevLama CLI

> Local AI Coding Agent Powered by Ollama

DevLama CLI is a powerful, terminal-based AI coding assistant that runs entirely locally using Ollama. It can read, write, edit, and manage your project files right from your command line.

## Features

- **100% Local & Private**: Powered by Ollama, your code never leaves your machine.
- **Adaptive Models**: Automatically scales prompt context. Small models (like Qwen 1.5B or Phi-3) get compressed context, while large models (Llama 3 70B) get full project awareness.
- **Project Scanner**: Auto-detects frameworks (React, Next.js, Django, Flutter) and languages.
- **File & Git Tools**: The agent can read files, write code, create backups, apply diffs, and run Git commands.
- **Streaming UI**: Beautiful, interactive terminal interface with spinners and streaming token output.
- **Plugin System**: Extend the agent's capabilities with custom tools and framework-specific knowledge.

## Installation

```bash
npm install -g devlama-cli
```

## Quick Start

Ensure you have [Ollama](https://ollama.com) installed and running, then simply run:

```bash
oai
```

Or start with a specific model:

```bash
oai --model qwen2.5:7b
```

## Documentation

- [Command Reference](./docs/COMMANDS.md)
- [Plugin System](./docs/PLUGINS.md)
- [Contributing Guidelines](./docs/CONTRIBUTING.md)

## License

MIT
