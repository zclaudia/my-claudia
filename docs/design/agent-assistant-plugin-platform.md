# Agent Assistant 重设计方案

## Context

用户认为当前的 Agent Assistant 功能"鸡肋"。经过多轮讨论，明确了新的定位：

**Agent Assistant = 可扩展的插件运行时平台**

### 当前问题
1. 需要额外配置 OpenAI-compatible API（配置负担）
2. 能力太弱 - 只能管理/搜索，不能独立执行
3. 和主会话功能重复
4. 缺乏差异化价值

### 用户的核心期望
- 不只是内置功能，而是一个可以扩展插件的入口
- 插件可以帮用户做各种事情：整理笔记、归档文档、定时提醒、读 Jira、监控任务进程等
- 定义一套通用且可扩展的协议
- 使用 JavaScript 开发插件
- 渐进式发现机制（先本地文件，后续商店）

---

## 新定位：Plugin Runtime Platform

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Assistant                               │
│                    (Plugin Runtime Platform)                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     AI Core                                  │   │
│  │  - Provider SDK 集成 (Claude/OpenCode/Codex/Cursor)         │   │
│  │  - 工具调用路由                                              │   │
│  │  - 上下文管理                                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Plugin Host                                │   │
│  │  - 插件加载/卸载/热更新                                      │   │
│  │  - 工具注册/发现                                             │   │
│  │  - 权限管理                                                  │   │
│  │  - 混合执行（主进程 + 沙箱）                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│          ┌────────────────────┼────────────────────┐                │
│          ▼                    ▼                    ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │ Built-in     │    │ User         │    │ External     │         │
│  │ Plugins      │    │ Plugins      │    │ Services     │         │
│  │ (MVP)        │    │ (Local FS)   │    │ (HTTP API)   │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心概念

1. **用户与 Agent 对话**：用户在 Agent Panel 中发送消息
2. **Agent 调用插件**：Agent 根据对话内容决定调用哪个插件提供的工具
3. **插件执行并返回**：插件执行操作，返回结果给 Agent
4. **Agent 回复用户**：Agent 整合结果，回复用户

---

## Plugin Protocol

### 1. 插件接口定义

```typescript
// shared/src/plugin-types.ts

interface PluginManifest {
  id: string;           // 唯一标识
  name: string;         // 显示名称
  version: string;      // 版本号
  description: string;  // 描述
  author?: string;      // 作者
  permissions: Permission[];  // 需要的权限
  tools: ToolDefinition[];    // 提供的工具
  executionMode: 'main' | 'sandbox';  // 执行模式
}

interface ToolDefinition {
  name: string;         // 工具名称
  description: string;  // 工具描述
  parameters: JSONSchema;  // 参数 schema
  handler: string;      // 处理函数名
}

type Permission =
  | 'fs.read'       // 读取文件
  | 'fs.write'      // 写入文件
  | 'network.fetch' // 网络请求
  | 'notification'  // 系统通知
  | 'storage'       // 数据存储
  | 'timer'         // 定时器
  | 'session.read'  // 读取会话信息
  | 'session.write' // 写入会话（发送消息等）
  ;

interface PluginContext {
  // 提供给插件的 API
  fs: FileSystemAPI;
  network: NetworkAPI;
  storage: StorageAPI;
  notification: NotificationAPI;
  timer: TimerAPI;
  session: SessionAPI;

  // 工具调用结果返回
  reportResult(result: ToolResult): void;
  reportError(error: Error): void;
}

type ToolResult =
  | { type: 'text'; content: string }
  | { type: 'json'; data: any }
  | { type: 'file'; path: string; content: string }
  ;
```

### 2. 插件示例

