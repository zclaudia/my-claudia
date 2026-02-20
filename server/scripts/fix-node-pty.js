/**
 * Fix node-pty spawn-helper permissions on macOS.
 *
 * pnpm hard-links files from its content-addressable store, which can strip
 * the execute bit from binaries like node-pty's spawn-helper.  Without +x the
 * PTY spawn fails with "posix_spawnp failed".
 *
 * This script is referenced by the "postinstall" entry in package.json so it
 * runs automatically after every `pnpm install`.
 */

import { existsSync, chmodSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

// Possible spawn-helper locations (relative to monorepo root)
const candidates = [
  'node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  'node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
];

let fixed = 0;

for (const pattern of candidates) {
  try {
    // Use a simple glob via the shell — works on macOS and Linux
    const matches = execSync(`ls ${resolve(root, pattern)} 2>/dev/null`, {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    for (const file of matches) {
      if (!existsSync(file)) continue;
      const stat = statSync(file);
      const isExecutable = (stat.mode & 0o111) !== 0;
      if (!isExecutable) {
        chmodSync(file, stat.mode | 0o755);
        fixed++;
        console.log(`[fix-node-pty] chmod +x ${file}`);
      }
    }
  } catch {
    // Pattern didn't match — that's fine (e.g. on Linux we won't have darwin paths)
  }
}

if (fixed > 0) {
  console.log(`[fix-node-pty] Fixed ${fixed} spawn-helper file(s).`);
} else {
  console.log('[fix-node-pty] No spawn-helper permission issues found.');
}
