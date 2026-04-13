# Structured Result Protocol Implementation Plan

## Status

- Status: Draft
- Scope: implementation planning
- Related:
  - `docs/design/structured-result-protocol-outline.md`
  - `docs/design/structured-result-protocol-detailed-design.md`

---

## 1. 自审结论

详细设计已经足够进入实施规划，但在真正开始改代码前，还需要把下面几个点转成明确实施任务。

### 1.1 已确认可以推进的部分

- `cli-jobs` 通用化可以独立落地
- `structured-result` 基础设施不应再被视为“未来主路径预留”，而是当前 one-shot task 的结果协议基础
- `ai-review` 等现有消费者可以保留文本 fallback，但主线设计应围绕 `submit_structured_result`
- 长期统一入口应是 `OneShotTaskRuntime`，而不是继续扩展 `review-job.ts`

### 1.2 仍需在实施时明确的点

#### A. Phase 0 的 adapter 生命周期

详细设计中 `CliProviderAdapter.prepare/cleanup` 仍是较宽泛接口。实施时需要明确：

- `prepare()` 是否允许返回上下文对象
- `cleanup()` 如何拿到 `prepare()` 生成的资源句柄
- timeout / parse error / spawn error 时是否保证 cleanup 执行

#### B. Runner 的错误模型

详细设计里只说了“错误包装”，但没有把错误类型定死。实施时应至少区分：

- spawn error
- timeout error
- extraction error
- parse error

否则 Phase 0 结束后仍然无法稳定复用错误处理。

#### C. Parser 的放置边界

Phase 0 应只收敛已有 parser，不扩展新业务 parser。

需要防止 implementation 过程中把“structured-result 协议”错误提前塞进 `cli-jobs` 主路径。

#### D. `structured-result` 模块与现有类型复用

Phase 1 需要决定：

- `ToolDefinition` 等类型是否先自定义最小版本
- 或直接复用 PCP / interaction tool 体系中的类型

建议在 Phase 1 里先用最小本地类型，避免过早耦合到更大的协议层。

#### E. one-shot runtime 与现有 provider runtime 的复用边界

根据最新设计定位，CLI one-shot 模式与 provider 会话模式只是运行场景不同，基本能力应尽可能对齐。实施时需要明确：

- 哪些 MCP/tool 注入逻辑可以直接复用
- 哪些 skill / plugin / context 装配逻辑可以直接复用
- 哪些能力需要因 one-shot 场景做裁剪，而不是重新实现

需要防止 implementation 过程中在 `cli-jobs`/one-shot runtime 里长出一套平行的 provider 能力体系。

---

## 2. Implementation Strategy

实施按三个 phase 推进：

1. **Phase 0**
   目标：`cli-jobs` 通用化，行为不变
2. **Phase 1**
   目标：structured-result 基础设施落地，并作为 one-shot task 主结果协议
3. **Phase 2**
   目标：落地 `OneShotTaskRuntime`，把 CLI adaptor 的 MCP/tool 注入与 `submit_structured_result` 接进统一入口

推荐实际执行顺序：

1. 完成 Phase 0
2. 立即完成 Phase 1
3. 单独评审 provider CLI 注入方案后再进入 Phase 2

原因：

- Phase 0 有立刻收益，且低风险
- Phase 1 可为统一结果协议打底
- Phase 2 依赖 provider CLI 的 MCP/tool 注入收口，应单独控制风险

---

## 3. Phase 0 Plan: CLI Jobs Generalization

## 3.1 Goals

- 抽离 5 个 provider review runner 的公共样板代码
- 保持 `runAIReviewCliJob()` 对调用方 API 不变
- 保持现有测试通过、行为不变

## 3.2 Scope

涉及目录：

- `server/src/infrastructure/providers/cli-jobs/`

涉及文件：

- `types.ts`
- `review-job.ts`
- `claude-review.ts`
- `codex-review.ts`
- `kimi-review.ts`
- `cursor-review.ts`
- `opencode-review.ts`
- `review-parser.ts`
- `json-extract.ts`
- 相关测试

## 3.3 Deliverables

### Deliverable A: 新增 runner

新增：

- `server/src/infrastructure/providers/cli-jobs/runner.ts`

职责：

- spawn CLI
- timeout 管理
- stdout/stderr 缓冲
- duration 统计
- cleanup 调用

### Deliverable B: 新增 adapters 目录

新增：

- `server/src/infrastructure/providers/cli-jobs/adapters/claude.ts`
- `server/src/infrastructure/providers/cli-jobs/adapters/codex.ts`
- `server/src/infrastructure/providers/cli-jobs/adapters/kimi.ts`
- `server/src/infrastructure/providers/cli-jobs/adapters/cursor.ts`
- `server/src/infrastructure/providers/cli-jobs/adapters/opencode.ts`

