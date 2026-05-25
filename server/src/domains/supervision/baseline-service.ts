import type { Database } from 'better-sqlite3';
import type {
  ProjectChange,
  SupervisionLogEvent,
} from '@my-claudia/shared/features/supervision';
import { ProjectChangeRepository } from './repositories/project-change.js';
import type { SupervisionProjectPort } from './ports.js';
import type { ContextManager, ContextDocument } from './context-manager.js';
import { SupervisorContextService } from './supervisor-context.js';

export interface BaselineServiceDeps {
  db: Database;
  projectRepo: SupervisionProjectPort;
  changeRepo: ProjectChangeRepository;
  contextService: SupervisorContextService;
  getContextManager: (projectId: string, rootPath: string) => ContextManager;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>) => void;
}

/**
 * Handles supervisor context document access and Change-document editing.
 *
 * Historical note: this class used to also own "baseline" initialization
 * (`.supervision/baseline/project.md` + `architecture.md`). C4 removed
 * baseline as a Supervisor concept — project knowledge now lives in the
 * Spec corpus (openspec). The class name is kept for now to avoid an
 * unrelated rename in this PR.
 */
export class BaselineService {
  private projectRepo: SupervisionProjectPort;
  private changeRepo: ProjectChangeRepository;
  private contextService: SupervisorContextService;
  private getContextManager: BaselineServiceDeps['getContextManager'];
  private log: BaselineServiceDeps['log'];

  constructor(deps: BaselineServiceDeps) {
    this.projectRepo = deps.projectRepo;
    this.changeRepo = deps.changeRepo;
    this.contextService = deps.contextService;
    this.getContextManager = deps.getContextManager;
    this.log = deps.log;
  }

  getContextDocuments(projectId: string): ContextDocument[] {
    return this.contextService.getContextDocuments(projectId);
  }

  updateChangeDocument(
    changeId: string,
    docType: 'design' | 'execution' | 'tasks',
    content: string,
  ): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    const project = this.projectRepo.findById(change.projectId);
    if (!project?.rootPath) throw new Error(`Project ${change.projectId} has no rootPath`);

    const manager = this.getContextManager(change.projectId, project.rootPath);
    if (typeof (manager as { updateDocument?: unknown }).updateDocument === 'function') {
      manager.updateDocument(`changes/${change.id}/${docType}.md`, content, {
        category: docType,
        source: 'user',
      });
    } else {
      manager.updateStructuredDocument(
        `changes/${change.id}/${docType}.md`,
        { category: docType, source: 'user' },
        content,
      );
    }

    let updated = change;
    if (docType === 'design') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'designing',
        designApprovedAt: null,
        executionApprovedAt: null,
      });
    } else if (docType === 'execution') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'planning',
        executionApprovedAt: null,
      });
    }

    this.log(change.projectId, 'context_updated', {
      changeId,
      docType,
      docId: `changes/${change.id}/${docType}.md`,
    });
    return updated;
  }

  reloadContext(projectId: string): void {
    this.contextService.reloadContext(projectId);
  }
}
