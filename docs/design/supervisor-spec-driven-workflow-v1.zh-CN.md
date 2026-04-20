# Supervisor 规范驱动工作流 v1

## 背景

`Supervisor` 不应该被定义成一个“更重的通用聊天模式”。

它的价值在于承接那些 **需要长期推进的项目级改动**：这类工作通常会跨越多个 session，需要明确的范围控制，也需要可持续的进度跟踪。典型场景包括：

- 大型 feature 交付
- 旧项目重构
- 架构迁移
- 分阶段推进的稳定性或性能优化

小而明确的任务，仍然应该留在普通 session 模式里完成。

这份设计借鉴了 OpenSpec 中有价值的结构，但不会直接复制它的 CLI 工作流，而是将其改造成适配 MyClaudia 现有 `project / task / session / review / checkpoint` 模型的原生能力。

## 产品定位

`Supervisor` 应被定义为一个 **规范驱动的执行工作区**，用于管理项目级 initiative。

它负责：

1. 建立可持续维护的项目基线
2. 定义本次改动的目标与设计边界
3. 将改动拆分为可执行任务
4. 在多轮 session 中监督执行过程
5. 在交付后回写并同步项目 specs

它不负责替代普通 session 处理日常编码任务。

## 目标

1. 为大型改动建立一个独立于聊天记录之外的持久真相源。
2. 在多次 session 和任务执行之间保持上下文连续性。
3. 让执行过程受明确设计范围和验收标准约束。
4. 让项目文档与实现状态长期保持同步。
5. 将 Supervisor 重构为 change-first 的规范驱动工作区，而不是继续以 task 为中心堆叠流程。

## 非目标

1. 不把所有开发工作都强制迁移到 supervisor mode。
2. 不复刻完整的 OpenSpec CLI 与命令生成体系。
3. 不要求每一次改动都写成完整正式 spec。
4. 不替代现有普通 session 的快速迭代流程。

## 产品对象模型

Supervisor v1 应该管理三个核心对象，并以 `Change` 作为主轴：

### 1. Project Baseline

用于描述“当前这个项目是什么”的长期文档基线。

包含内容：

- 业务背景与产品目标
- 当前约束条件
- 架构概览
- 关键模块及其边界
- 现有功能清单
- 术语表 / 领域语言

对于老项目，baseline 可以先由 AI 基于代码逆向生成，再由用户逐步修正。

### 2. Change

`Change` 表示 supervised project 下的一次长期 initiative。

例如：

- “增加团队账单能力”
- “把同步引擎重构成 job pipeline”
- “现代化旧版设置页并拆分状态管理”

每个 change 至少包含：

- 目标
- 动机
- 非目标
- 影响范围
- 技术设计
- 验收标准
- 任务计划
- 当前状态

### 3. Task

`Task` 是 change 下可执行的最小工作单元。

每个 task 必须具备：

- 明确 scope
- 依赖信息
- 执行上下文
- 验证方法
- 完成状态

## 为什么必须引入 Change 层

当前 supervision 模型里已经有 `ProjectAgent` 和 `SupervisionTask`，但仅靠 task 编排不足以支撑大改动。

如果没有一层明确的 `Change`：

- task 会失去“为什么存在”的上下文
- 设计范围会散落在聊天记录和 task description 里
- initiative 级别的验收会变得模糊
- spec sync 也没有稳定的回写目标

因此，`Change` 应该成为 `Project` 和 `Task` 之间的核心规划容器。

## v1 边界约束

为控制第一版复杂度，v1 明确采用以下约束：

1. 一个 project 同一时间只允许存在 `1` 个 active change。
2. Supervisor 下的所有 task 都必须归属于该 active change。
3. 历史 `completed / cancelled / archived` change 可以保留并回看。
4. v1 不支持多个 active change 并行执行。

这是一个产品范围约束，不是长期模型约束。

长期方向仍然是：

- 一个 project 可拥有多个并行 change
- 每个 change 绑定独立 worktree
- 每个 change 可挂接自己的 local PR 生命周期

## 工作流

Supervisor v1 建议使用六个顶层阶段。

### 阶段 1：Baseline

