/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// 轻量 hook/context 测试配置：
// 保留 jsdom 以支持 renderHook/context，但避免加载完整 UI setup。
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
    name: 'hooks',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup-unit.ts'],
    include: [
      'src/hooks/__tests__/useAndroidBack.test.ts',
      'src/hooks/__tests__/useDataLoader.test.ts',
      'src/hooks/__tests__/useGatewayConnection.features.test.ts',
      'src/hooks/__tests__/useBackendFacade.test.ts',
      'src/hooks/__tests__/useMessagePagination.test.ts',
      'src/hooks/__tests__/useMediaQuery.test.ts',
      'src/hooks/__tests__/useMultiServerSocket.test.ts',
      'src/hooks/__tests__/useMainWindowGeometry.test.tsx',
      'src/hooks/__tests__/useProjectManager.test.ts',
      'src/hooks/__tests__/useProviderManager.test.ts',
      'src/hooks/__tests__/useSessionManager.test.ts',
      'src/hooks/chat/__tests__/useProviderCapabilities.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000,
    server: {
      deps: {
        inline: [/@tauri-apps\/.*/],
      },
    },
  },
});
