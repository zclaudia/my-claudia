# Batch 6: Server — Supervision Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~4.1k 行 |
| 最大文件 | supervisor-service.ts (1705 行，项目第二大文件) |
| 关键模块 | supervisor-service, review-engine, checkpoint-engine, context-manager, task-runner, state-recovery, worktree-pool, plan-validator |

## 发现

### 🔴 高优先级

#### 1. Virtual Client 清理竞态（HIGH）
- **文件**: `supervisor-service.ts:998,1046`
- **问题**: `handleRunStart` 是 fire-and-forget，抛异常时 `virtualClients.delete()` 可能不执行
- **修复**: 用 try-catch 包裹，确保清理

#### ~~2. Worktree 资源泄漏~~ → 🟢 LOW（校验修订）
- **文件**: `supervisor-service.ts:886-1020`
- **原始判定**: HIGH
- **校验结果**: ownership 模型是故意设计。`taskMarkedRunning` 前的错误有 catch + release；标记后 worktree 转交给 task lifecycle，在 `run_failed`/`approveTaskResult`/`rejectTaskResult` 中 release。所有完成路径都有释放。

#### ~~3. tick() 并发竞态~~ → ✅ 无问题（校验修订）
- **文件**: `supervisor-service.ts:720-824`
- **原始判定**: HIGH
- **校验结果**: **误报**。`tick()` 是同步函数（返回 `void`），JS 单线程执行模型下同步函数运行到完成前不会 yield。`startTask().catch()` 是 fire-and-forget，不影响 tick 本身。无需 mutex。

#### 4. 异步回调异常未处理（HIGH）
- **文件**: `supervisor-service.ts:790-794`
- **问题**: `startLiteTask().catch()` 吞掉错误，task 永远停在 queued 状态，下次 tick 无限重试
- **修复**: catch 中将 task 标记为 failed

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | clearTaskSessionReadOnly 静默失败 | supervisor-service.ts:1090-1101 | session 保持 readOnly，阻塞编辑 |
| 6 | `any` 类型泛滥 | supervisor-service.ts 多处 | `virtualClients: Map<string, any>`, `this.db as any` 等 |
| 7 | Checkpoint interval 项目删除后不清理 | checkpoint-engine.ts:343-362 | timer 永远触发 |
| 8 | Review verdict 解析脆弱 | review-engine.ts:166-201 | `approved: true` vs `Approved: true` 导致误判 |
| 9 | Task result 验证不完整 | task-runner.ts:98-135 | 缺少字段时静默用默认值 |
| 10 | Document 更新静默失败 | context-manager.ts:178-194 | frontmatter 解析失败时丢失版本历史 |
| 11 | Pool init 竞态 | supervisor-service.ts:1673-1681 | 两个 task 并发时 `pool.init()` 可能调用两次 |
| 12 | **架构**: 1705 行单体类违反 SRP | supervisor-service.ts | 建议拆为 TaskScheduler + TaskLifecycle + AgentController + ResourceManager |
| 13 | 未文档化的内部 API | supervisor-service.ts | `hasWorktreePool()` 仅供 StateRecovery 使用 |
| 14 | Recovery 操作非原子 | state-recovery.ts:29-57 | 部分步骤失败时报告不完整 |
| 15 | catch 块缺少错误上下文 | 所有文件 | 无 error.stack/cause |
| 16 | 异步操作无超时 | review-engine/task-runner | 如果 run 永不完成，task 永久停在 reviewing |
| 17 | ContextManager cache 无限增长 | supervisor-service.ts:31 | 项目删除后 ContextManager 仍驻留 |
| 18 | pollInterval 进程崩溃后不清理 | supervisor-service.ts:97-120 | 需要 process.on('exit') hook |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 19 | Plan validator 反馈不够具体 | 不区分 missing vs invalid |
| 20 | Checkpoint broadcast 在 archive 之前 | 前端收到完成消息但 DB 未更新 |

### ✅ 做得好的

1. **Worktree pool 设计精巧** — slot 复用 + 自动清理
2. **State recovery 机制完整** — 中断的 run、stuck task 都有恢复策略
3. **Checkpoint engine 功能完备** — 定时 + 事件驱动 + manual 三种触发
4. **Review engine 集成完整** — AI 审查 + 手动审查双通道

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 4 |
| MEDIUM | 14 |
| LOW | 2 |
| **总计** | **20** |

## 核心建议

1. **立即**: 修复 worktree 泄漏、tick 竞态、async 异常处理
2. **短期**: 添加 Mutex 到 pool init、为 async 操作加 timeout
3. **中期**: 拆分 supervisor-service.ts（建议分 4 个子模块）
