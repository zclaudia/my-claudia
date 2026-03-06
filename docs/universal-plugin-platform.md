# Universal Plugin Platform（通用插件平台）

## Overview

为整个 MyClaudia 应用设计一个统一的插件平台，让用户可以扩展应用的各个区域。

### 核心理念

插件平台不应该是 Agent Assistant 专属的，而应该是**整个 App 级别的基础设施**。

---

## 插件可扩展的区域

| 区域 | 描述 | 扩展点 |
|------|------|--------|
| **Agent Assistant** | 侧边栏 AI 助手 | 工具、UI 组件 |
| **主聊天会话** | 主界面的 AI 编程会话 | 工具、命令、UI 扩展 |
| **文件浏览器** | 文件树和文件查看器 | 文件操作、预览器 |
| **全局 UI 扩展** | 快捷键、菜单、命令面板 | 命令、快捷键、菜单项 |

---

## 插件扩展方式

### 1. 工具/命令 (Tools/Commands)

插件可以注册工具，供 AI 调用或用户手动触发。

```typescript
// 工具定义
interface PluginTool {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: ToolHandler;
  // 工具可见区域
  scope: ('agent-assistant' | 'main-session' | 'command-palette')[];
}
```

### 2. UI 组件 (UI Components)

插件可以注册 UI 组件，插入到指定位置。

```typescript
// UI 扩展点
interface UIExtensionPoint {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component: React.ComponentType;
  // 显示条件
  when?: (context: ExtensionContext) => boolean;
}

// 示例：在文件浏览器中添加自定义预览
const markdownPreviewExtension: UIExtensionPoint = {
  id: 'markdown-preview',
  location: 'panel',
  component: MarkdownPreviewPanel,
  when: (ctx) => ctx.fileExtension === '.md',
};
```

### 3. 事件钩子 (Event Hooks)

插件可以监听和响应应用事件。

```typescript
// 事件钩子
interface EventHook {
  event: string;
  handler: EventHandler;
  // 是否可以取消事件
  canCancel?: boolean;
}

// 示例：监听会话创建事件
const sessionCreatedHook: EventHook = {
  event: 'session.created',
  handler: (event) => {
    console.log('New session created:', event.sessionId);
  },
};

// 示例：拦截文件保存事件
const fileSaveHook: EventHook = {
  event: 'file.beforeSave',
  canCancel: true,
  handler: (event) => {
    if (shouldBlockSave(event.path)) {
      event.cancel('Cannot save this file');
    }
  },
};
```

---

## 插件接口定义

```typescript
// shared/src/plugin-types.ts

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  icon?: string;

  // 需要的权限
  permissions: Permission[];

  // 扩展定义
  contributes: {
    tools?: PluginTool[];
    commands?: PluginCommand[];
    uiExtensions?: UIExtensionPoint[];
    eventHooks?: EventHook[];
    menus?: MenuContribution[];
    keybindings?: KeybindingContribution[];
  };

  // 执行模式
  executionMode: 'main' | 'sandbox' | 'worker';

  // 激活事件（何时激活插件）
  activationEvents?: string[];
}

// 权限定义
type Permission =
  | 'fs.read'
  | 'fs.write'
  | 'network.fetch'
  | 'notification'
  | 'storage'
  | 'timer'
  | 'session.read'
  | 'session.write'
  | 'shell.execute'
  | 'clipboard.read'
  | 'clipboard.write'
  ;

// 插件上下文（提供给插件的 API）
interface PluginContext {
  // 基础 API
  fs: FileSystemAPI;
  network: NetworkAPI;
  storage: StorageAPI;
  notification: NotificationAPI;
  timer: TimerAPI;
  clipboard: ClipboardAPI;
  shell: ShellAPI;

  // 应用 API
  session: SessionAPI;
  project: ProjectAPI;
  ui: UIAPI;

  // 插件 API
  registerTool(tool: PluginTool): void;
  registerCommand(command: PluginCommand): void;
  registerUIExtension(extension: UIExtensionPoint): void;
  onEvent(event: string, handler: EventHandler): void;

  // 日志
  log: Logger;
}
```

---

## 插件示例

### 1. Jira 集成插件

