# Batch 9: Server Domains — Orchestration & Collaboration Review

日期：2026-03-31（Review + 修复 + DDD 分析）
状态：✅ Completed

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | `server/src/domains/{orchestration,local-pr,notification-feed}` ~3.4k 行（不含测试） |
| 关键模块 | local-pr/service.ts (1165行), orchestration/task-orchestrator.ts (534行), claudia-branch-service.ts (260行), notification/service.ts (120行) |

## 发现

### 🔴 高优先级

#### 1. Local PR Service 直接 import `../../server.js`（HIGH / 架构）
- **文件**: `local-pr/service.ts:23`
- **问题**: `import { createVirtualClient, handleRunStart } from '../../server.js'` — 领域层反向依赖应用入口，与 Batch 8 A2 同类问题
- **影响**: 隐式循环依赖，无法独立测试/部署
- **建议**: 参照 workflows 域的 DDD P1 方案，通过 AIRunnerPort / register.ts 注入

#### 2. Local PR `as any` 类型逃逸（HIGH）
- **文件**: `local-pr/service.ts:415, 868`
- **问题**: `handleRunStart()` 的 `db` 参数传入 `this.db`，但类型签名不匹配，实际使用 `as any`（隐含在 handleRunStart 的宽泛签名中）
- **修复**: 定义正确的 DB 类型接口，或通过 Port 注入消除直接依赖

#### 3. Task Orchestrator 直接操作 sessions 表（HIGH / 边界违反）
- **文件**: `orchestration/task-orchestrator.ts:155-180`
- **问题**: `executeAgentTask()` 直接 `db.prepare('INSERT INTO sessions ...')` 和 `db.prepare('UPDATE claudia_branches ...')`，绕过 SessionRepository 和 ClaudiaBranchService
- **影响**: 跳过了 repository 层的校验和事件触发，两套写入路径容易不一致
- **修复**: 通过 deps 注入 `SessionRepository` 和 `ClaudiaBranchService`，使用其 API

#### 4. Local PR 状态竞态条件（HIGH）
- **文件**: `local-pr/service.ts:191-210`
- **问题**: `createPR()` 中虽然用了 `db.transaction()` 做原子重检 + 插入，但 async git 操作（L170-182）在事务外部执行，期间另一个请求可能已完成同样的 git 操作
- **现状**: 代码已有缓解措施（事务内 duplicate check），实际风险较低
- **评估**: 保留当前方案，标注为 LOW（已缓解）

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | **virtualClient 泄漏** | task-orchestrator.ts:260-265 | `catch { /* ignore parse errors */ }` 吞掉所有异常，若 `settleTask` 本身抛异常，虚拟客户端和 safetyTimer 可能泄漏 |
| 6 | **Orchestrator 依赖 createVirtualClient 从 ws/types.ts** | task-orchestrator.ts:20 | 从 `../conversation/ws/types.js` 导入，orchestration 域对 conversation 域产生直接依赖 |
| 7 | **NotificationFeedService `void this.notifyFn?.()`** | notification/service.ts:43,64 | async 函数的错误被静默吞掉，应加 `.catch()` |
| 8 | **ClaudiaBranchService 与 orchestration 同域** | claudia-branch-service.ts | BranchService 管理的是会话分支分配，更贴近 conversation 的关注点而非 orchestration |
| 9 | **Orchestrator tick() N+1 查询** | task-orchestrator.ts:478-512 | 每次 tick 对每个 waiting task 的每个 dependency 调用 `repo.findById()`，O(W×D) 次查询 |
| 10 | **Local PR 硬编码常量** | local-pr/service.ts:30-34 | `STALE_TIMEOUT_MS`, `MAX_FINISHED_PRS_PER_PROJECT`, `INLINE_DIFF_MAX_CHARS` 不可配置 |
| 11 | **Local PR stale 检测粒度粗** | local-pr/service.ts:994-1013 | `processStale()` 对所有 reviewing/merging PR 统一 30 分钟超时，但 review 和 merge 的合理超时差异大 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 12 | `feedOverrides` Map 无持久化 | task-orchestrator.ts:61 — 重启后丢失，task 完成时找不到 override |
| 13 | `steerTask()` 永远抛异常 | task-orchestrator.ts:353-354 — Phase 2 未实现，应标记 `@deprecated` 或不暴露 |
| 14 | `resolveMergeCommitSha` fallback 扫 200 条 log | local-pr/service.ts:1150-1163 — 应限制搜索范围或在 merge 时始终持久化 SHA |
| 15 | console.log 过度 | 各文件 — 应使用结构化 logger |

