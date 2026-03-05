import Database from 'better-sqlite3';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

/**
 * Setup a clean database for testing
 * This function clears all tables to ensure a clean state for each test
 */
export async function setupCleanDB(): Promise<void> {
  // Use a temporary test database
  const testDbPath = join(tmpdir(), 'my-claudia-test.db');

  try {
    const db = new Database(testDbPath);

    // Disable foreign key checks temporarily
    db.exec('PRAGMA foreign_keys = OFF');

    // Clear all tables
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM session_messages;
      DELETE FROM projects;
      DELETE FROM providers;
      DELETE FROM servers;
      DELETE FROM settings;
      DELETE FROM permissions;
      DELETE FROM file_references;
      DELETE FROM cached_responses;
    `);

    // Re-enable foreign key checks
    db.exec('PRAGMA foreign_keys = ON');

    // Close database connection
    db.close();

    console.log('✓ Database cleaned successfully');
  } catch (error) {
    console.error('Error cleaning database:', error);
    throw error;
  }
}

/**
 * Seed database with test data
 * Use this to populate the database with known test data
 */
export async function seedTestData(): Promise<void> {
  const testDbPath = join(tmpdir(), 'my-claudia-test.db');

  try {
    const db = new Database(testDbPath);

    // Insert test projects
    db.exec(`
      INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
      VALUES
        ('test-project-1', 'Test Project 1', 'code', '/tmp/test-project-1', datetime('now'), datetime('now')),
        ('test-project-2', 'Test Project 2', 'code', '/tmp/test-project-2', datetime('now'), datetime('now'));
    `);

    // Insert test providers
    db.exec(`
      INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
      VALUES
        ('test-provider-1', 'Claude', 'claude', 1, datetime('now'), datetime('now')),
        ('test-provider-2', 'OpenAI', 'openai', 0, datetime('now'), datetime('now'));
    `);

    // Insert test servers
    db.exec(`
      INSERT INTO servers (id, name, url, type, created_at, updated_at)
      VALUES
        ('test-server-1', 'Local Server', 'http://localhost:1420', 'local', datetime('now'), datetime('now'));
    `);

    db.close();

    console.log('✓ Test data seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

/**
 * Create a fresh database with schema
 * Use this for initial setup or complete reset
 */
export async function createFreshDB(): Promise<void> {
  const testDbPath = join(tmpdir(), 'my-claudia-test.db');

  try {
    // Delete existing test database
    await execAsync(`rm -f "${testDbPath}"`);

    const db = new Database(testDbPath);

    // Create schema
    db.exec(`
      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        root_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Providers table
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Servers table
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        provider_id TEXT,
        server_id TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (provider_id) REFERENCES providers(id),
        FOREIGN KEY (server_id) REFERENCES servers(id)
      );

      -- Session messages table
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Settings table
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Permissions table
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        granted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- File references table
      CREATE TABLE IF NOT EXISTS file_references (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Cached responses table
      CREATE TABLE IF NOT EXISTS cached_responses (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL UNIQUE,
        response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON session_messages(session_id);
    `);

    db.close();

    console.log('✓ Fresh database created with schema');
  } catch (error) {
    console.error('Error creating fresh database:', error);
    throw error;
  }
}
