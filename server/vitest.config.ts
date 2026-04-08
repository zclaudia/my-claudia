import net from 'node:net';
import { defineConfig } from 'vitest/config';

async function canBindLoopback(): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export default defineConfig(async () => {
  const socketTestsAvailable = await canBindLoopback();
  if (!socketTestsAvailable) {
    console.warn('[vitest] Loopback sockets unavailable, skipping route tests');
  }

  return {
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
      exclude: socketTestsAvailable ? [] : ['src/interfaces/http/__tests__/**'],
      setupFiles: ['./src/test/setup.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          // Limit concurrency to reduce fork scheduling contention.
          maxForks: 4,
        },
      },
      testTimeout: 15000,
      // Retry flaky tests once before reporting failure.
      // Root cause: vitest fork pool scheduling can delay worker init
      // causing occasional SQLite contention or timeout on first attempt.
      retry: 1,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        all: true,
        include: ['src/**/*.ts'],
        exclude: ['**/*.d.ts', 'src/index.ts', 'src/test/**', 'src/**/__tests__/**', 'src/verification/**', 'src/application/plugins/worker-runner.ts', 'src/application/plugins/mcp-bridge.ts', 'src/server.ts'],
      },
    },
  };
});
