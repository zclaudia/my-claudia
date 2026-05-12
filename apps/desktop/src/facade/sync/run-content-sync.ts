import type { BackendFacadeEvent, SessionMessage } from '@my-claudia/shared';
import { useChatStore, type MessageWithToolCalls } from '../../stores/chatStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useToastStore } from '../../stores/toastStore';
import { handleServerMessage } from '../../services/messageHandler';
import { getFacadeServerRuns } from './state';

export function forwardRunEvent(event: Extract<BackendFacadeEvent, { type: 'run_event' }>): void {
  const { backendId, event: serverEvent } = event;
  const { backends } = useFacadeStore.getState();

  handleServerMessage(serverEvent, {
    serverId: backendId,
    backendId,
    serverRunsRef: getFacadeServerRuns(),
    resolveBackendName: () => backends.find(b => b.backendId === backendId)?.name,
    logTag: `Facade:${backendId}`,
  });
}

export function syncContentPatch(event: Extract<BackendFacadeEvent, { type: 'content_patch' }>): void {
  const { sessionId, messages, latestOffset } = event;
  const restoredMessages: MessageWithToolCalls[] = messages.map((msg: SessionMessage) => ({
    id: msg.messageId,
    sessionId: msg.sessionId,
    role: msg.role === 'tool' ? 'assistant' : msg.role,
    createdAt: msg.createdAt,
    offset: msg.offset,
    content: typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content),
  }));
  useChatStore.getState().appendMessages(sessionId, restoredMessages, { maxOffset: latestOffset });
  useRecoveryStore.getState().noteActiveSessionMessage();
}

export function syncContentPatchFailure(event: Extract<BackendFacadeEvent, { type: 'content_patch_failed' }>): void {
  useToastStore.getState().add({
    type: 'error',
    title: '消息同步失败',
    message: event.error,
    sessionId: event.sessionId,
    serverId: event.backendId,
  });
}

export function forwardEmbeddedBackendMessage(event: any): void {
  const msgType = event.type as string;
  if (msgType !== 'backend_message_received' && !msgType?.startsWith('plugin_')) return;

  const backendId = event.backendId ?? useFacadeStore.getState().localBackendId ?? 'local';
  const msg = msgType === 'backend_message_received' ? event.message : event;
  handleServerMessage(msg, {
    serverId: backendId,
    backendId,
    serverRunsRef: getFacadeServerRuns(),
    resolveBackendName: () => useFacadeStore.getState().backends.find(b => b.backendId === backendId)?.name,
    logTag: `Facade:${backendId}`,
  });
}
