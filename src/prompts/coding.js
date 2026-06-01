/**
 * coding.js — Prompts specifically for code generation and fixing.
 */

export function generateBugFixPrompt(error, stackTrace, relatedCode) {
  return `I have encountered a bug in my code. Please analyze the issue and provide a fix.

ERROR MESSAGE:
${error}

STACK TRACE:
${stackTrace || 'None provided.'}

RELATED CODE:
${relatedCode || 'Not provided. Please use your tools to find the relevant code if needed.'}

Please think step-by-step. First, identify the root cause of the bug. Then, explain the fix. Finally, use the write_file or run_command tools to apply the fix or test it.`;
}

export function generateCodeReviewPrompt(diff) {
  return `Please review the following code changes and provide feedback on potential bugs, security issues, performance, and code style.

DIFF:
${diff}`;
}
