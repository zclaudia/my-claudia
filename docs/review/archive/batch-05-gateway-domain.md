# Batch 5: Server Domain — Gateway Review

日期：2026-03-30
状态：✅ 已完成 review 与关键修复落地

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | `server/src/domains/gateway/` |
| 业务代码 | ~2.5k 行 |
| 测试代码 | ~1.1k 行 |
| 最大文件 | `gateway-client.ts` (~1061 行) |
| 关键角色 | `GatewayClient` / `GatewayManager` / `EmbeddedGatewayAdapter` / `StandaloneFacadeAdapter` |

## 实施结果

Batch 5 当前已经不只是 review，首轮关键修复也已落地：

- `GatewayClient` 已修复 stale `backend_channel_closed` 晚到时误删新 channel 的问题。
- local short-circuit catch-up 失败已不再静默返回空补丁，而会继续沿 facade 错误通道上抛。
- outgoing catalog snapshot / event / reset 已增加基于当前 channel epoch 的一致性过滤。

## Findings

### 🔴 高优先级

#### 1. 旧 channel 的关闭回执会误删新 channel（HIGH）
- **当前状态**: 已修复
- **文件**: [gateway-client.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/gateway-client.ts)
- **位置**: `handleBackendChannelClosedMsg()`
- **问题**:
  - 当前收到 `backend_channel_closed` 时，代码直接按 `backendId` 执行 `this.outgoingChannels.delete(msg.backendId)`。
  - 如果客户端对同一 backend 很快重新打开了一个新 channel，而旧 channel 的关闭回执稍后才到，这个 stale close 会把**新的 channel 记录一起删掉**。
- **影响**:
  - facade runtime 会丢失当前仍有效的 outgoing channel 映射。
  - 后续 catalog subscribe、stream open、catch-up 都可能落到“不存在 channel”的状态。
- **建议**:
  - 关闭回执至少应校验 `channelId` 与当前 map 中保存的 channel 是否一致，再决定是否删除。
  - 最稳妥的方式是把 outgoing channel map 的 key 从 `backendId` 升级成 `(backendId, channelId/epoch)` 级别的状态对象。

#### 2. 本地 short-circuit catch-up 失败会被静默降级成空补丁（HIGH）
- **当前状态**: 已修复
- **文件**: [manager.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/manager.ts)
- **位置**: `createLocalBackendHandler().onCatchUp`
- **问题**:
  - 本地 facade short-circuit 的 catch-up 查询一旦抛错，当前实现只是 `console.error` 然后返回 `[]`。
  - 这和 remote gateway 路径已经具备的 `session_content_patch_error` / `content_patch_failed` 机制不一致。
- **影响**:
  - local / standalone 模式下，前端会把真正的同步失败误认为“没有新消息”。
  - Batch 3 已经补齐的 catch-up 明确错误反馈，在这条路径上又被绕回了静默失败。
- **建议**:
  - 本地 handler 不应吞错返回空数组；应沿 facade adapter/runtime 的错误事件通道显式上报。
  - 至少应让 `EmbeddedGatewayAdapter` / `StandaloneFacadeAdapter` 的 local catch-up 路径与 remote 路径使用同一套失败语义。

### 🟠 中优先级

#### 3. stale catalog 事件没有按 epoch/channel 做过滤（MEDIUM）
- **当前状态**: 已修复
- **文件**:
  - [gateway-client.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/gateway-client.ts)
- **位置**:
  - `handleOutgoingCatalogSnapshot()`
  - `handleOutgoingCatalogEvent()`
  - `handleOutgoingCatalogReset()`
- **问题**:
  - 当前收到 remote backend 的 catalog snapshot/event/reset 后，会直接转发给 facade runtime。
  - 这里没有把事件里的 `epoch` 与当前 outgoing channel/订阅状态做匹配校验。
