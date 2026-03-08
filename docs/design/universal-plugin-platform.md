# Universal Plugin Platform（通用插件平台）

## Overview

为整个 MyClaudia 应用设计一个统一的插件平台，让用户可以扩展应用的各个区域。

### 核心理念

插件平台不应该是 Agent Assistant 专属的，而应该是**整个 App 级别的基础设施**。

---

## 当前代码库分析

### 已有的良好模式（可复用）

| 模式 | 文件位置 | 说明 |
|------|----------|------|
| **Provider Registry** | `server/src/providers/registry.ts` | 注册表模式，已支持多 provider 动态注册 |
| **Message Router** | `server/src/router/index.ts` | Map 路由 + 中间件支持，可扩展 |
| **Command Scanner** | `server/src/utils/command-scanner.ts` | 已支持扫描自定义命令，有插件命令扫描基础 |

### 需要改造的部分

| 改造点 | 文件位置 | 当前模式 | 改造方案 |
|--------|----------|----------|----------|
| **工具执行** | `apps/desktop/src/services/agentTools.ts` | 硬编码 switch 语句 | 改为 ToolRegistry 注册表模式 |
| **内置命令** | `server/src/routes/commands.ts` | 硬编码 builtInHandlers | 改为 CommandRegistry 注册表模式 |
| **事件系统** | 无 | 缺少钩子和事件分发机制 | 新建 PluginEventEmitter |
| **插件加载** | 无 | 无插件发现和生命周期管理 | 新建 PluginLoader |

### agentTools.ts 现状

当前 `agentTools.ts` 包含：
- `AGENT_TOOLS` 数组：15 个内置工具定义
- `executeToolCall()` 函数：switch 语句分发执行
- `executeWithBackend()` 辅助函数：多后端路由（local/remote/cloud）

改造目标：
1. 将 `AGENT_TOOLS` 迁移到 `toolRegistry.register()` 调用
2. 将 switch 语句改为 `toolRegistry.execute()`
3. 支持插件动态注册工具

---

## 架构概览

### 前后端分层

插件运行分为两个明确的层：

- **Server 插件**（后端）：工具执行、命令处理、事件钩子 — 可访问文件系统、shell、网络
- **UI 插件**（前端）：面板、渲染器、设置页 — 纯 UI 扩展，通过 API 调用后端

> **关键决策**: ToolRegistry 和 CommandRegistry 位于 **server 端**，因为工具执行需要 fs/shell 等系统能力。前端仅持有 UI 扩展注册表（面板、渲染器）。

```
┌──────────────────────────────────────────────────────────────────┐
│                         MyClaudia App                            │
├─────────────────────────────┬────────────────────────────────────┤
│       Frontend (Tauri)      │         Server (Node.js)           │
│                             │                                    │
│  ┌───────────────────────┐  │  ┌──────────────────────────────┐  │
│  │    UI Registry        │  │  │      Plugin Runtime          │  │
│  │  ┌────────┐ ┌───────┐ │  │  │  ┌────────┐ ┌───────────┐   │  │
│  │  │ Panel  │ │ Tool  │ │  │  │  │ Loader │ │ Permission│   │  │
│  │  │ Reg.   │ │Render │ │  │  │  │        │ │  Manager  │   │  │
│  │  └────────┘ └───────┘ │  │  │  └────────┘ └───────────┘   │  │
│  └───────────────────────┘  │  │  ┌────────┐ ┌───────────┐   │  │
│                             │  │  │ Event  │ │  Sandbox   │   │  │
│  ┌───────────────────────┐  │  │  │ System │ │  Manager   │   │  │
│  │   Extension Consumers │  │  │  └────────┘ └───────────┘   │  │
│  │  Settings  BottomPanel│  │  └──────────────────────────────┘  │
│  │  Sidebar   ToolCall   │  │              │                     │
│  └───────────────────────┘  │  ┌───────────┼─────────────────┐  │
│                             │  │           ▼                 │  │
│        HTTP/WS API ◄────────┼──┤  ┌──────────┐ ┌──────────┐ │  │
│                             │  │  │ Tool Reg │ │ Cmd Reg  │ │  │
│                             │  │  └──────────┘ └──────────┘ │  │
│                             │  └─────────────────────────────┘  │
└─────────────────────────────┴────────────────────────────────────┘
```

