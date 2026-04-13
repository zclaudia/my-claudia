# Structured Result Protocol 详细设计

## Status

- Status: Draft
- Owners: MyClaudia
- Scope: server provider runtime, AI review path, cli-jobs infrastructure
- Related:
  - `docs/design/structured-result-protocol-outline.md`
  - `docs/design/provider-capability-protocol.md`

---

## 1. Summary

本设计将概要方案收敛为一条主线和一条 fallback 线：

1. **主线：CLI-first one-shot task runtime**
   - 以统一的 `OneShotTaskRuntime` 作为对外入口
   - provider adapter 负责上下文组装、MCP/tool 注入、CLI 差异适配
   - `submit_structured_result` 是当前 one-shot task 的统一结果出口

2. **fallback 线：文本结果兼容**
   - 当 provider 未正确提交 final tool，或任务策略要求兼容旧行为时
   - 继续使用文本 JSON 提取、归一化、降级结果

两条线共享一套结构化结果基础设施：

- result type registry
- JSON schema validator
- fallback policy
- 统一观测字段

主路径并不依赖切换到 SDK 或长期会话模型；执行载体仍然是 provider CLI。

---

## 2. Goals

### 2.1 Primary Goals

- 为任务型场景提供统一的 CLI-first one-shot task 协议
- 让业务层消费统一结果对象，而不是直接解析 provider 输出文本
- 将 `cli-jobs` 中重复的 provider-specific runner 逻辑抽离成 runtime 内部可复用基础设施
- 让 `submit_structured_result` 成为当前 one-shot task 的主结果通道，文本解析降级为 fallback

### 2.2 Secondary Goals

- 为后续 `workflow step output`、`risk analysis`、`structured summary` 等场景复用
- 把结构化结果的验收逻辑从提示词层前移到宿主协议层
- 提供可观测的成功率、fallback 率、校验失败率指标

### 2.3 Non-Goals

- 不在第一阶段替换所有现有文本解析
- 不尝试定义一个能表示所有任务结果的万能 payload
- 不在本设计里解决全部 provider capability 建模问题

---

## 3. Design Principles

### 3.1 Submission Mechanism Is Unified, Payload Is Typed

统一的是“提交方式”，不是所有业务结果的字段结构。

- 提交方式统一：`submit_structured_result`
- 结果结构按 `result_type` 分类型注册

### 3.2 Main Path and Fallback Path Must Be Explicitly Separated

主路径：

- provider CLI + MCP/tool 注入
- schema-validated submission
- 宿主直接接受结构化结果

fallback 路径：

- 文本 JSON 提取
- 归一化
- 降级结果

任何时候都不能把 fallback 的宽松性混入主路径。

### 3.3 CLI Execution and Result Understanding Must Be Decoupled

`cli-jobs` 需要拆成三层：

- runner: 进程执行
- adapter: provider CLI 差异
- parser: 业务结果解释

但这三层不应长期直接暴露给业务调用方；长期中心应是 `OneShotTaskRuntime`。

### 3.4 Final Submission Is a Terminal Action

`submit_structured_result` 是终态提交，而不是普通工具：

- 校验失败：会话继续
- 校验成功：宿主结束当前任务

### 3.5 Fallback Is Product Policy, Not Parser Accident

是否允许 fallback，以及 fallback 怎么处理，是任务级策略，不是解析失败后的临时补丁。

### 3.6 CLI Is the Carrier, Final Tool Is the Contract

本设计不将 CLI 与 `submit_structured_result` 对立起来：

- CLI 是统一执行载体
- `submit_structured_result` 是统一结果契约

只要 provider CLI adaptor 能完成 MCP/tool 注入与结果截获，两者就应共同构成 one-shot task 主路径。

### 3.7 Session Mode and One-Shot Mode Share the Same Capability Model

provider 的会话模式与 CLI one-shot 模式，定位上只是适用场景不同：

- 会话模式面向持续交互
- one-shot 模式面向单次任务收敛

因此设计上应遵循“**能力尽可能对齐，运行时按需裁剪**”原则：

- one-shot runtime 优先复用现有 provider runtime 的 MCP/tool 注入能力
- skill 注入、上下文装配、provider-specific 启动逻辑应尽可能共用
- sandbox / cwd / env / telemetry 等基础能力不应重新发明一套平行体系

这也意味着 provider adaptor 的职责不是简单的命令拼接，而是将现有 provider runtime 能力裁剪成适合 one-shot task 的执行上下文。