初始化或刷新项目 baseline。

对于新项目：

- 由用户提供背景、目标和约束

对于老项目：

- AI 扫描仓库
- AI 生成第一版 baseline markdown
- 用户修正其中的重要假设和错误

这个阶段是低频行为，不应该在每次 change 开始时都重新做一遍。

### 阶段 2：Change

创建一个新的 change initiative。

这一步在概念上类似 OpenSpec 的 `propose`，但应作为 supervisor 的原生流程存在。

最少产出：

- change 标题
- 问题定义
- 动机
- 非目标
- 影响面
- 成功标准

### 阶段 3：Design

在执行前明确本次 change 的技术方案。

最少产出：

- 预期修改的模块
- 明确的 out-of-scope
- 实现策略
- 数据流 / 架构说明
- 必要时的迁移或 rollout 说明
- 测试策略
- 验收标准

这一阶段必须以 **design review gate** 结束。没有设计确认，不应进入执行。

### 阶段 4：Execution Planning

在真正执行前，先生成执行计划。

该阶段产出至少包括：

- `tasks.md`
- task 依赖关系
- 执行顺序或 phase 划分
- verification 计划
- 自动化执行策略

这一阶段必须以 **execution gate** 结束。没有执行方案确认，不应开始真正执行。

### 阶段 5：Execution

将 change 拆分为 task，并在 supervision 下长期执行。

Supervisor 负责：

- task 规划与依赖管理
- session 创建与复用
- checkpoint
- review 与 retry
- 长周期任务的暂停 / 恢复
- 进度汇总

这一阶段通常会跨越多天和多次 session。

### 阶段 6：Sync

在执行结果通过验收后，把实现结果回写到 specs 中。

例如：

- 更新 feature 文档
- 更新 architecture 文档
- 更新 baseline summary
- 标记 change 完成

这一阶段的意义，是避免整套系统退化成“文档先写，之后长期漂移”。

## 状态模型

现有 `ProjectAgent.phase` 可以保留，但在产品层面需要引入 change 视角的状态机。

建议的 change 状态：

```ts
type ChangeStatus =
  | 'draft'
  | 'designing'
  | 'awaiting_design_review'
  | 'planning'
  | 'awaiting_execution_review'
  | 'executing'
  | 'paused'
  | 'accepting'
  | 'syncing'
  | 'completed'
  | 'cancelled';
```

task 状态建议继续尽量复用现有 supervision task lifecycle：

- `proposed`
- `pending`
- `queued`
- `planning`
- `running`
- `reviewing`
- `approved`
- `integrated`
- `rejected`
- `blocked`
- `failed`
- `cancelled`

## 文件模型

Supervisor 应该采用一种类似 OpenSpec 的文件落地方式，但路径结构应围绕 MyClaudia 现有 `.supervision/` 目录展开。

建议结构：

```text
.supervision/
├── baseline/
│   ├── project.md
│   ├── architecture.md
│   ├── glossary.md
│   └── features/
│       └── <feature>.md
├── changes/
│   └── <change-id>/
│       ├── change.md
│       ├── design.md
│       ├── execution.md
│       ├── tasks.md
│       ├── acceptance.md
│       └── sync-log.md
├── summaries/
│   └── project-summary.md
└── workflow.yaml
```

说明：

- `baseline/` 是项目级、长期存在的
- `changes/<change-id>/` 是某次 initiative 的完整工作区
- `project-summary.md` 仍然作为轻量级默认上下文注入入口
- 现有 supervision runtime 可以继续优先注入 summary，需要时再按需读取详细文档

## 真相源分工

v1 明确采用双层真相源模型，但不做双主写入：

### Markdown 负责

作为 spec 内容主源，承载所有适合人和 agent 直接阅读、审阅和编辑的语义内容：

- `baseline/project.md`
- `baseline/architecture.md`
- `changes/<id>/change.md`
- `changes/<id>/design.md`
- `changes/<id>/execution.md`
- `changes/<id>/tasks.md`
- `changes/<id>/acceptance.md`
- `changes/<id>/sync-log.md`

### SQLite 负责

