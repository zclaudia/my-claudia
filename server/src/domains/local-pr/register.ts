/**
 * Local PR domain registration.
 *
 * Encapsulates all wiring needed to bootstrap the local-pr domain:
 * route mounting, service creation, event handlers, and scheduled tasks.
 */

import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { LocalPRService } from './service.js';
import { createLocalPRRoutes } from './routes.js';
import { systemTaskRegistry } from '../../services/system-task-registry.js';
import { pluginEvents } from '../../events/index.js';
export interface LocalPRDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string, msg: ServerMessage) => void;
  onProjectChanged?: () => void;
  /** Check if a worktree slot is available for a project */
  isWorktreeAvailable: (projectId: string) => boolean;
  /** Start an AI session (virtual client + handleRunStart) — injected from server layer */
  startAISession: (opts: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory?: string;
    providerId?: string;
    onMessage: (msg: ServerMessage) => void;
  }) => void;
}

export interface LocalPRDomainResult {
  localPRService: LocalPRService;
}

export function registerLocalPRDomain(deps: LocalPRDomainDeps): LocalPRDomainResult {
  const { db, app, authMiddleware, broadcast, isWorktreeAvailable, startAISession, onProjectChanged } = deps;

  const localPRService = new LocalPRService(db, broadcast, {
    startAISession,
    isProjectSlotAvailable: isWorktreeAvailable,
  });

  // Mount routes
  app.use('/api', authMiddleware, createLocalPRRoutes(localPRService, db, onProjectChanged));

  // Auto-trigger Local PR when a regular session completes
  pluginEvents.on('run.completed', async (data) => {
    try {
      const sessionId = data.sessionId as string | undefined;
      if (!sessionId) return;
      const sessionRow = db
        .prepare('SELECT project_id, type, working_directory FROM sessions WHERE id = ?')
        .get(sessionId) as { project_id: string; type: string; working_directory?: string } | undefined;
      if (!sessionRow?.working_directory || sessionRow.type !== 'regular') return;
      await localPRService.maybeAutoCreatePR(sessionRow.project_id, sessionRow.working_directory);
    } catch (err) {
      console.error('[LocalPR] Auto-trigger error:', err);
    }
  });

  // Register and start scheduler
  systemTaskRegistry.register({
    id: 'system:local_pr_scheduler',
    name: 'Local PR Scheduler',
    description: 'Processes pending local PR reviews and merges',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:local_pr_scheduler');
    const start = Date.now();
    try {
      await localPRService.tick();
      systemTaskRegistry.markRunComplete('system:local_pr_scheduler', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:local_pr_scheduler', Date.now() - start, String(err));
      console.error('[LocalPR] Tick error:', err);
    }
  }, 10000);

  return { localPRService };
}
