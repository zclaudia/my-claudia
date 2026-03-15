/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// 覆盖率测试专用配置
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
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    
    // 减少并发以稳定运行
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    
    // 增加超时
    testTimeout: 30000,
    hookTimeout: 30000,
    
    server: {
      deps: {
        inline: [/@tauri-apps\/.*/],
      },
    },
    
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary', 'json', 'html'],
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**', 
        '**/*.d.ts', 
        'src/main.tsx', 
        'src/**/__tests__/**',
        'src/hooks/useAutoUpdate.ts',
        'src/components/UpdateBanner.tsx',
        'src/components/MobileSetup.tsx',
        'src/App.tsx',
      ],
    },
  },
});
