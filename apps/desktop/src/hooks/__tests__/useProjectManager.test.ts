import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectManager } from '../useProjectManager.js';

// Mock the api module
vi.mock('../../services/api', () => ({
  getProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

// Mock the projectStore
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      setProjects: vi.fn(),
    })),
  },
}));

describe('hooks/useProjectManager', () => {
  let mockGetProjects: ReturnType<typeof vi.fn>;
  let mockCreateProject: ReturnType<typeof vi.fn>;
  let mockUpdateProject: ReturnType<typeof vi.fn>;
  let mockDeleteProject: ReturnType<typeof vi.fn>;
  let mockSetProjects: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const api = await import('../../services/api.js');
    mockGetProjects = vi.mocked(api.getProjects);
    mockCreateProject = vi.mocked(api.createProject);
    mockUpdateProject = vi.mocked(api.updateProject);
    mockDeleteProject = vi.mocked(api.deleteProject);

    const { useProjectStore } = await import('../../stores/projectStore.js');
    mockSetProjects = vi.fn();
    vi.mocked(useProjectStore.getState).mockReturnValue({
      setProjects: mockSetProjects,
    } as any);
  });

  describe('return value', () => {
    it('returns all manager functions', () => {
      const { result } = renderHook(() => useProjectManager());

      expect(result.current).toHaveProperty('refreshProjects');
      expect(result.current).toHaveProperty('addProject');
      expect(result.current).toHaveProperty('updateProject');
      expect(result.current).toHaveProperty('deleteProject');

      expect(typeof result.current.refreshProjects).toBe('function');
      expect(typeof result.current.addProject).toBe('function');
      expect(typeof result.current.updateProject).toBe('function');
      expect(typeof result.current.deleteProject).toBe('function');
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useProjectManager());

      const firstAddProject = result.current.addProject;
      const firstUpdateProject = result.current.updateProject;
      const firstDeleteProject = result.current.deleteProject;

      rerender();

      expect(result.current.addProject).toBe(firstAddProject);
      expect(result.current.updateProject).toBe(firstUpdateProject);
      expect(result.current.deleteProject).toBe(firstDeleteProject);
    });
  });

  describe('refreshProjects', () => {
    it('fetches projects and updates store', async () => {
      const mockProjects = [
        { id: 'project-1', name: 'Project 1', path: '/path/1' },
        { id: 'project-2', name: 'Project 2', path: '/path/2' },
      ];
      mockGetProjects.mockResolvedValueOnce(mockProjects);

      const { result } = renderHook(() => useProjectManager());

      await result.current.refreshProjects();

      expect(mockGetProjects).toHaveBeenCalledTimes(1);
      expect(mockSetProjects).toHaveBeenCalledWith(mockProjects);
    });

    it('handles errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGetProjects.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useProjectManager());

      // Should not throw
      await expect(result.current.refreshProjects()).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ProjectManager] Failed to refresh projects:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('returns nothing (void)', async () => {
      mockGetProjects.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useProjectManager());

      const returnValue = await result.current.refreshProjects();
      expect(returnValue).toBeUndefined();
    });
  });

  describe('addProject', () => {
    it('creates project and refreshes list', async () => {
      mockCreateProject.mockResolvedValueOnce({ id: 'new-project' });
      mockGetProjects.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useProjectManager());

      const projectData = {
        name: 'New Project',
        path: '/path/to/project',
      };

      await result.current.addProject(projectData as any);

      expect(mockCreateProject).toHaveBeenCalledWith(projectData);
      expect(mockGetProjects).toHaveBeenCalled();
      expect(mockSetProjects).toHaveBeenCalled();
    });

    it('propagates errors from createProject', async () => {
      mockCreateProject.mockRejectedValueOnce(new Error('Create failed'));

      const { result } = renderHook(() => useProjectManager());

      await expect(
        result.current.addProject({ name: 'Test', path: '/test' } as any)
      ).rejects.toThrow('Create failed');
    });
  });

  describe('updateProject', () => {
    it('updates project and refreshes list', async () => {
      mockUpdateProject.mockResolvedValueOnce(undefined);
      mockGetProjects.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useProjectManager());

      const updates = { name: 'Updated Project' };

      await result.current.updateProject('project-1', updates);

      expect(mockUpdateProject).toHaveBeenCalledWith('project-1', updates);
      expect(mockGetProjects).toHaveBeenCalled();
      expect(mockSetProjects).toHaveBeenCalled();
    });

    it('propagates errors from updateProject', async () => {
      mockUpdateProject.mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useProjectManager());

      await expect(
        result.current.updateProject('project-1', { name: 'Test' })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('deleteProject', () => {
    it('deletes project and refreshes list', async () => {
      mockDeleteProject.mockResolvedValueOnce(undefined);
      mockGetProjects.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useProjectManager());

      await result.current.deleteProject('project-1');

      expect(mockDeleteProject).toHaveBeenCalledWith('project-1');
      expect(mockGetProjects).toHaveBeenCalled();
      expect(mockSetProjects).toHaveBeenCalled();
    });

    it('propagates errors from deleteProject', async () => {
      mockDeleteProject.mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useProjectManager());

      await expect(
        result.current.deleteProject('project-1')
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('integration scenarios', () => {
    it('can perform CRUD operations in sequence', async () => {
      mockCreateProject.mockResolvedValueOnce({ id: 'new' });
      mockUpdateProject.mockResolvedValueOnce(undefined);
      mockDeleteProject.mockResolvedValueOnce(undefined);
      mockGetProjects.mockResolvedValue([]);

      const { result } = renderHook(() => useProjectManager());

      // Add
      await result.current.addProject({ name: 'Test', path: '/test' } as any);
      expect(mockCreateProject).toHaveBeenCalled();

      // Update
      await result.current.updateProject('new', { name: 'Updated' });
      expect(mockUpdateProject).toHaveBeenCalled();

      // Delete
      await result.current.deleteProject('new');
      expect(mockDeleteProject).toHaveBeenCalled();

      // Should have called refresh (getProjects) after each operation
      expect(mockGetProjects).toHaveBeenCalledTimes(3);
    });
  });
});
