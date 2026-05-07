import type { ServerMessage } from '@my-claudia/shared';
import { useAttachmentsStore } from './store';

export function handleAttachmentMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'attachment_added': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { attachment } = msg as any;
      useAttachmentsStore.getState().upsertFromRemote(attachment);
      return true;
    }

    case 'attachment_removed': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ownerKind, ownerId, attachmentId } = msg as any;
      useAttachmentsStore.getState().removeFromRemote(ownerKind, ownerId, attachmentId);
      return true;
    }

    default:
      return false;
  }
}
