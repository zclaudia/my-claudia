import type { ServerMessage } from '@my-claudia/shared';
import type { MessageHandlerContext } from './types';

export function handleErrorMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  if (msg.type !== 'error') return false;
  console.error(`[${ctx.logTag}] Server error:`, msg.message);
  return true;
}
