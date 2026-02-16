/**
 * Agent Assistant E2E Tests
 *
 * Tests for the agent assistant bubble/panel feature:
 * opening, auto-configuration, and basic interaction.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Agent Assistant', () => {
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

  // Helper: ensure a project and session exist, navigate to active session
  async function ensureActiveSession() {
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create project
    const projRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-agent', type: 'code' }),
    });
    const projData = await projRes.json();
    const projectId = projData.data.id;

    // Create session
    await client.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: 'Agent Test Session' }),
    });

    // Reload
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    // Navigate to project
    const projectBtn = browser.locator('text=test-agent').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    // Click on session
    const sessionBtn = browser.locator('text=Agent Test Session').first();
    if (await sessionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionBtn.click();
      await browser.waitForTimeout(500);
    }
  }

  // ─────────────────────────────────────────────
  // A1: Agent bubble is visible when connected
  // ─────────────────────────────────────────────
  test('A1: agent bubble visible when connected', async () => {
    console.log('Test A1: Agent bubble visibility');

    await ensureActiveSession();

    // The agent bubble/widget should be visible on the right side
    // It's rendered as a fixed element when not expanded
    // Look for the AgentBubble component
    const agentTab = browser.locator('[class*="fixed"][class*="right-0"]').first();
    const isVisible = await agentTab.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Agent bubble visible:', isVisible);
    // The bubble should be present when connected
    expect(isVisible).toBe(true);
  }, 30000);

  // ─────────────────────────────────────────────
  // A2: Agent panel opens on bubble click
  // ─────────────────────────────────────────────
  test('A2: agent panel opens on bubble click', async () => {
    console.log('Test A2: Agent panel open/close');

    await ensureActiveSession();

    // Find and click the agent bubble
    const agentBubble = browser.locator('[class*="fixed"][class*="right-0"] button').first();
    const bubbleVisible = await agentBubble.isVisible({ timeout: 5000 }).catch(() => false);

    if (!bubbleVisible) {
      console.log('Agent bubble not found, skipping');
      return;
    }

    await agentBubble.click();
    await browser.waitForTimeout(1500);

    // After clicking, should show either:
    // - Loading state: "Setting up Agent..."
    // - Or the agent panel with chat interface
    const loadingText = browser.locator('text=Setting up Agent').first();
    const panelVisible = await loadingText.isVisible({ timeout: 3000 }).catch(() => false);

    // Or check for the panel container (fixed bottom-8 right-6)
    const panelContainer = browser.locator('[class*="fixed"][class*="bottom-8"]').first();
    const containerVisible = await panelContainer.isVisible({ timeout: 3000 }).catch(() => false);

    console.log('Loading visible:', panelVisible, 'Panel visible:', containerVisible);
    // At least one should be true (either loading or panel)
    expect(panelVisible || containerVisible).toBe(true);
  }, 30000);

  // ─────────────────────────────────────────────
  // A3: Agent auto-configures on first open
  // ─────────────────────────────────────────────
  test('A3: agent auto-configuration via API', async () => {
    console.log('Test A3: Agent auto-configuration via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Call ensure agent API directly
    const ensureRes = await client.fetch('/api/agent/ensure', {
      method: 'POST',
    });
    const ensureData = await ensureRes.json();

    expect(ensureData.success).toBe(true);
    expect(ensureData.data.projectId).toBeDefined();
    expect(ensureData.data.sessionId).toBeDefined();

    // Idempotent: calling again returns same IDs
    const ensureRes2 = await client.fetch('/api/agent/ensure', {
      method: 'POST',
    });
    const ensureData2 = await ensureRes2.json();

    expect(ensureData2.data.projectId).toBe(ensureData.data.projectId);
    expect(ensureData2.data.sessionId).toBe(ensureData.data.sessionId);
  }, 30000);
});
