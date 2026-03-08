import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager.js';

// Mock the api module
vi.mock('../../services/api', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));

// Mock the projectStore
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      setSessions: vi.fn(),
    })),
  },
}));

describe('hooks/useSessionManager', () => {
  let mockGetSessions: ReturnType<typeof vi.fn>;
  let mockCreateSession: ReturnType<typeof vi.fn>;
  let mockUpdateSession: ReturnType<typeof vi.fn>;
  let mockDeleteSession: ReturnType<typeof vi.fn>;
  let mockSetSessions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const api = await import('../../services/api.js');
    mockGetSessions = vi.mocked(api.getSessions);
    mockCreateSession = vi.mocked(api.createSession);
    mockUpdateSession = vi.mocked(api.updateSession);
    mockDeleteSession = vi.mocked(api.deleteSession);

    const { useProjectStore } = await import('../../stores/projectStore.js');
    mockSetSessions = vi.fn();
    vi.mocked(useProjectStore.getState).mockReturnValue({
      setSessions: mockSetSessions,
    } as any);
  });

  describe('return value', () => {
    it('returns all manager functions', () => {
      const { result } = renderHook(() => useSessionManager());

      // Note: refreshSessions is internal, not exported
      expect(result.current).toHaveProperty('addSession');
      expect(result.current).toHaveProperty('updateSession');
      expect(result.current).toHaveProperty('deleteSession');

      expect(typeof result.current.addSession).toBe('function');
      expect(typeof result.current.updateSession).toBe('function');
      expect(typeof result.current.deleteSession).toBe('function');
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useSessionManager());

      const firstAddSession = result.current.addSession;
      const firstUpdateSession = result.current.updateSession;
      const firstDeleteSession = result.current.deleteSession;

      rerender();

      expect(result.current.addSession).toBe(firstAddSession);
      expect(result.current.updateSession).toBe(firstUpdateSession);
      expect(result.current.deleteSession).toBe(firstDeleteSession);
    });
  });

  describe('internal refresh', () => {
    it('fetches sessions and updates store after add', async () => {
      const mockSessions = [
        { id: 'session-1', projectId: 'project-1', title: 'Session 1' },
      ];
      mockCreateSession.mockResolvedValueOnce({ id: 'new-session' });
      mockGetSessions.mockResolvedValueOnce(mockSessions);

      const { result } = renderHook(() => useSessionManager());

      await result.current.addSession({ projectId: 'project-1', title: 'Test' } as any);

      expect(mockGetSessions).toHaveBeenCalledTimes(1);
      expect(mockSetSessions).toHaveBeenCalledWith(mockSessions);
    });

    it('handles errors gracefully during refresh', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCreateSession.mockResolvedValueOnce({ id: 'new' });
      mockGetSessions.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useSessionManager());

      // The addSession should complete without throwing even if refresh fails
      await result.current.addSession({ projectId: 'project-1', title: 'Test' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SessionManager] Failed to refresh sessions:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('addSession', () => {
    it('creates session, refreshes list, and returns created session', async () => {
      const createdSession = { id: 'new-session', projectId: 'project-1', title: 'New Session' };
      mockCreateSession.mockResolvedValueOnce(createdSession);
      mockGetSessions.mockResolvedValueOnce([createdSession]);

      const { result } = renderHook(() => useSessionManager());

      const sessionData = {
        projectId: 'project-1',
        title: 'New Session',
      };

      const returned = await result.current.addSession(sessionData as any);

      expect(mockCreateSession).toHaveBeenCalledWith(sessionData);
      expect(mockGetSessions).toHaveBeenCalled();
      expect(mockSetSessions).toHaveBeenCalled();
      expect(returned).toEqual(createdSession);
    });

    it('propagates errors from createSession', async () => {
      mockCreateSession.mockRejectedValueOnce(new Error('Create failed'));

      const { result } = renderHook(() => useSessionManager());

      await expect(
        result.current.addSession({ projectId: 'test', title: 'Test' } as any)
      ).rejects.toThrow('Create failed');
    });
  });

  describe('updateSession', () => {
    it('updates session and refreshes list', async () => {
      mockUpdateSession.mockResolvedValueOnce(undefined);
      mockGetSessions.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionManager());

      const updates = { title: 'Updated Session' };

      await result.current.updateSession('session-1', updates);

      expect(mockUpdateSession).toHaveBeenCalledWith('session-1', updates);
      expect(mockGetSessions).toHaveBeenCalled();
      expect(mockSetSessions).toHaveBeenCalled();
    });

    it('propagates errors from updateSession', async () => {
      mockUpdateSession.mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useSessionManager());

      await expect(
        result.current.updateSession('session-1', { title: 'Test' })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('deleteSession', () => {
    it('deletes session and refreshes list', async () => {
      mockDeleteSession.mockResolvedValueOnce(undefined);
      mockGetSessions.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionManager());

      await result.current.deleteSession('session-1');

      expect(mockDeleteSession).toHaveBeenCalledWith('session-1');
      expect(mockGetSessions).toHaveBeenCalled();
      expect(mockSetSessions).toHaveBeenCalled();
    });

    it('propagates errors from deleteSession', async () => {
      mockDeleteSession.mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useSessionManager());

      await expect(
        result.current.deleteSession('session-1')
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('integration scenarios', () => {
    it('can perform CRUD operations in sequence', async () => {
      const createdSession = { id: 'new', projectId: 'p1', title: 'Test' };
      mockCreateSession.mockResolvedValueOnce(createdSession);
      mockUpdateSession.mockResolvedValueOnce(undefined);
      mockDeleteSession.mockResolvedValueOnce(undefined);
      mockGetSessions.mockResolvedValue([]);

      const { result } = renderHook(() => useSessionManager());

      // Add - returns the created session
      const returned = await result.current.addSession({ projectId: 'p1', title: 'Test' } as any);
      expect(mockCreateSession).toHaveBeenCalled();
      expect(returned).toEqual(createdSession);

      // Update
      await result.current.updateSession('new', { title: 'Updated' });
      expect(mockUpdateSession).toHaveBeenCalled();

      // Delete
      await result.current.deleteSession('new');
      expect(mockDeleteSession).toHaveBeenCalled();

      // Should have called refresh (getSessions) after each operation
      expect(mockGetSessions).toHaveBeenCalledTimes(3);
    });
  });
});
