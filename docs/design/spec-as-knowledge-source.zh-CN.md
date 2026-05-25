# Spec 作为项目知识源：四层模型重构

> 状态：草案 / Draft
> 作者：讨论产出，待评审
> 关联：`supervisor-spec-driven-workflow-v1.zh-CN.md`、`openspec-integration-v2.zh-CN.md`

## 背景

当前 MyClaudia 在"项目工作流"这块存在三个互相重叠但定位不清的概念，分散在不同的 UI 面板里：

1. **Supervisor / ProjectChange** —— 把变更拆成 design → execution → acceptance 三道闸门，由 supervisor agent 协助、人工把关。
2. **OpenSpec corpus + Issue** —— 通过 `specs/*.md` 维护项目规约，通过 `LocalIssue`（含 `feature` 父容器 + 4 类子条目）管理需求和缺陷。
3. **SupervisionTask** —— 可调度、可执行的工作单元，可挂在 Change 上也可游离存在。

三者的事实关系（代码层面已经在了）：

- `LocalIssue.specChangeId?` 指向一个 `ProjectChange`（Issue → Change）
- `SupervisionTask.changeId?` 指向一个 `ProjectChange`（Task → Change）
- ProjectChange 本身改的是 `.supervision/baseline/` 下的项目文档，和 openspec `specs/` 是双知识源

但在 UI 上，Spec / Change / Issue / Task 散在 4 个面板里，看不出它们是一条链，导致：

- 用户分不清"我现在该开 Issue 还是 Change"
- Supervisor 的 `baseline/` 和 openspec `specs/` 双源不一致风险
- Task 可以游离于 Change 之外，AI 改动失去审计链
- "OpenSpec" 这个名字把"项目知识"和"某个开源实现"绑死，未来迁移到其他 spec 引擎要全局改名

## 设计目标

1. **统一项目知识源**：项目"应该是什么样"由唯一的 Spec corpus 承载。
2. **统一变更入口**：所有对 Spec 的修改都经过 Change（含 design/execution/acceptance 闭环），保证审计链。
3. **统一执行单元**：所有 AI 可执行的工作都是 Task，且必须归属某个 Change。
4. **统一需求入口**：用户/外部诉求由 Issue 承载，Issue 不直接改 Spec —— 推进必须升级成 Change。
5. **架构留扩展口**：UI 文案中性化，底层实现保留 openspec 命名；未来接入其他 spec 引擎时改造路径清晰。

## 非目标

- **不**为多 spec 引擎建抽象层（YAGNI，等真有第二个引擎时再抽）
- **不**改 openspec 内部的目录、API 路径、数据模型命名
- **不**在本期讨论 Meta Workflow 与 Change 的合并/取舍

## 概念模型（四层）

```
┌──────────────────────────────────────────────┐
│  Spec    = 期望状态：项目应该是什么样          │  ← 中立资产，被读/写
│            (项目知识 + 规范)                  │
└──────────────────────────────────────────────┘
                ▲ 修改 (1)
┌──────────────────────────────────────────────┐
│  Change  = 一次对 Spec 的有计划变更            │  ← design → execution → acceptance
│            (design/execution/tasks 三份文档    │
│             + gate 状态机)                    │
└──────────────────────────────────────────────┘
        ▲ 来源 (0..1)            ▼ 拆分 (1..n)
┌────────────────────┐  ┌─────────────────────┐
│  Issue             │  │  Task               │
│  = 用户/agent 视角  │  │  = AI 可执行单元     │
│    的需求/bug 入口  │  │    (依赖、验收、调度) │
└────────────────────┘  └─────────────────────┘
        ▲ 分组 (0..1)
┌────────────────────┐
│  Epic              │
│  = Issue 的容器     │
│    (主题分组)       │
└────────────────────┘
```

### 一句话角色

| 概念 | 角色 | 关键问题 |
|---|---|---|
| **Spec** | 期望状态 | "项目应该是什么样" |
| **Change** | 有目标的演进 | "这次想把 Spec 改成什么样" |
| **Issue** | 诉求入口 | "为什么要改、谁要改" |
| **Task** | 执行单元 | "具体怎么干这一步" |
| **Epic** | 分组容器 | "这些 Issue 是同一类工作" |

### 关键约束

1. **Spec 不存外部引用** —— 它是知识，不知道谁在改它。
2. **Change 是 Spec 的唯一合法修改路径** —— 没有 Change 不能改 Spec。
3. **Issue → Change 是 0..1** —— 不是每个 Issue 都升级成 Change（简单答疑可直接关闭）；一个 Issue 最多对应一次 Change。
4. **Change → Task 是 1..n** —— Change 自己不执行，必须拆 Task。
5. **Task 必须有 Change** —— 游离 Task 由系统创建的 "Ad-hoc Change" 兜底，保审计链。
6. **Issue 不直接拆 Task** —— Issue 想推进必须先升级成 Change。
7. **Epic 不携带 Change** —— Epic 仅做分组，状态机仅 `open/closed/cancelled` 三态。

## 状态机收敛

### Issue（简化为生命周期 4 态）

| 旧 7 态 | 新 4 态 | 说明 |
|---|---|---|
| open | **open** | 待分诊 |
| planning / tasks_ready / executing / reviewing | **tracked** | 已升级成 Change，状态从 `specChangeId` 投影显示 |
| closed | **closed** | 关闭 |
| cancelled | **cancelled** | 取消 |
| ~~in_progress~~ (legacy) | 迁移到 `tracked` 或 `closed` | 清除 |

**关键转变**：Issue 不再有独立工作流状态，UI 显示策略：

- 没有 `specChangeId` → 显示 `open / closed / cancelled`
- 有 `specChangeId` → 显示对应 `ProjectChange.status`（designing / executing / completed / ...）