---

## 插件可扩展的区域

| 区域 | 描述 | 扩展点 |
|------|------|--------|
| **Agent Assistant** | 侧边栏 AI 助手 | 工具、UI 组件 |
| **主聊天会话** | 主界面的 AI 编程会话 | 工具、命令、UI 扩展 |
| **文件浏览器** | 文件树和文件查看器 | 文件操作、预览器 |
| **全局 UI 扩展** | 快捷键、菜单、命令面板 | 命令、快捷键、菜单项 |

---

## 统一类型定义

> **注意**: 所有插件相关的类型定义统一放在 `shared/src/plugin-types.ts`，不在多个文件中重复定义。

### Plugin Manifest

**文件**: `shared/src/plugin-types.ts`

```typescript
export interface PluginManifest {
  id: string;                    // e.g., 'com.example.my-plugin'
  name: string;
  version: string;
  description: string;
  author?: { name: string; email?: string };
  icon?: string;

  main?: string;                 // Backend entry (server-side)
  frontend?: string;             // Frontend entry (UI extensions)

  permissions?: Permission[];

  contributes?: {
    commands?: CommandContribution[];
    tools?: ToolContribution[];
    settings?: SettingsContribution;
    panels?: PanelContribution[];
    hooks?: HookContribution[];
    uiExtensions?: UIExtensionPoint[];
    menus?: MenuContribution[];
    keybindings?: KeybindingContribution[];
  };

  // 执行模式（见"沙箱与隔离"章节）
  executionMode?: 'main' | 'worker' | 'sandbox';

  // 激活事件（何时激活插件）
  activationEvents?: string[];

  // 兼容性声明
  engines?: {
    claudia: string;             // semver range, e.g., ">=0.1.0"
  };

  // 插件依赖
  dependencies?: Record<string, string>;  // pluginId → semver range
}
```

### Permission

```typescript
export type Permission =
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
```

### Plugin Context

```typescript
export interface PluginContext {
  pluginId: string;

  // 事件系统
  events: {
    on(event: string, handler: EventHandler): () => void;
    emit(event: string, data: unknown): Promise<void>;
  };

  // 注册扩展
  registerCommand(command: string, handler: CommandHandler): void;
  registerTool(meta: ToolRegistration): void;
  registerUIExtension(extension: UIExtensionPoint): void;

  // 持久化存储（每个插件独立命名空间）
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // 基础 API（按权限提供）
  fs: FileSystemAPI;
  network: NetworkAPI;
  notification: NotificationAPI;
  clipboard: ClipboardAPI;
  shell: ShellAPI;

  // 应用 API
  session: SessionAPI;
  project: ProjectAPI;
  ui: UIAPI;

  // 插件间通信
  exports<T>(api: T): void;
  getPluginAPI<T>(pluginId: string): T | undefined;

  // 日志
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
}
```

### Tool & Command

```typescript
export interface PluginTool {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: ToolHandler;
  scope: ('agent-assistant' | 'main-session' | 'command-palette')[];
}

export interface PluginCommand {
  id: string;
  title: string;
  category?: string;
  handler: CommandHandler;
}
```

### UI Extension Point

```typescript
export interface UIExtensionPoint {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component: React.ComponentType;
  when?: (context: ExtensionContext) => boolean;
}
```

### Event Hook

```typescript
export interface EventHook {
  event: string;
  handler: EventHandler;
  canCancel?: boolean;
}
```

---

## Phase 1: 核心基础设施

### 1.1 Tool Registry（工具注册表）

**新建文件**: `server/src/plugins/tool-registry.ts`（服务端，工具执行需要系统权限）

```typescript
export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => Promise<string> | string;

export type ToolSource = 'builtin' | 'plugin';

export interface ToolMeta {
  id: string;
  definition: ToolDefinition;
  handler: ToolHandler;
  permissions?: Permission[];
  source: ToolSource;
  pluginId?: string;
  scope?: ('agent-assistant' | 'main-session' | 'command-palette')[];
}

class ToolRegistry {
  private tools = new Map<string, ToolMeta>();

  register(meta: ToolMeta): void;
  unregister(toolId: string): boolean;
  get(toolId: string): ToolMeta | undefined;
  has(toolId: string): boolean;
  getAllDefinitions(): ToolDefinition[];
  getDefinitionsBySource(source: ToolSource): ToolDefinition[];
  getDefinitionsByScope(scope: string): ToolDefinition[];
  getAll(): ToolMeta[];
  async execute(toolCall: ToolCall, context?: ToolExecutionContext): Promise<string>;
  getByPlugin(pluginId: string): ToolMeta[];
  clearByPlugin(pluginId: string): number;
  get size(): number;
  clear(): void;
}

export const toolRegistry = new ToolRegistry();
```

