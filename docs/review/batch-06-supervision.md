# Batch 6: Server — Supervision Review

日期：2026-03-31
状态：✅ 收尾完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~4.1k 行 |
| 最大文件 | supervisor-service.ts（已从 1705 行拆分为 façade + 子模块） |
| 关键模块 | supervisor-service, review-engine, checkpoint-engine, context-manager, task-runner, state-recovery, worktree-pool, plan-validator |

## 发现

### ✅ 已修复

#### 1. Virtual Client 清理竞态
- **文件**: `supervisor-service.ts:998,1046`
- **问题**: `handleRunStart` 是 fire-and-forget，抛异常时 `virtualClients.delete()` 可能不执行
- **状态**: 已修复
- **修复**: 在 `task-execution.ts` 启动链路中统一包裹启动异常，确保 virtual client 清理、任务落失败态、worktree 在需要时释放

#### 2. Worktree 资源泄漏
- **文件**: `supervisor-service.ts:886-1020`
- **状态**: 校验后降级并补强
- **结论**: ownership 模型本身成立；启动异常路径现已补充同步失败后的 worktree 释放，风险关闭

#### 3. tick() 并发竞态
- **文件**: `supervisor-service.ts:720-824`
- **状态**: 误报，已校验关闭
- **结论**: `tick()` 为同步执行，单线程模型下不存在该类竞态

#### 4. 异步回调异常未处理
- **文件**: `supervisor-service.ts:790-794`
- **问题**: `startLiteTask().catch()` 吞掉错误，task 永远停在 queued 状态，下次 tick 无限重试
- **状态**: 已修复
- **修复**: `task-scheduler.ts` catch 中会把仍处于 `queued` 的任务转为 `failed`

### ✅ 已修复的中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | clearTaskSessionReadOnly 静默失败 | `task-lifecycle.ts` | 保留错误日志，运行结束后统一清只读状态 |
| 6 | `any` 类型泛滥 | 多文件 | 主路径 `virtualClients` 等已收紧；剩余宽类型主要在外围 glue code |
| 7 | Checkpoint interval 项目删除后不清理 | `checkpoint-engine.ts` | 已修复，项目缺失时 interval 自清理 |
| 8 | Review verdict 解析脆弱 | `review-engine.ts` | 已修复，支持大小写差异和多行块 |
| 9 | Task result 验证不完整 | `task-runner.ts` | 已修复，缺少必需字段时返回 `null` |
| 10 | Document 更新静默失败 | `context-manager.ts` | 已修复，frontmatter 失败时保留 version/category/source fallback |
| 11 | Pool init 竞态 | `worktree-manager.ts` | 已修复，增加并发初始化去重 |
| 12 | **架构**: 单体类违反 SRP | `supervisor-service.ts` | 已修复，拆为 task-admin / task-lifecycle / task-execution / supervisor-agent / supervisor-context / task-prompt |
| 13 | 未文档化的内部 API | `supervisor-service.ts` | 保留为低优先级；当前接口已明显收敛 |
| 14 | Recovery 操作非原子 | `state-recovery.ts` | 已修复，按步骤隔离并报告 `recovery_error` |
| 15 | catch 块缺少错误上下文 | 多文件 | 部分改善；仍有零散日志可继续优化 |
| 16 | 异步操作无超时 | `review-engine/task-runner` | 已修复主要路径，增加 review evidence / review start / review run 超时保护 |
| 17 | ContextManager cache 无限增长 | `supervisor-context.ts` | 已修复，项目缺失或 stop 时清理缓存 |
| 18 | pollInterval 进程崩溃后不清理 | `supervisor-service.ts` | 已修复，增加 process exit/signal cleanup hook |

### 🟡 剩余低优先级 / 可选优化

| # | 问题 | 说明 |
|---|------|------|
| 19 | Plan validator 反馈不够具体 | 仍可继续区分 `missing` / `invalid` |
| 20 | Checkpoint broadcast 时序 | 仍可继续细抠 archive / broadcast 先后顺序 |
| 21 | 零散宽类型与日志结构化 | 主要在外围 glue code，不影响核心行为 |

### ✅ 做得好的

1. **Worktree pool 设计精巧** — slot 复用 + 自动清理
2. **State recovery 机制完整** — 中断的 run、stuck task 都有恢复策略
3. **Checkpoint engine 功能完备** — 定时 + 事件驱动 + manual 三种触发
4. **Review engine 集成完整** — AI 审查 + 手动审查双通道

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| 已修复/关闭 | 18 |
| 剩余低优先级 | 3 |
| **总计跟踪项** | **21** |

## 核心建议

1. Batch 6 可正式关闭，后续不需要再继续做结构性拆分
2. 若继续优化，优先处理外围类型收紧和日志结构化
3. plan validator / checkpoint 时序属于后续可选体验改进
