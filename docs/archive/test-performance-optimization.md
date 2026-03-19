# 单元测试性能优化方案

## Context

单元测试全量运行需要 ~20 分钟，严重影响开发效率。经分析，主要瓶颈在于：

1. Desktop 包默认用 jsdom 跑所有 147 个测试文件（包括不需要 DOM 的纯逻辑测试）
2. Server 包未配置多进程并行
3. 部分测试文件有不必要的真实延迟（setTimeout）
4. Gateway 测试每个 case 重启服务器

方案按 **影响/成本比** 从高到低排序，优先做最小改动、最大收益的优化。

## 测试现状

| 包 | 测试文件数 | 环境 | 并行配置 | 备注 |
|---|---|---|---|---|
| Desktop | 147 | jsdom (全部) | 无优化 (默认 pool) | 最大瓶颈 |
| Server | 108 | node | 无优化 (默认 pool) | |
| Gateway | 8 | node | 默认 | 每个 case 重启服务器 |
| E2E | 49 | node + 真实服务 | `fileParallelism: false` | 不在本次优化范围 |

### Desktop 已有但未启用的优化配置

| 配置文件 | 环境 | 并行 | 用途 |
|---|---|---|---|
| `vitest.unit.config.ts` | **node** | `singleFork: false` (多进程) | stores/utils/hooks/components 纯逻辑 |
| `vitest.ui.config.ts` | jsdom | `singleFork: true` (单进程) | .test.tsx 组件测试 |

默认 `pnpm test` 走的是 `vite.config.ts` 的 test 配置，**没有使用上述优化配置**。

---

## 优化 1: Desktop 默认 test 命令使用 unit/ui 分离配置

**影响: 极高 | 成本: 低**

### 问题

`pnpm test` 调用 `vitest run`，走 `vite.config.ts` 默认配置，所有 147 个文件都用 jsdom 环境、无并行优化。但项目已有 `vitest.unit.config.ts`（node 环境 + 多进程）和 `vitest.ui.config.ts`（jsdom + 单进程），只是默认命令没用。

### 改动

1. 修改 `apps/desktop/package.json` 的 `test` 脚本:
   ```json
   "test": "vitest run --config=vitest.unit.config.ts && vitest run --config=vitest.ui.config.ts"
   ```
2. 修复 `vitest.unit.config.ts` 的 include 与 UI 配置的重叠问题:
   - unit 配置的 `src/components/**/*.test.{ts,tsx}` 和 UI 配置的 `src/components/**/*.test.tsx` 有重叠
   - 将 unit 配置改为只包含 `src/components/**/*.test.ts`（非 tsx），避免组件测试被重复执行

### 预估收益

Desktop 测试时间减少 **40-60%**。node 环境比 jsdom 快约 10x，多进程并行进一步提速。

### 涉及文件

- `apps/desktop/package.json` — 改 test 脚本
- `apps/desktop/vitest.unit.config.ts` — 修复 include pattern 重叠

---

## 优化 2: Server 配置多进程并行

**影响: 高 | 成本: 低**

### 问题

`server/vitest.config.ts` 使用默认 pool 配置，109 个测试文件没有充分利用多核 CPU。

### 改动

在 `server/vitest.config.ts` 添加:

```ts
pool: 'forks',
poolOptions: {
  forks: {
    singleFork: false,
  },
},
```

### 预估收益

Server 测试时间减少 **20-40%**。

### 涉及文件

- `server/vitest.config.ts`

---

## 优化 3: workflow-engine 测试用 fake timers

**影响: 中 | 成本: 低**

### 问题

`server/src/services/__tests__/workflow-engine.test.ts` 有 52 个 `setTimeout` 调用（50-200ms），累计 5-10s 纯等待。

### 改动

- 添加 `vi.useFakeTimers()`
- 将 `await new Promise(r => setTimeout(r, N))` 替换为 `await vi.advanceTimersByTimeAsync(N)`
- `afterEach` 中 `vi.useRealTimers()` 恢复

### 预估收益

该文件节省 **~5s**。

### 涉及文件

- `server/src/services/__tests__/workflow-engine.test.ts`

---

## 优化 4: Gateway 测试服务器复用

**影响: 中 | 成本: 中**

### 问题

6 个 gateway 测试文件在 `beforeEach` 中启动真实 HTTP/WebSocket 服务器，每个 test case 都重启。

### 改动

- 将服务器创建从 `beforeEach` 移到 `beforeAll`
- 在 `beforeEach` 中只做状态重置（清理连接/订阅）
- `afterAll` 中关闭服务器

### 预估收益

每个文件节省 30-60% 时间。Gateway 总体量不大，绝对收益有限。

### 涉及文件

- `gateway/src/__tests__/server-backend.test.ts`
- `gateway/src/__tests__/server-client.test.ts`
- `gateway/src/__tests__/server-auth.test.ts`
- `gateway/src/__tests__/server-http.test.ts`
- `gateway/src/__tests__/server-errors.test.ts`
- `gateway/src/__tests__/broadcast-subscription.test.ts`

---

## 优化 5: 降低 Gateway waitForMessage 超时

**影响: 低 | 成本: 低**

### 问题

`waitForMessage` 默认 5s 超时，本地消息通常 <50ms 到达。超时只影响失败场景的等待时间。

### 改动

默认超时从 5000ms 降到 1000ms。

---

## 不做的事

| 方案 | 不做的原因 |
|---|---|
| 用 `test-parallel.mjs` 作为默认 test 命令 | 启动 18 个独立 Vitest 进程，每个都有启动开销，不如 Vitest 内置 fork pool 高效 |
| 加 Vitest workspace 模式 | 配置复杂度增加，收益有限（pnpm 已经并行跑各包） |
| 改 `pnpm -r` 的并行行为 | pnpm v9 默认已并行执行 workspace scripts |

---

## 验证方法

1. **优化前基线**: `time pnpm test` 记录总时间
2. **逐步验证**: 每个优化后重新 `time pnpm test` 对比
3. **测试数量不变**: `vitest run --reporter=verbose 2>&1 | tail -5` 确认总 test 数一致
4. **覆盖无遗漏**: 分别跑 unit/ui 两个配置，合并 test file 数 >= 原来的总数
