import type { WorkflowTemplate } from '@my-claudia/shared';

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'local-pr-review-merge',
    name: 'Local PR: Review & Merge',
    description: 'Auto-commit changes, AI-review, and merge if approved',
    category: 'git',
    definition: {
      triggers: [
        { type: 'event', event: 'run.completed' },
      ],
      steps: [
        {
          id: 'commit',
          name: 'Auto Commit',
          type: 'git_commit',
          config: {},
          onError: 'abort',
        },
        {
          id: 'review',
          name: 'AI Code Review',
          type: 'ai_review',
          config: {},
          timeoutMs: 1800000,
          onError: 'abort',
        },
        {
          id: 'check_review',
          name: 'Check Review Result',
          type: 'condition',
          config: {},
          condition: {
            expression: '${review.output.reviewPassed} == true',
            thenSteps: ['merge'],
            elseSteps: ['notify_failed'],
          },
        },
        {
          id: 'merge',
          name: 'Merge to Base Branch',
          type: 'git_merge',
          config: { baseBranch: 'main' },
          onError: 'abort',
        },
        {
          id: 'notify_failed',
          name: 'Notify Review Failed',
          type: 'notify',
          config: {
            type: 'system',
            message: 'Review failed. Notes: ${review.output.reviewNotes}',
          },
        },
      ],
    },
  },
  {
    id: 'daily-ai-review',
    name: 'Daily AI Code Review',
    description: 'AI reviews recent git changes every morning',
    category: 'ai',
    definition: {
      triggers: [{ type: 'cron', cron: '0 9 * * *' }],
      steps: [
        {
          id: 'review',
          name: 'AI Review',
          type: 'ai_prompt',
          config: {
            prompt: 'Review the recent git changes. Run "git log --oneline --since=\'24 hours ago\'" and "git diff HEAD~5" (or fewer if less than 5 commits exist). Provide a summary and any potential issues.',
            sessionName: 'Daily AI Review',
          },
        },
      ],
    },
  },
  {
    id: 'auto-git-commit',
    name: 'Auto Git Commit',
    description: 'Periodically commits uncommitted changes with AI-generated messages',
    category: 'git',
    definition: {
      triggers: [{ type: 'interval', intervalMinutes: 30 }],
      steps: [
        {
          id: 'commit',
          name: 'Auto Commit',
          type: 'ai_prompt',
          config: {
            prompt: 'Check if there are uncommitted changes using "git status". If there are changes, review with "git diff", stage all, write a conventional commit message, and commit. If no changes, respond "No uncommitted changes found."',
            sessionName: 'Auto Commit',
          },
        },
      ],
    },
  },
  {
    id: 'code-quality-check',
    name: 'Code Quality Check',
    description: 'Run linting and type checking with AI analysis',
    category: 'ci',
    definition: {
      triggers: [{ type: 'cron', cron: '0 12 * * 1-5' }],
      steps: [
        {
          id: 'lint',
          name: 'Run Lint & Typecheck',
          type: 'shell',
          config: { command: 'npm run lint 2>&1 || true; npx tsc --noEmit 2>&1 || true', timeoutMs: 120000 },
          onError: 'skip',
        },
        {
          id: 'analyze',
          name: 'AI Analysis',
          type: 'ai_prompt',
          config: {
            prompt: 'Here are the lint/typecheck results:\n${lint.output.stdout}\n\nAnalyze the errors and suggest fixes for the most critical issues.',
            sessionName: 'Code Quality Check',
          },
        },
      ],
    },
  },
];
