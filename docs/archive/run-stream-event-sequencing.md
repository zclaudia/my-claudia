# Run Stream Event Sequencing 设计稿

## 背景

当前前端的消息去重主要发生在消息对象层面：

- `addMessage()` 按 `message.id` / `clientMessageId` 去重
- `appendMessages()` 按 `message.id` 去重

这只能覆盖：

- 历史消息拉取
- `run_started` 时插入 assistant message
- session sync / gap fill 场景

但对运行中的流式事件无效。当前 `delta`、`tool_use`、`tool_result` 等事件在 websocket 收到后会直接驱动状态更新：

- `delta` 直接 append 到最后一条 assistant message
- `tool_use` 直接新增 tool call 和 content block
- `tool_result` 直接更新 tool call

一旦 transport 或 gateway 出现重复转发，前端会把同一批流式事件执行两遍。之前 remote backend 独立窗口消息重复就是这个问题的直接表现。

## 问题陈述

当前 run stream 协议缺少事件级 identity。

具体表现：

- `delta` 没有稳定的 chunk identity
- `tool_use` / `tool_result` 虽然带有 `toolUseId`，但前端并未统一按事件幂等处理
- `run_started` / `run_completed` 也没有统一的事件去重层

因此系统只能做到 message-level dedup，做不到 run-event-level dedup。

## 目标

引入一套稳定的 run stream event sequencing 机制，用于：

1. 对运行事件做幂等处理
2. 支持 gateway / 多播 / 重连场景下的重复投递防护
3. 为未来的断线恢复、缺片检测、乱序保护提供基础

## 非目标

本方案不覆盖：

- 历史消息表的数据库去重
- session sync 的分页和 gap fill 机制重写
- provider 内部事件协议标准化
- run stream 的断点续传实现

## 核心结论

### 1. 应该给 run stream 事件增加序号

推荐为每个 `runId` 增加单调递增的 `seq` 字段，而不是给每个事件发随机 UUID。

推荐格式：

```ts
{
  type: 'delta',
  runId: 'run-123',
  seq: 17,
  sessionId: 'session-1',
  content: 'hello'
}
```

选择 `seq` 而不是随机唯一 ID 的原因：

- 可去重：`runId + seq`
- 可排序：天然支持乱序保护
- 可检测缺片：可判断 seq 是否连续
- 可作为未来恢复协议的基础
- 开销低：每个 run 只维护一个递增计数器

随机 UUID 只能解决“是否重复”，不能解决“顺序”和“是否缺失”。

### 2. `seq` 必须在 run 事件源头生成

`seq` 应当在真正产生 run event 的 server 侧生成，而不是 gateway 或前端生成。

原因：

- gateway 可能只是转发者，不能重新编号
- 前端本身无法判断跨连接的重复是否来自同一条原始事件
- 只有事件源头最清楚该 run 的真实顺序

因此要求：

- local server 生成 `seq`
- remote backend server 生成 `seq`
- gateway 透传，不修改

### 3. 不是所有事件都需要同一种 dedup 逻辑

事件分两类：

#### A. 有天然 identity 的事件

包括：

- `run_started`
- `run_completed`
- `run_failed`
- `tool_use`
- `tool_result`
- `permission_request`
- `ask_user_question`

这些事件即使没有 `seq`，也可以先按业务 key 做幂等。

例如：

- `run_started` -> `runId`
- `tool_use` -> `runId + toolUseId`
- `tool_result` -> `runId + toolUseId`

#### B. 纯流式片段事件

包括：

- `delta`
- 未来可能的 `reasoning_delta`
- 未来可能的 `tool_activity_delta`

这些事件不适合基于内容做去重。因为模型完全可能合法地产生相同文本片段。

因此对于 `delta`，应该依赖：

- transport 源头防重
- `seq` 幂等和顺序控制

而不是前端按 `content` 猜测去重。

## 协议改造

### Shared 协议层

为所有 run-scoped server message 增加可选字段：

```ts
interface SequencedRunEvent {
  runId: string;
  seq: number;
}
```

第一阶段建议覆盖：

- `delta`
- `tool_use`
- `tool_result`
- `run_started`
- `run_completed`
- `run_failed`
- `mode_change`
- `system_info`

说明：

- `session_created` 是否带 `seq` 可选，建议也统一带上
- 非 run-scoped 消息如 `pong`、`backends_list` 无需引入

### Server 层

每个 `ActiveRun` 增加：

```ts
eventSeq: number;
```

初始化为 `0`。

新增统一辅助函数：

```ts
function nextRunSeq(activeRun: ActiveRun): number {
  activeRun.eventSeq += 1;
  return activeRun.eventSeq;
}
```

要求所有 run stream 发送点统一通过同一层封装发消息，而不是各处手工写 `seq`。

推荐模式：

