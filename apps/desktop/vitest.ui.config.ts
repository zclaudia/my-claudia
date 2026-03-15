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
      'src/services/__tests__/agentStorage.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
    cache: {
      dir: './node_modules/.vitest-cache-ui',
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,  // 组件测试内存占用大，单进程避免 OOM
      },
    },
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
