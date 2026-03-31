import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from '../task-prompt.js';

describe('buildTaskPrompt()', () => {
  it('includes acceptance criteria and additional context', () => {
    const prompt = buildTaskPrompt({
      title: 'Implement feature',
      description: 'Ship the feature',
      attempt: 1,
      acceptanceCriteria: ['Tests pass', 'Docs updated'],
      taskSpecificContext: 'Follow repo conventions',
      result: undefined,
    } as any, 'TestProject', 'Relevant docs');

    expect(prompt).toContain('== Project Context ==');
    expect(prompt).toContain('Relevant docs');
    expect(prompt).toContain('== Acceptance Criteria ==');
    expect(prompt).toContain('- Tests pass');
    expect(prompt).toContain('- Docs updated');
    expect(prompt).toContain('== Additional Context ==');
    expect(prompt).toContain('Follow repo conventions');
  });

  it('includes review feedback only on retry attempts', () => {
    const retryPrompt = buildTaskPrompt({
      title: 'Retry task',
      description: 'Fix the issue',
      attempt: 2,
      acceptanceCriteria: [],
      taskSpecificContext: undefined,
      result: { summary: 'first pass', filesChanged: [], reviewNotes: 'Handle edge cases' },
    } as any, 'TestProject', '');

    const firstAttemptPrompt = buildTaskPrompt({
      title: 'First attempt',
      description: 'Implement it',
      attempt: 1,
      acceptanceCriteria: [],
      taskSpecificContext: undefined,
      result: { summary: 'none', filesChanged: [], reviewNotes: 'Should not appear' },
    } as any, 'TestProject', '');

    expect(retryPrompt).toContain('== Previous Review Feedback ==');
    expect(retryPrompt).toContain('Handle edge cases');
    expect(firstAttemptPrompt).not.toContain('== Previous Review Feedback ==');
  });

  it('shows fallback text when project context is empty', () => {
    const prompt = buildTaskPrompt({
      title: 'No context',
      description: 'Test fallback',
      attempt: 1,
      acceptanceCriteria: [],
      taskSpecificContext: undefined,
      result: undefined,
    } as any, 'TestProject', '');

    expect(prompt).toContain('(no project context available)');
    expect(prompt).toContain('[TASK_RESULT]');
  });
});
