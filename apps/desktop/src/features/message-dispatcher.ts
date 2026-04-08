import type { ServerMessage } from '@my-claudia/shared';
import { handleLocalPRMessage } from './local-pr/handlers';
import { handleWorkflowMessage } from './workflows/handlers';
import { handleSupervisionMessage } from './supervision/handlers';

export type FeatureMessageHandler = (msg: ServerMessage) => boolean;

const featureMessageHandlers: FeatureMessageHandler[] = [
  handleLocalPRMessage,
  handleWorkflowMessage,
  handleSupervisionMessage,
];

export function dispatchFeatureMessage(msg: ServerMessage): boolean {
  for (const handler of featureMessageHandlers) {
    if (handler(msg)) return true;
  }
  return false;
}
