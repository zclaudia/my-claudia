# Supervisor Meta Workflow

## 概述

**Meta Workflow** 是 MyClaudia Supervisor 下的第二种运行模式，与现有的 **Classic Change**（即 `supervisor-spec-driven-workflow-v1` 描述的规范驱动工作流）**并列**。两者在产品上共享 Supervisor 的导航入口与项目绑定，在技术上保持**完全独立的数据模型、状态机与运行时**。

Meta Workflow 的核心价值是**元编程能力**：
- 把 "用户需求 → 阶段图 → 每阶段的执行实体" 自动展开
- 每个阶段**动态生成**一个可复用的 workflow 或 subagent，由引擎驱动执行
- 阶段间可重入、可并行、有机械验证 gate
- 生成的执行实体进入**复用池**，未来类似阶段命中即可沿用

它不替换 Classic Change，不演进现有的 SupervisionTask 内核，**只在 Supervisor 旁边开一个新模式**。

---

## 与现有体系的关系

```
┌──────────────────────────────────────────────────┐
│  Supervisor (UI 入口、项目绑定、Worktree、Baseline) │
│                                                  │
│  ┌──────────────────┐   ┌──────────────────────┐ │
│  │ Classic Change   │   │ Meta Workflow Run    │ │
│  │ (v1 模式，原状)   │   │ (本文档新增)         │ │
│  └──────────────────┘   └──────────────────────┘ │
└──────────────────────────────────────────────────┘
             │                   │
             └─────共享底层──────┘
                  │
   ┌──────────────┴──────────────┐
   │ Workflow Runtime / Generator │
   │ Worktree Manager / Conversation│
   └─────────────────────────────┘
```

| 层 | Classic Change | Meta Workflow Run | 关系 |
|---|---|---|---|
| 用户导航入口 | Supervisor 主页 → "新建 ▾ → Classic Change" | Supervisor 主页 → "新建 ▾ → Meta Workflow Run" | **共享** |
| 项目绑定 | `ProjectAgent` | `ProjectAgent`（同一个） | **共享** |
| 数据模型 | `ProjectChange` / `SupervisionTask` / `ChangeExecutionPlan` | `MetaWorkflowRun` / `MetaWorkflowPhase` / `MetaWorkflowArtifact`（全新表） | **独立** |
| 状态机 | Change 11 status / Task 13 status | Run / Phase 自己的状态机 | **独立** |
| 执行内核 | `TaskExecution.startTask()` → LLM virtual run | `MetaPhaseExecutor` → 动态生成子 workflow/subagent → 跑 → 验收 | **独立** |
| 三道 Gate | DesignGate / ExecutionGate / AcceptanceGate | 元 workflow 自己的 approve/reject/challenge 节点 | **独立** |
| UI 卡片 / 详情 | TaskBoard / TaskCard / TaskDetail | MetaRunBoard / PhaseCard / PhaseDetail（新组件） | **独立** |
| Workflow Runtime | 复用 | 复用 | **共享** |
| Workflow Generator | 不使用 | 程序化触发，是核心 | **共享底层、用法不同** |
| Worktree Manager / Pool | 复用 | 复用 | **共享** |
| Baseline / Checkpoint | 使用 | 暂不使用（OQ 留待评估） | 暂时独立 |

**项目内共存策略**：同一个 ProjectAgent 下可以同时存在 N 个 Classic Change + M 个 Meta Workflow Run，两者互不感知、互不干扰。Worktree 抢占由 Worktree Pool 统一仲裁。

---

## 产品愿景：元 Workflow 编排能力

### 一句话定位

**Meta Workflow 是一个"能为你的复杂任务动态生成并复用 workflow / subagent 的元编排能力"**。用户从"我有一个模糊的需求"出发，Meta Workflow 引导走完"需求分析 → 任务拆分 → 阶段执行 → 验收完成"全流程，每个阶段背后是一个**动态生成且可复用**的执行实体。

### 4 个核心能力

1. **动态生成**：阶段拆分后，每个阶段对应一个 workflow（DAG）或 subagent（prompt+工具集）被动态生成。生成由引擎程序化触发，不需要用户手写。

2. **复用沉淀**：生成的执行实体进入复用池。下一个需求中遇到类似阶段，**先在复用池里语义搜索命中**才考虑生成。命中的可以一键沿用；用户也可把任意一次生成的实体"提升"为正式模板（去除 `auto-generated` tag，进入主工具列表）。

3. **可重入分阶段**：阶段不必严格串行——可以先跑通最小骨架路径（smoke path），验证元 workflow 整体逻辑正确，再 fan-out 其他阶段；任一阶段失败 / 上游变更，单独重入，下游 lazy 标记 stale。

4. **机器验证**：每个阶段的"完成"由 shell 命令 + 期望结果（exitCode/stdout/file 等）裁决，LLM 自评只能作为 advisory。这是用引擎层强制约束取代 LLM 自觉的关键纪律。

### 与 Classic Change 的产品区别