**迁移 `agentTools.ts`**:
1. 将 `AGENT_TOOLS` 数组中的每个工具改为 `toolRegistry.register()` 调用
2. 将 `executeToolCall` 的 switch 语句改为 `toolRegistry.execute()`

### 1.2 Command Registry（命令注册表）

**新建文件**: `server/src/commands/registry.ts`

```typescript
export interface CommandMeta {
  command: string;              // e.g., '/my-command'
  description: string;
  handler: CommandHandler;
  source: 'builtin' | 'plugin';
  pluginId?: string;
}

class CommandRegistry {
  private commands = new Map<string, CommandMeta>();

  register(meta: CommandMeta): void;
  unregister(command: string): boolean;
  get(command: string): CommandMeta | undefined;
  getAll(): SlashCommand[];
  clearByPlugin(pluginId: string): void;
}

export const commandRegistry = new CommandRegistry();
```

**迁移 `routes/commands.ts`**:
- 将 `builtInHandlers` 对象改为注册表调用

### 1.3 Event System（事件系统）

**新建文件**: `server/src/events/index.ts`

> **命名约定**: 所有事件统一使用**点号分隔**（`session.created`），与 manifest 中的 `activationEvents` 风格一致。

```typescript
export type PluginEvent =
  // Lifecycle
  | 'plugin.loaded' | 'plugin.activated' | 'plugin.deactivated'
  // App
  | 'app.ready' | 'app.quit'
  // Run
  | 'run.started' | 'run.message' | 'run.toolCall' | 'run.completed' | 'run.error'
  // Session
  | 'session.created' | 'session.deleted' | 'session.message'
  // Project
  | 'project.opened' | 'project.closed'
  // File
  | 'file.beforeSave' | 'file.saved' | 'file.opened'
  // Permission
  | 'permission.request' | 'permission.approved'
  // Provider
  | 'provider.changed'
  | string;  // Custom events (namespace: 'pluginId.eventName')

class PluginEventEmitter {
  on(event: PluginEvent, listener: EventListener): () => void;
  once(event: PluginEvent, listener: EventListener): void;
  off(event: PluginEvent, listener: EventListener): void;
  emit(event: PluginEvent, data: unknown, pluginId?: string): Promise<void>;
}

export const pluginEvents = new PluginEventEmitter();
```

### 1.4 Plugin Manifest Schema

**新建文件**: `shared/src/plugin-types.ts`（见上方"统一类型定义"章节）

---

## Phase 2: Plugin Loader

### 2.1 Plugin Loader

**新建文件**: `server/src/plugins/loader.ts`

```typescript
class PluginLoader {
  private plugins = new Map<string, PluginInstance>();
  private pluginDirs = [
    '~/.claude/plugins',
    '~/.claudia/plugins',
  ];

  async discover(): Promise<PluginManifest[]>;
  async activate(pluginId: string): Promise<void>;
  async deactivate(pluginId: string): Promise<void>;
  async deactivateAll(): Promise<void>;
  getPlugin(pluginId: string): PluginInstance | undefined;
  getActivePlugins(): PluginInstance[];
  private createPluginContext(pluginId: string): PluginContext;
  private checkCompatibility(manifest: PluginManifest): boolean;
  private resolveDependencies(manifest: PluginManifest): string[];
}

export const pluginLoader = new PluginLoader();
```

**激活流程**:
1. 加载 manifest.json
2. 检查 `engines.claudia` 版本兼容性
3. 解析依赖，确保依赖插件已激活
4. 检查权限
5. 根据 `executionMode` 选择运行环境（main / worker / sandbox）
6. 加载 main 模块
7. 调用 `activate(context)`
8. 注册 contributes 中的命令/工具/钩子

### 2.2 Permission Manager

**新建文件**: `server/src/plugins/permissions.ts`

