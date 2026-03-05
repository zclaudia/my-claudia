# Playwright Migration Guide

## 概述

本指南说明如何将现有测试从 **Vitest + BrowserAdapter** 迁移到 **标准 Playwright**。

---

## 迁移对比

### 旧代码（Vitest + BrowserAdapter）

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB } from '../helpers/setup';

describe('My Test', () => {
  let browser: BrowserAdapter;

  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser({ headless: true });
    await browser.goto('/');
  });

  afterEach(async () => {
    await browser?.close();
  });

  test('should work', async () => {
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Hello');
    // ...
  });
});
```

### 新代码（标准 Playwright）

```typescript
import { test, expect } from '../fixtures/test-fixtures';
import { ChatPage } from '../page-objects';

test.describe('My Test', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page, cleanDb }) => {
    chatPage = new ChatPage(page);
    await page.goto('/');
  });

  test('should work', async ({ page }) => {
    await chatPage.sendMessage('Hello');
    // ...
  });
});
```

---

## 主要变化

### 1. 导入语句

**旧**:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
```

**新**:
```typescript
import { test, expect } from '../fixtures/test-fixtures';
import { ChatPage, ProjectPage } from '../page-objects';
```

### 2. 测试设置

**旧**:
```typescript
describe('My Test', () => {
  let browser: BrowserAdapter;

  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser({ headless: true });
    await browser.goto('/');
  });

  afterEach(async () => {
    await browser?.close();
  });
});
```

**新**:
```typescript
test.describe('My Test', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page, cleanDb }) => {
    chatPage = new ChatPage(page);
    await page.goto('/');
  });

  // 不需要 afterEach，Playwright 自动清理
});
```

### 3. 选择器和操作

**旧**:
```typescript
const textarea = browser.locator('textarea').first();
await textarea.fill('Hello');

const sendButton = browser.locator('button[type="submit"]').first();
await sendButton.click();
```

**新** (使用 Page Object Model):
```typescript
await chatPage.sendMessage('Hello');
```

或者直接使用 `page`:
```typescript
const textarea = page.locator('textarea').first();
await textarea.fill('Hello');

const sendButton = page.locator('button[type="submit"]').first();
await sendButton.click();
```

### 4. 断言

**旧**:
```typescript
import { expect } from 'vitest';

expect(isDisabled).toBe(true);
await expect(element).toBeVisible({ timeout: 5000 });
```

**新**:
```typescript
import { expect } from '@playwright/test';

expect(isDisabled).toBe(true);
await expect(element).toBeVisible({ timeout: 5000 });
```

断言 API 几乎相同！

### 5. 等待

**旧**:
```typescript
await browser.waitForTimeout(1000);
await browser.waitForLoadState('networkidle');
```

**新**:
```typescript
await page.waitForTimeout(1000);
await page.waitForLoadState('networkidle');
```

### 6. 数据库清理

**旧**:
```typescript
import { setupCleanDB } from '../helpers/setup';

beforeEach(async () => {
  await setupCleanDB();
});
```

**新**:
```typescript
// 自动通过 test fixture 处理
test.beforeEach(async ({ page, cleanDb }) => {
  // cleanDb 自动清理数据库
});
```

---

## Page Object Model

### 创建 Page Object

```typescript
// e2e/page-objects/ChatPage.ts
import { Page, Locator } from '@playwright/test';

export class ChatPage {
  readonly page: Page;
  readonly messageInput: Locator;
  readonly sendButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.messageInput = page.locator('textarea[placeholder*="Message"]').first();
    this.sendButton = page.locator('button[type="submit"]').first();
  }

  async sendMessage(message: string): Promise<void> {
    await this.messageInput.fill(message);
    await this.sendButton.click();
  }
}
```

### 使用 Page Object

```typescript
import { test, expect } from '../fixtures/test-fixtures';
import { ChatPage } from '../page-objects';

test.describe('Chat Test', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await page.goto('/');
  });

  test('send message', async ({ page }) => {
    await chatPage.sendMessage('Hello');
    // ...
  });
});
```

