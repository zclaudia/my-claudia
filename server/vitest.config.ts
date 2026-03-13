import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/index.ts', 'src/test/**', 'src/**/__tests__/**', 'src/verification/**', 'src/plugins/worker-runner.ts', 'src/plugins/mcp-bridge.ts', 'src/server.ts'],
    },
  },
});
