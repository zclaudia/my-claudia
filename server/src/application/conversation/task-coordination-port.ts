import type { BranchAction } from '@my-claudia/shared/protocol/messages';
import type { NotificationSource } from '@my-claudia/shared/features/notification-feed';
import type { OrchestratorTask } from '../orchestration/types.js';

export interface TaskCoordinationPort {
  getTask(taskId: string): OrchestratorTask | undefined;
  spawnTask(
    parentId: string | null,
    config: {
      task: string;
      projectId?: string;
      providerId?: string;
      initiator?: 'system' | 'claudia';
      branchId?: string;
      branchAction?: BranchAction;
      contextReset?: boolean;
      feed?: {
        triggerId?: string;
        source: NotificationSource;
        title: string;
      };
    },
  ): Promise<string>;
  killTask(taskId: string): Promise<void>;
  allocateBranch(opts: {
    hostProjectId: string;
    activeBranchId?: string | null;
    forceNew?: boolean;
    title: string;
    sessionId: string;
  }): {
    branchId: string;
    sessionId: string;
    action: 'reused' | 'forked' | 'created';
    contextReset?: boolean;
  };
  allocateForContinue(opts: {
    taskBranchId: string | null;
    hostProjectId: string;
    title: string;
    sessionId: string;
  }): {
    branchId: string;
    sessionId: string;
    action: 'reused' | 'forked' | 'created';
    contextReset?: boolean;
  };
  setActiveBranchId(hostProjectId: string, branchId: string | null): void;
  attachSession(branchId: string, sessionId: string): void;
  updateBranchTask(branchId: string, taskId: string, sessionId?: string): void;
}
