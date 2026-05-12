export type MessageHandlerFn<TMessage extends { type: string }, TContext> = (
  message: TMessage,
  context: TContext,
) => void | boolean;

export interface MessageHandlerRegistration<TMessage extends { type: string }, TContext> {
  types: readonly string[];
  handle: MessageHandlerFn<TMessage, TContext>;
}

export interface MessageDispatcher<TMessage extends { type: string }, TContext> {
  dispatch: (message: TMessage, context: TContext) => boolean;
  has: (type: string) => boolean;
}

export function createMessageDispatcher<TMessage extends { type: string }, TContext>(
  registrations: readonly MessageHandlerRegistration<TMessage, TContext>[],
): MessageDispatcher<TMessage, TContext> {
  const handlers = new Map<string, MessageHandlerFn<TMessage, TContext>>();

  for (const registration of registrations) {
    for (const type of registration.types) {
      if (handlers.has(type)) {
        throw new Error(`Duplicate message handler registration for type "${type}"`);
      }
      handlers.set(type, registration.handle);
    }
  }

  return {
    dispatch(message, context) {
      const handler = handlers.get(message.type);
      if (!handler) return false;
      return handler(message, context) !== false;
    },
    has(type) {
      return handlers.has(type);
    },
  };
}
