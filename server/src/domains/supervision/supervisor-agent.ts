import type {
  AgentMode,
  ProjectAgent,
  Session,
  SupervisionLogEvent,
  SupervisorConfig,
} from '@my-claudia/shared';
import type { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import type { ProjectRepository } from '../projects/repository.js';
import type { SessionRepository } from '../sessions/repository.js';
import type { ContextManager } from './context-manager.js';
import type { WorktreeManager } from './worktree-manager.js';

interface SupervisorAgentDeps {
  taskRepo: SupervisionTaskRepository;
  projectRepo: ProjectRepository;
  sessionRepo: SessionRepository;
  worktreeManager: WorktreeManager;
  getContextManager: (projectId: string, rootPath: string) => ContextManager;
  broadcastSessionCreated: (session: Session) => void;
  broadcastAgentUpdate: (projectId: string, agent: ProjectAgent) => void;
  log: (
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ) => void;
}

export class SupervisorAgentManager {
  constructor(private deps: SupervisorAgentDeps) {}

  initAgent(
    projectId: string,
    config?: Partial<SupervisorConfig>,
    providerId?: string,
    mode?: AgentMode,
  ): ProjectAgent {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!project.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath configured`);
    }

    const agentMode = mode ?? 'full';
    const sessionName = agentMode === 'lite' ? 'Workflow Runner' : 'Supervisor';
    const mainSession = this.deps.sessionRepo.create({
      projectId,
      name: sessionName,
      type: 'regular',
      projectRole: 'main',
      providerId: providerId ?? project.providerId,
      workingDirectory: project.rootPath,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
    this.deps.broadcastSessionCreated(mainSession);

    const now = Date.now();
    const agent: ProjectAgent = {
      type: 'supervisor',
      mode: agentMode,
      phase: 'idle',
      config: {
        maxConcurrentTasks: agentMode === 'lite' ? 1 : (config?.maxConcurrentTasks ?? 1),
        trustLevel: config?.trustLevel ?? 'low',
        autoDiscoverTasks: false,
        ...config,
      },
      mainSessionId: mainSession.id,
      createdAt: now,
      updatedAt: now,
    };

    this.deps.projectRepo.update(projectId, { agent });

    if (agentMode === 'full') {
      const contextManager = this.deps.getContextManager(projectId, project.rootPath);
      if (!contextManager.isInitialized()) {
        contextManager.scaffold(project.name);
      }
    }

    this.deps.broadcastAgentUpdate(projectId, agent);
    this.deps.log(projectId, 'agent_initialized', {
      config: agent.config,
      mode: agentMode,
      mainSessionId: mainSession.id,
    });

    return agent;
  }

  updateAgentPhase(
    projectId: string,
    action: 'pause' | 'resume' | 'archive' | 'approve_setup',
  ): ProjectAgent {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent) {
      throw new Error(`No agent found for project: ${projectId}`);
    }

    const agent = { ...project.agent };
    const previousPhase = agent.phase;

    switch (action) {
      case 'pause': {
        if (agent.phase !== 'active' && agent.phase !== 'idle') {
          throw new Error(
            `Cannot pause agent in phase '${agent.phase}'; must be 'active' or 'idle'`,
          );
        }
        agent.phase = 'paused';
        agent.pausedReason = 'user';
        agent.pausedAt = Date.now();
        break;
      }
      case 'resume': {
        if (agent.phase !== 'paused') {
          throw new Error(`Cannot resume agent in phase '${agent.phase}'; must be 'paused'`);
        }
        agent.phase = 'active';
        agent.pausedReason = undefined;
        agent.pausedAt = undefined;
        break;
      }
      case 'archive': {
        agent.phase = 'archived';
        agent.pausedReason = undefined;
        agent.pausedAt = undefined;
        this.deps.worktreeManager.cleanupPool(projectId).catch((err) => {
          console.error(`[Supervisor] Failed to cleanup pool for ${projectId}:`, err);
        });
        break;
      }
      case 'approve_setup': {
        if (agent.phase !== 'setup' && agent.phase !== 'initializing') {
          throw new Error(
            `Cannot approve setup for agent in phase '${agent.phase}'; must be 'setup' or 'initializing'`,
          );
        }
        const tasks = this.deps.taskRepo.findByStatus(projectId, 'pending', 'queued', 'running');
        agent.phase = tasks.length > 0 ? 'active' : 'idle';
        break;
      }
    }

    agent.updatedAt = Date.now();
    this.deps.projectRepo.update(projectId, { agent });
    this.deps.broadcastAgentUpdate(projectId, agent);
    this.deps.log(projectId, 'phase_changed', {
      from: previousPhase,
      to: agent.phase,
      action,
    });

    return agent;
  }

  getAgent(projectId: string): ProjectAgent | undefined {
    return this.deps.projectRepo.findById(projectId)?.agent;
  }
}
