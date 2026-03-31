# Batch 2: Gateway Review

日期：2026-03-28
状态：✅ Review + 修复完成

## 概览

| 指标 | 值 |
|------|-----|
| 业务代码 | ~1.6k 行 |
| 测试代码 | ~3.7k 行 |
| 测试/业务比 | 2.34（优秀） |
| 文件数 | 5 源文件 + 10 测试文件 |

## 发现

### ~~🔴 严重问题~~

> ⚠️ **校验修订（2026-03-28）**: 以下 3 项经源码验证后降级或移除。

#### ~~1. safeCompare 逻辑错误~~ → ✅ 无问题
- **文件**: `gateway/src/server.ts:67-75`
- **原始判定**: CRITICAL — 认证绕过
- **校验结果**: **误报**。`timingSafeEqual(bufA, bufA)` 返回 `true` 但**结果被丢弃**，下一行无条件 `return false`。认证**从未被绕过**。这是标准的恒定时间填充技术（防止通过 timing 泄漏密钥长度），代码是正确的。

#### ~~2. recoveryTokens Map 无 TTL~~ → ✅ 无问题
- **原始判定**: HIGH — 内存无限增长
- **校验结果**: **误报**。`handlePeerDisconnect`（line 703→726）调用 `unregisterRecoveryToken`，正确 `delete` 了 token。所有断连路径（ping timeout、WS close、lease 过期）都经过此清理。每个 peer 一个 token，断连时移除。

#### ~~3. pendingHttpRequests 清理缺口~~ → 🟢 LOW
- **原始判定**: HIGH — 孤儿请求
- **校验结果**: **过度标记**。30s/60s timeout 兜底有效，不会泄漏。唯一问题是 peer 断连时不主动 reject pending 请求，调用者需等待 30s timeout。是延迟问题而非泄漏问题。

### 🟠 中优先级

### 🟠 中优先级

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 4 | Rate limit 检查顺序 | server.ts:242-256 | 应在解析凭据**之前**检查速率限制 |
| 5 | IP 提取信任 X-Forwarded-For | server.ts:332 | 非代理部署下可被伪造，文档中应标明需可信代理 |
| 6 | Channel ownership 竞态 | server.ts:600-611 | channel 可能在检查和发送之间被清理 |
| 7 | Backend 重连时旧 channel 处理 | server.ts:396-403 | 旧 peer 的 channel 在新 peer 接管过程中可能有竞态 |
| 8 | 流式响应超时与并发写入 | server.ts:667-672 | timeout 调用 `res.end()` 与并发 `.write()` 可能竞态 |
| 9 | Health check 不够全面 | docker-compose.yml | 仅检查 HTTP 200，不验证 DB 连接和 WS 状态 |
| 10 | GATEWAY_PORT 未验证范围 | index.ts | `parseInt('abc')` 返回 NaN，应验证 [1, 65535] |

### 🟢 低优先级

| # | 问题 | 建议 |
|---|------|------|
| 11 | WS 连接计数器 double-close | 用 `Math.max(0, count - 1)` 防御 |
| 12 | Event log 丢弃无日志 | 添加 metrics/logging |
| 13 | 重连测试不完整 | 补充 channel 关闭、catalog reset 验证 |
| 14 | DB 无备份策略 | 文档化备份流程 |

### ✅ 做得好的

1. **测试覆盖率高**（2.34x 测试/业务比）
2. **认证流程完整** — Gateway secret + rate limit + connection limit
3. **断连处理有考虑** — ping/pong + recovery token 机制
4. **Docker 配置合理** — multi-stage build, prebuilt binaries, 支持多实例
5. **HTTP 代理实现完整** — 支持流式和非流式两种模式

## 发现汇总（校验修订后）

| 严重程度 | 数量 |
|---------|------|
| ~~CRITICAL~~ | ~~1~~ → 0 |
| ~~HIGH~~ | ~~2~~ → 0 |
| MEDIUM | 7 |
| LOW | 4 + 1 (降级) |
| 误报移除 | 2 |
| **有效总计** | **12** |

## 建议修复优先级

1. **本迭代**: 速率限制检查顺序、health check 增强、端口验证
2. **下迭代**: peer 断连时主动 reject pending 请求、重连测试补充

## 修复记录（2026-03-31）

| # | 问题 | 修复 |
|---|------|------|
| 3 | pendingHttpRequests 清理缺口（降级为 LOW） | 新增 `rejectPendingProxyRequests()`，在 peer 断连和 lease 过期时主动 reject 所有 pending 请求，不再需要等待 30s 超时。 |
| 4 | Rate limit 检查顺序 | HTTP proxy handler 改为先调用 `checkRateLimit(clientIp)` 再解析和校验凭据，避免被限流的 IP 仍能触发 `safeCompare`。 |
| 5 | IP 提取信任 X-Forwarded-For | 新增 `trustProxy` 配置项（默认 `false`），仅在启用时读取 `X-Forwarded-For`。`index.ts` 通过 `GATEWAY_TRUST_PROXY=true` 环境变量控制。抽取 `extractIp()` 统一 IP 获取逻辑。 |
| 8 | 流式响应超时与并发写入 | `handleHttpProxyResponseChunk` 在写入前检查 `res.writableEnded || res.destroyed`，若流已关闭则清理 pending 状态。 |
| 10 | GATEWAY_PORT 未验证范围 | `index.ts` 新增 `isNaN` 和 `[1, 65535]` 范围校验，无效值时进程退出。 |
| 11 | WS 连接计数器 double-close | 验证已有逻辑安全：`count <= 1 ? delete : count - 1` 防御，`decrementChannelCount` 使用 `Math.max(0, ...)`。无需修改。 |

### 未修复项（低优先级/文档类）

| # | 问题 | 原因 |
|---|------|------|
| 6 | Channel ownership 竞态 | Node.js 单线程，同步 handler 内无真实竞态。已有 `?.` 防御。 |
| 7 | Backend 重连旧 channel 处理 | `handleBackendOwnerReplaced` 已正确处理：先清 channel，再清 peer.backendId，最后 terminate。 |
| 9 | Health check 不够全面 | Docker healthcheck 功能有限，当前 HTTP 200 + peer/backend 计数足够。 |
| 12 | Event log 丢弃无日志 | 事件窗口 overflow 是正常行为，静默丢弃合理。 |
| 13 | 重连测试不完整 | 测试扩展，非 bug 修复。 |
| 14 | DB 无备份策略 | 文档/运维类，非代码修复。 |
