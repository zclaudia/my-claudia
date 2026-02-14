/**
 * Helper functions for filtering sessions and projects
 */

import type { Session } from '@my-claudia/shared';
import type { FilterState } from '../types/filter';

export function filterSessions(
  sessions: Session[],
  filterState: FilterState
): Session[] {
  let filtered = sessions;

  // Search query filter
  if (filterState.searchQuery) {
    const query = filterState.searchQuery.toLowerCase();
    filtered = filtered.filter(s =>
      s.name?.toLowerCase().includes(query) ||
      s.id.toLowerCase().includes(query)
    );
  }

  // Status filter (if needed in the future)
  if (filterState.statusFilter !== 'all') {
    // Note: status field may not exist yet on sessions
    filtered = filtered.filter(s => (s as any).status === filterState.statusFilter);
  }

  // Active-only filter
  if (filterState.activeOnly) {
    filtered = filtered.filter(s => s.isActive === true);
  }

  return filtered;
}