```typescript
class PermissionManager {
  hasPermission(pluginId: string, permission: Permission): boolean;
  grant(pluginId: string, permission: Permission): void;
  revoke(pluginId: string, permission: Permission): void;
  request(pluginId: string, permission: Permission): Promise<boolean>;
  getGranted(pluginId: string): Permission[];
  revokeAll(pluginId: string): void;
}

export const permissionManager = new PermissionManager();
```

### 2.3 沙箱与隔离

插件执行模式的安全分级：

| 模式 | 隔离级别 | 适用场景 | 实现方式 |
|------|----------|----------|----------|
| `main` | 无隔离 | 内置插件、受信任插件 | 直接 `require()` 到宿主进程 |
| `worker` | 线程隔离 | 第三方插件（默认） | `worker_threads` + `resourceLimits` + 执行超时 |
| `sandbox` | 进程隔离 | 不受信任插件 | 独立子进程 + IPC + 限制系统调用 |

**实施计划**:

```
MVP:    仅支持 main 模式（内置插件，受信任）
V1:     引入 worker 模式（worker_threads，有超时和内存限制）
V2:     引入 sandbox 模式（独立进程 + IPC，完全隔离）
```

**Worker 模式设计**:

```typescript
// server/src/plugins/worker-host.ts
import { Worker } from 'worker_threads';

class PluginWorkerHost {
  private worker: Worker;

  constructor(pluginPath: string) {
    this.worker = new Worker(pluginPath, {
      resourceLimits: {
        maxOldGenerationSizeMb: 128,  // 内存上限
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 16,
      },
    });
  }

  // 所有 API 调用通过 MessagePort 转发
  async callTool(toolId: string, args: unknown): Promise<string>;

  // 超时保护
  async executeWithTimeout(fn: () => Promise<unknown>, timeoutMs: number): Promise<unknown>;

  terminate(): void;
}
```

---

## Phase 3: 集成点

### 3.1 工具注册到 AI

**修改文件**: `server/src/providers/claude-adapter.ts` 等

```typescript
import { toolRegistry } from '../plugins/tool-registry.js';

// 在 run() 方法中
const builtinTools = [...];
const pluginTools = toolRegistry.getDefinitionsBySource('plugin');
const allTools = [...builtinTools, ...pluginTools];
```

### 3.2 命令显示在 UI

**修改文件**: `server/src/routes/providers.ts`

```typescript
import { commandRegistry } from '../commands/registry.js';

// GET /:id/commands handler
const allCommands = [
  ...LOCAL_COMMANDS,
  ...CLI_COMMANDS,
  ...commandRegistry.getAll(),  // 添加注册表命令
  ...dedupedCustom
];
```

### 3.3 事件集成

**修改文件**: `server/src/server.ts`

在 `handleRunStart` 中添加事件发射：
```typescript
await pluginEvents.emit('run.started', { sessionId, input });
// ... run execution
await pluginEvents.emit('run.completed', { sessionId, result });
```

---

## Phase 4: UI 扩展

### 4.1 Plugin Store

**新建文件**: `apps/desktop/src/stores/pluginStore.ts`

```typescript
interface PluginUIState {
  settingsTabs: PluginUITab[];
  bottomPanelTabs: PluginUITab[];

  registerSettingsTab(tab: PluginUITab): void;
  registerBottomPanelTab(tab: PluginUITab): void;
}

export const usePluginStore = create<PluginUIState>((set) => ({...}));
```

### 4.2 Settings Panel 扩展

**修改文件**: `apps/desktop/src/components/SettingsPanel.tsx`

```typescript
const pluginTabs = usePluginStore((s) => s.settingsTabs);

const allTabs = [
  ...existingTabs,
  ...pluginTabs.map(t => ({ id: t.id, label: t.label, component: t.component })),
];
```

### 4.3 Bottom Panel 扩展

**修改文件**: `apps/desktop/src/components/BottomPanel.tsx`

```typescript
const pluginPanelTabs = usePluginStore((s) => s.bottomPanelTabs);

// Render plugin panels
{pluginPanelTabs.map((tab) => (
  <tab.component key={tab.id} />
))}
```

### 4.4 Tool Renderer Registry

**新建文件**: `apps/desktop/src/components/chat/ToolRendererRegistry.tsx`