### Deliverable C: review-job.ts 改为 registry 风格

保留入口：

```ts
runAIReviewCliJob(providerType, input)
```

内部改为：

1. 查 adapter
2. 调 `runCliJob`
3. 调 `parseFinalReviewFromText`

### Deliverable D: review-specific runner 文件收缩

目标不是继续保留 `*-review.ts` 五个执行文件，而是让 provider 差异完全进入 adapter。

建议：

- 删除或极度瘦身现有五个 `*-review.ts`
- 将 provider dispatch 只保留在 `review-job.ts`

## 3.4 Detailed Task Breakdown

### Task 0.1: 固定 Runner 接口

在实现前先确认最终接口：

```ts
export interface CliAdapterPreparedContext {
  [key: string]: unknown;
}

export interface CliProviderAdapter {
  providerType: string;
  resolveBinary(input: CliJobInput): string;
  buildArgs(input: CliJobInput, ctx?: CliAdapterPreparedContext): string[];
  prepare?(input: CliJobInput): Promise<CliAdapterPreparedContext | undefined> | CliAdapterPreparedContext | undefined;
  extractAssistantText(raw: CliJobRawResult, ctx?: CliAdapterPreparedContext): string;
  cleanup?(ctx?: CliAdapterPreparedContext): Promise<void> | void;
}
```

说明：

- `prepare()` 返回上下文对象，供 `buildArgs` / `extractAssistantText` / `cleanup` 复用
- 这样 Codex 的临时目录、schema file、output file 都能挂在 ctx 上

### Task 0.2: 固定 RawResult 与错误类型

建议新增：

```ts
export interface CliJobRawResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export class CliJobSpawnError extends Error {}
export class CliJobTimeoutError extends Error {}
export class CliJobExtractionError extends Error {}
export class CliJobParseError extends Error {}
```

注意：

- Phase 0 不需要引入过度复杂的 error taxonomy
- 但必须至少把 timeout 和 parse error 分开

### Task 0.3: 实现 runner.ts

Runner 行为要求：

1. 调用 `prepare()`
2. 调用 `resolveBinary()`
3. 调用 `buildArgs()`
4. spawn 进程
5. 采集 stdout/stderr
6. timeout 时 kill 进程
7. 构造 `CliJobRawResult`
8. 调用 `extractAssistantText()`
9. 调用业务 parser
10. 无论成功/失败都执行 `cleanup()`

必须覆盖的错误路径：

- `prepare()` 抛错
- spawn 抛错
- timeout
- `extractAssistantText()` 抛错
- parser 抛错

### Task 0.4: 实现各 provider adapter

#### Claude adapter

职责：

- CLI binary 解析
- 参数拼接
- 从 stdout JSON 取 `.result`

#### Codex adapter

职责：

- `prepare()` 创建临时目录
- 写 schema file / output file 路径到 ctx
- `buildArgs()` 读取 ctx 拼参数
- `extractAssistantText()` 优先读 output file，失败再 fallback stdout/stderr
- `cleanup()` 删除临时目录

#### Kimi / Cursor / OpenCode adapter

职责：

- 保留当前各自的 stdout 解析逻辑
- 收敛为 `extractAssistantText(raw)`

### Task 0.5: review-job.ts 改为 adapter registry

建议结构：

```ts
const REVIEW_ADAPTERS: Record<string, CliProviderAdapter> = { ... };
```

`supportsAIReviewCliJob()`：

- 改为基于 registry 判断

`runAIReviewCliJob()`：

- 从 registry 取 adapter
- 调 `runCliJob(adapter, input, parser)`

### Task 0.6: 测试迁移

保留并更新现有测试：

- `review-job.test.ts`
- `claude-review.test.ts`
- `codex-review.test.ts`
- `kimi-review.test.ts`
- `cursor-review.test.ts`
- `opencode-review.test.ts`

建议调整为：

- adapter 单测：验证 provider-specific 提取逻辑
- runner 单测：验证 timeout / cleanup / raw result
- review-job 单测：验证 registry dispatch

## 3.5 Acceptance Criteria

- 现有 `runAIReviewCliJob()` 调用方式不变
- 所有现有 cli-job 测试通过
- provider-specific review runner 逻辑被收敛到 adapter
- cleanup 在异常路径下也能稳定执行

## 3.6 Out of Scope

- 不引入 `submit_structured_result`
- 不修改 `delegation-evaluator` 主路径
- 不改变 AI review 的产品行为

### Phase 0 定位说明

Phase 0 的产出是：

- 收口 provider-specific 的 CLI 执行样板代码
- 为后续 `OneShotTaskRuntime` 提供可复用的 runner / adapter / parser 经验

Phase 0 的产物不是最终对外架构中心。`runAIReviewCliJob()` 可以继续保留兼容，但不应成为长期统一入口。

