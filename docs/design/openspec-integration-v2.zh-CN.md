# OpenSpec × Supervisor 融合设计 v2

## 0. 状态

- 版本：v0.2（draft / 待评审）
- 日期：2026-05-21
- **取代**：`docs/design/openspec-integration.zh-CN.md` (v0.1) — 该文档基于错误的架构理解（把 OpenSpec 当作 Classic Change/Meta Workflow 的"存储格式替换"）
- 范围：Supervisor 模式下的 spec-driven 工作流端到端架构

## 1. 从 v1 到 v2：关键变化

| 维度 | v1（已废弃） | v2（本文档） |
|------|-------------|-------------|
| OpenSpec 角色 | 替换 Classic Change / Meta Workflow 的文件存储格式 | 只**借鉴文件格式**，runtime 完全自建 |
| 实体关系 | OpenSpec change ≈ ProjectChange（合并） | 三层独立：Issue / SpecChange / Executor |
| 跨层耦合 | Classic 和 Meta 都改造 spec 存储 | Sub-Issue 是统一入口，下游 Executor 抽象 |
| 重新设计 Classic / Meta 的代价 | 高（要改 spec 存储） | 低（只改 Adapter） |

v1 的关键错误：把 OpenSpec 当成"工具"嵌入，而它真正的价值是"模型"——specs/change/delta/archive 的概念分层。本文档采纳模型，runtime 自建。

## 2. 设计目标

1. 每个 supervised project 拥有一份**持久化的项目知识 wiki**（spec corpus），跨多次变更累积
2. 任何用户发起的变更都**有归属**——挂在某个 Issue 下，长期可追溯
3. **Issue / SpecChange / Executor 三层分离**——上层不知道下层实现细节，可独立演化
4. 现有 Classic Change / Meta Workflow **继续工作**，未来可以独立重构而不影响上层
5. 复用 OpenSpec 的**文件格式**（specs / changes / delta / archive），保留与原版 OpenSpec CLI 的文件兼容性

## 3. 非目标

1. **不**作为 `@fission-ai/openspec` 的运行时依赖（只借文件格式 + 概念模型）
2. **不**绑定 OpenSpec 的 CLI / skill / command 生成机制
3. **不**强制现有 ProjectChange / MetaWorkflowRun 数据迁移；新功能加上来，老数据保留
4. **不**做 OpenSpec 的 multi-workspace 功能（MyClaudia 已有 multi-project）
5. **不**自动决策"feature 是否真的 ship"——父 Issue 关闭永远是人工动作

## 4. 三层架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  Project                                                         │
│                                                                  │
│   📚 Spec Corpus  (openspec/specs/)         ← 项目长期知识 wiki │
│      持久累积，跨 Issue 共享                                    │
│                                                                  │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Issue Layer                                          │    │
│   │                                                        │    │
│   │   Parent Issue (type=feature, 纯组织容器)             │    │
│   │   ├── Sub-Issue (type=implement) ────┐                │    │
│   │   ├── Sub-Issue (type=bug) ──────────┤                │    │
│   │   └── Sub-Issue (type=enhancement) ──┤                │    │
│   │                                       │                │    │
│   │   Standalone Sub-Issue (无父) ───────┤                │    │
│   │   Anonymous Sub-Issue (X2 自动建) ───┤                │    │
│   └───────────────────────────────────────┼────────────────┘    │
│                                           │                      │
│                                           ↓  1:1                 │
│   ┌─────────────────────────────────────────────────────┐      │
│   │  SpecChange Layer                                    │      │
│   │                                                       │      │
│   │   - 文件落 openspec/changes/<spec-change-id>/        │      │
│   │   - proposal.md / design.md / tasks.md / delta-specs │      │
│   │   - 状态机：drafting → proposing → designing →       │      │
│   │             tasks_ready → archived / cancelled       │      │
│   └─────────────────────────────────────┬────────────────┘      │
│                                          │                       │
│                                          ↓  1:N                 │
│   ┌─────────────────────────────────────────────────────┐      │
│   │  ExecutorInstance Layer (抽象)                       │      │
│   │                                                       │      │
│   │   - type: 'classic' | 'meta-workflow' | ...          │      │
│   │   - 统一接口 IExecutor                                │      │
│   │   - statusSummary (cached, normalized)               │      │
│   │   - underlyingId → 具体执行表                         │      │
│   │                                                       │      │
│   │   ┌──────────┐  ┌────────────────┐  ┌──────────────┐│      │
│   │   │ Classic  │  │  MetaWorkflow  │  │   Future...  ││      │
│   │   │ Adapter  │  │    Adapter     │  │    Adapter   ││      │
│   │   └────┬─────┘  └───────┬────────┘  └──────┬───────┘│      │
│   └────────┼─────────────────┼──────────────────┼───────┘      │
│            ↓                 ↓                  ↓                │
│     project_changes   meta_workflow_runs    新表 / 第三方         │
│       (现有)             (现有)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 三层职责