```typescript
class ToolRendererRegistry {
  register(toolName: string, renderer: React.ComponentType): void;
  get(toolName: string): React.ComponentType | undefined;
}

// In ToolCallItem.tsx
const CustomRenderer = toolRendererRegistry.get(toolName);
if (CustomRenderer) return <CustomRenderer {...props} />;
```

---

## 文件清单

### 新建文件 (10 个)

| 文件路径 | 用途 |
|----------|------|
| `shared/src/plugin-types.ts` | 统一的类型定义（Manifest、Context、Permission 等） |
| `server/src/plugins/tool-registry.ts` | 工具注册表（服务端） |
| `server/src/commands/registry.ts` | 命令注册表 |
| `server/src/events/index.ts` | 事件系统 |
| `server/src/plugins/loader.ts` | 插件加载器 |
| `server/src/plugins/permissions.ts` | 权限管理 |
| `server/src/plugins/worker-host.ts` | Worker 隔离宿主 |
| `apps/desktop/src/stores/pluginStore.ts` | UI 状态管理 |
| `apps/desktop/src/components/chat/ToolRendererRegistry.tsx` | 工具渲染器注册 |

### 修改文件 (6 个)

| 文件路径 | 修改内容 |
|----------|----------|
| `apps/desktop/src/services/agentTools.ts` | 迁移到 ToolRegistry（通过 API 调用服务端） |
| `server/src/routes/commands.ts` | 迁移到 CommandRegistry |
| `server/src/routes/providers.ts` | 集成命令注册表 |
| `server/src/providers/claude-adapter.ts` | 集成工具注册表 |
| `server/src/server.ts` | 初始化插件加载器，添加事件发射 |
| `apps/desktop/src/components/SettingsPanel.tsx` | 支持插件设置标签 |

---

## 实施顺序

### MVP: 核心注册表 + 内置迁移（2-3 周）

1. 创建 `shared/src/plugin-types.ts` — 统一类型定义
2. 创建 `ToolRegistry` + 单元测试
3. 创建 `CommandRegistry` + 单元测试
4. 创建 `PluginEventEmitter` + 单元测试
5. 迁移 `agentTools.ts` 到 ToolRegistry
6. 迁移 `commands.ts` 到 CommandRegistry

### V1: 插件加载器 + 本地插件（2 周）

1. 实现 `PluginLoader.discover()`
2. 实现 `PluginLoader.activate()` / `deactivate()`
3. 实现 `PluginContext`（main 模式）
4. 实现 `PermissionManager`
5. 集成到服务器启动
6. 创建示例插件（Timer）验证端到端流程

### V2: Worker 隔离 + 权限强化（2 周）

1. 实现 `WorkerHost`（worker_threads 隔离）
2. 添加执行超时和内存限制
3. 权限运行时检查（API 调用前验证 permission）
4. 添加事件发射到 run 生命周期

### V3: UI 扩展 + 插件管理（2 周）

1. 创建 `pluginStore.ts`
2. 更新 `SettingsPanel.tsx`
3. 创建 `ToolRendererRegistry`
4. 插件管理 UI（查看/启用/禁用/卸载）
5. 创建 Jira 示例插件

---

## 验证步骤

### 1. 单元测试
```bash
pnpm test:unit -- --grep "Registry|PluginLoader|EventEmitter"
```

### 2. 集成测试
```bash
# 创建测试插件
mkdir -p ~/.claudia/plugins/test-plugin
echo '{"id":"test","name":"Test","version":"1.0.0"}' > ~/.claudia/plugins/test-plugin/plugin.json

# 启动应用，检查插件是否被发现
pnpm dev
```

### 3. 端到端验证
1. 插件命令出现在斜杠命令列表
2. 插件工具被 AI 正确调用
3. 插件设置标签显示在设置面板
4. 插件面板显示在底部面板

---

## 插件扩展方式

### 1. 工具/命令 (Tools/Commands)

插件可以注册工具，供 AI 调用或用户手动触发。

```typescript
ctx.registerTool({
  id: 'my-plugin.search',
  name: 'search_docs',
  description: 'Search documentation',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (args) => {
    const results = await searchDocs(args.query);
    return JSON.stringify(results);
  },
  scope: ['agent-assistant', 'main-session'],
});
```

### 2. UI 组件 (UI Components)

