import { useOwnershipStore } from '../stores/ownershipStore';

export function getMobileRecoveryOwnerBackendId(
  sessionId: string | null | undefined,
  fallbackBackendId: string | null | undefined,
): string | null {
  if (!sessionId) {
    return fallbackBackendId ?? null;
  }

  return (
    useOwnershipStore.getState().getSessionBackendId(sessionId)
    ?? fallbackBackendId
    ?? null
  );
}
