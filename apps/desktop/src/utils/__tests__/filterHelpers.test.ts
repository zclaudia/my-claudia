import { describe, it, expect } from 'vitest';
import { filterSessions } from '../filterHelpers.js';
import type { Session } from '@my-claudia/shared';
import type { FilterState } from '../../types/filter';

describe('utils/filterHelpers', () => {
  const mockSessions: Session[] = [
    {
      id: 'session-1',
      name: 'Project Alpha Discussion',
      projectId: 'project-1',
      isActive: true,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
    },
    {
      id: 'session-2',
      name: 'Beta Testing Session',
      projectId: 'project-2',
      isActive: false,
      createdAt: Date.now() - 2000,
      updatedAt: Date.now(),
    },
    {
      id: 'session-3',
      name: 'Gamma Review',
      projectId: 'project-1',
      isActive: true,
      createdAt: Date.now() - 3000,
      updatedAt: Date.now(),
    },
  ];

  const defaultFilter: FilterState = {
    searchQuery: '',
    statusFilter: 'all',
    activeOnly: false,
  };

  describe('filterSessions', () => {
    it('returns all sessions when no filters applied', () => {
      const result = filterSessions(mockSessions, defaultFilter);
      expect(result).toHaveLength(3);
    });

    it('filters by search query in name', () => {
      const filter: FilterState = { ...defaultFilter, searchQuery: 'Alpha' };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Project Alpha Discussion');
    });

    it('filters by search query in id', () => {
      const filter: FilterState = { ...defaultFilter, searchQuery: 'session-2' };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session-2');
    });

    it('filters by search query case-insensitively', () => {
      const filter: FilterState = { ...defaultFilter, searchQuery: 'BETA' };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Beta Testing Session');
    });

    it('filters active only', () => {
      const filter: FilterState = { ...defaultFilter, activeOnly: true };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(2);
      expect(result.every(s => s.isActive)).toBe(true);
    });

    it('combines search query with active filter', () => {
      const filter: FilterState = {
        ...defaultFilter,
        searchQuery: 'session', // matches all by id
        activeOnly: true,
      };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(2); // session-1 and session-3
    });

    it('returns empty array when no matches', () => {
      const filter: FilterState = { ...defaultFilter, searchQuery: 'nonexistent' };
      const result = filterSessions(mockSessions, filter);

      expect(result).toHaveLength(0);
    });

    it('handles empty sessions array', () => {
      const result = filterSessions([], defaultFilter);
      expect(result).toHaveLength(0);
    });

    it('handles sessions without name', () => {
      const sessionsWithoutName: Session[] = [
        {
          id: 'no-name-session',
          projectId: 'project-1',
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const filter: FilterState = { ...defaultFilter, searchQuery: 'no-name' };
      const result = filterSessions(sessionsWithoutName, filter);

      expect(result).toHaveLength(1);
    });

    it('filters by status when not "all"', () => {
      const sessionsWithStatus = [
        { ...mockSessions[0], status: 'running' },
        { ...mockSessions[1], status: 'completed' },
        { ...mockSessions[2], status: 'running' },
      ] as Session[];

      const filter: FilterState = { ...defaultFilter, statusFilter: 'running' };
      const result = filterSessions(sessionsWithStatus, filter);

      expect(result).toHaveLength(2);
    });
  });
});
