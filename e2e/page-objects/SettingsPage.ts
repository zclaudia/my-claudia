import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Settings panel
 * Based on actual UI components from SettingsPanel.tsx
 */
export class SettingsPage {
  readonly page: Page;

  // Tab navigation - using actual data-testid from SettingsPanel.tsx
  readonly generalTab: Locator;
  readonly clientAiTab: Locator;
  readonly connectionsTab: Locator;
  readonly providersTab: Locator;
  readonly notificationsTab: Locator;
  readonly gatewayTab: Locator;
  readonly importTab: Locator;

  // Connection mode settings - from ConnectionSettings.tsx
  readonly connectionModeSelector: Locator;
  readonly connectionModeLocal: Locator;
  readonly connectionModeRemote: Locator;
  readonly connectionModeGateway: Locator;

  // Gateway settings - from ServerGatewayConfig.tsx
  readonly proxyUrlInput: Locator;
  readonly proxyUsernameInput: Locator;
  readonly proxyPasswordInput: Locator;
  readonly saveGatewayConfigButton: Locator;

  // Server selector - from ServerSelector.tsx
  readonly serverSelector: Locator;
  readonly connectionStatus: Locator;

  // Provider settings - from ProviderManager.tsx
  readonly providerList: Locator;
  readonly addProviderButton: Locator;

  // Action buttons
  readonly saveButton: Locator;
  readonly resetButton: Locator;
  readonly lastSaved: Locator;

  constructor(page: Page) {
    this.page = page;

    // Tab navigation - from SettingsPanel.tsx line 244-258
    this.generalTab = page.locator('[data-testid="general-tab"]').first();
    this.clientAiTab = page.locator('[data-testid="client-ai-tab"]').first();
    this.connectionsTab = page.locator('[data-testid="connections-tab"]').first();
    this.providersTab = page.locator('[data-testid="providers-tab"]').first();
    this.notificationsTab = page.locator('[data-testid="notifications-tab"]').first();
    this.gatewayTab = page.locator('[data-testid="gateway-tab"]').first();
    this.importTab = page.locator('[data-testid="import-tab"]').first();

    // Connection mode - from ConnectionSettings.tsx
    this.connectionModeSelector = page.locator('[data-testid="connection-mode-selector"]').first();
    this.connectionModeLocal = page.locator('[data-testid="connection-mode-local"]').first();
    this.connectionModeRemote = page.locator('[data-testid="connection-mode-remote"]').first();
    this.connectionModeGateway = page.locator('[data-testid="connection-mode-gateway"]').first();

    // Gateway settings - from ServerGatewayConfig.tsx
    this.proxyUrlInput = page.locator('[data-testid="proxy-url-input"]').first();
    this.proxyUsernameInput = page.locator('[data-testid="proxy-username-input"]').first();
    this.proxyPasswordInput = page.locator('[data-testid="proxy-password-input"]').first();
    this.saveGatewayConfigButton = page.locator('[data-testid="save-gateway-config"]').first();

    // Server selector - from ServerSelector.tsx
    this.serverSelector = page.locator('[data-testid="server-selector"]').first();
    this.connectionStatus = page.locator('[data-testid="connection-status"]').first();

    // Provider settings - from ProviderManager.tsx
    this.providerList = page.locator('[data-testid="provider-list"]').first();
    this.addProviderButton = page.locator('button:has-text("Add Provider")').first();

    // Action buttons
    this.saveButton = page.locator('button:has-text("Save")').first();
    this.resetButton = page.locator('button:has-text("Reset")').first();
    this.lastSaved = page.locator('text=/Last saved|Saved/i').first();
  }

