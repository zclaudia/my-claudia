# Structured Result Protocol 概要方案

## 背景

当前项目在多 provider CLI 场景下，最终结果输出主要依赖以下方式：

- provider CLI 原生结构化输出
- 提示模型输出 JSON 文本
- 服务端从 stdout / stderr / 输出文件中提取并修复 JSON

这条链路已经能支撑 `ai-review`，但存在几个持续性问题：

- 不同 provider CLI 的输出风格差异大
- 结构化结果约束主要停留在提示词层
- 解析、修复、归一逻辑分散在多个模块
- 关键函数存在跨模块重复实现且行为不一致（详见下方）
- 新增场景时容易重复造 parser 和 fallback

### 现有重复代码

| 函数 | 位置 A | 位置 B | 问题 |
|------|--------|--------|------|
| `extractJSONObjects()` | `cli-jobs/json-extract.ts` | `delegation-evaluator.ts` | 逻辑相同，各维护一份 |
| `normalizeReviewDecision()` | `cli-jobs/review-parser.ts` | `delegation-evaluator.ts` 中的 `normalizeAIReviewDecision()` | 同义词集合不一致：delegation-evaluator 额外接受 `"yes"`/`"sensitive"`/`"escalate"`，review-parser 不认 |

这种分叉是缺少统一结构化结果层的直接后果。

因此需要一套平台级方案，把"最终结果输出"从自由文本解析转向统一的结构化提交协议，并将这套协议直接纳入 CLI one-shot task 主路径。

## 目标

建立一套通用的 **CLI-first one-shot task runtime**。任务在 provider CLI 内执行，宿主通过统一入口和 provider adapter 注入 MCP/tools；模型在任务结束时通过一个带 schema 约束的 MCP tool 提交最终结果，由宿主统一完成：

- schema 校验
- 结构化结果验收
- fallback 降级
- 结果观测与诊断

该方案不只服务 `ai-review`，而是面向所有"机器需要继续消费结果"的任务。

### Provider Runtime 对齐原则

provider 的**会话模式**与 **CLI one-shot 模式**，本质上是同一能力体系下的两种运行模式：

- 会话模式：适合长交互、持续上下文、用户参与的运行
- CLI one-shot 模式：适合任务触发、目标明确、一次性收敛结果的运行

两者的差异主要在**场景、生命周期和运行时裁剪**，而不应体现在基本能力模型完全不同。因此本方案要求：

- CLI one-shot runtime 尽可能复用现有 provider 会话体系中的 MCP/tool 注入能力
- skill 注入、上下文拼装、provider-specific 启动配置、env/sandbox/cwd 管理应尽可能对齐
- 文本 parser 只作为 fallback，不应成为 one-shot runtime 的核心抽象

### 当前阶段边界

需要明确区分两个层面：

- **平台协议目标**：建立统一的 one-shot task 协议（统一入口 + provider adapter + MCP/tool 注入 + `submit_structured_result` + schema registry + fallback）
- **近期代码重构目标**：以 `OneShotTaskRuntime` 为中心收口现有能力，并将 `cli-jobs` 降级为过渡层/兼容层，而不是长期核心层

对**当前 CLI provider 路径**而言，第一阶段的直接收益主要来自：

- `cli-jobs` 通用化重构
- provider CLI 的 MCP/tool 注入收口
- schema registry 与结果校验落地
- fallback parser 收口

在本方案校准后，**`submit_structured_result` 就是当前 one-shot task 的主结果通道**；文本解析只作为 fallback。前提不是切换到 SDK 或长期会话模型，而是 provider adapter 能为对应 CLI 提供合适的 MCP/tool 注入方式。

更具体地说，近期实现的目标不是继续增强 `review-job.ts` 一类任务特化入口，而是新增统一的：

- `OneShotTaskRequest`
- `OneShotTaskRuntime`
- `OneShotTaskContract`
- `OneShotTaskResult`

由这层统一调度 provider CLI，而不是让业务侧长期直接依赖 `cli-jobs/*-review.ts`。

## 非目标

本方案不试图：

- 用一个固定 schema 统一所有任务输出
- 取消所有自由文本输出
- 在第一阶段替换现有 `cli-jobs` 全链路

## 核心思路

