/**
 * Filter state for Projects and Sessions lists
 */

export interface FilterState {
  searchQuery: string;
  statusFilter: 'all' | 'running' | 'completed' | 'failed';
  activeOnly: boolean;  // Filter to show only active sessions (with running AI requests)
}