---

## 4. Architecture Overview

整体架构拆为三层：

### Layer A: Structured Result Foundation

统一结果协议的公共模块：

- `types.ts`
- `schema-registry.ts`
- `validator.ts`
- `finalization-tool.ts`
- `fallback.ts`

### Layer B: Provider Runtime Integration

分两条链：

- **One-shot task runtime 链**：统一入口 -> provider adapter -> CLI -> `submit_structured_result`
- **fallback parser 链**：stdout/stderr/output file -> parser -> normalize -> fallback result

### Layer C: Business Consumers

第一批消费者：

- `delegation-evaluator.ts`
- `ai-review-executor.ts`
- `ai-risk-analysis-executor.ts`

未来消费者：

- workflow step executors
- structured analysis tasks

---

## 5. Module Design

## 5.0 `one-shot-task/` 模块

新增统一任务入口模块，作为业务侧长期依赖面。

建议新增：

- `server/src/application/one-shot-task/types.ts`
- `server/src/application/one-shot-task/contracts.ts`
- `server/src/application/one-shot-task/runtime.ts`
- `server/src/application/one-shot-task/provider-bridge.ts`

核心对象建议：

```ts
export interface OneShotTaskRequest {
  taskType: string;
  providerType: string;
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;
  resultType: string;
}

export interface OneShotTaskContract {
  resultType: string;
  tools: ToolDefinition[];
  requireStructuredSubmit: boolean;
  fallbackPolicy: FallbackPolicy;
}

export interface OneShotTaskResult<T = unknown> {
  ok: boolean;
  result?: T;
  usedFallback: boolean;
  rawText?: string;
  telemetry?: StructuredResultTelemetry;
}
```

职责：

- 接收业务请求
- 选择 provider adapter
- 为任务构造 task-scoped contract
- 注入 `submit_structured_result`
- 调用 provider runtime
- 统一处理 final result / fallback / telemetry

## 5.1 `structured-result/types.ts`

定义平台内部统一类型。

```ts
export interface StructuredResultTypeEntry<T = unknown> {
  resultType: string;
  jsonSchema: Record<string, unknown>;
  fallbackPolicy: FallbackPolicy<T>;
}

export interface StructuredResultSubmission {
  resultType: string;
  payload: Record<string, unknown>;
}

export interface StructuredResultAccepted<T = unknown> {
  accepted: true;
  resultType: string;
  payload: T;
}

export interface StructuredResultRejected {
  accepted: false;
  code:
    | 'unknown_result_type'
    | 'schema_validation_failed'
    | 'invalid_payload_type';
  message: string;
  details?: unknown;
}

export type StructuredResultValidationResult<T = unknown> =
  | StructuredResultAccepted<T>
  | StructuredResultRejected;

export interface FallbackPolicy<T = unknown> {
  strategy: 'text_json_parse' | 'mark_uncertain' | 'fail';
  parser?: (text: string) => T;
}

export interface StructuredResultFallbackOutcome<T = unknown> {
  source: 'fallback_text_json' | 'fallback_uncertain' | 'fallback_fail';
  result?: T;
  error?: string;
}

export interface StructuredResultTelemetry {
  resultType: string;
  acceptedOnAttempt?: number;
  validationFailures: number;
  finalized: boolean;
  fallbackTriggered: boolean;
  fallbackStrategy?: FallbackPolicy['strategy'];
}
```

设计说明：

- `StructuredResultAccepted` 与 `StructuredResultRejected` 明确区分宿主验收结果
- `FallbackPolicy` 保持极简，只表达任务产品策略
- telemetry 独立定义，避免与业务 payload 混杂

## 5.2 `structured-result/schema-registry.ts`

职责：

- 注册 `result_type`
- 查询 schema
- 防止重复注册

建议接口：

```ts
export class StructuredResultRegistry {
  register<T>(entry: StructuredResultTypeEntry<T>): void;
  get<T>(resultType: string): StructuredResultTypeEntry<T> | undefined;
  has(resultType: string): boolean;
  list(): string[];
}
```

初始化策略：

- 使用进程级单例
- 在 server 启动时注册内建 result type
- 先只注册 `ai_review_v1`

## 5.3 `structured-result/validator.ts`

职责：

- 校验 `submit_structured_result` 的 payload
- 将 schema 校验错误转成稳定错误消息

建议接口：

```ts
export function validateStructuredResultSubmission<T>(
  registry: StructuredResultRegistry,
  submission: StructuredResultSubmission,
): StructuredResultValidationResult<T>;
```

