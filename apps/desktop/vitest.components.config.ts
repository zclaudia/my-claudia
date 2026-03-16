/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// 组件测试专用配置 - 使用 jsdom 环境
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
    name: 'components',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup-components.ts'],
    include: ['src/components/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/src-tauri/**',
    ],
    cache: {
      dir: './node_modules/.vitest-cache-components',
    },
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary'],
      include: ['src/components/**/*.ts', 'src/components/**/*.tsx'],
      exclude: ['src/components/**/*.test.ts', 'src/components/**/*.test.tsx', 'src/**/*.d.ts'],
      all: true,
    },
  },
});
