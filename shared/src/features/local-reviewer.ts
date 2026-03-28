export type LocalReviewerProvider = 'ollama';

export type LocalModelRuntimeState =
  | 'disabled'
  | 'starting'
  | 'ready'
  | 'missing_binary'
  | 'missing_model'
  | 'error';

export interface LocalReviewerConfig {
  enabled: boolean;
  provider: LocalReviewerProvider;
  endpoint: string;
  model: string;
  managedRuntime: boolean;
  autoStart: boolean;
}

export interface LocalReviewerStatus {
  state: LocalModelRuntimeState;
  endpoint: string;
  model: string;
  binaryAvailable: boolean;
  serverReachable: boolean;
  modelAvailable: boolean;
  managedRuntimeActive: boolean;
  lastError?: string;
}

export const DEFAULT_LOCAL_REVIEWER_CONFIG: LocalReviewerConfig = {
  enabled: false,
  provider: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen3:4b-instruct',
  managedRuntime: true,
  autoStart: true,
};

export const DEFAULT_LOCAL_REVIEWER_STATUS: LocalReviewerStatus = {
  state: 'disabled',
  endpoint: DEFAULT_LOCAL_REVIEWER_CONFIG.endpoint,
  model: DEFAULT_LOCAL_REVIEWER_CONFIG.model,
  binaryAvailable: false,
  serverReachable: false,
  modelAvailable: false,
  managedRuntimeActive: false,
};
