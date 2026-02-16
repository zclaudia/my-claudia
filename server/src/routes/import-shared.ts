import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';

// Expand ~ to home directory
export function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  if (filepath === '~') {
    return os.homedir();
  }
  return filepath;
}

// Check for duplicate sessions
export function checkDuplicateSession(
  db: Database.Database,
  sessionId: string,
  projectId: string
): 'exists' | 'different_project' | 'not_exists' {
  const existing = db.prepare(
    'SELECT project_id FROM sessions WHERE id = ?'
  ).get(sessionId) as { project_id: string } | undefined;

  if (!existing) return 'not_exists';
  if (existing.project_id === projectId) return 'exists';
  return 'different_project';
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ sessionId: string; error: string }>;
}

export interface ScanResult {
  projects: Array<{
    path: string;
    workspacePath?: string;
    sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      firstPrompt?: string;
      timestamp: number;
    }>;
  }>;
}
