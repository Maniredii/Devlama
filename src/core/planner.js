/**
 * planner.js — Agent planner to break down complex tasks.
 */

import { Logger } from '../utils/logger.js';
import { generatePlanningPrompt } from '../prompts/planning.js';

const logger = new Logger('planner');

export class Planner {
  /**
   * @param {import('../ollama/client.js').OllamaClient} client 
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Generates a step-by-step plan for a complex user request.
   * @param {string} userInput 
   * @param {import('../ollama/models.js').ModelInfo} model
   * @param {import('../tools/scanner.js').ProjectInfo} projectInfo
   * @returns {Promise<string[]>}
   */
  async generatePlan(userInput, model, projectInfo) {
    logger.debug(`Generating plan for: ${userInput}`);

    const prompt = generatePlanningPrompt(userInput, projectInfo);
    
    // We use generate (raw completion) instead of chat for simpler structural output
    const response = await this.client.generate(model.name, prompt, {
      temperature: 0.1, // Low temperature for deterministic planning
    });

    return this._parsePlan(response);
  }

  /**
   * Parses the model's output into a list of steps.
   * Expects the model to output a markdown list (e.g., "1. Do X\n2. Do Y")
   * @param {string} text 
   * @returns {string[]}
   */
  _parsePlan(text) {
    const steps = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Match lines starting with a number, a dash, or an asterisk
      if (/^(\d+\.|-|\*)\s+(.+)$/.test(trimmed)) {
        const step = trimmed.replace(/^(\d+\.|-|\*)\s+/, '').trim();
        if (step) {
          steps.push(step);
        }
      }
    }

    if (steps.length === 0) {
      logger.warn('Failed to parse a structured plan, falling back to full text block.');
      return [text.trim()]; // Fallback
    }

    return steps;
  }
}
