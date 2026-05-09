/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// 纯逻辑测试配置（stores/utils/hooks）- 使用 node 环境，速度更快
export default defineConfig({
  plugins: [],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'unit',
    globals: true,
    environment: 'node',  // 不需要 jsdom，速度提升 10x
    setupFiles: ['./src/test/setup-unit.ts'],
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
      'src/services/terminal/**/*.test.ts',
      'src/plugins/__tests__/builtinPanels.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
    pool: 'forks',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary'],
      include: ['src/stores/**/*.ts', 'src/utils/**/*.ts', 'src/hooks/**/*.ts', 'src/components/**/*.ts', 'src/components/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      all: true,
    },
  },
});