统一的是"提交机制"和"验收流程"，不是所有任务的 payload 结构。

平台提供一个通用 MCP tool：

- `submit_structured_result`

模型在任务结束时不直接依赖自由文本输出最终结果，而是调用该 tool，提交：

- `result_type`
- `payload`

其中：

- `result_type` 标识当前任务期望的结果类型
- `payload` 必须符合宿主为该 `result_type` 注册的 JSON Schema

校验失败时，宿主将校验错误作为 tool result 返回给模型，由模型自行修正并重新调用。这里的运行载体仍然是 provider CLI，只是 CLI 在本次 one-shot task 内被注入了 MCP/tools。宿主仍需保留最薄的一层**任务控制策略**，例如：

- 最大校验失败次数
- finalization 成功后的短路结束
- 超限后的 fallback 或 fail

### 当前主线：CLI + MCP/tool 注入

本方案的关键前提不是“先升级成 SDK 会话抽象”，而是：**provider CLI adaptor 必须能为本次 one-shot task 注入工具，并在 CLI 执行期间接收 tool call / 返回 tool result。**

也就是说，统一入口应当是：

1. 上层触发 one-shot task
2. 统一 runtime 选择 provider adapter
3. adapter 组装 prompt / env / MCP bridge / tool 注入方式
4. CLI 执行任务
5. 模型通过 `submit_structured_result` 提交最终结果
6. 宿主读取并校验结果

如果某个 provider CLI 暂时无法稳定完成上述链路，则退回 fallback，而不是把文本解析当主路径。

### 统一入口形态

长期目标中的统一入口应当类似：

1. 上层（workflow / ai-review / analysis task）构造 `OneShotTaskRequest`
2. `OneShotTaskRuntime` 根据 provider type 选择 provider adapter
3. runtime 为本次任务构造 task-scoped context 与 task contract
4. runtime 注入 `submit_structured_result` 与任务允许的 bridge tools
5. provider CLI 执行
6. runtime 接收 final tool submission 或 fallback 文本结果
7. runtime 返回统一的 `OneShotTaskResult`

这意味着：

- `cli-jobs` 更适合作为 runtime 内部的过渡实现，而不是最终对外接口
- `review-parser.ts` 一类文本解析逻辑应保留，但降级为 fallback 层

### 终态提交语义

`submit_structured_result` 不是普通工具，而是**终态提交工具**。这意味着 provider 抽象除了支持 tool call / tool result 往返外，还必须支持宿主在校验通过后结束当前任务。

建议明确以下运行语义：

1. 模型调用 `submit_structured_result`
2. 宿主校验 payload
3. 若校验失败：
   - 返回 tool error/result 给模型
   - 允许模型继续推理并重新提交
4. 若校验通过：
   - 宿主将结果写入 run context
   - 将本次运行标记为 `finalized`
   - **直接结束当前会话，不再要求模型继续输出最终文本**

即，成功的 `submit_structured_result` 本身就是终态，不应再退回到“等模型再输出一句自然语言总结”的模式。

可选地，provider 接口可以显式表达这种终态行为，例如：

```typescript
interface ToolCallOutcome {
  toolResult: ToolResult;
  finalized?: boolean;
}
```

或者由 `runWithTools()` 在宿主侧检测到 finalization 后主动短路结束。

## 通用 Tool 设计

建议的 tool 入参：

```json
{
  "type": "object",
  "properties": {
    "result_type": {
      "type": "string"
    },
    "payload": {
      "type": "object"
    }
  },
  "required": ["result_type", "payload"],
  "additionalProperties": false
}
```

该 tool 的语义不是"打印输出"，而是"提交最终结构化结果"。

tool executor 的处理逻辑：

1. 根据 `result_type` 从 registry 查找 schema
2. 校验 `payload`
3. 校验通过：写入当前 run context，返回成功
4. 校验失败：返回错误信息作为 tool result（模型会据此自行修正并重试）

## Schema Registry

宿主维护一份结果类型注册表，每个 `result_type` 绑定一个 schema 和 fallback 策略。

示例 result type：

- `ai_review_v1`
- `permission_decision_v1`
- `workflow_step_output_v1`
- `code_summary_v1`
- `task_plan_v1`

