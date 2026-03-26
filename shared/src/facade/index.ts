// BackendFacade module — unified backend capability surface
// See docs/design/backend-facade.md

// Types
export type {
  BackendFacadeMode,
  BackendConnectionState,
  BackendRuntimeState,
  BackendOpenState,
  SessionStreamState,
  BackendHandle,
  BackendSnapshot,
  SessionStreamSnapshot,
  BackendFacadeSnapshot,
  BackendRuntimeRecord,
  BackendStateDiff,
  DesiredSessionStream,
  SessionStreamRuntime,
  StreamCommand,
  StreamEvent,
  StreamManagerResult,
  BackendFacadeEvent,
  BackendFacade,
} from './types.js';

// Adapter contract
export type {
  FacadeAdapterConnectionState,
  FacadeAdapterEvent,
  FacadeAdapterBootstrapState,
  FacadeAdapterCommands,
  FacadeAdapterQueries,
  FacadeAdapterEventBus,
  FacadeRuntimeGatewayAdapter,
  BackendFacadeRuntimeCoreOptions,
} from './adapter.js';

// Constants
export {
  EPHEMERAL_STREAM_TTL,
  CLOSED_TOMBSTONE_TTL,
  ERROR_TOMBSTONE_TTL,
  DEFAULT_GC_INTERVAL,
} from './constants.js';

// Runtime classes
export { FacadeRegistryStore } from './registry-store.js';
export { FacadeStreamManager } from './stream-manager.js';
export { BackendFacadeRuntimeCore } from './runtime-core.js';

// Pure functions
export { assembleSnapshot } from './snapshot.js';