| 层 | 关心什么 | 状态机 | 关联 |
|----|----------|--------|------|
| Issue | feature 是不是 ship 了 | Parent: `open` / `closed`<br>Sub: `open` / `planning` / `executing` / `reviewing` / `closed` / `cancelled` | Parent ↔ Sub: 1:N<br>Sub ↔ SpecChange: 1:1 |
| SpecChange | 这一轮提案是否成立、设计是否完整、任务是否拆好 | `drafting` / `proposing` / `designing` / `tasks_ready` / `archived` / `cancelled` | Sub ← 1:1 → SpecChange<br>SpecChange ↔ ExecutorInstance: 1:N |
| ExecutorInstance | 任务执行是否完成 | `pending` / `executing` / `paused` / `completed` / `failed` / `cancelled` | SpecChange ← 1:N → ExecutorInstance<br>ExecutorInstance → underlying（Classic/Meta） |

### 4.2 关键关系

- **1:1 Sub-Issue ↔ SpecChange**——每个 sub-issue 自带一个 spec_change；多轮迭代 = 多个 sub-issue（参考 Jira sub-issue 模型）
- **1:N SpecChange ↔ ExecutorInstance**——一个提案可以拆成多个执行实例（一部分走 Classic、一部分走 Meta Workflow）
- **N:1 SpecChange ↔ Spec Corpus**——多次 spec_change archive 时各自合 delta 到同一份 spec corpus

## 5. 数据模型

### 5.1 LocalIssue 扩展

```typescript
export type LocalIssueType =
  | 'feature'      // 父类：纯组织容器，无 SpecChange
  | 'implement'    // 子类：实现一个功能片段
  | 'bug'          // 子类：修一个 bug
  | 'enhancement'  // 子类：优化已有功能
  | 'chore';       // 子类：杂项（如重构、文档）

export type LocalIssueStatus =
  | 'open'         // 刚创建，未开始
  | 'planning'     // spec_change 在 proposing / designing
  | 'tasks_ready'  // tasks 拆完，等待启动 executor
  | 'executing'    // 至少一个 executor 在跑
  | 'reviewing'    // 所有 executor 完成，等用户审查
  | 'closed'       // 关闭，触发 archive
  | 'cancelled';   // 主动放弃

export interface LocalIssue {
  // 现有字段
  id, projectId, title, description, priority, labels;
  createdAt, updatedAt, closedAt;

  // 新增
  type: LocalIssueType;
  status: LocalIssueStatus;       // 状态机分父子两套（见下）
  parentIssueId?: string;          // feature → null; sub → parent feature id
  specChangeId?: string;           // sub-issue 持有；feature 永远 null
  isAnonymous?: boolean;           // X2 自动建的 anonymous sub-issue 标记
}
```

