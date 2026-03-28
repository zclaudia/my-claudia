# Batch 10: Desktop — Stores & API Layer Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~5k 行 |
| 最大 Store | chatStore.ts (668 行) |
| Store 数量 | 16+ |
| API 文件 | 8+ |

## 发现

### 🔴 高优先级

#### ~~1. chatStore JSON.stringify 性能问题~~ → 🟢 LOW（校验修订）
- **文件**: `stores/chatStore.ts:250`
- **原始判定**: HIGH
- **校验结果**: 代码确实用 `JSON.stringify` 做深比较，但只在更新路径（已存在的消息 ID 匹配时）触发，单个消息对象通常几 KB，`JSON.stringify` 微秒级。不太可能成为实际瓶颈，除非每秒上千条消息更新。

#### 2. chatStore 消息缓存无限增长（HIGH）
- **文件**: `stores/chatStore.ts:42-79`
- **问题**: `messages` Record 无驱逐策略，长时间运行后累积 MB 级消息
- **修复**: 添加 per-session 最大消息数限制，backend 切换时清理

#### 3. Store 循环依赖（HIGH）
- **文件**: `stores/projectStore.ts:1-8`
- **问题**: projectStore → sessionsStore → chatStore → serverStore 依赖链，初始化顺序不当可能导致 getState() 返回不完整状态
- **修复**: 文档化初始化顺序或使用 lazy import

### 🟡 中高优先级

#### 4. draftEditorStore saveTimer 清理不完整（MED-HIGH）
- **文件**: `stores/draftEditorStore.ts:53`
- **问题**: HMR 和错误路径下 timer 可能泄漏
- **修复**: 用 try-finally 包裹所有 timer 操作

#### 5. backgroundTaskStore PID Monitor null check（MED-HIGH）
- **文件**: `stores/backgroundTaskStore.ts:132-163`
- **问题**: `pidMonitorInterval` 检查使用松散等式，`autoRemoveTimers` 可能累积
- **修复**: 使用 `!== null` 显式检查

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 6 | 消息去重竞态 | chatStore.ts:283-286 | 同 clientMessageId 不同 ID 可能重复 |
| 7 | 4 个空壳 Store（1 行 re-export） | localPRStore 等 | 应移除或合并 |
| 8 | gatewayStore migrate `any` 逃逸 | gatewayStore.ts:198 | 应用 `unknown` + 显式字段检查 |
| 9 | messageHandler getState() 闭包新鲜度 | messageHandler.ts | 循环中多次调用，状态可能在中途变化 |
| 10 | API base 只处理 401/403 | services/api/base.ts:118-127 | 500 等错误静默变为 JSON parse 错误 |
| 11 | runtimeMode 按 sessionId 而非 runId 删除 | chatStore.ts:377-378 | 多并发 run 时互相影响 |
| 12 | sessionsStore Map 不可序列化 | sessionsStore.ts:77-80 | 崩溃后状态丢失 |
| 13 | fileUpload 路由判断逻辑分散 | fileUpload.ts:49 | 应抽取统一 helper |
| 14 | draftEditorStore save 无重试 | draftEditorStore.ts:64-66 | 网络错误静默失败 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 15 | Provider 数据双源 | projectStore + providerMetaStore 冗余 |
| 16 | maxSeqByRun Map 无过期 | messageHandler.ts:71 |
| 17 | claudiaStore 直接访问 localStorage | 应统一用 Zustand persist |
| 18 | Session bucket key 复杂度 | 3 个函数处理 `__local__` 逻辑 |
| 19 | pluginStore merge 可能丢数据 | 自定义 merge 函数只合并部分字段 |

### ✅ 做得好的

1. **chatStore tool call 去重** — idempotency 检查设计好
2. **backgroundTaskStore HMR 和 unload 处理** — 资源清理完整
3. **sessionsStore 事件处理** — 去重 + 完成追踪
4. **messageHandler gap detection** — 消息间隙检测和恢复
5. **ownershipStore** — 简洁清晰，无多余复杂度

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 3 |
| MEDIUM-HIGH | 2 |
| MEDIUM | 9 |
| LOW | 5 |
| **总计** | **19** |

## 核心建议

1. **立即**: 优化 chatStore JSON.stringify 性能、添加消息缓存上限
2. **短期**: 清理空壳 store、统一 API 错误处理、修复 runtimeMode 键
3. **中期**: 解决 store 循环依赖、抽取路由判断 helper
