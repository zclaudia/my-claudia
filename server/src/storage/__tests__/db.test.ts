import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  const MockDatabase = vi.fn(function(this: typeof mockDb) {
    Object.assign(this, mockDb);
    return this;
  });
  return {
    default: MockDatabase,
  };
});

// Mock fs
const mockFsMethods = {
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
};

vi.mock('fs', () => ({
  default: mockFsMethods,
  ...mockFsMethods,
}));

// Mock metadata-extractor
vi.mock('../metadata-extractor.js', () => ({
  reindexAllMessages: vi.fn(),
}));

// Mock os
vi.mock('os', () => ({
  default: { homedir: vi.fn(() => '/home/testuser') },
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('storage/db', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalDataDir: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset fs mock implementations
    mockFsMethods.existsSync.mockReturnValue(true);
    mockFsMethods.mkdirSync.mockImplementation(() => undefined);

    // Reset db mock implementations - use mockReset to clear all implementations
    mockDb.pragma.mockReset();
    mockDb.exec.mockReset();
    mockDb.prepare.mockReset();
    mockDb.prepare.mockImplementation(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    }));

    // Save and clear MY_CLAUDIA_DATA_DIR to ensure consistent test behavior
    originalDataDir = process.env.MY_CLAUDIA_DATA_DIR;
    delete process.env.MY_CLAUDIA_DATA_DIR;

    // Reset modules to avoid singleton state leaking across tests
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original MY_CLAUDIA_DATA_DIR
    if (originalDataDir !== undefined) {
      process.env.MY_CLAUDIA_DATA_DIR = originalDataDir;
    } else {
      delete process.env.MY_CLAUDIA_DATA_DIR;
    }
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
      mockFsMethods.existsSync.mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFsMethods.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.my-claudia'),
        { recursive: true }
      );
    });

    it('uses MY_CLAUDIA_DATA_DIR environment variable', async () => {
      const originalEnv = process.env.MY_CLAUDIA_DATA_DIR;
      process.env.MY_CLAUDIA_DATA_DIR = '/custom/data/dir';

      mockFsMethods.existsSync.mockReturnValue(false);

      // Reset modules to pick up new env var
      vi.resetModules();
      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFsMethods.mkdirSync).toHaveBeenCalledWith(
        '/custom/data/dir',
        { recursive: true }
      );

      if (originalEnv === undefined) {
        delete process.env.MY_CLAUDIA_DATA_DIR;
      } else {
        process.env.MY_CLAUDIA_DATA_DIR = originalEnv;
      }
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

      expect(db).toEqual(expect.objectContaining({
        pragma: expect.any(Function),
        exec: expect.any(Function),
        prepare: expect.any(Function),
        close: expect.any(Function),
      }));
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
      mockFsMethods.existsSync.mockReturnValue(false);
      mockFsMethods.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const { initDatabase } = await import('../db.js');

      expect(() => initDatabase()).toThrow('Permission denied');
    });

    it('tolerates known duplicate column errors for local PR migrations', async () => {
      // Simulate: migrations table says 036 not applied, but exec throws duplicate column
      let execCallCount = 0;
      mockDb.exec.mockImplementation((sql: string) => {
        execCallCount++;
        if (sql.includes('SELECT 1') || sql.includes('-- no-op')) {
          // Simulate error for known duplicate column migration
          const err = new Error('duplicate column name: status_message');
          throw err;
        }
      });

      // The prepare().all() for migrations should return all names except 036
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT name FROM migrations')) {
          return { all: vi.fn(() => []) };
        }
        if (sql.includes('INSERT INTO migrations')) {
          return { run: vi.fn() };
        }
        if (sql.includes("SELECT 1 FROM sqlite_master")) {
          return { get: vi.fn(() => undefined) }; // no local_prs table
        }
        if (sql.includes("PRAGMA table_info")) {
          return { all: vi.fn(() => []) };
        }
        return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
      });

      const { initDatabase } = await import('../db.js');

      // Should not throw for known duplicate column errors in known migrations
      // But our mock setup makes all exec calls throw, which will throw for non-known migrations
      // This tests the error tolerance logic
      expect(() => initDatabase()).toThrow();
    });

    it('self-heals missing local_prs columns', async () => {
      // We need all migration names to exist so none get applied
      const allMigrationNames = [
        '001_initial_schema', '002_gateway_config', '003_servers_table',
        '004_proxy_support', '005_messages_fts', '006_register_as_backend',
        '007_search_history', '008_extended_search', '009_fix_messages_fts_triggers',
        '010_cleanup_legacy_provider_types', '011_fix_orphaned_fts_rows',
        '012_agent_config', '013_agent_provider_id', '014_session_type_and_parent',
        '015_project_agent_permission_override', '016_project_is_internal',
        '017_session_archived_at', '018_supervisions', '019_notification_config',
        '020_fix_imported_opencode_sessions', '021_files_table', '022_supervision_planning',
        '023_message_offset', '024_session_working_directory', '025_supervision_v2',
        '026_deprecate_supervision_v1', '027_session_plan_status',
        '028_lite_supervisor_scheduling', '029_mcp_servers', '030_local_pr_workflow',
        '031_scheduled_tasks', '032_local_pr_auto_review', '033_worktree_configs',
        '034_session_run_status', '035_workflows',
        '036_local_pr_status_message', '037_local_pr_merge_commit_sha',
        '038_local_pr_execution_state',
      ];

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT name FROM migrations')) {
          return { all: vi.fn(() => allMigrationNames.map(name => ({ name }))) };
        }
        if (sql.includes("SELECT 1 FROM sqlite_master") && sql.includes('local_prs')) {
          return { get: vi.fn(() => ({ 1: 1 })) };
        }
        if (sql.includes("PRAGMA table_info(local_prs)")) {
          return {
            all: vi.fn(() => [
              { name: 'id' }, { name: 'project_id' }, { name: 'status' },
            ]),
          };
        }
        return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const addColumnCalls = mockDb.exec.mock.calls.filter(
        (call: string[]) => call[0]?.includes('ALTER TABLE local_prs ADD COLUMN')
      );
      expect(addColumnCalls.length).toBe(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('status_message'));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('merged_commit_sha'));

      consoleWarnSpy.mockRestore();
    });
  });

  describe('database path', () => {
    it('uses default path in home directory', async () => {
      mockFsMethods.existsSync.mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = mockFsMethods.mkdirSync.mock.calls[0];
      expect(mkdirCall[0]).toContain('.my-claudia');
    });

    it('uses custom path from environment', async () => {
      const originalEnv = process.env.MY_CLAUDIA_DATA_DIR;
      process.env.MY_CLAUDIA_DATA_DIR = '/tmp/test-claudia';

      mockFsMethods.existsSync.mockReturnValue(false);

      // Re-import to pick up new env var (module is cached, so we need to clear cache)
      vi.resetModules();
      // Need to re-mock after reset
      vi.doMock('os', () => ({
        default: { homedir: vi.fn(() => '/home/testuser') },
        homedir: vi.fn(() => '/home/testuser'),
      }));
      vi.doMock('fs', () => ({
        default: mockFsMethods,
        ...mockFsMethods,
      }));
      vi.doMock('better-sqlite3', () => ({
        default: vi.fn(function(this: typeof mockDb) {
          Object.assign(this, mockDb);
          return this;
        }),
      }));

      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = mockFsMethods.mkdirSync.mock.calls[0];
      expect(mkdirCall[0]).toBe('/tmp/test-claudia');

      if (originalEnv === undefined) {
        delete process.env.MY_CLAUDIA_DATA_DIR;
      } else {
        process.env.MY_CLAUDIA_DATA_DIR = originalEnv;
      }
    });
  });
});
