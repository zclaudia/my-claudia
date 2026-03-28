import { useFacadeStore } from '../stores/facadeStore';
import { useGatewayStore } from '../stores/gatewayStore';

export type ControlPlaneMode = 'embedded-local' | 'gateway-direct';
export const LEGACY_LOCAL_SERVER_ID = 'local';
export const LEGACY_LOCAL_BACKEND_KEY = '__local__';

export function getControlPlaneMode(): ControlPlaneMode {
  const { directGatewayUrl, directGatewaySecret } = useGatewayStore.getState();
  return directGatewayUrl && directGatewaySecret ? 'gateway-direct' : 'embedded-local';
}

export function isLegacyLocalBackendId(backendId: string | null | undefined): boolean {
  return backendId === LEGACY_LOCAL_SERVER_ID || backendId === LEGACY_LOCAL_BACKEND_KEY;
}

export function isLocalBackendId(backendId: string | null | undefined): boolean {
  if (!backendId) return false;
  if (isLegacyLocalBackendId(backendId)) return true;

  const { localBackendId, backends } = useFacadeStore.getState();
  if (localBackendId && backendId === localBackendId) return true;

  const backend = backends.find((item) => item.backendId === backendId);
  return backend?.isThisInstance === true || backend?.channel === 'local';
}

export function resolveLocalBackendId(fallback: string | null = null): string | null {
  const { localBackendId, backends } = useFacadeStore.getState();
  if (localBackendId) return localBackendId;

  const localBackend = backends.find((item) => item.isThisInstance === true || item.channel === 'local');
  return localBackend?.backendId ?? fallback;
}

export function resolveCanonicalBackendId(
  backendId: string | null | undefined,
  fallback: string | null = null,
): string | null {
  if (!backendId) return fallback;
  if (isLegacyLocalBackendId(backendId)) {
    return resolveLocalBackendId(fallback ?? backendId);
  }
  return backendId;
}
