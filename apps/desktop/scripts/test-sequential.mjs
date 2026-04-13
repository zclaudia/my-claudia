#!/usr/bin/env node

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const CONFIGS = [
  {
    name: 'unit',
    file: 'vitest.unit.config.ts',
    include: [
      'src/stores/**/*.test.ts',
      'src/utils/**/*.test.ts',
      'src/config/**/*.test.ts',
      'src/components/**/*.test.ts',
      'src/facade/**/*.test.ts',
      'src/hooks/transport/**/*.test.ts',
      'src/services/__tests__/api.test.ts',
      'src/services/__tests__/fileDownload.test.ts',
      'src/services/__tests__/fileUpload.test.ts',
      'src/services/__tests__/gatewayProxy.test.ts',
      'src/services/__tests__/logger.test.ts',
      'src/services/__tests__/messageHandler.test.ts',
      'src/services/__tests__/sessionSync.test.ts',
      'src/services/__tests__/toolRendererRegistry.test.ts',
      'src/plugins/__tests__/builtinPanels.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
  },
  {
    name: 'hooks',
    file: 'vitest.hooks.config.ts',
    include: [
      'src/hooks/__tests__/useAndroidBack.test.ts',
      'src/hooks/__tests__/useDataLoader.test.ts',
      'src/hooks/__tests__/useGatewayConnection.features.test.ts',
      'src/hooks/__tests__/useBackendFacade.test.ts',
      'src/hooks/__tests__/useMessagePagination.test.ts',
      'src/hooks/__tests__/useMediaQuery.test.ts',
      'src/hooks/__tests__/useMultiServerSocket.test.ts',
      'src/hooks/__tests__/useProjectManager.test.ts',
      'src/hooks/__tests__/useProviderManager.test.ts',
      'src/hooks/__tests__/useSessionManager.test.ts',
      'src/hooks/chat/__tests__/useProviderCapabilities.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
  },
  {
    name: 'ui',
    file: 'vitest.ui.config.ts',
    include: [
      'src/components/**/*.test.tsx',
      'src/contexts/**/*.test.tsx',
      'src/hooks/**/*.test.ts',
      'src/features/**/*.test.tsx',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
      'src/hooks/transport/**/*.test.ts',
      'src/hooks/__tests__/useDataLoader.test.ts',
      'src/hooks/__tests__/useAndroidBack.test.ts',
      'src/hooks/__tests__/useGatewayConnection.features.test.ts',
      'src/hooks/__tests__/useBackendFacade.test.ts',
      'src/hooks/__tests__/useMessagePagination.test.ts',
      'src/hooks/__tests__/useMediaQuery.test.ts',
      'src/hooks/__tests__/useMultiServerSocket.test.ts',
      'src/hooks/__tests__/useProjectManager.test.ts',
      'src/hooks/__tests__/useProviderManager.test.ts',
      'src/hooks/__tests__/useSessionManager.test.ts',
      'src/hooks/chat/__tests__/useProviderCapabilities.test.ts',
      'src/services/__tests__/api.test.ts',
      'src/services/__tests__/fileDownload.test.ts',
      'src/services/__tests__/fileUpload.test.ts',
      'src/services/__tests__/gatewayProxy.test.ts',
      'src/services/__tests__/logger.test.ts',
      'src/services/__tests__/messageHandler.test.ts',
      'src/services/__tests__/sessionSync.test.ts',
      'src/services/__tests__/toolRendererRegistry.test.ts',
      'src/plugins/__tests__/builtinPanels.test.ts',
      '**/ImportDialog.test.tsx',
      '**/ImportOpenCodeDialog.test.tsx',
      '**/LocalPRsPanel.test.tsx',
      'src/components/workflows/__tests__/**',
      'src/components/scheduled-tasks/__tests__/**',
      'src/components/supervision/__tests__/**',
    ],
  },
];

function normalizeArg(arg) {
  if (arg.startsWith('apps/desktop/')) {
    return arg.slice('apps/desktop/'.length);
  }

  const normalized = arg.replace(/\\/g, '/');
  const projectRootNormalized = projectRoot.replace(/\\/g, '/');

  if (normalized.startsWith(projectRootNormalized + '/')) {
    return path.relative(projectRoot, arg);
  }

  return arg;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(glob) {
  let pattern = escapeRegex(glob.replace(/\\/g, '/'));
  pattern = pattern.replace(/\*\*/g, '::DOUBLE_STAR::');
  pattern = pattern.replace(/\*/g, '[^/]*');
  pattern = pattern.replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => globToRegex(pattern).test(value));
}

function isPathFilter(arg) {
  return !arg.startsWith('-') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg);
}

function shouldRunConfig(config, pathFilters) {
  if (pathFilters.length === 0) return true;

  return pathFilters.some((filterPath) => (
    matchesAny(config.include, filterPath) && !matchesAny(config.exclude, filterPath)
  ));
}

const forwardedArgs = process.argv.slice(2).map(normalizeArg);
const pathFilters = forwardedArgs.filter(isPathFilter);
const configsToRun = CONFIGS.filter((config) => shouldRunConfig(config, pathFilters));

if (configsToRun.length === 0) {
  console.error('No matching Vitest config found for the provided filters.');
  process.exit(1);
}

for (const config of configsToRun) {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vitest', 'run', '--config', config.file, ...forwardedArgs],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