- **影响**:
  - backend 重连或 channel 重新打开后，旧 epoch 的 snapshot/event 仍可能污染当前 catalog 状态。
  - 这类问题通常只在断线恢复、快速切换 backend 时出现，因此更难排查。
- **建议**:
  - 在 `GatewayClient` 或 runtime adapter 层引入 epoch 一致性过滤。
  - 至少只接受“当前 backend 当前 epoch”的 catalog 消息。

#### 4. GatewayManager 仍然夹带 domain 查询与 facade short-circuit 细节（MEDIUM）
- **当前状态**: 仍然成立，作为 Batch 5 剩余结构项保留
- **文件**: [manager.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/manager.ts)
- **问题**:
  - `GatewayManager` 不只负责连接生命周期，还直接内联了：
    - session catch-up SQL
    - local catalog SQL
    - virtual client 创建与 event fan-out
  - 这使它既像连接编排器，又像 gateway-domain service，又像 facade bridge。
- **影响**:
  - 生命周期问题、数据查询问题、local short-circuit 问题会耦合在同一文件里。
  - 未来如果要单独调整 facade local backend 规则，容易牵动 gateway manager 主路径。
- **建议**:
  - 把 `createLocalBackendHandler()` 进一步下沉为专门的 local facade bridge / service。
  - `GatewayManager` 自己只保留 connect/disconnect/provider 切换/virtual client cleanup。

### 🟢 低优先级

#### 5. `gateway-instance.ts` 仍是全局单例逃逸点（LOW）
- **当前状态**: 仍然成立，但不阻断 Batch 5 收尾
- **文件**: [gateway-instance.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/gateway-instance.ts)
- **问题**:
  - 这是一个全局可变单例，方便 routes / domain 直接拿 `GatewayClient`，但也弱化了依赖方向。
- **影响**:
  - routes 与 domain service 继续绕过显式依赖注入。
  - 测试和生命周期推理会更依赖全局状态重置。
- **建议**:
  - 短期保留，但新代码尽量优先经 `GatewayManager` 或更明确的 domain service 注入。

## Refactor Candidates

1. [gateway-client.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/gateway-client.ts) 已经同时承载 handshake、registry、catalog、channel、stream、HTTP proxy，属于典型聚合过重类；建议后续至少按 `connection/registry/channel+stream/proxy` 拆成内部组件。
2. [embedded-adapter.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/embedded-adapter.ts) 和 [standalone-adapter.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/standalone-adapter.ts) 在 local short-circuit 上有较多重复语义（local channel、local stream、local catch-up、server event 转发），后续可以抽共享 helper。
3. [embedded-provider.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/embedded-provider.ts) 和 [standalone-provider.ts](/Users/zhvala/SourceCode/my-claudia/server/src/domains/gateway/standalone-provider.ts) 只有 adapter 来源不同，provider 壳层重复度很高，后续可考虑统一 provider shell。

## Test Gaps

1. `GatewayManager` 当前测试主要覆盖 cleanup 与 disconnect，缺少 facade provider 切换、registry/identity sync 行为测试。
2. 仍缺少 adapter 级别的端到端断言，验证 local catch-up 失败最终确实落成 `content_patch_failed` 事件。

## 做得好的

1. `manager.ts` 已经把 gateway 连接模式切换和 facade provider 切换集中起来，比早期“到处直接拿 client”的方式可控得多。
2. `EmbeddedGatewayAdapter` / `StandaloneFacadeAdapter` 的 CQE 形态和 shared facade runtime 契约是对齐的。
3. 这一域现有测试已经覆盖 cleanup、adapter 基本行为、channel cleanup，说明它不是“完全没护栏”的状态。

## 建议下一步

1. 如果继续深挖 gateway domain，本批剩余最值得做的是把 `GatewayManager.createLocalBackendHandler()` 进一步下沉。
2. 如果按总计划继续推进，则下一批进入 **Batch 6: Server Domain — Conversation**。
