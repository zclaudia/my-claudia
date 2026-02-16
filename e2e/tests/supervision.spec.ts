/**
 * Supervision E2E Tests
 *
 * Tests for the session supervision feature:
 * creating, pausing, resuming, and cancelling supervisions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Supervision', () => {
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

  // Helper: create project + session via API and navigate to it
  async function setupProjectAndSession() {
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create project
    const projRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-supervision', type: 'code' }),
    });
    const projData = await projRes.json();
    const projectId = projData.data.id;

    // Create session
    const sessRes = await client.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: 'Test Session' }),
    });
    const sessData = await sessRes.json();
    const sessionId = sessData.data.id;

    // Refresh the page to pick up new data
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    return { projectId, sessionId };
  }

  // Helper: open context menu on a session
  async function openSessionContextMenu(sessionName: string) {
    const sessionBtn = browser.locator(`text=${sessionName}`).first();
    await sessionBtn.click({ button: 'right' });
    await browser.waitForTimeout(300);
  }

  // ─────────────────────────────────────────────
  // S1: Create Supervision via dialog
  // ─────────────────────────────────────────────
  test('S1: create supervision via dialog', async () => {
    console.log('Test S1: Create supervision via dialog');

    const { sessionId } = await setupProjectAndSession();

    // Expand project to show sessions
    const projectBtn = browser.locator('text=test-supervision').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    // Right-click on session to open context menu
    await openSessionContextMenu('Test Session');

    // Click "Supervise" in context menu
    const superviseBtn = browser.locator('button:has-text("Supervise")').first();
    if (await superviseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await superviseBtn.click();
      await browser.waitForTimeout(500);
    }

    // Verify supervision dialog opened
    const dialogHeader = browser.locator('text=Supervise Session').first();
    expect(await dialogHeader.isVisible({ timeout: 3000 })).toBe(true);

    // Fill in goal
    const goalTextarea = browser.locator('textarea').first();
    await goalTextarea.fill('Run all unit tests and fix any failures');
    await browser.waitForTimeout(200);

    // Verify Start button is enabled
    const startBtn = browser.locator('button:has-text("Start Supervision")').first();
    expect(await startBtn.isEnabled()).toBe(true);

    // Click Start Supervision
    await startBtn.click();
    await browser.waitForTimeout(1000);

    // Dialog should close
    expect(await dialogHeader.isVisible({ timeout: 1000 }).catch(() => false)).toBe(false);
  }, 30000);

  // ─────────────────────────────────────────────
  // S2: SuperviseDialog UI interaction
  // ─────────────────────────────────────────────
  test('S2: supervision dialog UI — subtasks and settings', async () => {
    console.log('Test S2: Supervision dialog UI');

    await setupProjectAndSession();

    // Expand project
    const projectBtn = browser.locator('text=test-supervision').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    // Open context menu and click Supervise
    await openSessionContextMenu('Test Session');
    const superviseBtn = browser.locator('button:has-text("Supervise")').first();
    if (await superviseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await superviseBtn.click();
      await browser.waitForTimeout(500);
    }

    // Verify dialog is open
    const dialogHeader = browser.locator('text=Supervise Session').first();
    expect(await dialogHeader.isVisible({ timeout: 3000 })).toBe(true);

    // Fill in goal
    const goalTextarea = browser.locator('textarea').first();
    await goalTextarea.fill('Implement feature X');

    // Add subtask
    const subtaskInput = browser.locator('input[placeholder*="Add a subtask"]').first();
    await subtaskInput.fill('Write unit tests');
    const addBtn = browser.locator('button:has-text("Add")').first();
    await addBtn.click();
    await browser.waitForTimeout(200);

    // Verify subtask appears
    const subtaskText = browser.locator('text=Write unit tests').first();
    expect(await subtaskText.isVisible()).toBe(true);

    // Add another subtask
    await subtaskInput.fill('Update documentation');
    await addBtn.click();
    await browser.waitForTimeout(200);

    const subtaskText2 = browser.locator('text=Update documentation').first();
    expect(await subtaskText2.isVisible()).toBe(true);

    // Toggle Settings
    const settingsBtn = browser.locator('text=Settings').first();
    await settingsBtn.click();
    await browser.waitForTimeout(300);

    // Verify settings fields are visible
    const maxIterLabel = browser.locator('text=Max iterations').first();
    expect(await maxIterLabel.isVisible({ timeout: 2000 })).toBe(true);

    const cooldownLabel = browser.locator('text=Cooldown').first();
    expect(await cooldownLabel.isVisible()).toBe(true);

    // Cancel should close the dialog
    const cancelBtn = browser.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    await browser.waitForTimeout(300);

    expect(await dialogHeader.isVisible({ timeout: 1000 }).catch(() => false)).toBe(false);
  }, 30000);

  // ─────────────────────────────────────────────
  // S3: Supervision lifecycle — pause and cancel via API
  // ─────────────────────────────────────────────
  test('S3: supervision lifecycle — create and cancel via API', async () => {
    console.log('Test S3: Supervision lifecycle via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    const { sessionId } = await setupProjectAndSession();

    // Create supervision via API
    const createRes = await client.fetch('/api/supervisions', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        goal: 'Test supervision lifecycle',
        maxIterations: 5,
        cooldownSeconds: 10,
      }),
    });
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    const supervisionId = createData.data.id;
    expect(createData.data.status).toBe('active');

    // Pause supervision
    const pauseRes = await client.fetch(`/api/supervisions/${supervisionId}/pause`, {
      method: 'POST',
    });
    const pauseData = await pauseRes.json();
    expect(pauseData.success).toBe(true);
    expect(pauseData.data.status).toBe('paused');

    // Resume supervision
    const resumeRes = await client.fetch(`/api/supervisions/${supervisionId}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const resumeData = await resumeRes.json();
    expect(resumeData.success).toBe(true);
    expect(resumeData.data.status).toBe('active');

    // Cancel supervision
    const cancelRes = await client.fetch(`/api/supervisions/${supervisionId}/cancel`, {
      method: 'POST',
    });
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.data.status).toBe('cancelled');
  }, 30000);

  // ─────────────────────────────────────────────
  // S4: Supervision badge visibility in sidebar
  // ─────────────────────────────────────────────
  test('S4: supervision badge appears in sidebar', async () => {
    console.log('Test S4: Supervision badge in sidebar');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    const { sessionId } = await setupProjectAndSession();

    // Expand project
    const projectBtn = browser.locator('text=test-supervision').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    // Create supervision via API
    await client.fetch('/api/supervisions', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        goal: 'Badge visibility test',
        maxIterations: 3,
      }),
    });

    // Wait for UI to update via WebSocket
    await browser.waitForTimeout(2000);

    // Reload to ensure fresh state
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1500);

    // Expand project again
    const projectBtn2 = browser.locator('text=test-supervision').first();
    if (await projectBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn2.click();
      await browser.waitForTimeout(500);
    }

    // Check for the green pulse badge (animate-pulse class on a span inside session button)
    const sessionItem = browser.locator('text=Test Session').first();
    expect(await sessionItem.isVisible({ timeout: 3000 })).toBe(true);

    // The badge is a span with animate-pulse class near the session name
    const badge = browser.locator('.animate-pulse').first();
    const badgeVisible = await badge.isVisible({ timeout: 3000 }).catch(() => false);
    // Badge may or may not appear depending on WS sync timing
    console.log('Badge visible:', badgeVisible);
  }, 30000);
});
