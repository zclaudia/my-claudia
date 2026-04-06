// Project Types

import type { UnifiedPermissionPolicy } from '../interaction/permissions.js';
import type { ProjectAgent } from '../features/supervision.js';

export type ProjectType = 'chat_only' | 'code';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  providerId?: string;
  rootPath?: string;
  systemPrompt?: string;
  permissionPolicy?: PermissionPolicy;
  agentPermissionOverride?: Partial<UnifiedPermissionPolicy>;  // Project-level override of global agent policy
  isInternal?: boolean;  // Internal projects (e.g. Agent Assistant) are hidden from user-facing lists
  reviewProviderId?: string;  // Provider used for Local PR reviews
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;

  // Supervision v2
  agent?: ProjectAgent;
  contextSyncStatus?: 'synced' | 'error';
}

export interface PermissionPolicy {
  allowedTools: string[];
  disallowedTools: string[];
  autoApprove: boolean;
  timeoutSeconds: number;
}

// Worktree Config Types

export interface WorktreeConfig {
  projectId: string;
  worktreePath: string;
  autoCreatePR: boolean;
  autoReview: boolean;
}

export interface GitWorktree {
  path: string;      // 绝对路径
  branch: string;    // 分支名
  isMain: boolean;   // 是否是主 worktree
  commit?: string;   // HEAD commit hash（短）
}