每个注册项包含：

- `resultType` — 结果类型标识
- `jsonSchema` — payload 的 JSON Schema
- `fallbackPolicy` — 模型未调用 tool 时的降级策略（见 FallbackPolicy 定义）

版本管理采用简单方案：版本直接体现在 `resultType` 后缀中（如 `_v1`、`_v2`）。不兼容变更新建 type，registry 中可同时保留多个版本的 entry。

### 首个 schema 定义：`ai_review_v1`

基于现有 `AIReviewCliJobResult` 类型（`cli-jobs/types.ts`）直接转换：

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

在 tool-calling 主路径上，schema 的 `enum` 约束保证 `decision` 只接受三个标准值，主路径不再需要归一化。

但 **fallback 路径**（`text_json_parse`）仍然会处理自由文本中的非规范值（`"allow"`/`"approved"`/`"safe"`/`"yes"` 等），因此 `normalizeReviewDecision()` 不能删除，而是从"主路径必需"降级为"fallback 专用"。

### FallbackPolicy 定义

```typescript
interface FallbackPolicy {
  /** 降级策略 */
  strategy: 'text_json_parse' | 'mark_uncertain' | 'fail';
  /** strategy 为 text_json_parse 时使用的解析函数 */
  parser?: (text: string) => unknown;
}
```

- `text_json_parse`：从模型文本输出中提取 JSON 并尝试解析（对应现有 `parseFinalReviewFromText`）
- `mark_uncertain`：不尝试解析，直接返回 `uncertain` 结果
- `fail`：直接返回失败

## 执行流程

### 1. 宿主暴露 tool 并在 prompt 中声明

宿主通过 provider CLI adaptor 向模型暴露 `submit_structured_result` tool，同时在系统提示或任务提示中明确：

- 最终结果必须通过该 tool 提交
- 使用哪个 `result_type`
- 普通文本不能作为最终机器结果

### 2. 模型执行任务

模型在中间过程可以继续：

- 读取信息
- 调用其他工具
- 输出中间文本

但在结束时应调用：

- `submit_structured_result(result_type, payload)`

### 3. 宿主校验 tool call

宿主收到 tool call 后：

1. 校验 `result_type` 是否已注册
2. 根据 registry 找到 schema
3. 校验 `payload`
4. 校验通过 → 接受结果，写入 run context，流程结束
5. 校验失败 → 将校验错误作为 tool result 返回

校验失败时，模型会看到错误信息并自行修正、重新调用 tool。宿主不需要手工维护“内容修复 prompt 状态机”，但仍需要管理：

- 最大连续校验失败次数
- finalization 成功后的会话终止
- 超限后的 fallback / fail

**注意：此流程要求 provider CLI adaptor 能完成 MCP/tool 注入与 tool result 回传。**

### 4. fallback

如果模型结束时未调用 `submit_structured_result`，宿主根据该任务的 `fallbackPolicy` 进行降级处理：

- 从模型文本输出中解析 JSON
- 标记结果为 `uncertain`
- 直接返回失败

## 适用范围

优先适用于这类任务：

- AI review
- permission decision
- workflow step output
- automation 回执
- 风险评估
- 执行计划
- 结构化摘要
- 代码检查结果

不建议强制应用于：

- 闲聊
- 纯开放式长文
- 只面向人类阅读的自由回答

## CLI Provider 通用化重构

### 现状问题

当前 `cli-jobs/` 下有 5 个 provider 特化实现（`claude-review.ts`、`codex-review.ts`、`kimi-review.ts`、`cursor-review.ts`、`opencode-review.ts`），每个文件 100-150 行，但逻辑高度相似：spawn 进程 → 采集输出 → 解析结果。大量样板代码重复（timeout 处理、env 清理、settled 状态管理等），且与 AI review 业务耦合 — 新增任务类型需要为每个 provider 再写一份。

### 重构目标

将"怎么跑 CLI"和"怎么理解结果"解耦，使得：

- 新增 provider：只需定义 CLI 参数和输出提取方式
- 新增任务类型：只需提供 prompt 和结果解析函数
- 两者正交组合，不再 N×M 膨胀

### Provider Adapter 接口

每个 provider 实现一个 adapter，描述自己的 CLI 接口：