```ts
sendRunEvent({
  type: 'delta',
  runId,
  seq: nextRunSeq(activeRun),
  ...
});
```

或者直接由 `sendRunEvent()` 内部注入 `seq`，避免调用方遗漏。

### Gateway 层

gateway 不生成、不改写 `seq`，只透传。

额外要求：

- 不要重新包装成新的 run 事件 identity
- 不要在 gateway 合并或重排 run event
- 如果后续有 gateway buffer/replay，也必须保留原始 `seq`

### Frontend 层

前端新增 run event 幂等缓存。

建议结构：

```ts
seenRunEvents: Record<string, {
  maxSeq: number;
  seenSparse?: Set<number>;
}>
```

Phase 1 可先简化为：

- 仅接受 `seq > maxSeq` 的事件
- `seq <= maxSeq` 直接丢弃

前提：

- 当前 transport 正常情况下顺序稳定
- 主要问题是“重复发送”，而不是乱序

如果未来需要支持乱序，再升级为：

- `expectedSeq`
- small replay window
- sparse seen set

## 前端幂等策略建议

### Phase 1

对有 `seq` 的 run 事件统一做一层前置过滤：

```ts
if (msg.runId && msg.seq != null && isSeenOrStale(msg.runId, msg.seq)) {
  return;
}
```

然后再走原来的业务逻辑。

### Phase 1 的额外业务幂等

即使引入了 `seq`，仍建议对以下状态做业务层幂等：

- `tool_use` 不重复向 `toolCallsHistory` push 同一 `toolUseId`
- `tool_result` 对已经 completed/error 的同一 `toolUseId` 更新应为幂等
- `run_started` 对已有 assistant message 的重复插入继续保持去重

原因：

- 可降低协议升级期间的新旧版本兼容风险
- 即使某些 provider 或中间层漏传 `seq`，仍有一定保护

## 为什么不直接只做业务 key 去重

只做业务 key 去重不足以覆盖 `delta`。

举例：

- 同一 run 连续输出两个内容完全一样的 delta
- 模型多次输出相同 token 片段

如果按 `content` 去重，会误删合法输出。

而 `seq` 可以区分：

- 同内容、不同事件
- 同事件、重复投递

## 兼容性策略

采用渐进升级：

### Phase 1

- shared 中给事件新增可选 `seq?: number`
- server 开始发送 `seq`
- frontend 优先使用 `seq` 去重
- 若旧 server 未发送 `seq`，前端保持旧逻辑

### Phase 2

- 将所有 run-scoped 事件都补齐 `seq`
- gateway 相关测试覆盖重复转发场景

### Phase 3

- 如有需要，再引入缺片检测和重放

## 测试策略

### Server

应新增：

1. 同一 run 连续发送多个事件时 `seq` 单调递增
2. 不同 run 的 `seq` 相互独立
3. `run_completed` / `run_failed` 仍能拿到最后一个有效 `seq`

### Frontend

应新增：

1. 同一 `runId + seq` 重复到达时只处理一次
2. 顺序到达的 `delta` 全部保留
3. `tool_use` 重复到达不会重复生成 tool history / content block
4. 没有 `seq` 的旧消息仍按旧逻辑兼容处理

### Gateway

应新增：

1. 重复 backend 绑定导致同一 run event 被转发两次时，前端最终只处理一次
2. gateway 透传前后 `seq` 不变

## 风险与权衡

### 风险 1：前端只用 `maxSeq` 会误丢乱序消息

Phase 1 的 `maxSeq` 策略假设消息按序到达。

这是可以接受的前提，因为当前主要问题是重复投递，不是乱序。若后续观察到乱序，再升级为窗口化去重。

### 风险 2：旧版本 server 不发 `seq`

需要前端做向后兼容，不得把 `seq` 设为强依赖。

### 风险 3：部分事件路径漏加 `seq`

必须统一 run event 发送封装，避免“多数事件有 `seq`，少数事件遗漏”的半升级状态。

## 推荐实施顺序

1. shared 增加 run event `seq?: number`
2. server 的 `ActiveRun` 增加 `eventSeq`
3. 统一 `sendRunEvent()` 自动注入 `seq`
4. frontend 增加 `runId + seq` 前置去重
5. chat store 补 `tool_use/tool_result` 业务幂等
6. 增加 gateway 重复转发回归测试

## 最终建议

短期内，transport 层仍应优先避免重复流源头；但从协议正确性角度，run stream 需要引入事件级 `seq`。

结论如下：

- message-level dedup 不足以保护流式运行事件
- `delta` 应使用 `seq`，不应按文本内容去重
- `seq` 应由 run 事件源头 server 生成，gateway 只透传
- frontend 需要补 run-event-level 幂等
- `tool_use/tool_result` 还应额外保留业务层幂等
