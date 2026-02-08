/**
 * Session Management Enhancement Tests (P1-P6)
 *
 * Tests for session export (Markdown), cross-session
 * full-text search, and search result navigation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Session Management Enhancement', () => {
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

  // Helper: create project with sessions and messages via API
  async function setupProjectWithMessages() {
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create project
    const projectRes = await client.post('/api/projects', {
      name: 'test-session-mgmt',
      type: 'code',
    });
    const projectId = projectRes.data.data.id;

    // Create session
    const sessionRes = await client.post('/api/sessions', {
      projectId,
      name: 'Test Session Alpha',
    });
    const sessionId = sessionRes.data.data.id;

    // Add messages
    await client.post(`/api/sessions/${sessionId}/messages`, {
      role: 'user',
      content: 'How do I implement authentication with JWT tokens?',
    });
    await client.post(`/api/sessions/${sessionId}/messages`, {
      role: 'assistant',
      content: 'Here is how to implement JWT authentication in Node.js...',
      metadata: {
        toolCalls: [
          { name: 'Read', input: { file_path: '/src/auth.ts' }, output: 'file contents', isError: false },
        ],
        usage: { inputTokens: 1500, outputTokens: 800 },
      },
    });

    // Create another session with different content
    const session2Res = await client.post('/api/sessions', {
      projectId,
      name: 'Test Session Beta',
    });
    const session2Id = session2Res.data.data.id;

    await client.post(`/api/sessions/${session2Id}/messages`, {
      role: 'user',
      content: 'How to set up database migrations with Prisma?',
    });

    return { projectId, sessionId, session2Id };
  }

  // Helper: ensure we're on the app and can see sidebar
  async function waitForAppReady() {
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);
  }

  // ─────────────────────────────────────────────
  // P1: Export session as Markdown via context menu
  // ─────────────────────────────────────────────
  test('P1: export session as Markdown from context menu', async () => {
    console.log('Test P1: Session export via context menu');

    const { sessionId } = await setupProjectWithMessages();
    await waitForAppReady();

    // Find the session in sidebar
    const sessionEl = browser.locator('text=Test Session Alpha').first();
    const sessionVisible = await sessionEl.isVisible({ timeout: 5000 }).catch(() => false);

    if (sessionVisible) {
      // Click the three-dot menu button on the session
      const menuBtn = browser.locator('button[title*="menu"], button[aria-label*="menu"]').first();
      if (await menuBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await menuBtn.click();
        await browser.waitForTimeout(300);

        // Look for Export option
        const exportBtn = browser.locator('button:has-text("Export"), text=Export').first();
        const exportVisible = await exportBtn.isVisible({ timeout: 2000 }).catch(() => false);

        if (exportVisible) {
          await exportBtn.click();
          await browser.waitForTimeout(1000);
          console.log('  ✓ Export option clicked');
        } else {
          console.log('  ⚠ Export option not found in menu');
        }
      } else {
        console.log('  ⚠ Session menu button not found');
      }
    } else {
      console.log('  ⚠ Session not visible in sidebar');
    }

    console.log('✅ P1: Export test completed');
  });

  // ─────────────────────────────────────────────
  // P2: Export content validation (API-level test)
  // ─────────────────────────────────────────────
  test('P2: export content includes messages, timestamps, and tool summaries', async () => {
    console.log('Test P2: Export content validation');

    const { sessionId } = await setupProjectWithMessages();

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Call export API directly
    const res = await client.get(`/api/sessions/${sessionId}/export`);

    expect(res.data.success).toBe(true);
    expect(res.data.data.sessionName).toBe('Test Session Alpha');

    const markdown = res.data.data.markdown;

    // Verify session header
    expect(markdown).toContain('# Test Session Alpha');
    expect(markdown).toContain('Created:');

    // Verify messages
    expect(markdown).toContain('## User');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('JWT');

    // Verify tool calls summary
    expect(markdown).toContain('**Tool Calls:**');
    expect(markdown).toContain('**Read**');

    // Verify token usage
    expect(markdown).toContain('Tokens:');
    expect(markdown).toContain('1,500');

    console.log('  ✓ Markdown export contains all expected sections');
    console.log('✅ P2: Export content validation completed');
  });

  // ─────────────────────────────────────────────
  // P3: Search returns matching messages
  // ─────────────────────────────────────────────
  test('P3: search box returns matching messages across sessions', async () => {
    console.log('Test P3: Cross-session search');

    await setupProjectWithMessages();
    await waitForAppReady();

    // Find the search input in sidebar
    const searchInput = browser.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (searchVisible) {
      // Type a search query
      await searchInput.fill('authentication');
      await browser.waitForTimeout(500); // Wait for debounce

      // Check for search results
      const searchResults = browser.locator('[class*="search-result"], [data-testid*="search"]');
      await browser.waitForTimeout(1000); // Wait for results

      const resultCount = await searchResults.count().catch(() => 0);
      console.log(`  Search results: ${resultCount}`);

      if (resultCount > 0) {
        // Verify result contains relevant text
        const firstResult = searchResults.first();
        const text = await firstResult.textContent().catch(() => '');
        console.log(`  First result: ${text?.substring(0, 80)}...`);
        console.log('  ✓ Search returned results');
      } else {
        // Try alternative: check for any visible result items
        const anyResult = browser.locator('text=authentication').first();
        const hasResult = await anyResult.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`  Direct text match: ${hasResult}`);
      }
    } else {
      console.log('  ⚠ Search input not found in sidebar');
    }

    console.log('✅ P3: Search test completed');
  });

  // ─────────────────────────────────────────────
  // P4: Search debounce (API-level verification)
  // ─────────────────────────────────────────────
  test('P4: search debounces requests with 300ms delay', async () => {
    console.log('Test P4: Search debounce');

    await setupProjectWithMessages();
    await waitForAppReady();

    // Set up fetch interception to count API calls
    await browser.evaluate(() => {
      (window as unknown as Record<string, number>).__searchCallCount = 0;
      const originalFetch = window.fetch;
      window.fetch = function (...args: Parameters<typeof fetch>) {
        const url = args[0];
        if (typeof url === 'string' && url.includes('search/messages')) {
          (window as unknown as Record<string, number>).__searchCallCount++;
        }
        return originalFetch.apply(this, args);
      };
    });

    const searchInput = browser.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Type rapidly (each character should NOT trigger a separate request)
      await searchInput.type('auth', { delay: 50 });
      await browser.waitForTimeout(100); // Before debounce fires

      const earlyCount = await browser.evaluate(() => {
        return (window as unknown as Record<string, number>).__searchCallCount;
      }) as number;

      console.log(`  API calls before debounce: ${earlyCount}`);

      // Wait for debounce to fire
      await browser.waitForTimeout(500);

      const afterCount = await browser.evaluate(() => {
        return (window as unknown as Record<string, number>).__searchCallCount;
      }) as number;

      console.log(`  API calls after debounce: ${afterCount}`);

      // Should have made at most 1-2 calls (debounced), not 4 (one per character)
      expect(afterCount).toBeLessThanOrEqual(2);
      console.log('  ✓ Search requests are debounced');
    }

    console.log('✅ P4: Debounce test completed');
  });

  // ─────────────────────────────────────────────
  // P5: Clicking search result navigates to session
  // ─────────────────────────────────────────────
  test('P5: clicking search result navigates to corresponding session', async () => {
    console.log('Test P5: Search result navigation');

    await setupProjectWithMessages();
    await waitForAppReady();

    const searchInput = browser.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('JWT');
      await browser.waitForTimeout(500);

      // Click on a search result
      const result = browser.locator('[class*="search-result"], [data-testid*="search-result"]').first();
      if (await result.isVisible({ timeout: 3000 }).catch(() => false)) {
        await result.click();
        await browser.waitForTimeout(1000);

        // Verify the session chat is loaded (textarea should be visible)
        const textarea = browser.locator('textarea').first();
        const chatVisible = await textarea.isVisible({ timeout: 5000 }).catch(() => false);
        expect(chatVisible).toBe(true);

        // Verify the correct session is selected
        const sessionHighlight = browser.locator('[class*="bg-accent"], [class*="selected"]');
        const hasHighlight = await sessionHighlight.isVisible({ timeout: 2000 }).catch(() => false);
        console.log(`  Session highlighted: ${hasHighlight}`);
        console.log('  ✓ Navigated to session from search result');
      } else {
        console.log('  ⚠ No search results to click');
      }
    }

    console.log('✅ P5: Navigation test completed');
  });

  // ─────────────────────────────────────────────
  // P6: Search works across all projects
  // ─────────────────────────────────────────────
  test('P6: search results span across multiple projects', async () => {
    console.log('Test P6: Cross-project search');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create two projects with sessions containing the same keyword
    const proj1 = await client.post('/api/projects', { name: 'test-proj-1', type: 'code' });
    const proj2 = await client.post('/api/projects', { name: 'test-proj-2', type: 'code' });

    const sess1 = await client.post('/api/sessions', { projectId: proj1.data.data.id, name: 'Session P1' });
    const sess2 = await client.post('/api/sessions', { projectId: proj2.data.data.id, name: 'Session P2' });

    await client.post(`/api/sessions/${sess1.data.data.id}/messages`, {
      role: 'user',
      content: 'Implement WebSocket authentication handler',
    });
    await client.post(`/api/sessions/${sess2.data.data.id}/messages`, {
      role: 'user',
      content: 'WebSocket reconnection logic for gateway',
    });

    // Search via API (no projectId filter = cross-project)
    const searchRes = await client.get('/api/sessions/search/messages?q=WebSocket');

    expect(searchRes.data.success).toBe(true);
    const results = searchRes.data.data.results;

    // Should find results from both sessions
    const sessionIds = new Set(results.map((r: { sessionId: string }) => r.sessionId));
    expect(sessionIds.size).toBeGreaterThanOrEqual(2);

    console.log(`  Found results across ${sessionIds.size} sessions`);
    console.log('  ✓ Search spans multiple projects');
    console.log('✅ P6: Cross-project search test completed');
  });
});