作为运行时状态与查询索引主源，承载所有高频读写、排序、过滤、恢复相关的结构化状态：

- 当前 active change
- change status
- task status / attempt / timestamps
- review 状态
- checkpoint 元数据
- task 与 session / worktree / local PR 的关联

### 规则

1. 文档内容字段以 markdown 为主源。
2. 执行状态字段以 SQLite 为主源。
3. 不允许 markdown 与 SQLite 对同一字段做双主写入。
4. UI 默认读 SQLite，查看详情时再打开 markdown 内容。

## 数据模型补充

共享类型层需要新增一个 `Change` 实体。

建议草案：

```ts
interface ProjectChange {
  id: string;
  projectId: string;
  title: string;
  status: ChangeStatus;
  summary: string;
  motivation?: string;
  nonGoals: string[];
  scope: string[];
  acceptanceCriteria: string[];
  executionStatus?: 'draft' | 'approved' | 'needs_revision';
  syncStatus?: 'idle' | 'pending' | 'approved';
  worktreeId?: string;
  localPrId?: string;
  baselineVersion?: string;
  designApprovedAt?: number;
  executionApprovedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

`SupervisionTask` 需要关联 change：

```ts
interface SupervisionTask {
  // existing fields...
  changeId: string;
  changeTaskRef?: string; // 例如 tasks.md 里的 section 或 task key
}
```

## Gate 模型

Supervisor v1 采用两个正式 gate：

1. `Design Gate`
2. `Execution Gate`

二者都不是“通过/失败”二元判断，而是“审批 + 可回退”机制。

### Design Gate

审批对象：

- `change.md`
- `design.md`

审批目标：

- 判断设计方案是否成立
- 判断 scope 是否收敛
- 判断是否可以进入执行规划

v1 规则：

1. `Design Gate` 必须由用户显式批准。
2. 任何自动模式都不能跳过 `Design Gate`。
3. `Design` 的结构性修改必须重新审批。
4. 非语义性编辑，如排版和措辞微调，不触发重新审批。

Design Gate 的结果：

- `approve_design`
- `revise_design`
- `revise_change`

### Execution Gate

审批对象：

- `execution.md`
- `tasks.md`

审批目标：

- 判断系统准备如何执行该 change
- 判断 task 拆分、顺序和 verification 是否可接受
- 判断是否可以真正进入执行态

v1 规则：

1. `Execution Gate` 必须由用户显式批准。
2. 任何自动模式都不能跳过 `Execution Gate`。
3. 一旦 `Execution Gate` 通过，后续 task 执行应尽量自动推进。
4. 如果执行过程中发现与 design 明显偏离，必须暂停并回到人工确认。

Execution Gate 的结果：

- `approve_execution`
- `revise_plan`
- `revise_design`
- `split_change`

## 回退机制

所有 gate 都必须支持明确回退，而不是只有“通过/驳回”。

### Design Gate 回退

- `revise_design`
  设计内容需要补充或修正，但 change 定义本身没问题
- `revise_change`
  问题源头在 change 定义，例如目标过大、动机不清、scope 混乱

### Execution Gate 回退

- `revise_plan`
  task 拆分、顺序或 verification 不合理，回到 planning
- `revise_design`
  计划问题来自 design 本身，回到 design
- `split_change`
  当前 change 过大或混了多个 initiative，回到 change 重新拆分

## Task Planning 规则

v1 对 task planning 采用保守且可执行的约束。

### Task 粒度

一个 task 应该是：

**可以在一次连续执行中完成并验证的最小有意义交付单元。**

task 不应按文件数量或函数数量机械拆分，而应按行为、子能力或可验证成果拆分。

### Task 最少字段

每个 task 至少需要：

- `title`
- `summary`
- `scope`
- `dependsOn`
- `deliverables`
- `verification`

### 依赖规则

1. v1 只支持简单 DAG 依赖模型。
2. 默认语义为“所有依赖都完成后才可执行”。
3. 不支持条件依赖、循环依赖和复杂任务组。

### 数量规则

1. 一个 change 的 task plan 推荐落在 `3-7` 个 task。
2. 超过 `10` 个 task 时，系统应提示该 change 可能过大。
3. 超过阈值后，应优先考虑：
   - 缩小当前 change scope
   - 拆成多个后续 change
   - 按 phase 分阶段执行

### 并发规则

1. v1 默认串行执行。
2. 只有当依赖独立、修改范围基本不重叠、verification 独立时，才允许保守并行。

### 完成定义

task 完成不等于代码写完。

v1 中 task 完成至少意味着：

- 实现完成
- verification 完成
- review 通过

## 大 Change 策略

当一个 change 明显过大时，系统不应无限增加 task 数量，而应优先采用以下策略：

1. 拆成多个后续 change
2. 保持一个 change，但按 phase 分阶段执行

如果采用 phase 策略，则 `Execution Gate` 只审批当前阶段要执行的计划，不强制一次性展开所有未来 task。

## 与现有 Supervision 域的关系

这份 design 以不考虑向前兼容为前提，直接将 Supervisor 重新定义为 change-first 的工作区。

可复用的底层能力仍然包括：

- task lifecycle
- checkpoint engine
- review engine
- task runner
- context manager

但在产品模型上，Supervisor 不再是 task-centric orchestration，而是：

**change-centric spec-driven workspace**

## Prompt / Context 调整

task 执行时，不能再只依赖通用项目上下文和 task description。

对于属于某个 change 的 supervised task，建议注入以下上下文：

- project summary
- 相关 baseline 摘要
- change summary
- 已批准 design 的摘要
- `tasks.md` 中对应的具体 task 片段
- task 级和 change 级 acceptance criteria
- 历史 review feedback

这是整个方案里最值得借鉴 OpenSpec 的地方，因为它能显著改善执行稳定性。

## UX 流程

建议的产品流转如下：

1. 用户为某个 project 开启 supervisor mode。
2. App 询问是通过用户输入还是代码扫描来初始化 baseline。
3. 如果 project 没有 active change，必须先创建一个。
4. Supervisor 协助生成 `change.md`。
5. Supervisor 协助生成 `design.md`。
6. 用户通过 `Design Gate` 审核并批准 design。
7. Supervisor 生成 `execution.md` 与 `tasks.md`。
8. 用户通过 `Execution Gate` 批准执行方案。
9. Supervisor 在多个 session 中持续执行 task。
10. 完成结果进入 acceptance。
11. 验收通过后，把结果同步回 baseline / specs。

## UX 结构

v1 的 UX 采用 change-first 的页面结构，而不是 task board-first。

### 1. Project Supervisor Home

首页优先回答四个问题：

- baseline 是否已准备好
- 当前 active change 是什么
- active change 处于哪个阶段
- 现在最需要用户做什么

首页应以状态面板和 next action 为核心，而不是默认进入聊天窗口或 task board。

### 2. Change Workspace

active change 进入一个专属 workspace。

建议包含以下主要视图：

- `Overview`
- `Design`
- `Execution`
- `Tasks`
- `Reviews`
- `Sync`

### 3. Chat 的角色

Supervisor Chat 仍然存在，但它是 workspace 的辅助交互层，不是整个 supervisor 的主导航。

其职责包括：

- 解释当前状态
- 协助补充 design
- 协助重规划 task
- 说明 review 或 sync 问题

### 4. v1 的最小页面集合

v1 必须做的页面/视图包括：

1. Supervisor Home
2. Change Overview
3. Design + Design Gate
4. Execution + Execution Gate
5. Tasks
6. Sync

## 验收模型

验收应分成两层。

### Task 级验收

对每个 task：

- 代码改动是否符合预期范围
- 验证是否通过
- review 问题是否处理完成

### Change 级验收

对整个 initiative：

- 最终结果是否满足最初声明的成功标准
- design 假设是否成立
- specs 是否已经反映当前系统状态

这样可以避免“每个 task 都完成了，但 initiative 仍然偏掉”的常见问题。

## 实施附录：Shared Types 草案

以下内容用于指导 `shared/src/features/supervision.ts` 的下一轮演进。

### 推荐新增类型

```ts
export type ChangeStatus =
  | 'draft'
  | 'designing'
  | 'awaiting_design_review'
  | 'planning'
  | 'awaiting_execution_review'
  | 'executing'
  | 'paused'
  | 'accepting'
  | 'syncing'
  | 'completed'
  | 'cancelled';