```typescript
// plugins/jira/index.ts

export const manifest: PluginManifest = {
  id: 'com.example.jira',
  name: 'Jira Integration',
  version: '1.0.0',
  description: '查看和管理 Jira 任务',
  permissions: ['network.fetch', 'storage', 'notification'],
  executionMode: 'main',
  activationEvents: ['onCommand:jira.showTasks'],

  contributes: {
    // 工具：供 AI 调用
    tools: [
      {
        id: 'jira.getTasks',
        name: 'get_jira_tasks',
        description: '获取当前用户的 Jira 任务列表',
        parameters: { type: 'object', properties: { status: { type: 'string' } } },
        handler: 'getTasks',
        scope: ['agent-assistant', 'main-session'],
      },
      {
        id: 'jira.createTask',
        name: 'create_jira_task',
        description: '创建一个新的 Jira 任务',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['summary'],
        },
        handler: 'createTask',
        scope: ['agent-assistant', 'main-session'],
      },
    ],

    // 命令：用户手动触发
    commands: [
      {
        id: 'jira.showTasks',
        title: 'Show Jira Tasks',
        category: 'Jira',
      },
      {
        id: 'jira.createTask',
        title: 'Create Jira Task',
        category: 'Jira',
      },
    ],

    // UI 扩展：侧边栏面板
    uiExtensions: [
      {
        id: 'jira.panel',
        location: 'sidebar',
        component: 'JiraPanel',
      },
    ],

    // 菜单项
    menus: [
      {
        location: 'command-palette',
        commandId: 'jira.showTasks',
      },
    ],

    // 快捷键
    keybindings: [
      {
        command: 'jira.showTasks',
        key: 'cmd+shift+j',
      },
    ],
  },
};

// 插件实现
export async function activate(ctx: PluginContext) {
  // 初始化 Jira 客户端
  const config = await ctx.storage.get('config');
  const jiraClient = new JiraClient(config);

  // 注册工具处理器
  ctx.registerTool({
    id: 'jira.getTasks',
    handler: async (args) => {
      const tasks = await jiraClient.getTasks(args.status);
      return { type: 'json', data: tasks };
    },
  });

  ctx.registerTool({
    id: 'jira.createTask',
    handler: async (args) => {
      const task = await jiraClient.createTask(args);
      ctx.notification.show('Jira', `Task created: ${task.key}`);
      return { type: 'json', data: task };
    },
  });

  // 注册命令
  ctx.registerCommand({
    id: 'jira.showTasks',
    handler: () => {
      ctx.ui.showPanel('jira.panel');
    },
  });
}
```

### 2. 文件预览插件

```typescript
// plugins/pdf-preview/index.ts

export const manifest: PluginManifest = {
  id: 'com.example.pdf-preview',
  name: 'PDF Preview',
  version: '1.0.0',
  description: '在文件浏览器中预览 PDF 文件',
  permissions: ['fs.read'],
  executionMode: 'main',

  contributes: {
    uiExtensions: [
      {
        id: 'pdf.preview',
        location: 'panel',
        component: 'PDFPreview',
        when: (ctx) => ctx.fileExtension === '.pdf',
      },
    ],
  },
};
```

### 3. 代码格式化插件

```typescript
// plugins/prettier/index.ts

export const manifest: PluginManifest = {
  id: 'com.example.prettier',
  name: 'Prettier Formatter',
  version: '1.0.0',
  description: '使用 Prettier 格式化代码',
  permissions: ['fs.read', 'fs.write'],
  executionMode: 'worker',

  contributes: {
    commands: [
      {
        id: 'prettier.formatFile',
        title: 'Format with Prettier',
        category: 'Format',
      },
      {
        id: 'prettier.formatProject',
        title: 'Format Entire Project',
        category: 'Format',
      },
    ],

    eventHooks: [
      {
        event: 'file.beforeSave',
        handler: async (event, ctx) => {
          if (shouldFormat(event.path)) {
            const content = await ctx.fs.readFile(event.path);
            const formatted = await formatWithPrettier(content, event.path);
            event.setContent(formatted);
          }
        },
      },
    ],

    menus: [
      {
        location: 'editor.contextMenu',
        commandId: 'prettier.formatFile',
        when: (ctx) => isFormattableFile(ctx.filePath),
      },
    ],
  },
};
```

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                           MyClaudia App                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Plugin Runtime                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │   Loader    │  │   Host      │  │   Sandbox   │         │   │
│  │  │   加载器    │  │   主机      │  │   沙箱      │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Extension Points                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │   │
│  │  │ Tools   │  │ Commands│  │   UI    │  │  Hooks  │        │   │
│  │  │ 工具    │  │ 命令    │  │  组件   │  │  钩子   │        │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│  ┌────────────────────────────┼────────────────────────────┐       │
│  ▼                            ▼                            ▼       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │ Agent        │    │ Main Session │    │ File Browser │         │
│  │ Assistant    │    │ 主会话       │    │ 文件浏览器   │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 事件系统

