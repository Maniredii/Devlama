import { BasePlugin } from '../../src/plugins/basePlugin.js';

export default class ReactPlugin extends BasePlugin {
  get name() {
    return 'react';
  }

  get description() {
    return 'React specific knowledge and project defaults.';
  }

  getSystemPromptExtensions() {
    return `When writing React code:
- Use functional components and hooks.
- Avoid class components unless strictly necessary.
- Prefer Tailwind CSS or CSS modules for styling if requested.
- Ensure all components are exported properly.`;
  }
}
