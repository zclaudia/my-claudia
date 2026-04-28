import type { Database } from 'better-sqlite3';
import type {
  ProjectChange,
  SupervisionLogEvent,
} from '@my-claudia/shared/features/supervision';
import { ProjectChangeRepository } from '../../infrastructure/repositories/project-change.js';
import type { SupervisionProjectPort } from './ports.js';
import type { ContextManager, ContextDocument } from './context-manager.js';
import { SupervisorContextService } from './supervisor-context.js';
import {
  scanProjectForBaseline,
  generateBaselineWithAi,
  type BaselineLanguage,
  type BaselineInitOptions,
  type BaselineInitResult,
} from './baseline-generator.js';

export interface BaselineServiceDeps {
  db: Database;
  projectRepo: SupervisionProjectPort;
  changeRepo: ProjectChangeRepository;
  contextService: SupervisorContextService;
  getContextManager: (projectId: string, rootPath: string) => ContextManager;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>) => void;
}

/**
 * Handles baseline initialization, context document CRUD,
 * and change/baseline document editing.
 */
export class BaselineService {
  private db: Database;
  private projectRepo: SupervisionProjectPort;
  private changeRepo: ProjectChangeRepository;
  private contextService: SupervisorContextService;
  private getContextManager: BaselineServiceDeps['getContextManager'];
  private log: BaselineServiceDeps['log'];

  constructor(deps: BaselineServiceDeps) {
    this.db = deps.db;
    this.projectRepo = deps.projectRepo;
    this.changeRepo = deps.changeRepo;
    this.contextService = deps.contextService;
    this.getContextManager = deps.getContextManager;
    this.log = deps.log;
  }

  async initBaseline(
    projectId: string,
    options: BaselineInitOptions = {},
  ): Promise<BaselineInitResult> {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    const mode = options.mode ?? 'template';
    const language = options.language ?? 'zh-CN';
    const force = options.force === true;
    const manager = this.getContextManager(projectId, project.rootPath);
    manager.scaffoldBaseline(project.name);

    if (mode === 'template' && !force) {
      return { initialized: true, mode, language, usedAi: false, regenerated: false };
    }

    const scanned = scanProjectForBaseline(project.rootPath, project.name, language);
    const generated = mode === 'ai_scan'
      ? await generateBaselineWithAi(this.db, project.rootPath, scanned, {
          providerId: options.providerId,
          language,
        })
      : scanned;

    manager.updateStructuredDocument('baseline/project.md', {
      kind: 'baseline',
      section: 'project',
      status: 'draft',
      updatedAt: new Date().toISOString(),
      generationMode: mode,
      language,
      generatedBy: mode === 'ai_scan' ? 'ai' : 'scan',
    }, generated.projectMd);

    manager.updateStructuredDocument('baseline/architecture.md', {
      kind: 'baseline',
      section: 'architecture',
      status: 'draft',
      updatedAt: new Date().toISOString(),
      generationMode: mode,
      language,
      generatedBy: mode === 'ai_scan' ? 'ai' : 'scan',
    }, generated.architectureMd);

    this.log(projectId, 'context_updated', {
      docType: 'baseline_init',
      mode,
      language,
      providerId: options.providerId,
      regenerated: force,
    });

    return {
      initialized: true,
      mode,
      language,
      usedAi: mode === 'ai_scan',
      regenerated: force || mode !== 'template',
    };
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

  updateBaselineDocument(
    projectId: string,
    docType: 'project' | 'architecture',
    content: string,
  ): { projectId: string; docId: string } {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) throw new Error(`Project ${projectId} has no rootPath`);

    const manager = this.getContextManager(projectId, project.rootPath);
    const docId = `baseline/${docType}.md`;
    if (typeof (manager as { updateDocument?: unknown }).updateDocument === 'function') {
      manager.updateDocument(docId, content, { category: 'baseline', source: 'user' });
    } else {
      manager.updateStructuredDocument(docId, { category: 'baseline', source: 'user' }, content);
    }

    this.log(projectId, 'context_updated', { docType, docId });
    return { projectId, docId };
  }

  reloadContext(projectId: string): void {
    this.contextService.reloadContext(projectId);
  }
}
