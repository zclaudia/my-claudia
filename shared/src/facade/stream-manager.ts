/**
 * FacadeStreamManager
 *
 * Manages multi-session stream lifecycle: desired state, runtime state,
 * auto-resume, and GC. Returns StreamManagerResult (commands + events)
 * without executing side effects.
 *
 * See docs/design/backend-facade.md § "FacadeStreamManager"
 */

import type { SessionMessage } from '../protocol/gateway.js';
import type { ServerMessage } from '../protocol/messages.js';
import {
  EPHEMERAL_STREAM_TTL,
  CLOSED_TOMBSTONE_TTL,
  ERROR_TOMBSTONE_TTL,
} from './constants.js';
import type {
  DesiredSessionStream,
  SessionStreamRuntime,
  SessionStreamSnapshot,
  SessionStreamState,
  StreamCommand,
  StreamEvent,
  StreamManagerResult,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function streamKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

function toSnapshot(runtime: SessionStreamRuntime): SessionStreamSnapshot {
  return {
    streamKey: runtime.streamKey,
    backendId: runtime.backendId,
    sessionId: runtime.sessionId,
    state: runtime.state,
    channelId: runtime.channelId,
    lastError: runtime.lastError,
    latestOffset: runtime.latestOffset,
    updatedAt: runtime.updatedAt,
  };
}

function emptyResult(): StreamManagerResult {
  return { commands: [], events: [] };
}

// ============================================================================
// FacadeStreamManager
// ============================================================================

export class FacadeStreamManager {
  private desiredStreams = new Map<string, DesiredSessionStream>();
  private runtimeStreams = new Map<string, SessionStreamRuntime>();

  // --------------------------------------------------------------------------
  // Bootstrap
  // --------------------------------------------------------------------------

  applyBootstrap(): void {
    this.desiredStreams.clear();
    this.runtimeStreams.clear();
  }

  // --------------------------------------------------------------------------
  // Request Open / Close
  // --------------------------------------------------------------------------

  requestOpen(
    backendId: string,
    sessionId: string,
    context: { backendReady: boolean; channelId: string | null; latestKnownOffset?: number },
  ): StreamManagerResult {
    const key = streamKey(backendId, sessionId);
    const now = Date.now();
    const result = emptyResult();

    // Upsert desired state
    const existing = this.desiredStreams.get(key);
    if (existing) {
      existing.shouldBeOpen = true;
      existing.autoResume = true;
      existing.updatedAt = now;
    } else {
      this.desiredStreams.set(key, {
        streamKey: key,
        backendId,
        sessionId,
        shouldBeOpen: true,
        autoResume: true,
        openedAt: now,
        updatedAt: now,
      });
    }

    // Get or create runtime
    let runtime = this.runtimeStreams.get(key);
    if (!runtime) {
      runtime = {
        streamKey: key,
        backendId,
        sessionId,
        state: 'closed',
        channelId: null,
        source: 'desired',
        lastActivityAt: now,
        updatedAt: now,
      };
      this.runtimeStreams.set(key, runtime);
    }

    // If already open, idempotent
    if (runtime.state === 'open') return result;

    // Transition to opening
    runtime.state = 'opening';
    runtime.lastError = undefined;
    runtime.openedAt = now;
    runtime.updatedAt = now;
    runtime.source = 'desired';

    // If backend ready, emit command
    if (context.backendReady && context.channelId) {
      runtime.channelId = context.channelId;
      result.commands.push({
        type: 'open_session_stream',
        backendId,
        channelId: context.channelId,
        sessionId,
      });
    }

    result.events.push({
      type: 'session_stream_state_changed',
      stream: toSnapshot(runtime),
    });

    return result;
  }

  requestClose(
    backendId: string,
    sessionId: string,
    context: { channelId: string | null },
  ): StreamManagerResult {
    const key = streamKey(backendId, sessionId);
    const now = Date.now();
    const result = emptyResult();

    // Update desired state
    const desired = this.desiredStreams.get(key);
    if (desired) {
      desired.shouldBeOpen = false;
      desired.updatedAt = now;
    }

    const runtime = this.runtimeStreams.get(key);
    if (!runtime) return result;

    // Already closed
    if (runtime.state === 'closed') return result;

    const prevState = runtime.state;

    // If open/opening with channel, send close command
    if (
      (prevState === 'open' || prevState === 'opening') &&
      context.channelId &&
      runtime.channelId === context.channelId
    ) {
      result.commands.push({
        type: 'close_session_stream',
        backendId,
        channelId: context.channelId,
        sessionId,
      });
    }

    // Optimistic local close
    runtime.state = 'closed';
    runtime.closedAt = now;
    runtime.updatedAt = now;

    result.events.push({
      type: 'session_stream_state_changed',
      stream: toSnapshot(runtime),
    });

    return result;
  }

  // --------------------------------------------------------------------------
  // Backend Lifecycle
  // --------------------------------------------------------------------------

  handleBackendBecameReady(
    backendId: string,
    channelId: string,
  ): StreamManagerResult {
    const now = Date.now();
    const result = emptyResult();

    for (const desired of this.desiredStreams.values()) {
      if (desired.backendId !== backendId) continue;
      if (!desired.shouldBeOpen || !desired.autoResume) continue;

      const runtime = this.runtimeStreams.get(desired.streamKey);

      // Already open — don't duplicate
      if (runtime && runtime.state === 'open') continue;

      // Create or update runtime
      const rt: SessionStreamRuntime = runtime ?? {
        streamKey: desired.streamKey,
        backendId: desired.backendId,
        sessionId: desired.sessionId,
        state: 'closed',
        channelId: null,
        source: 'desired',
        lastActivityAt: now,
        updatedAt: now,
      };

      rt.state = 'opening';
      rt.channelId = channelId;
      rt.lastError = undefined;
      rt.openedAt = now;
      rt.updatedAt = now;

      this.runtimeStreams.set(desired.streamKey, rt);

      result.commands.push({
        type: 'open_session_stream',
        backendId,
        channelId,
        sessionId: desired.sessionId,
      });

      result.events.push({
        type: 'session_stream_state_changed',
        stream: toSnapshot(rt),
      });
    }

    return result;
  }

  handleBackendLostChannel(
    backendId: string,
    reason: string,
    context: { willAutoRecover: boolean },
  ): StreamManagerResult {
    const now = Date.now();
    const result = emptyResult();

    for (const runtime of this.runtimeStreams.values()) {
      if (runtime.backendId !== backendId) continue;
      // Only affect active streams
      if (runtime.state === 'closed') continue;

      const desired = this.desiredStreams.get(runtime.streamKey);
      const shouldBeOpen = desired?.shouldBeOpen ?? false;

      if (!shouldBeOpen) {
        // No desire to keep open → close
        runtime.state = 'closed';
        runtime.closedAt = now;
        runtime.lastCloseReason = reason;
      } else if (context.willAutoRecover) {
        // Will auto-recover → opening (waiting for backend to come back)
        runtime.state = 'opening';
        runtime.channelId = null;
      } else {
        // Won't auto-recover → error
        runtime.state = 'error';
        runtime.lastError = reason;
      }

      runtime.updatedAt = now;

      result.events.push({
        type: 'session_stream_state_changed',
        stream: toSnapshot(runtime),
      });
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Gateway Stream Events
  // --------------------------------------------------------------------------

  handleSessionStreamClosed(
    backendId: string,
    channelId: string,
    sessionId: string,
    reason: string,
  ): StreamManagerResult {
    const key = streamKey(backendId, sessionId);
    const now = Date.now();
    const result = emptyResult();

    const runtime = this.runtimeStreams.get(key);
    if (!runtime) return result;

    // Ignore if channel doesn't match
    if (runtime.channelId !== channelId) return result;

    const desired = this.desiredStreams.get(key);

    if (desired?.shouldBeOpen) {
      // Desired open but stream was closed by gateway → error
      runtime.state = 'error';
      runtime.lastError = reason;
    } else {
      runtime.state = 'closed';
      runtime.closedAt = now;
      runtime.lastCloseReason = reason;
    }
    runtime.updatedAt = now;

    result.events.push({
      type: 'session_stream_state_changed',
      stream: toSnapshot(runtime),
    });

    return result;
  }

  handleContentPatch(
    backendId: string,
    channelId: string,
    sessionId: string,
    messages: SessionMessage[],
    latestOffset: number,
  ): StreamManagerResult {
    const key = streamKey(backendId, sessionId);
    const now = Date.now();
    const result = emptyResult();

    let runtime = this.runtimeStreams.get(key);

    // Create minimal ephemeral runtime if not exists
    if (!runtime) {
      runtime = {
        streamKey: key,
        backendId,
        sessionId,
        state: 'open',
        channelId,
        source: 'ephemeral',
        lastActivityAt: now,
        latestOffset,
        updatedAt: now,
      };
      this.runtimeStreams.set(key, runtime);

      result.events.push({
        type: 'session_stream_state_changed',
        stream: toSnapshot(runtime),
      });
    } else {
      // Promote opening/error → open
      if (runtime.state === 'opening' || runtime.state === 'error') {
        runtime.state = 'open';
        runtime.channelId = channelId;
        runtime.lastError = undefined;
        runtime.updatedAt = now;

        result.events.push({
          type: 'session_stream_state_changed',
          stream: toSnapshot(runtime),
        });
      }

      // Update offset (monotonic)
      if (runtime.latestOffset === undefined || latestOffset > runtime.latestOffset) {
        runtime.latestOffset = latestOffset;
      }
      runtime.lastActivityAt = now;
      runtime.updatedAt = now;
    }

    result.events.push({
      type: 'content_patch',
      backendId,
      sessionId,
      messages,
      latestOffset,
    });

    return result;
  }

  handleRunEvent(
    backendId: string,
    channelId: string,
    sessionId: string,
    event: ServerMessage,
  ): StreamManagerResult {
    const key = streamKey(backendId, sessionId);
    const now = Date.now();
    const result = emptyResult();

    let runtime = this.runtimeStreams.get(key);

    // Create minimal ephemeral runtime if not exists
    if (!runtime) {
      runtime = {
        streamKey: key,
        backendId,
        sessionId,
        state: 'open',
        channelId,
        source: 'ephemeral',
        lastActivityAt: now,
        updatedAt: now,
      };
      this.runtimeStreams.set(key, runtime);

      result.events.push({
        type: 'session_stream_state_changed',
        stream: toSnapshot(runtime),
      });
    } else {
      // Promote opening/error → open
      if (runtime.state === 'opening' || runtime.state === 'error') {
        runtime.state = 'open';
        runtime.channelId = channelId;
        runtime.lastError = undefined;
        runtime.updatedAt = now;

        result.events.push({
          type: 'session_stream_state_changed',
          stream: toSnapshot(runtime),
        });
      }
      runtime.lastActivityAt = now;
      runtime.updatedAt = now;
    }

    result.events.push({
      type: 'run_event',
      backendId,
      sessionId,
      event,
    });

    return result;
  }

  // --------------------------------------------------------------------------
  // Garbage Collection
  // --------------------------------------------------------------------------

  collectGarbage(now: number): StreamManagerResult {
    const result = emptyResult();
    const toRemove: string[] = [];

    for (const [key, runtime] of this.runtimeStreams) {
      const desired = this.desiredStreams.get(key);

      // Never GC if desired and should be open
      if (desired?.shouldBeOpen) continue;
      // Never GC active streams
      if (runtime.state === 'opening' || runtime.state === 'open') continue;

      const age = now - runtime.updatedAt;

      if (runtime.source === 'ephemeral') {
        if (age > EPHEMERAL_STREAM_TTL) toRemove.push(key);
      } else if (runtime.state === 'closed') {
        if (age > CLOSED_TOMBSTONE_TTL) toRemove.push(key);
      } else if (runtime.state === 'error') {
        if (age > ERROR_TOMBSTONE_TTL) toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.runtimeStreams.delete(key);
      // Also clean up desired if shouldBeOpen=false
      const desired = this.desiredStreams.get(key);
      if (desired && !desired.shouldBeOpen) {
        this.desiredStreams.delete(key);
      }
    }

    // GC is not a business event — no events emitted.
    // Runtime reflects disappearance in next snapshot naturally.

    return result;
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  getStream(backendId: string, sessionId: string): SessionStreamSnapshot | undefined {
    const runtime = this.runtimeStreams.get(streamKey(backendId, sessionId));
    return runtime ? toSnapshot(runtime) : undefined;
  }

  getAllStreams(): SessionStreamSnapshot[] {
    const snapshots: SessionStreamSnapshot[] = [];
    for (const runtime of this.runtimeStreams.values()) {
      snapshots.push(toSnapshot(runtime));
    }
    return snapshots;
  }

  getAllStreamsByBackend(backendId: string): SessionStreamSnapshot[] {
    const snapshots: SessionStreamSnapshot[] = [];
    for (const runtime of this.runtimeStreams.values()) {
      if (runtime.backendId === backendId) {
        snapshots.push(toSnapshot(runtime));
      }
    }
    return snapshots;
  }
}
