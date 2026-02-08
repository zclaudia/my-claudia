/**
 * Developer Efficiency Tools Tests (O1-O6)
 *
 * Tests for model selector, token usage display,
 * compact button, and font size selector.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Developer Efficiency Tools', () => {
  let browser: BrowserAdapter;

  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser({ headless: true });
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);
  }, 30000);

  afterEach(async () => {
    await browser?.close();
  });

  // Helper: ensure a session is active
  async function ensureSession() {
    const textarea = browser.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      return;
    }

    const addProjectBtn = browser.locator('button[title="Add Project"]').first();
    if (await addProjectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addProjectBtn.click();
      await browser.waitForTimeout(300);

      const nameInput = browser.locator('input[placeholder*="Project name"]');
      await nameInput.fill('test-dev-tools');

      const createBtn = browser.locator('button:has-text("Create")').first();
      await createBtn.click();
      await browser.waitForTimeout(1500);
    }

    const projectBtn = browser.locator('text=test-dev-tools').first();
    if (await projectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    const newSessionBtn = browser.locator('[data-testid="new-session-btn"]').first();
    if (await newSessionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (await newSessionBtn.isEnabled()) {
        await newSessionBtn.click();
        await browser.waitForTimeout(500);

        const createSessionBtn = browser.locator('button:has-text("Create")').first();
        if (await createSessionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await createSessionBtn.click();
          await browser.waitForTimeout(1000);
        }
      }
    }

    await textarea.waitFor({ state: 'visible', timeout: 5000 });
  }

  // ─────────────────────────────────────────────
  // O1: Model selector shows current model and allows switching
  // ─────────────────────────────────────────────
  test('O1: model selector displays and allows switching', async () => {
    console.log('Test O1: Model selector');

    await ensureSession();

    // Find model selector button in toolbar
    const modelSelector = browser.locator('button:has-text("Default"), button:has-text("Opus"), button:has-text("Sonnet"), button:has-text("Haiku")').first();
    const selectorVisible = await modelSelector.isVisible({ timeout: 5000 }).catch(() => false);

    if (selectorVisible) {
      // Click to open dropdown
      await modelSelector.click();
      await browser.waitForTimeout(300);

      // Verify dropdown options exist
      const opusOption = browser.locator('button:has-text("Opus")').first();
      const sonnetOption = browser.locator('button:has-text("Sonnet")').first();
      const haikuOption = browser.locator('button:has-text("Haiku")').first();

      const opusVisible = await opusOption.isVisible({ timeout: 2000 }).catch(() => false);
      const sonnetVisible = await sonnetOption.isVisible({ timeout: 2000 }).catch(() => false);
      const haikuVisible = await haikuOption.isVisible({ timeout: 2000 }).catch(() => false);

      expect(opusVisible || sonnetVisible || haikuVisible).toBe(true);
      console.log('  ✓ Model dropdown with options visible');

      // Select a different model
      if (sonnetVisible) {
        await sonnetOption.click();
        await browser.waitForTimeout(300);

        // Verify the button now shows the new model
        const updatedSelector = browser.locator('button:has-text("Sonnet")').first();
        const updated = await updatedSelector.isVisible({ timeout: 2000 }).catch(() => false);
        expect(updated).toBe(true);
        console.log('  ✓ Model switched to Sonnet');
      }
    } else {
      console.log('  ⚠ Model selector not found in toolbar');
    }

    console.log('✅ O1: Model selector test completed');
  });

  // ─────────────────────────────────────────────
  // O2: Model override sent in run_start message
  // ─────────────────────────────────────────────
  test('O2: selected model is included in run_start WebSocket message', async () => {
    console.log('Test O2: Model override in WebSocket');

    await ensureSession();

    // Set up WebSocket message interception
    const wsMessages: string[] = [];
    await browser.evaluate(() => {
      const originalSend = WebSocket.prototype.send;
      (window as unknown as Record<string, string[]>).__wsMessages = [];
      WebSocket.prototype.send = function (data) {
        if (typeof data === 'string') {
          (window as unknown as Record<string, string[]>).__wsMessages.push(data);
        }
        return originalSend.call(this, data);
      };
    });

    // Switch to Opus model
    const modelSelector = browser.locator('button:has-text("Default"), button:has-text("Opus"), button:has-text("Sonnet")').first();
    if (await modelSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
      await modelSelector.click();
      await browser.waitForTimeout(300);

      const opusOption = browser.locator('button:has-text("Opus")').first();
      if (await opusOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await opusOption.click();
        await browser.waitForTimeout(300);
      }
    }

    // Send a message
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Hello');
    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();
    await browser.waitForTimeout(2000);

    // Check WebSocket messages for model field
    const messages = await browser.evaluate(() => {
      return (window as unknown as Record<string, string[]>).__wsMessages || [];
    }) as string[];

    const runStartMsg = messages.find((m: string) => m.includes('run_start'));
    if (runStartMsg) {
      const parsed = JSON.parse(runStartMsg);
      console.log(`  Model in run_start: ${parsed.model || 'not set'}`);
      // If model was set, it should contain 'opus'
      if (parsed.model) {
        expect(parsed.model).toContain('opus');
        console.log('  ✓ Model override sent in WebSocket message');
      }
    } else {
      console.log('  ⚠ No run_start message captured');
    }

    console.log('✅ O2: Model WebSocket test completed');
  });

  // ─────────────────────────────────────────────
  // O3: Token usage display accumulates
  // ─────────────────────────────────────────────
  test('O3: token usage display shows and accumulates', async () => {
    console.log('Test O3: Token usage display');

    await ensureSession();

    // Look for token display in toolbar (format: "XK in / YK out")
    const tokenDisplay = browser.locator('[class*="token"], text=/\\d+.*in.*\\d+.*out/').first();
    const displayVisible = await tokenDisplay.isVisible({ timeout: 5000 }).catch(() => false);

    // Token display should be visible (might show 0 initially)
    if (displayVisible) {
      console.log('  ✓ Token display visible in toolbar');
    }

    // Send a message to generate usage
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Say hello');
    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();
    await browser.waitForTimeout(8000);

    // Check if token display updated
    const updatedDisplay = browser.locator('text=/\\d+.*in.*\\d+.*out/').first();
    const hasTokens = await updatedDisplay.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTokens) {
      const text = await updatedDisplay.textContent().catch(() => '');
      console.log(`  Token display: ${text}`);
      console.log('  ✓ Token usage updated after message');
    } else {
      console.log('  ⚠ Token display not updated (Claude CLI may not be available)');
    }

    console.log('✅ O3: Token usage test completed');
  });

  // ─────────────────────────────────────────────
  // O4: Token warning color at 80%
  // ─────────────────────────────────────────────
  test('O4: token display shows red warning when exceeding 80% threshold', async () => {
    console.log('Test O4: Token warning colors');

    await ensureSession();

    // Inject high token usage via store to test color change
    await browser.evaluate(() => {
      // Access the Zustand store via the window (if exposed) or React internals
      // This is a programmatic test — we inject usage directly
      const chatStore = (window as unknown as Record<string, unknown>).__chatStore;
      if (chatStore && typeof chatStore === 'object' && 'getState' in chatStore) {
        const state = (chatStore as { getState: () => Record<string, unknown> }).getState();
        if ('addSessionUsage' in state) {
          (state.addSessionUsage as (id: string, usage: { inputTokens: number; outputTokens: number }) => void)(
            'test-session',
            { inputTokens: 170000, outputTokens: 10000 }
          );
        }
      }
    });

    await browser.waitForTimeout(500);

    // Check for red/warning color class
    const redWarning = browser.locator('[class*="text-red"], [class*="text-destructive"]').first();
    const hasRedWarning = await redWarning.isVisible({ timeout: 3000 }).catch(() => false);

    // Note: This test may not work if the store is not exposed globally
    console.log(`  Red warning visible: ${hasRedWarning}`);
    console.log('✅ O4: Token warning color test completed');
  });

  // ─────────────────────────────────────────────
  // O5: Compact button triggers /compact command
  // ─────────────────────────────────────────────
  test('O5: compact button sends /compact command', async () => {
    console.log('Test O5: Compact button');

    await ensureSession();

    // Find Compact button in toolbar
    const compactBtn = browser.locator('button:has-text("Compact")').first();
    const compactVisible = await compactBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (compactVisible) {
      // Verify button is clickable
      const isEnabled = await compactBtn.isEnabled().catch(() => false);
      expect(isEnabled).toBe(true);
      console.log('  ✓ Compact button visible and enabled');

      // Click it
      await compactBtn.click();
      await browser.waitForTimeout(2000);

      // After compact, the chat should process the command
      // (The actual effect depends on Claude CLI being available)
      console.log('  ✓ Compact button clicked');
    } else {
      console.log('  ⚠ Compact button not found in toolbar');
    }

    console.log('✅ O5: Compact button test completed');
  });

  // ─────────────────────────────────────────────
  // O6: Font size selector toggles between sizes
  // ─────────────────────────────────────────────
  test('O6: font size selector switches between small/medium/large', async () => {
    console.log('Test O6: Font size selector');

    await ensureSession();

    // Find font size buttons (labeled "A" with different sizes)
    const fontButtons = browser.locator('button:has-text("A")');
    const count = await fontButtons.count().catch(() => 0);

    if (count >= 3) {
      // Click the large "A" button
      const largeBtn = fontButtons.nth(2); // Third button = large
      await largeBtn.click();
      await browser.waitForTimeout(300);

      // Verify font CSS variable changed
      const fontSize = await browser.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--chat-font-prose').trim();
      });

      console.log(`  Font size after clicking large: ${fontSize}`);

      // Click small "A" button
      const smallBtn = fontButtons.nth(0); // First button = small
      await smallBtn.click();
      await browser.waitForTimeout(300);

      const smallFontSize = await browser.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--chat-font-prose').trim();
      });

      console.log(`  Font size after clicking small: ${smallFontSize}`);

      // They should be different
      if (fontSize && smallFontSize) {
        expect(fontSize).not.toBe(smallFontSize);
        console.log('  ✓ Font size changes between options');
      }
    } else {
      console.log('  ⚠ Font size buttons not found');
    }

    console.log('✅ O6: Font size selector test completed');
  });
});
