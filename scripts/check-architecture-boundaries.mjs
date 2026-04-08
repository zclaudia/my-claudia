import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walk(relativeDir, predicate) {
  const root = path.join(repoRoot, relativeDir);
  const results = [];

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

function assertNoMatch(relativePath, pattern, message) {
  const content = read(relativePath);
  if (pattern.test(content)) {
    failures.push(`${relativePath}: ${message}`);
  }
}

function assertDesktopProviderMetaBoundaries() {
  const desktopFiles = walk(
    'apps/desktop/src',
    (relativePath) =>
      (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx'))
      && !relativePath.endsWith('/stores/projectStore.ts')
      && !relativePath.includes('/__tests__/')
      && !relativePath.includes('/test/'),
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
      assertNoMatch(relativePath, pattern, message);
    }
  }
}

function assertProjectsRoutesNoRawSql() {
  const routeFiles = walk(
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
      assertNoMatch(relativePath, pattern, message);
    }
  }
}

assertProjectsRoutesNoRawSql();
assertDesktopProviderMetaBoundaries();

if (failures.length > 0) {
  console.error('Architecture boundary checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Architecture boundary checks passed.');
