import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../notification-service.js';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NotificationService', () => {
  let service: NotificationService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
      }),
    };

    service = new NotificationService(mockDb);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns cached config if available', () => {
      // Set cache directly
      (service as any).configCache = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'cached-topic' };

      const config = service.getConfig();

      expect(config.ntfyTopic).toBe('cached-topic');
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it('loads config from database when not cached', () => {
      const storedConfig = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'db-topic' };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(storedConfig) });

      const config = service.getConfig();

      expect(config.ntfyTopic).toBe('db-topic');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT config FROM notification_config'));
    });

    it('returns default config if not found in database', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const config = service.getConfig();

      expect(config).toEqual(DEFAULT_NOTIFICATION_CONFIG);
    });

    it('returns default config on JSON parse error', () => {
      mockDb.prepare().get.mockReturnValue({ config: 'invalid-json{' });

      const config = service.getConfig();

      expect(config).toEqual(DEFAULT_NOTIFICATION_CONFIG);
    });

    it('caches config after loading from database', () => {
      const storedConfig = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'cached-test' };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(storedConfig) });

      // First call loads from DB
      service.getConfig();
      // Second call should use cache
      service.getConfig();

      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveConfig', () => {
    it('saves config to database', () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'new-topic' };

      service.saveConfig(config);

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_config'));
      expect(mockDb.prepare().run).toHaveBeenCalledWith(
        JSON.stringify(config),
        expect.any(Number)
      );
    });

    it('updates cache after saving', () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'saved-topic' };

      service.saveConfig(config);

      // Next getConfig should return cached value without DB query
      const result = service.getConfig();
      expect(result.ntfyTopic).toBe('saved-topic');
    });
  });

  describe('notify', () => {
    it('skips if notifications disabled', async () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, enabled: false, ntfyTopic: 'test' };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'permission_request',
        title: 'Test',
        body: 'Body',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips if ntfyTopic not set', async () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, enabled: true, ntfyTopic: '' };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'permission_request',
        title: 'Test',
        body: 'Body',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips if event type disabled', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'test',
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, permissionRequest: false },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'permission_request',
        title: 'Test',
        body: 'Body',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends POST to ntfy URL with correct headers', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'my-topic',
        ntfyUrl: 'https://ntfy.sh',
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, runCompleted: true },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'run_completed',
        title: 'Task Complete',
        body: 'Your task is done',
        priority: 'high',
        tags: ['white_check_mark', 'rocket'],
        clickUrl: 'myapp://session/123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://ntfy.sh/my-topic',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Title': 'Task Complete',
            'Priority': 'high',
            'Tags': 'white_check_mark,rocket',
            'Click': 'myapp://session/123',
          }),
          body: 'Your task is done',
        })
      );
    });

    it('removes trailing slash from ntfyUrl', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'my-topic',
        ntfyUrl: 'https://ntfy.sh/',
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, runCompleted: true },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'run_completed',
        title: 'Test',
        body: 'Body',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://ntfy.sh/my-topic',
        expect.any(Object)
      );
    });

    it('uses default priority if not specified', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'topic',
        ntfyUrl: 'https://ntfy.sh',
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, runCompleted: true },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.notify({
        type: 'run_completed',
        title: 'Test',
        body: 'Body',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Priority': 'default',
          }),
        })
      );
    });

    it('handles all event types', async () => {
      const eventTypes = [
        'permission_request',
        'ask_user_question',
        'run_completed',
        'run_failed',
        'supervision_update',
        'background_permission',
      ] as const;

      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'topic',
        ntfyUrl: 'https://ntfy.sh',
        events: {
          permissionRequest: true,
          askUserQuestion: true,
          runCompleted: true,
          runFailed: true,
          supervisionUpdate: true,
          backgroundPermission: true,
        },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      for (const type of eventTypes) {
        mockFetch.mockClear();
        await service.notify({ type, title: 'Test', body: 'Body' });
        expect(mockFetch).toHaveBeenCalled();
      }
    });

    it('handles network errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'topic',
        ntfyUrl: 'https://ntfy.sh',
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, runCompleted: true },
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(service.notify({
        type: 'run_completed',
        title: 'Test',
        body: 'Body',
      })).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Notification] Failed to send ntfy notification:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('sendTest', () => {
    it('throws if ntfyTopic not configured', async () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: '' };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await expect(service.sendTest()).rejects.toThrow('ntfy topic is not configured');
    });

    it('sends test notification with correct headers', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        ntfyTopic: 'test-topic',
        ntfyUrl: 'https://ntfy.sh',
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });

      await service.sendTest();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://ntfy.sh/test-topic',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Title': 'MyClaudia - Test Notification',
            'Priority': 'default',
            'Tags': 'white_check_mark',
          },
          body: 'If you see this, notifications are working!',
        })
      );
    });

    it('throws on non-OK response', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        ntfyTopic: 'test-topic',
        ntfyUrl: 'https://ntfy.sh',
      };
      mockDb.prepare().get.mockReturnValue({ config: JSON.stringify(config) });
      mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

      await expect(service.sendTest()).rejects.toThrow('ntfy returned 403: Forbidden');
    });
  });
});