| 维度 | Classic Change | Meta Workflow Run |
|------|---------------|-------------------|
| 适合任务规模 | 中等（一次会话能 hold 住） | 超大（多天 / 多周 / 多阶段并行） |
| 拆分纪律 | 用户写 design.md，Supervisor 跑 Task | 引擎自动从需求 → 阶段图，每阶段生成 workflow |
| 验收方式 | LLM review + 人类 approve | 机械 gate + LLM advisory |
| 复用 | Change 写完即结束 | 每个阶段的 workflow / subagent 进入复用池 |
| 重入 | 整个 Change 重跑 | 阶段独立重入，下游 lazy stale |
| 用户介入点 | Design Gate / Execution Gate / Acceptance Gate | 需求 approve / 阶段图调整 / 阶段 done 多选项 |

---

## 用户旅程

### 入口

用户从 Supervisor 主页面进入。"新建" 按钮变成下拉菜单：

```
[ + 新建 ▾ ]
   ├─ Classic Change
   └─ Meta Workflow Run
```

选 Meta Workflow Run → 进入元 workflow 5 阶段流程。

### 5 阶段大致体验

1. **需求分析屏**：与 Meta Workflow 对话式 brainstorm，AI 整理产出 `design/requirements.md`，用户 approve/reject/challenge
2. **任务拆分屏**：AI 读 requirements.md 产出 `phases.json` 阶段图，用户可拖拽/编辑阶段卡片
3. **执行总览屏**：阶段卡片网格，每张卡片显示状态（pending / generating / running / verifying / done / failed / stale）；用户可点任意一个"先跑这个"，或按 smoke path 一键跑骨架
4. **阶段详情屏**：单击卡片下钻，看子 workflow run 详情、产物、acceptanceGates 结果、AI review notes
5. **完成屏**：所有阶段 done 且无 stale → Meta Workflow Run 完成，用户决定整体合并到主分支 / 留 PR / 归档 worktree

每阶段 done 后给用户**多个 finish option**：进入下游 / 留 stale / 提升此阶段生成的 workflow 为复用模板 / 丢弃。

---

## 工作流 5 阶段

### 阶段 1：需求分析

**目标**：把模糊需求落到一份机器可读的 `design/requirements.md`。

**形态**：对话型 sub-workflow（独立可复用）。

**流程**：

```
用户对话输入 → AI 整理为 requirements.md 草稿 → 用户操作：approve / reject / challenge
  ↑                                                      │
  └────────── (reject / challenge 修改后再生草稿) ───────┘
```

**约束**：
- reject 累计达到可配置上限（建议默认 5 次，作为 `MetaWorkflowConfig` 字段）时弹"升级人工"通道——用户直接编辑 requirements.md 提交
- **任何下游阶段都能触发"回到需求分析"**：发现需求漏了 → 元 workflow run 重新评估阶段图（用户决定哪些阶段保留、哪些重做）

**产物**：`design/requirements.md`（人类可读 + 结构化 metadata）

### 阶段 2：任务拆分

**目标**：把 requirements.md 拆成阶段图，每阶段含 `phaseType / inputs / outputs / acceptanceGates / executeConfig`。

**形态**：单次 AI step（不是对话）。

**流程**：

```
读 requirements.md + 项目 baseline → AI 生成 phases.json → schema 校验
  ├─ 校验失败 → 重试 N 次 → 升级人工
  └─ 校验通过 → 写入 MetaWorkflowRun.phasesJson → UI 阶段图 → 用户可编辑
                                                                  │
                                                          用户 approve → 进入执行
```

**Schema 校验规则**（强制）：
1. JSON 合法 + zod/typebox schema 匹配
2. 所有 `dependsOn` 指向已存在的 `id`
3. DAG 无环
4. `smokePath` 是 DAG 的合法路径
5. 至少有一个 root 节点（`dependsOn=[]`）
6. 每个 `acceptanceGate.command` 非空字符串
7. `phaseType` 在 6 类 enum 内

**产物**：`phasesJson`（持久化到 `MetaWorkflowRun.phasesJson`，同时 mirror 到 `design/phases.json` 文件方便人查看）

### 阶段 3：阶段执行

**目标**：为每个 phase 实例化 `MetaWorkflowPhase` 记录、动态生成执行实体、跑、验收。

**形态**：每个 phase 一个独立的执行单元。

**单 phase 生命周期**：

```
pending
  ↓ (上游全 done / 用户点"开始")
searching_reuse                   ← Superpowers R4：先搜复用池
  ├─ 命中 → 用户确认沿用 → 跳到 ready_to_run（用现有 workflow/subagent id）
  └─ 未命中 → generating
generating                        ← 按 phaseType 模板生成 workflow 或 subagent
  ↓ (生成 + schema 校验通过)
ready_to_run
  ↓ (元 workflow run 调度，acquire worktree)
running                           ← workflow engine / subagent runner 驱动
  ↓ (执行完毕)
verifying_gates                   ← 跑 phase.acceptanceGates[]
  ├─ 全部通过 → commit → done
  └─ 任一失败 → failed → 走重试 / 升级
done | failed | stale
```

**重要：动态生成的实体形态**：

每个 phase 的执行实体是 workflow 还是 subagent，由 phaseType 默认 + phase 显式覆盖决定：

