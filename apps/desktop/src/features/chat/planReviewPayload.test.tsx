import { describe, it, expect } from 'vitest';
import {
  extractPlanPayload,
  normalizePlanTodoItem,
  normalizePlanTodoStatus,
} from './planReviewPayload';

describe('normalizePlanTodoStatus', () => {
  it('maps cursor TODO_STATUS_* enum to canonical form', () => {
    expect(normalizePlanTodoStatus('TODO_STATUS_PENDING')).toBe('pending');
    expect(normalizePlanTodoStatus('TODO_STATUS_IN_PROGRESS')).toBe('in_progress');
    expect(normalizePlanTodoStatus('TODO_STATUS_COMPLETED')).toBe('completed');
    expect(normalizePlanTodoStatus('TODO_STATUS_CANCELLED')).toBe('cancelled');
  });

  it('accepts lowercase short forms', () => {
    expect(normalizePlanTodoStatus('completed')).toBe('completed');
    expect(normalizePlanTodoStatus('in_progress')).toBe('in_progress');
  });

  it('treats both spellings of cancelled', () => {
    expect(normalizePlanTodoStatus('CANCELED')).toBe('cancelled');
    expect(normalizePlanTodoStatus('CANCELLED')).toBe('cancelled');
  });

  it('falls back to pending for unknown / non-string', () => {
    expect(normalizePlanTodoStatus('SOMETHING_ELSE')).toBe('pending');
    expect(normalizePlanTodoStatus(undefined)).toBe('pending');
    expect(normalizePlanTodoStatus(42)).toBe('pending');
  });
});

describe('normalizePlanTodoItem', () => {
  it('skips items without a content string', () => {
    expect(normalizePlanTodoItem({ status: 'TODO_STATUS_PENDING' })).toEqual([]);
    expect(normalizePlanTodoItem(null)).toEqual([]);
    expect(normalizePlanTodoItem('foo')).toEqual([]);
  });

  it('skips items with whitespace-only content', () => {
    expect(normalizePlanTodoItem({ content: '   ', status: 'pending' })).toEqual([]);
    expect(normalizePlanTodoItem({ content: '\n\t', status: 'pending' })).toEqual([]);
  });

  it('defaults missing status to pending', () => {
    expect(normalizePlanTodoItem({ content: 'do the thing' })).toEqual([
      { content: 'do the thing', status: 'pending' },
    ]);
  });

  it('preserves content and normalizes status', () => {
    expect(normalizePlanTodoItem({ content: 'X', status: 'TODO_STATUS_IN_PROGRESS' })).toEqual([
      { content: 'X', status: 'in_progress' },
    ]);
  });
});

describe('extractPlanPayload', () => {
  it('extracts plan from a string field', () => {
    const out = extractPlanPayload({ plan: '# Title\n\nbody' });
    expect(out.planContent).toBe('# Title\n\nbody');
    expect(out.todos).toBeUndefined();
  });

  it('extracts plan + todos and normalizes statuses', () => {
    const out = extractPlanPayload({
      plan: '# Cursor plan',
      todos: [
        { id: 'a', content: 'step one', status: 'TODO_STATUS_PENDING' },
        { id: 'b', content: 'step two', status: 'TODO_STATUS_IN_PROGRESS' },
        { id: 'c', content: '', status: 'TODO_STATUS_PENDING' },          // empty → dropped
      ],
    });
    expect(out.planContent).toBe('# Cursor plan');
    expect(out.todos).toEqual([
      { content: 'step one', status: 'pending' },
      { content: 'step two', status: 'in_progress' },
    ]);
  });

  it('JSON.stringifies a non-string plan', () => {
    const out = extractPlanPayload({ plan: { foo: 1 } });
    expect(out.planContent).toBe('{\n  "foo": 1\n}');
  });

  it('produces a fallback message when only plan_file is present', () => {
    const out = extractPlanPayload({ plan_file: '/tmp/plan.md' });
    expect(out.planContent).toContain('Plan file: /tmp/plan.md');
  });

  it('falls back to dumping unknown shape', () => {
    const out = extractPlanPayload({ unrelated: 'x' });
    expect(out.planContent).toContain('Plan Details');
    expect(out.planContent).toContain('"unrelated"');
  });

  it('produces a default message for empty input', () => {
    expect(extractPlanPayload({}).planContent).toBe('# Plan\n\nPlan ready for review.');
    expect(extractPlanPayload(undefined).planContent).toBe('# Plan\n\nPlan ready for review.');
  });

  it('returns todos undefined when the array is empty', () => {
    const out = extractPlanPayload({ plan: 'X', todos: [] });
    expect(out.todos).toBeUndefined();
  });

  it('parses stringified JSON inputs', () => {
    const out = extractPlanPayload(JSON.stringify({ plan: 'inline', todos: [{ content: 'a' }] }));
    expect(out.planContent).toBe('inline');
    expect(out.todos).toEqual([{ content: 'a', status: 'pending' }]);
  });

  it('produces a default message for non-JSON string input', () => {
    expect(extractPlanPayload('hello world').planContent).toBe('# Plan\n\nPlan ready for review.');
  });

  it('produces a default message for array input', () => {
    expect(extractPlanPayload(['a', 'b']).planContent).toBe('# Plan\n\nPlan ready for review.');
  });
});
