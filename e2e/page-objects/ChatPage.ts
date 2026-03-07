import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the Chat interface
 * Encapsulates all chat-related interactions and selectors
 */
export class ChatPage {
  readonly page: Page;

  // Input elements
  readonly messageInput: Locator;
  readonly sendButton: Locator;

  // Display elements
  readonly messageList: Locator;
  readonly userMessages: Locator;
  readonly assistantMessages: Locator;

  // Tool call elements
  readonly toolCallItem: Locator;
  readonly toolResult: Locator;
  readonly toolName: Locator;

  // File operations
  readonly fileUploadInput: Locator;
  readonly fileReferenceTrigger: Locator;

  constructor(page: Page) {
    this.page = page;

    // Input elements - using actual data-testid from UI
    this.messageInput = page.locator('[data-testid="message-input"]').first();
    this.sendButton = page.locator('[data-testid="send-button"]').first();

    // Display elements - using actual data-role from MessageList.tsx
    this.messageList = page.locator('[data-testid="message-list"]').first();
    this.userMessages = page.locator('[data-role="user"]');
    this.assistantMessages = page.locator('[data-role="assistant"]');

    // Tool call elements - from ToolCallItem.tsx
    this.toolCallItem = page.locator('[data-testid="tool-use"]');
    this.toolResult = page.locator('[data-testid="tool-result"]');
    this.toolName = page.locator('[data-testid="tool-name"]');

    // File operations
    this.fileUploadInput = page.locator('input[type="file"]').first();
    this.fileReferenceTrigger = page.locator('[data-testid="file-reference-trigger"]').first();
  }

  /**
   * Send a text message
   */
  async sendMessage(message: string): Promise<void> {
    await this.messageInput.fill(message);
    await this.sendButton.click();
  }

  /**
   * Wait for assistant response
   */
  async waitForResponse(timeout = 10000): Promise<void> {
    await this.assistantMessages.last().waitFor({
      state: 'visible',
      timeout
    });
  }

  /**
   * Get the last message content
   */
  async getLastMessage(): Promise<string> {
    const lastMessage = this.messageList.locator('[data-role="assistant"], [data-role="user"]').last();
    return await lastMessage.textContent() || '';
  }

  /**
   * Get all user messages
   */
  async getUserMessages(): Promise<string[]> {
    const messages = await this.userMessages.allTextContents();
    return messages;
  }

  /**
   * Get all assistant messages
   */
  async getAssistantMessages(): Promise<string[]> {
    const messages = await this.assistantMessages.allTextContents();
    return messages;
  }

  /**
   * Upload a file
   */
  async uploadFile(filePath: string): Promise<void> {
    await this.fileUploadInput.setInputFiles(filePath);
  }

  /**
   * Reference a file using @ mention
   */
  async referenceFile(fileName: string): Promise<void> {
    // Type @ to trigger file reference popup
    await this.messageInput.fill('@');

    // Wait for file list to appear
    const fileOption = this.page.locator(`text="${fileName}"`).first();
    await fileOption.waitFor({ state: 'visible', timeout: 5000 });

    // Click on the file
    await fileOption.click();
  }

  /**
   * Check if code block is visible
   */
  async hasCodeBlock(): Promise<boolean> {
    const codeBlock = this.page.locator('pre code').first();
    return await codeBlock.isVisible();
  }

  /**
   * Check if message contains specific text
   */
  async messageContains(text: string): Promise<boolean> {
    const lastMessage = await this.getLastMessage();
    return lastMessage.includes(text);
  }

  /**
   * Clear the message input
   */
  async clearInput(): Promise<void> {
    await this.messageInput.clear();
  }

  /**
   * Get message count
   */
  async getMessageCount(): Promise<number> {
    const messages = await this.page.locator('[data-role="user"], [data-role="assistant"]').count();
    return messages;
  }

  /**
   * Wait for message input to be enabled
   */
  async waitForInputEnabled(timeout = 5000): Promise<void> {
    await this.messageInput.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if send button is enabled
   */
  async isSendButtonEnabled(): Promise<boolean> {
    return await this.sendButton.isEnabled();
  }

  /**
   * Check if tool calls are visible
   */
  async hasToolCalls(): Promise<boolean> {
    return await this.toolCallItem.first().isVisible();
  }

  /**
   * Get tool call count
   */
  async getToolCallCount(): Promise<number> {
    return await this.toolCallItem.count();
  }

  /**
   * Get last tool name
   */
  async getLastToolName(): Promise<string> {
    const lastToolName = this.toolName.last();
    return await lastToolName.textContent() || '';
  }
}