| phaseType | 默认实体 |
|-----------|---------|
| `code-implement` | workflow (DAG + self-healing loop) |
| `code-refactor` | workflow (DAG + self-healing loop) |
| `code-test-write` | workflow (DAG multi-step) |
| `design-doc` | workflow (DAG single-shot) |
| `dep-update` | workflow (DAG + self-healing loop) |
| `investigation` | **subagent** (prompt + 工具集，自主探索) |

`PhaseDef.executeEntity?: 'workflow' | 'subagent'` 字段允许显式覆盖。

详细的 workflow Skeleton + Slot、subagent 形态、模板见 §核心抽象详解。

### 阶段 4：重入 / 失败处理

详见 §核心抽象详解 §6 Stale 传播。

### 阶段 5：完成判定

**条件**：所有 phase status=done 且无 stale 标记 → MetaWorkflowRun status=completed。

**用户在 done 后的多选项**（呼应 Superpowers R6）：
- **进入下游**：默认行为
- **留 stale 等下次**：标记当前阶段 stale，不影响 run 完成
- **提升为正式模板**：把本阶段生成的 workflow/subagent 提升到主工具列表
- **丢弃**：归档这一阶段产物，但不影响整体完成

整体 run 完成后，用户决定：
- 合并所有 phase 的产物到 main 分支
- 留 PR 等 review
- 归档 worktree 仅保留 artifact 索引

---

## 核心抽象详解

### §1 元 Workflow 编排模型

#### 生成 vs 复用决策流程

```
对于每个 phase:
  1. 用 phase 的 (phaseType + description + inputs + outputs) 在复用池语义搜索
  2. 若有候选:
     - 显示给用户："找到 N 个相似的可复用项 [...]，要复用吗？"
     - 用户选"复用 #X" → 用现有 entity id
     - 用户选"新生成" → 进入生成流程
  3. 若无候选:
     - 直接进入生成流程
```

#### 复用池的写入规则

- 每次生成的 workflow / subagent 自动入池，默认 tag `auto-generated:run-{runId}:phase-{phaseId}`
- **不进入用户主工具列表**（避免污染）
- 用户在阶段完成后主动"提升"才会进入主列表（tag 去除、sourceType 从 `auto` 变 `user`）
- Meta Workflow Run 完成后，未被提升的 auto-generated 默认 archive，30 天后自动清理

#### 复用池的查询机制（v1 → 未来演进）

| 阶段 | 策略 |
|------|------|
| v1（首版） | tag 过滤（phaseType + 关键词）+ 描述模糊匹配 |
| v2（未来） | 加嵌入向量语义搜索 |

### §2 子 Workflow Skeleton + Slot

当 phase 的 `executeEntity = 'workflow'` 时，引擎生成的子 workflow 必须包含 5 个骨架节点，顺序固定：

| 节点 | 类型 | 作用 |
|------|------|------|
| `context_load` | `ai_prompt` | 读上游产物（commit / file）+ phase 定义；产出整理好的 context 摘要 |
| `plan` | `ai_prompt` | 写本阶段执行计划到 `plan.md`；默认开启，按 phaseType 推断（复杂阶段强制） |
| `execute` | 取决于 pattern | 核心执行槽，按 pattern 填充 |
| `verify` | 组合 | 跑机械 `acceptanceGates` + ai_review（advisory） |
| `commit` | `git_commit` | 全部 gate 通过后提交，附产物索引 |

骨架不可绕过：引擎在收到生成的 workflow 后强制校验 5 节点存在、顺序正确、边连接合法，校验失败 → 拒绝注册，重新生成。

#### Execute slot 的 3 种 pattern

| Pattern | 适用 | 何时默认 |
|---------|------|---------|
| `single-shot` | 简单阶段（一个明确 bug、加单字段） | code-implement 复杂度=small |
| `multi-step` | 中等复杂度，多 ai_prompt 串联不走 loop | code-test-write |
| `self-healing` | "写 → 验证 → 失败修复 → 再验证" loop | code-implement (default) / code-refactor / dep-update |

self-healing loop 复用 Workflow runtime 已有的 `loop` / `loop_exhausted` 边类型（`shared/src/features/workflows.ts`），最大迭代次数由 `executeConfig.maxLoopIterations` 控制（默认 5）。

#### 两层 verify 的关系（避免歧义）

- **Loop 内部的 verify**（self-healing 内圈）：是 LLM 自我纠错的反馈通道；目的是触发 fix 循环
- **Phase 级 acceptanceGates**（外层 verify slot）：在 execute 节点完成后由引擎执行；**这才是阶段成功与否的唯一裁决**

Loop 跑 N 次仍未通过 → workflow 沿 `loop_exhausted` 边到外层 verify slot → 跑 acceptanceGates → 仍失败 → markFailed。即"loop 内的 verify 是内部反馈，loop 外的 acceptanceGates 是最终判决"。

### §3 Subagent 的形态与边界

当 phase 的 `executeEntity = 'subagent'` 时，引擎生成的是一个**独立 conversation context + 受限工具集 + 终止条件**的 subagent。

**Subagent 结构**：