export type GateType = 'design' | 'execution';

export type DesignGateDecision =
  | 'approve_design'
  | 'revise_design'
  | 'revise_change';

export type ExecutionGateDecision =
  | 'approve_execution'
  | 'revise_plan'
  | 'revise_design'
  | 'split_change';

export interface ProjectChange {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  status: ChangeStatus;
  summary: string;
  motivation?: string;
  nonGoals: string[];
  scope: string[];
  acceptanceCriteria: string[];
  baselineVersion?: string;
  active: boolean;
  designApprovedAt?: number;
  executionApprovedAt?: number;
  syncApprovedAt?: number;
  worktreeId?: string;
  localPrId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ChangeExecutionPlan {
  changeId: string;
  designVersion: number;
  summary: string;
  phases?: Array<{
    id: string;
    title: string;
    summary: string;
  }>;
  automation: {
    strategy: 'serial' | 'conservative_parallel';
    autoReview: boolean;
    autoRetry: boolean;
    autoSyncDraft: boolean;
  };
  verification: Array<{
    id: string;
    label: string;
    command?: string;
    required: boolean;
  }>;
  updatedAt: number;
}
```

### 对现有类型的最小改动

`SupervisionTask` 建议新增：

```ts
interface SupervisionTask {
  changeId: string;
  changeTaskRef?: string;
  phaseId?: string;
}
```

`ProjectAgent` 可保留，但 `phase` 的产品含义会弱化，更多作为 project 级运行态补充；真正的主流程状态转移应由 `ProjectChange.status` 驱动。

### 建议新增日志事件

```ts
type SupervisionLogEvent =
  | 'change_created'
  | 'change_status_changed'
  | 'design_gate_requested'
  | 'design_gate_resolved'
  | 'execution_gate_requested'
  | 'execution_gate_resolved'
  | 'change_sync_requested'
  | 'change_sync_completed';
```

## 实施附录：SQLite 表结构草案

Markdown 是内容主源，但运行时状态应结构化落 SQLite。

### 1. `project_changes`

```sql
CREATE TABLE project_changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  baseline_version TEXT,
  design_approved_at INTEGER,
  execution_approved_at INTEGER,
  sync_approved_at INTEGER,
  worktree_id TEXT,
  local_pr_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(project_id, slug)
);
CREATE UNIQUE INDEX idx_project_changes_single_active
ON project_changes(project_id)
WHERE active = 1;
```

说明：

- `active` 的唯一索引保证 v1 的“单 project 单 active change”
- `summary` 是给列表和 UI 面板读的摘要，不替代 markdown 正文

### 2. `change_gate_reviews`

```sql
CREATE TABLE change_gate_reviews (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL,
  gate_type TEXT NOT NULL,            -- design | execution
  status TEXT NOT NULL,               -- pending | approved | revision_requested
  decision TEXT,                      -- approve_design / revise_plan / ...
  notes TEXT,
  reviewer_user_id TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_change_gate_reviews_change
ON change_gate_reviews(change_id, gate_type, created_at DESC);
```

说明：

- 该表记录 gate 历史，而不是只保留最后一次结果
- `notes` 作为 review 结论摘要，详细内容仍可回写 markdown 或日志

### 3. `supervision_tasks` 增量字段

在现有任务表上增加：

```sql
ALTER TABLE supervision_tasks ADD COLUMN change_id TEXT;
ALTER TABLE supervision_tasks ADD COLUMN change_task_ref TEXT;
ALTER TABLE supervision_tasks ADD COLUMN phase_id TEXT;
```

约束建议：

- 新建 task 时 `change_id` 必填
- 历史兼容数据在本 design 范围外，可在真正实施时决定是否允许短暂为空

### 4. `change_sync_runs`

```sql
CREATE TABLE change_sync_runs (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL,
  status TEXT NOT NULL,               -- pending | approved | applied | failed
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  applied_at INTEGER
);
CREATE INDEX idx_change_sync_runs_change
ON change_sync_runs(change_id, created_at DESC);
```

用途：

- 跟踪每次 sync 草稿与最终应用结果
- 为 Sync 页面提供历史记录

## 实施附录：API 草案

当前 `apps/desktop/src/services/api/supervision.ts` 的接口以 task 为中心。  
在 change-first 模型下，建议 API 也按资源层次重组。

### Project 级

```http
POST   /api/projects/:projectId/supervisor/init
GET    /api/projects/:projectId/supervisor
GET    /api/projects/:projectId/supervisor/home
POST   /api/projects/:projectId/supervisor/baseline/init
POST   /api/projects/:projectId/supervisor/baseline/refresh
GET    /api/projects/:projectId/supervisor/baseline
```

用途：

- 初始化 supervisor
- 获取首页所需聚合状态
- 初始化或刷新 baseline

### Change 级

```http
POST   /api/projects/:projectId/changes
GET    /api/projects/:projectId/changes
GET    /api/projects/:projectId/changes/active
GET    /api/changes/:changeId
PUT    /api/changes/:changeId
POST   /api/changes/:changeId/pause
POST   /api/changes/:changeId/resume
POST   /api/changes/:changeId/archive
```

说明：

- v1 虽然只有一个 active change，但列表与历史能力仍然保留
- `GET /active` 方便首页和 workspace 启动时直接命中

### Gate 级

```http
POST   /api/changes/:changeId/design-gate/request
POST   /api/changes/:changeId/design-gate/approve
POST   /api/changes/:changeId/design-gate/revise-design
POST   /api/changes/:changeId/design-gate/revise-change

POST   /api/changes/:changeId/execution-gate/request
POST   /api/changes/:changeId/execution-gate/approve
POST   /api/changes/:changeId/execution-gate/revise-plan
POST   /api/changes/:changeId/execution-gate/revise-design
POST   /api/changes/:changeId/execution-gate/split-change
```

说明：

- v1 可以不把 gate 抽成独立资源对象，但建议在路由层显式表达 gate 动作
- 每次 gate 决策都应写入 `change_gate_reviews`

### Execution / Tasks 级

```http
GET    /api/changes/:changeId/execution
PUT    /api/changes/:changeId/execution
GET    /api/changes/:changeId/tasks
POST   /api/changes/:changeId/tasks
PUT    /api/tasks/:taskId
POST   /api/tasks/:taskId/run-now
POST   /api/tasks/:taskId/retry
POST   /api/tasks/:taskId/cancel
POST   /api/tasks/:taskId/review/approve
POST   /api/tasks/:taskId/review/reject
```

说明：

- 现有 task API 大多可以复用，但创建和查询入口应挂到 `changeId`
- `execution` 负责 `execution.md` 与计划摘要的同步

### Sync 级

```http
GET    /api/changes/:changeId/sync
POST   /api/changes/:changeId/sync/request
POST   /api/changes/:changeId/sync/approve
POST   /api/changes/:changeId/complete
```

说明：

- `request` 生成 sync draft
- `approve` 将 draft 写回 markdown 并更新状态
- `complete` 仅在 sync 已完成时允许

## 实施附录：Markdown 文件模板

以下模板用于 `.supervision/changes/<change-id>/` 和 `baseline/` 的首版生成。

### `baseline/project.md`

```md
---
kind: baseline
section: project
status: draft
updatedAt: 2026-04-20
---

# 项目概览

## 背景

## 当前目标

## 关键约束

## 已知风险

## 待用户确认
```

### `baseline/architecture.md`

```md
---
kind: baseline
section: architecture
status: draft
updatedAt: 2026-04-20
---

# 架构概览

## 关键模块

## 数据流

## 外部依赖

## 推断内容
```

### `changes/<change-id>/change.md`

```md
---
kind: change
changeId: <change-id>
status: draft
updatedAt: 2026-04-20
---

# Change

## Title

## Problem

## Motivation

## Non-Goals

## Scope

## Success Criteria
```

### `changes/<change-id>/design.md`

```md
---
kind: design
changeId: <change-id>
status: awaiting_review
version: 1
updatedAt: 2026-04-20
---

# Design

## Overview

## Touched Modules

## Out of Scope

## Technical Approach

## Risks

## Testing Strategy

## Acceptance Criteria
```

### `changes/<change-id>/execution.md`

```md
---
kind: execution
changeId: <change-id>
status: awaiting_review
designVersion: 1
updatedAt: 2026-04-20
---

# Execution Plan

## Summary

## Phases

## Execution Strategy

## Verification Plan

## Automation Policy

## Risks Before Start
```

### `changes/<change-id>/tasks.md`

```md
---
kind: tasks
changeId: <change-id>
status: draft
updatedAt: 2026-04-20
---

# Tasks

## T1 <title>

- Summary:
- Scope:
- Depends On:
- Deliverables:
- Verification:

## T2 <title>

- Summary:
- Scope:
- Depends On:
- Deliverables:
- Verification:
```

### `changes/<change-id>/acceptance.md`

```md
---
kind: acceptance
changeId: <change-id>
status: pending
updatedAt: 2026-04-20
---

# Acceptance

## Task-Level Checks

## Change-Level Checks

## Open Issues

## Final Decision
```

### `changes/<change-id>/sync-log.md`

```md
---
kind: sync-log
changeId: <change-id>
status: draft
updatedAt: 2026-04-20
---

# Sync Log

## Updated Files

## Summary Of Spec Changes

## Follow-up Notes
```

## 实施附录：建议的落地顺序

为了降低实现风险，建议按下面顺序推进：

1. 在 `shared` 中新增 `ProjectChange`、Gate 决策类型和 task 增量字段
2. 在 server 侧新增 `project_changes` 与 `change_gate_reviews` 表
3. 建立 `.supervision/baseline/` 和 `.supervision/changes/<id>/` 生成器
4. 完成 `Design Gate` 与 `Execution Gate` 的服务端状态流转
5. 将 task 创建与查询入口迁移到 `changeId`
6. 再补 desktop 侧的 `Supervisor Home / Change Workspace`

## MVP 建议范围

第一版应该刻意收窄。

### MVP 包含

1. project baseline 初始化
2. 一等公民的 change 实体
3. 单 project 单 active change
4. `change.md`、`design.md`、`execution.md`、`tasks.md` 的生成与管理
5. `Design Gate`
6. `Execution Gate`
7. task 与 change 的强关联
8. 把完成后的结果同步回 markdown specs

### MVP 不包含

1. 从任意普通聊天自动发现并创建 change
2. 多个 active change 的并行管理
3. baseline 的全自动持续维护
4. 富文本图表或可视化编辑器
5. OpenSpec CLI 兼容层
6. 完整的多 worktree / multi-local-PR orchestration

## 风险

### 1. 流程过重

如果每个 change 都需要很多仪式感，用户会回避 supervisor mode。

缓解方式：

- 明确 supervisor 只服务长期重任务
- 保持普通 session 流程不变
- 后续可以增加更轻量的 change template

### 2. Spec 漂移

baseline 和 design 文档可能很快过期。

缓解方式：

- 明确记录 sync 时点
- 保持 summary 简洁
- 没有完成 spec sync，不允许把 change 标记为 completed

### 3. 老项目逆向错误

AI 为 legacy project 生成的 baseline 可能包含推测。

缓解方式：

- 对推断内容显式标注
- 区分“用户确认事实”和“AI inferred observation”

### 4. 大 Change 失控

如果把多个 initiative 硬塞进一个 change，执行会迅速失控。

缓解方式：

- 通过 `Execution Gate` 明确识别并触发 `split_change`
- 优先拆成多个 change，或至少按 phase 执行

## 结论建议

这套 workflow 是合理的，并且与 supervisor mode 的目标定位一致。

最关键的产品判断是：

`Supervisor` 应该专门服务 **重型、长期、规范驱动的改动**，而普通 session 继续承担默认的小任务路径。

因此正确的实现策略不是“把 OpenSpec 嵌进 MyClaudia”，而是：

**把 OpenSpec 的规划结构提升为一个 change-first、双 gate、规范驱动的原生 supervisor workflow。**
