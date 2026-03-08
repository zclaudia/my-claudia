import type { ScheduledTaskTemplate } from '@my-claudia/shared';

export const BUILTIN_TEMPLATES: ScheduledTaskTemplate[] = [
  {
    id: 'daily-ai-review',
    name: 'Daily AI Review',
    description: 'AI reviews recent git changes every morning at 9am and provides a summary',
    category: 'ai',
    scheduleType: 'cron',
    defaultSchedule: { cron: '0 9 * * *' },
    actionType: 'prompt',
    defaultActionConfig: {
      prompt: `Review the recent git changes in this repository. Run "git log --oneline --since='24 hours ago'" and "git diff HEAD~5" (or fewer commits if less than 5 exist). Provide:
1. A summary of what changed
2. Any potential issues or bugs you notice
3. Suggestions for improvement
Keep the review concise and actionable.`,
      sessionName: 'Daily AI Review',
    },
  },
  {
    id: 'auto-git-commit',
    name: 'Auto Git Commit',
    description: 'Periodically commits uncommitted changes with an AI-generated message',
    category: 'git',
    scheduleType: 'interval',
    defaultSchedule: { intervalMinutes: 30 },
    actionType: 'prompt',
    defaultActionConfig: {
      prompt: `Check if there are uncommitted changes in the working directory using "git status". If there are changes:
1. Review what changed with "git diff"
2. Stage all changes: git add -A
3. Write a clear, conventional commit message based on the actual changes
4. Commit the changes

If there are no changes, just respond "No uncommitted changes found."`,
      sessionName: 'Auto Commit',
    },
  },
  {
    id: 'session-cleanup',
    name: 'Session Cleanup',
    description: 'Archive sessions older than 7 days to keep the workspace tidy',
    category: 'maintenance',
    scheduleType: 'cron',
    defaultSchedule: { cron: '0 2 * * 0' },
    actionType: 'shell',
    defaultActionConfig: {
      command: 'echo "Session cleanup triggered at $(date)"',
      timeoutMs: 30000,
    },
  },
  {
    id: 'code-quality-check',
    name: 'Code Quality Check',
    description: 'Run linting and type checking, report issues to AI for analysis',
    category: 'quality',
    scheduleType: 'cron',
    defaultSchedule: { cron: '0 12 * * 1-5' },
    actionType: 'prompt',
    defaultActionConfig: {
      prompt: `Run the project's linting and type checking tools. Try these in order:
1. If package.json exists: check for a "lint" script and run it
2. If tsconfig.json exists: npx tsc --noEmit
3. Report any errors or warnings found
4. Suggest fixes for the most critical issues`,
      sessionName: 'Code Quality Check',
    },
  },
];