插件可以注册 UI 组件，插入到指定位置。通过运行时注入方式获取共享组件：

```typescript
export async function activate(ctx: PluginContext) {
  // 运行时注入共享 UI 组件
  const { Button, Input } = ctx.ui.components;

  ctx.registerUIExtension({
    id: 'markdown-preview',
    location: 'panel',
    component: MarkdownPreviewPanel,
    when: (context) => context.fileExtension === '.md',
  });
}
```

### 3. 事件钩子 (Event Hooks)

插件可以监听和响应应用事件。

```typescript
// 监听会话创建事件
ctx.events.on('session.created', (event) => {
  ctx.log.info('New session created:', event.sessionId);
});

// 拦截文件保存（canCancel 需在 manifest 中声明）
ctx.events.on('file.beforeSave', (event) => {
  if (shouldBlockSave(event.path)) {
    event.cancel('Cannot save this file');
  }
});
```

### 4. 插件间通信

插件可以导出 API 供其他插件使用：

```typescript
// Git 插件导出 API
export async function activate(ctx: PluginContext) {
  ctx.exports({
    getCurrentBranch: () => execSync('git branch --show-current').toString().trim(),
    getStatus: () => execSync('git status --porcelain').toString(),
  });
}

// Jira 插件使用 Git 插件的 API
export async function activate(ctx: PluginContext) {
  const gitAPI = ctx.getPluginAPI<GitAPI>('com.example.git');
  if (gitAPI) {
    const branch = gitAPI.getCurrentBranch();
    // ... use branch to link Jira tasks
  }
}
```

---

## 事件系统

### 内置事件

> 所有事件统一使用**点号分隔**命名。

| 事件名 | 描述 | 数据 |
|--------|------|------|
| `app.ready` | 应用启动完成 | - |
| `app.quit` | 应用即将退出 | - |
| `session.created` | 新会话创建 | sessionId, project |
| `session.deleted` | 会话删除 | sessionId |
| `session.message` | 会话收到消息 | sessionId, message |
| `project.opened` | 项目打开 | projectId, path |
| `project.closed` | 项目关闭 | projectId |
| `file.beforeSave` | 文件保存前（可取消） | path, content |
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
| **安全** | `session.read`, `project.read`, `storage` | 只读操作、本地存储 |
| **中等** | `fs.read`, `network.fetch`, `timer` | 读取外部资源 |
| **敏感** | `fs.write`, `session.write`, `notification`, `clipboard.*` | 写入操作 |
| **危险** | `shell.execute` | 执行命令（仅 worker/sandbox 模式允许） |

### 权限请求流程

1. 插件在 manifest 中声明需要的权限
2. 用户安装时看到权限列表，确认授予
3. 运行时 PermissionManager 在每次 API 调用前检查权限
4. 敏感操作时再次确认（首次使用弹窗）
5. 用户可以在设置面板随时查看和撤销权限

### 权限与隔离的关系

| 隔离模式 | 可申请的最高权限 |
|----------|------------------|
| `main` | 全部（仅限内置/受信任插件） |
| `worker` | `fs.*`, `network.*`, `session.*`, `storage` |
| `sandbox` | `network.fetch`, `storage`, `notification` |

---

## 插件生命周期

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Discovered│───▶│ Installed │───▶│ Activated │───▶│  Running  │
│ 发现      │     │ 安装      │     │ 激活      │     │  运行中   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │               │               │               │
     ▼               ▼               ▼               ▼
  扫描目录        用户确认权限    activationEvents   响应调用
  读取 manifest   检查兼容性     触发激活           处理事件
                  解析依赖
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

## 插件 UI 一致性

### 设计决策

| 维度 | 决策 | 说明 |
|------|------|------|
| 样式系统 | 复用现有 HSL 变量 + Tailwind | 插件使用 App 已有的 CSS 变量 |
| 主题支持 | 自动跟随 | 通过 HSL CSS 变量自动响应主题切换 |
| 组件共享 | 运行时注入 | 通过 `ctx.ui.components` 提供共享组件 |

### 复用现有 CSS 变量系统

插件应使用项目已有的 HSL 变量体系（定义在 `apps/desktop/src/styles/index.css`），**不需要额外定义新变量**：

