import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from '../event-dispatcher.js';

interface Evt { type: string; payload?: unknown }

describe('EventDispatcher off / offAny', () => {
  it('off() removes a specific listener', () => {
    const d = new EventDispatcher<Evt>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    d.on('foo', h1);
    d.on('foo', h2);
    d.off('foo', h1);
    d.dispatch({ type: 'foo' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('off() is idempotent for unknown handlers', () => {
    const d = new EventDispatcher<Evt>();
    const h = vi.fn();
    // Removing without prior on() must not throw.
    expect(() => d.off('foo', h)).not.toThrow();
  });

  it('off() prunes empty event lists', () => {
    const d = new EventDispatcher<Evt>();
    const h = vi.fn();
    d.on('foo', h);
    d.off('foo', h);
    d.dispatch({ type: 'foo' });
    expect(h).not.toHaveBeenCalled();
  });

  it('offAny() removes a wildcard listener', () => {
    const d = new EventDispatcher<Evt>();
    const w1 = vi.fn();
    const w2 = vi.fn();
    d.onAny(w1);
    d.onAny(w2);
    d.offAny(w1);
    d.dispatch({ type: 'foo' });
    expect(w1).not.toHaveBeenCalled();
    expect(w2).toHaveBeenCalledOnce();
  });

  it('offAny() is idempotent for unknown handlers', () => {
    const d = new EventDispatcher<Evt>();
    const w = vi.fn();
    expect(() => d.offAny(w)).not.toThrow();
  });
});
