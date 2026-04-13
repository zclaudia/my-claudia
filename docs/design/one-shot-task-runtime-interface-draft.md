# OneShotTaskRuntime 接口草案

## Status

- Status: Draft → **Revised**（基于 Phase 0/1 已落地代码修订）
- Scope: interface draft + implementation mapping
- Related:
  - `docs/design/structured-result-protocol-outline.md`
  - `docs/design/structured-result-protocol-detailed-design.md`
  - `docs/design/structured-result-protocol-implementation-plan.md`

---

## 1. 目标

定义一套统一的 `OneShotTaskRuntime` 接口，用于承接：

- workflow step execution
- ai-review / risk analysis
- structured summary
- 未来其他"目标明确、一次性收敛结果"的任务型场景

该 runtime 的定位是：

- **执行载体仍然是 provider CLI**
- **结果出口统一为 `submit_structured_result`**
- **文本解析仅作为 fallback**

---

## 2. 已实现基础设施概况

以下模块已在 Phase 0/1 落地，本草案直接基于这些实现设计 runtime 层。

### 2.1 structured-result 模块（已实现）

| 模块 | 路径 | 说明 |
|------|------|------|
| `StructuredResultRegistry` | `structured-result/schema-registry.ts` | result type → schema + fallback 映射 |
| `validateStructuredResultSubmission()` | `structured-result/validator.ts` | JSON Schema 校验（object/string/number/boolean/array） |
| `applyFallbackPolicy()` | `structured-result/fallback.ts` | text_json_parse / mark_uncertain / fail 三策略 |
| `executeSubmitStructuredResult()` | `structured-result/finalization-tool.ts` | 校验 + 更新 RunContext + 返回 ToolResult |
| `createSubmitStructuredResultTool()` | `structured-result/finalization-tool.ts` | 生成 MCP tool definition |
| `aiReviewV1Entry` | `structured-result/builtins.ts` | ai_review_v1 schema + fallback parser |

### 2.2 cli-jobs adapter 模式（已实现）

| 模块 | 路径 | 说明 |
|------|------|------|
| `CliProviderAdapter` | `cli-jobs/types.ts` | adapter 接口：resolveBinary / buildArgs / prepare / extractAssistantText / cleanup |
| `runCliJob<T>()` | `cli-jobs/runner.ts` | 通用 runner：spawn → collect → extract → parse → cleanup |
| `adapters/claude.ts` 等 | `cli-jobs/adapters/*` | 5 个 provider adapter（claude/codex/cursor/kimi/opencode） |

### 2.3 当前消费路径（已实现但需收口）

```
delegation-evaluator.evaluateAIReview()
  → AIReviewProvider.runPrompt()        // 多轮交互，支持 read_file
  → normalizeAIReviewModelResponse()    // 文本解析
  → normalizeAIReviewDecision()         // 决策归一化

AIRiskAnalysisAdapter.evaluate()
  → evaluateAIReview()                  // 包装为 AIRiskAnalysisPort
  → AIRiskAnalysisStepExecutor          // workflow step 调用入口
```

**关键 gap**：当前路径**不经过** `submit_structured_result` 工具。结构化提交工具已定义但未接入执行流。

---

## 3. 设计原则

### 3.1 Runtime 是统一入口，不是 provider-specific wrapper

业务侧不应长期直接依赖 `review-job.ts`、`*-review.ts` 这类 provider/task 特化入口，而应统一调用：

- `OneShotTaskRuntime.run(request)`

### 3.2 Provider Bridge 包裹 Adapter，不取代 Adapter

**决策（原开放问题 4）**：Bridge 站在现有 `CliProviderAdapter` 之上。

```
OneShotTaskProviderBridge
  └─ 内部持有 CliProviderAdapter
  └─ 额外负责：MCP tool 注入、tool call 拦截、submit 工具注册
  └─ Adapter 继续负责：binary 解析、args 构建、prepare/cleanup
```

这样现有 5 个 adapter 可以直接复用，不需要重写。

### 3.3 Task Contract 显式声明结果协议

每个 task 必须显式声明：

- 结果类型（关联到 `StructuredResultRegistry` 中的 entry）
- 是否强制结构化提交
- fallback 策略
- 最大校验重试次数

### 3.4 One-shot 是 task-scoped session

one-shot task 是一个短生命周期的临时 session：