```typescript
interface MetaSubagent {
  id: string;
  systemPrompt: string;                 // 含 phase context + 任务边界 + 终止条件
  allowedTools: string[];               // 受限工具集（如只允许 Read/Grep/WebSearch，不允许 Edit）
  maxTurns: number;                     // 防失控
  terminationCondition: {
    kind: 'output-file' | 'output-keyword';
    target: string;                     // 要产出的文件路径 or 终止关键词
  };
  inputs: PhaseInput[];                 // 与 workflow 共用 schema
  outputs: PhaseOutput[];
  acceptanceGates: AcceptanceGate[];    // 仍然机械验证
}
```

**Subagent 与 Workflow 的运行时差异**：

| 维度 | Workflow | Subagent |
|------|---------|----------|
| 中间状态可观察 | ✅ 每节点 input/output 落库 | ❌ 一个长 conversation |
| 中途介入 | ✅ 可暂停、跳节点、强制 retry | ❌ 只能 kill |
| 表达力 | 受限于 step types | ✅ 任意工具 / 任意路径 |
| 复用价值 | 高（结构化模板） | 中（prompt + 工具集） |
| 调试 | ✅ 节点级 trace | ⚠️ 需要看完整 conversation log |

**为什么 investigation 默认走 subagent**：调研型任务的中间步骤难预设（要 grep 什么、要 read 哪些文件，按发现动态决定），强行 DAG 化反而绑手脚。但**最终产出仍由机械 acceptanceGates 验证**（"必须产出 `investigation-report.md`"），所以表达力放开不等于失控。

**Subagent 也进复用池**：subagent 的 systemPrompt + allowedTools + terminationCondition 构成一个可复用的"调研模板"。下次类似调研可命中沿用。

### §4 6 类 phaseType 模板

| phaseType | 适用场景 | 默认 executeEntity | 默认 pattern | 默认 plan | verify 重点 |
|-----------|---------|-----------------|------------|---------|---------|
| `code-implement` | 实现新功能 / 接口 / 类 | workflow | self-healing | 开 | compile + 新测试 + 全量不回归 |
| `code-refactor` | 行为不变的重构 | workflow | self-healing | 开 | **全量测试结果保持** + diff 范围合理 |
| `code-test-write` | 单独写测试（实现已存在） | workflow | multi-step | 关 | 新测试 pass + 覆盖率 ≥ 阈值 |
| `design-doc` | 设计文档 / API 规范 | workflow | single-shot | 关 | 文档存在且非空 + schema 校验 + 用户 approve |
| `dep-update` | 依赖升级 / 构建脚本变更 | workflow | self-healing | 开 | build pass + 全量测试 pass + 无新安全告警 |
| `investigation` | 调研 / 性能分析（无代码产出） | **subagent** | — | — | 用户 approve 结论 + 产出报告文档 |

每个 phaseType 在代码内置一份模板：`server/src/domains/meta-workflow/phase-templates/<type>.ts`，含默认 prompt 框架、默认 acceptanceGates 模板、默认 executeConfig。

### §5 phases.json schema

```typescript
interface PhasesDoc {
  version: '1';
  phases: PhaseDef[];
  smokePath: string[];            // 阶段 id 列表，按顺序构成"先跑通骨架"路径
  metadata: {
    generatedAt: number;
    requirementsPath: string;
  };
}

interface PhaseDef {
  id: string;
  name: string;
  description: string;            // 1-3 句话，给生成器用

  phaseType:
    | 'code-implement'
    | 'code-refactor'
    | 'code-test-write'
    | 'design-doc'
    | 'dep-update'
    | 'investigation';

  executeEntity?: 'workflow' | 'subagent';   // 默认按 phaseType 推断

  dependsOn: string[];

  inputs: PhaseInput[];
  outputs: PhaseOutput[];
  acceptanceGates: AcceptanceGate[];

  executeConfig?: {
    pattern?: 'single-shot' | 'multi-step' | 'self-healing';
    planRequired?: boolean;
    aiReviewBlocking?: boolean;
    maxLoopIterations?: number;
    maxSubagentTurns?: number;
  };

  // Provider 三层级 fallback 的中间层（详见 §6.7）
  synthesizerProviderId?: string;   // 生成时用的 provider
  runtimeProviderId?: string;       // 执行时的默认 provider

  worktreeStrategy?: 'isolated' | 'shared';
  estimatedComplexity?: 'small' | 'medium' | 'large';
}

interface PhaseInput {
  kind: 'commit' | 'file';
  source: string;
  description?: string;
}

interface PhaseOutput {
  kind: 'commit' | 'file';
  path?: string;
  description: string;
}

interface AcceptanceGate {
  id: string;
  description: string;
  command: string;                // shell 命令
  cwd?: string;
  expect: {
    exitCode?: number;
    stdoutMatches?: string;
    stderrMatches?: string;
    fileExists?: string[];
    fileNotExists?: string[];
    durationMaxMs?: number;
  };
}
```

#### 设计选择说明