**状态机分父子两套**：
- `type='feature'`：只用 `open` / `closed` / `cancelled`，其他状态不出现
- `type ∈ {implement, bug, enhancement, chore}`：用完整 7 态状态机

### 5.2 SpecChange（新实体）

```typescript
export type SpecChangeStatus =
  | 'drafting'      // 刚创建，proposal 还没写
  | 'proposing'     // proposal.md 草稿中
  | 'designing'     // design.md 草稿中
  | 'tasks_ready'   // tasks.md 拆完，等待执行
  | 'archived'      // delta 已 merge 进 corpus
  | 'cancelled';    // 主动放弃

export interface SpecChange {
  id: string;                              // UUID
  projectId: string;
  subIssueId: string;                      // 反向 FK 到 sub-issue
  slug: string;                            // 文件夹名: kebab-case，如 'add-2fa-auth'
  title: string;
  status: SpecChangeStatus;
  proposalPath: string;                    // 'openspec/changes/<slug>/proposal.md'
  designPath: string;
  tasksPath: string;
  deltaSpecPaths: string[];                // ['openspec/changes/<slug>/specs/auth/spec.md']
  deltaPendingMerge: boolean;              // B3: true 表示已完成但未 merge
  createdAt, updatedAt, archivedAt?: number;
}
```

### 5.3 ExecutorInstance（新抽象表）

```typescript
export type ExecutorType = 'classic' | 'meta-workflow' | 'manual' | 'superpowers';

export type ExecutorStatus =
  | 'pending'      // 创建但未启动
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutorInstance {
  id: string;                              // UUID
  projectId: string;
  specChangeId: string;                    // FK 到 SpecChange
  type: ExecutorType;                      // discriminator
  underlyingId: string;                    // FK 到 type-specific 表
                                           //   classic       → project_changes.id
                                           //   meta-workflow → meta_workflow_runs.id
                                           //   manual        → null（无 underlying）
  statusSummary: ExecutorStatus;           // 归一化（缓存）
  progressJson?: string;                   // 归一化进度（可选 cache）
  startedAt?: number;
  completedAt?: number;
  createdAt, updatedAt: number;
}
```

### 5.4 代码层抽象：IExecutor

```typescript
// server/src/domains/executor/executor-port.ts
export interface IExecutor {
  start(input: ExecutorInput): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  getStatus(): ExecutorStatus;
  getProgress(): ExecutorProgress;
  getOutputCommits(): GitCommit[];
}

// 抽象工厂
export interface ExecutorRegistry {
  resolve(instance: ExecutorInstance): IExecutor;
}
```

**Adapter 注册**：每种 executor 提供 adapter 实现：

```
server/src/domains/executor/
├── executor-port.ts                  抽象接口
├── executor-registry.ts              工厂
├── executor-service.ts               业务服务
├── adapters/
│   ├── classic-adapter.ts            包装 project_changes 现有逻辑
│   ├── meta-workflow-adapter.ts      包装 meta_workflow_runs 现有逻辑
│   ├── manual-adapter.ts             无后端，纯状态记录
│   └── superpowers-adapter.ts        (未来)
└── repositories/
    └── executor-instance-repository.ts
```

**statusSummary 同步策略（缓存）**：
- 每个 adapter 在 underlying 状态变化时**主动**更新 `executor_instances.statusSummary`
- 通过事件总线（`EventDispatcher`）发布 `executor.status_changed`
- SpecChange / Sub-Issue 状态机订阅事件，自动 promote 上层状态

### 5.5 Spec Corpus（项目知识 wiki）

```typescript
export interface SpecSummary {
  capability: string;        // 'auth'
  requirementCount: number;
  scenarioCount: number;
  lastUpdatedAt: number;     // mtime of file
}

export interface ProjectSpecCorpus {
  projectId: string;
  rootPath: string;          // <projectRoot>/openspec/specs/
  initialized: boolean;      // 是否跑过 bootstrap
  lastBootstrapAt?: number;
  capabilities: SpecSummary[];
}
```

