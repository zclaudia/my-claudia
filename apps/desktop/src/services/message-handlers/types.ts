export interface MessageHandlerContext {
  /** Virtual server ID (direct server ID or gateway-prefixed ID) */
  serverId: string;
  /** Actual backend ID for gateway connections; null for direct */
  backendId: string | null;
  /** Map of serverId -> active runId set (for heartbeat reconciliation) */
  serverRunsRef: Map<string, Set<string>>;
  /** Resolve the human-readable backend/server name for UI display */
  resolveBackendName: () => string | undefined;
  /** Log prefix, e.g. "Socket:srv1" or "GatewayConn:backend1" */
  logTag: string;
}

export interface MessageDispatchContext extends MessageHandlerContext {
  isStaleRunEvent: (runId: string, seq?: number) => boolean;
  isRunEventGap: (runId: string, seq?: number) => boolean;
  recoverRunGap: (runId: string, seq: number | undefined, sessionId?: string) => void;
  recordTerminalRun: (runId: string, seq?: number) => void;
  clearRunActivity: (runId: string) => void;
  clearRunSeq: (runId: string) => void;
  clearTerminalRunSeq: (runId: string) => void;
}
