import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Load .env file before tests start
loadEnv();

export default defineConfig({
  // Test directory
  testDir: './e2e/tests',

  // Test file match pattern - only playwright-specific tests
  testMatch: '**/*.playwright.spec.ts',

  // Global settings
  fullyParallel: false, // Sequential execution for DB consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single thread execution

  // Timeout settings
  timeout: 30000,
  expect: {
    timeout: 5000
  },

  // Reporters
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],

  // Global use settings
  use: {
    // Base URL
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:1420',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Trace for debugging (time travel)
    trace: 'retain-on-failure',

    // Browser options
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  },

  // Project configuration (different browsers)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Optional: Firefox and WebKit
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Web Server (auto-start dev server)
  webServer: {
    command: '/bin/zsh -c "source ~/.zshrc && pnpm desktop:dev"',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
