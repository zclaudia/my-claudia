/**
 * Unit tests for PluginEventEmitter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pluginEvents } from '../index';

describe('PluginEventEmitter', () => {
  beforeEach(() => {
    pluginEvents.clear();
  });

  describe('on', () => {
    it('should subscribe to an event', () => {
      const listener = vi.fn();
      pluginEvents.on('run.started', listener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ sessionId: '123' }, undefined);
    });

    it('should return an unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = pluginEvents.on('run.started', listener);

      unsubscribe();
      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners for the same event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      pluginEvents.on('run.started', listener1);
      pluginEvents.on('run.started', listener2);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should track plugin ID for listeners', () => {
      const listener = vi.fn();
      pluginEvents.on('run.started', listener, 'com.example.plugin');

      pluginEvents.emitSync('run.started', { sessionId: '123' }, 'other.plugin');

      expect(listener).toHaveBeenCalledWith({ sessionId: '123' }, 'other.plugin');
    });
  });

  describe('once', () => {
    it('should subscribe for a single occurrence', () => {
      const listener = vi.fn();
      pluginEvents.once('run.started', listener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });
      pluginEvents.emitSync('run.started', { sessionId: '456' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ sessionId: '123' }, undefined);
    });

    it('should work with multiple once listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      pluginEvents.once('run.started', listener1);
      pluginEvents.once('run.started', listener2);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('off', () => {
    it('should unsubscribe a listener', () => {
      const listener = vi.fn();
      pluginEvents.on('run.started', listener);
      pluginEvents.off('run.started', listener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove once listeners', () => {
      const listener = vi.fn();
      pluginEvents.once('run.started', listener);
      pluginEvents.off('run.started', listener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('should emit events asynchronously', async () => {
      const listener = vi.fn().mockResolvedValue(undefined);
      pluginEvents.on('run.started', listener);

      await pluginEvents.emit('run.started', { sessionId: '123' });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should wait for async listeners', async () => {
      let resolved = false;
      const listener = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resolved = true;
      });

      pluginEvents.on('run.started', listener);

      const emitPromise = pluginEvents.emit('run.started', { sessionId: '123' });
      expect(resolved).toBe(false);

      await emitPromise;
      expect(resolved).toBe(true);
    });

    it('should handle errors in listeners gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingListener = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error('Listener failed'));
      });
      const successListener = vi.fn();

      pluginEvents.on('run.started', failingListener);
      pluginEvents.on('run.started', successListener);

      // emit should not throw even if a listener rejects
      await expect(pluginEvents.emit('run.started', { sessionId: '123' })).resolves.toBeUndefined();

      expect(failingListener).toHaveBeenCalled();
      expect(successListener).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should handle sync errors in regular listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingListener = vi.fn().mockImplementation(() => {
        throw new Error('Sync listener error');
      });

      pluginEvents.on('run.started', failingListener);

      await pluginEvents.emit('run.started', { sessionId: '123' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in listener'),
        'Sync listener error'
      );
      errorSpy.mockRestore();
    });

    it('should fire and remove once listeners', async () => {
      const listener = vi.fn();
      pluginEvents.once('run.completed', listener);

      await pluginEvents.emit('run.completed', { result: 'ok' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(pluginEvents.listenerCount('run.completed')).toBe(0);
    });

    it('should handle async errors in once listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingOnce = vi.fn().mockImplementation(async () => {
        throw new Error('Once async error');
      });

      pluginEvents.once('run.completed', failingOnce);

      await pluginEvents.emit('run.completed', { result: 'ok' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in async once listener'),
        'Once async error'
      );
      errorSpy.mockRestore();
    });

    it('should handle sync errors in once listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingOnce = vi.fn().mockImplementation(() => {
        throw new Error('Once sync error');
      });

      pluginEvents.once('run.completed', failingOnce);

      await pluginEvents.emit('run.completed', { result: 'ok' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in once listener'),
        'Once sync error'
      );
      errorSpy.mockRestore();
    });

    it('should emit with default empty data', async () => {
      const listener = vi.fn();
      pluginEvents.on('app.ready', listener);

      await pluginEvents.emit('app.ready');

      expect(listener).toHaveBeenCalledWith({}, undefined);
    });

    it('should pass source plugin ID to listeners', async () => {
      const listener = vi.fn();
      pluginEvents.on('custom:event', listener);

      await pluginEvents.emit('custom:event', { data: 'test' }, 'com.source.plugin');

      expect(listener).toHaveBeenCalledWith({ data: 'test' }, 'com.source.plugin');
    });
  });

  describe('emitSync', () => {
    it('should emit events synchronously', () => {
      const listener = vi.fn();
      pluginEvents.on('run.started', listener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(listener).toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingListener = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });
      const successListener = vi.fn();

      pluginEvents.on('run.started', failingListener);
      pluginEvents.on('run.started', successListener);

      pluginEvents.emitSync('run.started', { sessionId: '123' });

      expect(failingListener).toHaveBeenCalled();
      expect(successListener).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should fire and remove once listeners synchronously', () => {
      const listener = vi.fn();
      pluginEvents.once('app.ready', listener);

      pluginEvents.emitSync('app.ready', { status: 'ok' });
      pluginEvents.emitSync('app.ready', { status: 'again' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ status: 'ok' }, undefined);
    });

    it('should handle errors in sync once listeners', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingOnce = vi.fn().mockImplementation(() => {
        throw new Error('Once sync error');
      });

      pluginEvents.once('app.ready', failingOnce);

      pluginEvents.emitSync('app.ready', { status: 'ok' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in once listener'),
        'Once sync error'
      );
      errorSpy.mockRestore();
    });

    it('should use default empty data', () => {
      const listener = vi.fn();
      pluginEvents.on('app.ready', listener);

      pluginEvents.emitSync('app.ready');

      expect(listener).toHaveBeenCalledWith({}, undefined);
    });
  });

  describe('clearByPlugin', () => {
    it('should remove all listeners for a plugin', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const otherListener = vi.fn();

      pluginEvents.on('run.started', listener1, 'com.plugin1');
      pluginEvents.on('run.completed', listener2, 'com.plugin1');
      pluginEvents.on('run.started', otherListener, 'com.plugin2');

      const count = pluginEvents.clearByPlugin('com.plugin1');

      expect(count).toBe(2);
      pluginEvents.emitSync('run.started', {});
      pluginEvents.emitSync('run.completed', {});

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(otherListener).toHaveBeenCalled();
    });

    it('should clear once listeners for a plugin', () => {
      const listener = vi.fn();
      pluginEvents.once('run.started', listener, 'com.plugin1');

      const count = pluginEvents.clearByPlugin('com.plugin1');

      expect(count).toBe(1);
      pluginEvents.emitSync('run.started', {});
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('should return the number of listeners for an event', () => {
      pluginEvents.on('run.started', vi.fn());
      pluginEvents.on('run.started', vi.fn());
      pluginEvents.once('run.started', vi.fn());

      expect(pluginEvents.listenerCount('run.started')).toBe(3);
    });

    it('should return 0 for events with no listeners', () => {
      expect(pluginEvents.listenerCount('nonexistent:event')).toBe(0);
    });
  });

  describe('totalListeners', () => {
    it('should return the total number of all listeners', () => {
      pluginEvents.on('run.started', vi.fn());
      pluginEvents.on('run.completed', vi.fn());
      pluginEvents.once('session.created', vi.fn());

      expect(pluginEvents.totalListeners).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all listeners', () => {
      pluginEvents.on('run.started', vi.fn());
      pluginEvents.on('run.completed', vi.fn());
      pluginEvents.once('session.created', vi.fn());

      pluginEvents.clear();

      expect(pluginEvents.totalListeners).toBe(0);
    });
  });
});