### 内置事件

| 事件名 | 描述 | 数据 |
|--------|------|------|
| `app.ready` | 应用启动完成 | - |
| `app.quit` | 应用即将退出 | - |
| `session.created` | 新会话创建 | sessionId, project |
| `session.deleted` | 会话删除 | sessionId |
| `session.message` | 会话收到消息 | sessionId, message |
| `project.opened` | 项目打开 | projectId, path |
| `project.closed` | 项目关闭 | projectId |
| `file.beforeSave` | 文件保存前 | path, content |
| `file.saved` | 文件保存后 | path |
| `file.opened` | 文件打开 | path |
| `provider.changed` | Provider 切换 | providerId |
| `run.started` | AI Run 开始 | runId, sessionId |
| `run.completed` | AI Run 完成 | runId, sessionId |
| `run.error` | AI Run 出错 | runId, error |

### 事件流

```
用户操作 → 应用发出事件 → 插件监听并响应 → 更新 UI/执行操作
```

---

## 权限系统

### 权限级别

| 级别 | 权限 | 说明 |
|------|------|------|
| **安全** | `session.read`, `project.read` | 只读操作 |
| **中等** | `fs.read`, `network.fetch` | 读取外部资源 |
| **敏感** | `fs.write`, `session.write` | 写入操作 |
| **危险** | `shell.execute` | 执行命令 |

### 权限请求流程

1. 插件声明需要的权限
2. 用户安装时看到权限列表
3. 敏感操作时再次确认
4. 用户可以随时撤销权限

---

## 插件生命周期

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Discovered│───▶│ Installed│───▶│ Activated│───▶│ Running │
│ 发现     │     │ 安装     │     │ 激活     │     │ 运行中  │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
     │               │               │               │
     │               │               │               │
     ▼               ▼               ▼               ▼
   扫描目录      用户确认权限    activationEvents   响应调用
   读取 manifest                  触发激活         处理事件
```

### 激活事件

```typescript
// 启动时激活
activationEvents: ['onStartup']

// 命令触发时激活
activationEvents: ['onCommand:myPlugin.doSomething']

// 文件类型匹配时激活
activationEvents: ['onLanguage:typescript', 'onLanguage:javascript']

// 视图打开时激活
activationEvents: ['onView:explorer']

// 自定义条件
activationEvents: ['onFileSystem:git']
```

---

## 实现计划

### Phase 1: 核心框架
- [ ] 定义插件协议 (`shared/src/plugin-types.ts`)
- [ ] 实现插件加载器 (`server/src/services/plugin-loader.ts`)
- [ ] 实现权限系统
- [ ] 实现事件系统

### Phase 2: 工具和命令
- [ ] 实现工具注册和调用
- [ ] 实现命令注册和执行
- [ ] 集成到 Agent Assistant
- [ ] 集成到主会话

### Phase 3: UI 扩展
- [ ] 实现 UI 扩展点
- [ ] 实现侧边栏面板扩展
- [ ] 实现工具栏扩展
- [ ] 实现上下文菜单扩展

### Phase 4: 插件管理
- [ ] 插件发现和安装 UI
- [ ] 插件配置 UI
- [ ] 插件权限管理 UI
- [ ] 本地插件目录扫描

---

## 与其他设计的关系

| 设计 | 关系 |
|------|------|
| **Agent Assistant Plugin Platform** | Agent Assistant 是插件平台的一个主要使用场景 |
| **Multi-Model Collaborative Refinement** | 可以作为一个插件实现 |

通用插件平台为整个应用提供扩展能力，Agent Assistant 和其他功能都可以基于此构建。

---

## 插件 UI 一致性

### 设计决策

| 维度 | 决策 | 说明 |
|------|------|------|
| 样式系统 | CSS 变量 + Tailwind | 插件使用 App 的 CSS 变量和 Tailwind class |
| 主题支持 | 自动跟随 | 通过 CSS 变量自动响应主题切换 |
| 组件共享 | 可导入组件 | 插件可导入 App 提供的 UI 组件 |

### CSS 变量系统

App 定义设计令牌（Design Tokens），插件通过 CSS 变量使用：

```css
/* apps/desktop/src/styles/tokens.css */

