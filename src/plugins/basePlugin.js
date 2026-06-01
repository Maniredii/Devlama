/**
 * basePlugin.js — Abstract base class for DevLama plugins.
 */

export class BasePlugin {
  constructor() {
    if (this.constructor === BasePlugin) {
      throw new Error('BasePlugin is abstract and cannot be instantiated directly.');
    }
  }

  /**
   * The name of the plugin.
   * @returns {string}
   */
  get name() {
    return 'unnamed-plugin';
  }

  /**
   * A short description of what the plugin does.
   * @returns {string}
   */
  get description() {
    return 'No description provided.';
  }

  /**
   * Called when the plugin is loaded.
   * @param {{ agent, session, config }} context
   */
  async initialize(context) {
    // Override in subclass if needed
  }

  /**
   * Returns an array of custom tool definitions.
   * Format: { name: string, description: string, args: object, execute: (args) => Promise<string> }
   * @returns {Array<object>}
   */
  getTools() {
    return [];
  }

  /**
   * Returns additional system prompt text to inject when this plugin is active.
   * @returns {string}
   */
  getSystemPromptExtensions() {
    return '';
  }
}