- **`acceptanceGates.command` 是 shell 命令，不是结构化断言**：代码项目的验证手段就是 mvn / npm / pytest / lint 等命令行工具的产物，结构化断言每加一种栈都要写 adapter 反而绕路。LLM 写 shell 比挑 enum 稳。
- **`inputs/outputs` 只有 `commit | file` 两种 kind**：代码项目里文件路径就是契约，强行抽象命名是过度设计。未来真碰到非文件产物再加 `named` kind 向后兼容。
- **`smokePath` 是显式字段**：smoke path 是设计意图不是图论结论，必须显式列出。
- **`phaseType` 是强 enum**：强制 LLM 在生成时明确分类。
- **`executeEntity` 可显式覆盖**：让用户对"这个阶段应该用 workflow 还是 subagent"有最终话语权。

### §6 Stale 传播（Lazy + Soft）

**Lazy**：A→B→C，A 重跑后只让直接下游 B 标 stale；B 被处理（重跑或 ignore）后再决定 C 是否标 stale。

**Soft**：stale 不阻塞用户继续操作，仅显示 UI 警告（▲ 角标）。

#### 不同状态下游的处理

| 下游状态 | 处理 |
|---------|------|
| `done` | 标 stale，保留产物（git commit 不删），不动 |
| `running` (workflow 中) | **不立即 abort**，让它跑完；跑完后立刻标 stale |
| `generating` | 立即 abort，回到 pending |
| `pending` | 不需要标 stale，下次开始时自然读到新上游产物 |

#### 用户操作（Superpowers R6 多 option）

- **Re-run**：重跑该阶段
- **Ignore stale**：移除 stale 标记，状态恢复 done
- **Evaluate impact**：跑 AI 差分分析（对比上游新旧 commit），输出建议（rerun / ignore / 小改）——**建议不决策**
- **Cascade re-run**：把自己和所有下游一次性重跑

#### 边缘情况

- 上游重跑后产物完全一样（commit SHA 一致）→ 自动消除 stale 标记
- 用户重跑了 stale 阶段但产物未变 → 自动把更下游的 stale 也清掉

#### 产物保留与版本化

- stale 阶段的产物保留（git commit 留着）
- 重跑时新产物落到新 commit，旧 commit 仍可查
- `MetaWorkflowArtifact` 表加版本字段：`{ phaseId, version, commitSha, status: 'active' | 'stale', createdAt }`

### §7 Provider 选择策略

Meta Workflow 多个环节都涉及 AI 调用，统一采用 MyClaudia 现有的 **provider 三层级 fallback** 模型，与 `OrchestratorTask.providerId` / `ai_prompt step.providerId` 一致。

#### 三层级 fallback

```
Run-level default provider       (新建 Meta Workflow Run 时用户选)
  ↓ 不指定就回退
Phase-level provider             (phases.json 里 phase 字段)
  ↓ 不指定就回退
Node-level provider              (子 workflow 节点 / subagent definition 内部字段)
```

下层未指定即沿用上层；任意层都可显式指定。

#### 生成 vs 执行分离

每个 phase 有**两个独立 provider 字段**：

```typescript
interface PhaseDef {
  // ... 现有字段
  synthesizerProviderId?: string;   // 生成本阶段执行实体（workflow/subagent）时用的 provider
  runtimeProviderId?: string;       // 实体真正跑起来时的默认 provider（被节点级覆盖）
}
```

设计理由：**生成是一次性高价值动作，执行是重复发生**。常见配置：用 Opus 生成高质量 workflow definition，用 Sonnet 性价比跑里面每个 ai_prompt 节点。

#### 所有 AI 出现点的 provider 来源

| 出现点 | provider 来源 |
|--------|--------------|
| 需求分析对话（阶段 1） | Run-level default |
| 任务拆分 AI step（阶段 2） | Run-level default |
| 子 workflow / subagent 生成 | `Phase.synthesizerProviderId` → Run-level default |
| 子 workflow 节点 `context_load` / `plan` / `execute` 等 ai_prompt | 节点级 → `Phase.runtimeProviderId` → Run-level default |
| Verify slot 的 `ai_review` advisory | 节点级（默认沿用 `Phase.runtimeProviderId`） |
| Subagent 跑起来 | `Phase.runtimeProviderId` → Run-level default |
| Stale 的 "Evaluate impact" 差分分析 | Run-level default |
| 复用池 v2 embedding 语义搜索 | **独立 embedding provider 配置**（不归 Run-level） |

#### UI 决策点

- **新建 Meta Workflow Run 屏**：一个 provider 选择器（默认沿用项目级 / 全局默认）
- **阶段图编辑**：每个 phase 卡片高级折叠区可改 `synthesizer / runtime provider`
- **子 workflow 详情屏**：节点级可见每个 ai_prompt 用的 provider；v1 是否允许编辑覆盖见 Open Question

#### 复用池里 entity 的 provider 偏好

当一个 phase 命中复用池 → **沿用 entity 内的 provider 配置作为默认**；用户仍可在 phase 级显式覆盖。entity 的 provider 偏好不是硬约束。

理由：被提升为模板的 entity 通常带有它"原始作者"调过的 provider 偏好（如某个 refactor 模板用 Opus 命中率更高），沿用是合理的默认；但用户依旧有最终话语权。

#### 数据模型扩展

```sql
meta_workflow_runs   ADD COLUMN default_provider_id TEXT;
meta_workflow_phases ADD COLUMN synthesizer_provider_id TEXT;  -- 覆盖 run-level，用于生成
meta_workflow_phases ADD COLUMN runtime_provider_id     TEXT;  -- 覆盖 run-level，用于执行
```