- 有上下文（cwd, prompt, systemPrompt）
- 有 tools（submit_structured_result + 可选白名单）
- 有 result contract
- 生命周期在任务完成后立即结束
- **不对外暴露 sessionId**（内部生成临时 ID 用于 trace，父级关联通过 `metadata.parentSessionId`）

---

## 4. 最小接口集合

```ts
export interface OneShotTaskRuntime {
  run<T = unknown>(request: OneShotTaskRequest<T>): Promise<OneShotTaskResult<T>>;
}

export interface OneShotTaskProviderBridge {
  readonly providerType: string;
  run(request: ProviderBridgeRequest): Promise<ProviderBridgeResult>;
}

export interface OneShotTaskContractRegistry {
  get<T = unknown>(taskType: string): OneShotTaskContract<T> | undefined;
  list(): string[];
}
```

---

## 5. 对外接口

### 5.1 `OneShotTaskRequest`

```ts
export interface OneShotTaskRequest<T = unknown> {
  taskType: string;
  providerType: string;
  prompt: string;
  cwd: string;

  systemPrompt?: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;

  // task-scoped context (不含 sessionId，内部生成)
  projectId?: string;
  metadata?: Record<string, unknown>;

  // optional explicit override; default comes from task contract
  contractOverride?: Partial<OneShotTaskContract<T>>;
}
```

说明：

- `taskType`：任务语义标识，例如 `ai_review`，关联到 `OneShotTaskContractRegistry`
- `providerType`：选择哪一个 provider bridge（映射到 `CliProviderAdapter.providerType`）
- `mode`：provider permission / agent mode 映射值
- `contractOverride`：允许调用方做局部覆盖（仅 `fallbackPolicy` 和 `maxValidationFailures`）

### 5.2 `OneShotTaskResult`

```ts
export interface OneShotTaskResult<T = unknown> {
  ok: boolean;

  result?: T;
  rawText?: string;

  usedFallback: boolean;
  stopReason:
    | 'structured_submit'    // submit_structured_result 校验通过
    | 'fallback'             // provider 未提交 final tool，fallback 成功
    | 'timeout'              // provider CLI 超时
    | 'provider_error'       // spawn/exit 错误
    | 'validation_exhausted' // 超过 maxValidationFailures
    | 'fallback_fail';       // fallback 也失败了

  telemetry: OneShotTaskTelemetry;
}
```

### 5.3 `OneShotTaskTelemetry`

```ts
export interface OneShotTaskTelemetry {
  taskType: string;
  providerType: string;
  resultType: string;

  durationMs: number;
  validationFailures: number;
  finalized: boolean;
  usedFallback: boolean;

  toolSubmissionAttempts: number;
  rawExitCode?: number | null;
}
```

---

## 6. Task Contract

### 6.1 `OneShotTaskContract`

```ts
export interface OneShotTaskContract<T = unknown> {
  taskType: string;

  /**
   * 关联到 StructuredResultRegistry 中的 entry。
   * Registry 持有 jsonSchema 和 fallbackPolicy，contract 引用而非重复定义。
   */
  resultType: string;

  requireStructuredSubmit: boolean;
  maxValidationFailures: number;

  /**
   * contract 级 fallback 覆盖。若为 undefined，使用 registry entry 中的 fallbackPolicy。
   * 这允许同一 resultType 在不同 taskType 下使用不同 fallback 策略。
   */
  fallbackPolicyOverride?: FallbackPolicy<T>;
}
```

**与 StructuredResultRegistry 的关系**：

```
OneShotTaskContract
  ├─ resultType ──引用──→ StructuredResultRegistry.get(resultType)
  │                         ├─ jsonSchema        (schema 校验用)
  │                         └─ fallbackPolicy    (默认 fallback)
  └─ fallbackPolicyOverride  (可选覆盖)
```

### 6.2 内置 TaskType 与已注册 ResultType 的映射

```ts
// 已注册的 result type（builtins.ts）
const AI_REVIEW_V1_RESULT_TYPE = 'ai_review_v1';
// schema: {decision: enum, reasoning: string, confidence: number}
// fallback: text_json_parse → parseFinalReviewFromText()

// 待注册的 contract
const aiReviewContract: OneShotTaskContract<AIReviewResult> = {
  taskType: 'ai_review',
  resultType: 'ai_review_v1',
  requireStructuredSubmit: false, // 第一阶段 fallback 兼容
  maxValidationFailures: 2,
};
```

---

## 7. Provider Bridge 接口

### 7.1 两种 Bridge 模式

