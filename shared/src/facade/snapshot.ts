/**
 * Snapshot Assembly
 *
 * Pure function to assemble BackendFacadeSnapshot from runtime components.
 */

import type {
  BackendConnectionState,
  BackendFacadeMode,
  BackendFacadeSnapshot,
  BackendRuntimeRecord,
  BackendSnapshot,
  SessionStreamSnapshot,
} from './types.js';

/**
 * Assemble a full BackendFacadeSnapshot from the current state of
 * RegistryStore and StreamManager.
 */
export function assembleSnapshot(params: {
  version: number;
  now: number;
  mode: BackendFacadeMode;
  connectionState: BackendConnectionState;
  localBackendId: string | null;
  currentInstanceId: string | null;
  currentDeviceId: string | null;
  backends: BackendRuntimeRecord[];
  streams: SessionStreamSnapshot[];
  registryRevision: number;
}): BackendFacadeSnapshot {
  const backendSnapshots: BackendSnapshot[] = params.backends
    .filter(r => r.presence !== null)
    .map(r => recordToBackendSnapshot(r, params.currentInstanceId, params.currentDeviceId));

  const sessionStreams: Record<string, SessionStreamSnapshot> = {};
  for (const s of params.streams) {
    sessionStreams[s.streamKey] = s;
  }

  return {
    snapshotVersion: params.version,
    capturedAt: params.now,
    mode: params.mode,
    connectionState: params.connectionState,
    localBackendId: params.localBackendId,
    currentInstanceId: params.currentInstanceId,
    currentDeviceId: params.currentDeviceId,
    backends: backendSnapshots,
    sessionStreams,
    registryRevision: params.registryRevision,
  };
}

function recordToBackendSnapshot(
  record: BackendRuntimeRecord,
  currentInstanceId: string | null,
  currentDeviceId: string | null,
): BackendSnapshot {
  const presence = record.presence!;
  return {
    backendId: record.backendId,
    name: presence.name,
    online: presence.visible,
    runtimeState: record.runtimeState,
    openState: record.openState,
    channelId: record.channelId,
    instanceId: presence.instanceId,
    deviceId: presence.deviceId,
    channel: presence.channel,
    isThisInstance: currentInstanceId !== null && presence.instanceId === currentInstanceId,
    isThisDevice: currentDeviceId !== null && presence.deviceId === currentDeviceId,
    capabilities: record.capabilities,
    lastError: record.lastError,
  };
}