**存储**：纯文件 + lightweight DB 索引（`project_spec_corpus_meta` 表，可选）。

## 6. 文件布局（沿用 OpenSpec 格式）

```
<projectRoot>/
├── .supervision/                          (legacy，保留)
│   ├── baseline/                          v1 BaselineService 产物
│   ├── changes/<id>/                      legacy ProjectChange 文件
│   └── ...
│
└── openspec/                              (新)
    ├── project.md                         项目元信息（可选）
    ├── specs/                             📚 持久 spec corpus
    │   ├── auth/spec.md
    │   ├── billing/spec.md
    │   └── ...
    └── changes/
        ├── <spec-change-slug>/            active spec_change
        │   ├── proposal.md
        │   ├── design.md
        │   ├── tasks.md
        │   ├── .openspec.yaml             metadata
        │   └── specs/<capability>/
        │       └── spec.md                delta (ADDED/MODIFIED/REMOVED)
        └── archive/
            └── 2026-05-21-<slug>/         archived spec_change
```

**与原版 OpenSpec 文件兼容**：用户可在同一个目录跑 `openspec` CLI（如果安装了），读写互不冲突。

## 7. 完整生命周期

### 7.1 场景 A：完整 Feature 开发

```
1. 用户："给我加 2FA 登录"
2. UI: New Issue → type=feature → "Add 2FA Authentication"
   → 创建 LocalIssue(id=I1, type=feature, status=open)

3. 用户：在 I1 下添加 Sub-Issue
   → 创建 LocalIssue(id=I1-1, type=implement, parentIssueId=I1, status=open)
   → 自动创建 SpecChange(id=SC1, subIssueId=I1-1, slug='add-2fa', status=drafting)
   → openspec/changes/add-2fa/ 文件夹生成（空骨架）

4. AI/用户：编辑 proposal.md
   → SpecChange.status: drafting → proposing
   → Sub-Issue.status: open → planning

5. AI/用户：完成 design.md + tasks.md + delta specs
   → SpecChange.status: proposing → designing → tasks_ready
   → Sub-Issue.status: planning → tasks_ready

6. 用户：在 Sub-Issue 详情页选择执行方式
   → 选 "Classic Change"
   → 创建 ExecutorInstance(id=E1, type='classic', specChangeId=SC1)
   → 后端创建 project_changes 记录，ExecutorInstance.underlyingId=该记录id
   → ClassicAdapter.start() 拉起执行

7. 执行中
   → ExecutorInstance.statusSummary: executing
   → Sub-Issue.status: tasks_ready → executing

8. 执行完成
   → ExecutorInstance.statusSummary: completed
   → Sub-Issue.status: executing → reviewing

9. 用户审查 → 关闭 Sub-Issue
   → Sub-Issue.status: reviewing → closed
   → 触发 B3 archive:
       - openspec/changes/add-2fa/ → openspec/changes/archive/2026-05-21-add-2fa/
       - delta specs merge 进 openspec/specs/auth/spec.md
   → SpecChange.status: tasks_ready → archived
   → SpecChange.deltaPendingMerge: false

10. （可选）后续发现 bug
    → 用户在 I1 下加新 Sub-Issue(I1-2, type=bug, ...)
    → 走 3-9 同样流程，独立 SpecChange

11. 用户判断 feature 整体 ship
    → 手动关闭父 I1
    → I1.status: open → closed
```

### 7.2 场景 B：轻量改动（X2 anonymous sub-issue）

```
1. 用户：New ▾ → New Classic Change → 输入 title "rename foo to bar"
2. 后台自动：
   → 创建 LocalIssue(id=A1, type=implement, isAnonymous=true,
                     parentIssueId=null, status=open)
   → 创建 SpecChange(id=SC2, subIssueId=A1, ...)
   → 用户感知不到 issue 创建
3. UI 直接打开 SpecChange 编辑界面（用户感觉就是新建了一个 change）
4. 后续流程同场景 A 5-9
```