校验步骤：

1. `resultType` 是否存在
2. `payload` 是否为 object
3. 使用 JSON Schema 校验
4. 返回 accepted / rejected

错误消息要求：

- 面向模型和面向日志都可读
- 短文本、字段明确
- 不泄露内部实现细节

示例：

- `Unknown result_type "foo_v1". Expected one of: ai_review_v1`
- `payload.decision must be one of: approve, deny, uncertain`

## 5.4 `structured-result/finalization-tool.ts`

职责：

- 定义 `submit_structured_result` tool schema
- 执行校验
- 维护当前会话的 finalization 状态

### Tool Definition

```ts
export function createSubmitStructuredResultTool(): ToolDefinition;
```

### Runtime Context

需要一个运行时容器保存最终提交状态：

```ts
export interface StructuredResultRunContext<T = unknown> {
  finalized: boolean;
  acceptedResult?: {
    resultType: string;
    payload: T;
  };
  validationFailures: number;
}
```

### Executor

```ts
export interface FinalizationExecutorResult {
  toolResult: ToolResult;
  finalized: boolean;
}

export function executeSubmitStructuredResult<T>(
  registry: StructuredResultRegistry,
  runContext: StructuredResultRunContext<T>,
  call: StructuredResultSubmission,
): FinalizationExecutorResult;
```

执行语义：

1. 校验 submission
2. 若失败：
   - `validationFailures += 1`
   - 返回 error tool result
   - `finalized = false`
3. 若成功：
   - 写入 `acceptedResult`
   - `runContext.finalized = true`
   - 返回 success tool result
   - `finalized = true`

### Session Control Policy

虽然不需要单独维护“内容修复 prompt 状态机”，但仍需要宿主层会话控制：

```ts
export interface FinalizationSessionPolicy {
  maxValidationFailures: number; // default: 3
}
```

当 `validationFailures > maxValidationFailures`：

- 不再继续让模型重试
- 转入 fallback / fail

## 5.5 `structured-result/fallback.ts`

职责：

- 当 final tool 未触发或重试超限时，执行任务级 fallback

建议接口：

```ts
export function applyFallbackPolicy<T>(
  policy: FallbackPolicy<T>,
  text: string,
): StructuredResultFallbackOutcome<T>;
```

行为：

- `text_json_parse`: 调 parser
- `mark_uncertain`: 构造产品定义的 uncertain 结果
- `fail`: 返回失败

注意：

- fallback 是任务策略，不是 validator 职责
- fallback parser 可继续复用现有 `parseFinalReviewFromText`

---

## 6. Result Type Design

## 6.1 `ai_review_v1`

这是第一批接入的 result type。

### Payload Schema

```json
{
  "type": "object",
  "properties": {
    "decision": { "type": "string", "enum": ["approve", "deny", "uncertain"] },
    "reasoning": { "type": "string" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  },
  "required": ["decision", "reasoning", "confidence"],
  "additionalProperties": false
}
```

### Fallback Policy

```ts
const aiReviewFallbackPolicy: FallbackPolicy<AIReviewResult> = {
  strategy: 'text_json_parse',
  parser: parseFinalReviewFromText,
};
```

### Product Interpretation

- `decision` 是最终 verdict
- `reasoning` 是用户可见理由
- `confidence` 用于阈值判断

### Normalization Boundary

主路径：

- 不做同义词归一化
- schema 严格约束

fallback 路径：

- 使用现有 `normalizeReviewDecision()`
- 继续兼容 `"approved"` / `"allow"` / `"safe"` / `"yes"` 等值

---

## 7. Tool-Calling Provider Design

本节是阶段 2 的关键。

## 7.1 Interface Choice

详细设计里选择**显式 finalization outcome** 的接口，而不是仅靠外部短路。

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

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface OneShotTaskRunOptions {
  prompt: string;
  systemPrompt?: string;
  tools: ToolDefinition[];
  onToolCall: (call: ToolCall) => Promise<ToolCallOutcome>;
}

export interface OneShotTaskRunResult {
  finalText: string;
  stopReason?: string;
}

