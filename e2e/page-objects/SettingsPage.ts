import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Settings interface
 * Encapsulates all settings-related interactions and selectors
 */
export class SettingsPage {
  readonly page: Page;

  // Navigation
  readonly settingsTab: Locator;
  readonly generalSection: Locator;
  readonly connectionSection: Locator;
  readonly providerSection: Locator;

  // Connection settings
  readonly connectionModeSelector: Locator;
  readonly localModeOption: Locator;
  readonly remoteModeOption: Locator;
  readonly gatewayModeOption: Locator;

  // Gateway settings
  readonly gatewayUrlInput: Locator;
  readonly gatewaySecretInput: Locator;
  readonly connectButton: Locator;
  readonly disconnectButton: Locator;

  // Provider settings
  readonly providerList: Locator;
  readonly addProviderButton: Locator;

  // Actions
  readonly saveButton: Locator;
  readonly resetButton: Locator;

  // Status
  readonly connectionStatus: Locator;
  readonly lastSaved: Locator;

  constructor(page: Page) {
    this.page = page;

    // Navigation
    this.settingsTab = page.locator('[data-testid="settings-tab"]').first();
    this.generalSection = page.locator('[data-testid="general-settings"]').first();
    this.connectionSection = page.locator('[data-testid="connection-settings"]').first();
    this.providerSection = page.locator('[data-testid="provider-settings"]').first();

    // Connection settings
    this.connectionModeSelector = page.locator('[data-testid="connection-mode-selector"]').first();
    this.localModeOption = page.locator('[data-testid="connection-mode-local"]').first();
    this.remoteModeOption = page.locator('[data-testid="connection-mode-remote"]').first();
    this.gatewayModeOption = page.locator('[data-testid="connection-mode-gateway"]').first();

    // Gateway settings
    this.gatewayUrlInput = page.locator('input[name="gateway-url"]').first();
    this.gatewaySecretInput = page.locator('input[name="gateway-secret"]').first();
    this.connectButton = page.locator('button:has-text("Connect")').first();
    this.disconnectButton = page.locator('button:has-text("Disconnect")').first();

    // Provider settings
    this.providerList = page.locator('[data-testid="provider-list"]').first();
    this.addProviderButton = page.locator('button[title="Add Provider"]').first();

    // Actions
    this.saveButton = page.locator('button:has-text("Save")').first();
    this.resetButton = page.locator('button:has-text("Reset")').first();

    // Status
    this.connectionStatus = page.locator('.connection-status').first();
    this.lastSaved = page.locator('.last-saved').first();
  }

  /**
   * Navigate to settings tab
   */
  async navigateToSettings(): Promise<void> {
    await this.settingsTab.click();
  }

  /**
   * Select connection mode
   */
  async selectConnectionMode(mode: 'local' | 'remote' | 'gateway'): Promise<void> {
    await this.connectionModeSelector.click();

    switch (mode) {
      case 'local':
        await this.localModeOption.click();
        break;
      case 'remote':
        await this.remoteModeOption.click();
        break;
      case 'gateway':
        await this.gatewayModeOption.click();
        break;
    }
  }

  /**
   * Configure gateway connection
   */
  async configureGateway(url: string, secret: string): Promise<void> {
    await this.gatewayUrlInput.fill(url);
    await this.gatewaySecretInput.fill(secret);
  }

  /**
   * Connect to gateway
   */
  async connectToGateway(): Promise<void> {
    await this.connectButton.click();

    // Wait for connection status to update
    await this.connectionStatus.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Disconnect from gateway
   */
  async disconnectFromGateway(): Promise<void> {
    await this.disconnectButton.click();
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<string> {
    return await this.connectionStatus.textContent() || '';
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    const status = await this.getConnectionStatus();
    return status.toLowerCase().includes('connected');
  }

  /**
   * Save settings
   */
  async saveSettings(): Promise<void> {
    await this.saveButton.click();

    // Wait for save confirmation
    await this.lastSaved.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings(): Promise<void> {
    await this.resetButton.click();

    // Confirm reset if dialog appears
    const confirmButton = this.page.locator('button:has-text("Confirm")').first();
    const isVisible = await confirmButton.isVisible().catch(() => false);

    if (isVisible) {
      await confirmButton.click();
    }
  }

  /**
   * Add a new provider
   */
  async addProvider(name: string, type: string, apiKey?: string): Promise<void> {
    await this.addProviderButton.click();

    const nameInput = this.page.locator('input[name="provider-name"]').first();
    await nameInput.fill(name);

    const typeSelect = this.page.locator('select[name="provider-type"]').first();
    await typeSelect.selectOption(type);

    if (apiKey) {
      const apiKeyInput = this.page.locator('input[name="api-key"]').first();
      await apiKeyInput.fill(apiKey);
    }

    const saveButton = this.page.locator('button:has-text("Save")').first();
    await saveButton.click();
  }

  /**
   * Remove a provider
   */
  async removeProvider(name: string): Promise<void> {
    const providerItem = this.providerList.locator(`text="${name}"`).first();
    await providerItem.hover();

    const deleteButton = this.page.locator(`button[title="Delete ${name}"]`).first();
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = this.page.locator('button:has-text("Confirm")').first();
    await confirmButton.click();
  }

  /**
   * Get provider count
   */
  async getProviderCount(): Promise<number> {
    const providers = await this.providerList.locator('.provider-item').count();
    return providers;
  }

  /**
   * Set default provider
   */
  async setDefaultProvider(name: string): Promise<void> {
    const providerItem = this.providerList.locator(`text="${name}"`).first();
    await providerItem.hover();

    const setDefaultButton = this.page.locator('button[title="Set as default"]').first();
    await setDefaultButton.click();
  }

  /**
   * Update a setting value
   */
  async updateSetting(key: string, value: string): Promise<void> {
    const settingInput = this.page.locator(`input[name="${key}"]`).first();
    await settingInput.clear();
    await settingInput.fill(value);
  }

  /**
   * Get setting value
   */
  async getSetting(key: string): Promise<string> {
    const settingInput = this.page.locator(`input[name="${key}"]`).first();
    return await settingInput.inputValue();
  }

  /**
   * Toggle a boolean setting
   */
  async toggleSetting(key: string): Promise<void> {
    const toggle = this.page.locator(`[data-testid="toggle-${key}"]`).first();
    await toggle.click();
  }

  /**
   * Check if setting is enabled
   */
  async isSettingEnabled(key: string): Promise<boolean> {
    const toggle = this.page.locator(`[data-testid="toggle-${key}"]`).first();
    const isChecked = await toggle.getAttribute('aria-checked');
    return isChecked === 'true';
  }
}
