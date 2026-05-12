import { describe, expect, it, vi } from 'vitest';
import { createMessageDispatcher } from '../dispatcher';

interface TestMessage {
  type: string;
  value?: number;
}

interface TestContext {
  serverId: string;
}

describe('createMessageDispatcher', () => {
  it('dispatches messages to the handler registered for their type', () => {
    const handleFoo = vi.fn();
    const handleBar = vi.fn();
    const dispatcher = createMessageDispatcher<TestMessage, TestContext>([
      { types: ['foo'], handle: handleFoo },
      { types: ['bar'], handle: handleBar },
    ]);

    const handled = dispatcher.dispatch({ type: 'foo', value: 1 }, { serverId: 'server-1' });

    expect(handled).toBe(true);
    expect(handleFoo).toHaveBeenCalledWith({ type: 'foo', value: 1 }, { serverId: 'server-1' });
    expect(handleBar).not.toHaveBeenCalled();
  });

  it('returns false when no handler is registered for the message type', () => {
    const dispatcher = createMessageDispatcher<TestMessage, TestContext>([
      { types: ['foo'], handle: vi.fn() },
    ]);

    expect(dispatcher.dispatch({ type: 'unknown' }, { serverId: 'server-1' })).toBe(false);
  });

  it('throws when a message type is registered more than once', () => {
    expect(() => createMessageDispatcher<TestMessage, TestContext>([
      { types: ['foo'], handle: vi.fn() },
      { types: ['foo'], handle: vi.fn() },
    ])).toThrow('Duplicate message handler registration for type "foo"');
  });
});