:root {
  /* 颜色 */
  --color-primary: #3b82f6;
  --color-secondary: #6b7280;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* 背景 */
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --bg-tertiary: #e5e7eb;

  /* 文本 */
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;

  /* 边框 */
  --border-color: #e5e7eb;
  --border-radius: 0.5rem;

  /* 间距 */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;

  /* 字体 */
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, monospace;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
}

/* 暗色主题 */
[data-theme="dark"] {
  --color-primary: #60a5fa;
  --bg-primary: #111827;
  --bg-secondary: #1f2937;
  --bg-tertiary: #374151;
  --text-primary: #f9fafb;
  --text-secondary: #d1d5db;
  --text-muted: #9ca3af;
  --border-color: #374151;
}
```

### Tailwind 配置共享

```typescript
// apps/desktop/tailwind.config.ts

export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    // 插件目录也包含在内
    '../../plugins/**/*.tsx',
    '~/.my-claudia/plugins/**/*.tsx',
  ],
  theme: {
    extend: {
      colors: {
        // 使用 CSS 变量
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
      },
    },
  },
};
```

### 共享组件库

```typescript
// apps/desktop/src/components/plugin/index.ts

// 导出给插件使用的组件
export { Button } from './Button';
export { Input } from './Input';
export { Select } from './Select';
export { Card } from './Card';
export { Modal } from './Modal';
export { Spinner } from './Spinner';
export { Progress } from './Progress';
export { Toast } from './Toast';
export { Badge } from './Badge';
export { Tooltip } from './Tooltip';
export { Divider } from './Divider';
export { Tabs, Tab } from './Tabs';

// 导出类型
export type { ButtonProps } from './Button';
export type { InputProps } from './Input';
export type { SelectProps } from './Select';
```

### 插件 UI 开发规范

#### 1. 使用 CSS 变量

✅ 正确：
```css
.my-component {
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: var(--spacing-md);
}
```

❌ 错误：
```css
.my-component {
  background: #ffffff;  /* 硬编码，主题切换时不会更新 */
}
```

#### 2. 使用 Tailwind

✅ 正确：
```tsx
<div className="bg-bg-primary text-text-primary p-4 rounded-lg border border-border">
```

#### 3. 使用共享组件

```tsx
import { Button, Card, Input, Select } from '@my-claudia/plugin-ui';

function MyPluginPanel() {
  return (
    <Card>
      <Input placeholder="输入任务..." />
      <Select options={modelOptions} />
      <Button variant="primary">开始</Button>
    </Card>
  );
}
```

#### 4. 禁止事项

- ❌ 不要引入外部 CSS 框架（Bootstrap、Material UI 等）
- ❌ 不要硬编码颜色值
- ❌ 不要使用内联样式定义颜色

### 组件共享方案：虚拟模块 + 类型声明包

采用混合方案，无需发布完整的 UI 组件 npm 包：

#### 1. 虚拟模块（运行时）

通过 Vite 的 alias 配置，将 `@my-claudia/plugin-ui` 重定向到 App 的组件目录：

```typescript
// apps/desktop/vite.config.ts

export default defineConfig({
  resolve: {
    alias: {
      // 插件导入时，重定向到 App 的组件
      '@my-claudia/plugin-ui': path.resolve(__dirname, 'src/components/ui/index.ts'),
      '@my-claudia/plugin-api': path.resolve(__dirname, 'src/services/plugin-api.ts'),
    },
  },
});
```

#### 2. 类型声明包（开发时）

发布一个轻量的 `@my-claudia/plugin-types` npm 包，只包含类型定义：

```typescript
// @my-claudia/plugin-types/package.json
{
  "name": "@my-claudia/plugin-types",
  "version": "0.1.0",
  "types": "index.d.ts",
  "peerDependencies": {
    "react": "^18.0.0"
  }
}

// @my-claudia/plugin-types/index.d.ts
declare module '@my-claudia/plugin-ui' {
  import { ComponentType } from 'react';

  export interface ButtonProps {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    children: React.ReactNode;
    onClick?: () => void;
  }
  export const Button: ComponentType<ButtonProps>;

