import { BasePlugin } from '../../src/plugins/basePlugin.js';

export default class FlutterPlugin extends BasePlugin {
  get name() {
    return 'flutter';
  }

  get description() {
    return 'Flutter specific knowledge and commands.';
  }

  getSystemPromptExtensions() {
    return `When writing Flutter/Dart code:
- Use null safety.
- Prefer stateless widgets where possible.
- Keep widget build methods small and extract complex UI into separate widgets.
- Use the official lint rules.`;
  }
}
