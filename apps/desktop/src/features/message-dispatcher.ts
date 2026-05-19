import type { ServerMessage } from '@my-claudia/shared';
import { handleLocalPRMessage } from './local-pr/handlers';
import { handleLocalIssueMessage } from './local-issues/handlers';
import { handleWorkflowMessage } from './workflows/handlers';
import { handleSupervisionMessage } from './supervision/handlers';
import { handleAttachmentMessage } from './attachments/handlers';
import { handleMetaWorkflowMessage } from './meta-workflow/handlers.js';

export type FeatureMessageHandler = (msg: ServerMessage) => boolean;

const featureMessageHandlers: FeatureMessageHandler[] = [
  handleLocalPRMessage,
  handleLocalIssueMessage,
  handleWorkflowMessage,
  handleSupervisionMessage,
  handleAttachmentMessage,
  handleMetaWorkflowMessage,
];

export function dispatchFeatureMessage(msg: ServerMessage): boolean {
  for (const handler of featureMessageHandlers) {
    if (handler(msg)) return true;
  }
  return false;
}