```typescript
interface CliProviderAdapter {
  /** CLI 二进制名称 */
  binary: string;
  /** 构造 CLI 参数 */
  buildArgs(input: CliJobInput): string[];
  /** 组装 prompt（处理 system prompt 注入差异） */
  buildPrompt(prompt: string, systemPrompt?: string): string;
  /** 从原始输出中提取 assistant 文本 */
  extractAssistantText(stdout: string, stderr: string, exitCode: number | null): string;
  /** 可选的资源清理（如 Codex 的临时文件） */
  setup?(): void;
  cleanup?(): void;
}
```

各 provider 的核心差异收敛在 adapter 中：

| Provider | binary | 输出提取策略 | 特殊处理 |
|----------|--------|-------------|---------|
| Claude | `claude` | JSON stdout → `.result` 字段 | `--system-prompt` flag |
| Codex | `codex` | 读 output file | 临时目录 + schema file，需 setup/cleanup |
| Kimi | `kimi` | NDJSON stream → assistant event chunks | `--prompt` flag |
| Cursor | `cursor-agent` | NDJSON stream → assistant text blocks | 无 |
| OpenCode | `opencode` | NDJSON stream → 多字段兜底提取 | agent 配置错误检测 |

### 通用 Runner

一个通用的 `runCliJob` 函数处理所有样板逻辑：

```typescript
async function runCliJob<T>(
  adapter: CliProviderAdapter,
  input: CliJobInput,
  parseResult: (assistantText: string, raw: CliJobResult) => T,
): Promise<T>;
```

Runner 负责：spawn 进程、env 清理、timeout 管理、stdout/stderr 采集、settled 状态、调用 adapter 提取文本、调用 parseResult 解析业务结果。

### 使用方式

同一个 provider，不同任务只需注入不同的 prompt 和解析函数：

```typescript
// AI review
const reviewResult = await runCliJob(claudeAdapter, input, parseFinalReviewFromText);

// Code summary（未来场景）
const summaryResult = await runCliJob(claudeAdapter, input, parseCodeSummary);

// Risk analysis
const riskResult = await runCliJob(kimiAdapter, input, parseRiskAnalysis);
```

新增 provider 只需定义 adapter：

```typescript
const newProviderAdapter: CliProviderAdapter = {
  binary: 'new-cli',
  buildArgs: (input) => ['--run', '--dir', input.cwd],
  buildPrompt: (prompt, sys) => sys ? `[System]\n${sys}\n\n${prompt}` : prompt,
  extractAssistantText: (stdout) => JSON.parse(stdout).text,
};
```

### 文件结构变更

阶段 0 的 `cli-jobs/` 重构仍然保留，但其定位变为 runtime 的过渡实现：

```
cli-jobs/
├── types.ts                    # 过渡期的 CLI job 类型
├── runner.ts                   # 通用 runCliJob
├── adapters/
│   ├── claude.ts               # Claude adapter
│   ├── codex.ts                # Codex adapter（含 setup/cleanup）
│   ├── kimi.ts                 # Kimi adapter
│   ├── cursor.ts               # Cursor adapter
│   └── opencode.ts             # OpenCode adapter
├── review-parser.ts            # AI review 文本 fallback 解析
├── review-job.ts               # 兼容入口，后续由 OneShotTaskRuntime 替代
└── provider-validation.ts      # 保持不变
```

长期新增统一入口：

```
application/one-shot-task/
├── types.ts
├── contracts.ts
├── runtime.ts
└── provider-bridge.ts
```

### 与 Structured Result Protocol 的关系

CLI provider 通用化与结构化结果协议是互补的：

- **通用化解决的是**：怎么高效地跑多个 provider CLI，减少样板代码
- **结构化结果协议解决的是**：怎么可靠地从模型输出中获取结构化结果
- **OneShotTaskRuntime 解决的是**：如何把 provider CLI、tool 注入和结构化结果收敛成统一任务入口

三者可以分阶段推进。通用化重构后，`review-parser.ts` 一类解析函数自然就是 fallback 策略的实现；最终统一入口由 `OneShotTaskRuntime` 承担。

### 已知约束：流式输出

