/**
 * Markdown renderers for supervisor change artifacts.
 * Pure string-template functions — no dependencies on service state.
 */
import type {
  ChangeExecutionPlan,
  ProjectChange,
  SupervisionTask,
} from '@my-claudia/shared/features/supervision';

export function renderExecutionPlanMarkdown(
  change: ProjectChange,
  plan: ChangeExecutionPlan,
  tasks: SupervisionTask[],
): string {
  const verification = plan.verification.length > 0
    ? plan.verification.map((item) => `- ${item.label}${item.required ? ' (required)' : ''}${item.command ? ` — \`${item.command}\`` : ''}`).join('\n')
    : '- 暂无结构化验证项';
  const phases = plan.phases && plan.phases.length > 0
    ? plan.phases.map((phase) => `- ${phase.title}: ${phase.summary}`).join('\n')
    : '- 当前按单阶段执行';
  return [
    '# Execution Plan',
    '',
    '## Summary',
    '',
    change.summary,
    '',
    '## Current Change Status',
    '',
    `- Status: \`${change.status}\``,
    `- Task Count: ${tasks.length}`,
    '',
    '## Phases',
    '',
    phases,
    '',
    '## Execution Strategy',
    '',
    `- Strategy: \`${plan.automation.strategy}\``,
    `- Auto Review: ${plan.automation.autoReview ? 'yes' : 'no'}`,
    `- Auto Retry: ${plan.automation.autoRetry ? 'yes' : 'no'}`,
    `- Auto Sync Draft: ${plan.automation.autoSyncDraft ? 'yes' : 'no'}`,
    '',
    '## Verification Plan',
    '',
    verification,
    '',
    '## Risks Before Start',
    '',
    '- 待补充',
    '',
  ].join('\n');
}

export function renderTasksMarkdown(change: ProjectChange, tasks: SupervisionTask[]): string {
  if (tasks.length === 0) {
    return [
      '# Tasks',
      '',
      `> Change: ${change.title}`,
      '',
      '当前还没有生成任务。',
      '',
    ].join('\n');
  }

  const sections = tasks.map((task, index) => [
    `## T${index + 1} ${task.title}`,
    '',
    `- Status: \`${task.status}\``,
    `- Summary: ${task.description}`,
    `- Scope: ${task.scope?.join(', ') || '(none)'}`,
    `- Depends On: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : '(none)'}`,
    `- Deliverables: ${task.acceptanceCriteria.length > 0 ? task.acceptanceCriteria.join('; ') : '(none)'}`,
    `- Verification: ${task.relevantDocIds?.length ? task.relevantDocIds.join(', ') : '(not specified)'}`,
    '',
  ].join('\n'));

  return [
    '# Tasks',
    '',
    `> Change: ${change.title}`,
    '',
    ...sections,
  ].join('\n');
}

export function renderAcceptanceMarkdown(change: ProjectChange, tasks: SupervisionTask[]): string {
  const acceptedTasks = tasks.filter((task) => ['approved', 'integrated'].includes(task.status));
  const openTasks = tasks.filter((task) => !['approved', 'integrated'].includes(task.status));
  const finalDecision = (() => {
    if (change.status === 'completed') return 'Accepted, synced, and completed.';
    if (change.status === 'syncing') return 'Acceptance approved. Ready for final spec sync.';
    if (change.status === 'accepting') return 'Acceptance review in progress.';
    if (openTasks.length === 0 && tasks.length > 0) return 'Ready to request acceptance review.';
    return 'Pending further work.';
  })();
  return [
    '# Acceptance',
    '',
    '## Task-Level Checks',
    '',
    acceptedTasks.length > 0
      ? acceptedTasks.map((task) => `- ${task.title}: ${task.status}`).join('\n')
      : '- No completed task-level checks yet',
    '',
    '## Change-Level Checks',
    '',
    change.acceptanceCriteria.length > 0
      ? change.acceptanceCriteria.map((item) => `- ${item}`).join('\n')
      : '- No explicit change-level acceptance criteria',
    '',
    '## Open Issues',
    '',
    openTasks.length > 0
      ? openTasks.map((task) => `- ${task.title}: ${task.status}`).join('\n')
      : '- None',
    '',
    '## Final Decision',
    '',
    finalDecision,
    '',
  ].join('\n');
}

export function renderSyncLogMarkdown(change: ProjectChange, summary?: string): string {
  return [
    '# Sync Log',
    '',
    '## Updated Files',
    '',
    '- baseline/project.md (pending review)',
    '- baseline/architecture.md (pending review)',
    '',
    '## Summary Of Spec Changes',
    '',
    summary ?? `Sync state for ${change.title} is currently \`${change.status}\`.`,
    '',
    '## Follow-up Notes',
    '',
    change.status === 'completed'
      ? '- Change marked completed'
      : '- Awaiting sync approval',
    '',
  ].join('\n');
}