export interface ProviderCliAdapter {
  runOneShotTask(
    options: OneShotTaskRunOptions,
  ): Promise<OneShotTaskRunResult>;
}
```

选择这个接口的原因：

- `finalized` 由宿主显式通知 provider runtime
- provider integration 可以在同一轮 tool result 返回后立即结束
- 避免“工具通过了但模型又输出额外文本”这种不稳定状态

这里的 `ProviderCliAdapter` 是 **one-shot runtime 内部使用的桥接接口**。它可以站在现有 `ProviderAdapter` / `RunOptions` 之上实现，不要求替换当前 provider runtime。

## 7.2 Runtime Flow

CLI one-shot task 主路径的运行流程：

1. 宿主构造 prompt
2. 宿主注入 `submit_structured_result` tool
3. provider CLI adaptor 注入 MCP/tools 并启动 CLI
4. 模型可能调用普通工具
5. 模型调用 `submit_structured_result`
6. 宿主校验 submission
7. 若失败：
   - 返回 error tool result
   - 模型继续
8. 若成功：
   - 写入 accepted result
   - 返回 `finalized = true`
   - provider CLI 结束当前运行
9. 若模型始终未提交 final result：
   - 走 fallback policy

## 7.3 Provider Support Strategy

第一批不要求所有 provider 都具备同样强度的 one-shot task 能力。

建议按能力分级：

- `tool_submission_ready`
- `cli_fallback_only`
- `unknown`

只有 `tool_submission_ready` provider 可以进入 structured result 主路径。

---

## 8. CLI Jobs Generalization Design

本节是阶段 0 的重点，但其定位需要明确：

- `cli-jobs` 是 runtime 早期的 provider-specific 执行经验沉淀
- `cli-jobs` 不是未来业务侧长期依赖的统一入口
- `review-job.ts` 一类文件最终应被 `OneShotTaskRuntime` 取代

## 8.1 Target Structure

重构后的目录：

```text
server/src/infrastructure/providers/cli-jobs/
├── types.ts
├── runner.ts
├── review-job.ts
├── provider-validation.ts
├── parsers/
│   ├── review-parser.ts
│   └── json-extract.ts
└── adapters/
    ├── claude.ts
    ├── codex.ts
    ├── kimi.ts
    ├── cursor.ts
    └── opencode.ts
