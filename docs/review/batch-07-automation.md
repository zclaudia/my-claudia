# Batch 7: Server — Automation Review

日期：2026-03-31（第二轮）
状态：✅ 修复完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | `server/src/domains/{workflows,scheduled-tasks,agent-triggers,orchestration}` ~7.6k 行 |
| 关键模块 | workflows/engine (1100行), workflows/generator, workflows/service, orchestration/task-orchestrator, scheduled-tasks/service, agent-triggers/service |

## 第一轮发现（2026-03-28）& 第二轮修复（2026-03-31）

### ✅ 已修复

#### 1. Generator Session Timer 泄漏（HIGH）
- **文件**: `workflows/generator.ts` refine()
- **问题**: `callAI()` 抛异常时 session timer 未清理，30 分钟 TTL 内内存泄漏
- **修复**: refine() 中 callAI 用 try-catch 包裹，异常时调用 `destroySession()` 清理 timer 和 session

#### 2. Workflow 事件订阅竞态（HIGH → 降级为 LOW）
- **文件**: `workflows/service.ts` rebuildEventSubscriptions()
- **原始判定**: HIGH — 批量操作时丢失 handler
- **校验结果**: `rebuildEventSubscriptions()` 是同步方法，Node.js 单线程模型下无真正竞态。批量操作会产生 N 次全量重建（性能浪费）但不会丢失 handler
- **状态**: 降级为 LOW，不阻塞

#### 3. Approval timeout 未在 engine 销毁时清理（MEDIUM）
- **文件**: `workflows/engine.ts`
- **问题**: WorkflowEngine 无 `destroy()` 方法，pending approval timeout 在 engine 级别无统一清理
- **修复**: 添加 `destroy()` 方法，清理所有 pendingApprovals 的 timeout 并 reject

#### 4. Scheduled task prompt timeout 竞态（MEDIUM）
- **文件**: `scheduled-tasks/service.ts` executePrompt()
- **问题**: timeout handler 中 `activeRuns.delete()` 会在 executeTask finally 之前执行，导致同一任务可能被重复调度
- **修复**: 添加 `settled` guard 防止 timeout 和 run_completed/run_failed 双重触发；移除 timeout handler 中的 activeRuns.delete（统一由 executeTask.finally 清理）

#### 5. Agent trigger reload 惊群效应（MEDIUM）
- **文件**: `agent-triggers/service.ts` updateTrigger()
- **问题**: 批量更新 N 个 trigger 触发 N 次 stop/start
- **修复**: `reload()` 改为 100ms debounce，批量更新合并为一次 stop/start

#### 6. Template 变量注入风险（MEDIUM / 安全）
- **文件**: `workflows/engine.ts` resolveConfig()
- **问题**: `JSON.stringify → resolveTemplate → JSON.parse` 模式下，step output 含引号/反斜杠时会破坏 JSON 结构，可能导致运行时异常或非预期配置
- **修复**: 废弃 JSON 字符串层面的替换，改为在 parsed object 上递归替换字符串值（`deepResolveTemplate`），消除 JSON injection 风险

#### 7. Orchestrator retry 配置未暴露（MEDIUM）
- **文件**: `orchestration/task-orchestrator.ts` spawnTask()
- **问题**: `maxRetries` 硬编码为 0，SpawnTaskConfig 无该字段
- **修复**: SpawnTaskConfig 增加 `maxRetries?: number` 字段；spawnTask 改为 `config.maxRetries ?? 0`

#### 8. executeGraph finally 安全网（LOW）
- **文件**: `workflows/engine.ts` startRun()
- **状态**: 第一轮已修复。`.catch()` 检查 run 状态后标记失败，`.finally()` 清理 activeRuns

### 🟡 剩余低优先级

| # | 问题 | 说明 |
|---|------|------|
| 9 | `any` 类型 | 部分改善（agent-triggers 已改 unknown），orchestrator deps 仍有显式 any（带 eslint 注释） |
| 10 | scheduled-tasks / agent-triggers @deprecated | ✅ 已标记。实际下线需迁移适配层，属于中期规划 |
| 2 | rebuildEventSubscriptions 性能 | 同步全量重建无竞态但有 N 次冗余重建，可加 debounce |

## 新增架构发现（DDD 分析）

### Refactor Candidates

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| A1 | **Engine God Object**: 11 种 step handler 内嵌在 WorkflowEngine（1100 行） | 违反 SRP，engine 同时承载图遍历 + 步骤执行 + 变量插值 + 审批管理 | 将 step handler 抽到 `step-handlers/` 目录，engine 通过注册表分发 |
| A2 | **Domain → server.js 反向依赖**: engine.ts / generator.ts 直接 import `../../server.js` 的 `createVirtualClient`、`handleRunStart` | 领域层反向依赖应用入口，隐式循环 | 通过 register.ts 注入这些能力 |
| A3 | **三域并行运行**: workflows / scheduled-tasks / agent-triggers 三套 ticker + routes 独立运行 | 统一模型（workflow）已存在但旧域未真正下线 | 为旧 API 增加 deprecation header，新建 scheduled-task 自动转 workflow |
| A4 | **Orchestration 职责混乱**: TaskOrchestrator + ClaudiaBranchService 放在同一域 | 任务调度和分支分配是不同关注点 | ClaudiaBranchService 移到 conversation 域 |
| A5 | **缺少 Value Objects**: WorkflowDefinition / Trigger 是 plain object，校验分散在 routes 和 engine | 领域完整性靠外层保障 | 在构造时校验 DAG/trigger/config |
| A6 | **缺少 Domain Events**: workflow 完成/失败只做 WS broadcast | 其他域无法响应 workflow 生命周期 | 发 domain event，notification-feed / orchestrator 通过订阅获取 |

### Test Gaps

- 缺少 `refine()` 异常场景的 session 清理测试
- 缺少 `resolveConfig` 含特殊字符（引号、反斜杠、unicode）step output 的插值测试
- 缺少 `destroy()` 后 pending approval 正确 reject 的测试
- 缺少 orchestrator `maxRetries > 0` 场景的重试测试
- 缺少 scheduled task prompt timeout 与 run_completed 竞态的时序测试
- 缺少 agent trigger 批量 update 后 debounce 合并的测试

## 发现汇总

| 类别 | 数量 |
|------|------|
| 已修复（本轮） | 6 |
| 已修复（上轮） | 1 |
| 降级关闭 | 1 |
| 剩余低优先级 | 3 |
| 新增架构候选 | 6 |
| 测试缺口 | 6 |

## 核心建议

1. **本轮 8 项修复已落地**，剩余 3 项低优先级不阻塞
2. 架构改进优先推荐 **A1（Engine 拆分 step handler）** 和 **A2（DI 注入替代 server.js import）**，这两项可在后续 batch 中独立执行
3. **A3（旧域下线）** 是中期目标，需先确认前端是否仍调用 scheduled-tasks / agent-triggers API