```css
/* 插件可用的核心 CSS 变量（已有，无需新建） */

/* 语义颜色 (HSL 格式，配合 Tailwind 使用) */
--background        /* 页面背景 */
--foreground        /* 前景文字 */
--card              /* 卡片背景 */
--primary           /* 主色调 (System Blue) */
--secondary         /* 次要色 */
--muted             /* 柔和色 */
--border            /* 边框 */
--input             /* 输入框背景 */
--destructive       /* 危险色 */
--success           /* 成功色 */
--warning           /* 警告色 */

/* Apple 风格扩展 */
--shadow-apple-sm   /* 多层阴影 */
--shadow-apple-md
--shadow-apple-lg
--shadow-apple-xl
```

插件 CSS 示例：
```css
/* 正确：使用已有变量 */
.my-plugin-panel {
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 0.75rem;
  box-shadow: var(--shadow-apple-md);
}

/* 正确：使用 Tailwind class */
.my-plugin-button {
  @apply bg-primary text-primary-foreground rounded-lg shadow-apple-sm;
}
```

### 组件共享方案：运行时注入

插件通过 `PluginContext` 在运行时获取共享 UI 组件，适用于外部加载的插件：

```typescript
export async function activate(ctx: PluginContext) {
  // 运行时获取 App 提供的组件
  const { Button, Input, Card, Badge } = ctx.ui.components;

  // 使用 App 组件构建插件 UI
  const MyPanel = () => (
    <Card>
      <Input placeholder="Search..." />
      <Button variant="primary" onClick={handleSearch}>Search</Button>
    </Card>
  );

  ctx.registerUIExtension({
    id: 'my-plugin.panel',
    location: 'panel',
    component: MyPanel,
  });
}
```

#### 类型声明包（开发时）

发布一个轻量的 `@my-claudia/plugin-types` npm 包，只包含类型定义，供插件开发者获得 IDE 支持：

```typescript
// @my-claudia/plugin-types/index.d.ts
declare module '@my-claudia/plugin-api' {
  export interface PluginContext {
    ui: {
      components: {
        Button: ComponentType<ButtonProps>;
        Input: ComponentType<InputProps>;
        Card: ComponentType<CardProps>;
        Badge: ComponentType<BadgeProps>;
      };
      showPanel(panelId: string): void;
      showNotification(message: string): void;
    };
    // ... 其他 API
  }
}
```

---

## 核心架构决策

| 维度 | 决策 | 说明 |
|------|------|------|
| **工具注册** | 服务端注册 | 工具执行需要 fs/shell 等系统能力，ToolRegistry 位于 server |
| **事件系统** | 服务端集中式 | 服务端作为事件中心，所有事件通过服务端分发 |
| **UI 扩展** | 前端注册 | 面板/渲染器在前端注册，通过 API 调用后端 |
| **组件共享** | 运行时注入 | 通过 `ctx.ui.components` 提供，不依赖构建时 alias |
| **插件源** | Git 仓库（插件索引） | 用户添加 Git 仓库作为插件源 |
| **更新检查** | 自动检查 | 启动时自动检查插件更新 |
| **安装方式** | Zip 下载 | 下载插件 zip 包到本地 |
| **隔离默认** | worker 模式 | 第三方插件默认使用 worker_threads 隔离 |

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
      "checksum": "sha256:abc123...",
      "engines": { "claudia": ">=0.1.0" }
    }
  ]
}
```

---

## 插件示例

### Timer 插件 (验证完整流程)

```typescript
// ~/.claudia/plugins/timer/plugin.json
{
  "id": "com.example.timer",
  "name": "Timer & Reminder",
  "version": "1.0.0",
  "description": "定时提醒和任务调度",
  "main": "dist/index.js",
  "permissions": ["storage", "notification"],
  "executionMode": "worker",
  "engines": { "claudia": ">=0.1.0" },
  "contributes": {
    "commands": [
      { "command": "/timer:set", "title": "Set Timer" },
      { "command": "/timer:list", "title": "List Timers" }
    ],
    "tools": [
      {
        "id": "set_timer",
        "name": "set_timer",
        "description": "Set a timer for N seconds",
        "parameters": { "seconds": { "type": "number" } }
      }
    ]
  }
}

