import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginProviderAPI, createProviderAPI } from '../provider-api.js';

vi.mock('../../providers/registry.js', () => ({
  providerRegistry: {
    get: vi.fn(),
  },
}));

import { providerRegistry } from '../../providers/registry.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'claude',
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('PluginProviderAPI', () => {
  let db: Database.Database;
  let api: PluginProviderAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb();
    const now = Date.now();
    db.prepare('INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'prov-1', 'Claude Provider', 'claude', '/usr/bin/claude', null, 1, now, now
    );
    db.prepare('INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'prov-2', 'OpenCode Provider', 'opencode', null, '{"KEY":"val"}', 0, now, now
    );
    api = new PluginProviderAPI(db, 'test-plugin');
  });

  describe('list', () => {
    it('returns all providers with models', async () => {
      const providers = await api.list();
      expect(providers).toHaveLength(2);
      expect(providers[0].id).toBe('prov-1');
      expect(providers[0].isDefault).toBe(true);
      expect(providers[0].models).toContain('claude-opus-4-6');
      expect(providers[1].id).toBe('prov-2');
      expect(providers[1].isDefault).toBe(false);
      expect(providers[1].models).toEqual(['default']);
    });

    it('returns empty array when no providers', async () => {
      const emptyDb = createTestDb();
      const emptyApi = new PluginProviderAPI(emptyDb, 'plugin');
      const result = await emptyApi.list();
      expect(result).toEqual([]);
      emptyDb.close();
    });
  });

  describe('get', () => {
    it('returns provider by id', async () => {
      const provider = await api.get('prov-1');
      expect(provider).toBeDefined();
      expect(provider!.name).toBe('Claude Provider');
      expect(provider!.type).toBe('claude');
      expect(provider!.models.length).toBeGreaterThan(0);
    });

    it('returns undefined for non-existent provider', async () => {
      const provider = await api.get('non-existent');
      expect(provider).toBeUndefined();
    });
  });

  describe('call', () => {
    it('calls provider and returns result', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: 'Hello world' };
          yield { type: 'result', result: 'Final result', usage: { input_tokens: 10, output_tokens: 20 } };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      const result = await api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toContain('Hello world');
      expect(result.content).toContain('Final result');
      expect(result.providerId).toBe('prov-1');
      expect(result.usage.outputTokens).toBe(20);
    });

    it('throws for non-existent provider', async () => {
      await expect(api.call({
        providerId: 'missing',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Provider not found: missing');
    });

    it('throws for missing adapter', async () => {
      vi.mocked(providerRegistry.get).mockReturnValue(undefined as any);
      await expect(api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('No adapter found');
    });

    it('throws on provider run error', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          throw new Error('Provider crashed');
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);
      await expect(api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Provider call failed');
    });

    it('includes system prompt in built prompt', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: 'ok' };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      await api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
        systemPrompt: 'Be helpful',
      });

      const prompt = mockAdapter.run.mock.calls[0][0];
      expect(prompt).toContain('[System Instructions]');
      expect(prompt).toContain('Be helpful');
    });

    it('parses env from provider row', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: 'ok' };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      await api.call({
        providerId: 'prov-2',
        messages: [{ role: 'user', content: 'test' }],
      });

      const runOptions = mockAdapter.run.mock.calls[0][1];
      expect(runOptions.env).toEqual({ KEY: 'val' });
    });

    it('uses modelOverride', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: 'ok' };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      const result = await api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
        modelOverride: 'claude-sonnet-4-6',
      });

      expect(result.model).toBe('claude-sonnet-4-6');
    });

    it('parses response metadata with isComplete', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: '足够完善: 否\n完整性: 85' };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      const result = await api.call({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'check' }],
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.isComplete).toBe(true);
      expect(result.metadata!.score).toBe(85);
    });
  });

  describe('callStream', () => {
    it('streams content chunks', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          yield { type: 'assistant', content: 'Hello' };
          yield { type: 'assistant', content: 'Hello world' };
          yield { type: 'result', result: 'Done' };
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      const chunks: any[] = [];
      for await (const chunk of api.callStream({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4); // 2 content + 1 result content + 1 done
      expect(chunks[0].type).toBe('content');
      expect(chunks[0].delta).toBe('Hello');
      expect(chunks[1].delta).toBe(' world');
      expect(chunks[chunks.length - 1].type).toBe('done');
    });

    it('yields error for missing provider', async () => {
      const chunks: any[] = [];
      for await (const chunk of api.callStream({
        providerId: 'missing',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].error).toContain('Provider not found');
    });

    it('yields error for missing adapter', async () => {
      vi.mocked(providerRegistry.get).mockReturnValue(undefined as any);
      const chunks: any[] = [];
      for await (const chunk of api.callStream({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].error).toContain('No adapter found');
    });

    it('yields error on adapter failure', async () => {
      const mockAdapter = {
        run: vi.fn().mockImplementation(async function* () {
          throw new Error('Stream failed');
        }),
      };
      vi.mocked(providerRegistry.get).mockReturnValue(mockAdapter as any);

      const chunks: any[] = [];
      for await (const chunk of api.callStream({
        providerId: 'prov-1',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.some(c => c.type === 'error')).toBe(true);
    });
  });

  describe('createProviderAPI', () => {
    it('creates PluginProviderAPI instance', () => {
      const instance = createProviderAPI(db, 'my-plugin');
      expect(instance).toBeInstanceOf(PluginProviderAPI);
    });
  });
});
