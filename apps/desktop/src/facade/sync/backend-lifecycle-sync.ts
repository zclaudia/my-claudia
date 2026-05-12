import type { BackendFacadeEvent } from '@my-claudia/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { useToastStore } from '../../stores/toastStore';
import { cleanupServerSyncState } from '../../services/messageHandler';
import { terminalRegistry } from '../../services/terminal/TerminalRegistry';
import { hasActiveRunsForBackend, noteAutoOpenFailure, noteAutoOpenSuccess } from './state';

export function syncBackendLifecycle(event: Extract<BackendFacadeEvent, { type: 'backend_state_changed' }>): void {
  if (event.state === 'ready') {
    noteAutoOpenSuccess(event.backendId);
  } else if (event.state === 'error' || event.state === 'offline') {
    noteAutoOpenFailure(event.backendId);
  }

  if (event.state === 'offline' || event.state === 'error') {
    cleanupServerSyncState(event.backendId);
    cleanupServerSyncState(`gw:${event.backendId}`);
  }

  const termStore = useTerminalStore.getState();
  if ((event.state === 'offline' || event.state === 'error') && event.error !== 'user_closed') {
    for (const [scopeKey, terminalId] of Object.entries(termStore.terminals)) {
      if (!scopeKey.startsWith(`${event.backendId}::`)) continue;
      terminalRegistry.get(terminalId)?.detach('backend_offline');
    }
  } else if (event.state === 'ready') {
    for (const [scopeKey, terminalId] of Object.entries(termStore.terminals)) {
      if (!scopeKey.startsWith(`${event.backendId}::`)) continue;
      const controller = terminalRegistry.get(terminalId);
      if (controller?.getState().kind === 'detached') controller.claim();
    }
  }

  const isTransient = event.error === 'user_closed' || event.error === 'transport_disconnected';
  if (event.error && !isTransient && event.state !== 'ready' && hasActiveRunsForBackend(event.backendId)) {
    useToastStore.getState().add({
      type: 'error',
      title: '远程连接已中断',
      message: `Backend ${event.backendId} 连接断开，正在等待恢复${event.error ? `: ${event.error}` : ''}`,
    });
  }
}
