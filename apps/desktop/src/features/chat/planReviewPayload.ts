import type { PlanTodoItem } from '@my-claudia/shared';
import { normalizeToolInput } from './tool-call/toolFormatters';

export function normalizePlanTodoStatus(raw: unknown): PlanTodoItem['status'] {
  if (typeof raw !== 'string') return 'pending';
  const s = raw.toUpperCase().replace(/^TODO_STATUS_/, '');
  switch (s) {
    case 'COMPLETED': return 'completed';
    case 'IN_PROGRESS': return 'in_progress';
    case 'CANCELLED':
    case 'CANCELED': return 'cancelled';
    case 'PENDING':
    default: return 'pending';
  }
}

export function normalizePlanTodoItem(raw: unknown): PlanTodoItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const content = typeof r.content === 'string' ? r.content : '';
  if (!content.trim()) return [];
  return [{ content, status: normalizePlanTodoStatus(r.status) }];
}

export function extractPlanPayload(toolInput: unknown): {
  planContent: string;
  todos?: PlanTodoItem[];
} {
  const parsed = normalizeToolInput(toolInput);
  const input = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : undefined;

  let planContent = '';
  if (typeof input?.plan === 'string') {
    planContent = input.plan;
  } else if (input?.plan && typeof input.plan === 'object') {
    planContent = JSON.stringify(input.plan, null, 2);
  } else if (typeof input?.plan_file === 'string') {
    planContent = `# Plan\n\nPlan file: ${input.plan_file}\n\nThe plan content will be displayed after approval.`;
  } else if (input && Object.keys(input).length > 0) {
    planContent = `# Plan Details\n\n${JSON.stringify(input, null, 2)}`;
  } else {
    planContent = '# Plan\n\nPlan ready for review.';
  }

  const todosRaw = Array.isArray(input?.todos) ? input.todos : undefined;
  const todos = todosRaw ? todosRaw.flatMap(normalizePlanTodoItem) : undefined;

  return { planContent, todos: todos && todos.length > 0 ? todos : undefined };
}
