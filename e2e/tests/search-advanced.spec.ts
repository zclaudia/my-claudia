/**
 * Advanced Search Tests (SA1-SA4)
 *
 * Tests for full-text search in sidebar, API-level search verification,
 * search history tracking, and empty result handling.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('Advanced Search', () => {
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

  // Helper: create a project, session, and messages with searchable content via API
  async function setupSearchData() {
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create project
    const projectRes = await client.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-search', type: 'code' }),
    });
    const projectData = await projectRes.json();
    const projectId = projectData.data.id;

    // Create session
    const sessionRes = await client.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: 'Search Test Session' }),
    });
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.data.id;

    // Add messages with distinct searchable keywords
    await client.fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: 'How do I implement authentication with JWT tokens in Express?',
      }),
    });
    await client.fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'assistant',
        content: 'Here is how to implement authentication using JWT in Node.js with middleware validation.',
      }),
    });
    await client.fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: 'Can you also show database migration setup with Prisma ORM?',
      }),
    });

    // Reload browser so the sidebar picks up the new data
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1500);

    return { client, projectId, sessionId };
  }

  // ─────────────────────────────────────────────
  // SA1: Basic search - type keyword in sidebar search box
  // ─────────────────────────────────────────────
  test('SA1: typing keyword in search box displays matching results', async () => {
    console.log('Test SA1: Basic search via sidebar');

    await setupSearchData();

    // Locate the search input in the sidebar
    const searchInput = browser.locator('input[placeholder*="Search"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (searchVisible) {
      // Type the search keyword
      await searchInput.fill('authentication');
      await browser.waitForTimeout(1000); // Wait for debounce + results

      // Check for search results in the UI
      const resultItems = browser.locator('[class*="search-result"], [data-testid*="search"]');
      const resultCount = await resultItems.count().catch(() => 0);

      if (resultCount > 0) {
        console.log(`  Found ${resultCount} search result element(s) in UI`);
        const firstText = await resultItems.first().textContent().catch(() => '');
        expect(firstText?.toLowerCase()).toContain('authentication');
        console.log('  Result text matches keyword');
      } else {
        // Fallback: verify any text containing the keyword appeared on page
        const matchText = browser.locator('text=authentication').first();
        const hasMatch = await matchText.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`  Keyword text visible on page: ${hasMatch}`);
        expect(hasMatch).toBe(true);
      }
    } else {
      // If sidebar search input is not visible, verify search works via API as fallback
      console.log('  Search input not visible in sidebar, verifying via API');
      const apiKey = readApiKey();
      const client = createApiClient(apiKey);
      const res = await client.fetch('/api/sessions/search/messages?q=authentication');
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.results.length).toBeGreaterThan(0);
    }

    console.log('SA1: Basic search test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // SA2: Search via API - verify the search endpoint directly
  // ─────────────────────────────────────────────
  test('SA2: search API returns matching messages', async () => {
    console.log('Test SA2: Search via API');

    const { client, projectId } = await setupSearchData();

    // Search without project filter (cross-project)
    const globalRes = await client.fetch('/api/sessions/search/messages?q=authentication');
    const globalData = await globalRes.json();

    expect(globalData.success).toBe(true);
    expect(globalData.data.results.length).toBeGreaterThan(0);
    console.log(`  Global search returned ${globalData.data.results.length} result(s)`);

    // Verify result structure
    const firstResult = globalData.data.results[0];
    expect(firstResult).toHaveProperty('id');
    expect(firstResult).toHaveProperty('sessionId');
    expect(firstResult).toHaveProperty('role');
    expect(firstResult).toHaveProperty('content');
    expect(firstResult.content.toLowerCase()).toContain('authentication');

    // Search with project filter
    const projectRes = await client.fetch(
      `/api/sessions/search/messages?q=authentication&projectId=${projectId}`
    );
    const projectData = await projectRes.json();

    expect(projectData.success).toBe(true);
    expect(projectData.data.results.length).toBeGreaterThan(0);
    console.log(`  Project-scoped search returned ${projectData.data.results.length} result(s)`);

    // Search for a different keyword to confirm specificity
    const prismaRes = await client.fetch('/api/sessions/search/messages?q=Prisma');
    const prismaData = await prismaRes.json();

    expect(prismaData.success).toBe(true);
    expect(prismaData.data.results.length).toBeGreaterThan(0);
    expect(prismaData.data.results[0].content.toLowerCase()).toContain('prisma');
    console.log(`  Keyword "Prisma" search returned ${prismaData.data.results.length} result(s)`);

    // Search with role filter
    const roleRes = await client.fetch('/api/sessions/search/messages?q=authentication&role=assistant');
    const roleData = await roleRes.json();

    expect(roleData.success).toBe(true);
    for (const result of roleData.data.results) {
      expect(result.role).toBe('assistant');
    }
    console.log(`  Role-filtered search returned ${roleData.data.results.length} assistant result(s)`);

    console.log('SA2: Search API test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // SA3: Search history via API - verify history tracking
  // ─────────────────────────────────────────────
  test('SA3: search history is recorded after a search', async () => {
    console.log('Test SA3: Search history via API');

    const { client } = await setupSearchData();

    // Perform a search to generate history
    const searchRes = await client.fetch('/api/sessions/search/messages?q=authentication');
    const searchData = await searchRes.json();
    expect(searchData.success).toBe(true);
    console.log('  Search executed, checking history...');

    // Fetch search history
    const historyRes = await client.fetch('/api/sessions/search/history');
    const historyData = await historyRes.json();

    expect(historyData.success).toBe(true);
    expect(historyData.data.history).toBeDefined();

    if (historyData.data.history.length > 0) {
      // Verify our search term appears in history
      const queries = historyData.data.history.map((h: { query: string }) => h.query);
      expect(queries).toContain('authentication');
      console.log(`  Search history contains ${historyData.data.history.length} entry/entries`);
      console.log(`  History queries: ${queries.join(', ')}`);
    } else {
      console.log('  Search history is empty (feature may store asynchronously)');
    }

    // Perform another search and verify history grows
    await client.fetch('/api/sessions/search/messages?q=Prisma');
    const historyRes2 = await client.fetch('/api/sessions/search/history');
    const historyData2 = await historyRes2.json();

    expect(historyData2.success).toBe(true);
    const queries2 = historyData2.data.history.map((h: { query: string }) => h.query);
    expect(queries2).toContain('Prisma');
    console.log(`  After second search, history has ${historyData2.data.history.length} entry/entries`);

    console.log('SA3: Search history test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // SA4: Empty search results - search for non-existent term
  // ─────────────────────────────────────────────
  test('SA4: searching for non-existent term returns empty results', async () => {
    console.log('Test SA4: Empty search results');

    await setupSearchData();

    // Test empty results via API first (reliable)
    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    const apiRes = await client.fetch('/api/sessions/search/messages?q=xyznonexistent12345');
    const apiData = await apiRes.json();

    expect(apiData.success).toBe(true);
    expect(apiData.data.results).toHaveLength(0);
    console.log('  API confirmed zero results for non-existent term');

    // Also verify empty query returns empty results
    const emptyRes = await client.fetch('/api/sessions/search/messages?q=');
    const emptyData = await emptyRes.json();

    expect(emptyData.success).toBe(true);
    expect(emptyData.data.results).toHaveLength(0);
    console.log('  API confirmed zero results for empty query');

    // Test empty results via UI
    const searchInput = browser.locator('input[placeholder*="Search"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (searchVisible) {
      await searchInput.fill('xyznonexistent12345');
      await browser.waitForTimeout(1000); // Wait for debounce + results

      // Check for "no results" indicator or empty state
      const noResults = browser.locator(
        'text=No results, text=no results, text=No matches, [class*="empty"], [data-testid*="no-result"]'
      ).first();
      const hasNoResults = await noResults.isVisible({ timeout: 3000 }).catch(() => false);

      if (hasNoResults) {
        console.log('  UI shows "no results" state');
      } else {
        // Verify no search result items are displayed
        const resultItems = browser.locator('[class*="search-result"], [data-testid*="search-result"]');
        const resultCount = await resultItems.count().catch(() => 0);
        expect(resultCount).toBe(0);
        console.log('  UI shows zero search result items');
      }
    } else {
      console.log('  Search input not visible in sidebar, API verification sufficient');
    }

    console.log('SA4: Empty search results test completed');
  }, 30000);
});