**Anonymous sub-issue 的标记**：
- UI 上 issue 列表默认隐藏 `isAnonymous=true` 的 sub-issue
- 提供"显示所有"切换
- 解决"小改动找不到归属"老问题：用户想看时能看到，不想看时不打扰

### 7.3 场景 C：Bootstrap 初始化 spec corpus

```
1. 用户：Project Settings → [Initialize Specs] 按钮
2. 系统：
   → 启动 "explore" 任务（不走 issue 体系）
   → AI 扫代码 → 产出完整 delta（ADDED: 所有现有能力）
3. UI: 弹出 review dialog
   → 显示发现的 capabilities 列表 + requirements 数
   → 用户可以编辑、勾掉、补充
4. 用户确认 → merge 进 openspec/specs/
5. 不创建 LocalIssue / SpecChange / ExecutorInstance
6. 历史记录在 spec corpus 自己的 commit history 里
```

**重新扫描**：同一按钮再点。AI 对比当前 corpus vs 最新代码 → 产出增量 ADDED/MODIFIED/REMOVED delta → 同样的 review 流程。

## 8. UI 三层呈现

### 8.1 默认入口：Project Issue 列表

```
┌─────────────────────────────────────────────────┐
│  Issues                                          │
│  [+ New Feature]  [+ New Bug]  [+ New Change]   │
├─────────────────────────────────────────────────┤
│  ▼ Add 2FA Authentication           [feature]   │
│    3 sub-issues  ·  2 closed  ·  open           │
│  ▼ Rename foo to bar       [implement] [closed] │
│  ▼ Fix login redirect bug  [bug] [executing]    │
│  ☐ Anonymous (1)            ← 折叠              │
└─────────────────────────────────────────────────┘
```

### 8.2 父 Issue 详情：Sub-Issue 列表

```
┌─────────────────────────────────────────────────┐
│  ← Issues / Add 2FA Authentication              │
│                                                  │
│  Status: open  ·  3 sub-issues  ·  [Close]      │
│                                                  │
│  Sub-Issues:                                     │
│  ├ ✅ Initial 2FA flow         [closed]         │
│  ├ ✅ Add backup codes         [closed]         │
│  └ 🔄 Fix iOS backup code bug  [reviewing]      │
│                                                  │
│  [+ Add Sub-Issue]                              │
└─────────────────────────────────────────────────┘
```

### 8.3 Sub-Issue 详情：SpecChange + Executor

```
┌─────────────────────────────────────────────────┐
│  ← Sub-Issue: Fix iOS backup code bug           │
│                                                  │
│  Status: reviewing                               │
│                                                  │
│  Spec Change                                     │
│  ├ proposal.md   [view]                         │
│  ├ design.md     [view]                         │
│  ├ tasks.md      [view]                         │
│  └ delta:        +0 / ~2 / -0  [view diff]     │
│                                                  │
│  Executors (1)                                   │
│  └ [classic] completed · 3 commits  [open]      │
│                                                  │
│  [Close Sub-Issue & Archive Delta]              │
└─────────────────────────────────────────────────┘
```

### 8.4 Spec Corpus 浏览

```
┌─────────────────────────────────────────────────┐
│  📚 Project Specs                                │
│  Last bootstrap: 2026-04-15  ·  [Re-scan]       │
├─────────────────────────────────────────────────┤
│  auth/           12 requirements   updated 2d   │
│  billing/        8 requirements    updated 1w   │
│  notifications/  5 requirements    updated 3w   │
└─────────────────────────────────────────────────┘
```

## 9. 数据模型详细 schema（SQLite）

