/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.APP_VERSION ||
      (process.env.TAURI_CONFIG ? JSON.parse(process.env.TAURI_CONFIG).version : null) ||
      pkg.version
    ),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tauri-apps')) return 'vendor-tauri';
            if (id.includes('react-syntax-highlighter') || id.includes('/prismjs/') || id.includes('/refractor/')) {
              return 'vendor-code';
            }
            if (
              id.includes('react-markdown')
              || id.includes('remark-gfm')
              || id.includes('/micromark')
              || id.includes('/mdast')
              || id.includes('/hast')
              || id.includes('/unist')
            ) {
              return 'vendor-markdown';
            }
            if (id.includes('@xterm')) return 'vendor-xterm';
            if (id.includes('@xyflow')) return 'vendor-flow';
            if (id.includes('react') || id.includes('zustand')) return 'vendor-react';
          }

          if (
            id.includes('/src/components/chat/')
            || id.includes('/src/components/fileviewer/')
            || id.includes('/src/components/supervision/')
          ) {
            return 'feature-interactive';
          }
          if (id.includes('/src/components/workflows/')) return 'feature-workflows';
          if (id.includes('/src/components/local-prs/')) return 'feature-local-prs';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        // Allow vitest to mock these Tauri-specific packages that aren't installed
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
        // Tauri-only files — use @tauri-apps/plugin-updater or @tauri-apps/plugin-process
        // which are not installed as npm deps (only available in Tauri runtime)
        'src/hooks/useAutoUpdate.ts',
        'src/components/UpdateBanner.tsx',
        'src/components/MobileSetup.tsx',
        'src/App.tsx',
      ],
    },
  },
});