  export interface InputProps {
    placeholder?: string;
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
  }
  export const Input: ComponentType<InputProps>;

  // ... 其他组件
}

declare module '@my-claudia/plugin-api' {
  export interface PluginContext {
    ui: UIAPI;
    provider: ProviderAPI;
    storage: StorageAPI;
    registerCommand(command: Command): void;
    registerTool(tool: Tool): void;
  }
  // ...
}
```

#### 3. 插件开发流程

```bash
# 1. 创建插件
mkdir my-plugin && cd my-plugin

# 2. 安装类型声明（开发依赖）
npm install -D @my-claudia/plugin-types @types/react

# 3. 配置 tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@my-claudia/plugin-ui": ["../apps/desktop/src/components/ui/index.ts"]
    }
  }
}

# 4. 开发插件（有完整类型支持）
import { Button, Card } from '@my-claudia/plugin-ui';
```

#### 4. 优点

| 方面 | 说明 |
|------|------|
| **无需发布 UI 包** | 组件直接从 App 加载，无需维护 npm 包 |
| **版本自动同步** | App 更新后，插件自动获得最新组件 |
| **完整类型支持** | 通过 `@my-claudia/plugin-types` 提供 |
| **热更新支持** | 开发时修改 App 组件，插件自动更新 |
| **体积小** | 类型包只有类型定义，几 KB |

---

## 核心架构决策

| 维度 | 决策 | 说明 |
|------|------|------|
| **工具注册** | 服务端统一注册 | 所有工具在服务端注册，前端通过 API 调用 |
| **事件系统** | 服务端集中式 | 服务端作为事件中心，所有事件通过服务端分发 |
| **插件源** | Git 仓库（插件索引） | 用户添加 Git 仓库作为插件源 |
| **更新检查** | 自动检查 | 启动时自动检查插件更新 |
| **安装方式** | Zip 下载 | 下载插件 zip 包到本地 |

---

## 当前代码库改造分析

### 已有的良好模式

| 模式 | 文件位置 | 说明 |
|------|----------|------|
| **Provider Adapter** | `server/src/providers/registry.ts` | 注册表模式，已支持多 provider |
| **Command Scanner** | `server/src/utils/command-scanner.ts` | 已支持扫描自定义命令 |
| **Agent Tools** | `apps/desktop/src/services/agentTools.ts` | 工具定义模式 |

### 需要改造的部分

| 改造点 | 文件位置 | 当前模式 | 改造方案 |
|--------|----------|----------|----------|
| **工具执行** | `agentTools.ts` | Switch 语句 | 改为注册表模式 |
| **消息处理** | `messageHandler.ts` | Switch 语句 | 添加插件钩子 |
| **服务端消息** | `server.ts` | 直接处理 | 添加事件分发 |

### 改造优先级

1. **P0 - 工具注册表**
   - 将 `agentTools.ts` 的 switch 改为 Map 注册表
   - 提供 `registerTool()` API
   - 支持动态注册/注销

2. **P0 - 事件钩子系统**
   - 在服务端实现 `EventEmitter`
   - 定义标准事件类型
   - 提供 `on()` / `emit()` API

3. **P1 - 服务端插件钩子**
   - 在 `server.ts` 添加消息拦截点
   - 支持插件处理自定义消息类型

4. **P1 - 插件加载器**
   - 扫描插件目录
   - 解析 manifest
   - 加载并执行插件代码

---

## Git 仓库插件源设计

### 插件索引仓库格式

```
my-claudia-plugins/           # Git 仓库
├── index.json                # 插件索引
└── plugins/
    ├── jira/
    │   ├── manifest.json     # 插件清单
    │   ├── README.md         # 说明文档
    │   └── ...               # 插件代码（zip 打包或源码）
    ├── timer/
    │   ├── manifest.json
    │   └── ...
    └── multi-model-collab/
        ├── manifest.json
        └── ...