当前 NDJSON 的三个 provider（Kimi/Cursor/OpenCode）是逐行增量处理 stdout 的。adapter 接口中 `extractAssistantText(stdout, ...)` 接收完整 stdout，意味着需等进程结束后再提取。对于当前 CLI job 场景（等完成后解析）这没有问题。如果未来需要流式中间反馈，adapter 接口需要扩展为增量模式。

## 与现有系统的关系

近期阶段不是继续强化 `cli-jobs` 作为最终主路径，而是：

- 先完成 `cli-jobs` 通用化，收口现有 provider-specific CLI 执行经验
- 落地 `structured-result/` 结果协议基础设施
- 再新增 `OneShotTaskRuntime` 作为统一任务入口

也就是说：

- `cli-jobs` 保留兼容和过渡价值
- `structured-result` 提供统一结果协议
- `OneShotTaskRuntime` 成为未来业务侧长期依赖面

## 平台侧统一模块

建议新增一组平台模块，统一管理结构化终态协议：

- `structured-result/types.ts` — 类型定义
- `structured-result/schema-registry.ts` — schema 注册与查找
- `structured-result/validator.ts` — payload 校验
- `structured-result/finalization-tool.ts` — MCP tool 定义与 executor
- `structured-result/fallback.ts` — fallback 决策

## 与现有实现的集成点

### delegation-evaluator（优先迁移）

`server/src/application/conversation/agent/delegation-evaluator.ts` 是结构化结果协议的最佳首个迁移目标：

- 现有 1000+ 行，大量代码用于文本 JSON 解析、修复、归一化
- 迁移后，`analyzeLLMRisk()` 的最终决策改为通过 `submit_structured_result` tool 提交
- 中间的 `read_file` 多轮交互仍保留现有机制
- 解析/修复相关代码大部分可删除

### cli-jobs（通用化重构，独立推进）

- 先完成 CLI provider 通用化重构（adapter + runner）
- 结构化结果协议作为后续优化叠加，不阻塞重构

### ai-review-executor（workflow 步骤）

`server/src/domains/workflows/step-executors/ai-review-executor.ts` 用文本标记 `[REVIEW_PASSED]`/`[REVIEW_FAILED]` 判断 review 结果，也是"从自由文本提取结构化结果"的场景。迁移后可改为通过 `submit_structured_result` 提交 review 结论，消除标记匹配逻辑。

### ai-risk-analysis-executor

`server/src/domains/workflows/step-executors/ai-risk-analysis-executor.ts` 封装了 `evaluateAIReview()`。delegation-evaluator 迁移后，此 executor 自动受益，无需额外改动。

### AIReviewQueue（无需改动）

`server/src/application/conversation/agent/ai-review-queue.ts` 是 delegation-evaluator 的调度层，负责串行化 review 请求。迁移 delegation-evaluator 后，queue 本身不需要改动 — 它只管入队/出队/取消，不涉及结果解析。

### 其他集成点

- `server/src/application/conversation/interactions/*`
- workflow step executor 中涉及结构化输出的路径

集成原则：

- provider runner 尽量只负责执行和采集原始结果
- 结构化终态验收由统一层处理
- 业务层不再直接解析 provider 自由文本

## 实施路径

### 依赖关系

结构化结果协议的落地涉及两条协同依赖链：

```
依赖链 A（one-shot task runtime）:
  1. 定义 structured-result 基础设施（types / registry / validator / tool）
  2. 定义统一 one-shot task 入口
  3. 在 runtime 中注册 submit_structured_result
  4. 保留 fallback（现有文本解析 + normalizeReviewDecision）

依赖链 B（provider CLI adaptor）:
  1. 实现通用 runner + adapter 接口
  2. 将 5 个 provider 文件迁移为 adapter
  3. 为 adapter 收口 MCP/tool 注入方式
  4. 让 CLI 结果优先通过 submit_structured_result 返回
```

两条链可以**并行推进**，但最终会在统一 one-shot task runtime 汇合。

但需要注意：

- **依赖链 A** 面向的是“统一任务契约与结果协议”
- **依赖链 B** 面向的是“provider CLI 的执行与注入能力”

因此，这份方案虽然统一放在一个文档中，但其实施产出分属两个时间尺度：

