import type { PermissionDecision } from '../../../infrastructure/providers/types.js';
import { decryptCredential } from '../../../utils/crypto.js';
import { rewriteSudoCommand } from '../../../utils/server-utils.js';
import {
  buildRememberKey,
  classify,
  getOutsideWorkspaceRootsToRemember,
  persistProjectAllowedOutsideWorkspaceRoots,
  persistSessionRememberedDecision
} from '../agent/permission-evaluator.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

function broadcastPermissionResolved(
  run: ActiveRun,
  requestId: string,
  decision: 'allow' | 'deny',
): void {
  const resolvedEvent = {
    type: 'permission_resolved',
    requestId,
    sessionId: run.sessionId,
    decision,
  } as ServerMessage & { type: 'permission_resolved'; requestId: string; sessionId: string; decision: string };
  broadcastRunMessage(run, resolvedEvent);
}

export function handlePermissionDecision(
  message: {
    type: 'permission_decision';
    requestId: string;
    allow: boolean;
    remember?: boolean;
    feedback?: string;
    encryptedCredential?: string;
  },
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>,
): void {
  console.log(`[Permission] Received decision for ${message.requestId}: ${message.allow ? 'allow' : 'deny'}`);
  console.log(`[Permission] Active runs: ${activeRuns.size}`);

  // Find the run with this pending permission
  for (const [runId, run] of activeRuns.entries()) {
    console.log(`[Permission] Checking run ${runId}, pending permissions: ${run.pendingPermissions.size}`);
    const pending = run.pendingPermissions.get(message.requestId);
    if (pending) {
      // Clear timeout if it was set (timeout is null when timeoutSeconds = 0)
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      // Cancel any queued/in-flight AI review for this request
      run.aiReviewQueue?.cancel(message.requestId);
      run.pendingPermissions.delete(message.requestId);

      // Revert to running status after permission resolved
      run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('running', Date.now(), run.sessionId);

      // If credential was provided (e.g. sudo password), decrypt and rewrite the command
      let updatedInput: unknown | undefined;
      if (message.allow && message.encryptedCredential) {
        try {
          const password = decryptCredential(message.encryptedCredential);
          const originalInput = pending.originalToolInput as { command?: string } | undefined;
          if (originalInput?.command) {
            updatedInput = {
              ...originalInput,
              command: rewriteSudoCommand(originalInput.command, password),
            };
            console.log(`[Permission] ${message.requestId}: Rewrote sudo command with credential`);
          }
        } catch (err) {
          console.error(`[Permission] Failed to decrypt credential for ${message.requestId}:`, err);
          pending.resolve({ behavior: 'deny', message: 'Failed to decrypt credential' });
          broadcastPermissionResolved(run, message.requestId, 'deny');
          return;
        }
      }

      // Store remembered decision if requested
      if (message.remember && pending.originalRequest) {
        const { toolName, detail } = pending.originalRequest;
        persistSessionRememberedDecision(
          run.db,
          run.sessionId,
          toolName,
          pending.originalToolInput,
          detail,
          message.allow ? 'allow' : 'deny'
        );
        const rememberKey = buildRememberKey(
          toolName,
          pending.originalToolInput,
          detail
        );
        run.rememberedDecisions.set(rememberKey, message.allow ? 'allow' : 'deny');
        if (message.allow && classify(toolName, pending.originalToolInput, detail) === 'fileRead') {
          const outsideRoots = getOutsideWorkspaceRootsToRemember(
            toolName,
            pending.originalToolInput,
            detail,
            run.workspaceRoot
          );
          persistProjectAllowedOutsideWorkspaceRoots(run.db, run.projectId, outsideRoots);
          for (const root of outsideRoots) {
            run.allowedOutsideWorkspaceRoots.add(root);
          }
          if (outsideRoots.length > 0) {
            console.log(`[Permission] Remembered outside-workspace roots ${JSON.stringify(outsideRoots)}`);
          }
        }
        console.log(`[Permission] Remembered ${message.allow ? 'allow' : 'deny'} for key "${rememberKey}"`);
      }

      const decision: PermissionDecision = {
        behavior: message.allow ? 'allow' : 'deny',
        message: message.allow
          ? undefined
          : (message.feedback?.trim() || 'User denied permission'),
      };
      if (updatedInput !== undefined) {
        decision.updatedInput = updatedInput;
      }
      pending.resolve(decision);

      // Broadcast resolution to all clients (so other devices close their modals)
      broadcastPermissionResolved(run, message.requestId, message.allow ? 'allow' : 'deny');

      console.log(`[Permission] ${message.requestId}: ${message.allow ? 'allowed' : 'denied'} - resolved!`);
      return;
    }
  }

  // requestId not found — already resolved by another device. Broadcast idempotent resolution.
  console.warn(`[Permission] Request ${message.requestId} not found in any active run — broadcasting permission_resolved`);
  // Find any active run's client to broadcast through (they all share the same virtualClient in gateway mode)
  for (const [, run] of activeRuns.entries()) {
    broadcastPermissionResolved(run, message.requestId, message.allow ? 'allow' : 'deny');
    break;
  }
}

export function handlePromptAnswer(
  message: {
    type: 'prompt_answer';
    requestId: string;
    formattedAnswer: string;
  },
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>,
): void {
  console.log(`[PromptRequest] Received answer for ${message.requestId}`);

  // Find the run with this pending permission (reuses the same pendingPermissions map)
  for (const [, run] of activeRuns.entries()) {
    const pending = run.pendingPermissions.get(message.requestId);
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      run.pendingPermissions.delete(message.requestId);

      // Revert to running status after question answered
      run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('running', Date.now(), run.sessionId);

      // Resolve with deny + user's formatted answer as the message
      // Claude reads this message and treats it as the user's response
      pending.resolve({ behavior: 'deny', message: message.formattedAnswer });

      // Broadcast resolution to all clients
      const resolvedEvent = {
        type: 'interaction_resolved' as const,
        interactionId: message.requestId,
        sessionId: run.sessionId,
      } as import('@my-claudia/shared/interaction/forms').InteractionResolvedMessage;

      const promptResolvedEvent = {
        type: 'prompt_request_resolved',
        requestId: message.requestId,
        sessionId: run.sessionId,
      } as ServerMessage & { type: 'prompt_request_resolved'; requestId: string; sessionId: string };
      broadcastRunMessage(run, promptResolvedEvent);

      // Phase 1: Emit parallel interaction_resolved event
      broadcastRunMessage(run, resolvedEvent as ServerMessage);

      console.log(`[PromptRequest] ${message.requestId}: answered - resolved!`);
      return;
    }
  }

  // requestId not found — already resolved by another device. Broadcast idempotent resolution.
  console.warn(`[PromptRequest] Request ${message.requestId} not found in any active run — broadcasting prompt_request_resolved`);
  for (const [, run] of activeRuns.entries()) {
    broadcastRunMessage(run, {
      type: 'prompt_request_resolved',
      requestId: message.requestId,
    } as ServerMessage & { type: 'prompt_request_resolved'; requestId: string });
    broadcastRunMessage(run, {
      type: 'interaction_resolved',
      interactionId: message.requestId,
    } as import('@my-claudia/shared/interaction/forms').InteractionResolvedMessage);
    break;
  }
}
