# OneShotTaskRuntime 接口草案

## Status

- Status: Draft
- Scope: interface draft
- Related:
  - `docs/design/structured-result-protocol-outline.md`
  - `docs/design/structured-result-protocol-detailed-design.md`
  - `docs/design/structured-result-protocol-implementation-plan.md`

---

## 1. 目标

定义一套统一的 `OneShotTaskRuntime` 接口，用于承接：

- workflow
- ai-review
- risk analysis
- structured summary

等“目标明确、一次性收敛结果”的任务型场景。

该 runtime 的定位是：

- **执行载体仍然是 provider CLI**
- **结果出口统一为 `submit_structured_result`**
- **文本解析仅作为 fallback**

---

## 2. 设计原则

### 2.1 Runtime 是统一入口，不是 provider-specific wrapper

业务侧不应长期直接依赖 `review-job.ts`、`*-review.ts` 这类 provider/task 特化入口，而应统一调用：

- `OneShotTaskRuntime.run(request)`

### 2.2 Provider Bridge 负责注入，不负责业务解释

provider bridge 的职责是：

- 组装 provider-specific 运行上下文
- 注入 MCP/tools/skills
- 启动 CLI
- 转发 tool call / tool result
- 收集原始输出

业务结果解释、schema 校验、fallback 决策由 runtime 负责。

### 2.3 Task Contract 显式声明结果协议

每个 task 必须显式声明：

- 结果类型
- 允许的 tools
- 是否强制结构化提交
- fallback 策略

### 2.4 One-shot 是 task-scoped session

one-shot task 可以理解为一个短生命周期的、面向单次任务收敛的临时 session：

- 有上下文
- 有 tools
- 有 result contract
- 生命周期在任务完成后立即结束

---

## 3. 最小接口集合

建议最小接口集合如下：

```ts
export interface OneShotTaskRuntime {
  run<T = unknown>(request: OneShotTaskRequest<T>): Promise<OneShotTaskResult<T>>;
}

export interface OneShotTaskProviderBridge {
  readonly providerType: string;
  run<T = unknown>(request: ProviderBridgeRequest<T>): Promise<ProviderBridgeResult>;
}

export interface OneShotTaskContractRegistry {
  get<T = unknown>(taskType: string): OneShotTaskContract<T> | undefined;
}
```

---

## 4. 对外接口

### 4.1 `OneShotTaskRequest`

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

  // task-scoped context
  sessionId?: string;
  claudiaSessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;

  // optional explicit override; default comes from task contract
  contractOverride?: Partial<OneShotTaskContract<T>>;
}
```

说明：

- `taskType`：任务语义标识，例如 `ai_review`
- `providerType`：选择哪一个 provider bridge
- `prompt` / `systemPrompt`：任务输入
- `mode`：provider permission / agent mode 映射值
- `contractOverride`：允许调用方做局部覆盖，但不鼓励业务侧直接拼完整 contract

### 4.2 `OneShotTaskResult`

```ts
export interface OneShotTaskResult<T = unknown> {
  ok: boolean;

  result?: T;
  rawText?: string;

  usedFallback: boolean;
  stopReason:
    | 'structured_submit'
    | 'fallback'
    | 'timeout'
    | 'provider_error'
    | 'validation_exhausted';

  telemetry: OneShotTaskTelemetry;
}
```

说明：

- `ok=true` 表示拿到了业务可接受结果
- `rawText` 用于 fallback 诊断，不作为主消费面
- `stopReason` 用于区分成功路径和失败模式

### 4.3 `OneShotTaskTelemetry`

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

## 5. Task Contract

### 5.1 `OneShotTaskContract`

```ts
export interface OneShotTaskContract<T = unknown> {
  taskType: string;
  resultType: string;

  tools?: OneShotToolSpec[];
  requireStructuredSubmit: boolean;