---

## 4. Phase 1 Plan: Structured Result Foundation

## 4.1 Goals

- 落地 `structured-result/` 模块
- 注册第一个 `ai_review_v1`
- 保持仅作为基础设施，不接入现有主路径

## 4.2 Deliverables

新增目录：

- `server/src/application/structured-result/`

新增文件：

- `types.ts`
- `schema-registry.ts`
- `validator.ts`
- `finalization-tool.ts`
- `fallback.ts`

## 4.3 Detailed Task Breakdown

### Task 1.1: 定义最小本地类型

先不复用 PCP 类型，避免提前耦合。

### Task 1.2: 实现 registry

要求：

- 支持注册
- 支持重复注册报错
- 支持查询

### Task 1.3: 实现 validator

要求：

- 能返回稳定错误码
- 能输出模型可理解的错误信息

### Task 1.4: 定义 `ai_review_v1`

要求：

- schema 与当前 `AIReviewResult` 对齐
- fallback policy 指向现有 parser

### Task 1.5: 定义 finalization tool 的静态结构

即使 Phase 1 不接主路径，也要把：

- tool schema
- run context
- executor contract

先以独立单测方式落地。

## 4.4 Acceptance Criteria

- `ai_review_v1` 可注册、可校验
- validator 错误消息稳定
- fallback policy 可独立调用
- 与现有主路径无耦合变更

### Phase 1 定位说明

Phase 1 交付的是 one-shot task 的结果协议基础，而不是独立悬空的工具模块。进入 Phase 2 后，这些模块应直接被 `OneShotTaskRuntime` 使用。

---

## 5. Phase 2 Plan: OneShotTaskRuntime Integration

## 5.1 Preconditions

进入 Phase 2 前必须满足：

- Phase 0 完成
- Phase 1 完成
- 至少有一个 provider CLI adaptor 能可靠完成 MCP/tool 注入与 result roundtrip

## 5.2 Goals

- 落地 `OneShotTaskRuntime`
- 将 CLI adaptor 的 MCP/tool 注入收口到统一 runtime
- 将 `delegation-evaluator` / workflow 等消费者切到 structured result 主路径
- 保留 fallback 作为兼容路径

## 5.3 Detailed Task Breakdown

### Task 2.1: 选定首个 provider CLI 注入路径

在真正实现前先确认：

- 哪个 provider 最适合作为首个 one-shot task provider
- 它的 CLI 如何注入 MCP/tool，并接收 tool result roundtrip

### Task 2.2: 实现 provider CLI bridge

为首个 provider 实现：

- tool injection
- tool call 捕获
- tool result 回传
- finalization 后短路结束

### Task 2.3: 新增统一 runtime

建议新增：

- `server/src/application/one-shot-task/types.ts`
- `server/src/application/one-shot-task/contracts.ts`
- `server/src/application/one-shot-task/runtime.ts`
- `server/src/application/one-shot-task/provider-bridge.ts`

职责：

- 定义 `OneShotTaskRequest / Contract / Result`
- 统一调度 provider adapter
- 注入 `submit_structured_result`
- 接收 structured result 或 fallback 结果
- 统一输出 telemetry

### Task 2.4: 改造 delegation-evaluator

目标：

- 主路径通过 `OneShotTaskRuntime` 执行
- 结果使用 `submit_structured_result`
- 保留现有 `read_file` 交互
- 不再依赖文本 JSON 解析作为主流程

### Task 2.5: 追加 session control

需要显式实现：

- `maxValidationFailures`
- finalization 后终止
- 超限 fallback

## 5.4 Acceptance Criteria

- AI review 主路径可通过 final tool 提交结果
- validation failure 支持有限次自修复
- 未提交 final tool 时能 fallback
- 用户行为与当前产品保持兼容
- workflow 等后续任务可复用同一入口

---

## 6. Execution Order Recommendation

建议按下面顺序排任务：

1. `runner.ts` + adapter 生命周期接口定稿
2. Phase 0 实现
3. Phase 0 测试迁移
4. `structured-result/` 基础设施
5. `ai_review_v1`
6. finalization tool 独立单测
7. 新增 `OneShotTaskRuntime`
8. 将 AI review 切到 runtime
9. 再让 workflow 等后续消费者复用同一入口

---

## 7. Immediate Next Action

最合理的下一步是直接进入 **Phase 0** 的代码实施，因为：

- 风险最低
- 收益立即可见
- 不依赖 provider runtime 升级
- 不会改变产品行为

推荐从下面两个文件开始：

1. `server/src/infrastructure/providers/cli-jobs/runner.ts`
2. `server/src/infrastructure/providers/cli-jobs/adapters/codex.ts`

原因：

- `runner.ts` 决定整体骨架
- `codex` 是资源生命周期最复杂的 provider，先拿它验证接口是否足够
