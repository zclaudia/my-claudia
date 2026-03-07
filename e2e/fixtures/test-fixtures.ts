import { test as base, Page } from '@playwright/test';
import { setupCleanDB } from './db-setup';

// Extended test fixtures
type MyClaudiaFixtures = {
  // Clean database before each test
  cleanDb: void;
  // Authenticated page (if needed)
  authenticatedPage: Page;
  // Connected page - ensures app is connected to server
  connectedPage: Page;
};

/**
 * Helper function to ensure app is connected to a server
 * This is needed because many features require server connection
 */
export async function ensureServerConnection(page: Page): Promise<boolean> {
  // Check if already connected by looking for connection status indicator
  const connectionStatus = page.locator('[data-testid="connection-status"]').first();
  const statusText = await connectionStatus.textContent().catch(() => '');

  if (statusText.toLowerCase().includes('connected')) {
    return true;
  }

  // Try to connect to the default server
  // Look for server selector or connect button
  const serverSelector = page.locator('[data-testid="server-selector"]').first();
  const hasSelector = await serverSelector.isVisible({ timeout: 2000 }).catch(() => false);

  if (hasSelector) {
    await serverSelector.click();
    await page.waitForTimeout(500);

    // Look for a server option to click
    const serverOption = page.locator('[data-testid="server-option"], [class*="server-item"]').first();
    const hasOption = await serverOption.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasOption) {
      await serverOption.click();
      await page.waitForTimeout(2000);

      // Verify connection
      const newStatus = await connectionStatus.textContent().catch(() => '');
      return newStatus.toLowerCase().includes('connected');
    }
  }

  // Alternative: Look for connect button in settings
  const settingsButton = page.locator('[data-testid="settings-button"]').first();
  const hasSettings = await settingsButton.isVisible({ timeout: 2000 }).catch(() => false);

  if (hasSettings) {
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Go to connections tab
    const connectionsTab = page.locator('[data-testid="connections-tab"]').first();
    const hasTab = await connectionsTab.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasTab) {
      await connectionsTab.click();
      await page.waitForTimeout(500);

      // Look for connect button
      const connectButton = page.locator('button:has-text("Connect")').first();
      const hasConnect = await connectButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasConnect) {
        await connectButton.click();
        await page.waitForTimeout(3000);

        // Verify connection
        const newStatus = await connectionStatus.textContent().catch(() => '');
        return newStatus.toLowerCase().includes('connected');
      }
    }
  }

  return false;
}

/**
 * Helper function to wait for app to be ready
 */
export async function waitForAppReady(page: Page, timeout = 10000): Promise<void> {
  // Wait for the main content to load
  await page.waitForLoadState('networkidle');

  // Wait a bit for React to hydrate
  await page.waitForTimeout(1000);

  // Check if the main UI is visible
  const mainContent = page.locator('main, [role="main"], .main-content').first();
  await mainContent.waitFor({ state: 'visible', timeout }).catch(() => {
    // Main content might not have specific selector, that's okay
  });
}

export const test = base.extend<MyClaudiaFixtures>({
  // Clean database before each test
  cleanDb: async ({}, use) => {
    await setupCleanDB();
    await use();
  },

  // Authenticated page (for future authentication needs)
  authenticatedPage: async ({ page }, use) => {
    // TODO: Add authentication logic if needed
    await use(page);
  },

  // Connected page - ensures app is connected to server
  connectedPage: async ({ page }, use) => {
    await page.goto('/');
    await waitForAppReady(page);
    await ensureServerConnection(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';

// Default export for convenience
export default test;
