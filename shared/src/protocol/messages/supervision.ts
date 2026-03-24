// Supervision v2 protocol messages

import type { SupervisionTask, ProjectAgent, SupervisorConfig } from '../../features/supervision.js';

// Client → Server messages

export interface GetSupervisionTasksMessage {
  type: 'get_supervision_tasks';
  projectId: string;
}

export interface AddSupervisionTaskMessage {
  type: 'add_supervision_task';
  projectId: string;
  task: {
    title: string;
    description: string;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
  };
}

export interface UpdateSupervisionTaskMessage {
  type: 'update_supervision_task';
  taskId: string;
  updates: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'status'
    | 'acceptanceCriteria' | 'dependencies' | 'dependencyMode'>>;
}

export interface InitSupervisionAgentMessage {
  type: 'init_supervision_agent';
  projectId: string;
  config?: Partial<SupervisorConfig>;
}

export interface UpdateSupervisionAgentMessage {
  type: 'update_supervision_agent';
  projectId: string;
  action: 'pause' | 'resume' | 'archive' | 'approve_setup';
}

export interface ReloadSupervisionContextMessage {
  type: 'reload_supervision_context';
  projectId: string;
}

// Server → Client messages

export interface SupervisionTaskUpdateMessage {
  type: 'supervision_task_update';
  task: SupervisionTask;
  projectId: string;
}

export interface SupervisionAgentUpdateMessage {
  type: 'supervision_agent_update';
  projectId: string;
  agent: ProjectAgent;
}

export interface SupervisionCheckpointMessage {
  type: 'supervision_checkpoint';
  projectId: string;
  summary: string;
}
