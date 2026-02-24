#!/usr/bin/env node
/**
 * Bundle the server into a single ESM file + native module prebuilds.
 * Output goes to server/bundle/ for inclusion as Tauri resources.
 *
 * Usage:
 *   node scripts/bundle.mjs                    # bundle for current platform
 *   BUNDLE_ARCH=x64 node scripts/bundle.mjs    # override architecture
 *
 * Environment:
 *   NODE_SIDECAR_VERSION  - Node.js version for the sidecar (default: 22.14.0)
 *   BUNDLE_ARCH           - Override architecture (default: process.arch)
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

const NODE_SIDECAR_VERSION = process.env.NODE_SIDECAR_VERSION || '22.14.0';

console.log(`=== Server bundle (${platformArch}) ===`);

// --- Helpers ---

function resolvePackage(name, ...searchRoots) {
  const roots = [...searchRoots, serverRoot, repoRoot];
  for (const root of roots) {
    const p = path.join(root, 'node_modules', name);
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    }
  }
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

// ============================================================================
// Step 1: Prepare Node.js sidecar binary
// ============================================================================
// Homebrew/nvm node binaries are dynamically linked (tiny stub + dylibs),
// which won't work inside an app bundle. We download the official Node.js
// binary which is statically linked against its own V8/libuv/etc.
console.log('  [1/6] Node.js sidecar binary');

const PLATFORM_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

const NODE_PLATFORMS = {
  'darwin-arm64': { urlPart: 'darwin-arm64', ext: 'tar.gz' },
  'darwin-x64': { urlPart: 'darwin-x64', ext: 'tar.gz' },
  'linux-arm64': { urlPart: 'linux-arm64', ext: 'tar.xz' },
  'linux-x64': { urlPart: 'linux-x64', ext: 'tar.xz' },
  'win32-x64': { urlPart: 'win-x64', ext: 'zip' },
  'win32-arm64': { urlPart: 'win-arm64', ext: 'zip' },
};

const targetTriple = PLATFORM_TRIPLES[platformArch];
const nodePlatform = NODE_PLATFORMS[platformArch];

// Path to the cached standalone node binary (used for sidecar AND native module rebuild)
const cacheDir = path.resolve(repoRoot, '.cache', 'node-sidecar');
const binExt = platform === 'win32' ? '.exe' : '';
const cacheBin = path.join(cacheDir, `node-v${NODE_SIDECAR_VERSION}-${platformArch}${binExt}`);

if (targetTriple && nodePlatform) {
  // Check cache
  let needDownload = true;
  if (fs.existsSync(cacheBin)) {
    const cachedSize = fs.statSync(cacheBin).size;
    if (cachedSize > 30 * 1024 * 1024) {
      console.log(`    Using cached node v${NODE_SIDECAR_VERSION} (${(cachedSize / 1024 / 1024).toFixed(1)} MB)`);
      needDownload = false;
    } else {
      console.log(`    Cached binary too small (${(cachedSize / 1024 / 1024).toFixed(1)} MB), re-downloading...`);
      fs.unlinkSync(cacheBin);
    }
  }

  if (needDownload) {
    const { urlPart, ext: archiveExt } = nodePlatform;
    const baseName = `node-v${NODE_SIDECAR_VERSION}-${urlPart}`;
    const url = `https://nodejs.org/dist/v${NODE_SIDECAR_VERSION}/${baseName}.${archiveExt}`;
    console.log(`    Downloading node v${NODE_SIDECAR_VERSION} from ${url}...`);

    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpDir = path.join(cacheDir, 'tmp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    if (archiveExt === 'tar.gz' || archiveExt === 'tar.xz') {
      const tarFlag = archiveExt === 'tar.xz' ? 'xJf' : 'xzf';
      const archivePath = path.join(tmpDir, `${baseName}.${archiveExt}`);
      execSync(`curl -sL -o "${archivePath}" "${url}"`, { stdio: 'inherit' });
      execSync(`tar ${tarFlag} "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit' });
      fs.copyFileSync(path.join(tmpDir, baseName, 'bin', 'node'), cacheBin);
      fs.chmodSync(cacheBin, 0o755);
    } else {
      const zipPath = path.join(tmpDir, `${baseName}.zip`);
      execSync(`curl -sL -o "${zipPath}" "${url}"`, { stdio: 'inherit' });
      execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
      fs.copyFileSync(path.join(tmpDir, baseName, 'node.exe'), cacheBin);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    const dlSize = (fs.statSync(cacheBin).size / 1024 / 1024).toFixed(1);
    console.log(`    Downloaded node v${NODE_SIDECAR_VERSION} (${dlSize} MB)`);
  }

  // Copy to Tauri sidecar location
  const sidecarDir = path.resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries');
  const sidecarDest = path.join(sidecarDir, `node-${targetTriple}${binExt}`);
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.copyFileSync(cacheBin, sidecarDest);
  fs.chmodSync(sidecarDest, 0o755);

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
} else {
  console.warn(`    WARNING: Unknown platform ${platformArch}, skipping node sidecar`);
}

// ============================================================================
// Step 2: esbuild — bundle JS deps into single file
// ============================================================================
console.log('  [2/6] esbuild → bundle/server.mjs');

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

// ============================================================================
// Step 3: Copy better-sqlite3 + rebuild for sidecar Node ABI
// ============================================================================
console.log('  [3/6] Copying better-sqlite3');
{
  const pkg = resolvePackage('better-sqlite3');
  const dest = path.join(outDir, 'node_modules', 'better-sqlite3');

  copyFile(path.join(pkg, 'package.json'), path.join(dest, 'package.json'));

  copyDir(path.join(pkg, 'lib'), path.join(dest, 'lib'), (p, entry) => {
    return entry.isDirectory() || entry.name.endsWith('.js');
  });

  // Check if the .node binary was compiled for the sidecar Node version.
  // If not, rebuild it using node-gyp targeting the sidecar version.
  const systemModuleVersion = process.versions.modules; // e.g. "141" for Node 25
  const sidecarModuleVersion = execSync(`"${cacheBin}" -e "process.stdout.write(process.versions.modules)"`)
    .toString().trim();

  if (systemModuleVersion !== sidecarModuleVersion) {
    console.log(`    ABI mismatch: system=${systemModuleVersion}, sidecar=${sidecarModuleVersion}`);
    console.log(`    Rebuilding better-sqlite3 for Node ${NODE_SIDECAR_VERSION}...`);

    // Ensure node-gyp is available in a cache directory.
    // Use --userconfig=/dev/null to bypass any corporate .npmrc.
    const gypCacheDir = path.join(cacheDir, 'node-gyp-tools');
    const gypBin = path.join(gypCacheDir, 'node_modules', '.bin', 'node-gyp');
    if (!fs.existsSync(gypBin)) {
      console.log(`    Installing node-gyp...`);
      fs.mkdirSync(gypCacheDir, { recursive: true });
      execSync(
        `npm install --prefix "${gypCacheDir}" node-gyp --registry=https://registry.npmjs.org --userconfig=/dev/null`,
        { stdio: 'pipe' },
      );
      console.log(`    node-gyp installed`);
    }

    // Rebuild in the source directory using sidecar node + node-gyp.
    // node-gyp auto-downloads headers matching the running node's version.
    execSync(
      `"${cacheBin}" "${path.join(gypCacheDir, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')}" rebuild --release`,
      { stdio: 'pipe', cwd: pkg },
    );
    console.log(`    Rebuilt for NODE_MODULE_VERSION ${sidecarModuleVersion}`);
  }

  // Copy the (possibly rebuilt) .node binary
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

// ============================================================================
// Step 4: Copy node-pty (uses N-API, ABI-stable across Node versions)
// ============================================================================
console.log('  [4/6] Copying node-pty');
{
  const pkg = resolvePackage('node-pty');
  const dest = path.join(outDir, 'node_modules', 'node-pty');

  copyFile(path.join(pkg, 'package.json'), path.join(dest, 'package.json'));

  copyDir(path.join(pkg, 'lib'), path.join(dest, 'lib'), (p, entry) => {
    return entry.isDirectory() || entry.name.endsWith('.js') || entry.name.endsWith('.js.map');
  });

  const prebuildsDir = path.join(pkg, 'prebuilds', platformArch);
  if (fs.existsSync(prebuildsDir)) {
    copyDir(prebuildsDir, path.join(dest, 'prebuilds', platformArch));
    console.log(`    prebuilds/${platformArch}: OK (N-API, ABI-stable)`);
  } else {
    console.warn(`    WARNING: prebuilds/${platformArch} not found, skipping`);
  }
}

// ============================================================================
// Step 5: Copy @anthropic-ai/claude-agent-sdk
// ============================================================================
console.log('  [5/6] Copying @anthropic-ai/claude-agent-sdk');
{
  const pkg = resolvePackage('@anthropic-ai/claude-agent-sdk');
  const dest = path.join(outDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');

  for (const file of ['package.json', 'sdk.mjs', 'sdk.d.ts', 'manifest.json']) {
    const src = path.join(pkg, file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(dest, file));
    }
  }

  for (const entry of fs.readdirSync(pkg)) {
    if (entry.endsWith('.wasm')) {
      copyFile(path.join(pkg, entry), path.join(dest, entry));
    }
  }

  const sdkPlatformArch = `${arch}-${platform}`;
  const ripgrepDir = path.join(pkg, 'vendor', 'ripgrep', sdkPlatformArch);
  if (fs.existsSync(ripgrepDir)) {
    copyDir(ripgrepDir, path.join(dest, 'vendor', 'ripgrep', sdkPlatformArch));
    console.log(`    vendor/ripgrep/${sdkPlatformArch}: OK`);
  } else {
    console.warn(`    WARNING: vendor/ripgrep/${sdkPlatformArch} not found, skipping`);
  }
}

// ============================================================================
// Step 6: Verify native modules load with sidecar Node
// ============================================================================
console.log('  [6/6] Verifying native modules');
if (fs.existsSync(cacheBin)) {
  try {
    execSync(
      `"${cacheBin}" -e "require('${outDir}/node_modules/better-sqlite3')"`,
      { stdio: 'pipe' },
    );
    console.log('    better-sqlite3: OK');
  } catch (e) {
    console.error(`    better-sqlite3: FAILED - ${e.stderr?.toString().trim().split('\n')[0] || e.message}`);
    process.exit(1);
  }
} else {
  console.log('    Skipped (no sidecar binary)');
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