- **短期**：CLI 通用化、MCP/tool 注入收口、schema registry 打底
- **中期**：让 AI review / workflow 等消费者切到统一 one-shot task 入口

### 阶段 0：CLI provider 通用化（无前置依赖）

**可立即启动**，不依赖 provider 抽象升级：

1. 实现 `cli-jobs/runner.ts` 通用 runner
2. 将 5 个 provider 文件重构为 adapter
3. 现有 `review-job.ts` 改为调用 `runCliJob` + adapter
4. 验证行为不变（现有测试通过）

### 阶段 1：结构化结果基础设施

1. 定义 `structured-result/` 模块（types / schema-registry / validator / finalization-tool / fallback）
2. 为 `ai-review` 注册 `ai_review_v1` schema
3. 实现 `FallbackPolicy`，将现有 `parseFinalReviewFromText` + `normalizeReviewDecision` 作为 fallback parser

### 阶段 2：OneShotTaskRuntime 落地

**这是关键阶段**，目标是把 CLI + MCP/tool 注入 + final submission 串成统一入口：

1. 定义 `OneShotTaskRequest / Runtime / Contract / Result`
2. 在 runtime 中接入 provider adapter、bridge tools 和 `submit_structured_result`
3. 将 `analyzeLLMRisk()` 的最终决策改为通过 runtime 执行，而不是直接依赖 `review-job`
4. 中间的 `read_file` 多轮交互仍保留
5. 让 workflow 等后续消费者也走同一入口
6. 删除主路径的解析/修复代码，保留 fallback 路径的归一化逻辑
7. 收集观测指标，验证方案有效性

### 各阶段验证指标

| 阶段 | 验证目标 |
|------|---------|
| 阶段 0 | 重构后现有测试全部通过，行为不变 |
| 阶段 1 | schema 校验逻辑正确，fallback parser 兼容现有输出 |
| 阶段 2 | tool 调用成功率、自行纠错成功率、fallback 触发率（见观测章节） |

## 观测与诊断

观测指标应按实施阶段分别定义，避免高估早期阶段的可验证内容。

### 阶段 0：CLI provider 通用化

| 指标 | 含义 | 关注点 |
|------|------|-------|
| 测试通过率 | 重构后现有测试是否全部通过 | 必须保持 100% |
| 行为一致性 | 重构前后同一输入的 review 结果是否一致 | 不应出现回归 |
| adapter 覆盖率 | 5 个现有 provider 是否全部迁移到 adapter | 阶段完成标志 |

### 阶段 1：结构化结果基础设施

| 指标 | 含义 | 关注点 |
|------|------|-------|
| schema 校验覆盖率 | 已注册 result type 是否都有 validator 覆盖 | 首批至少覆盖 `ai_review_v1` |
| fallback 兼容率 | 现有文本输出是否仍能被 fallback parser 正确解析 | 不应低于当前行为 |
| 归一化收口情况 | 重复 parser / normalize 逻辑是否减少 | 应能消除现有分叉 |

### 阶段 2：Tool-calling 主路径

| 指标 | 含义 | 关注阈值 |
|------|------|---------|
| tool 调用成功率 | 模型首次调用 `submit_structured_result` 即通过校验的比例 | < 80% 需优化 prompt |
| 自行纠错成功率 | 首次校验失败后，模型重试后通过的比例 | < 90% 需检查 schema 或 error 信息质量 |
| fallback 触发率 | 模型结束时未调用 tool、走 fallback 的比例 | > 10% 说明 prompt 引导不够 |
| 平均重试次数 | 校验失败到最终通过的平均重试次数 | > 2 需检查 schema 复杂度 |
| 端到端延迟影响 | 引入 tool 校验后对任务总耗时的影响 | 不应显著增加 |

建议：

- 阶段 0/1 的指标主要在测试与 fallback 层采集
- 阶段 2 的指标在 `finalization-tool.ts` 的 executor 中统一埋点，并按 `result_type` 维度聚合

## 预期收益

### 定性收益

- 降低多 provider 输出格式漂移
- 减少业务层解析复杂度
- 提升最终结果格式稳定性
- 让新场景可以复用统一终态协议
- 把"结果正确性"从提示词层前移到宿主协议层

### 量化收益（基于现有代码分析，属于迁移完成后的理论预期）

