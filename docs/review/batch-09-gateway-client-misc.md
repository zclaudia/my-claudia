# Batch 9: Server — Gateway Client & 其余 Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~2k+ 行 |
| 关键模块 | gateway-client, local-pr, notification-feed, mcp-server, events, commands, facade |

## 发现

### 🔴 高优先级

#### 1. Gateway Client 消息静默丢失（HIGH）
- **文件**: `gateway-client.ts:991-993`
- **问题**: `sendWs()` 在 WS 非 OPEN 时静默丢弃消息，无队列或重试
- **影响**: 重连窗口期间 catalog 更新、channel 消息丢失
- **修复**: 实现消息队列 + 重试

#### 2. Local PR Service `as any` 类型逃逸（HIGH）
- **文件**: `domains/local-pr/service.ts:415, 868`
- **问题**: `this.db as any` 传递给 `handleRunStart()`
- **修复**: 定义正确的类型接口

#### 3. Local PR 状态竞态条件（HIGH）
- **文件**: `domains/local-pr/service.ts:239-241`
- **问题**: PR 状态检查和刷新非原子操作，并发操作可能改变状态
- **修复**: 用 mutex 或事务包裹

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 4 | WS 事件监听器重连泄漏 | gateway-client.ts:375-387 | 重连时旧 listener 残留 |
| 5 | Review/conflict client Map 清理不保证 | local-pr/service.ts:367-403 | handleRunStart 异常时 client 残留 |
| 6 | HTTP proxy stream 无背压 | gateway-client.ts:941-984 | chunk 发送不检查连接状态 |
| 7 | 消息 handler `any` 类型 | gateway-client.ts:776 | 应使用具体消息类型 |
| 8 | 通知 async 错误被吞 | notification-feed/service.ts:43,64 | `void fn()` 无 catch |
| 9 | Event bus regex cache 无驱逐 | events/index.ts:76-93 | `patternRegexCache` 无限增长 |
| 10 | Channel Map 复合键问题 | gateway-client.ts:812-827 | 同 backend 多 channel 时互相覆盖 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 11 | Console-only 错误日志 | 应使用结构化 logger |
| 12 | Local PR 超时硬编码 | 30 分钟不可配置 |
| 13 | 未使用的 `createHttpAgent()` | 应标记 private 或移除 |
| 14 | worktreePath query 未验证 | 可能是数组 |
| 15 | Command source type 返回错误 | 始终返回 'builtin' |
| 16 | Facade listener array 未清理 | embedded-adapter.ts:46 |

### ✅ 做得好的

1. **Gateway client 重连策略完善** — 指数退避 + jitter
2. **Local PR 完整的代码审查流程** — 创建 → AI 审查 → 合并/冲突解决
3. **Event bus 设计清晰** — typed events + pattern matching
4. **Facade adapter 模式统一** — embedded/standalone 两种适配

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 3 |
| MEDIUM | 7 |
| LOW | 6 |
| **总计** | **16** |
