import { describe, it, expect } from 'vitest';
import { extractPlanFromMessages } from '../SuperviseDialog';

describe('extractPlanFromMessages', () => {
  it('returns null for empty messages', () => {
    expect(extractPlanFromMessages([])).toBeNull();
  });

  it('returns null when no assistant messages exist', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Build a feature' },
    ];
    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('returns null when assistant messages have no JSON code fence', () => {
    const messages = [
      { role: 'assistant', content: 'Sure, I can help with that. Let me plan.' },
      { role: 'assistant', content: 'Here is my thinking about the project.' },
    ];
    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('returns null when JSON code fence lacks goal and subtasks', () => {
    const messages = [
      {
        role: 'assistant',
        content: '```json\n{"name": "test", "value": 42}\n```',
      },
    ];
    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('returns null when JSON is malformed', () => {
    const messages = [
      {
        role: 'assistant',
        content: '```json\n{goal: invalid json}\n```',
      },
    ];
    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('extracts a valid plan with goal and subtasks', () => {
    const plan = {
      goal: 'Build authentication',
      subtasks: [
        { description: 'Setup JWT', phase: 1 },
        { description: 'Create login endpoint', phase: 1 },
      ],
    };
    const messages = [
      { role: 'user', content: 'Plan an auth system' },
      {
        role: 'assistant',
        content: `Here is my proposed plan:\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\nDoes this look good?`,
      },
    ];

    const result = extractPlanFromMessages(messages);
    expect(result).not.toBeNull();
    expect(result!.goal).toBe('Build authentication');
    expect(result!.subtasks).toHaveLength(2);
    expect(result!.subtasks[0].description).toBe('Setup JWT');
  });

  it('extracts plan with acceptance criteria', () => {
    const plan = {
      goal: 'Build feature',
      subtasks: [{ description: 'Task 1' }],
      acceptanceCriteria: ['Tests pass', 'No regressions'],
    };
    const messages = [
      {
        role: 'assistant',
        content: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``,
      },
    ];

    const result = extractPlanFromMessages(messages);
    expect(result).not.toBeNull();
    expect(result!.acceptanceCriteria).toEqual(['Tests pass', 'No regressions']);
  });

  it('returns the latest plan when multiple assistant messages have plans', () => {
    const oldPlan = {
      goal: 'Old plan',
      subtasks: [{ description: 'Old task' }],
    };
    const newPlan = {
      goal: 'New plan',
      subtasks: [{ description: 'New task 1' }, { description: 'New task 2' }],
    };
    const messages = [
      {
        role: 'assistant',
        content: `\`\`\`json\n${JSON.stringify(oldPlan)}\n\`\`\``,
      },
      { role: 'user', content: 'Revise the plan' },
      {
        role: 'assistant',
        content: `\`\`\`json\n${JSON.stringify(newPlan)}\n\`\`\``,
      },
    ];

    const result = extractPlanFromMessages(messages);
    expect(result).not.toBeNull();
    expect(result!.goal).toBe('New plan');
    expect(result!.subtasks).toHaveLength(2);
  });

  it('ignores JSON in user messages', () => {
    const plan = {
      goal: 'User sent this',
      subtasks: [{ description: 'Task' }],
    };
    const messages = [
      {
        role: 'user',
        content: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``,
      },
    ];

    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('handles plan with empty subtasks array', () => {
    const plan = {
      goal: 'Empty subtasks',
      subtasks: [],
    };
    const messages = [
      {
        role: 'assistant',
        content: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``,
      },
    ];

    const result = extractPlanFromMessages(messages);
    expect(result).not.toBeNull();
    expect(result!.goal).toBe('Empty subtasks');
    expect(result!.subtasks).toHaveLength(0);
  });

  it('ignores non-json code fences', () => {
    const messages = [
      {
        role: 'assistant',
        content: '```typescript\nconst x = { goal: "test", subtasks: [] };\n```',
      },
    ];

    expect(extractPlanFromMessages(messages)).toBeNull();
  });

  it('handles JSON with extra fields gracefully', () => {
    const plan = {
      goal: 'Feature X',
      subtasks: [{ description: 'Step 1', phase: 1 }],
      estimatedIterations: 10,
      extraField: 'ignored',
    };
    const messages = [
      {
        role: 'assistant',
        content: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``,
      },
    ];

    const result = extractPlanFromMessages(messages);
    expect(result).not.toBeNull();
    expect(result!.goal).toBe('Feature X');
  });
});
