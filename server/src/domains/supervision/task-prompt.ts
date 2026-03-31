import type { SupervisionTask } from '@my-claudia/shared';

export function buildTaskPrompt(
  task: SupervisionTask,
  projectName: string,
  contextInjection: string,
): string {
  let prompt = `[SUPERVISED TASK]
Project: ${projectName}
Task: ${task.title}
Attempt: ${task.attempt}

== Project Context ==
${contextInjection || '(no project context available)'}

== Task Description ==
${task.description}
`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `\n== Acceptance Criteria ==\n`;
    for (const criterion of task.acceptanceCriteria) {
      prompt += `- ${criterion}\n`;
    }
  }

  if (task.taskSpecificContext) {
    prompt += `\n== Additional Context ==\n${task.taskSpecificContext}\n`;
  }

  if (task.attempt > 1 && task.result?.reviewNotes) {
    prompt += `\n== Previous Review Feedback ==\n${task.result.reviewNotes}\n`;
  }

  prompt += `
== Instructions ==
Complete the task described above. When finished, output your results in this exact format:

[TASK_RESULT]
- summary: <brief summary of what was done>
- files_changed: <comma-separated list of files modified>
- tests: <test results if applicable>
[/TASK_RESULT]
`;

  return prompt;
}
