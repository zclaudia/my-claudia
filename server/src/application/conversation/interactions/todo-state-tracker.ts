/**
 * Todo State Tracker
 *
 * Tracks todo interactions per session across multiple TodoWrite / update_todo_list calls.
 * When a new todo list arrives, items that disappeared from the previous list(s) are
 * automatically marked as "completed" and the updated interactions are returned so the
 * caller can re-dispatch them to the frontend.
 *
 * Used by both:
 *  - Native provider path (run-events.ts → normalizeFromToolUse)
 *  - MCP bridge path (interaction-tools.ts → update_todo_list handler)
 */

import type { NormalizedTodoItem } from '@my-claudia/shared';

interface TrackedTodo {
  interactionId: string;
  todos: NormalizedTodoItem[];
}

export interface TodoStateUpdate {
  interactionId: string;
  todos: NormalizedTodoItem[];
}

// sessionId → list of tracked todo interactions (in chronological order)
const sessionTodos = new Map<string, TrackedTodo[]>();

/**
 * Track a new todo update.
 * Compares against only the MOST RECENT previous todo list — items that
 * were in the last update but are absent from the new one are marked "completed".
 *
 * This "last-only" comparison avoids false positives with sliding-window patterns
 * (e.g. Cursor shows [A,B,C,D] → [A,B] → [B,C] → …) where items from an early
 * full list haven't actually been worked on yet.
 *
 * Returns an array of updated previous interactions (only the most recent, if changed).
 */
export function trackAndAutoComplete(
  sessionId: string,
  interactionId: string,
  todos: NormalizedTodoItem[],
): TodoStateUpdate[] {
  const previous = sessionTodos.get(sessionId) || [];
  const updates: TodoStateUpdate[] = [];

  // Only compare against the most recent tracked interaction
  if (previous.length > 0) {
    const last = previous[previous.length - 1];
    const lastContentSet = new Set(last.todos.map((t) => t.content));
    const newContentSet = new Set(todos.map((t) => t.content));

    // Only auto-complete when the new list introduces at least one item
    // not in the previous list (= window "shifted", not just "narrowed").
    // Pure narrowing (e.g. [A,B,C,D] → [A,B]) likely means the agent is
    // picking a working window, not that removed items are done.
    const hasNewItems = todos.some((t) => !lastContentSet.has(t.content));

    if (hasNewItems) {
      let changed = false;
      const updatedTodos = last.todos.map((t) => {
        if (t.status !== 'completed' && !newContentSet.has(t.content)) {
          changed = true;
          return { ...t, status: 'completed' as const };
        }
        return t;
      });
      if (changed) {
        last.todos = updatedTodos;
        updates.push({ interactionId: last.interactionId, todos: updatedTodos });
      }
    }
  }

  previous.push({ interactionId, todos: [...todos] });
  sessionTodos.set(sessionId, previous);

  return updates;
}

/**
 * Finalize all todo interactions for a session.
 * Marks every remaining pending/in_progress item as "completed".
 * Returns the updated interactions and removes the session from tracking.
 */
export function finalizeSession(sessionId: string): TodoStateUpdate[] {
  const previous = sessionTodos.get(sessionId);
  if (!previous) return [];

  const updates: TodoStateUpdate[] = [];

  for (const prev of previous) {
    let changed = false;
    const updatedTodos = prev.todos.map((t) => {
      if (t.status !== 'completed') {
        changed = true;
        return { ...t, status: 'completed' as const };
      }
      return t;
    });
    if (changed) {
      prev.todos = updatedTodos;
      updates.push({ interactionId: prev.interactionId, todos: updatedTodos });
    }
  }

  sessionTodos.delete(sessionId);
  return updates;
}

/**
 * Clear tracked state for a session without producing updates.
 * Use on error/abort to prevent memory leaks.
 */
export function clearSession(sessionId: string): void {
  sessionTodos.delete(sessionId);
}
