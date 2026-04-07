/**
 * Todo Normalizer
 *
 * Pure function to normalize various TodoWrite tool input formats
 * into a consistent NormalizedTodoItem[] array.
 *
 * Ported from the frontend's ToolCallItem.tsx normalizeTodoItems()
 * to enable server-side normalization for interaction events.
 */

import type { NormalizedTodoItem } from '@my-claudia/shared/interaction/forms';

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

function coerceStatus(value: unknown): NormalizedTodoItem['status'] {
  const s = typeof value === 'string' ? value : 'pending';
  return VALID_STATUSES.has(s) ? s as NormalizedTodoItem['status'] : 'pending';
}

/**
 * Normalize various todo input formats into NormalizedTodoItem[].
 *
 * Supported formats:
 * - Array of { content, status } objects
 * - Wrapper object with `todos`, `items`, or `list` array property
 * - Single { content, status } object (wrapped into 1-element array)
 * - JSON string (parsed first, then recursed)
 *
 * Returns [] for any unrecognizable input (never throws).
 */
export function normalizeTodoItems(value: unknown): NormalizedTodoItem[] {
  if (value == null) return [];

  // Handle JSON strings
  if (typeof value === 'string') {
    try {
      return normalizeTodoItems(JSON.parse(value));
    } catch {
      return [];
    }
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const content = 'content' in item ? String(item.content ?? '') : '';
      if (!content) return [];
      return [{ content, status: coerceStatus(item.status) }];
    });
  }

  // Handle objects
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Unwrap common wrapper properties
    if (Array.isArray(record.todos)) return normalizeTodoItems(record.todos);
    if (Array.isArray(record.items)) return normalizeTodoItems(record.items);
    if (Array.isArray(record.list)) return normalizeTodoItems(record.list);
    // Single item
    if ('content' in record) {
      const content = String(record.content ?? '');
      if (!content) return [];
      return [{ content, status: coerceStatus(record.status) }];
    }
  }

  return [];
}
