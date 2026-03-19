// Backend Server Types

export interface BackendServer {
  id: string;
  name: string;           // "家里的 Mac"、"公司 Mac"
  address: string;        // "192.168.1.100:3100" 或 "mac-home.local:3100"
  isDefault: boolean;
  lastConnected?: number; // 上次连接时间
  createdAt: number;
  clientId?: string;      // Optional client ID for multi-backend direct connections
  // Legacy fields (kept for backward compatibility with existing DB entries)
  connectionMode?: 'direct' | 'gateway';
}

// Server Feature Negotiation

/** Features a server can advertise. Frontend uses these to decide
 *  whether to call certain API endpoints or show certain UI. */
export type ServerFeature =
  | 'providerCapabilities'   // GET /api/providers/:id/capabilities, /type/:type/capabilities
  | 'providerCommands'       // GET /api/providers/:id/commands, /type/:type/commands
  | 'setDefaultProvider'     // POST /api/providers/:id/set-default
  | 'search'                 // GET /api/sessions/search/*
  | 'fileUpload'             // POST /api/files/upload
  | 'remoteTerminal'         // WebSocket-based PTY terminal
  | 'filePush'               // POST /api/files/push — server-to-client file delivery
  ;

/** All features supported by the current server version. */
export const ALL_SERVER_FEATURES: ServerFeature[] = [
  'providerCapabilities',
  'providerCommands',
  'setDefaultProvider',
  'search',
  'fileUpload',
  'remoteTerminal',
  'filePush',
];

// Server Info Types

export interface SdkVersionInfo {
  name: string;
  current: string;
  latest: string;
  outdated: boolean;
}

export interface SdkVersionReport {
  checkedAt: number;
  sdks: SdkVersionInfo[];
}

export interface ServerInfo {
  version: string;
  isLocalConnection: boolean;  // Whether the client is connecting from localhost (determined by server)
  features?: ServerFeature[];  // Server-advertised feature flags
  /** PEM-encoded RSA-OAEP public key for E2E credential encryption */
  publicKey?: string;
  /** SDK version check results (populated asynchronously after server startup) */
  sdkVersions?: SdkVersionReport;
}

// Gateway Backend Info (used by both server and gateway modules)

export interface GatewayBackendInfo {
  backendId: string;
  name: string;
  online: boolean;
  isLocal?: boolean;
}

// Server Gateway Configuration Types

export interface ServerGatewayConfig {
  id: number;
  enabled: boolean;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  backendId: string | null;
  registerAsBackend?: boolean;
  proxyUrl?: string | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServerGatewayStatus {
  enabled: boolean;
  connected: boolean;
  backendId: string | null;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  registerAsBackend: boolean;
  discoveredBackends: GatewayBackendInfo[];
}
