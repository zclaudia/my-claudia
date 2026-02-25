#!/usr/bin/env node
/**
 * Bundle the server into a single ESM file + native module prebuilds.
 * Output goes to server/bundle/ for inclusion as Tauri resources.
 *
 * Uses a clean-room approach: native modules are installed fresh using the
 * sidecar Node.js binary and its bundled npm, ensuring correct ABI and no
 * dev environment contamination.
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
import { createHash } from 'crypto';

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

function readPackageVersion(name) {
  const pkg = resolvePackage(name);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  return pkgJson.version;
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

/** Find a dependency that may be hoisted or nested under a parent package. */
function findDep(modulesRoot, parentPkg, depName) {
  const nested = path.join(modulesRoot, parentPkg, 'node_modules', depName);
  if (fs.existsSync(nested)) return nested;
  const hoisted = path.join(modulesRoot, depName);
  if (fs.existsSync(hoisted)) return hoisted;
  throw new Error(`Dependency ${depName} not found (checked nested under ${parentPkg} and hoisted)`);
}

// --- Clean output ---
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// ============================================================================
// Step 1: Prepare Node.js sidecar binary + npm CLI
// ============================================================================
// Homebrew/nvm node binaries are dynamically linked (tiny stub + dylibs),
// which won't work inside an app bundle. We download the official Node.js
// binary which is statically linked against its own V8/libuv/etc.
// The tarball also contains npm, which we cache for clean-room installs.
console.log('  [1/4] Node.js sidecar binary + npm');

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

// Cache paths
const cacheDir = path.resolve(repoRoot, '.cache', 'node-sidecar');
const binExt = platform === 'win32' ? '.exe' : '';
const cacheBin = path.join(cacheDir, `node-v${NODE_SIDECAR_VERSION}-${platformArch}${binExt}`);

