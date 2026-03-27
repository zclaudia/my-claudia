# TODO: BackendFacade Phase 6 — 性能与可靠性

## 背景

BackendFacade Phase 1~5 已完成。Phase 6 是性能优化，需要在真实负载下观察到瓶颈后再执行。

## 待办项

### 1. Snapshot diffing

**问题**：大量 backend 时全量 snapshot 序列化开销大。
**触发条件**：backend 数量 >20 时 snapshot 序列化耗时明显。
**方案**：增量 diff + patch 替代全量 JSON。
**相关文件**：`shared/src/facade/snapshot.ts`, `server/src/facade/ws-hub.ts`

### 2. Event batching

**问题**：高频事件（content_patch、run_event）的微批处理。
**触发条件**：高并发 run 时 WS 消息频率过高导致 UI 卡顿。
**方案**：在 FacadeWsHub 或 EmbeddedFacadeClient 中做微批聚合（16ms 窗口）。
**相关文件**：`server/src/facade/ws-hub.ts`, `apps/desktop/src/facade/embedded-facade-client.ts`

### 3. Facade WS 背压

**问题**：慢消费者检测与断开策略需要调参。
**触发条件**：WS 客户端积压消息导致 server 内存增长。
**方案**：FacadeWsHub 已有断开逻辑（`ws.readyState !== OPEN`），需要加缓冲区水位检测。
**相关文件**：`server/src/facade/ws-hub.ts`

### 4. GC 调参

**问题**：stream TTL 常量基于经验值，需要真实使用数据验证。
**触发条件**：观察到 stream 泄漏（内存增长）或过早清理（用户回来时 stream 已消失）。
**当前值**：
- `EPHEMERAL_TTL = 2min`
- `CLOSED_TOMBSTONE_TTL = 10min`
- `ERROR_TOMBSTONE_TTL = 30min`
- `GC_INTERVAL = 1min`
**相关文件**：`shared/src/facade/constants.ts`

## 执行原则

- 不要预优化 — 等观察到真实问题再做
- 每个优化项独立执行，不要打包
- 优化前先用真实场景建立 baseline 数据
