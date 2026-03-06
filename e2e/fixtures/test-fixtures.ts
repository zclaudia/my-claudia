import { test as base, Page } from '@playwright/test';
import { setupCleanDB } from './db-setup';

// Extended test fixtures
type MyClaudiaFixtures = {
  // Clean database before each test
  cleanDb: void;
  // Authenticated page (if needed)
  authenticatedPage: Page;
};

export const test = base.extend<MyClaudiaFixtures>({
  // Clean database before each test
  cleanDb: async ({}, use) => {
    await setupCleanDB();
    await use();
  },

  // Authenticated page (for future authentication needs)
  authenticatedPage: async ({ page }, use) => {
    // TODO: Add authentication logic if needed
    // await page.goto('/login');
    // await page.fill('[name="email"]', 'test@example.com');
    // await page.click('button[type="submit"]');

    await use(page);
  },
});

export { expect } from '@playwright/test';

// Default export for convenience
export default test;
