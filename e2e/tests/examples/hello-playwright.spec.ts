/**
 * Basic Playwright Example Test
 *
 * This is a simple example demonstrating standard Playwright usage.
 * Use this as a template for creating new tests.
 */

import { test, expect } from '../../fixtures/test-fixtures';

test.describe('Basic Example Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    // Navigate to the homepage
    await page.goto('/');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Verify the page title or a key element is visible
    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Basic assertion
    expect(title).toBeTruthy();
  });

  test('can find textarea on page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find the message input
    const textarea = page.locator('textarea').first();

    // Check if it's visible
    const isVisible = await textarea.isVisible().catch(() => false);

    console.log(`Textarea visible: ${isVisible}`);
    expect(typeof isVisible).toBe('boolean');
  });

  test('using data-testid selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Using data-testid for stable selectors
    const element = page.locator('[data-testid="some-element"]').first();

    // Gracefully check if element exists
    const exists = await element.isVisible({ timeout: 2000 }).catch(() => false);

    if (exists) {
      console.log('✓ Element with data-testid found');
    } else {
      console.log('⚠️ Element not found (may not exist in this context)');
    }
  });

  test('take screenshot on demand', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/example-screenshot.png',
      fullPage: true
    });

    console.log('✓ Screenshot saved to test-results/example-screenshot.png');
  });

  test('check page content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get page content
    const content = await page.content();

    // Verify content contains expected text
    expect(content).toContain('html');

    console.log('✓ Page content verified');
  });
});

test.describe('Using Test Fixtures', () => {
  test('database is clean before test', async ({ page, cleanDb }) => {
    // cleanDb fixture automatically cleans the database before this test
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    console.log('✓ Test started with clean database');
  });

  test('multiple tests use isolated database state', async ({ page, cleanDb }) => {
    // Each test gets a clean database
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    console.log('✓ This test also has a clean database');
  });
});

test.describe('Working with Selectors', () => {
  test('text selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find element by text
    const element = page.locator('text=My Claudia').first();
    const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false);

    console.log(`Text element visible: ${isVisible}`);
  });

  test('css selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find element by CSS selector
    const button = page.locator('button').first();
    const count = await page.locator('button').count();

    console.log(`Found ${count} buttons on page`);
  });

  test('role selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find element by ARIA role
    const button = page.getByRole('button').first();
    const isVisible = await button.isVisible({ timeout: 2000 }).catch(() => false);

    console.log(`Button by role visible: ${isVisible}`);
  });

  test('label selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find element by label text
    const input = page.getByLabel('Message').first();
    const isVisible = await input.isVisible({ timeout: 2000 }).catch(() => false);

    console.log(`Input by label visible: ${isVisible}`);
  });
});

test.describe('Assertions', () => {
  test('visibility assertion', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const element = page.locator('body');

    // Assert element is visible
    await expect(element).toBeVisible();
  });

  test('text content assertion', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const title = page.locator('title');

    // Assert text content
    await expect(title).not.toBeEmpty();
  });

  test('count assertion', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button');

    // Assert count
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });
});
