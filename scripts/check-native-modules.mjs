#!/usr/bin/env node
/**
 * Quick ABI compatibility check for native modules.
 *
 * Exits 0 if all native modules load successfully (or aren't installed yet).
 * Exits 1 if any module fails with ERR_DLOPEN_FAILED (ABI mismatch).
 *
 * When run as postinstall (interactive shell), auto-rebuilds on mismatch.
 * When run from the Tauri sidecar (minimal env), reports the issue and exits 1
 * so the caller can display a helpful message.
 *
 * Usage (in package.json):
 *   "postinstall": "node scripts/check-native-modules.mjs"
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);

const modules = ['better-sqlite3'];

let needsRebuild = false;

for (const mod of modules) {
  try {
    require(mod);
  } catch (e) {
    if (e.code === 'ERR_DLOPEN_FAILED') {
      needsRebuild = true;
    }
  }
}

if (needsRebuild) {
  let hasPnpm = false;
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    hasPnpm = true;
  } catch { /* pnpm not in PATH (e.g. Tauri sidecar env) */ }

  if (hasPnpm) {
    console.log('\x1b[33m⚠ Native modules need rebuild — running pnpm rebuild...\x1b[0m');
    try {
      execSync('pnpm rebuild', { stdio: 'inherit' });
      console.log('\x1b[32m✓ Native modules rebuilt successfully\x1b[0m');
    } catch {
      console.error('\x1b[31m✗ Failed to rebuild native modules. Try: pnpm rebuild\x1b[0m');
      process.exit(1);
    }
  } else {
    console.error('\x1b[31m✗ Native module ABI mismatch. Run: pnpm rebuild better-sqlite3\x1b[0m');
    process.exit(1);
  }
}