`meta_subagent_templates` 和生成的 workflow definition 内部节点已有 provider 字段，无需新加。

---

## 复用池与生成机制（一等公民）

### 复用池中的对象

```typescript
interface ReusablePoolItem {
  id: string;
  kind: 'workflow' | 'subagent';
  entityId: string;                    // 对应 workflow definition id 或 subagent template id
  phaseType: PhaseDef['phaseType'];
  description: string;                 // 提示词级别的描述
  tags: string[];                      // ['auto-generated', `run-${runId}`, `phase-${phaseId}`, 'user' (if promoted)]
  sourceType: 'auto' | 'user';         // 'auto' = 引擎生成；'user' = 用户提升
  metadata: {
    generatedFromPhaseId?: string;
    originalRunId?: string;
    promotedAt?: number;
    usageCount: number;                // 累计被复用次数
    successRate?: number;              // 历史成功率（达 gate 比例）
  };
  createdAt: number;
}
```

### 查询入口

阶段进入 `searching_reuse` 状态时调用：

```typescript
function searchReusePool(phase: PhaseDef): ReusablePoolItem[] {
  // v1 策略：tag 过滤 + 描述关键词匹配
  // 1. 过滤 kind 与 executeEntity 匹配
  // 2. 过滤 phaseType 匹配
  // 3. 关键词匹配（description vs phase.description tokenization 后 BM25 排序）
  // 4. 取 top 5 返回
  // 未来 v2：嵌入向量语义搜索
}
```

返回结果 UI 展示：

```
为本阶段（impl-user-service）找到 3 个可复用项：

  [1] auto / "Implement service layer with self-healing loop"
      来源：MetaRun #142 / phase-3 / 30 天前 / 成功率 80%
  [2] user / "JPA Repository Implementation Template"
      来源：用户提升模板 / 累计复用 12 次

  [复用 #1]  [复用 #2]  [新生成]
```

### 提升流程

阶段完成后，用户在 PhaseCard 上可点 "提升为复用模板"：

```
auto-generated 子 workflow / subagent
  ↓ (用户点击提升)
1. 弹"提升对话框"：填名字、描述、tags
2. 用户可编辑 prompt / acceptanceGates 等（不强制）
3. 确认提升
  ↓
sourceType: auto → user
tags: 移除 `auto-generated`、`run-*`、`phase-*`
出现在主工具列表
```

### 清理策略

Meta Workflow Run 完成 30 天后，所有未提升的 `auto-generated` 实体自动 archive；archive 后 60 天物理删除。

---

## 数据模型（全新表）

### 核心表