---

## 运行测试

### 运行所有 Playwright 测试

```bash
pnpm test:e2e:playwright
```

### 运行单个测试文件

```bash
pnpm exec playwright test e2e/tests/chat-core.playwright.spec.ts
```

### UI 模式（可视化调试）

```bash
pnpm test:e2e:playwright:ui
```

### 调试模式

```bash
pnpm test:e2e:playwright:debug
```

### 查看测试报告

```bash
pnpm test:e2e:playwright:report
```

---

## 迁移检查清单

- [ ] 将导入从 `vitest` 改为 `@playwright/test`
- [ ] 将 `describe` 改为 `test.describe`
- [ ] 将 `beforeEach` 改为 `test.beforeEach`
- [ ] 移除 `afterEach`（Playwright 自动清理）
- [ ] 将 `BrowserAdapter` 改为标准 `Page` 对象
- [ ] 使用 `test.beforeEach(async ({ page, cleanDb }) => { ... })`
- [ ] 考虑使用 Page Object Model 封装交互逻辑
- [ ] 测试文件命名：`*.playwright.spec.ts` 以区分新旧测试

---

## 优势对比

| 特性 | 旧方案（Vitest + BrowserAdapter） | 新方案（标准 Playwright） |
|------|----------------------------------|-------------------------|
| **测试速度** | 3-7s/test | 3-7s/test |
| **外部依赖** | OpenAI API | 无 |
| **确定性** | 中等（AI 驱动） | 高（纯代码） |
| **调试工具** | 基础 | Trace Viewer, UI Mode, Codegen |
| **维护难度** | 中等 | 低 |
| **社区支持** | 自定义工具 | 标准 Playwright（大规模社区） |
| **学习曲线** | 需要学习自定义 API | 标准 Playwright API |

---

## 示例对比

查看以下文件对比：

- **旧版本**: `e2e/tests/chat-core.spec.ts`
- **新版本**: `e2e/tests/chat-core.playwright.spec.ts`

---

## 故障排查

### 问题 1: 找不到 page 对象

**错误**:
```
ReferenceError: page is not defined
```

**解决**:
```typescript
// ❌ 错误
test('my test', async () => {
  await page.goto('/');
});

// ✅ 正确
test('my test', async ({ page }) => {
  await page.goto('/');
});
```

### 问题 2: cleanDb 未生效

**错误**:
```
ReferenceError: cleanDb is not defined
```

**解决**:
```typescript
// ❌ 错误
test.beforeEach(async ({ page }) => {
  // cleanDb 不可用
});

// ✅ 正确
test.beforeEach(async ({ page, cleanDb }) => {
  // cleanDb 自动清理数据库
});
```

### 问题 3: Page Object 未正确初始化

**错误**:
```
TypeError: Cannot read property 'sendMessage' of undefined
```

**解决**:
```typescript
// ❌ 错误
test.describe('My Test', () => {
  let chatPage: ChatPage;

  test('send message', async ({ page }) => {
    await chatPage.sendMessage('Hello'); // chatPage 未初始化
  });
});

// ✅ 正确
test.describe('My Test', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page); // 在 beforeEach 中初始化
  });

  test('send message', async ({ page }) => {
    await chatPage.sendMessage('Hello');
  });
});
```

---

## 下一步

1. **运行新测试**: `pnpm test:e2e:playwright`
2. **查看报告**: `pnpm test:e2e:playwright:report`
3. **使用 UI Mode**: `pnpm test:e2e:playwright:ui`
4. **使用 Codegen**: `pnpm test:e2e:playwright:codegen`
5. **查看 Trace**: `pnpm exec playwright show-trace trace.zip`

---

## 参考

- [Playwright 官方文档](https://playwright.dev)
- [Page Object Model](https://playwright.dev/docs/pom)
- [Test Fixtures](https://playwright.dev/docs/test-fixtures)
- [Trace Viewer](https://playwright.dev/docs/trace-viewer)

---

*最后更新：2026-03-05*