```sql
-- 扩展 local_issues
ALTER TABLE local_issues ADD COLUMN type TEXT NOT NULL DEFAULT 'implement';
ALTER TABLE local_issues ADD COLUMN parent_issue_id TEXT REFERENCES local_issues(id);
ALTER TABLE local_issues ADD COLUMN spec_change_id TEXT REFERENCES spec_changes(id);
ALTER TABLE local_issues ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;
-- 状态机扩展
ALTER TABLE local_issues ADD COLUMN status_v2 TEXT;  -- 新枚举
-- 迁移：把现有 status (open/in_progress/closed) 映射到新枚举

-- SpecChange (新)
CREATE TABLE spec_changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sub_issue_id TEXT NOT NULL REFERENCES local_issues(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  proposal_path TEXT NOT NULL,
  design_path TEXT NOT NULL,
  tasks_path TEXT NOT NULL,
  delta_spec_paths_json TEXT NOT NULL DEFAULT '[]',
  delta_pending_merge INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX idx_spec_changes_project ON spec_changes(project_id, status);
CREATE INDEX idx_spec_changes_sub_issue ON spec_changes(sub_issue_id);

-- ExecutorInstance (新)
CREATE TABLE executor_instances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  spec_change_id TEXT NOT NULL REFERENCES spec_changes(id),
  type TEXT NOT NULL,
  underlying_id TEXT,
  status_summary TEXT NOT NULL DEFAULT 'pending',
  progress_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_executor_instances_spec_change ON executor_instances(spec_change_id);
CREATE INDEX idx_executor_instances_status ON executor_instances(project_id, status_summary);

-- project_spec_corpus_meta (可选，用于快速 corpus 概览)
CREATE TABLE project_spec_corpus_meta (
  project_id TEXT PRIMARY KEY,
  initialized INTEGER NOT NULL DEFAULT 0,
  last_bootstrap_at INTEGER,
  capabilities_json TEXT NOT NULL DEFAULT '[]'  -- cache
);
```

## 10. 迁移策略

### 10.1 现有 `local_issues`

- 加 `type` 默认 'implement'，`parent_issue_id=null`，`spec_change_id=null`，`is_anonymous=0`
- 状态映射：`open` → `open`；`in_progress` → 看上下文映射（可能是 `executing`）；`closed` → `closed`
- 老 issue 没有 spec_change → UI 上显示为"legacy issue"，不强制升级

### 10.2 现有 `project_changes`

- **不动**——继续存在，归 `ClassicAdapter` 间接访问
- 已有记录没有对应的 `executor_instances` 行 → UI 上分两区显示：
  - "Sub-Issue-managed Changes"（新）
  - "Legacy Changes"（老）
- 长期：可加迁移脚本（用户主动触发）把 legacy ProjectChange 反向补建 anonymous sub-issue + spec_change + executor_instance

### 10.3 现有 `meta_workflow_runs`

- **不动**——继续存在，归 `MetaWorkflowAdapter` 间接访问
- 同上策略

### 10.4 现有 `.supervision/`

- **保留**——legacy ProjectChange 的文件继续在这里
- 新功能写 `openspec/`
- BaselineService 维持现状（v1 baseline 文档保留），但 UI 主入口换成 spec corpus

## 11. 实施分阶段建议（重新规划）

> v1 文档里的 G1-G5 已废弃，重新设计。

### Phase G1 — 数据层基础（无 UI 变化，零破坏）

- 新 schema：spec_changes / executor_instances / project_spec_corpus_meta
- LocalIssue 扩展字段
- `IExecutor` 接口定义
- `ClassicAdapter`、`MetaWorkflowAdapter` 实现（包装现有 service）
- `ManualAdapter` 占位实现
- 单测覆盖
- **验收**：服务器启动正常；执行 `SELECT` 新表无错；现有 Classic / Meta 功能不受影响

### Phase G2 — SpecChange 核心 + 文件 IO

