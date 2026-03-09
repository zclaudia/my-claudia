import type { WorkflowTemplate } from '@my-claudia/shared';

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'local-pr-review-merge',
    name: 'Local PR: Review & Merge',
    description: 'Auto-commit changes, AI-review, and merge if approved. On merge conflict, start AI resolution session.',
    category: 'git',
    definition: {
      version: 2,
      entryNodeId: 'commit',
      triggers: [
        { type: 'event', event: 'run.completed' },
      ],
      nodes: [
        {
          id: 'commit',
          name: 'Auto Commit',
          type: 'git_commit',
          config: {},
          position: { x: 300, y: 0 },
          onError: 'abort',
        },
        {
          id: 'review',
          name: 'AI Code Review',
          type: 'ai_review',
          config: {},
          position: { x: 300, y: 150 },
          timeoutMs: 1800000,
          onError: 'abort',
        },
        {
          id: 'check_review',
          name: 'Check Review Result',
          type: 'condition',
          config: {},
          position: { x: 300, y: 300 },
          condition: {
            expression: '${review.output.reviewPassed} == true',
          },
        },
        {
          id: 'merge',
          name: 'Merge to Base Branch',
          type: 'git_merge',
          config: { baseBranch: 'main' },
          position: { x: 150, y: 450 },
          onError: 'route',
        },
        {
          id: 'notify_failed',
          name: 'Notify Review Failed',
          type: 'notify',
          config: {
            type: 'system',
            message: 'Review failed. Notes: ${review.output.reviewNotes}',
          },
          position: { x: 450, y: 450 },
        },
        {
          id: 'resolve_conflict',
          name: 'AI Conflict Resolution',
          type: 'ai_prompt',
          config: {
            prompt: 'There is a merge conflict. Run "git status" to see conflicted files. Resolve all conflicts, stage changes, and complete the merge.',
            sessionName: 'Conflict Resolution',
          },
          position: { x: 0, y: 600 },
        },
      ],
      edges: [
        { id: 'e1', source: 'commit', target: 'review', type: 'success' },
        { id: 'e2', source: 'review', target: 'check_review', type: 'success' },
        { id: 'e3', source: 'check_review', target: 'merge', type: 'condition_true' },
        { id: 'e4', source: 'check_review', target: 'notify_failed', type: 'condition_false' },
        { id: 'e5', source: 'merge', target: 'resolve_conflict', type: 'error' },
      ],
    },
  },
  {
    id: 'daily-ai-review',
    name: 'Daily AI Code Review',
    description: 'AI reviews recent git changes every morning',
    category: 'ai',
    definition: {
      version: 2,
      entryNodeId: 'review',
      triggers: [{ type: 'cron', cron: '0 9 * * *' }],
      nodes: [
        {
          id: 'review',
          name: 'AI Review',
          type: 'ai_prompt',
          config: {
            prompt: 'Review the recent git changes. Run "git log --oneline --since=\'24 hours ago\'" and "git diff HEAD~5" (or fewer if less than 5 commits exist). Provide a summary and any potential issues.',
            sessionName: 'Daily AI Review',
          },
          position: { x: 300, y: 0 },
        },
      ],
      edges: [],
    },
  },
  {
    id: 'auto-git-commit',
    name: 'Auto Git Commit',
    description: 'Periodically commits uncommitted changes with AI-generated messages',
    category: 'git',
    definition: {
      version: 2,
      entryNodeId: 'commit',
      triggers: [{ type: 'interval', intervalMinutes: 30 }],
      nodes: [
        {
          id: 'commit',
          name: 'Auto Commit',
          type: 'ai_prompt',
          config: {
            prompt: 'Check if there are uncommitted changes using "git status". If there are changes, review with "git diff", stage all, write a conventional commit message, and commit. If no changes, respond "No uncommitted changes found."',
            sessionName: 'Auto Commit',
          },
          position: { x: 300, y: 0 },
        },
      ],
      edges: [],
    },
  },
  {
    id: 'code-quality-check',
    name: 'Code Quality Check',
    description: 'Run linting and type checking with AI analysis',
    category: 'ci',
    definition: {
      version: 2,
      entryNodeId: 'lint',
      triggers: [{ type: 'cron', cron: '0 12 * * 1-5' }],
      nodes: [
        {
          id: 'lint',
          name: 'Run Lint & Typecheck',
          type: 'shell',
          config: { command: 'npm run lint 2>&1 || true; npx tsc --noEmit 2>&1 || true', timeoutMs: 120000 },
          position: { x: 300, y: 0 },
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
          position: { x: 300, y: 150 },
        },
      ],
      edges: [
        { id: 'e1', source: 'lint', target: 'analyze', type: 'success' },
      ],
    },
  },
];