```

### 索引文件格式

```json
// index.json
{
  "version": 1,
  "updated": "2026-03-06T00:00:00Z",
  "plugins": [
    {
      "id": "com.example.jira",
      "name": "Jira Integration",
      "version": "1.0.0",
      "description": "查看和管理 Jira 任务",
      "author": "Example Inc",
      "downloadUrl": "https://github.com/example/my-claudia-plugins/releases/download/jira-1.0.0/jira.zip",
      "manifestUrl": "plugins/jira/manifest.json",
      "checksum": "sha256:abc123..."
    },
    {
      "id": "com.example.timer",
      "name": "Timer & Reminder",
      "version": "1.0.0",
      "description": "定时提醒和任务调度",
      "downloadUrl": "https://github.com/example/my-claudia-plugins/releases/download/timer-1.0.0/timer.zip",
      "manifestUrl": "plugins/timer/manifest.json",
      "checksum": "sha256:def456..."
    }
  ]
}
```

### 插件源配置

```typescript
// 用户配置
interface PluginSourceConfig {
  // 插件源列表
  sources: PluginSource[];

  // 已安装的插件
  installed: InstalledPlugin[];

  // 更新检查配置
  updateCheck: {
    enabled: boolean;
    interval: 'startup' | 'daily' | 'weekly' | 'manual';
  };
}

interface PluginSource {
  id: string;
  name: string;
  type: 'git' | 'local' | 'npm';
  url: string;  // Git 仓库 URL
  enabled: boolean;
  lastUpdated?: string;
}

// 示例配置
const config: PluginSourceConfig = {
  sources: [
    {
      id: 'official',
      name: 'Official Plugins',
      type: 'git',
      url: 'https://github.com/my-claudia/official-plugins',
      enabled: true,
    },
    {
      id: 'community',
      name: 'Community Plugins',
      type: 'git',
      url: 'https://github.com/my-claudia/community-plugins',
      enabled: true,
    },
  ],
  installed: [],
  updateCheck: {
    enabled: true,
    interval: 'startup',
  },
};
```

### 插件安装流程

```
1. 用户添加插件源（Git URL）
   ↓
2. 系统拉取 index.json
   ↓
3. 用户浏览可用插件列表
   ↓
4. 用户选择安装插件
   ↓
5. 下载 zip 包到 ~/.my-claudia/plugins/{plugin-id}/
   ↓
6. 验证 checksum
   ↓
7. 解析 manifest.json
   ↓
8. 显示权限请求，用户确认
   ↓
9. 激活插件
```

### 自动更新流程

```
1. 应用启动时
   ↓
2. 检查所有插件源的 index.json 更新
   ↓
3. 对比已安装插件的版本
   ↓
4. 如有更新，显示通知
   ↓
5. 用户确认后下载更新
```

---

## 服务端事件系统设计

### 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Server Event System                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     EventEmitter (server)                     │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │  │
│  │  │ listeners  │  │ emit()     │  │ hooks      │            │  │
│  │  │ 监听器     │  │ 发送事件   │  │ 钩子       │            │  │
│  │  └────────────┘  └────────────┘  └────────────┘            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│         │                    │                    │                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │ Plugin A    │    │ Plugin B    │    │ WebSocket   │            │
│  │ (监听事件)  │    │ (监听事件)  │    │ (广播事件)  │            │
│  └─────────────┘    └─────────────┘    └─────────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 实现

```typescript
// server/src/services/event-system.ts

type EventHandler = (event: PluginEvent) => void | Promise<void>;
type HookHandler = (event: PluginEvent) => boolean | void | Promise<boolean | void>;

interface PluginEvent {
  type: string;
  data: any;
  timestamp: number;
  cancelable?: boolean;
  cancelled?: boolean;
}

class EventSystem {
  private listeners = new Map<string, Set<EventHandler>>();
  private hooks = new Map<string, Set<HookHandler>>();

  // 监听事件
  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  // 注册钩子（可取消事件）
  registerHook(event: string, handler: HookHandler): () => void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, new Set());
    }
    this.hooks.get(event)!.add(handler);
    return () => this.unregisterHook(event, handler);
  }

  // 发送事件
  async emit(type: string, data: any): Promise<PluginEvent> {
    const event: PluginEvent = {
      type,
      data,
      timestamp: Date.now(),
      cancelable: false,
    };

    // 先执行钩子
    const hooks = this.hooks.get(type);
    if (hooks) {
      for (const hook of hooks) {
        const result = await hook(event);
        if (result === false) {
          event.cancelled = true;
          return event;
        }
      }
    }

    // 再通知监听器
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        await listener(event);
      }
    }

    // 广播到前端
    this.broadcastToClients(event);

    return event;
  }

  // 发送可取消事件
  async emitCancelable(type: string, data: any): Promise<PluginEvent> {
    const event: PluginEvent = {
      type,
      data,
      timestamp: Date.now(),
      cancelable: true,
    };

    const hooks = this.hooks.get(type);
    if (hooks) {
      for (const hook of hooks) {
        const result = await hook(event);
        if (result === false) {
          event.cancelled = true;
          return event;
        }
      }
    }

    if (!event.cancelled) {
      const listeners = this.listeners.get(type);
      if (listeners) {
        for (const listener of listeners) {
          await listener(event);
        }
      }
      this.broadcastToClients(event);
    }

    return event;
  }

  private off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private unregisterHook(event: string, handler: HookHandler): void {
    this.hooks.get(event)?.delete(handler);
  }

  private broadcastToClients(event: PluginEvent): void {
    // 广播到所有连接的 WebSocket 客户端
    // 实现在 server.ts 中
  }
}

