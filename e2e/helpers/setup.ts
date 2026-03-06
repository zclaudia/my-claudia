/**
 * Test setup utilities for E2E tests
 *
 * Replaces Playwright's test.extend<{...}> fixture system with
 * standalone setup functions compatible with Vitest beforeEach/afterEach.
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.my-claudia', 'data.db');
const AUTH_PATH = path.join(os.homedir(), '.my-claudia', 'auth.json');

// ─── API Client Interfaces ──────────────────────────────────

export interface ApiClient {
  fetch(path: string, options?: RequestInit): Promise<Response>;
}

export interface GatewayApiClient extends ApiClient {
  backendId: string;
}

// ─── Setup Functions ─────────────────────────────────────────

/**
 * Clean test data from SQLite database.
 * Deletes records with 'test-' prefix from messages, sessions, projects.
 */
export async function setupCleanDB(): Promise<void> {
  try {
    const db = new Database(DB_PATH);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    if (tableNames.includes('messages')) {
      db.exec(`DELETE FROM messages WHERE session_id LIKE 'test-%'`);
    }
    if (tableNames.includes('sessions')) {
      db.exec(`DELETE FROM sessions WHERE id LIKE 'test-%'`);
    }
    if (tableNames.includes('projects')) {
      db.exec(`UPDATE projects SET agent = NULL WHERE id LIKE 'test-%'`);
      db.exec(`DELETE FROM projects WHERE id LIKE 'test-%'`);
    }
    if (tableNames.includes('supervision_tasks')) {
      db.exec(`DELETE FROM supervision_tasks WHERE project_id LIKE 'test-%'`);
    }
    if (tableNames.includes('supervision_v2_logs')) {
      db.exec(`DELETE FROM supervision_v2_logs WHERE project_id LIKE 'test-%'`);
    }

    db.close();
  } catch (error) {
    console.warn('Database cleanup skipped:', error);
  }
}

/**
 * Create an isolated test project in the database.
 * Returns the project ID.
 */
export async function setupTestProject(): Promise<string> {
  const db = new Database(DB_PATH);
  const projectId = 'test-project-' + Date.now();

  db.prepare(`
    INSERT INTO projects (id, name, root_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, 'Test Project', '/test/path', Date.now(), Date.now());

  db.close();
  return projectId;
}

/**
 * Read API key from auth.json
 */
export function readApiKey(): string {
  const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
  return config.apiKey as string;
}

/**
 * Create a REST client for the backend server (localhost:3100)
 */
export function createApiClient(apiKey: string): ApiClient {
  return {
    async fetch(apiPath: string, options?: RequestInit) {
      return globalThis.fetch(`http://localhost:3100${apiPath}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...options?.headers,
        },
      });
    },
  };
}

/**
 * Create a REST client through the gateway proxy (localhost:3200).
 * Polls until the backend registers with the gateway.
 */
export async function createGatewayApiClient(apiKey: string): Promise<GatewayApiClient> {
  let backendId: string | null = null;

  for (let i = 0; i < 30; i++) {
    try {
      const resp = await globalThis.fetch('http://localhost:3100/api/server/gateway/status');
      const data = await resp.json();
      if (data.data?.backendId) {
        backendId = data.data.backendId;
        break;
      }
    } catch {
      // Gateway not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!backendId) throw new Error('Gateway backend not registered after 30s');

  return {
    backendId,
    async fetch(apiPath: string, options?: RequestInit) {
      return globalThis.fetch(`http://localhost:3200/api/proxy/${backendId}${apiPath}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer test-secret-my-claudia-2026:${apiKey}`,
          ...options?.headers,
        },
      });
    },
  };
}
