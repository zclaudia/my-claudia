/**
 * Archive & Restore E2E Tests
 *
 * Tests for archiving sessions, viewing archived sessions dialog,
 * and restoring archived sessions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Archive & Restore', () => {
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

  // Helper: create project + sessions via API
  async function setupProjectWithSessions(sessionNames: string[]) {
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    const projRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-archive', type: 'code' }),
    });
    const projData = await projRes.json();
    const projectId = projData.data.id;

    const sessionIds: string[] = [];
    for (const name of sessionNames) {
      const sessRes = await client.fetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ projectId, name }),
      });
      const sessData = await sessRes.json();
      sessionIds.push(sessData.data.id);
    }

    // Reload page
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    return { projectId, sessionIds, apiKey, client };
  }

  // ─────────────────────────────────────────────
  // AR1: Archive a session via context menu
  // ─────────────────────────────────────────────
  test('AR1: archive session via context menu', async () => {
    console.log('Test AR1: Archive session via context menu');

    const { sessionIds } = await setupProjectWithSessions([
      'Session To Archive',
      'Session To Keep',
    ]);

    // Expand project
    const projectBtn = browser.locator('text=test-archive').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);
    }

    // Verify both sessions are visible
    const archiveSession = browser.locator('text=Session To Archive').first();
    const keepSession = browser.locator('text=Session To Keep').first();
    expect(await archiveSession.isVisible({ timeout: 3000 })).toBe(true);
    expect(await keepSession.isVisible({ timeout: 3000 })).toBe(true);

    // Right-click on the session to archive
    await archiveSession.click({ button: 'right' });
    await browser.waitForTimeout(300);

    // Click "Archive" in context menu
    const archiveBtn = browser.locator('button:has-text("Archive")').first();
    if (await archiveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archiveBtn.click();
      await browser.waitForTimeout(1000);
    }

    // Session should no longer be visible in sidebar
    const archivedSession = browser.locator('text=Session To Archive').first();
    const stillVisible = await archivedSession.isVisible({ timeout: 1000 }).catch(() => false);
    expect(stillVisible).toBe(false);

    // Other session should still be visible
    expect(await keepSession.isVisible()).toBe(true);
  }, 30000);

  // ─────────────────────────────────────────────
  // AR2: Open archived sessions dialog
  // ─────────────────────────────────────────────
  test('AR2: open archived sessions dialog', async () => {
    console.log('Test AR2: Open archived sessions dialog');

    const { client, sessionIds } = await setupProjectWithSessions(['Archived Test']);

    // Archive the session via API
    await client.fetch('/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: [sessionIds[0]] }),
    });

    // Reload
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    // Click "Archived Sessions" button in sidebar
    const archivedBtn = browser.locator('text=Archived Sessions').first();
    expect(await archivedBtn.isVisible({ timeout: 3000 })).toBe(true);
    await archivedBtn.click();
    await browser.waitForTimeout(500);

    // Verify dialog opened
    const dialogTitle = browser.locator('text=Archived Sessions').last();
    const dialogVisible = await dialogTitle.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('Archived dialog visible:', dialogVisible);
    expect(dialogVisible).toBe(true);
  }, 30000);

  // ─────────────────────────────────────────────
  // AR3: Archive and restore via API
  // ─────────────────────────────────────────────
  test('AR3: archive and restore session via API', async () => {
    console.log('Test AR3: Archive and restore via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create project and session
    const projRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-archive-api', type: 'code' }),
    });
    const projData = await projRes.json();
    const projectId = projData.data.id;

    const sessRes = await client.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: 'API Archive Test' }),
    });
    const sessData = await sessRes.json();
    const sessionId = sessData.data.id;

    // Archive session
    const archiveRes = await client.fetch('/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: [sessionId] }),
    });
    const archiveData = await archiveRes.json();
    expect(archiveData.success).toBe(true);

    // Verify session is archived (not in regular list)
    const listRes = await client.fetch(`/api/projects/${projectId}/sessions`);
    const listData = await listRes.json();
    const activeSessions = listData.data.filter(
      (s: { id: string }) => s.id === sessionId
    );
    expect(activeSessions.length).toBe(0);

    // Check archived sessions list
    const archivedListRes = await client.fetch(`/api/sessions/archived?projectId=${projectId}`);
    const archivedListData = await archivedListRes.json();
    expect(archivedListData.success).toBe(true);
    const archivedSessions = archivedListData.data.filter(
      (s: { id: string }) => s.id === sessionId
    );
    expect(archivedSessions.length).toBe(1);

    // Restore session
    const restoreRes = await client.fetch('/api/sessions/restore', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: [sessionId] }),
    });
    const restoreData = await restoreRes.json();
    expect(restoreData.success).toBe(true);

    // Verify session is restored (back in regular list)
    const listRes2 = await client.fetch(`/api/projects/${projectId}/sessions`);
    const listData2 = await listRes2.json();
    const restoredSessions = listData2.data.filter(
      (s: { id: string }) => s.id === sessionId
    );
    expect(restoredSessions.length).toBe(1);
  }, 30000);
});
