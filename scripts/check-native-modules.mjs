#!/usr/bin/env node
/**
 * Quick ABI compatibility check for native modules.
 *
 * Exits 0 if all native modules load successfully (or aren't installed yet).
 * Exits 1 if any module fails with ERR_DLOPEN_FAILED (ABI mismatch),
 * which signals the caller to run `pnpm rebuild`.
 *
 * Usage (in package.json):
 *   "postinstall": "node scripts/check-native-modules.mjs"
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const modules = ['better-sqlite3'];

let needsRebuild = false;

for (const mod of modules) {
  try {
    require(mod);
  } catch (e) {
    if (e.code === 'ERR_DLOPEN_FAILED') {
      console.log(`\x1b[33m⚠ ${mod} was compiled for a different Node.js ABI — rebuilding...\x1b[0m`);
      needsRebuild = true;
    }
    // Other errors (MODULE_NOT_FOUND during fresh install) are fine
  }
}

if (needsRebuild) {
  const { execSync } = await import('child_process');
  try {
    execSync('pnpm rebuild', { stdio: 'inherit' });
    console.log('\x1b[32m✓ Native modules rebuilt successfully\x1b[0m');
  } catch {
    console.error('\x1b[31m✗ Failed to rebuild native modules. Try: pnpm rebuild\x1b[0m');
    process.exit(1);
  }
}
