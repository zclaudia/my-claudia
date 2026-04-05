import type { SupervisionLogEvent } from '@my-claudia/shared';
import type { ProjectRepository } from '../projects/repository.js';
import { ContextManager, type ContextDocument } from './context-manager.js';

interface SupervisorContextDeps {
  projectRepo: ProjectRepository;
  pauseAgent: (projectId: string, reason: 'sync_error') => void;
  log: (
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ) => void;
}

export class SupervisorContextService {
  private contextManagers = new Map<string, ContextManager>();

  constructor(private deps: SupervisorContextDeps) {}

  getContextDocuments(projectId: string): ContextDocument[] {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      this.contextManagers.delete(projectId);
      return [];
    }

    const contextManager = this.getContextManager(projectId, project.rootPath);
    try {
      return contextManager.loadAll().documents;
    } catch {
      return [];
    }
  }

  reloadContext(projectId: string): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      this.contextManagers.delete(projectId);
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    this.contextManagers.delete(projectId);
    const contextManager = this.getContextManager(projectId, project.rootPath);

    try {
      contextManager.loadAll();
      this.deps.projectRepo.update(projectId, { contextSyncStatus: 'synced' });
    } catch (err) {
      console.error(`[Supervisor] Context reload failed for project ${projectId}:`, err);
      this.deps.projectRepo.update(projectId, { contextSyncStatus: 'error' });
      if (project.agent) {
        this.deps.pauseAgent(projectId, 'sync_error');
      }
      this.deps.log(projectId, 'context_sync_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  getContextManager(projectId: string, rootPath: string): ContextManager {
    let contextManager = this.contextManagers.get(projectId);
    if (!contextManager) {
      contextManager = new ContextManager(rootPath);
      this.contextManagers.set(projectId, contextManager);
    }
    return contextManager;
  }

  clearContextManager(projectId: string): void {
    this.contextManagers.delete(projectId);
  }

  clearAll(): void {
    this.contextManagers.clear();
  }
}
