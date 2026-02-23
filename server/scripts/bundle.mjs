#!/usr/bin/env node
/**
 * Bundle the server into a single ESM file + native module prebuilds.
 * Output goes to server/bundle/ for inclusion as Tauri resources.
 *
 * Usage:
 *   node scripts/bundle.mjs                    # bundle for current platform
 *   BUNDLE_ARCH=x64 node scripts/bundle.mjs    # override architecture
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const outDir = path.resolve(serverRoot, 'bundle');

const platform = process.platform; // darwin, linux, win32
const arch = process.env.BUNDLE_ARCH || process.arch; // arm64, x64
const platformArch = `${platform}-${arch}`;

console.log(`=== Server bundle (${platformArch}) ===`);

// --- Helpers ---

function resolvePackage(name, ...searchRoots) {
  // Resolve from given roots, server node_modules, or repo node_modules
  // Also searches the pnpm virtual store for transitive deps
  const roots = [...searchRoots, serverRoot, repoRoot];
  for (const root of roots) {
    const p = path.join(root, 'node_modules', name);
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    }
  }
  // Search pnpm virtual store as fallback (for transitive deps)
  const pnpmStore = path.join(repoRoot, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmStore)) {
    const prefix = name.replace('/', '+') + '@';
    for (const entry of fs.readdirSync(pnpmStore)) {
      if (entry.startsWith(prefix)) {
        const p = path.join(pnpmStore, entry, 'node_modules', name);
        if (fs.existsSync(p)) {
          return fs.realpathSync(p);
        }
      }
    }
  }
  throw new Error(`Package not found: ${name}`);
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filter && !filter(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else {
      fs.copyFileSync(srcPath, destPath);
      // Preserve executable permissions
      const stat = fs.statSync(srcPath);
      fs.chmodSync(destPath, stat.mode);
    }
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const stat = fs.statSync(src);
  fs.chmodSync(dest, stat.mode);
}

// --- Clean output ---
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// --- 1. esbuild: bundle JS deps into single file ---
console.log('  [1/5] esbuild → bundle/server.mjs');

const entryPoint = path.join(serverRoot, 'dist', 'index.js');
if (!fs.existsSync(entryPoint)) {
  console.error(`ERROR: ${entryPoint} not found. Run "pnpm build" first.`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(outDir, 'server.mjs'),
  external: [
    'better-sqlite3',
    'node-pty',
    '@anthropic-ai/claude-agent-sdk',
    // Optional native deps of ws — work fine without them
    'bufferutil',
    'utf-8-validate',
  ],
  banner: {
    js: [
      `import { createRequire as __bundled_createRequire } from 'module';`,
      `import { fileURLToPath as __bundled_fileURLToPath } from 'url';`,
      `import { dirname as __bundled_dirname } from 'path';`,
      `const __filename = __bundled_fileURLToPath(import.meta.url);`,
      `const __dirname = __bundled_dirname(__filename);`,
      `const require = __bundled_createRequire(import.meta.url);`,
    ].join('\n'),
  },
});

// --- 2. Copy better-sqlite3 ---
console.log('  [2/5] Copying better-sqlite3');
{
  const pkg = resolvePackage('better-sqlite3');
  const dest = path.join(outDir, 'node_modules', 'better-sqlite3');

  // package.json (needed by bindings to find module root)
  copyFile(path.join(pkg, 'package.json'), path.join(dest, 'package.json'));

  // lib/ (JS files only)
  copyDir(path.join(pkg, 'lib'), path.join(dest, 'lib'), (p, entry) => {
    return entry.isDirectory() || entry.name.endsWith('.js');
  });

  // build/Release/better_sqlite3.node
  copyFile(
    path.join(pkg, 'build', 'Release', 'better_sqlite3.node'),
    path.join(dest, 'build', 'Release', 'better_sqlite3.node'),
  );

  // bindings package (dependency of better-sqlite3 for loading .node files)
  const bindingsPkg = resolvePackage('bindings');
  const bindingsDest = path.join(dest, 'node_modules', 'bindings');
  copyFile(path.join(bindingsPkg, 'package.json'), path.join(bindingsDest, 'package.json'));
  copyFile(path.join(bindingsPkg, 'bindings.js'), path.join(bindingsDest, 'bindings.js'));

  // file-uri-to-path (dependency of bindings)
  const furiPkg = resolvePackage('file-uri-to-path');
  const furiDest = path.join(dest, 'node_modules', 'file-uri-to-path');
  copyFile(path.join(furiPkg, 'package.json'), path.join(furiDest, 'package.json'));
  copyFile(path.join(furiPkg, 'index.js'), path.join(furiDest, 'index.js'));
}

// --- 3. Copy node-pty ---
console.log('  [3/5] Copying node-pty');
{
  const pkg = resolvePackage('node-pty');
  const dest = path.join(outDir, 'node_modules', 'node-pty');

  // package.json
  copyFile(path.join(pkg, 'package.json'), path.join(dest, 'package.json'));

  // lib/ (JS + map files, including subdirectories)
  copyDir(path.join(pkg, 'lib'), path.join(dest, 'lib'), (p, entry) => {
    return entry.isDirectory() || entry.name.endsWith('.js') || entry.name.endsWith('.js.map');
  });

  // prebuilds for current platform only
  const prebuildsDir = path.join(pkg, 'prebuilds', platformArch);
  if (fs.existsSync(prebuildsDir)) {
    copyDir(prebuildsDir, path.join(dest, 'prebuilds', platformArch));
    console.log(`    prebuilds/${platformArch}: OK`);
  } else {
    console.warn(`    WARNING: prebuilds/${platformArch} not found, skipping`);
  }
}

// --- 4. Copy @anthropic-ai/claude-agent-sdk ---
console.log('  [4/5] Copying @anthropic-ai/claude-agent-sdk');
{
  const pkg = resolvePackage('@anthropic-ai/claude-agent-sdk');
  const dest = path.join(outDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');

  // Core files
  for (const file of ['package.json', 'sdk.mjs', 'sdk.d.ts', 'manifest.json']) {
    const src = path.join(pkg, file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(dest, file));
    }
  }

  // .wasm files
  for (const entry of fs.readdirSync(pkg)) {
    if (entry.endsWith('.wasm')) {
      copyFile(path.join(pkg, entry), path.join(dest, entry));
    }
  }

  // vendor/ripgrep for current platform
  // claude-agent-sdk uses {arch}-{platform} format (e.g., arm64-darwin)
  const sdkPlatformArch = `${arch}-${platform}`;
  const ripgrepDir = path.join(pkg, 'vendor', 'ripgrep', sdkPlatformArch);
  if (fs.existsSync(ripgrepDir)) {
    copyDir(ripgrepDir, path.join(dest, 'vendor', 'ripgrep', sdkPlatformArch));
    console.log(`    vendor/ripgrep/${sdkPlatformArch}: OK`);
  } else {
    console.warn(`    WARNING: vendor/ripgrep/${sdkPlatformArch} not found, skipping`);
  }
}

// --- 5. Copy node binary to Tauri sidecar directory ---
console.log('  [5/5] Copying node binary (sidecar)');
{
  // Tauri sidecar naming convention: binaries/<name>-<rust-target-triple>
  const PLATFORM_TRIPLES = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
  };

  const targetTriple = PLATFORM_TRIPLES[platformArch];
  if (!targetTriple) {
    console.warn(`    WARNING: Unknown platform ${platformArch}, skipping node sidecar`);
  } else {
    const nodeBin = fs.realpathSync(process.execPath);
    const ext = platform === 'win32' ? '.exe' : '';
    const sidecarDir = path.resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries');
    const sidecarDest = path.join(sidecarDir, `node-${targetTriple}${ext}`);

    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.copyFileSync(nodeBin, sidecarDest);
    fs.chmodSync(sidecarDest, 0o755);

    // On macOS, strip the original code signature and re-sign with ad-hoc signature.
    // This prevents Gatekeeper from rejecting the binary when it's inside the app bundle.
    if (platform === 'darwin') {
      try {
        execSync(`codesign --remove-signature "${sidecarDest}"`, { stdio: 'pipe' });
        execSync(`codesign --force --sign - "${sidecarDest}"`, { stdio: 'pipe' });
        console.log(`    Re-signed with ad-hoc signature`);
      } catch (e) {
        console.warn(`    WARNING: Failed to re-sign sidecar: ${e.message}`);
      }
    }

    const sizeMB = (fs.statSync(sidecarDest).size / 1024 / 1024).toFixed(1);
    console.log(`    ${path.basename(sidecarDest)}: ${sizeMB} MB`);
  }
}

// --- Summary ---
const totalSize = getTotalSize(outDir);
console.log('');
console.log(`=== Bundle complete ===`);
console.log(`  Output: ${outDir}`);
console.log(`  Size:   ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

function getTotalSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getTotalSize(p);
    } else {
      total += fs.statSync(p).size;
    }
  }
  return total;
}