### ✅ 做得好的

1. **Local PR 完整的 PR 生命周期** — create → review → merge/conflict → resolve → merge，含 stale 检测和自动清理
2. **Merge 串行化** — `mergeLock = new Mutex()` 正确防止并发 merge
3. **Task Orchestrator 的 waiter 模式** — 优雅的 `waitForTask()` + `resolveWaiters()` 实现
4. **NotificationFeedService 简洁清晰** — 单一职责，接口干净
5. **ClaudiaBranchService 分支分配算法** — 5 条规则覆盖完整，代码清晰可读

## Refactor Candidates

| # | 问题 | 建议 |
|---|------|------|
| R1 | **Local PR Service → server.js 反向依赖** | 参照 workflows DDD P1，提取 AIRunnerPort，通过 register.ts 注入 |
| R2 | **Task Orchestrator 直接 SQL** | 注入 SessionRepository + ClaudiaBranchService，消除裸 SQL |
| R3 | **ClaudiaBranchService 错放在 orchestration** | 移至 conversation 域或提取为独立域 |
| R4 | **createVirtualClient 跨域依赖** | orchestration 应通过 Port 接口获取 "agent runner" 能力，不直接依赖 conversation/ws |
| R5 | **Local PR Service 1165 行** | 考虑按职责拆分：PRLifecycle（创建/关闭）、PRReview（AI 审查）、PRMerge（合并/冲突） |

## Test Gaps

- 缺少 `executeAgentTask()` 的 safetyTimer 超时测试（虚拟客户端是否正确清理）
- 缺少 `tick()` 中 dependency resolution 的边界测试（循环依赖、多层依赖链）
- 缺少 `processStale()` 的 stale PR 重置 + 并发 review 完成竞态测试
- 缺少 `cleanupFinishedPRs()` 在 removeWorktree 失败时的回滚测试
- 缺少 `NotificationFeedService.notifyFn` 抛异常时的行为测试
- 缺少 `ClaudiaBranchService.allocateBranch()` 在 session 已删除场景的测试

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 3（+1 降级为 LOW） |
| MEDIUM | 7 |
| LOW | 4 |
| Refactor Candidate | 5 |
| Test Gap | 6 |
| **总计** | **25** |

## 与初步报告对比

初步报告（旧 Batch 9）覆盖了 gateway-client + local-pr + notification-feed + misc，共 16 项发现。本次正式 review：

- gateway-client 相关（#1, #4, #6, #7, #10）已归入 Batch 5
- local-pr #2（`as any`）、#3（状态竞态）、#5（client Map 清理）继续跟踪
- notification-feed #8（async 错误吞掉）继续跟踪
- **新增 orchestration 域 review**（首次覆盖）：发现 3 项 HIGH + 4 项 MEDIUM

## 修复记录（2026-03-31）

### 已修复

| # | 问题 | 修复方式 |
|---|------|---------|
| #1 | Local PR `import server.js` 反向依赖 | 定义 `LocalPRAIDeps.startAISession` port，通过 `register.ts` 注入 `createVirtualClient + handleRunStart` 的组合 |
| #2 | Local PR `as any` 类型逃逸 | 随 #1 一起解决——不再直接传 `this.db` 给 `handleRunStart` |
| #3 | Orchestrator 裸 SQL 操作 sessions/branches | 注入 `createSession` / `sessionExists` dep + 使用同域 `ClaudiaBranchService` |
| #5 | virtualClient catch 吞所有异常 | 改为 `catch (err) { console.error(...) }` |
| #6 | Orchestrator 跨域 import `createVirtualClient` | 注入 `deps.createVirtualClient`，域内零跨域 runtime import |
| #7 | NotificationFeedService `void notifyFn?.()` | 改为 `.catch(err => console.error(...))` |

