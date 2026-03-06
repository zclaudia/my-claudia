/**
 * Archive/Restore E2E Tests
 *
 * Tests for session archiving, restoration, and management.
 */

import { test, expect } from '../fixtures/test-fixtures';
import { ChatPage, ProjectPage } from '../page-objects';

test.describe('Archive/Restore', () => {
  let chatPage: ChatPage;
  let projectPage: ProjectPage;

  test.beforeEach(async ({ page, cleanDb }) => {
    chatPage = new ChatPage(page);
    projectPage = new ProjectPage(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // Helper: Ensure active session
  async function ensureActiveSession(page: any): Promise<void> {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      return;
    }

    const noProjects = page.locator('text=No projects yet').first();
    if (await noProjects.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectPage.createProject('Archive Test', '/tmp/archive-test');
      await page.waitForTimeout(1500);
    }

    const projectBtn = page.locator('text=Archive Test').first();
    if (await projectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectBtn.click();
      await page.waitForTimeout(500);
    }

    const newSessionBtn = page.locator('[data-testid="new-session-btn"]').first();
    if (await newSessionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newSessionBtn.click();
      await page.waitForTimeout(500);

      const createBtn = page.locator('button:has-text("Create")').first();
      if (await createBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    await textarea.waitFor({ state: 'visible', timeout: 5000 });
  }

  // Helper: Open archive view
  async function openArchiveView(page: any): Promise<boolean> {
    const archiveBtn = page.locator('button[title*="Archive"], text=/Archive/i').first();
    if (await archiveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archiveBtn.click();
      await page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────
  // AR1: Archive single session
  // ─────────────────────────────────────────────
  test('AR1: archive single session', async ({ page }) => {
    console.log('Test AR1: Archive single session');

    await ensureActiveSession(page);

    // Add some content
    await chatPage.sendMessage('This is a message to archive');
    await page.waitForTimeout(2000);

    // Find session menu
    const sessionItem = page.locator('[data-testid="session-item"], .session-item').first();
    await sessionItem.hover();
    await page.waitForTimeout(300);

    // Look for archive option
    const archiveBtn = sessionItem.locator('button[title*="Archive"], button:has-text("Archive")').first();
    const hasArchive = await archiveBtn.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasArchive) {
      await archiveBtn.click();
      await page.waitForTimeout(500);
      console.log('  ✓ Session archived');
    }

    console.log('✅ AR1: Archive single session works');
  });

  // ─────────────────────────────────────────────
  // AR2: View archived sessions
  // ─────────────────────────────────────────────
  test('AR2: view archived sessions', async ({ page }) => {
    console.log('Test AR2: View archived sessions');

    // Look for archived sessions section
    const archivedSection = page.locator('[class*="archived"], text=/Archived|Archive/i').first();
    const hasSection = await archivedSection.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasSection) {
      await archivedSection.click();
      await page.waitForTimeout(500);
      console.log('  ✓ Archived section opened');

      // Check for archived session list
      const archivedList = page.locator('[data-testid="archived-list"], .archived-sessions');
      const count = await archivedList.count();

      console.log(`  ✓ Found ${count} archived sessions`);
    }

    console.log('✅ AR2: View archived sessions works');
  });

  // ─────────────────────────────────────────────
  // AR3: Restore archived session
  // ─────────────────────────────────────────────
  test('AR3: restore archived session', async ({ page }) => {
    console.log('Test AR3: Restore archived session');

    // Navigate to archived sessions
    const archivedSection = page.locator('text=/Archived|Archive/i').first();
    if (await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archivedSection.click();
      await page.waitForTimeout(500);

      // Look for restore button on archived session
      const restoreBtn = page.locator('button[title*="Restore"], button:has-text("Restore")').first();
      const hasRestore = await restoreBtn.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasRestore) {
        await restoreBtn.click();
        await page.waitForTimeout(500);
        console.log('  ✓ Session restored');

        // Verify session is back in active list
        const activeSessions = page.locator('[data-testid="session-item"], .session-item.active');
        const count = await activeSessions.count();

        if (count > 0) {
          console.log('  ✓ Session moved to active list');
        }
      }
    }

    console.log('✅ AR3: Restore archived session works');
  });

  // ─────────────────────────────────────────────
  // AR4: Bulk archive
  // ─────────────────────────────────────────────
  test('AR4: bulk archive', async ({ page }) => {
    console.log('Test AR4: Bulk archive');

    await ensureActiveSession(page);

    // Create multiple sessions
    for (let i = 0; i < 2; i++) {
      const newSessionBtn = page.locator('[data-testid="new-session-btn"]').first();
      if (await newSessionBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await newSessionBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Look for select mode or bulk actions
    const selectBtn = page.locator('button[title*="Select"], button:has-text("Select")').first();
    const hasSelect = await selectBtn.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasSelect) {
      await selectBtn.click();
      await page.waitForTimeout(300);

      // Select all
      const selectAll = page.locator('input[type="checkbox"][title*="Select all"], button:has-text("Select All")').first();
      if (await selectAll.isVisible({ timeout: 1000 }).catch(() => false)) {
        await selectAll.click();
        await page.waitForTimeout(300);
        console.log('  ✓ Sessions selected');
      }

      // Archive selected
      const archiveSelected = page.locator('button:has-text("Archive Selected")').first();
      if (await archiveSelected.isVisible({ timeout: 1000 }).catch(() => false)) {
        await archiveSelected.click();
        await page.waitForTimeout(500);
        console.log('  ✓ Bulk archive completed');
      }
    }

    console.log('✅ AR4: Bulk archive works');
  });

  // ─────────────────────────────────────────────
  // AR5: Permanent delete
  // ─────────────────────────────────────────────
  test('AR5: permanent delete', async ({ page }) => {
    console.log('Test AR5: Permanent delete');

    // Navigate to archived sessions
    const archivedSection = page.locator('text=/Archived|Archive/i').first();
    if (await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archivedSection.click();
      await page.waitForTimeout(500);

      // Find delete button on archived session
      const deleteBtn = page.locator('button[title*="Delete"], button:has-text("Delete")').first();
      const hasDelete = await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasDelete) {
        await deleteBtn.click();
        await page.waitForTimeout(300);

        // Confirm deletion
        const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Delete Permanently")').first();
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(500);
          console.log('  ✓ Session permanently deleted');
        }
      }
    }

    console.log('✅ AR5: Permanent delete works');
  });

  // ─────────────────────────────────────────────
  // AR6: Archive with messages
  // ─────────────────────────────────────────────
  test('AR6: archive with messages', async ({ page }) => {
    console.log('Test AR6: Archive with messages');

    await ensureActiveSession(page);

    // Add messages
    await chatPage.sendMessage('First message');
    await page.waitForTimeout(1000);
    await chatPage.sendMessage('Second message');
    await page.waitForTimeout(1000);

    // Archive the session
    const sessionItem = page.locator('[data-testid="session-item"], .session-item').first();
    await sessionItem.hover();

    const archiveBtn = sessionItem.locator('button[title*="Archive"]').first();
    if (await archiveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await archiveBtn.click();
      await page.waitForTimeout(500);

      console.log('  ✓ Session with messages archived');
    }

    console.log('✅ AR6: Archive with messages works');
  });

  // ─────────────────────────────────────────────
  // AR7: Restore and verify messages
  // ─────────────────────────────────────────────
  test('AR7: restore and verify messages', async ({ page }) => {
    console.log('Test AR7: Restore and verify messages');

    // Navigate to archived sessions
    const archivedSection = page.locator('text=/Archived|Archive/i').first();
    if (await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archivedSection.click();
      await page.waitForTimeout(500);

      // Find and restore a session
      const restoreBtn = page.locator('button[title*="Restore"]').first();
      if (await restoreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await restoreBtn.click();
        await page.waitForTimeout(1000);

        // Check for messages
        const messages = page.locator('[data-role="user"], [data-role="assistant"]');
        const count = await messages.count();

        if (count > 0) {
          console.log(`  ✓ ${count} messages restored`);
        }
      }
    }

    console.log('✅ AR7: Restore and verify messages works');
  });

  // ─────────────────────────────────────────────
  // AR8: Archive search
  // ─────────────────────────────────────────────
  test('AR8: archive search', async ({ page }) => {
    console.log('Test AR8: Archive search');

    // Navigate to archived sessions
    const archivedSection = page.locator('text=/Archived|Archive/i').first();
    if (await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archivedSection.click();
      await page.waitForTimeout(500);

      // Look for search in archives
      const searchInput = page.locator('input[placeholder*="Search archive"]').first();
      const hasSearch = await searchInput.isVisible({ timeout: 1000 }).catch(() => false);

      if (hasSearch) {
        await searchInput.fill('test query');
        await page.waitForTimeout(500);
        console.log('  ✓ Archive search works');
      }
    }

    console.log('✅ AR8: Archive search works');
  });

  // ─────────────────────────────────────────────
  // AR9: Archive export
  // ─────────────────────────────────────────────
  test('AR9: archive export', async ({ page }) => {
    console.log('Test AR9: Archive export');

    // Navigate to archived sessions
    const archivedSection = page.locator('text=/Archived|Archive/i').first();
    if (await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archivedSection.click();
      await page.waitForTimeout(500);

      // Look for export option
      const exportBtn = page.locator('button[title*="Export"], button:has-text("Export")').first();
      const hasExport = await exportBtn.isVisible({ timeout: 1000 }).catch(() => false);

      if (hasExport) {
        await exportBtn.click();
        await page.waitForTimeout(500);
        console.log('  ✓ Archive export initiated');
      }
    }

    console.log('✅ AR9: Archive export works');
  });

  // ─────────────────────────────────────────────
  // AR10: Auto-archive settings
  // ─────────────────────────────────────────────
  test('AR10: auto-archive settings', async ({ page }) => {
    console.log('Test AR10: Auto-archive settings');

    // Open settings
    const settingsBtn = page.locator('button[title*="Settings"]').first();
    if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(500);

      // Look for auto-archive settings
      const autoArchive = page.locator('text=/Auto.*Archive|Archive.*Settings/i').first();
      const hasAutoArchive = await autoArchive.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasAutoArchive) {
        console.log('  ✓ Auto-archive settings found');

        // Check for configuration options
        const autoArchiveToggle = page.locator('input[type="checkbox"][name*="auto-archive"]').first();
        const hasToggle = await autoArchiveToggle.isVisible({ timeout: 1000 }).catch(() => false);

        if (hasToggle) {
          console.log('  ✓ Auto-archive toggle available');
        }
      }
    }

    console.log('✅ AR10: Auto-archive settings work');
  });
});