- `SpecChangeService`：CRUD spec_change + 写 `openspec/changes/<slug>/` 文件
- 实现 OpenSpec 格式的 markdown 解析器（Requirement + Scenario）
- 实现 delta merge logic（ADDED / MODIFIED / REMOVED 块）
- `ArchiveService`：spec_change archive 实现
- 实现 validator
- **验收**：可以创建 spec_change → 写文件 → 关闭并触发 archive → corpus 更新

### Phase G3 — Issue 层级 + 关联

- LocalIssue 父子关系 + 新状态机
- Sub-Issue 自动创建 spec_change 的逻辑
- Sub-Issue ↔ Executor 关联 + 状态联动
- X2 anonymous sub-issue 机制
- **验收**：创建父 issue + sub-issue → spec_change 自动建 → executor 启动 → 状态正确流转

### Phase G4 — Bootstrap

- "Initialize Specs" 项目级 action
- AI explore prompt + 调用现有 aiRunPort
- Re-scan 增量 delta
- Review dialog
- **验收**：在测试项目跑 bootstrap，corpus 生成正确

### Phase G5 — UI

- Issue 三层 drill-in
- Sub-Issue 详情页（SpecChange + Executor 视图）
- Spec Corpus 浏览
- Archive 复核对话
- Anonymous issue 折叠/展开
- **验收**：用户能 UI 全程走通场景 A、B、C

### Phase G6（可选）— Prompt 优化 + 校验加强

- 优化 AI 提示词让 spec_change 各阶段产出更准
- 加强 validator 规则
- 加 deprecation 提示给 legacy ProjectChange / MetaWorkflowRun

## 12. 风险

| # | 风险 | 缓解 |
|---|-----|------|
| 1 | 三层抽象增加学习成本 | UI 主视图只显示父 Issue，drill-in 才显示更深层；anonymous sub-issue 隐藏 |
| 2 | SpecChange ↔ ExecutorInstance 状态联动复杂 | 用 EventDispatcher 解耦；写 integration test 覆盖 |
| 3 | Adapter 写错导致 statusSummary 漂移 | 每个 adapter 强制测试覆盖状态映射；提供"refresh from underlying"管理动作兜底 |
| 4 | delta merge 算法 bug 导致 corpus 损坏 | 每次 archive 前 dry-run 算 diff，UI 让用户复核；archive 操作生成 git commit，可回退 |
| 5 | 父 Issue 多 sub-issue 时 archive 时机不直观 | UI 明确显示"X of Y sub-issues archived"；feature 关闭时不自动 archive 任何东西 |
| 6 | 现有用户的 ProjectChange / MetaWorkflowRun 在新 UI 里找不到 | "Legacy" 分区明确显示；可加迁移脚本（可选触发） |
| 7 | Bootstrap 一次性扫大项目耗时长 / 结果不准 | 分批扫描（按目录）；review dialog 必须人工确认；支持"先扫部分"增量 |
| 8 | OpenSpec 文件格式未来变更 | 我们只采纳子集（Requirement + Scenario + delta 块），变更影响小；保持解析器版本可升级 |

## 13. 待评审决策

1. **Anonymous sub-issue UI 默认折叠**——同意 X2 但 UI 上完全隐藏太极端，建议默认折叠但可一键展开
2. **Bootstrap 重新扫描的 delta 是否走 review**——v1 强制 review；v2 可选 "auto-accept additions, only review changes/removals"
3. **Manual executor 类型的具体形态**——用户手动声明 "我已经按 tasks.md 改完了"，无 underlying；用于不想跑 Classic / Meta 时
4. **Feature Issue 是否允许直接挂 spec_change（不走 sub-issue）**——v1 不允许（严格分层）；v2 灵活性 vs 一致性 tradeoff

---

*文档版本：0.2 / 2026-05-21*
*取代：v0.1（commit `7c30cddb`）*
*Supervisor v1 spec-driven workflow：保留作为 ClassicAdapter 的 underlying*
*Meta Workflow Phase A-F：保留作为 MetaWorkflowAdapter 的 underlying*
