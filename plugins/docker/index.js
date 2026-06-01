import { BasePlugin } from '../../src/plugins/basePlugin.js';

export default class DockerPlugin extends BasePlugin {
  get name() {
    return 'docker';
  }

  get description() {
    return 'Docker specific knowledge and commands.';
  }

  getSystemPromptExtensions() {
    return `When writing Dockerfiles:
- Use multi-stage builds to keep final images small.
- Use official base images (e.g., node:18-alpine).
- Ensure the container runs as a non-root user when possible.
- Group RUN commands to reduce layers.`;
  }
}