  /**
   * Open the settings panel
   */
  async open(): Promise<void> {
    const settingsButton = this.page.locator('[data-testid="settings-button"]').first();
    await settingsButton.click();

    // Wait for settings panel to appear
    const settingsPanel = this.page.locator('[role="dialog"]').first();
    await settingsPanel.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Close the settings panel
   */
  async close(): Promise<void> {
    const closeButton = this.page.locator('button[title="Close"]').first();
    await closeButton.click();

    // Wait for settings panel to disappear
    const settingsPanel = this.page.locator('[role="dialog"]').first();
    await settingsPanel.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Navigate to a specific tab
   */
  async goToTab(tabName: string): Promise<void> {
    const tabMap: Record<string, Locator> = {
      general: this.generalTab,
      'client-ai': this.clientAiTab,
      connections: this.connectionsTab,
      providers: this.providersTab,
      notifications: this.notificationsTab,
      gateway: this.gatewayTab,
      import: this.importTab,
    };

    const tab = tabMap[tabName.toLowerCase()];
    if (tab) {
      await tab.click();
    } else {
      throw new Error(`Unknown tab: ${tabName}`);
    }
  }

  /**
   * Set connection mode
   */
  async setConnectionMode(mode: 'local' | 'remote' | 'gateway'): Promise<void> {
    const modeMap: Record<string, Locator> = {
      local: this.connectionModeLocal,
      remote: this.connectionModeRemote,
      gateway: this.connectionModeGateway,
    };

    const modeButton = modeMap[mode];
    if (modeButton) {
      await modeButton.click();
    } else {
      throw new Error(`Unknown connection mode: ${mode}`);
    }
  }

  /**
   * Configure gateway connection
   */
  async configureGateway(url: string, username?: string, password?: string): Promise<void> {
    await this.proxyUrlInput.fill(url);

    if (username) {
      await this.proxyUsernameInput.fill(username);
    }

    if (password) {
      await this.proxyPasswordInput.fill(password);
    }

    await this.saveGatewayConfigButton.click();
  }

  /**
   * Connect to a server
   */
  async connectToServer(): Promise<void> {
    await this.serverSelector.click();

    // Wait for connection
    await this.connectionStatus.waitFor({
      state: 'visible',
      timeout: 10000
    });
  }

  /**
   * Disconnect from server
   */
  async disconnectFromServer(): Promise<void> {
    await this.serverSelector.click();

    // Wait for disconnection
    await this.connectionStatus.waitFor({
      state: 'visible',
      timeout: 5000
    });
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

    // Wait for provider dialog
    const providerDialog = this.page.locator('[role="dialog"]').first();
    await providerDialog.waitFor({ state: 'visible', timeout: 5000 });

    const nameInput = this.page.locator('input[placeholder*="Provider name"]').first();
    await nameInput.fill(name);

    const typeSelect = this.page.locator('select').first();
    await typeSelect.selectOption(type);

    if (apiKey) {
      const apiKeyInput = this.page.locator('input[placeholder*="API key"]').first();
      await apiKeyInput.fill(apiKey);
    }

    const saveButton = this.page.locator('button:has-text("Add")').first();
    await saveButton.click();
  }

  /**
   * Remove a provider
   */
  async removeProvider(name: string): Promise<void> {
    const providerItem = this.page.locator(`text="${name}"`).first();
    await providerItem.hover();

    const deleteButton = this.page.locator(`button[title="Delete ${name}"]`).first();
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = this.page.locator('button:has-text("Confirm")').first();
    const isVisible = await confirmButton.isVisible().catch(() => false);

    if (isVisible) {
      await confirmButton.click();
    }
  }

  /**
   * Get provider count
   */
  async getProviderCount(): Promise<number> {
    return await this.page.locator('[class*="provider-item"]').count();
  }

  /**
   * Set default provider
   */
  async setDefaultProvider(name: string): Promise<void> {
    const providerItem = this.page.locator(`text="${name}"`).first();
    await providerItem.hover();

    const setDefaultButton = this.page.locator('button[title="Set as default"]').first();
    await setDefaultButton.click();
  }

  /**
   * Toggle a setting
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
