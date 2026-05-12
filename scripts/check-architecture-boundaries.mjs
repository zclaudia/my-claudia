import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DESKTOP_COMPONENT_FEATURE_IMPORT_ALLOWLIST = [
  // Existing migration targets. New shared components should not depend on features.
  'apps/desktop/src/components/SettingsPanel.tsx',
  'apps/desktop/src/components/changes/SummarySection.tsx',
  'apps/desktop/src/components/draft/DraftWindow.tsx',
  'apps/desktop/src/components/fileviewer/FileViewerWindow.tsx',
  'apps/desktop/src/components/terminal/TerminalWindow.tsx',
];

const DEFAULT_DESKTOP_LEGACY_PROJECT_STORE_ALLOWLIST = [
  // Existing migration targets. New code should use selectionStore directly.
  'apps/desktop/src/features/chat/ToolCallItem.tsx',
  'apps/desktop/src/services/sessionSync.ts',
];

const DEFAULT_DESKTOP_SERVICES_FEATURE_API_REEXPORT_ALLOWLIST = [
  // Existing migration targets for phase 2 of the apps architecture cleanup.
  '../features/local-pr/api',
  '../features/workflows/api',
];

function read(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walk(repoRoot, relativeDir, predicate) {
  const root = path.join(repoRoot, relativeDir);
  const results = [];
  if (!existsSync(root)) return results;

  function visit(currentDir) {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      const relativePath = path.relative(repoRoot, fullPath).replaceAll(path.sep, '/');
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (predicate(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  visit(root);
  return results;
}

function assertNoMatch(repoRoot, failures, relativePath, pattern, message) {
  const content = read(repoRoot, relativePath);
  if (pattern.test(content)) {
    failures.push(`${relativePath}: ${message}`);
  }
}

function isSourceFile(relativePath) {
  return (
    (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx'))
    && !relativePath.includes('/__tests__/')
    && !relativePath.includes('/test/')
  );
}

function assertDesktopProviderMetaBoundaries(repoRoot, failures) {
  const desktopFiles = walk(
    repoRoot,
    'apps/desktop/src',
    (relativePath) =>
      isSourceFile(relativePath)
      && !relativePath.endsWith('/stores/projectStore.ts')
  );

  const forbiddenPatterns = [
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.providerCommands\b/s,
      message: 'Do not read providerCommands from projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.providerCapabilities\b/s,
      message: 'Do not read providerCapabilities from projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.providerCommands\b/,
      message: 'Do not read providerCommands from projectStore.getState(); use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.providerCapabilities\b/,
      message: 'Do not read providerCapabilities from projectStore.getState(); use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.setProviderCommands\b/,
      message: 'Do not write providerCommands through projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.setProviderCapabilities\b/,
      message: 'Do not write providerCapabilities through projectStore; use providerMetaStore instead.',
    },
  ];

  for (const relativePath of desktopFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

function assertDesktopSelectionStoreBoundaries(repoRoot, failures, options) {
  const allowlist = new Set(
    options.desktopLegacyProjectStoreAllowlist
    ?? DEFAULT_DESKTOP_LEGACY_PROJECT_STORE_ALLOWLIST,
  );
  const desktopFiles = walk(
    repoRoot,
    'apps/desktop/src',
    (relativePath) =>
      isSourceFile(relativePath)
      && !relativePath.endsWith('/stores/projectStore.ts')
      && !allowlist.has(relativePath),
  );
  const forbiddenPatterns = [
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.selectedProjectId\b/s,
      message: 'Do not read selectedProjectId from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.selectedSessionId\b/s,
      message: 'Do not read selectedSessionId from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.dashboardViews\b/s,
      message: 'Do not read dashboardViews from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.selectedProjectId\b/,
      message: 'Do not read selectedProjectId from projectStore.getState(); use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.selectedSessionId\b/,
      message: 'Do not read selectedSessionId from projectStore.getState(); use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.dashboardViews\b/,
      message: 'Do not read dashboardViews from projectStore.getState(); use selectionStore instead.',
    },
  ];

  for (const relativePath of desktopFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

function assertDesktopServicesApiBoundaries(repoRoot, failures, options) {
  const relativePath = 'apps/desktop/src/services/api.ts';
  if (!existsSync(path.join(repoRoot, relativePath))) return;

  const allowlist = new Set(
    options.desktopServicesFeatureApiReexportAllowlist
    ?? DEFAULT_DESKTOP_SERVICES_FEATURE_API_REEXPORT_ALLOWLIST,
  );
  const content = read(repoRoot, relativePath);
  const reExportPattern = /export\s+\*\s+from\s+['"](?<source>\.\.\/features\/[^'"]+)['"]/g;

  for (const match of content.matchAll(reExportPattern)) {
    const source = match.groups?.source;
    if (source && allowlist.has(source)) continue;
    failures.push(
      `${relativePath}: Do not re-export feature APIs from services/api; import feature APIs directly from the owning feature.`,
    );
  }
}

function assertDesktopComponentFeatureImportBoundaries(repoRoot, failures, options) {
  const allowlist = new Set(
    options.desktopComponentFeatureImportAllowlist
    ?? DEFAULT_DESKTOP_COMPONENT_FEATURE_IMPORT_ALLOWLIST,
  );
  const componentFiles = walk(
    repoRoot,
    'apps/desktop/src/components',
    (relativePath) => isSourceFile(relativePath) && !allowlist.has(relativePath),
  );

  for (const relativePath of componentFiles) {
    assertNoMatch(
      repoRoot,
      failures,
      relativePath,
      /from\s+['"][^'"]*features\//,
      'Do not import feature modules from shared components; move shared code to components, hooks, services, or utils.',
    );
  }
}

function assertProjectsRoutesNoRawSql(repoRoot, failures) {
  const routeFiles = walk(
    repoRoot,
    'server/src/domains',
    (relativePath) => relativePath.endsWith('/routes.ts'),
  );
  const forbiddenPatterns = [
    {
      pattern: /\bdb\.prepare\s*\(/,
      message: 'Do not issue raw SQL in domain routes; move persistence to repository or service.',
    },
    {
      pattern: /\bdb\.transaction\s*\(/,
      message: 'Do not issue DB transactions in domain routes; move persistence to repository or service.',
    },
  ];

  for (const relativePath of routeFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

export function runArchitectureChecks(repoRoot = process.cwd(), options = {}) {
  const failures = [];
  assertProjectsRoutesNoRawSql(repoRoot, failures);
  assertDesktopProviderMetaBoundaries(repoRoot, failures);
  assertDesktopSelectionStoreBoundaries(repoRoot, failures, options);
  assertDesktopServicesApiBoundaries(repoRoot, failures, options);
  assertDesktopComponentFeatureImportBoundaries(repoRoot, failures, options);
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = runArchitectureChecks();

  if (failures.length > 0) {
    console.error('Architecture boundary checks failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Architecture boundary checks passed.');
}