```

## 8.2 Core Types

```ts
export interface CliJobInput {
  prompt: string;
  cwd: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface CliJobRawResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CliProviderAdapter {
  providerType: string;
  binary(input: CliJobInput): string;
  buildArgs(input: CliJobInput): string[];
  buildPrompt(prompt: string, systemPrompt?: string): string;
  prepare?(input: CliJobInput): Promise<void> | void;
  extractAssistantText(raw: CliJobRawResult): string;
  cleanup?(): Promise<void> | void;
}
```

说明：

- `binary()` 使用函数而不是字段，便于读取 `cliPath`
- `prepare/cleanup` 允许 Codex 之类 provider 做临时文件管理
- `extractAssistantText` 收到的是完整 raw result，而不是单独 stdout/stderr 参数

## 8.3 Runner

```ts
export async function runCliJob<T>(
  adapter: CliProviderAdapter,
  input: CliJobInput,
  parseResult: (assistantText: string, raw: CliJobRawResult) => T,
): Promise<T>;
```

Runner 负责：

- `spawn`
- timeout
- `stdout/stderr` 采集
- env 清理
- duration 统计
- `prepare/cleanup` 生命周期
- 错误包装

Runner 不负责：

- 业务结果解释
- decision normalization
- fallback policy

## 8.4 Parser Boundary

parser 只接受：

- `assistantText`
- `rawResult`

输出业务对象，例如：

- `AIReviewCliJobResult`
- `CodeSummaryResult`
- `RiskAnalysisResult`

第一阶段仅保留：

- `parseFinalReviewFromText`

## 8.5 review-job.ts

`review-job.ts` 继续保留公共入口：

```ts
export async function runAIReviewCliJob(
  providerType: string,
  input: CliJobInput,
): Promise<AIReviewCliJobResult>;
```

但内部改成：

1. 根据 `providerType` 选择 adapter
2. 调用 `runCliJob`
3. 使用 `parseFinalReviewFromText` 作为 parser

这样对调用方保持兼容。

但需要明确：

- `review-job.ts` 只承担过渡期兼容职责
- 业务侧长期不应继续直接依赖它
- 进入 Phase 2 后，统一入口将迁移到 `OneShotTaskRuntime`

---

## 9. Business Integration

## 9.1 delegation-evaluator.ts

### 阶段 0/1

不改主流程，只做：

- 后续可复用的 `FallbackPolicy` 对齐
- 归一化函数向 fallback 专用层收口

### 阶段 2

将 `analyzeLLMRisk()` 的最终结果获取改为：

1. 构造 `submit_structured_result`
2. 通过 `OneShotTaskRuntime` 发起 task-scoped 运行
3. 中间 `read_file` 流程保留
4. 最终由 `submit_structured_result` 终态提交 verdict
5. 未提交则 fallback

### 可删除/降级代码

主路径切换后，可将以下逻辑降级为 fallback 专用：

- JSON 文本提取
- 宽松字段修复
- decision 同义词归一化
- repair prompt

## 9.2 AIReviewQueue

无需改动调度语义。

仅在阶段 2 中替换其底层执行入口：

- 当前：`AIReviewProvider.runPrompt()`
- 未来：`OneShotTaskRuntime`

## 9.3 ai-review-executor.ts

当前是文本标记判断。

迁移路径：

- 阶段 1: 先定义 `ai_review_v1`
- 阶段 2+: 改为消费 structured result

## 9.4 ai-risk-analysis-executor.ts

依赖 `evaluateAIReview()`，跟随 `delegation-evaluator` 自动迁移。

---

## 10. Telemetry Design

## 10.1 Phase 0 Metrics

- adapter migration coverage
- existing test pass rate
- result parity against old runners

## 10.2 Phase 1 Metrics

- registered result types
- schema validation coverage
- fallback parser compatibility rate

## 10.3 Phase 2 Metrics

- final tool first-pass success rate
- validation retry success rate
- fallback trigger rate
- average validation failure count
- finalization latency overhead

## 10.4 Logging

建议记录以下结构化日志字段：

```ts
{
  resultType: 'ai_review_v1',
  providerType: 'claude',
  mode: 'structured_submit' | 'fallback',
  validationFailures: 1,
  finalized: true,
  fallbackTriggered: false,
  durationMs: 1420
}
```

---

## 11. Migration Plan

## Phase 0: CLI Generalization

1. 引入 `runner.ts`
2. 创建 5 个 adapter
3. 保持 `review-job.ts` API 不变
4. 迁移现有测试

验收标准：

- 所有现有 cli-jobs 测试通过
- 行为与当前版本一致

## Phase 1: Structured Result Foundation

1. 新增 `structured-result/` 模块
2. 注册 `ai_review_v1`
3. 将 `parseFinalReviewFromText` 与 fallback policy 对齐

验收标准：

- schema 校验可独立测试
- fallback 行为与当前一致

## Phase 2: OneShotTaskRuntime Introduction

1. 设计并实现 `OneShotTaskRuntime`
2. 为首个 provider 提供 provider bridge 实现
3. 将 `delegation-evaluator` 切到 structured result 主路径
4. 保留 fallback

验收标准：

- `submit_structured_result` 可完成 `ai_review_v1` 提交
- validation failure 可触发有限次重试
- finalization 成功后可直接结束会话

## Phase 3: Broader Adoption

逐步迁移：

- `ai-review-executor`
- workflow step outputs
- 其他机器消费型任务

---

## 12. Risks

### 12.1 Provider Support Risk

不是所有 provider 都适合实现 `ToolCallingProvider`。

缓解方式：

- 保留 fallback
- 分 provider 渐进接入

### 12.2 Final Tool Not Called

模型可能始终不调用 `submit_structured_result`。

缓解方式：

- prompt 强约束
- fallback policy
- telemetry 监控

### 12.3 Infinite Self-Correction

模型可能不断提交错误 payload。

缓解方式：

- `maxValidationFailures`
- 超限 fallback / fail

### 12.4 Over-Coupling Schema to Product

过早设计复杂 schema 会抬高 adoption 成本。

缓解方式：

- 每个 result type 从最小字段集开始
- 通过 `_v2` 演进

---

## 13. Open Questions

1. 第一批 `ToolCallingProvider` 由哪个 provider 落地最稳？
2. `ToolDefinition` / `ToolCall` / `ToolResult` 是否应与现有 PCP / interaction tool 类型复用？
3. schema validator 采用现有依赖还是新增实现？
4. `ai-review-executor` 是否应直接复用 `ai_review_v1`，还是定义 workflow-specific result type？

---

## 14. Recommended Next Step

建议按以下顺序继续：

1. 先评审本详细设计
2. 先实施 Phase 0：`cli-jobs` 通用化
3. 再实施 Phase 1：structured-result 基础设施
4. 最后单独设计 `ToolCallingProvider` 的接入方案

这样能先拿到近期工程收益，同时不给当前主路径引入过高风险。