### Refactor 完成状态

| # | 建议 | 状态 |
|---|------|------|
| R1 | Local PR → server.js 反向依赖 | ✅ `startAISession` port 注入 |
| R2 | Orchestrator 直接 SQL | ✅ 注入 session deps + ClaudiaBranchService |
| R3 | ClaudiaBranchService 位置 | 🟡 保留在 orchestration，待 conversation review 时决定 |
| R4 | createVirtualClient 跨域依赖 | ✅ 通过 deps 注入，runtime import 清零 |
| R5 | Local PR 1165 行拆分 | 🟡 后续优化 |

### 修复后域依赖状态

- **orchestration**: 零跨域 runtime import（仅 `uuid`, `better-sqlite3`, `@my-claudia/shared`）
- **local-pr**: 消除 `../../server.js` 反向依赖，AI 能力通过 port 注入
- **notification-feed**: 异步错误不再静默吞掉

172 个相关测试全部通过。

## DDD 分析：Orchestrator 模块划分

### 当前 Bounded Context

```
orchestration/
├── types.ts                   # TaskOrchestrator 接口 + 领域类型
├── repository.ts              # OrchestratorTask CRUD
├── task-orchestrator.ts       # 核心编排逻辑（factory function）
└── claudia-branch-service.ts  # 会话分支分配服务
```

### 评估

**1. Aggregate Root 识别**

`OrchestratorTask` 是明确的聚合根：
- 拥有完整的生命周期（queued → running → completed/failed/cancelled）
- 拥有子任务（parentTaskId/rootTaskId）
- 管理一致性边界（retry, dependency resolution, timeout）

**2. ClaudiaBranchService 的归属问题**

`ClaudiaBranchService` 管理的是「会话分支分配」，其关注点是：
- 哪个分支可以复用，哪个需要 fork
- 分支与 session 的绑定关系

从 DDD 角度看，它服务于 **两个** bounded context：
- **orchestration**: `executeAgentTask()` 用它查找/创建 session
- **conversation**: `handleClaudiaMessage()` 用它分配用户交互分支

**建议**: 保留在 orchestration 可接受（它操作的表 `claudia_branches` / `claudia_project_state` 是 orchestration 聚合的一部分）。如果未来 conversation 域也需要管理自己的分支逻辑，可以提取为独立的 `branch-management` 子域。

**3. TaskOrchestrator 的职责边界**

当前 `createTaskOrchestrator()` 同时负责：
- **Agent task 编排**: spawn → queue → execute → settle（核心领域逻辑）
- **External task 镜像**: syncExternalTask（读模型/查询侧）
- **Virtual client 生命周期管理**: 创建 client、注册到 clients map、timeout、cleanup
- **Notification feed 同步**: 调用 notificationService

从 DDD 角度，**virtual client 管理** 和 **notification feed 同步** 属于基础设施/应用层关注点，不应在域层。

**4. Port/Adapter 改进方向**

本轮修复已完成的：
- `createVirtualClient` → deps 注入 ✅
- `createSession` / `sessionExists` → deps 注入 ✅

后续可考虑：
- 提取 `AgentRunnerPort`（封装 virtual client + handleRunStart + clients map 管理）
- 提取 `TaskNotificationPort`（封装 notificationService 调用）

### 总结

orchestration 模块的抽象划分**基本合理**：
- 聚合根清晰（OrchestratorTask）
- 仓储模式完整（TaskRepository）
- 修复后依赖方向正确（零跨域 runtime import）

**主要改进已落地**，剩余的 R3（BranchService 位置）和 R5（Local PR 拆分）属于中长期优化。

## 核心建议

1. **6 项 bug/架构修复已落地**，172 测试通过
2. Orchestrator 域依赖已清零，符合 DDD bounded context 要求
3. Local PR 通过 `startAISession` port 解耦，模式可推广至 supervision/scheduled-tasks
4. **下一步**：R3 在 conversation 域 review 时决定，R5 按需拆分
