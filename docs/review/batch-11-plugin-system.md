# Batch 11: Server Infra — Plugin System Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~4.8k 行（12 文件） |
| 最大文件 | loader.ts (1394 行) |
| 关键模块 | loader, worker-host, worker-runner, permissions, skill-tools, mcp-bridge, provider-api, tool-registry, storage |

## 发现

### 🔴 高优先级

#### ~~1. Worker RPC 消息路由竞态~~ → ✅ 无问题（校验修订）
- **文件**: `worker-host.ts:102-117, 216-234`
- **原始判定**: HIGH
- **校验结果**: **误报**。两个 handler 按 `msg.type` demux（activation 只处理 `activated`/`activation_error`，RPC 只处理 `rpc_request`，有 early return）。activation handler 完成后自移除 (`worker.off`)。无重叠。

#### 2. Worker 崩溃时事件监听器累积（HIGH）
- **文件**: `worker-host.ts:515, 546, 580`
- **问题**: `forwardToolCall` 注册的 listener 在 worker crash 后不清理
- **修复**: 用 AbortController 管理 pending calls

#### 3. Tool/Command 调用永不 reject（HIGH）
- **文件**: `worker-host.ts:502-560`
- **问题**: Worker 崩溃时 tool 调用 promise 永远挂起，只有 timeout 兜底
- **修复**: 在 worker exit handler 中 reject 所有 pending promises

#### 4. Provider API Supervision 绕过（HIGH）
- **文件**: `provider-api.ts:145-149`
- **问题**: 插件调用 provider 时 supervision 硬编码为 auto-allow
- **修复**: 对接真实 supervision 链

#### ~~5. Loader 注册非事务性~~ → 🟢 LOW（校验修订）
- **文件**: `loader.ts:636-807`
- **原始判定**: HIGH
- **校验结果**: 过度标记。每项注册有独立 try/catch（失败跳过继续），且有 `unregisterContributions` 按 pluginId 清理。部分注册 > 完全失败对非关键子系统更合理。

#### ~~6. Skill 符号链接 TOCTOU~~ → 🟢 极低（校验修订）
- **文件**: `loader.ts:723-768`
- **原始判定**: HIGH
- **校验结果**: **误报**。第二次 `realpathSync`（line 756）是故意的 **TOCTOU 防御**（注释明确说明），不是制造 TOCTOU。每次读取都重新验证符号链接目标。

#### 7. loader.ts 1394 行违反 SRP（HIGH — 架构）
- **问题**: manifest 加载、验证、激活、context 创建、capability 协商、skill 注册全在一个文件
- **修复**: 拆分为 ManifestLoader + ActivationManager + ContextBuilder + CapabilityNegotiator

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 8 | Worker-runner RPC call ID 碰撞 | worker-runner.ts:72-79 | postMessage 失败时 pending entry 未清理 |
| 9 | 事件 handler reload 后残留 | worker-runner.ts:107-140 | deactivate 不清理 eventHandlers |
| 10 | Permission state 并发写入竞态 | permissions.ts:167-186 | 无锁的同步文件操作 |
| 11 | Permission store 解析失败清空数据 | permissions.ts:81-91 | JSON 解析失败时覆盖为 `{}` |
| 12 | grantAll O(n) 磁盘 I/O | permissions.ts:191-193 | 50 个权限 = 50 次写磁盘 |
| 13 | Skill 外部目录无验证 | skill-tools.ts:312-329 | 恶意配置可指向 `/`，DoS |
| 14 | MCP bridge buffer 解析错误累积 | mcp-bridge.ts:175-188 | 错误数据反复重试 |
| 15 | MCP bridge HTTP 请求无 timeout | mcp-bridge.ts:215-251 | server hang 时永久阻塞 |
| 16 | Tool 重注册静默覆盖 | tool-registry.ts:64-75 | 旧 handler 丢失 |
| 17 | Storage size 检查顺序错误 | storage.ts:98-110 | set 后检查，应先检查 |
| 18 | Storage 并发访问无保护 | storage.ts:50-127 | 两个 set() 可能互相覆盖 |
| 19 | Scheduler timer unregister 前未启动 | scheduler.ts:85-95 | `clearInterval(null)` 无效 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 20 | Skill content cache 无文件变更检测 | loader.ts:754-766，mtime 精度不够 |
| 21 | 插件 API 版本不检查 | loader.ts:409-416 |
| 22 | 依赖无拓扑排序 | loader.ts:368-374 |
| 23 | Worker command handler 缺 context 参数 | worker-runner.ts:335 |
| 24 | ESM cache busting 用 query string | loader.ts:949，非 spec 保证 |
| 25 | Binary cache 无失效机制 | skill-selector.ts:15-27 |
| 26 | Manifest 验证不够严格 | loader.ts:277-308 |

### ✅ 做得好的

1. **Worker 沙箱隔离设计合理** — separate process + RPC 通信
2. **Tool registry 接口清晰** — scope + handler + metadata
3. **MCP bridge 协议支持完整** — stdio + HTTP 两种传输
4. **Skill discovery 机制完善** — 内置 + 外部 + workspace 三层

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 7 |
| MEDIUM | 12 |
| LOW | 7 |
| **总计** | **26** |

## 核心建议

1. **立即**: 修复 RPC 路由竞态、supervision 绕过、TOCTOU 漏洞
2. **短期**: 拆分 loader.ts、添加 HTTP timeout、修复并发问题
3. **中期**: 实现插件生命周期状态机、添加 observability hooks
