/**
 * Provider initialization — auto-detection, version checks, and shutdown.
 *
 * Extracted from index.ts to keep the process entry point slim and
 * keep all provider lifecycle logic inside the providers/ domain.
 */

import type Database from 'better-sqlite3';
import { detectCliProvidersSync } from '../../utils/cli-detect.js';
import { checkVersionCompatibility, cleanupOldTempFiles } from './claude-sdk.js';
import { checkSdkVersions } from '../../utils/sdk-version-check.js';
import { openCodeServerManager } from './opencode-sdk.js';
import { destroyAllAppServerClients } from './codex-app-server.js';
import { systemTaskRegistry } from '../../application/services/system-task-registry.js';

let tempFileCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * If no providers exist in the database, probe the local system for known
 * CLI tools (claude, openclaude, opencode, codex, cursor, kimi) and insert them.
 */
export function autoDetectProviders(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM providers LIMIT 1').get() as { id: string } | undefined;
  if (existing) return;

  console.log('\n🔍 No providers found, auto-detecting CLI...');

  const detectedClis = detectCliProvidersSync();
  if (detectedClis.length === 0) {
    console.log('   No CLI detected. Install claude or opencode to get started.');
    return;
  }

  const now = Date.now();
  let claudeId: string | null = null;

  for (const cli of detectedClis) {
    const id = crypto.randomUUID();
    const isDefault = cli.type === 'claude';

    db.prepare(`
      INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, cli.name, cli.type, cli.cliPath, isDefault ? 1 : 0, now, now);

    console.log(`   ✅ Added provider: ${cli.name} (${cli.cliPath})`);

    if (cli.type === 'claude') {
      claudeId = id;
    }
  }

  if (claudeId) {
    console.log(`   🌟 Default provider set to: Claude Code`);
  } else if (detectedClis.length > 0) {
    console.log(`   🌟 Default provider set to: ${detectedClis[0].name}`);
  }
}

/**
 * Start periodic temp file cleanup (moved from claude-sdk.ts to avoid module-level side effects).
 */
export function startTempFileCleanup(): void {
  cleanupOldTempFiles();
  systemTaskRegistry.register({
    id: 'system:temp_file_cleanup',
    name: 'Temp File Cleanup',
    description: 'Cleans old temporary upload files',
    category: 'maintenance',
    intervalMs: 30 * 60 * 1000,
  });
  tempFileCleanupTimer = setInterval(() => {
    systemTaskRegistry.markRunStart('system:temp_file_cleanup');
    const start = Date.now();
    try {
      cleanupOldTempFiles();
      systemTaskRegistry.markRunComplete('system:temp_file_cleanup', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:temp_file_cleanup', Date.now() - start, String(err));
    }
  }, 30 * 60 * 1000);
  tempFileCleanupTimer.unref();
}

/**
 * Run non-blocking version compatibility and SDK freshness checks.
 */
export function checkProviderVersions(): void {
  checkVersionCompatibility().catch(() => {});
  checkSdkVersions().then(report => {
    for (const sdk of report.sdks) {
      if (sdk.outdated) {
        console.warn(`⚠️  [SDK Update] ${sdk.name}: ${sdk.current} → ${sdk.latest}`);
      } else {
        console.log(`[SDK Check] ${sdk.name}: ${sdk.current} (up to date)`);
      }
    }
  }).catch(() => {});
}

/**
 * Gracefully stop all managed provider sub-processes.
 */
export async function shutdownProviders(): Promise<void> {
  if (tempFileCleanupTimer) {
    clearInterval(tempFileCleanupTimer);
    tempFileCleanupTimer = null;
  }
  await openCodeServerManager.stopAll();
  destroyAllAppServerClients();
}