#### delegation-evaluator.ts（当前 1108 行）

在**满足以下前提**时，`delegation-evaluator.ts` 中的主路径解析/修复代码有较大概率可删除或降级为 fallback 专用：

- `ToolCallingProvider` 已落地
- `analyzeLLMRisk()` 主路径已切换到 `submit_structured_result`
- fallback 仅保留兼容路径，不再承载主流程

基于这些前提，预期可删除/降级的解析修复代码如下：

| 函数 | 行数 | 删除原因 |
|------|------|---------|
| `extractJSONObjects()` | ~55 | tool calling 不需要从文本提取 JSON |
| `sanitizeJSONControlCharsInStrings()` | ~65 | 同上 |
| `salvageMalformedAIReviewResponse()` | ~25 | 同上 |
| `parseCandidateJSONObject()` | ~20 | 同上 |
| `parseAIReviewResponse()` | ~15 | 同上 |
| `normalizeAIReviewModelResponse()` | ~35 | tool schema 约束了输入格式，主路径不再需要 |
| `normalizeAIReviewDecision()` | ~28 | 主路径不再需要；降级为 fallback 专用，移至 `parsers/` |
| `extractLooseField()` | ~10 | 同上 |
| `buildRepairPrompt()` | ~15 | 依赖模型内置纠错 |
| **合计** | **~270 行** | **理论上限，约占文件 25%** |

#### cli-jobs/（5 个 provider 文件共 ~650 行）

| 现状 | 重构后 |
|------|--------|
| 每个文件 ~130 行，含 ~80 行样板 | runner.ts ~100 行 + 每个 adapter ~25 行 |
| 5 × 130 = 650 行 | 100 + 5 × 25 = 225 行 |
| **节省 ~425 行（65% 减少）** | **基于 adapter 设计稳定成立的预期值** |

#### 新增代码

| 模块 | 估计行数 |
|------|---------|
| `structured-result/types.ts` | ~30 |
| `structured-result/schema-registry.ts` | ~50 |
| `structured-result/validator.ts` | ~30 |
| `structured-result/finalization-tool.ts` | ~40 |
| `structured-result/fallback.ts` | ~30 |
| `cli-jobs/runner.ts` | ~100 |
| 5 个 adapter 文件 | ~125 |
| **合计** | **~405 行** |

#### 净效果

| 指标 | 数值 |
|------|------|
| 删除代码 | ~750 行 |
| 新增代码 | ~405 行 |
| **净减少** | **~345 行** |
| 消除重复函数 | 1 处（extractJSONObjects：delegation-evaluator 副本可删，主路径不再需要从文本提取 JSON） |
| 合并归一化逻辑 | normalizeReviewDecision 从两处各自维护合并为 fallback 专用一处（消除同义词分叉） |
| 扩展成本 | 新增 provider：~25 行 adapter（原 ~130 行）；新增任务类型：1 个 parser 函数（原需 N 个 provider 各写一份） |

## 风险与注意事项

### 1. 模型可能输出文本而不调用 final tool

这是主要风险。宿主必须有 fallback 策略：

- 没有 final tool call 不算成功
- 根据 fallbackPolicy 决定是否尝试从文本中提取结果

### 2. 不应把 tool 设计成泛化的"标准输出"

建议把它定位为"最终结构化提交协议"，而不是模糊的 stdout 抽象。

### 3. 通用化不应牺牲类型约束

不要设计成 `emit_output(any)`。

应当统一提交机制，但通过 `result_type + schema registry` 保留任务级类型约束。

### 4. 模型自行纠错的次数

虽然不需要宿主编排重试，但 LLM 的自行重试也不是无限的。如果模型连续多次校验失败，宿主应设定一个观测上限（如连续 3 次校验失败后走 fallback），避免消耗过多 token。

## 后续设计展开方向

在本概要方案基础上，下一步可以继续细化：

1. `ToolCallingProvider` 接口详细设计（阶段 2 的关键前置）
2. 宿主运行时状态设计（tool call 上下文管理）
3. fallback 策略详细设计（归一化逻辑收敛方案）
4. 与现有 `delegation-evaluator` 的文件级改动方案
5. 观测埋点的技术实现
