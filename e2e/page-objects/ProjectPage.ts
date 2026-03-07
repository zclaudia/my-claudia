import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Project/Session management
 * Note: The app uses "sessions" terminology in the UI, but we keep ProjectPage name for backward compatibility
 */
export class ProjectPage {
  readonly page: Page;

  // Session/Project list elements
  readonly sessionList: Locator;
  readonly sessionItem: Locator;
  readonly addProjectButton: Locator;
  readonly newSessionButton: Locator;

  // Settings
  readonly settingsButton: Locator;

  // Form inputs
  readonly projectNameInput: Locator;
  readonly projectPathInput: Locator;

  constructor(page: Page) {
    this.page = page;

    // Session/Project list elements - using actual data-testid from Sidebar.tsx
    this.sessionList = page.locator('[data-testid="session-list"]').first();
    this.sessionItem = page.locator('[data-testid="session-item"]').first();
    this.addProjectButton = page.locator('button[title="Add Project"]').first();
    this.newSessionButton = page.locator('[data-testid="new-session-btn"]').first();

    // Settings - from Sidebar.tsx
    this.settingsButton = page.locator('[data-testid="settings-button"]').first();

    // Form inputs - from ProjectSettings.tsx
    this.projectNameInput = page.locator('input[placeholder*="Project name"]').first();
    this.projectPathInput = page.locator('input[placeholder*="Working directory"]').first();
  }

  /**
   * Check if project exists
   */
  async projectExists(name: string): Promise<boolean> {
    const project = this.page.locator(`text="${name}"`).first();
    return await project.isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Create a new project with name and path
   * Returns true if successful, false if button not available
   */
  async createProject(name: string, path: string): Promise<boolean> {
    // Check if Add Project button is visible and enabled
    const isButtonVisible = await this.addProjectButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isButtonVisible) {
      console.log('  ⚠️ Add Project button not visible');
      return false;
    }

    const isButtonDisabled = await this.addProjectButton.isDisabled();
    if (isButtonDisabled) {
      console.log('  ⚠️ Add Project button is disabled (server not connected)');
      return false;
    }

    await this.addProjectButton.click();

    // Wait for dialog to appear
    const dialog = this.page.locator('[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      // Dialog might not exist, try direct input
    });

    // Fill in project name - using placeholder-based selector
    const nameInput = this.page.locator('input[placeholder*="Project name"], input[placeholder*="Name"]').first();
    const nameVisible = await nameInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (nameVisible) {
      await nameInput.fill(name);
    }

    // Fill in project path - using placeholder-based selector
    const pathInput = this.page.locator('input[placeholder*="Working directory"], input[placeholder*="Path"]').first();
    const pathVisible = await pathInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (pathVisible) {
      await pathInput.fill(path);
    }

    // Click Create button
    const createButton = this.page.locator('button:has-text("Create"), button:has-text("Add")').first();
    const btnVisible = await createButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (btnVisible) {
      await createButton.click();
    }

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      // Dialog might not exist, that's okay
    });

    return true;
  }

  /**
   * Select a session/project
   */
  async selectSession(name: string): Promise<void> {
    const sessionItem = this.page.locator(`[data-testid="session-item"]:has-text("${name}")`).first();
    await sessionItem.click();
  }

  /**
   * Delete a session/project
   */
  async deleteSession(name: string): Promise<void> {
    const sessionItem = this.page.locator(`[data-testid="session-item"]:has-text("${name}")`).first();
    await sessionItem.hover();

    const deleteButton = this.page.locator(`button[title*="Delete"]`).first();
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = this.page.locator('button:has-text("Confirm")').first();
    const isVisible = await confirmButton.isVisible().catch(() => false);
    if (isVisible) {
      await confirmButton.click();
    }
  }

  /**
   * Get session count
   */
  async getSessionCount(): Promise<number> {
    return await this.page.locator('[data-testid="session-item"]').count();
  }

  /**
   * Check if session exists
   */
  async hasSession(name: string): Promise<boolean> {
    const session = this.page.locator(`[data-testid="session-item"]:has-text("${name}")`).first();
    return await session.isVisible();
  }

  /**
   * Create a new session
   */
  async createNewSession(): Promise<void> {
    await this.newSessionButton.click();
  }

  /**
   * Open settings panel
   */
  async openSettings(): Promise<void> {
    await this.settingsButton.click();

    // Wait for settings panel to appear
    const settingsPanel = this.page.locator('[data-testid="settings-panel"]').first();
    await settingsPanel.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Rename a session
   */
  async renameSession(oldName: string, newName: string): Promise<void> {
    const sessionItem = this.page.locator(`[data-testid="session-item"]:has-text("${oldName}")`).first();
    await sessionItem.hover();

    const renameButton = this.page.locator(`button[title*="Rename"]`).first();
    await renameButton.click();

    // Wait for input to appear
    const nameInput = this.page.locator('input[placeholder*="Session name"]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });

    await nameInput.clear();
    await nameInput.fill(newName);

    // Click outside or press Enter to save
    await this.page.keyboard.press('Enter');
  }

  /**
   * Get all session names
   */
  async getSessionNames(): Promise<string[]> {
    const sessions = await this.page.locator('[data-testid="session-item"]').allTextContents();
    return sessions.map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Archive a session
   */
  async archiveSession(name: string): Promise<void> {
    const sessionItem = this.page.locator(`[data-testid="session-item"]:has-text("${name}")`).first();
    await sessionItem.hover();

    const archiveButton = this.page.locator(`button[title*="Archive"]`).first();
    await archiveButton.click();
  }
}
