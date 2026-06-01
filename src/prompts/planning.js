/**
 * planning.js — Prompts for high-level architecture and task breakdown.
 */

export function generatePlanningPrompt(task, projectInfo) {
  let prompt = `You are a Principal Software Engineer. The user has provided a complex task to implement.
Your job is to break this task down into a logical, step-by-step implementation plan.

TASK:
${task}
`;

  if (projectInfo) {
    prompt += `
CURRENT PROJECT CONTEXT:
Framework: ${projectInfo.framework || 'Unknown'}
Language: ${projectInfo.language || 'Unknown'}
Dependencies: ${projectInfo.dependencies?.join(', ') || 'None'}
`;
  }

  prompt += `
OUTPUT FORMAT:
Output ONLY a numbered markdown list of concrete steps. 
Do not include any pleasantries, preamble, or code blocks.
Example:
1. Create a new file src/components/Button.jsx
2. Implement the Button component logic
3. Add CSS styles in src/styles/Button.css
4. Import and use the Button in src/App.jsx

PLAN:`;

  return prompt;
}
