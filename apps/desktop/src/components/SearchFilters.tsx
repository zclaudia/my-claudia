import { useState, useCallback } from 'react';
import type { SearchFilters as Filters, SearchScope } from '../services/api';
import type { Session } from '@my-claudia/shared';

interface SearchFiltersProps {
  filters: Filters;
  sessions?: Session[];
  onFiltersChange: (filters: Filters) => void;
  onClose?: () => void;
}

export function SearchFilters({ filters, sessions = [], onFiltersChange, onClose }: SearchFiltersProps) {
  const [localFilters, setLocalFilters] = useState<Filters>(filters);

  const handleRoleChange = useCallback((role: 'user' | 'assistant' | undefined) => {
    const newFilters = { ...localFilters, role };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const handleSessionToggle = useCallback((sessionId: string) => {
    const currentIds = localFilters.sessionIds || [];
    const newIds = currentIds.includes(sessionId)
      ? currentIds.filter(id => id !== sessionId)
      : [...currentIds, sessionId];
    const newFilters = { ...localFilters, sessionIds: newIds.length > 0 ? newIds : undefined };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const handleSortChange = useCallback((sort: 'relevance' | 'newest' | 'oldest' | 'session') => {
    const newFilters = { ...localFilters, sort };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const handleDateRangeChange = useCallback((type: 'start' | 'end', value: string) => {
    const timestamp = new Date(value).getTime();
    const newDateRange = localFilters.dateRange ? { ...localFilters.dateRange } : { start: 0, end: Date.now() };

    if (type === 'start') {
      newDateRange.start = timestamp;
    } else {
      newDateRange.end = timestamp;
    }

    const newFilters = { ...localFilters, dateRange: newDateRange };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const handleScopeChange = useCallback((scope: SearchScope) => {
    const newFilters = { ...localFilters, scope };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const clearFilters = useCallback(() => {
    const clearedFilters: Filters = { projectId: localFilters.projectId };
    setLocalFilters(clearedFilters);
    onFiltersChange(clearedFilters);
  }, [localFilters.projectId, onFiltersChange]);

  const hasActiveFilters = !!(localFilters.role || localFilters.sessionIds?.length || localFilters.dateRange || (localFilters.scope && localFilters.scope !== 'messages'));

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Advanced Filters</h3>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Clear All
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Search Scope */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Search Scope</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleScopeChange('messages')}
            className={`px-3 py-1.5 rounded text-xs ${
              (!localFilters.scope || localFilters.scope === 'messages')
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            Messages
          </button>
          <button
            onClick={() => handleScopeChange('files')}
            className={`px-3 py-1.5 rounded text-xs ${
              localFilters.scope === 'files'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            Files
          </button>
          <button
            onClick={() => handleScopeChange('tool_calls')}
            className={`px-3 py-1.5 rounded text-xs ${
              localFilters.scope === 'tool_calls'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            Tool Calls
          </button>
          <button
            onClick={() => handleScopeChange('all')}
            className={`px-3 py-1.5 rounded text-xs ${
              localFilters.scope === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Role Filter */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Message Role</label>
        <div className="flex gap-2">
          <button
            onClick={() => handleRoleChange(undefined)}
            className={`flex-1 px-3 py-1.5 rounded text-xs ${
              !localFilters.role
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            All
          </button>
          <button
            onClick={() => handleRoleChange('user')}
            className={`flex-1 px-3 py-1.5 rounded text-xs ${
              localFilters.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            User
          </button>
          <button
            onClick={() => handleRoleChange('assistant')}
            className={`flex-1 px-3 py-1.5 rounded text-xs ${
              localFilters.role === 'assistant'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            Assistant
          </button>
        </div>
      </div>

      {/* Sort Order */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Sort By</label>
        <select
          value={localFilters.sort || 'relevance'}
          onChange={(e) => handleSortChange(e.target.value as any)}
          className="w-full px-3 py-1.5 bg-secondary border border-border rounded text-xs focus:outline-none focus:border-primary"
        >
          <option value="relevance">Relevance</option>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="session">By Session</option>
        </select>
      </div>

      {/* Session Filter */}
      {sessions.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Sessions ({localFilters.sessionIds?.length || 0} selected)
          </label>
          <div className="max-h-32 overflow-y-auto space-y-1 border border-border rounded p-2">
            {sessions.map((session) => (
              <label
                key={session.id}
                className="flex items-center gap-2 px-2 py-1 hover:bg-secondary rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={localFilters.sessionIds?.includes(session.id) || false}
                  onChange={() => handleSessionToggle(session.id)}
                  className="rounded"
                />
                <span className="text-xs truncate flex-1">{session.name || 'Untitled'}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Date Range */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date Range</label>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground mb-0.5 block">From</label>
            <input
              type="date"
              value={localFilters.dateRange?.start ? new Date(localFilters.dateRange.start).toISOString().split('T')[0] : ''}
              onChange={(e) => handleDateRangeChange('start', e.target.value)}
              className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-0.5 block">To</label>
            <input
              type="date"
              value={localFilters.dateRange?.end ? new Date(localFilters.dateRange.end).toISOString().split('T')[0] : ''}
              onChange={(e) => handleDateRangeChange('end', e.target.value)}
              className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