// dist/index.js
export async function activate(ctx) {
  ctx.registerCommand('/timer:set', async (args) => {
    const seconds = parseInt(args[0]);
    setTimeout(() => {
      ctx.notification.show('Timer', 'Timer completed!');
    }, seconds * 1000);
    return { type: 'custom', content: `Timer set for ${seconds}s` };
  });

  ctx.registerTool({
    id: 'set_timer',
    name: 'set_timer',
    description: 'Set a timer',
    parameters: { type: 'object', properties: { seconds: { type: 'number' } } },
    handler: async (args) => {
      return JSON.stringify({ message: `Timer set for ${args.seconds}s` });
    },
    scope: ['agent-assistant', 'main-session'],
  });
}
```

### Jira 集成插件

```typescript
// plugins/jira/plugin.json
{
  "id": "com.example.jira",
  "name": "Jira Integration",
  "version": "1.0.0",
  "description": "查看和管理 Jira 任务",
  "main": "dist/index.js",
  "permissions": ["network.fetch", "storage", "notification"],
  "executionMode": "worker",
  "engines": { "claudia": ">=0.1.0" },
  "dependencies": { "com.example.git": ">=1.0.0" },
  "activationEvents": ["onCommand:jira.showTasks"],
  "contributes": {
    "tools": [
      {
        "id": "jira.getTasks",
        "name": "get_jira_tasks",
        "description": "获取当前用户的 Jira 任务列表",
        "parameters": { "type": "object", "properties": { "status": { "type": "string" } } },
        "scope": ["agent-assistant", "main-session"]
      }
    ],
    "commands": [
      { "id": "jira.showTasks", "title": "Show Jira Tasks", "category": "Jira" }
    ],
    "uiExtensions": [
      { "id": "jira.panel", "location": "sidebar" }
    ],
    "keybindings": [
      { "command": "jira.showTasks", "key": "cmd+shift+j" }
    ]
  }
}

// dist/index.js
export async function activate(ctx) {
  const config = await ctx.storage.get('config');
  const jiraClient = new JiraClient(config);

  // 使用其他插件的 API
  const gitAPI = ctx.getPluginAPI('com.example.git');

  ctx.registerTool({
    id: 'jira.getTasks',
    handler: async (args) => {
      const tasks = await jiraClient.getTasks(args.status);
      return JSON.stringify(tasks);
    },
  });

  ctx.registerCommand({
    id: 'jira.showTasks',
    handler: () => ctx.ui.showPanel('jira.panel'),
  });
}
```

---

## 插件开发者体验 (DX)

### 脚手架

```bash
# 创建插件项目
npx create-claudia-plugin my-plugin
# 生成:
# my-plugin/
# ├── plugin.json          # manifest
# ├── src/index.ts          # entry
# ├── tsconfig.json
# └── package.json          # 含 @my-claudia/plugin-types 依赖
```

### 开发模式

- 插件放入 `~/.claudia/plugins/` 后，应用检测文件变化自动重载（dev 模式）
- 服务端日志自动标记插件来源：`[plugin:com.example.jira] Fetched 12 tasks`

### 调试工具

Settings → Plugins 面板提供：
- 已加载插件列表（状态、版本、权限）
- 插件事件日志（实时查看事件流）
- 手动启用/禁用/重载插件
- 权限管理（查看/撤销）

### 类型支持

```bash
npm install --save-dev @my-claudia/plugin-types
```

提供完整的 TypeScript 类型定义，包括 PluginContext、所有 API 接口、事件类型。

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 插件代码安全 | 权限系统 + 用户确认 + worker/sandbox 隔离 |
| 插件崩溃影响主应用 | worker 模式隔离 + 超时保护 + 自动禁用崩溃插件 |
| 插件版本兼容性 | Manifest 中 `engines.claudia` 声明 + 加载时检查 |
| UI 扩展性能 | 懒加载插件组件 + activationEvents 延迟激活 |
| 插件间冲突 | 命名空间隔离（pluginId 前缀） + 依赖声明 |
| 恶意插件 | checksum 校验 + 插件源审核 + 权限最小化原则 |

---

## 与其他设计的关系

| 设计 | 关系 |
|------|------|
| **Agent Assistant Plugin Platform** | Agent Assistant 是插件平台的一个主要使用场景 |
| **Multi-Model Collaborative Refinement** | 可以作为一个插件实现 |

通用插件平台为整个应用提供扩展能力，Agent Assistant 和其他功能都可以基于此构建。
