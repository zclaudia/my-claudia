import { Page } from '@playwright/test';

/**
 * Helper functions for managing server connection in tests
 */

/**
 * Wait for the app to be ready
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Wait a bit for React to hydrate
  await page.waitForTimeout(1000);

  // Check if main UI is visible
  const mainContent = page.locator('main, [role="main"], .main-content, #root').first();
  await mainContent.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    // Main content might not have specific selector, that's okay
  });
}

/**
 * Ensure the app is connected to a server
 * This is required before many features can be used
 */
export async function ensureServerConnection(page: Page): Promise<boolean> {
  console.log('Ensuring server connection...');

  // First, check if already connected by looking for connection status
  const connectionStatus = page.locator('[data-testid="connection-status"]').first();
  const statusText = await connectionStatus.textContent({ timeout: 2000 }).catch(() => null);

  if (statusText && statusText.toLowerCase().includes('connected')) {
    console.log('  ✓ Already connected to server');
    return true;
  }

  // Try to find and click on server selector
  const serverSelector = page.locator('[data-testid="server-selector"]').first();
  const selectorVisible = await serverSelector.isVisible({ timeout: 2000 }).catch(() => false);

  if (selectorVisible) {
    await serverSelector.click();
    await page.waitForTimeout(500);

    // Look for a server option to connect to
    const serverOption = page.locator('[class*="server-item"], [class*="ServerItem"], text=/Local|localhost/i').first();
    const optionVisible = await serverOption.isVisible({ timeout: 2000 }).catch(() => false);

    if (optionVisible) {
      await serverOption.click();
      await page.waitForTimeout(2000);

      // Check if now connected
      const newStatus = await connectionStatus.textContent({ timeout: 3000 }).catch(() => null);
      if (newStatus && newStatus.toLowerCase().includes('connected')) {
        console.log('  ✓ Connected to server');
        return true;
      }
    }
  }

  // Alternative: Try to connect via settings
  const settingsButton = page.locator('[data-testid="settings-button"]').first();
  const settingsVisible = await settingsButton.isVisible({ timeout: 2000 }).catch(() => false);

  if (settingsVisible) {
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Look for Connections tab
    const connectionsTab = page.locator('[data-testid="connections-tab"]').first();
    const tabVisible = await connectionsTab.isVisible({ timeout: 2000 }).catch(() => false);

    if (tabVisible) {
      await connectionsTab.click();
      await page.waitForTimeout(500);

      // Look for connect button
      const connectButton = page.locator('button:has-text("Connect")').first();
      const btnVisible = await connectButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (btnVisible) {
        await connectButton.click();
        await page.waitForTimeout(2000);

        // Check if now connected
        const newStatus = await connectionStatus.textContent({ timeout: 3000 }).catch(() => null);
        if (newStatus && newStatus.toLowerCase().includes('connected')) {
          console.log('  ✓ Connected via settings');
          return true;
        }
      }
    }

    // Close settings
    const closeButton = page.locator('button[title="Close"], button[aria-label="Close"]').first();
    const closeVisible = await closeButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (closeVisible) {
      await closeButton.click();
      await page.waitForTimeout(300);
    }
  }

  console.log('  ⚠️ Could not establish server connection (may need manual setup)');
  return false;
}

/**
 * Create a test project with connection check
 */
export async function createTestProject(page: Page, name: string, path: string): Promise<boolean> {
  // Ensure connection first
  const connected = await ensureServerConnection(page);
  if (!connected) {
    console.log('  ⚠️ Cannot create project - no server connection');
    return false;
  }

  // Look for Add Project button
  const addButton = page.locator('button[title="Add Project"]').first();
  const btnVisible = await addButton.isVisible({ timeout: 2000 }).catch(() => false);

  if (!btnVisible) {
    console.log('  ⚠️ Add Project button not visible');
    return false;
  }

  // Check if button is disabled
  const isDisabled = await addButton.isDisabled();

  if (isDisabled) {
    console.log('  ⚠️ Add Project button is disabled (not connected)');
    return false;
  }

  await addButton.click();
  await page.waitForTimeout(500);

  // Fill in form
  const nameInput = page.locator('input[placeholder*="Project name"], input[placeholder*="Name"]').first();
  const nameVisible = await nameInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (nameVisible) {
    await nameInput.fill(name);
  }

  const pathInput = page.locator('input[placeholder*="Working directory"], input[placeholder*="Path"]').first();
  const pathVisible = await pathInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (pathVisible) {
    await pathInput.fill(path);
  }

  // Click Create button
  const createButton = page.locator('button:has-text("Create"), button:has-text("Add")').first();
  const createVisible = await createButton.isVisible({ timeout: 2000 }).catch(() => false);

  if (createVisible) {
    await createButton.click();
    await page.waitForTimeout(1000);
    console.log(`  ✓ Created project: ${name}`);
    return true;
  }

  return false;
}
