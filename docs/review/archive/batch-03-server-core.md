# Batch 3: Server — Core Platform Review

日期：2026-03-28
状态：✅ Review + 修复完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~5k 行 |
| 关键文件 | server.ts, index.ts, db.ts, fileStore.ts, ws/*, middleware/*, routes/* |

## 发现

### 🔴 高优先级

#### 1. FileStore 清理定时器无法停止（HIGH）
- **文件**: `server/src/storage/fileStore.ts:248`
- **问题**: `setInterval` 永远运行，无清理函数
- **修复**: 导出 interval ID，提供 `stopFileStoreCleanup()` 方法

#### 2. Gateway 同步定时器管理不安全（HIGH）
- **文件**: `server/src/index.ts:254-265`
- **问题**: 通过 `(gatewayClient as any)._syncInterval` 存储定时器，类型不安全且重连时可能泄漏
- **修复**: 使用独立变量管理，在 disconnect 时清理

#### 3. virtualClients Map 增长风险（HIGH）
- **文件**: `server/src/index.ts:74, 203-211`
- **问题**: Gateway 重连时 virtualClients 累积。虽然 channel close 时有清理（line 218），但需确认覆盖所有路径
- **修复**: 添加 TTL 清理或在 gateway 重连时批量清理旧 client

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 4 | Permission timeout 未在 run 删除时清理 | ws/permission-handler.ts:25-42 | `pendingPermissions` Map 中的 timeout 需在 run force-delete 时 clearTimeout |
| 5 | Gateway client `as any` 类型逃逸 | index.ts:153,265,271 | 3 处 `as any` 访问私有属性，应定义接口 |
| 6 | Credential 解密失败未广播 | ws/permission-handler.ts:47-62 | 解密异常时 early return，其他 client 不知道 |
| 7 | SQL 查询构建模式脆弱 | routes/sessions.ts:46-47 | 动态拼接 WHERE 条件，当前参数化安全但模式易出错 |

### 🟢 低优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 8 | Gateway catch-up 查询失败返回空数组 | index.ts:224-246 | 静默失败，client 看到空历史 |
| 9 | 文件跨设备复制后删除失败无处理 | fileStore.ts:139-160 | `fs.unlinkSync` 失败时临时文件残留 |
| 10 | DB 查询大量 `as any` | index.ts:118,232,234 | 应定义行类型接口 |
| 11 | Middleware metadata 用 `Map<string, any>` | middleware/base.ts:24-28 | 应用 `unknown` 替代 |
| 12 | 断连后 orphaned runs 无 TTL | server.ts:399-413 | client 不重连时 run 永久驻留 |

### ✅ 做得好的

1. **WS 消息分发架构清晰** — Phase 2 router + legacy handler 双路径兼容
2. **认证中间件完备** — local / remote 两套认证流程
3. **Terminal Manager 实现完整** — PTY 生命周期管理到位
4. **DB migration 策略有效** — 版本化 migration 文件

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 3 |
| MEDIUM | 4 |
| LOW | 5 |
| **总计** | **12** |

## 修复记录（2026-03-31）

大部分问题在 GatewayManager 重构及之前的迭代中已被修复。本轮验证并修复了剩余项。

### 已修复（之前重构中完成）

| # | 问题 | 状态 |
|---|------|------|
| 1 | FileStore 清理定时器 | ✅ `stopFileStoreCleanup()` 存在且在 shutdown 中调用 |
| 2 | Gateway 同步定时器管理 | ✅ `GatewayManager.syncInterval` + `clearSyncInterval()` typed 管理 |
| 3 | virtualClients Map 增长 | ✅ `cleanupVirtualClients()` 在重连/断连/shutdown 中调用 |
| 4 | Permission timeout 清理 | ✅ `cleanupPendingPermissions()` 在所有 run 删除路径中调用 |
| 5 | Gateway client `as any` | ✅ `GatewayManager` typed 接口 |
| 6 | Credential 解密失败处理 | ✅ resolve deny + broadcast 已正确实现 |
| 7 | SQL 查询构建 | ✅ 重构为 Service 层（SessionQueryService/SessionLifecycleService）|
| 11 | Middleware metadata `any` | ✅ 已用 `Map<string, unknown>` |

### 本轮修复

| # | 问题 | 修复 |
|---|------|------|
| 10 | DB 查询 `as any` | 3 处 `ActiveRunsMap = Map<string, any>` 改为 `Map<string, ActiveRun>`（sessions.ts, session-messages.ts, gateway-client.ts）|
| 11 | Middleware `ws: any` | `middleware/base.ts` 的 `ConnectedClient.ws` 从 `any` 改为 `unknown` |

### 未修复（低优先级/设计选择）

| # | 问题 | 原因 |
|---|------|------|
| 8 | Gateway catch-up 返回空数组 | 已有 error logging，空数组是合理降级 |
| 9 | 跨设备复制删除失败 | 已有 try/catch + console.error，残留临时文件无害 |
| 12 | 断连后 orphaned runs | runs 由 provider callback 驱动结束，不会真正"孤立" |