当前 provider CLI 存在两种交互模式，Bridge 需要同时支持：

| 模式 | 特征 | 当前实现 | 适用 provider |
|------|------|----------|---------------|
| **Batch** | spawn → stdin → wait exit → parse stdout | `runCliJob()` | codex, cursor, kimi |
| **Interactive** | 多轮 prompt/response，支持 tool call | `analyzeLLMRisk()` | claude, opencode |

### 7.2 `ProviderBridgeRequest`

```ts
export interface ProviderBridgeRequest {
  prompt: string;
  cwd: string;

  systemPrompt?: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;

  /** submit_structured_result tool definition, bridge 需要注入到 provider */
  finalTool: ToolDefinition;

  /**
   * Runtime 提供的 tool call 处理回调。
   *
   * - Batch 模式下不使用（provider 不支持运行时 tool call）
   * - Interactive 模式下由 bridge 在收到 tool call 时调用
   */
  onToolCall?: (call: ToolCall) => Promise<ToolCallOutcome>;
}
```

### 7.3 `ProviderBridgeResult`

```ts
export interface ProviderBridgeResult {
  rawText: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs: number;
}
```

### 7.4 Tool Call 类型（复用已有定义）

```ts
// 复用 structured-result/types.ts 中的 ToolDefinition
export { ToolDefinition, ToolResult } from '../structured-result/types';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallOutcome {
  toolResult: ToolResult;
  finalized?: boolean;
}
```

---

## 8. Runtime 内部依赖与执行流程

### 8.1 依赖

```ts
export interface OneShotTaskRuntimeDeps {
  bridges: Map<string, OneShotTaskProviderBridge>;
  contractRegistry: OneShotTaskContractRegistry;
  structuredResultRegistry: StructuredResultRegistry;  // 已实现
}
```

### 8.2 执行流程

```
OneShotTaskRuntime.run(request)
│
├─ 1. contractRegistry.get(taskType) → contract
├─ 2. 应用 contractOverride（仅 fallbackPolicy / maxValidationFailures）
├─ 3. structuredResultRegistry.get(contract.resultType) → entry
├─ 4. createSubmitStructuredResultTool() → finalTool          [已实现]
├─ 5. 创建 StructuredResultRunContext                          [已实现]
├─ 6. bridges.get(providerType) → bridge
├─ 7. bridge.run({prompt, cwd, finalTool, onToolCall})
│     │
│     ├─ [Batch 模式]
│     │   spawn CLI → inject finalTool 到 prompt/schema → wait exit → rawText
│     │
│     └─ [Interactive 模式]
│         spawn CLI → tool call loop:
│           if submit_structured_result:
│             onToolCall() → executeSubmitStructuredResult()   [已实现]
│             if finalized: break
│             else: return validation error, continue
│           else:
│             onToolCall() → handle other tools (read_file etc.)
│
├─ 8. 检查 runContext.finalized
│     ├─ true  → stopReason = 'structured_submit', ok = true
│     └─ false → applyFallbackPolicy(entry.fallbackPolicy)    [已实现]
│                ├─ result → stopReason = 'fallback', ok = true
│                └─ error  → stopReason = 'fallback_fail', ok = false
│
└─ 9. 返回 OneShotTaskResult + telemetry
```

### 8.3 Batch 模式下的 submit_structured_result 注入

Batch 模式的 provider 不支持运行时 tool call 拦截。两种注入策略：

**策略 A：Schema 注入（推荐）**
- 将 `submit_structured_result` 的 inputSchema 转为 JSON Schema，注入到 provider CLI 的 `--output-schema` 参数
- Codex adapter 已支持 `--output-schema`；其他 adapter 通过 systemPrompt 附加 schema 约束
- 解析输出时先尝试匹配 `{result_type, payload}` 结构，匹配到即走 structured_submit 路径

**策略 B：Prompt 注入**
- 在 systemPrompt 中描述 submit 工具的格式要求
- 输出文本中提取 JSON 后按 resultType 校验
- 这本质上是当前 fallback 路径的变体

第一阶段建议 Batch 模式统一走策略 B + fallback，Interactive 模式走 onToolCall 主路径。

---

## 9. 与现有代码的映射

### 9.1 直接复用（不改动）

