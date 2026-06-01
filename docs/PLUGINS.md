# Plugin System

DevLama CLI features a robust plugin system that allows you to extend the agent's capabilities with framework-specific knowledge, custom system prompts, and new tools.

## Using Plugins

Install a plugin using the CLI:
```bash
oai /plugin install flutter
```

List active plugins:
```bash
oai /plugin list
```

## Creating a Plugin

Plugins are JavaScript classes extending `BasePlugin`. 

```javascript
import { BasePlugin } from 'devlama-cli/plugins';

export default class MyCustomPlugin extends BasePlugin {
  get name() { return 'my-plugin'; }
  get description() { return 'Does something awesome.'; }

  // Inject custom rules into the agent's system prompt
  getSystemPromptExtensions() {
    return 'Always format logs as JSON.';
  }

  // Provide custom tools to the LLM
  getTools() {
    return [
      {
        name: 'custom_search',
        description: 'Search a custom database',
        args: { query: 'string' },
        execute: async (args) => {
          return `Results for ${args.query}`;
        }
      }
    ];
  }
}
```

Save your plugin in `~/.devlama/plugins/my-plugin/index.js`.