```typescript
// plugins/timer/index.ts

export const manifest: PluginManifest = {
  id: 'builtin.timer',
  name: 'Timer & Reminder',
  version: '1.0.0',
  description: '定时提醒和任务调度',
  permissions: ['timer', 'notification', 'storage'],
  executionMode: 'main',
  tools: [
    {
      name: 'set_reminder',
      description: '设置一个提醒',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '提醒内容' },
          delay: { type: 'number', description: '延迟秒数' },
          repeat: { type: 'boolean', description: '是否重复' },
        },
        required: ['message', 'delay'],
      },
      handler: 'setReminder',
    },
    {
      name: 'list_reminders',
      description: '列出所有提醒',
      parameters: { type: 'object', properties: {} },
      handler: 'listReminders',
    },
  ],
};

export function setReminder(args: { message: string; delay: number; repeat?: boolean }, ctx: PluginContext) {
  const id = crypto.randomUUID();
  const triggerAt = Date.now() + args.delay * 1000;

  ctx.timer.schedule(id, triggerAt, () => {
    ctx.notification.show('提醒', args.message);
    if (args.repeat) {
      // 重新调度
    }
  });

  ctx.storage.set(`reminder:${id}`, { ...args, triggerAt, id });
  ctx.reportResult({ type: 'text', content: `已设置提醒：${args.message}，将在 ${args.delay} 秒后触发` });
}

export function listReminders(_args: {}, ctx: PluginContext) {
  const reminders = ctx.storage.list('reminder:');
  ctx.reportResult({ type: 'json', data: reminders });
}
```

---

## Built-in Plugins (MVP)

### 1. Timer & Reminder
- `set_reminder` - 设置提醒
- `list_reminders` - 列出提醒
- `cancel_reminder` - 取消提醒
- 权限: `timer`, `notification`, `storage`

### 2. Session Monitor
- `get_session_status` - 获取会话状态
- `monitor_sessions` - 监控多个会话
- `get_aggregate_status` - 汇总所有会话状态
- `analyze_session_health` - 分析会话健康度
- 权限: `session.read`, `notification`

### 3. Message Search
- `search_messages` - 搜索消息
- `summarize_session` - 总结会话
- `export_session` - 导出会话
- 权限: `session.read`, `fs.write`

---

## Architecture Changes

### 1. 服务端

```
server/src/
├── services/
│   ├── agent-service.ts      # Agent 服务（新建）
│   └── plugin-host.ts        # 插件主机（新建）
├── routes/
│   └── agent.ts              # Agent 路由（修改）
└── plugins/
    └── builtin/
        ├── timer/            # 定时提醒插件
        ├── session-monitor/  # 会话监控插件
        └── message-search/   # 消息搜索插件
```

### 2. 前端

```
apps/desktop/src/
├── services/
│   ├── agentLoop.ts          # 重写：使用服务端 API
│   └── pluginLoader.ts       # 新建：插件加载器
├── components/agent/
│   ├── AgentPanel.tsx        # 重写：新 UI
│   ├── PluginManager.tsx     # 新建：插件管理
│   └── ToolResult.tsx        # 新建：工具结果展示
└── stores/
    └── agentStore.ts         # 重写：插件状态
```

### 3. 共享类型

```
shared/src/
└── plugin-types.ts           # 新建：插件协议定义
```

---

## Implementation Plan

### Phase 1: Plugin Infrastructure (Week 1)
1. **定义协议**
   - [ ] 创建 `shared/src/plugin-types.ts`
   - [ ] 定义 PluginManifest, ToolDefinition, Permission 等类型

2. **服务端插件主机**
   - [ ] 创建 `server/src/services/plugin-host.ts`
   - [ ] 实现插件加载/卸载
   - [ ] 实现工具注册/发现
   - [ ] 实现权限检查

3. **内置插件**
   - [ ] 实现 Timer 插件
   - [ ] 实现 Session Monitor 插件
   - [ ] 实现 Message Search 插件

### Phase 2: Agent Service (Week 2)
1. **Agent 服务**
   - [ ] 创建 `server/src/services/agent-service.ts`
   - [ ] 集成 Provider SDK
   - [ ] 实现工具调用路由到插件
   - [ ] 实现流式响应

