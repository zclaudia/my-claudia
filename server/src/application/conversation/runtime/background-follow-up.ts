/**
 * Background follow-up consumer for provider streams with in-flight background tasks.
 *
 * When a provider run completes but has pending background tasks (run_in_background),
 * the main run ends normally while this module continues consuming the stream in
 * a fire-and-forget async context. When the CLI sends a follow-up assistant turn
 * (after the background task finishes), a brand-new run is created so the frontend
 * sees it as a separate message.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { ClaudeMessage } from '../../../infrastructure/providers/types.js';
import type { ProviderRegistryPort } from '../../../infrastructure/providers/registry.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { initDatabase } from '../../../infrastructure/storage/db.js';
import { sendMessage, broadcastToOtherAuthenticatedClients } from '../transport/broadcast.js';
import { handleProviderEvent, type ProviderEventState } from './run-events.js';
import { upsertAssistantMessage } from './run-lifecycle.js';
import { postRunCompletedNotification } from './run-terminal-notifications.js';
import {
  loadSessionRememberedDecisions,
  loadProjectAllowedOutsideWorkspaceRoots,
} from '../agent/permission-evaluator.js';

export interface BackgroundFollowUpContext {
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ConnectedClient;
  connectedClients: Map<string, ConnectedClient>;
  db: ReturnType<typeof initDatabase>;
  sessionId: string;
  projectId: string;
  providerType: string;
  providerRegistry: ProviderRegistryPort;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  initialPendingTasks: number;
  workspaceRoot: string;
}

/**
 * Spawn a detached async consumer that continues reading the provider stream
 * after the main run has ended. Does not block the caller.
 */
export function spawnBackgroundFollowUpConsumer(
  iterator: AsyncIterator<ClaudeMessage>,
  ctx: BackgroundFollowUpContext,
): void {
  consumeBackgroundStream(iterator, ctx).catch(err => {
    console.error('[BackgroundFollowUp] Unhandled error:', err);
  });
}

