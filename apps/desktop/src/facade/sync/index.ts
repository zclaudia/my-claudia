import type { BackendFacadeEvent } from '@my-claudia/shared';
import { syncBackendDataEvent, syncBackendDataSnapshot } from './backend-data-sync';
import { syncBackendLifecycle } from './backend-lifecycle-sync';
import { syncConnectionState, syncSnapshotToGatewayStore } from './gateway-connection-sync';
import {
  forwardEmbeddedBackendMessage,
  forwardRunEvent,
  syncContentPatch,
  syncContentPatchFailure,
} from './run-content-sync';
export { clearPendingAutoOpen, resetFacadeSyncState } from './state';

/**
 * Sync facade events into legacy stores used by the current UI.
 *
 * Keep this as a thin dispatcher; event-specific store writes live in sibling
 * modules so useBackendFacade only owns lifecycle wiring.
 */
export function syncToGatewayStore(event: BackendFacadeEvent): void {
  switch (event.type) {
    case 'snapshot_updated':
      syncSnapshotToGatewayStore(event);
      break;

    case 'connection_state_changed':
      syncConnectionState(event);
      break;

    case 'backend_state_changed':
      syncBackendLifecycle(event);
      break;

    case 'backend_data_snapshot':
      syncBackendDataSnapshot(event);
      break;

    case 'backend_data_event':
      syncBackendDataEvent(event);
      break;

    case 'run_event':
      forwardRunEvent(event);
      break;

    case 'content_patch':
      syncContentPatch(event);
      break;

    case 'content_patch_failed':
      syncContentPatchFailure(event);
      break;

    default:
      forwardEmbeddedBackendMessage(event);
      break;
  }
}