### Change（保留现有 11 态，不动）

```
draft → designing → awaiting_design_review → planning
      → awaiting_execution_review → executing → paused
      → accepting → syncing → completed / cancelled
```

### Epic（新实体，3 态）

```
open → closed
     → cancelled
```

### Task（现有状态机不动）

不再允许 `changeId` 为空，删除前必须确认所有 Task 都有归属 Change。

## 数据模型变更

### 1. Issue 模型

```diff
 export type LocalIssueType =
-  | 'feature'        // ← 移除，独立为 Epic
   | 'implement'
   | 'bug'
   | 'enhancement'
   | 'chore';

 export type LocalIssueStatus =
   | 'open'
-  | 'planning'
-  | 'tasks_ready'
-  | 'executing'
-  | 'reviewing'
+  | 'tracked'
   | 'closed'
-  | 'cancelled'
-  | 'in_progress';  // legacy
+  | 'cancelled';

 export interface LocalIssue {
   id: string;
   projectId: string;
   title: string;
   description?: string;
   status: LocalIssueStatus;
   priority: LocalIssuePriority;
   labels: string[];
   type: LocalIssueType;
-  parentIssueId?: string;  // ← 替换为 epicId
+  epicId?: string;
   specChangeId?: string;
   isAnonymous: boolean;
   ...
 }
```

### 2. Epic 模型（新增）

```ts
export type EpicStatus = 'open' | 'closed' | 'cancelled';

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: EpicStatus;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}
```

### 3. Task 模型

```diff
 export interface SupervisionTask {
   id: string;
   projectId: string;
-  changeId?: string;
+  changeId: string;        // ← 必填
   ...
 }
```

### 4. Spec corpus 取代 baseline

- `.supervision/baseline/project.md` → 迁移为 spec corpus 中的根级条目
- `.supervision/baseline/architecture.md` → 同上
- 删除 `BaselineSetupPanel`、`hasBaselineDocs()`、`initSupervisorBaseline()` API
- Supervisor 直接读 spec corpus 作为项目知识源（不再有 baseline 概念）

## UI / 信息架构变更

### ProjectDashboard 顶级 view

```diff
 顶级 view:
+  - spec          ← 新增（原 Supervisor 的 OpenSpec sub-tab 提升）
   - supervisor    （内部三个 sub-tab 重定位）
   - issues
   - git
   - ...
```

### Supervisor 内部 sub-tab 重定位

旧（错误定位）：Classic Changes / Meta Workflows / OpenSpec —— 三种"工作模式"并列

新（正确定位）：三种都是"驱动 Change 的不同执行风格"，Spec 不再出现在 Supervisor 内部

### Spec 顶级面板（新）

- 列表视图：spec corpus 目录树 / 全文检索 / 标签
- 详情视图：Markdown 渲染 + 编辑（编辑必须经过 Change 才生效）
- 历史视图：哪些 Change 修改过这份 spec

### 文案改名

- UI 中所有 "OpenSpec" → "Spec"
- 代码层（目录、API、类型、handlers）保留 `openspec`

## 迁移策略

### 数据迁移

| 步骤 | 内容 | 风险 |
|---|---|---|
| M1 | `feature` 类型 Issue → Epic 表，`parentIssueId` → `epicId` | 中（结构调整） |
| M2 | Issue 7 态映射到 4 态（带 `specChangeId` 的非终态 → `tracked`） | 低 |
| M3 | 历史无 `specChangeId` 但处于推进态的 Issue → 批量补建"Migrated" Change | 中（需要审计回填） |
| M4 | 游离 Task（`changeId IS NULL`） → 收进默认 "Ad-hoc Change" 兜底 | 低 |
| M5 | `.supervision/baseline/*.md` → 写入 spec corpus | 中（双源切换期间需要兼容读取） |

### UI 灰度顺序

1. **A 阶段**（无风险）：UI 文案 OpenSpec → Spec（A1）
2. **B 阶段**（结构）：Spec tab 提到顶层（B1） + Supervisor sub-tab 重命名（B2）
3. **C 阶段**（数据）：C1 → C5 顺序迁移，每步可独立 PR + 回滚

### 不在本期范围

- spec 引擎抽象层
- Meta Workflow 与 Change 的关系重新设计
- Issue 评论 / 协作多人场景

## 落地清单（精简）

| ID | 改动 | 阶段 | 影响范围 |
|---|---|---|---|
| A1 | UI 文案 OpenSpec → Spec | A | UI |
| A2 | Issue 状态徽章按 `specChangeId` 投影显示 | A | UI |
| B1 | Spec tab 提升到 ProjectDashboard 顶级 | B | UI / 路由 |
| B2 | Supervisor sub-tab 重定位为 Change 执行风格 | B | UI |
| C1 | Issue 状态机 7 → 4 态 | C | 数据 + UI |
| C2 | Issue 推进必须经 Change（新增约束） | C | 业务规则 |
| C3 | Task `changeId` 改必填 + Ad-hoc Change 兜底 | C | 数据 + 业务 |
| C4 | Baseline 完全迁入 Spec corpus，删除 baseline 概念 | C | 数据 + API + UI |
| C5 | `feature` type → Epic 独立实体 | C | 数据模型 + UI |

## 开放问题

- **Spec 编辑权限**：用户能否在 Spec 面板直接编辑，还是必须开 Change？倾向"必须开 Change"以保审计链，但允许"Ad-hoc Change"快速通道。
- **历史 baseline 文件保留期**：迁入 spec 后旧 `.supervision/baseline/` 是否保留一段时间作为回滚备份？
- **Issue → Change 升级体验**：是一键升级（自动建 Change）还是引导用户填写 design/scope？后者更规范但摩擦更大。
