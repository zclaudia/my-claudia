import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Project Management interface
 * Encapsulates all project-related interactions and selectors
 */
export class ProjectPage {
  readonly page: Page;

  // Navigation elements
  readonly projectList: Locator;
  readonly addProjectButton: Locator;

  // Form elements
  readonly projectNameInput: Locator;
  readonly projectPathInput: Locator;
  readonly createProjectButton: Locator;
  readonly cancelButton: Locator;

  // Status elements
  readonly connectionStatus: Locator;

  constructor(page: Page) {
    this.page = page;

    // Navigation elements
    this.projectList = page.locator('[data-testid="project-list"]').first();
    this.addProjectButton = page.locator('button[title="Add Project"]').first();

    // Form elements
    this.projectNameInput = page.locator('input[placeholder*="Project name"]').first();
    this.projectPathInput = page.locator('input[placeholder*="Project path"]').first();
    this.createProjectButton = page.locator('button:has-text("Create")').first();
    this.cancelButton = page.locator('button:has-text("Cancel")').first();

    // Status elements
    this.connectionStatus = page.locator('.connection-status').first();
  }

  /**
   * Create a new project
   */
  async createProject(name: string, path: string): Promise<void> {
    await this.addProjectButton.click();

    await this.projectNameInput.fill(name);
    await this.projectPathInput.fill(path);

    await this.createProjectButton.click();

    // Wait for project to appear in list
    await this.page.locator(`text="${name}"`).waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Select a project from the list
   */
  async selectProject(name: string): Promise<void> {
    const projectItem = this.projectList.locator(`text="${name}"`).first();
    await projectItem.click();
  }

  /**
   * Delete a project
   */
  async deleteProject(name: string): Promise<void> {
    // Find project item
    const projectItem = this.projectList.locator(`text="${name}"`).first();
    await projectItem.hover();

    // Click delete button
    const deleteButton = this.page.locator(`button[title="Delete ${name}"]`).first();
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = this.page.locator('button:has-text("Confirm")').first();
    await confirmButton.click();

    // Wait for project to disappear
    await this.page.locator(`text="${name}"`).waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Check if project exists in list
   */
  async projectExists(name: string): Promise<boolean> {
    const projectItem = this.page.locator(`text="${name}"`).first();
    return await projectItem.isVisible();
  }

  /**
   * Get all project names
   */
  async getProjectNames(): Promise<string[]> {
    const projectItems = await this.projectList.locator('.project-item').allTextContents();
    return projectItems;
  }

  /**
   * Get project count
   */
  async getProjectCount(): Promise<number> {
    const projects = await this.projectList.locator('.project-item').count();
    return projects;
  }

  /**
   * Rename a project
   */
  async renameProject(oldName: string, newName: string): Promise<void> {
    const projectItem = this.projectList.locator(`text="${oldName}"`).first();
    await projectItem.click();

    // Click rename button or edit icon
    const renameButton = this.page.locator('button[title="Rename"]').first();
    await renameButton.click();

    // Clear and type new name
    const nameInput = this.page.locator('input[value="' + oldName + '"]').first();
    await nameInput.clear();
    await nameInput.fill(newName);

    // Save
    await this.page.keyboard.press('Enter');
  }

  /**
   * Get project status
   */
  async getProjectStatus(name: string): Promise<string> {
    const projectItem = this.projectList.locator(`text="${name}"`).first();
    const statusBadge = projectItem.locator('.status-badge');
    return await statusBadge.textContent() || '';
  }

  /**
   * Check if connected to project
   */
  async isConnected(name: string): Promise<boolean> {
    const status = await this.getProjectStatus(name);
    return status.toLowerCase().includes('connected');
  }

  /**
   * Open project settings
   */
  async openProjectSettings(name: string): Promise<void> {
    const projectItem = this.projectList.locator(`text="${name}"`).first();
    await projectItem.hover();

    const settingsButton = this.page.locator('button[title="Settings"]').first();
    await settingsButton.click();
  }

  /**
   * Filter projects by name
   */
  async filterProjects(searchTerm: string): Promise<void> {
    const searchInput = this.page.locator('input[placeholder*="Search projects"]').first();
    await searchInput.fill(searchTerm);
  }

  /**
   * Clear project filter
   */
  async clearFilter(): Promise<void> {
    const searchInput = this.page.locator('input[placeholder*="Search projects"]').first();
    await searchInput.clear();
  }
}
