# Contributing to DevLama CLI

We welcome contributions! Please follow these steps:

1. **Fork the repository** and clone it locally.
2. **Install dependencies**: `npm install`
3. **Run tests**: `npm test`
4. **Create a branch**: `git checkout -b feature/your-feature-name`
5. **Commit your changes**: We use conventional commits. Try running `oai /commit` to have the agent generate one for you!
6. **Push to your fork** and submit a Pull Request.

## Architecture Overview

- `src/cli`: The terminal user interface, readline loop, and slash commands.
- `src/core`: The ReAct agent loop, session management, and sliding window memory.
- `src/ollama`: HTTP client for the Ollama REST API.
- `src/tools`: File system, Git, and terminal execution tools.
- `src/prompts`: System prompts and templates.

## Testing

We use Jest. Run tests via `npm test` or `npm run test:watch`.