2. **API 端点**
   - [ ] `POST /api/agent/stream` - Agent 流式对话
   - [ ] `GET /api/plugins` - 列出插件
   - [ ] `POST /api/plugins/:id/enable` - 启用插件
   - [ ] `POST /api/plugins/:id/disable` - 禁用插件

### Phase 3: Frontend Rewrite (Week 3)
1. **Agent Panel UI**
   - [ ] 重写 AgentPanel.tsx
   - [ ] 添加插件状态显示
   - [ ] 添加工具调用可视化

2. **Agent Loop**
   - [ ] 重写 agentLoop.ts
   - [ ] 使用服务端 API
   - [ ] 处理插件工具调用

3. **插件管理 UI**
   - [ ] 创建 PluginManager.tsx
   - [ ] 显示已安装插件
   - [ ] 启用/禁用插件

### Phase 4: User Plugin Support (Week 4)
1. **本地插件加载**
   - [ ] 扫描 `~/.my-claudia/plugins/` 目录
   - [ ] 支持热加载
   - [ ] 沙箱模式支持

2. **权限 UI**
   - [ ] 插件权限请求 UI
   - [ ] 权限授予/拒绝

---

## Critical Files

### 需要新建
- `shared/src/plugin-types.ts` - 插件协议定义
- `server/src/services/plugin-host.ts` - 插件主机
- `server/src/services/agent-service.ts` - Agent 服务
- `server/src/plugins/builtin/timer/index.ts` - Timer 插件
- `server/src/plugins/builtin/session-monitor/index.ts` - Session Monitor 插件
- `server/src/plugins/builtin/message-search/index.ts` - Message Search 插件
- `apps/desktop/src/components/agent/PluginManager.tsx` - 插件管理 UI

### 需要重写
- `apps/desktop/src/services/agentLoop.ts` - 使用服务端 API
- `apps/desktop/src/services/agentTools.ts` - 移除，由插件提供
- `apps/desktop/src/components/agent/AgentPanel.tsx` - 新 UI
- `apps/desktop/src/stores/agentStore.ts` - 插件状态

### 需要修改
- `server/src/server.ts` - 添加 agent 端点
- `apps/desktop/src/components/SettingsPanel.tsx` - 插件设置

### 可以删除
- `server/src/services/supervisor-service.ts` - 功能合并到插件
- `apps/desktop/src/services/clientAI.ts` - 不再需要客户端 AI

---

## Verification

### Phase 1 验证
1. 启动服务端，验证内置插件加载
2. 调用 `/api/plugins` 验证插件列表
3. 手动测试 Timer 插件的 `set_reminder` 功能

### Phase 2 验证
1. 发送消息到 `/api/agent/stream`
2. 请求设置提醒，验证 Agent 正确调用 Timer 插件
3. 验证流式响应正常

### Phase 3 验证
1. 打开 Agent Panel
2. 发送"帮我设置一个 10 秒后的提醒"
3. 验证 Agent 调用插件并返回结果
4. 10 秒后验证系统通知出现

### Phase 4 验证
1. 在 `~/.my-claudia/plugins/` 放置自定义插件
2. 重启应用，验证插件被加载
3. 测试插件的权限请求 UI

---

## Design Decisions

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 插件配置存储 | 插件目录文件 | 每个插件有独立的 `config.json`，存在插件目录 |
| MVP 范围 | 完整 Phase 1-4 | 包含用户插件支持 |
| 插件执行 | 混合模式 | 简单插件主进程，复杂插件沙箱 |
| AI 交互 | Agent 调用插件 | 用户与 Agent 对话，Agent 决定调用插件 |
| 插件开发 | JavaScript | 使用 TypeScript/JavaScript |
| 插件发现 | 渐进式 | 先本地文件，后续商店 |

## Open Questions (后续解决)

1. **插件更新**：如何处理插件版本更新和迁移？
2. **插件冲突**：多个插件提供同名工具时如何处理？
3. **沙箱边界**：哪些操作必须在沙箱中执行？