export const eventSystem = new EventSystem();
```

---

## 服务端工具注册表设计

### 实现

```typescript
// server/src/services/tool-registry.ts

interface RegisteredTool {
  id: string;
  pluginId: string;
  definition: ToolDefinition;
  handler: ToolHandler;
}

type ToolHandler = (args: any, context: ToolContext) => Promise<ToolResult>;

interface ToolContext {
  sessionId?: string;
  projectId?: string;
  userId?: string;
  // 插件 API
  plugin: PluginContext;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  // 注册工具
  register(pluginId: string, tool: PluginTool, handler: ToolHandler): void {
    const id = `${pluginId}:${tool.id}`;
    if (this.tools.has(id)) {
      throw new Error(`Tool already registered: ${id}`);
    }
    this.tools.set(id, {
      id,
      pluginId,
      definition: tool,
      handler,
    });
  }

  // 注销工具
  unregister(toolId: string): void {
    this.tools.delete(toolId);
  }

  // 注销插件的所有工具
  unregisterPlugin(pluginId: string): void {
    for (const [id, tool] of this.tools) {
      if (tool.pluginId === pluginId) {
        this.tools.delete(id);
      }
    }
  }

  // 获取所有工具定义（供 AI 调用）
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  // 执行工具
  async execute(toolName: string, args: any, context: ToolContext): Promise<ToolResult> {
    // 查找工具（支持短名称和完整 ID）
    let tool: RegisteredTool | undefined;
    for (const t of this.tools.values()) {
      if (t.definition.name === toolName || t.id === toolName) {
        tool = t;
        break;
      }
    }

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    return tool.handler(args, context);
  }
}

export const toolRegistry = new ToolRegistry();
```

---

## 改造后的 agentTools.ts

```typescript
// apps/desktop/src/services/agentTools.ts

// 改造前：switch 语句
// 改造后：调用服务端 API

import { api } from './api';

export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  try {
    const result = await api.executePluginTool({
      toolName: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments),
    });
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// 获取所有可用工具（包括插件提供的）
export async function getAvailableTools(): Promise<ToolDefinition[]> {
  return api.getPluginTools();
}
```

---

## 实现计划（更新）

### Phase 1: 核心框架 (Week 1)

**服务端：**
- [ ] 创建 `shared/src/plugin-types.ts` - 插件协议定义
- [ ] 创建 `server/src/services/event-system.ts` - 事件系统
- [ ] 创建 `server/src/services/tool-registry.ts` - 工具注册表
- [ ] 创建 `server/src/services/plugin-loader.ts` - 插件加载器

**前端：**
- [ ] 更新 `agentTools.ts` - 改用服务端 API

### Phase 2: 插件源系统 (Week 2)

**服务端：**
- [ ] 实现 Git 仓库索引拉取
- [ ] 实现 Zip 下载和安装
- [ ] 实现版本检查和更新

**前端：**
- [ ] 插件市场 UI
- [ ] 插件源管理 UI
- [ ] 安装/更新/卸载 UI

### Phase 3: 集成 (Week 3)

- [ ] 将事件系统集成到 server.ts
- [ ] 将工具注册表集成到 AI 运行流程
- [ ] 实现 Agent Assistant 使用插件工具
- [ ] 实现主会话使用插件工具

### Phase 4: 内置插件 (Week 4)

- [ ] Timer & Reminder 插件
- [ ] Session Monitor 插件
- [ ] Message Search 插件
- [ ] Multi-Model Collaborative Refinement 插件
