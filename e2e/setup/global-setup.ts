/**
 * Global Setup - Multi-service startup for E2E tests
 *
 * Replaces playwright.config.ts webServer configuration.
 * Starts gateway → server → desktop in order, waits for ports to be ready.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import * as path from 'path';
import * as fs from 'fs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const E2E_DATA_DIR = path.join(ROOT_DIR, '.tmp', 'e2e-data');
const E2E_GATEWAY_PORT = 3320;
const E2E_SERVER_PORT = 3310;
const E2E_DESKTOP_PORT = 1421;

interface ServiceConfig {
  name: string;
  command: string[];
  cwd: string;
  port: number;
  timeout: number;
  env?: Record<string, string>;
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'Gateway',
    command: ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'node', 'dist/index.js'],
    cwd: path.join(ROOT_DIR, 'gateway'),
    port: E2E_GATEWAY_PORT,
    timeout: 120000,
    env: {
      GATEWAY_PORT: String(E2E_GATEWAY_PORT),
      GATEWAY_SECRET: 'test-secret-my-claudia-2026',
      MY_CLAUDIA_DATA_DIR: E2E_DATA_DIR,
    },
  },
  {
    name: 'Server',
    command: ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'node', 'dist/index.js'],
    cwd: path.join(ROOT_DIR, 'server'),
    port: E2E_SERVER_PORT,
    timeout: 120000,
    env: {
      PORT: String(E2E_SERVER_PORT),
      GATEWAY_URL: `ws://localhost:${E2E_GATEWAY_PORT}`,
      GATEWAY_SECRET: 'test-secret-my-claudia-2026',
      GATEWAY_NAME: 'TestBackend',
      MY_CLAUDIA_DATA_DIR: E2E_DATA_DIR,
    },
  },
  {
    name: 'Desktop',
    command: ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'pnpm', 'exec', 'vite'],
    cwd: path.join(ROOT_DIR, 'apps/desktop'),
    port: E2E_DESKTOP_PORT,
    timeout: 120000,
    env: {
      VITE_DEV_SERVER_PORT: String(E2E_DESKTOP_PORT),
      VITE_LOCAL_SERVER_PORT: String(E2E_SERVER_PORT),
    },
  },
];

const processes: ChildProcess[] = [];

function runSetupCommand(name: string, args: string[], cwd = ROOT_DIR): void {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env: process.env,
    stdio: 'pipe',
    shell: false,
    encoding: 'utf8',
  });

  if (result.status === 0) return;

  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  throw new Error(
    `[Setup] ${name} failed with code ${result.status ?? 'unknown'}`
    + (stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : '')
  );
}

/**
 * Check if a port is already in use (service already running)
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    // Try localhost (resolves to both IPv4 and IPv6) instead of 127.0.0.1
    const conn = createConnection({ port, host: 'localhost' });
    conn.on('connect', () => {
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Wait for a port to become available
 */
async function waitForPort(port: number, timeout: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await isPortInUse(port)) {
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Port ${port} did not become available within ${timeout}ms`);
}

/**
 * Start a service as a child process
 */
function startService(config: ServiceConfig): ChildProcess {
  const [cmd, ...args] = config.command;
  const child = spawn(cmd, args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env,
    },
    stdio: 'pipe',
    shell: false,
  });

  child.stdout?.on('data', (data) => {
    if (process.env.DEBUG) {
      console.log(`[${config.name}] ${data.toString().trim()}`);
    }
  });

  child.stderr?.on('data', (data) => {
    console.error(`[${config.name}] ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    console.error(`[${config.name}] Process error:`, err);
  });

  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[${config.name}] exited with code ${code}`);
      return;
    }
    if (signal) {
      console.error(`[${config.name}] exited via signal ${signal}`);
    }
  });

  return child;
}

/**
 * Vitest globalSetup entry point
 */
export async function setup() {
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  process.env.MY_CLAUDIA_DATA_DIR = E2E_DATA_DIR;
  process.env.E2E_GATEWAY_PORT = String(E2E_GATEWAY_PORT);
  process.env.E2E_SERVER_PORT = String(E2E_SERVER_PORT);
  process.env.E2E_DESKTOP_PORT = String(E2E_DESKTOP_PORT);
  process.env.E2E_SERVER_URL = `http://localhost:${E2E_SERVER_PORT}`;
  process.env.E2E_GATEWAY_URL = `http://localhost:${E2E_GATEWAY_PORT}`;
  process.env.E2E_BASE_URL = `http://localhost:${E2E_DESKTOP_PORT}`;
  const skipDesktop = process.env.E2E_SKIP_DESKTOP === '1';

  console.log('[Setup] Building shared, gateway, and server artifacts for E2E...');
  runSetupCommand('shared build', ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'pnpm', '--filter', '@my-claudia/shared', 'build']);
  runSetupCommand('gateway build', ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'pnpm', '--filter', '@my-claudia/gateway', 'build']);
  runSetupCommand('server build', ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'pnpm', '--filter', '@my-claudia/server', 'build']);

  const reuseExisting = !process.env.CI;

  for (const service of SERVICES) {
    if (skipDesktop && service.name === 'Desktop') {
      console.log('[Setup] Skipping Desktop startup (E2E_SKIP_DESKTOP=1)');
      continue;
    }

    const alreadyRunning = await isPortInUse(service.port);

    if (alreadyRunning && reuseExisting) {
      console.log(`[Setup] ${service.name} already running on port ${service.port}, reusing`);
      continue;
    }

    if (alreadyRunning && !reuseExisting) {
      console.warn(`[Setup] Port ${service.port} is in use but CI mode requires fresh servers`);
    }

    console.log(`[Setup] Starting ${service.name} on port ${service.port}...`);
    const child = startService(service);
    processes.push(child);

    await waitForPort(service.port, service.timeout);
    console.log(`[Setup] ${service.name} is ready on port ${service.port}`);
  }
}

/**
 * Vitest globalSetup teardown
 */
export async function teardown() {
  for (const proc of processes) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore
    }
  }

  // Wait a moment for graceful shutdown
  await new Promise(r => setTimeout(r, 1000));

  // Force kill any remaining
  for (const proc of processes) {
    try {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch {
      // Ignore
    }
  }

  processes.length = 0;
}
