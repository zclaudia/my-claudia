interface ShouldShowDirectGatewaySetupOptions {
  directGatewayUrl: string | null;
  activeServerId: string | null;
  availableBackendIds: string[];
}

export function shouldShowDirectGatewaySetup({
  directGatewayUrl,
  activeServerId,
  availableBackendIds,
}: ShouldShowDirectGatewaySetupOptions): boolean {
  if (!directGatewayUrl) return true;
  if (!activeServerId) return true;
  return !availableBackendIds.includes(activeServerId);
}