async function consumeBackgroundStream(
  iterator: AsyncIterator<ClaudeMessage>,
  ctx: BackgroundFollowUpContext,
): Promise<void> {
  let pendingTasks = ctx.initialPendingTasks;
  let followUpRun: ActiveRun | null = null;
  let followUpSendRunEvent: ((event: ServerMessage) => void) | null = null;
  const toolUseIdToName = new Map<string, string>();
  const providerEventState: ProviderEventState = {};

  try {
    while (true) {
      const iterResult = await iterator.next();
      if (iterResult.done) break;
      const msg = iterResult.value;

      // Track background task lifecycle
      if (msg.type === 'task_notification') {
        if (msg.taskStatus === 'started') {
          pendingTasks++;
        } else if (
          msg.taskStatus === 'completed' ||
          msg.taskStatus === 'failed' ||
          msg.taskStatus === 'stopped'
        ) {
          pendingTasks = Math.max(0, pendingTasks - 1);
        }

        // Broadcast task_notification to clients even without an active follow-up run
        if (followUpRun && followUpSendRunEvent) {
          handleProviderEvent({
            activeRun: followUpRun,
            activeRuns: ctx.activeRuns,
            broadcastHeartbeat: ctx.broadcastHeartbeat,
            client: ctx.client,
            db: ctx.db,
            input: '',
            modeValue: 'default',
            msg,
            notificationService: ctx.notificationService,
            notificationsService: ctx.notificationsService,
            persistSessionWorkingDirectory: () => {},
            providerRegistry: ctx.providerRegistry,
            providerType: ctx.providerType,
            runId: followUpRun.runId,
            sendRunEvent: followUpSendRunEvent,
            sessionId: ctx.sessionId,
            sessionType: 'regular',
            state: providerEventState,
            toolUseIdToName,
          });
        }
        continue;
      }

      // New assistant/tool_use message → create a follow-up run
      if (!followUpRun && (msg.type === 'assistant' || msg.type === 'tool_use')) {
        const created = createFollowUpRun(ctx);
        followUpRun = created.activeRun;
        followUpSendRunEvent = created.sendRunEvent;
        console.log(`[BackgroundFollowUp] Follow-up run ${followUpRun.runId} started for session ${ctx.sessionId}`);
      }

      if (followUpRun && followUpSendRunEvent) {
        followUpRun.lastActivityAt = Date.now();

        handleProviderEvent({
          activeRun: followUpRun,
          activeRuns: ctx.activeRuns,
          broadcastHeartbeat: ctx.broadcastHeartbeat,
          client: ctx.client,
          db: ctx.db,
          input: '',
          modeValue: 'default',
          msg,
          notificationService: ctx.notificationService,
          notificationsService: ctx.notificationsService,
          persistSessionWorkingDirectory: () => {},
          providerRegistry: ctx.providerRegistry,
          providerType: ctx.providerType,
          runId: followUpRun.runId,
          sendRunEvent: followUpSendRunEvent,
          sessionId: ctx.sessionId,
          sessionType: 'regular',
          state: providerEventState,
          toolUseIdToName,
        });

        if (followUpRun.completed) {
          finalizeFollowUpRun(followUpRun, ctx);
          followUpRun = null;
          followUpSendRunEvent = null;

          if (pendingTasks <= 0) {
            await iterator.return?.();
            return;
          }
          // More background tasks may still trigger another follow-up
        }
      }
    }
  } finally {
    await iterator.return?.();
    if (followUpRun) {
      finalizeFollowUpRun(followUpRun, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Follow-up run lifecycle
// ---------------------------------------------------------------------------

function createFollowUpRun(ctx: BackgroundFollowUpContext): {
  activeRun: ActiveRun;
  sendRunEvent: (event: ServerMessage) => void;
} {
  const runId = uuidv4();
  const assistantMessageId = uuidv4();

  const activeRun: ActiveRun = {
    runId,
    clientId: ctx.client.id,
    client: ctx.client,
    pendingPermissions: new Map(),
    db: ctx.db,
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    assistantMessageId,
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    pendingBackgroundTasks: 0,
    sessionType: 'regular',
    workspaceRoot: ctx.workspaceRoot,
    rememberedDecisions: loadSessionRememberedDecisions(ctx.db, ctx.sessionId),
    allowedOutsideWorkspaceRoots: loadProjectAllowedOutsideWorkspaceRoots(ctx.db, ctx.projectId),
    eventSeq: 0,
    providerType: ctx.providerType,
  };

  // Wire broadcast
  activeRun.broadcast = (msg: ServerMessage) => {
    sendMessage(ctx.client.ws, msg);
    if (ctx.connectedClients.size > 0) {
      broadcastToOtherAuthenticatedClients(ctx.connectedClients, ctx.client.id, msg);
    }
  };

  const sendRunEvent = (event: ServerMessage) => {
    if ('runId' in event) {
      activeRun.eventSeq += 1;
      (event as ServerMessage & { seq?: number }).seq = activeRun.eventSeq;
    }
    activeRun.broadcast!(event);
  };

  ctx.activeRuns.set(runId, activeRun);

  sendRunEvent({
    type: 'run_started',
    runId,
    sessionId: ctx.sessionId,
    clientRequestId: `bg-followup:${runId}`,
    assistantMessageId,
  });

  return { activeRun, sendRunEvent };
}

function finalizeFollowUpRun(run: ActiveRun, ctx: BackgroundFollowUpContext): void {
  try {
    upsertAssistantMessage(run, { indexMetadata: true });
  } catch (err) {
    console.error(`[BackgroundFollowUp] Failed to save message for run ${run.runId}:`, err);
  }

  if (!run.completed) {
    run.broadcast!({
      type: 'run_completed',
      runId: run.runId,
      sessionId: run.sessionId,
    });
  }

  ctx.activeRuns.delete(run.runId);
  ctx.broadcastHeartbeat();

  postRunCompletedNotification({
    db: ctx.db,
    sessionId: ctx.sessionId,
    notificationSender: ctx.notificationService,
    notificationsService: ctx.notificationsService,
  });

  console.log(`[BackgroundFollowUp] Follow-up run ${run.runId} finalized`);
}