```sql
-- 元 workflow 运行实例（与 ProjectChange 平级）
CREATE TABLE meta_workflow_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,           -- 绑定 ProjectAgent
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,                -- requirement_draft | requirement_review | splitting | executing | reviewing | completed | cancelled
  requirements_path TEXT,              -- design/requirements.md 相对路径
  phases_json TEXT,                    -- 序列化后的 PhasesDoc
  smoke_path_run_id TEXT,              -- smoke path 跑通后存这里
  reject_count INTEGER DEFAULT 0,      -- requirement 阶段累计 reject 次数
  default_provider_id TEXT,            -- Run-level 默认 provider，是 §6.7 三层级 fallback 的顶层
  config TEXT,                         -- MetaWorkflowConfig JSON
  worktree_id TEXT,                    -- 顶层 worktree（可能不用，每个 phase 有自己的）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- 元 workflow 的阶段（与 SupervisionTask 平级）
CREATE TABLE meta_workflow_phases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES meta_workflow_runs(id),
  phase_id TEXT NOT NULL,              -- 来自 phases.json 的 id
  phase_type TEXT NOT NULL,
  status TEXT NOT NULL,                -- pending | searching_reuse | generating | ready_to_run | running | verifying_gates | done | failed | stale
  execute_entity TEXT NOT NULL,        -- 'workflow' | 'subagent'
  reused_from_pool_id TEXT,            -- 若复用则记录
  generated_workflow_id TEXT,          -- 若生成 workflow
  generated_subagent_id TEXT,          -- 若生成 subagent
  current_run_id TEXT,                 -- 当前 attempt 的子 workflow run id
  worktree_path TEXT,
  stale_since INTEGER,
  stale_source_phase_id TEXT,
  attempt INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  inputs_snapshot TEXT,                -- 实例化时复制的 inputs
  outputs_snapshot TEXT,
  gates_snapshot TEXT,
  execute_config_snapshot TEXT,
  synthesizer_provider_id TEXT,        -- 覆盖 run-level，用于生成（§6.7）
  runtime_provider_id TEXT,            -- 覆盖 run-level，用于执行（§6.7）
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  UNIQUE(run_id, phase_id)
);

-- 元 workflow 产物索引（含版本）
CREATE TABLE meta_workflow_artifacts (
  id TEXT PRIMARY KEY,
  phase_record_id TEXT NOT NULL REFERENCES meta_workflow_phases(id),
  version INTEGER NOT NULL,            -- 同一 phase 重跑 version+1
  commit_sha TEXT,                     -- 主要产物（commit 维度）
  artifact_files TEXT,                 -- JSON: [{ kind, path }]
  gate_results TEXT,                   -- JSON: [{ gateId, passed, stdout, stderr, exitCode }]
  ai_review_notes_path TEXT,
  status TEXT NOT NULL,                -- active | stale | archived
  created_at INTEGER NOT NULL
);

-- 复用池（workflow 和 subagent 共用）
CREATE TABLE meta_workflow_reuse_pool (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                  -- 'workflow' | 'subagent'
  entity_id TEXT NOT NULL,             -- workflow id or subagent id
  phase_type TEXT NOT NULL,
  description TEXT,
  tags TEXT,                           -- JSON array
  source_type TEXT NOT NULL,           -- 'auto' | 'user'
  metadata TEXT,                       -- JSON: { generatedFromPhaseId, originalRunId, promotedAt, usageCount, successRate }
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

-- subagent 模板（与 workflow definition 平级的另一种执行实体）
CREATE TABLE meta_subagent_templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  system_prompt TEXT NOT NULL,
  allowed_tools TEXT NOT NULL,         -- JSON array
  max_turns INTEGER DEFAULT 30,
  termination_condition TEXT NOT NULL, -- JSON
  source_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 与 Supervision 表的关系

完全不动 `project_changes` / `supervision_tasks` / `change_execution_plans` 等表。Meta Workflow 只引用 `project_agents.id`（项目层级），不引用 Change/Task 等 Classic 模式特有表。

---

## 与底层基础设施的关系（共享什么）

| 基础设施 | Meta Workflow 使用方式 |
|---------|---------------------|
| **Workflow Runtime**（engine / executors / step types） | 直接驱动，跑生成的子 workflow |
| **Workflow Generator**（`generator.ts`） | 程序化调用：传入 phase 定义 + 模板 → 生成 WorkflowDefinition |
| **Worktree Manager / Pool** | 每个 phase acquire 一个 worktree，与 Classic Change 共用同一个池（公平调度） |
| **Conversation / Session** | subagent 跑在独立 conversation context 里 |
| **`ai_prompt` step type** | 子 workflow 节点的核心 step |
| **`shell` step type** | acceptanceGates 执行依赖 |
| **`condition` / `loop` 边** | self-healing loop 实现依赖 |
| **`git_commit` step type** | commit 节点依赖 |

**没复用的**（这是与"演进 Supervision"的边界）：
- ❌ TaskExecution / TaskScheduler / TaskAggregate / task-prompt
- ❌ ChangeExecutionPlan / ProjectChange 生命周期
- ❌ DesignGate / ExecutionGate / AcceptanceGate（Meta Workflow 用自己的 approve/reject/challenge 节点）
- ❌ ReviewEngine（Meta Workflow 的 verify 是 acceptanceGates + advisory AI review，结构完全不同）

---

## Superpowers 借鉴整合

| ID | 借鉴点 | 在 Meta Workflow 中的落点 |
|----|--------|---------------------|
| **R1** | 阶段卡片强制 checklist | PhaseDetail UI 自动从子 workflow 5 骨架节点生成 todo 清单；后端不允许跳骨架节点 |
| **R2** | 验证必须是命令 + 期望，不接受 LLM 自评 | `AcceptanceGate.command` 必填；引擎跑命令 → 比对 expect；不过不进 commit |
| **R3** | 每阶段独立 conversation context | 每个 phase 一个独立 conversation；元 run 主轨只存高层决策与产物索引 |
| **R4** | 生成前先语义搜索复用池 | `searching_reuse` 状态在 `generating` 前；命中提示用户复用 |
| **R5** | "Challenge" 按钮 | 需求 approve 阶段、阶段完成 review 都有 Challenge 操作，强制 LLM 用证据回应；最大 challenge 次数后允许直接 approve 或 escape 到人工编辑 |
| **R6** | done 后给多 option | PhaseDone 时显示：进入下游 / 留 stale / 提升为模板 / 丢弃；RunComplete 时显示：合并到主分支 / 留 PR / 归档 worktree |

**关键**：这些"纪律"不是文档建议，是**引擎层的状态机硬约束**。例如 R2：跳过 acceptanceGates 的方式在状态机里根本不存在，不需要 LLM 自觉。

---

## 实施路线（粗）

不写细致里程碑（留给 writing-plans 阶段）。

### Phase A：基础设施 + 数据模型

1. 新建 5 张表（`meta_workflow_runs` / `meta_workflow_phases` / `meta_workflow_artifacts` / `meta_workflow_reuse_pool` / `meta_subagent_templates`）
2. 共享类型定义（`shared/src/features/meta-workflow.ts`）
3. 6 phaseType 模板代码内置

### Phase B：核心 domain

1. `server/src/domains/meta-workflow/` 目录
2. `MetaWorkflowRunAggregate` / `MetaWorkflowPhaseAggregate` 状态机
3. `phase-templates/` 6 类模板
4. `workflow-synthesizer.ts`（基于现有 `WorkflowGeneratorService`）
5. `subagent-synthesizer.ts`
6. `phases-json-validator.ts`
7. `MetaPhaseExecutor`：驱动 workflow / subagent 跑 + 跑 acceptanceGates

### Phase C：复用池

1. `reuse-pool-repository.ts`
2. `reuse-pool-search.ts`（v1 tag + 关键词，留 v2 嵌入接口）
3. 提升流程（API + UI）

### Phase D：Stale 传播

1. `stale-propagator.ts`
2. 4 个用户操作（Re-run / Ignore / Evaluate / Cascade）
3. Artifact 版本化

### Phase E：UI（apps/desktop/src/features/meta-workflow/）

1. "新建 ▾" 下拉菜单（在 Supervisor 现有 UI 上）
2. RequirementsScreen（对话型）
3. PhaseGraphScreen（阶段图可视化 + 编辑）
4. PhaseBoardScreen（阶段卡片网格 + 整体进度）
5. PhaseDetailScreen（子 workflow run / subagent 进度下钻）
6. PromotionDialog（提升复用模板）

### Phase F：端到端验证

1. 在一个真实 Java / TS 小项目上跑通完整 5 阶段
2. 验证 smoke-first 流程：先跑骨架最小路径再 fan-out
3. 验证 stale 传播：手动重跑上游，看下游行为
4. 验证复用：跑两个相似 run，看第二次是否成功复用

每个 Phase 完成时跑端到端 smoke test，独立 PR。

---

## Open Questions

| # | 问题 | 当前默认 |
|---|------|---------|
| OQ1 | Baseline 是否要在 Meta Workflow 里发挥作用？（Classic Change 用了 baseline 做基线对比，Meta Workflow 暂时不用） | 暂时不用。phaseType=investigation 的报告里可以参考 baseline 内容，但不强依赖 |
| OQ2 | Meta Workflow Run 和 Classic Change 之间是否允许引用？（如某个 Classic Change 里"调起一个 Meta Workflow Run 来做这件事"） | 暂不支持，留作 future。两者完全独立 |
| OQ3 | Subagent 的 allowedTools 边界谁来定？（生成器自己挑 / phaseType 模板固定 / 用户编辑） | 模板固定 + 用户可编辑（提升时） |
| OQ4 | Conversation context 隔离的具体实现：每 phase 一个新 session id？还是同 session 不同 thread？ | 每 phase 一个独立 session id（简单） |
| OQ5 | 阶段间并行：默认 conservative_parallel（独立 worktree 真并行，并发上限）；上限谁定？ | `MetaWorkflowConfig.maxParallelPhases` 字段，默认 3，可配置 |
| OQ6 | 复用池语义匹配的 v2 嵌入向量方案具体用哪个 embedding 模型？本地还是 API？ | implementation 阶段确定 |
| OQ7 | TaskScheduler 风格的"统一调度器"是否需要？还是 Meta Workflow 自己 tick？ | 自己 tick（避免与 Classic 任务争资源） |
| OQ8 | 中途回到需求分析后，已 done 的阶段如何处理？全部 stale？让用户挑哪些保留？ | 让用户挑（基于 AI 影响分析建议） |
| OQ9 | PhasesDoc 的版本化（multi-run reuse 阶段图）：同一个 Run 改了 phases.json 几次，每次都存历史吗？ | 存（用一张 `meta_workflow_phases_history` 表，简单的 JSON snapshot） |
| OQ10 | Subagent 的进度可视化：长 conversation 怎么在 UI 上看？只看最后输出？还是 stream 全部？ | stream + 收起折叠默认；用户可展开 |
| OQ11 | phaseType 模板是否要预设 provider 偏好？（如 investigation 默认 Opus、code-implement 默认 Sonnet） | v1 不预设，沿用 Run-level default 即可。模板里可作"建议"展示但不硬编码 |
| OQ12 | 节点级 provider 覆盖（每个 ai_prompt 节点单选）在 v1 是否暴露编辑器 UI？还是只读，必要时手改 phases.json？ | v1 只读 + 手改。等用户真有按节点调 provider 的需求再做编辑器 |

---

## 附录：术语表

| 术语 | 定义 |
|------|------|
| Meta Workflow Run | 一次完整的元 workflow 编排实例，与 Classic Change 平级 |
| Phase | Meta Workflow Run 下的执行单元，对应 `MetaWorkflowPhase` 表一行 |
| PhaseDef | `phases.json` 里的阶段定义（设计意图） |
| Execute Entity | Phase 的执行实体类型：`workflow` 或 `subagent` |
| Skeleton + Slot | 子 workflow 固定 5 骨架节点 + LLM 填 execute slot 的模板模式 |
| Phase Type | Phase 的功能分类，6 类 enum |
| Acceptance Gate | Phase 完成的机械验证条件：shell 命令 + expect 断言 |
| Reuse Pool | 生成的 workflow / subagent 沉淀池 |
| Smoke Path | 阶段图中"先跑通骨架最小路径"的显式标注 |
| Stale | 上游变化导致下游需要重新评估的状态标记（Lazy + Soft） |

---

*文档版本：v1 / 2026-05-18*
*作者：Claudia + zhvala*
*相关文档：`supervisor-spec-driven-workflow-v1.md`（Classic Change 模式，与本文档并列存在）*
