# Batch 6: Server Domain — Conversation Engine Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~4k 行 |
| 最复杂文件 | run-handler.ts (1477 行) |
| 关键模块 | ws/run/, context/, interactions/, agent-tools/, memory/, agent/ |

## 发现

### 🔴 高优先级

#### ~~1. Permission 请求双重解决竞态~~ → 🟢 信息级（校验修订）
- **文件**: `ws/run-handler.ts:657-687`
- **原始判定**: HIGH
- **校验结果**: 有 `pendingPermissions.has()` guard。即使 timeout 和 user response 同时触发，JS Promise.resolve() 重复调用无害（只有第一次生效）。实际无 bug。

#### 2. Stream 提前退出时未清理 Generator（HIGH）
- **文件**: `ws/run-handler.ts:997-1410`
- **问题**: `for await` 循环 break 时，底层 async generator 未显式关闭，可能导致 provider session 悬挂
- **修复**: 在 finally block 中调用 `providerRunner.return()`

#### 3. Timeout Handler 中未处理的 Promise Rejection（HIGH）
- **文件**: `ws/run-handler.ts:657-732`
- **问题**: AI review 失败时，permission request 永远不会 resolve，client UI 永久挂起
- **修复**: catch 块中必须调用 resolve (deny)

#### 4. selfPost 无超时机制（HIGH）
- **文件**: `interactions/interaction-tools.ts:26-46`
- **问题**: HTTP 请求无 timeout，server hang 时 promise 永远不 resolve
- **修复**: 添加 30s timeout

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | `(event as any).seq` 不安全 | run-handler.ts:280 | 应创建 typed wrapper |
| 6 | selfPost HTTP 错误处理不足 | interaction-tools.ts:26-46 | 连接拒绝/ECONNRESET 未处理 |
| 7 | abort 调用缺 nullability guard | run-lifecycle.ts:108-112 | 部分 adapter 需要 cwd 非 null |
| 8 | 并发 session cwd 更新竞态 | run-handler.ts:294-327 | 多 run 并发时 DB 写入无同步 |
| 9 | AI review 拒绝后无 user timeout | run-handler.ts:688-703 | AI 否决后 permission 永久挂起等待用户 |
| 10 | Task notification timer 未清理 | run-handler.ts:1384-1405 | run 结束后 stale timer 仍会触发 |

### 🟢 低优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 11 | agent skills TODO | run-handler.ts:913 | schema 待更新 |
| 12 | delegation-evaluator JSON 解析脆弱 | delegation-evaluator.ts:158-163 | regex 匹配 LLM 输出不稳定 |
| 13 | broadcast 失败未处理 | run-handler.ts:276-285 | WS 关闭时仍广播 |
| 14 | 命令预览日志未转义 | run-handler.ts:515 | 潜在 log injection |
| 15 | 多处 `as any` 类型逃逸 | run-handler.ts:407,515,947 | 应定义具体接口 |
| 16 | 硬编码的工具升级列表 | ws/types.ts:82 | `escalateAlways` 应可配置 |
| 17 | network-guard IPv4 解析脆弱 | agent-tools/network-guard.ts:20-21 | 畸形 IP 可能绕过 |

### ✅ 做得好的

1. **Context engine 扩展性好** — 可插拔的 context provider 模式
2. **Interaction 处理链完整** — normalizer → dispatcher → tools 三层架构
3. **Memory store 设计合理** — activity log + memory 分离
4. **Permission 评估器完备** — 支持 auto-approve、AI review、category-based 策略

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 7 |
| **总计** | **17** |

## 核心建议

1. **立即修复**: permission 双重解决、stream 清理、timeout handler 异常处理
2. **短期**: 添加并发控制（session cwd lock）、AI review 后重置 user timeout
3. **长期**: 考虑将 run-handler.ts 拆分为 state machine + stream processor + event emitter
