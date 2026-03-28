# Batch 7: Server — Automation Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~5.5k 行 |
| 关键模块 | workflows (3202行), scheduled-tasks (945行), agent-triggers (336行), orchestration, claudia-branch-service |

## 发现

### 🔴 高优先级

#### 1. Generator Session Timer 泄漏（HIGH）
- **文件**: `domains/workflows/generator.ts:481-489`
- **问题**: `refine()` 异常时 session timer 未清理，30 分钟 TTL 内内存泄漏
- **修复**: catch 块中 clearTimeout + delete session

#### 2. Workflow 事件订阅竞态（HIGH）
- **文件**: `domains/workflows/service.ts:251-300`
- **问题**: create/update/delete 都调用 `rebuildEventSubscriptions()` 无同步，批量操作时丢失 handler
- **修复**: 添加 Promise 链或锁

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 3 | Approval timeout 未在 engine 销毁时清理 | engine.ts:659-671 | 需要 `destroy()` 方法 |
| 4 | Scheduled task prompt timeout 竞态 | scheduled-tasks/service.ts:217-237 | timeout 和 resolve 竞态，需用 finally 清理 |
| 5 | Agent trigger reload 惊群效应 | agent-triggers/service.ts:190-192 | 批量更新时 N 次 stop/start，需 debounce |
| 6 | Template 变量注入风险 | engine.ts:1009-1021 | `${step.output.field}` 未验证 field 名安全性 |
| 7 | Orchestrator retry 配置未暴露 | task-orchestrator.ts:341 | `maxRetries` 默认 0 且不可配置，重试功能形同虚设 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 8 | executeGraph finally 安全网不足 | engine.ts:260 |
| 9 | `any` 类型：23 处（主要在 repository 行映射） | 可接受但应逐步改进 |
| 10 | scheduled-tasks 和 agent-triggers 标记 @deprecated | 需正式移除计划 |

### ✅ 做得好的

1. **Workflow DAG 执行模型完整** — 支持条件分支、并行、重试
2. **Generator AI 响应解析失败时有重试** — 容错设计
3. **Orchestrator 并发限制正确** — 最多 3 个并行 agent task
4. **Branch service 无并发问题** — 读多写少，确定性写入

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 2 |
| MEDIUM | 5 |
| LOW | 3 |
| **总计** | **10** |