| 已实现模块 | 在 Runtime 中的角色 |
|------------|---------------------|
| `StructuredResultRegistry` | runtime deps.structuredResultRegistry |
| `executeSubmitStructuredResult()` | onToolCall 内部处理 submit tool |
| `applyFallbackPolicy()` | bridge 返回后 runtime 调用 |
| `createSubmitStructuredResultTool()` | 生成 finalTool 传给 bridge |
| `aiReviewV1Entry` | 第一个注册的 result type |

### 9.2 包裹复用（Bridge 内部调用）

| 已实现模块 | 在 Bridge 中的角色 |
|------------|---------------------|
| `CliProviderAdapter` | Bridge 内部持有，负责 binary/args/prepare/cleanup |
| `runCliJob()` | Batch 模式 bridge 内部的执行引擎 |
| `adapters/*` | 5 个 provider 的 adapter 实现 |
| `sanitizeInheritedProviderEnv()` | runner 内部已调用 |

### 9.3 迁移目标（长期替换）

| 现有入口 | 替换为 |
|----------|--------|
| `evaluateAIReview()` | `runtime.run({taskType: 'ai_review'})` |
| `AIRiskAnalysisAdapter` | 直接使用 runtime，不再单独包装 |
| `runAIReviewCliJob()` | bridge 内部调用 runCliJob |
| `*-review.ts` | 废弃，provider 差异由 adapter 处理 |

---

## 10. 第一版最小落地计划

### Phase 2a：Batch Bridge + ai_review contract

1. 新建 `server/src/application/oneshot/` 目录
2. 实现 `OneShotTaskContractRegistry`，注册 `ai_review` contract
3. 实现 `CliBatchBridge`：包裹 `CliProviderAdapter` + `runCliJob()`
   - 将 submit schema 注入 systemPrompt
   - 输出解析：先尝试 structured 匹配，再 fallback
4. 实现最小 `OneShotTaskRuntime`：contract → bridge → result
5. `delegation-evaluator` 新增分支：优先调用 runtime，失败时回退现有路径
6. 添加 telemetry 日志

### Phase 2b：Interactive Bridge + tool call loop

1. 实现 `CliInteractiveBridge`：基于现有 `analyzeLLMRisk()` 多轮交互模式
   - 注册 `submit_structured_result` 为可用 tool
   - 收到 submit tool call 时调用 `onToolCall()` → `executeSubmitStructuredResult()`
   - 校验失败时返回错误提示，继续对话
2. Claude / OpenCode adapter 接入 Interactive Bridge
3. `delegation-evaluator` 完全切换到 runtime

### Phase 2c：收口

1. 废弃 `review-job.ts` 和 `*-review.ts` 直接入口
2. `AIRiskAnalysisAdapter` 改为调用 `runtime.run()`
3. workflow step executor 直接使用 runtime

---

## 11. 已关闭的开放问题

| # | 问题 | 决策 |
|---|------|------|
| 1 | Runtime 是否暴露 streaming hook | **不暴露**。one-shot 只返回最终结果。如需进度通知，通过 `metadata.onProgress` 回调，不影响主接口 |
| 2 | contractOverride 允许范围 | **收紧**。只允许覆盖 `fallbackPolicy` 和 `maxValidationFailures`，不允许改 resultType |
| 3 | sessionId 是否对外暴露 | **不暴露**。runtime 内部生成临时 traceId，父级关联通过 `metadata.parentSessionId` |
| 4 | Bridge vs Adapter 关系 | **Bridge 包裹 Adapter**。Bridge 持有 `CliProviderAdapter`，额外负责 tool 注入和 call 拦截 |
| 5 | tools 白名单配置方式 | **按 taskType 静态配置**。contract 定义允许的 tools，runtime 在 bridge 层面 enforce |

## 12. 仍然开放的问题

1. **Batch 模式 structured 匹配置信度**：provider 未通过 tool call 提交，而是在 stdout 中输出了符合 `{result_type, payload}` 格式的 JSON，是否算 structured_submit？建议算 fallback，因为没有经过 tool call 协议。
2. **Rate limiting 放置层**：当前在 `evaluateAIReview()` 内部做全局限流。迁移到 runtime 后，限流应放在 runtime 层还是 contract 层？建议 runtime 层，通过 `metadata.rateLimitKey` 区分。
3. **Multi-turn file reading 能力**：Interactive Bridge 需要支持 `read_file` 等辅助 tool。这些 tool 是 bridge 内部注册，还是通过 contract.tools 白名单声明？建议 bridge 内部注册（provider-specific 能力），contract.tools 只控制业务级 tool。