// npm CLI path (extracted from Node.js tarball)
const npmCacheBase = path.join(cacheDir, `npm-v${NODE_SIDECAR_VERSION}`);
const npmCli = platform === 'win32'
  ? path.join(npmCacheBase, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : path.join(npmCacheBase, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

if (targetTriple && nodePlatform) {
  // Check cache: need both node binary AND npm CLI
  let needDownload = true;
  if (fs.existsSync(cacheBin) && fs.existsSync(npmCli)) {
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
      // Cache node binary
      fs.copyFileSync(path.join(tmpDir, baseName, 'bin', 'node'), cacheBin);
      fs.chmodSync(cacheBin, 0o755);
      // Cache npm CLI
      const npmSrcDir = path.join(tmpDir, baseName, 'lib', 'node_modules', 'npm');
      if (fs.existsSync(npmSrcDir)) {
        fs.rmSync(npmCacheBase, { recursive: true, force: true });
        const npmDestDir = path.join(npmCacheBase, 'lib', 'node_modules', 'npm');
        copyDir(npmSrcDir, npmDestDir);
        console.log(`    Cached npm CLI from tarball`);
      }
    } else {
      const zipPath = path.join(tmpDir, `${baseName}.zip`);
      execSync(`curl -sL -o "${zipPath}" "${url}"`, { stdio: 'inherit' });
      execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
      // Cache node binary
      fs.copyFileSync(path.join(tmpDir, baseName, 'node.exe'), cacheBin);
      // Cache npm CLI
      const npmSrcDir = path.join(tmpDir, baseName, 'node_modules', 'npm');
      if (fs.existsSync(npmSrcDir)) {
        fs.rmSync(npmCacheBase, { recursive: true, force: true });
        const npmDestDir = path.join(npmCacheBase, 'node_modules', 'npm');
        copyDir(npmSrcDir, npmDestDir);
        console.log(`    Cached npm CLI from archive`);
      }
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
console.log('  [2/4] esbuild → bundle/server.mjs');

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
// Step 3: Clean-room npm install + selective copy to bundle
// ============================================================================
// Instead of copying native modules from the dev environment (which may have
// wrong ABI versions), we do a fresh npm install using the sidecar Node.
// This ensures prebuild-install downloads the correct prebuilt binaries
// matching the sidecar Node's ABI version.
console.log('  [3/4] Clean-room native module install');
{
  // Read exact versions from the repo's installed packages
  const EXTERNAL_DEPS = {
    'better-sqlite3': readPackageVersion('better-sqlite3'),
    'node-pty': readPackageVersion('node-pty'),
    '@anthropic-ai/claude-agent-sdk': readPackageVersion('@anthropic-ai/claude-agent-sdk'),
  };

  console.log(`    Versions: ${Object.entries(EXTERNAL_DEPS).map(([k, v]) => `${k}@${v}`).join(', ')}`);

  // Cache key: node version + platform + dependency versions
  const depsHash = createHash('md5')
    .update(JSON.stringify({ NODE_SIDECAR_VERSION, platformArch, deps: EXTERNAL_DEPS }))
    .digest('hex')
    .slice(0, 12);

  const installCacheDir = path.join(cacheDir, `install-${depsHash}`);
  const installCacheMarker = path.join(installCacheDir, '.install-complete');

  let installDir;

  if (fs.existsSync(installCacheMarker)) {
    console.log(`    Using cached install (${depsHash})`);
    installDir = installCacheDir;
  } else {
    // Clean up any previous failed install
    fs.rmSync(installCacheDir, { recursive: true, force: true });
    fs.mkdirSync(installCacheDir, { recursive: true });

    // Write minimal package.json
    fs.writeFileSync(path.join(installCacheDir, 'package.json'), JSON.stringify({
      name: 'my-claudia-server-bundle',
      private: true,
      dependencies: EXTERNAL_DEPS,
    }, null, 2));

    console.log(`    Running npm install (cache key: ${depsHash})...`);

    // Run npm install using sidecar Node + its bundled npm.
    // --omit=optional skips optional deps like @img/sharp-* from the SDK.
    // --userconfig=/dev/null bypasses any corporate .npmrc.
    // npm_config_target + npm_config_arch force node-gyp/prebuild-install to
    // compile/download for the SIDECAR node version, not the system node.
    execSync(
      `"${cacheBin}" "${npmCli}" install --omit=optional --registry=https://registry.npmjs.org --userconfig=/dev/null`,
      {
        cwd: installCacheDir,
        stdio: 'pipe',
        env: {
          ...process.env,
          npm_config_target: NODE_SIDECAR_VERSION,
          npm_config_arch: arch,
          npm_config_target_arch: arch,
        },
      },
    );

    // Mark as complete
    fs.writeFileSync(installCacheMarker, new Date().toISOString());
    installDir = installCacheDir;
    console.log(`    npm install complete`);
  }

  // --- Selective copy from install result to bundle ---
  const srcModules = path.join(installDir, 'node_modules');

  // -- better-sqlite3 --
  {
    const src = path.join(srcModules, 'better-sqlite3');
    const dest = path.join(outDir, 'node_modules', 'better-sqlite3');

    copyFile(path.join(src, 'package.json'), path.join(dest, 'package.json'));

    copyDir(path.join(src, 'lib'), path.join(dest, 'lib'), (p, entry) => {
      return entry.isDirectory() || entry.name.endsWith('.js');
    });

    // Copy .node binary (prebuild-install puts it in build/Release/ or prebuilds/)
    const buildRelease = path.join(src, 'build', 'Release', 'better_sqlite3.node');
    if (fs.existsSync(buildRelease)) {
      copyFile(buildRelease, path.join(dest, 'build', 'Release', 'better_sqlite3.node'));
    }
    const bsPrebuilds = path.join(src, 'prebuilds');
    if (fs.existsSync(bsPrebuilds)) {
      copyDir(bsPrebuilds, path.join(dest, 'prebuilds'));
    }

    // Runtime dependencies: bindings + file-uri-to-path
    const bindingsSrc = findDep(srcModules, 'better-sqlite3', 'bindings');
    const bindingsDest = path.join(dest, 'node_modules', 'bindings');
    copyFile(path.join(bindingsSrc, 'package.json'), path.join(bindingsDest, 'package.json'));
    copyFile(path.join(bindingsSrc, 'bindings.js'), path.join(bindingsDest, 'bindings.js'));

    const furiSrc = findDep(srcModules, 'better-sqlite3', 'file-uri-to-path');
    const furiDest = path.join(dest, 'node_modules', 'file-uri-to-path');
    copyFile(path.join(furiSrc, 'package.json'), path.join(furiDest, 'package.json'));
    copyFile(path.join(furiSrc, 'index.js'), path.join(furiDest, 'index.js'));

    console.log(`    better-sqlite3@${EXTERNAL_DEPS['better-sqlite3']}: OK`);
  }

  // -- node-pty --
  {
    const src = path.join(srcModules, 'node-pty');
    const dest = path.join(outDir, 'node_modules', 'node-pty');

    copyFile(path.join(src, 'package.json'), path.join(dest, 'package.json'));

    copyDir(path.join(src, 'lib'), path.join(dest, 'lib'), (p, entry) => {
      return entry.isDirectory() || entry.name.endsWith('.js') || entry.name.endsWith('.js.map');
    });

    const prebuildsDir = path.join(src, 'prebuilds', platformArch);
    if (fs.existsSync(prebuildsDir)) {
      copyDir(prebuildsDir, path.join(dest, 'prebuilds', platformArch));
      // npm strips executable permissions from prebuilt binaries during install.
      // spawn-helper must be executable for posix_spawnp to work.
      const spawnHelper = path.join(dest, 'prebuilds', platformArch, 'spawn-helper');
      if (fs.existsSync(spawnHelper)) {
        fs.chmodSync(spawnHelper, 0o755);
      }
      console.log(`    node-pty@${EXTERNAL_DEPS['node-pty']}: OK (prebuilds/${platformArch})`);
    } else {
      console.warn(`    node-pty: WARNING - prebuilds/${platformArch} not found`);
    }
  }

  // -- @anthropic-ai/claude-agent-sdk --
  {
    const src = path.join(srcModules, '@anthropic-ai', 'claude-agent-sdk');
    const dest = path.join(outDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');

    for (const file of ['package.json', 'sdk.mjs', 'sdk.d.ts', 'manifest.json', 'cli.js']) {
      const fileSrc = path.join(src, file);
      if (fs.existsSync(fileSrc)) {
        copyFile(fileSrc, path.join(dest, file));
      }
    }

    for (const entry of fs.readdirSync(src)) {
      if (entry.endsWith('.wasm')) {
        copyFile(path.join(src, entry), path.join(dest, entry));
      }
    }

    const sdkPlatformArch = `${arch}-${platform}`;
    const ripgrepDir = path.join(src, 'vendor', 'ripgrep', sdkPlatformArch);
    if (fs.existsSync(ripgrepDir)) {
      copyDir(ripgrepDir, path.join(dest, 'vendor', 'ripgrep', sdkPlatformArch));
      console.log(`    claude-agent-sdk@${EXTERNAL_DEPS['@anthropic-ai/claude-agent-sdk']}: OK (ripgrep/${sdkPlatformArch})`);
    } else {
      console.warn(`    claude-agent-sdk: WARNING - ripgrep/${sdkPlatformArch} not found`);
    }
  }
}

// ============================================================================
// Step 4: Verify native modules load with sidecar Node
// ============================================================================
console.log('  [4/4] Verifying native modules');
if (fs.existsSync(cacheBin)) {
  try {
    execSync(
      `"${cacheBin}" -e "new (require('${outDir}/node_modules/better-sqlite3'))(':memory:').close()"`,
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
