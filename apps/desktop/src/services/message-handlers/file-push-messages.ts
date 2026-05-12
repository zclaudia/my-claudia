import type { ServerMessage } from '@my-claudia/shared';
import type { MessageHandlerContext } from './types';
import { useChatStore } from '../../stores/chatStore';
import { useFilePushStore } from '../../stores/filePushStore';
import { downloadPushedFile } from '../fileDownload';

export function handleFilePushMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  if (msg.type !== 'file_push') return false;

  useChatStore.getState().addMessage(msg.sessionId, {
    id: msg.messageId || `file-push-${msg.fileId}`,
    sessionId: msg.sessionId,
    role: 'system',
    content: `File pushed: ${msg.fileName}`,
    metadata: {
      filePush: {
        fileId: msg.fileId,
        fileName: msg.fileName,
        mimeType: msg.mimeType,
        fileSize: msg.fileSize,
        description: msg.description,
        autoDownload: msg.autoDownload,
      },
    },
    createdAt: Date.now(),
  });

  useFilePushStore.getState().addItem({
    fileId: msg.fileId,
    fileName: msg.fileName,
    mimeType: msg.mimeType,
    fileSize: msg.fileSize,
    sessionId: msg.sessionId,
    description: msg.description,
    autoDownload: msg.autoDownload,
    serverId: ctx.serverId,
  });
  if (msg.autoDownload) {
    downloadPushedFile(msg.fileId);
  }
  return true;
}
