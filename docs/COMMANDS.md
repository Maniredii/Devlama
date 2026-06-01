# Command Reference

DevLama CLI uses slash commands (`/`) in the interactive REPL.

## Core Commands

| Command | Description |
|---|---|
| `/help` | Show the help message. |
| `/exit`, `/quit` | Save the session and exit. |
| `/clear` | Clear the terminal screen. |

## Model Management

| Command | Description |
|---|---|
| `/models` | List all installed Ollama models and their sizes. |
| `/model [name]` | Switch to a specific model. If no name is provided, opens an interactive selector. |

## Project Context

| Command | Description |
|---|---|
| `/project [path]` | Scans a directory and sets it as the active project. Defaults to current directory. |
| `/memory` | Displays current session memory stats, token budget usage, and active model. |

## AI Agent Actions

| Command | Description |
|---|---|
| `/read <file>` | Reads a file and asks the agent to analyze it. |
| `/edit <prompt>` | Asks the agent to edit files in the project based on your prompt. |
| `/fix <error>` | Passes an error message to the agent to debug and fix. |
| `/architect <prompt>` | Asks the agent to generate a high-level project architecture plan. |

## Git Integration

| Command | Description |
|---|---|
| `/git status` | Show current git status. |
| `/git diff` | Show git diff. |
| `/git log` | Show recent commits. |
| `/commit` | **Generates an AI commit message** for staged changes and commits them. |
| `/git push` | Push current branch to remote. |

## Plugins

| Command | Description |
|---|---|
| `/plugin list` | List all active plugins. |
| `/plugin install <name>` | Install a new plugin. |
| `/plugin uninstall <name>` | Remove a plugin. |
