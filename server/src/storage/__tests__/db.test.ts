import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock better-sqlite3
const mockDb = {
  pragma: vi.fn(),
  exec: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
  })),
  close: vi.fn(),
};

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => mockDb),
  };
});

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// Mock metadata-extractor
vi.mock('../metadata-extractor.js', () => ({
  reindexAllMessages: vi.fn(),
}));

describe('storage/db', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset modules to get fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initDatabase', () => {
    it('creates database with WAL mode', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('ensures data directory exists', async () => {
      const mockFs = await import('fs');
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.my-claudia'),
        { recursive: true }
      );
    });

    it('uses MY_CLAUDIA_DATA_DIR environment variable', async () => {
      const originalEnv = process.env.MY_CLAUDIA_DATA_DIR;
      process.env.MY_CLAUDIA_DATA_DIR = '/custom/data/dir';

      const mockFs = await import('fs');
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      // Reset modules to pick up new env var
      vi.resetModules();
      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/custom/data/dir',
        { recursive: true }
      );

      process.env.MY_CLAUDIA_DATA_DIR = originalEnv;
    });

    it('runs migrations on initialization', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // Should have called exec for migrations table and at least one migration
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it('returns database instance', async () => {
      const { initDatabase } = await import('../db.js');

      const db = initDatabase();

      expect(db).toBe(mockDb);
    });
  });

  describe('migrations', () => {
    it('creates migrations table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // First exec call should be for migrations table
      const firstExecCall = mockDb.exec.mock.calls[0];
      expect(firstExecCall[0]).toContain('CREATE TABLE IF NOT EXISTS migrations');
    });

    it('creates providers table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // Find the call that creates providers table
      const providersCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS providers')
      );
      expect(providersCall).toBeDefined();
    });

    it('creates projects table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const projectsCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS projects')
      );
      expect(projectsCall).toBeDefined();
    });

    it('creates sessions table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const sessionsCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS sessions')
      );
      expect(sessionsCall).toBeDefined();
    });

    it('creates messages table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const messagesCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS messages')
      );
      expect(messagesCall).toBeDefined();
    });

    it('creates servers table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const serversCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS servers')
      );
      expect(serversCall).toBeDefined();
    });

    it('creates gateway_config table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const gatewayCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS gateway_config')
      );
      expect(gatewayCall).toBeDefined();
    });

    it('creates search_history table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const searchCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('CREATE TABLE IF NOT EXISTS search_history')
      );
      expect(searchCall).toBeDefined();
    });

    it('creates FTS tables for messages', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const ftsCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('messages_fts USING fts5')
      );
      expect(ftsCall).toBeDefined();
    });

    it('creates FTS tables for files', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const filesFtsCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('files_fts USING fts5')
      );
      expect(filesFtsCall).toBeDefined();
    });

    it('creates FTS tables for tool calls', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const toolCallsFtsCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('tool_calls_fts USING fts5')
      );
      expect(toolCallsFtsCall).toBeDefined();
    });

    it('creates triggers for FTS sync', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const triggerCalls = mockDb.exec.mock.calls.filter(
        call => call[0].includes('CREATE TRIGGER')
      );
      expect(triggerCalls.length).toBeGreaterThan(0);
    });

    it('creates indexes for performance', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const indexCalls = mockDb.exec.mock.calls.filter(
        call => call[0].includes('CREATE INDEX')
      );
      expect(indexCalls.length).toBeGreaterThan(0);
    });
  });

  describe('default data', () => {
    it('inserts default local server', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const localServerCall = mockDb.exec.mock.calls.find(
        call => call[0].includes("INSERT OR IGNORE INTO servers") &&
                call[0].includes("'local'")
      );
      expect(localServerCall).toBeDefined();
    });

    it('inserts default gateway config', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const gatewayConfigCall = mockDb.exec.mock.calls.find(
        call => call[0].includes("INSERT OR IGNORE INTO gateway_config")
      );
      expect(gatewayConfigCall).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('handles database errors gracefully', async () => {
      mockDb.exec.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const { initDatabase } = await import('../db.js');

      expect(() => initDatabase()).toThrow('Database error');
    });

    it('handles file system errors', async () => {
      const mockFs = await import('fs');
      vi.mocked(mockFs.existsSync).mockReturnValue(false);
      vi.mocked(mockFs.mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const { initDatabase } = await import('../db.js');

      expect(() => initDatabase()).toThrow('Permission denied');
    });
  });

  describe('database path', () => {
    it('uses default path in home directory', async () => {
      const mockFs = await import('fs');
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = vi.mocked(mockFs.mkdirSync).mock.calls[0];
      expect(mkdirCall[0]).toContain('.my-claudia');
    });

    it('uses custom path from environment', async () => {
      const originalEnv = process.env.MY_CLAUDIA_DATA_DIR;
      process.env.MY_CLAUDIA_DATA_DIR = '/tmp/test-claudia';

      const mockFs = await import('fs');
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      vi.resetModules();
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = vi.mocked(mockFs.mkdirSync).mock.calls[0];
      expect(mkdirCall[0]).toBe('/tmp/test-claudia');

      process.env.MY_CLAUDIA_DATA_DIR = originalEnv;
    });
  });
});
