import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Permission dialog
 * Based on PermissionModal.tsx
 */
export class PermissionPage {
  readonly page: Page;

  // Dialog elements
  readonly permissionDialog: Locator;
  readonly allowButton: Locator;
  readonly denyButton: Locator;
  readonly toolName: Locator;
  readonly permissionMessage: Locator;

  // Form elements
  readonly credentialInput: Locator;
  readonly rememberCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;

    // Dialog container - from PermissionModal.tsx
    this.permissionDialog = page.locator('[data-testid="permission-dialog"]').first();

    // Action buttons - from PermissionModal.tsx
    this.allowButton = page.locator('button:has-text("Allow")').first();
    this.denyButton = page.locator('button:has-text("Deny")').first();

    // Tool name display
    this.toolName = page.locator('[data-testid="permission-dialog"] span.font-mono').first();

    // Permission message
    this.permissionMessage = page.locator('[data-testid="permission-dialog"] p').first();

    // Form elements
    this.credentialInput = page.locator('[data-testid="permission-dialog"] input[type="password"]').first();
    this.rememberCheckbox = page.locator('[data-testid="permission-dialog"] input[type="checkbox"]').first();
  }

  /**
   * Allow the permission
   */
  async allow(remember = false): Promise<void> {
    if (remember) {
      await this.rememberCheckbox.check();
    }
    await this.allowButton.click();
  }

  /**
   * Deny the permission
   */
  async deny(remember = false): Promise<void> {
    if (remember) {
      await this.rememberCheckbox.check();
    }
    await this.denyButton.click();
  }

  /**
   * Enter credential
   */
  async enterCredential(credential: string): Promise<void> {
    await this.credentialInput.fill(credential);
  }

  /**
   * Check if dialog is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.permissionDialog.isVisible();
  }

  /**
   * Wait for dialog to appear
   */
  async waitForDialog(timeout = 10000): Promise<void> {
    await this.permissionDialog.waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait for dialog to close
   */
  async waitForClose(timeout = 5000): Promise<void> {
    await this.permissionDialog.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Get tool name from permission request
   */
  async getToolName(): Promise<string> {
    return await this.toolName.textContent() || '';
  }

  /**
   * Get permission message text
   */
  async getPermissionMessage(): Promise<string> {
    return await this.permissionMessage.textContent() || '';
  }
}
