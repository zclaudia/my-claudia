/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// UI 组件测试配置 - 使用 jsdom 环境
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'ui',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
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
      // Superseded by feature module tests in src/features/
      'src/components/workflows/__tests__/**',
      'src/components/scheduled-tasks/__tests__/**',
      'src/components/supervision/__tests__/**',
    ],
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000,
    server: {
      deps: {
        inline: [/@tauri-apps\/.*/],
      },
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**', '**/*.d.ts', 'src/main.tsx', 'src/**/__tests__/**',
        'src/hooks/useAutoUpdate.ts',
        'src/components/UpdateBanner.tsx',
        'src/components/MobileSetup.tsx',
        'src/App.tsx',
      ],
    },
  },
});
