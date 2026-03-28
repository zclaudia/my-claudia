import { useGatewayStore } from '../stores/gatewayStore';
import type { ControlPlaneMode } from '../utils/controlPlane';

export function useControlPlaneMode(): ControlPlaneMode {
  const directGatewayUrl = useGatewayStore((s) => s.directGatewayUrl);
  const directGatewaySecret = useGatewayStore((s) => s.directGatewaySecret);
  return directGatewayUrl && directGatewaySecret ? 'gateway-direct' : 'embedded-local';
}