  fallbackPolicy: FallbackPolicy<T>;
  maxValidationFailures: number;
}
```

### 5.2 `OneShotToolSpec`

```ts
export interface OneShotToolSpec {
  name: string;
  required?: boolean;
}
```

说明：

- `tools` 表示任务允许暴露的 bridge tools 白名单
- `requireStructuredSubmit=true` 时，`submit_structured_result` 是强制终态
- `fallbackPolicy` 负责 provider 未提交 final tool 时的处理

### 5.3 `TaskType` 示例

```ts
type BuiltInTaskType =
  | 'ai_review'
  | 'risk_analysis'
  | 'workflow_review'
  | 'structured_summary';
```

---

## 6. Provider Bridge 接口

### 6.1 `ProviderBridgeRequest`

```ts
export interface ProviderBridgeRequest<T = unknown> {
  prompt: string;
  cwd: string;

  systemPrompt?: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;

  sessionId?: string;
  claudiaSessionId?: string;

  contract: OneShotTaskContract<T>;
  finalTool: ToolDefinition;

  onToolCall: (call: ToolCall) => Promise<ToolCallOutcome>;
}
```

### 6.2 `ProviderBridgeResult`

```ts
export interface ProviderBridgeResult {
  rawText: string;
  exitCode?: number | null;
  timedOut?: boolean;
  stopReason?: string;
}
```

### 6.3 `ToolCall` / `ToolCallOutcome`

```ts
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  isError: boolean;
  content: string;
}

export interface ToolCallOutcome {
  toolResult: ToolResult;
  finalized?: boolean;
}
```

说明：

- `ProviderBridge` 只关心工具往返，不关心业务 schema
- runtime 内部用 `executeSubmitStructuredResult()` 处理 final tool
- `finalized=true` 时，bridge 应尽快结束本次运行

---

## 7. Runtime 内部依赖

`OneShotTaskRuntime` 建议显式依赖这些模块：

```ts
export interface OneShotTaskRuntimeDeps {
  bridges: Map<string, OneShotTaskProviderBridge>;
  contractRegistry: OneShotTaskContractRegistry;
  structuredResultRegistry: StructuredResultRegistry;
}
```

运行流程建议：

1. 根据 `taskType` 取 contract
2. 应用 `contractOverride`
3. 构造 `submit_structured_result`
4. 创建 task-scoped run context
5. 选择 provider bridge
6. 调用 bridge.run(...)
7. 若结构化提交成功，返回 `structured_submit`
8. 否则按 fallbackPolicy 处理

---

## 8. 与现有代码的映射建议

### 8.1 可直接复用

- `ProviderAdapter` / `RunOptions`
- `buildMcpBridgeEntry()`
- `toolRegistry.getBridgeTools()`
- `sanitizeInheritedProviderEnv()`
- `createTraceRecorder()`
- `structured-result/*`

### 8.2 适合作为过渡层复用

- `cli-jobs/runner.ts`
- `cli-jobs/adapters/*`
- `cli-jobs/review-parser.ts`

### 8.3 不建议继续作为长期入口

- `review-job.ts`
- `runAIReviewCliJob(...)`
- `*-review.ts` provider/task 特化入口

---

## 9. 第一版最小落地建议

第一版建议只覆盖 `ai_review`：

1. 定义 `OneShotTaskRuntime` 接口和最小实现
2. 注册 `ai_review` 对应 contract
3. 复用现有 `structured-result/ai_review_v1`
4. 先接一个 provider bridge
5. `delegation-evaluator` 改为调用 runtime
6. `review-parser.ts` 继续作为 fallback

这样能尽快验证：

- 统一插座是否成立
- `submit_structured_result` 是否能稳定成为主结果出口
- runtime 是否足以承接后续 workflow 场景

---

## 10. 开放问题

需要后续单独定稿的点：

1. `OneShotTaskRuntime` 是否需要暴露 streaming hook，还是只返回最终结果
2. `contractOverride` 的允许范围要不要再收紧
3. `sessionId` 在 one-shot 场景里是否真的需要对外暴露
4. provider bridge 是否直接站在现有 `ProviderAdapter` 之上，还是单独抽一层
5. `tools` 白名单是按 taskType 静态配置，还是允许运行时扩展
