# Batch 10: Server Infra — Providers Review

日期：2026-03-28
状态：✅ Review + 修复完成

> 编号校准说明（2026-03-29）：
> 本报告生成于旧的 13 批次 review 体系，因此文件名中的 `Batch 4` 是**历史编号**。
> 在当前的 [project-review-plan.md](./project-review-plan.md) 中，本报告对应的是 **Batch 10: Server Infra — Providers**。
> 当前计划里的 **Batch 4** 是 `server/src/{router,routes,repositories}` 的 API Surface review，不是 provider layer。

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~6.3k 行（19 源文件 + 14 测试文件） |
| 最大文件 | opencode-sdk.ts (1666 行) |
| Provider 数量 | 5（Claude, OpenCode, Codex, Cursor, Kimi） |

## 发现

### 🔴 高优先级

#### 1. 全局 Map 无清理策略（HIGH）
- **影响文件**:
  - `opencode-sdk.ts:272` — `sessionServerMap`
  - `opencode-sdk.ts:282` — `mcpBridgeInjected`
  - `codex-sdk.ts:270` — `codexInstances`
  - `claude-sdk.ts:750,807` — `cachedModels`, `cachedCommands`
- **问题**: 模块级 Map/Set 无 TTL 无驱逐，长时间运行后内存无限增长
- **修复**: 添加 TTL 驱逐机制或定期清理

#### 2. Session Abort 清理不完整（HIGH）
- **文件**: `kimi-sdk.ts:813-828`, `cursor-sdk.ts:420-426`
- **问题**: Kimi abort 时 `sessionToProcessKey` 双向映射未完全清理；Cursor 不清理已死进程
- **修复**: abort 时无论进程是否存在，都执行完整清理

#### 3. OpenCode Session 竞态条件（MEDIUM→HIGH）
- **文件**: `opencode-sdk.ts:1077-1101`
- **问题**: 并发请求用同一 sessionId 时，`sessionServerMap` 检查与使用之间有竞态
- **修复**: 添加版本戳或验证时间戳

### 🟠 中优先级 — 跨 Provider 一致性问题

#### 4. 错误处理策略不统一

| Provider | 重试 | 配额检测 | Backoff | 可靠性 |
|----------|------|---------|---------|--------|
| Claude | ✅ 2 级重试 | ✅ | ✅ 智能 backoff | 高 |
| Codex | ✅ 3 级重试 | ✅ | ✅ 双层 backoff | 高 |
| OpenCode | ✅ SSE fallback + polling | 部分 | ✅ | 中 |
| Kimi | ❌ 无重试 | ❌ | ❌ | 低 |
| Cursor | ❌ 无重试 | ❌ | ❌ | 低 |

**建议**: 创建共享 `ProviderRetryStrategy` 基类

#### 5. Adapter 接口不一致
- **文件**: `types.ts:37`
- **问题**: `abort(sessionId, cwd)` — OpenCode 需要 cwd，Claude/Cursor 只用 sessionId
- **影响**: TypeScript 不报错（参数可选），但运行时行为不一致

#### 6. 子进程泄漏风险
- **文件**: `opencode-sdk.ts:414-457`
- **问题**: 如果 OpenCode server 从 `this.servers` 删除而未调用 `stopServer()`，exit handler 仍持有引用
- **修复**: graceful shutdown 时调用 `stopAll()`

#### 7. 临时文件累积
- **文件**: `claude-sdk.ts:88-117`
- **问题**: 每 30 分钟清理一次，但取消的 run 的图片可能驻留 1 小时+
- **修复**: session 完成时立即清理相关临时文件

### 🟠 其他中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 8 | `any` 类型逃逸 | opencode-sdk.ts:1159,1360; codex-sdk.ts:315 | 应创建类型守卫 |
| 9 | PCP manifest 缺少 notes | pcp-negotiator.ts | 不解释为何某些 capability 仅部分支持 |
| 10 | Cursor 静默丢弃解析失败的事件 | cursor-sdk.ts:248 | `continue` 不报错，应学 Kimi 的 fallback |
| 11 | 环境变量注入顺序 | opencode-sdk.ts:410-412 | `options.env` 在 sanitize 之前 spread，应先 sanitize |
| 12 | Session ID 格式不统一 | 各 adapter | Claude 用 UUID，Kimi 用 `myclaudia-{timestamp}-{random}` |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 13 | 死代码: `createClaudeAdapter()`, `createKimiAdapter()` | 已被 Adapter class 替代 |
| 14 | 日志前缀不统一 | `[Claude SDK]` vs `[OpenCode]` vs `[Codex]` |
| 15 | Manifest 声明与实际不符 | Kimi 声明支持图片但仅 log warning |

### ✅ 做得好的

1. **Adapter 模式总体一致** — 所有 provider 都实现 `run()` async generator
2. **PCP 协商机制完整** — capability 发现 + 降级策略
3. **Claude SDK 质量最高** — 完整的重试、错误分类、模型/命令发现
4. **测试覆盖** — 所有 5 个 provider 都有测试文件

## 文件大小问题

