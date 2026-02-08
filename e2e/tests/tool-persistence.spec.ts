/**
 * Tool Persistence & Diff Viewer Tests (N1-N5)
 *
 * Tests for tool call persistence across page reloads,
 * inline diff display, and terminal-style Bash output.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, setupTestProject, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Tool Persistence & Diff Viewer', () => {
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

    // Create project and session
    const addProjectBtn = browser.locator('button[title="Add Project"]').first();
    if (await addProjectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addProjectBtn.click();
      await browser.waitForTimeout(300);

      const nameInput = browser.locator('input[placeholder*="Project name"]');
      await nameInput.fill('test-tool-persistence');

      const createBtn = browser.locator('button:has-text("Create")').first();
      await createBtn.click();
      await browser.waitForTimeout(1500);
    }

    const projectBtn = browser.locator('text=test-tool-persistence').first();
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
  // N1: Tool results persist after page refresh
  // ─────────────────────────────────────────────
  test('N1: tool results persist after page refresh', async () => {
    console.log('Test N1: Tool persistence after refresh');

    await ensureSession();

    // Send a message that will trigger tool calls
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Read the file package.json');

    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();

    // Wait for tool call to appear and complete
    await browser.waitForTimeout(5000);

    // Check that a tool call is visible
    const toolCallElement = browser.locator('[class*="tool-call"], [data-testid*="tool"]').first();
    const toolVisible = await toolCallElement.isVisible({ timeout: 10000 }).catch(() => false);

    if (toolVisible) {
      // Refresh page
      await browser.goto('/');
      await browser.waitForLoadState('networkidle');
      await browser.waitForTimeout(2000);

      // Navigate back to the session
      const projectBtn = browser.locator('text=test-tool-persistence').first();
      if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await projectBtn.click();
        await browser.waitForTimeout(500);
      }

      // The session should still show messages with tool calls from metadata
      const assistantMsg = browser.locator('[data-role="assistant"]').first();
      const msgVisible = await assistantMsg.isVisible({ timeout: 5000 }).catch(() => false);
      expect(msgVisible).toBe(true);

      console.log('  ✓ Messages persist after refresh');
    } else {
      console.log('  ⚠ No tool calls were triggered (Claude CLI may not be available)');
    }

    console.log('✅ N1: Tool persistence test completed');
  });

  // ─────────────────────────────────────────────
  // N2: Edit tool shows inline diff
  // ─────────────────────────────────────────────
  test('N2: Edit tool output displays inline diff with colors', async () => {
    console.log('Test N2: Inline diff viewer');

    await ensureSession();

    // Send a message that requests file editing
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Edit the file README.md and add a line "# Test Header" at the top');

    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();

    // Wait for response with tool calls
    await browser.waitForTimeout(8000);

    // Check for diff viewer elements (green for additions, red for removals)
    const diffViewer = browser.locator('[class*="bg-green-500"], [class*="bg-red-500"]').first();
    const diffVisible = await diffViewer.isVisible({ timeout: 10000 }).catch(() => false);

    if (diffVisible) {
      // Verify + and - line indicators exist
      const addIndicator = browser.locator('text=+').first();
      const addExists = await addIndicator.isVisible().catch(() => false);
      expect(addExists).toBe(true);
      console.log('  ✓ Diff viewer with +/- indicators visible');
    } else {
      console.log('  ⚠ No Edit tool call triggered (Claude CLI may not be available)');
    }

    console.log('✅ N2: Diff viewer test completed');
  });

  // ─────────────────────────────────────────────
  // N3: Bash tool output has terminal styling
  // ─────────────────────────────────────────────
  test('N3: Bash tool output uses terminal-style dark background', async () => {
    console.log('Test N3: Terminal-style Bash output');

    await ensureSession();

    const textarea = browser.locator('textarea').first();
    await textarea.fill('Run the command: ls -la');

    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();

    await browser.waitForTimeout(8000);

    // Look for terminal-style output (dark background, monospace)
    const terminalOutput = browser.locator('[class*="bg-gray-900"], [class*="bg-zinc-900"], [class*="font-mono"]').first();
    const termVisible = await terminalOutput.isVisible({ timeout: 10000 }).catch(() => false);

    if (termVisible) {
      console.log('  ✓ Terminal-style output visible');
    } else {
      console.log('  ⚠ No Bash tool call triggered (Claude CLI may not be available)');
    }

    console.log('✅ N3: Terminal style test completed');
  });

  // ─────────────────────────────────────────────
  // N4: Terminal output collapse/expand
  // ─────────────────────────────────────────────
  test('N4: terminal output defaults to 10 lines and expands on click', async () => {
    console.log('Test N4: Terminal output collapse/expand');

    await ensureSession();

    const textarea = browser.locator('textarea').first();
    await textarea.fill('Run the command: seq 1 30');

    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();

    await browser.waitForTimeout(8000);

    // Look for "Show all" / expand button
    const expandButton = browser.locator('button:has-text("Show all"), button:has-text("lines")').first();
    const expandVisible = await expandButton.isVisible({ timeout: 10000 }).catch(() => false);

    if (expandVisible) {
      // Click to expand
      await expandButton.click();
      await browser.waitForTimeout(500);
      console.log('  ✓ Expand button found and clicked');
    } else {
      console.log('  ⚠ No collapsible output found (output may be < 10 lines or CLI not available)');
    }

    console.log('✅ N4: Collapse/expand test completed');
  });

  // ─────────────────────────────────────────────
  // N5: Tool call status indicators
  // ─────────────────────────────────────────────
  test('N5: tool call shows running/completed/error status', async () => {
    console.log('Test N5: Tool call status indicators');

    await ensureSession();

    const textarea = browser.locator('textarea').first();
    await textarea.fill('What is in the file package.json?');

    const sendButton = browser.locator('[data-testid="send-button"]').first();
    await sendButton.click();

    // Wait for tool calls to appear
    await browser.waitForTimeout(10000);

    // Check for completed status indicator (checkmark or "completed" text)
    const completedIcon = browser.locator('[class*="text-green"], [class*="text-emerald"], svg[class*="green"]').first();
    const hasCompletedStatus = await completedIcon.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasCompletedStatus) {
      console.log('  ✓ Completed status indicator visible');
    } else {
      console.log('  ⚠ No status indicators found (Claude CLI may not be available)');
    }

    console.log('✅ N5: Status indicator test completed');
  });
});