| 文件 | 行数 | 建议 |
|------|------|------|
| opencode-sdk.ts | 1666 | 拆分为 server-manager + event-mapper + sse-client |
| codex-app-server.ts | 1020 | 拆分为 http-client + event-mapper |
| claude-sdk.ts | 919 | 可接受，逻辑内聚 |
| kimi-sdk.ts | 842 | 可接受 |

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 3 |
| MEDIUM | 9 |
| LOW | 3 |
| **总计** | **15** |

## DDD 架构 Review（2026-03-31）

### Bounded Context 评估

providers/ 域本质上是一个 **Port/Adapter** 边界，将外部 CLI 工具适配为统一的 `ProviderAdapter` 接口。

#### 子模块划分

| 子模块 | 文件 | 评价 |
|--------|------|------|
| Port 接口 | types.ts, message-types.ts | ✅ 清晰（修复后） |
| Adapter 实现 | claude-adapter, opencode-adapter, 等 | ✅ 一致的模式 |
| SDK 通信层 | claude-sdk, opencode-sdk, 等 | 🟡 文件偏大 |
| PCP 协商 | pcp-negotiator, pcp-capability, pcp-permission | ✅ 优秀，纯函数 |
| Manifest | manifests.ts | ✅ 声明式配置 |
| CLI Jobs | cli-jobs/ | ✅ 内聚的子域 |
| 生命周期 | initializer.ts, registry.ts | ✅ 修复后无副作用 |

### 发现的 DDD 问题

| # | 问题 | 优先级 | 状态 |
|---|------|--------|------|
| A | ClaudeMessage/SystemInfo 等核心类型定义在 claude-sdk.ts | HIGH | ✅ 提取到 message-types.ts |
| B | claude-sdk.ts 模块级副作用（定时器 + 文件操作） | MEDIUM | ✅ 移至 initializer.ts |
| C | Route 层穿透到 opencode-sdk/claude-sdk 具体实现 | MEDIUM | 🟡 后续优化 |
| D | 死代码：createClaudeAdapter, createKimiAdapter | LOW | ✅ 已删除 |
| E | Adapter/SDK 职责分裂不一致 | LOW | 📝 记录为设计约束 |

## 修复记录（2026-03-31）

### 已修复

| # | 问题 | 修复方式 |
|---|------|---------|
| #1 | 全局 Map 无清理策略 | sessionServerMap/mcpBridgeInjected 在 stopServer/stopAll 时清理；sessionServerMap 添加 1h TTL |
| #2 | Session abort 清理不完整 | Kimi: 无条件清理 sessionToProcessKey + activeProcesses；Cursor: 添加 SIGKILL fallback |
| #3 | OpenCode session 竞态 | sessionServerMap 添加 updatedAt 时间戳 + SESSION_MAP_STALE_MS 过期检查 |
| #7 | 临时文件清理副作用 | 定时器从 claude-sdk.ts 模块级移至 initializer.ts 显式调用 |
| #8 | `any` 类型逃逸 | opencode-sdk.ts: 添加 OpenCodeProviderInfo 类型 + SSE event 类型断言 |
| #9 | Manifest 缺少 notes | Kimi manifest: chat.stream 和 input.image 添加 notes |
| #10 | Cursor 静默丢弃解析失败 | 添加 console.warn 记录 JSON 解析失败行 |
| #11 | 环境变量注入顺序 | sanitize 在 spread user env 之前执行 |
| #13 | 死代码 | 删除 createClaudeAdapter + createKimiAdapter 及其测试 |
| DDD-A | 核心类型错放在 claude-sdk.ts | 提取 message-types.ts，types.ts 改为从 message-types 导入 |
| DDD-B | 模块级副作用 | 清理定时器移至 initializer.ts.startTempFileCleanup() |
| DDD-D | 外部域导入 claude-sdk.ts | 7 个文件改为从 types.js 导入（Port 接口层） |

### 未修复（后续优化）

| # | 问题 | 原因 |
|---|------|------|
| #4 | 错误处理策略不统一 | 需要共享 RetryStrategy 基类，规模较大 |
| #5 | Adapter abort 接口不一致 | OpenCode 需要 cwd 参数，breaking change |
| #6 | 子进程泄漏风险 | stopAll 已在 shutdownProviders 中调用 |
| #12 | Session ID 格式不统一 | 各 provider 各有合理选择 |
| #14 | 日志前缀不统一 | 不影响功能 |
| #15 | Kimi 图片实际支持 | reliability 已降级为 best_effort |
| DDD-C | Route 穿透到具体 SDK | 需要 ProviderAdapter 接口扩展，规模较大 |

### 修复后依赖状态

- **message-types.ts**: 零外部依赖（仅 `@my-claudia/shared`）
- **types.ts**: 从 message-types.ts 导入（不再依赖 claude-sdk.ts）
- **claude-sdk.ts**: 无模块级副作用（定时器移至 initializer.ts）
- **conversation/ws/\***: 全部改为从 `providers/types.js` 导入（不再穿透到 claude-sdk.js）

309 个 provider 测试全部通过，TypeScript 零错误。
