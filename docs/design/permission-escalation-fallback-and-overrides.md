# Permission Escalation Fallback And Overrides

## Status

- Status: Draft
- Owners: MyClaudia
- Scope: Permission escalation workflow selection, system fallback, global/project overrides

---

## 1. Background

当前权限升级链路依赖 workflow engine 处理 `permission.escalated` 事件，并在 workflow 中完成：

- permission classification
- AI risk analysis
- auto-approve / keep waiting for user

但现有实现存在几个结构性问题：

1. 系统没有强约束保证 permission escalation workflow 一定可用。
2. 当前默认依赖一条 global builtin workflow，但这条 workflow 仍然被当作普通 workflow 管理。
3. `createFromTemplate()` 采用 toggle 语义，容易把关键 workflow 切到 `disabled`。
4. 设计语义不清晰。用户侧看到的是 “workflow”，但系统真正需要的是一个不可失效的权限升级处理能力。
5. 如果 override workflow 缺失、被禁用、配置损坏或运行失败，当前缺少正式的 fallback 语义。

本设计的核心目标是把 “Permission Escalation Workflow” 从普通用户 workflow 提升为系统级能力，并允许 global / project 级覆盖。

---

## 2. Goals

### 2.1 Primary Goals

- 系统始终存在且可执行一条 permission escalation fallback workflow
- fallback workflow 不可编辑、不可删除、不可禁用
- 支持 global 和 project 维度的 permission workflow override
- override 不可用时自动回退到系统 fallback
- UI 语义从 “启用/禁用模板实例” 改为 “选择是否启用 override”
- 运行时权限升级路径可观测，可明确知道当前命中了哪一层

### 2.2 Secondary Goals

- 避免为每个 project 复制一份默认 workflow 实例
- 避免 builtin workflow 被误操作后导致权限系统整体失效
- 为后续项目级策略定制提供稳定边界
- 让迁移历史数据成本最小化

### 2.3 Non-Goals

- 不在本设计中重做 permission evaluator 分类规则
- 不改变现有 AI risk analysis step 的核心算法
- 不在第一阶段开放 system fallback 的可视化编辑
- 不在第一阶段支持多条 override 级联组合执行

---

## 3. Design Principles

### 3.1 System Invariant First

权限升级处理能力属于系统底层能力，不应依赖用户手工创建或保持某条 workflow。

### 3.2 Override, Not Mutation

用户只能通过 override 改写默认行为，不能直接修改系统 fallback。

### 3.3 Explicit Resolution Order

运行时必须有清晰、固定的 workflow 解析优先级，不能靠 “当前有哪些 active workflow 在监听事件” 隐式决定。

### 3.4 Safe Degradation

override workflow 缺失、禁用、损坏、运行失败时，系统自动回退到 fallback，而不是卡死或静默丢失 AI review。

### 3.5 Operational Transparency

系统应能明确记录：

- 当前使用的是 project override / global override / system fallback
- 为什么 override 未被使用
- fallback 是否因异常接管

---

## 4. Proposed Model

权限升级 workflow 改为三层解析模型：

1. project override
2. global override
3. system fallback

其中：

- `system fallback` 永远存在，且不可失效
- `global override` 是可选的全局覆盖
- `project override` 是可选的项目级覆盖

运行时只解析出一条最终 workflow，不做多条 workflow 并行竞争。

---

## 5. Architecture

### 5.1 System Fallback Workflow

新增一个系统级 permission escalation workflow 概念：

- 固定 template id: `permission-escalation-default`
- 固定 system identity: `system_permission_escalation`
- 不属于任何 project
- 不出现在普通 workflow 列表中
- 不允许通过通用 CRUD / from-template 接口修改
- 启动时必须 ensure exists and active

建议数据层增加显式标记，而不是继续仅靠 `project_id IS NULL` 推断：

- `workflows.is_system INTEGER NOT NULL DEFAULT 0`
- `workflows.system_key TEXT NULL`

对于 system fallback：

- `is_system = 1`
- `system_key = 'permission_escalation_fallback'`

### 5.2 Override Workflows

override workflow 仍然使用现有 workflow 实体，但语义变化为 “用户覆盖层”。

建议增加配置绑定，而不是通过事件监听自动碰撞：

- global settings:
  - `permission_workflow_override_id TEXT NULL`
- project settings:
  - `projects.permission_workflow_override_id TEXT NULL`

规则：

- `NULL` 表示未启用 override
- 非空表示明确绑定一条 workflow 作为 override
- 该 workflow 可以是 global workflow，也可以是 project-owned workflow
- project override 必须与 project 作用域匹配

### 5.3 Workflow Resolution Service

新增专门的解析服务，例如：

- `PermissionWorkflowResolver`

职责：

1. 读取 project override 配置
2. 读取 global override 配置
3. 验证 workflow 是否可用
4. 返回最终可执行 workflow
5. 返回 resolution metadata 供日志、UI 和 telemetry 使用

建议返回结构：

```ts
interface ResolvedPermissionWorkflow {
  workflowId: string;
  source: 'project_override' | 'global_override' | 'system_fallback';
  fallbackReason?: string;
}
```

---

## 6. Runtime Behavior

### 6.1 Resolution Order

当发生 `permission.escalated` 时：

1. 如果当前 session 关联 project，先检查该 project 的 `permission_workflow_override_id`
2. 如果 project override 不可用，检查 global override
3. 如果 global override 不可用，使用 system fallback

### 6.2 What Counts As “Unavailable”

override workflow 以下任一情况都视为不可用：

- workflow 不存在
- workflow `status != active`
- workflow schema 非法
- 引用的 step type 不存在
- 关键 permission steps 缺失
- workflow trigger / definition 不满足 permission escalation contract

建议把 “定义非法” 和 “运行时执行失败” 区分开：

- `invalid_override`: 启动前即可判定
- `runtime_failed_override`: 启动后执行失败

### 6.3 Runtime Failure Fallback

若 override workflow 已被选中，但在执行 early stage 失败：

- 记录失败原因
- 立即触发 system fallback workflow
- 原始 permission request 保持同一个 `requestId`
- UI 展示为 “Primary workflow failed, fallback engaged”

是否允许 fallback 接管已经运行到一半的 override：

- 第一阶段建议只在 workflow run 启动失败或早期 step failed 时接管
- 若 override 已完成 `permission_decide`，则不再 fallback

### 6.4 Event Subscription Model

不再把 permission escalation 依赖于“有哪些 active workflow 正在监听 `permission.escalated`”。

改为：

- `run-permissions.ts` 在收到 permission escalation 后，调用 resolver 选定目标 workflow
- 直接 `workflowService.triggerWorkflow(resolvedWorkflowId, 'event', ...)`

这样可以绕开当前隐式事件订阅模型的不确定性。

`permission.escalated` 事件仍可保留给插件或观测使用，但不再作为权限 workflow 触发的唯一机制。

---

## 7. UI / UX

### 7.1 System Fallback Visibility

system fallback 不应作为普通 workflow 出现在 workflows panel 中。

可在设置页显示：

- `System Permission Escalation Workflow`
- 状态：`Healthy`
- 来源：`Built-in`
- 不可编辑、不可禁用

### 7.2 Enable Override UX

UI 文案建议从：

- “Enable Permission Escalation Workflow”

改成：

- `Use Project Permission Override`
- `Use Global Permission Override`

交互行为：

1. 用户选择启用 override
2. 用户选择一条可用 workflow
3. 系统保存 override binding
4. UI 明确显示 fallback chain

例如：

- Project Override: `My Project Review Workflow`
- Fallback: `System Permission Escalation Workflow`

### 7.3 Edit UX

用户编辑的是 override workflow，不是 system fallback。

如果用户试图编辑 system fallback：

- UI 不提供入口
- 后端接口返回 forbidden

### 7.4 Invalid Override UX

若 override 配置无效：

- 设置页显示 warning
- 标记当前系统将自动回退到 fallback
- 提供 “Fix binding” 或 “Disable override” 操作

---

## 8. Data Model Changes

### 8.1 Workflows Table

新增字段：

```sql
ALTER TABLE workflows ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflows ADD COLUMN system_key TEXT;
```

约束：

- `system_key` 在 `is_system = 1` 时必须唯一
- `permission_escalation_fallback` 只允许存在一条

### 8.2 Projects Table

新增字段：

```sql
ALTER TABLE projects ADD COLUMN permission_workflow_override_id TEXT;
```

### 8.3 Global Settings

新增系统设置项：

- `permission_workflow_override_id`

若已有 settings 表，直接落入现有系统配置；否则新增专用配置存储。

---

## 9. API Changes

### 9.1 New System Workflow API

新增只读接口：

- `GET /api/system/permission-workflow`

返回：

- fallback workflow health
- active global override
- optional project override health

### 9.2 Override Binding APIs

新增接口：

- `PUT /api/settings/permission-workflow-override`
- `PUT /api/projects/:projectId/permission-workflow-override`
- `DELETE /api/projects/:projectId/permission-workflow-override`

### 9.3 Workflow CRUD Restrictions

对 system fallback：

- `PUT /api/workflows/:id` forbidden
- `DELETE /api/workflows/:id` forbidden
- `POST /from-template/...` 不可作用于 system fallback

### 9.4 Remove Toggle Semantics For Critical Templates

`createFromTemplate()` 不应继续承担 toggle 语义，至少对 permission escalation 模板必须移除。

建议拆成：

- `ensureFromTemplate()`
- `disableWorkflow()`

或保留旧接口但对关键模板返回错误，强制改用 override binding API。

---

## 10. Migration Plan

### Phase 1: Introduce Fallback Model

1. 增加新字段
2. 创建 system fallback 标记
3. 启动时 ensure fallback exists, active, immutable
4. 引入 resolver 和 direct trigger 路径
5. 保留旧 workflow CRUD，先不清理旧数据

### Phase 2: Migrate Existing Installations

对现有数据库执行：

1. 查找 `template_id = 'permission-escalation-default'` 的 global workflow
2. 若不存在，创建 system fallback
3. 若存在一条 global workflow：
   - 标记为 system fallback
   - 强制设为 `active`
4. 若存在多条同模板 workflow：
   - 选择最早或系统当前正在使用的一条作为 fallback
   - 其余标记为普通 workflow 或写入迁移告警

### Phase 3: UI Cutover

1. 隐藏 system fallback 的普通 workflow 展示
2. 新增 override binding 设置
3. 明确展示 resolution chain

### Phase 4: Remove Legacy Assumptions

1. 不再依赖 `pluginEvents.hasListeners('permission.escalated')`
2. 不再假设 active workflow 订阅集合天然代表系统可用性
3. 对 permission template 禁用 from-template toggle

---

## 11. Observability

每次权限升级记录：

- `requestId`
- `sessionId`
- `projectId`
- `resolvedWorkflowId`
- `resolvedSource`
- `fallbackReason`
- `overrideValidationError`
- `overrideRuntimeFailure`

建议新增事件：

- `permission_workflow_resolved`
- `permission_workflow_fallback_engaged`

这两个事件同时可用于 debug logs、notification feed 和 telemetry。

---

## 12. Security And Reliability

### 12.1 Why System Fallback Must Be Immutable

permission escalation 是安全边界的一部分。若 fallback 可编辑或可禁用，则：

- 用户误操作会让系统丢失审批保护
- 插件或错误逻辑可能破坏关键链路
- 运行时难以确认系统是否仍满足安全基线

### 12.2 Why Override Must Not Replace Fallback

override 是可选增强，不应成为唯一执行路径。任何可编辑内容都必须有不可编辑基线兜底。

### 12.3 Failure Semantics

若 override 不可用：

- 不阻塞用户审批
- 不阻塞 AI review fallback
- 不导致 UI 卡在 `Workflow processing...`

---

## 13. Testing Plan

### 13.1 Unit Tests

- resolver 按 project -> global -> fallback 顺序解析
- project override 缺失时回退 global override
- global override 缺失时回退 fallback
- invalid override 不被选中
- system fallback 无法被 update / delete
- system fallback 无法被 disable
- system fallback 缺失时 `ensure` 会自动重建
- system fallback 为 `disabled` 时 `ensure` 会强制恢复为 `active`
- system fallback definition 被破坏时 `ensure` 会恢复到内建默认定义
- permission runtime 在无任何 override 时总能解析到 fallback

### 13.2 Integration Tests

- project 配置 override 后，权限升级触发 project workflow
- project override disabled 时，自动回退 global override
- global override disabled 时，自动回退 fallback
- fallback 永远存在且 active
- UI 不再把 fallback 展示为普通可编辑 workflow
- server 启动后即使数据库中缺少 fallback，也会自动补齐
- server 启动后即使数据库中 fallback 被误标记为 disabled，也会自动修复
- override 配置指向不存在 workflow 时，权限升级仍能通过 fallback 完成
- override 配置指向 schema 非法 workflow 时，权限升级仍能通过 fallback 完成
- override workflow run 在 early-step 失败时，system fallback 自动接管
- permission request 在 fallback 接管后仍保持同一个 `requestId`
- fallback 接管后前端会收到明确的 resolved source / fallback reason

### 13.3 Regression Tests

- `Workflow processing...` 不会在无实际 workflow run 时显示
- permission escalation 不依赖 active workflow subscriptions
- 历史数据库升级后仍可正常处理审批
- 系统中所有 override 都被删除后，permission escalation 仍然可用
- 用户重复调用 template 启用接口不会破坏 system fallback
- workflow CRUD 接口无法影响 system fallback 的可执行性

### 13.4 End-To-End Scenarios

建议补充以下 e2e 场景，作为发布阻断项：

1. `fallback-only`
- 无 project override
- 无 global override
- 触发 outside-workspace permission
- 验证 fallback workflow 被执行
- 验证 request 最终被正常 auto-resolve 或转人工审批

2. `project-override-preferred`
- project override 有效
- global override 有效
- 触发 permission
- 验证命中 project override，而不是 global / fallback

3. `global-override-preferred-over-fallback`
- 无 project override
- global override 有效
- 触发 permission
- 验证命中 global override

4. `invalid-project-override-falls-back`
- project override 指向不存在或非法 workflow
- global override 不存在
- 触发 permission
- 验证直接回退到 fallback

5. `runtime-failed-override-falls-back`
- project 或 global override 在 `classify` / `ai_review` early step 故意失败
- 触发 permission
- 验证 fallback 接管成功

6. `fallback-self-healing-on-startup`
- 启动前手动删除或禁用 fallback 记录
- 启动 server
- 验证 fallback 被自动补齐并恢复 active

### 13.5 Reliability Assertions

建议把以下断言固化到测试 helper 中，所有 permission workflow 集成测试复用：

- `assertSystemFallbackExists()`
- `assertSystemFallbackActive()`
- `assertSystemFallbackImmutable()`
- `assertResolvedSource(expected)`
- `assertFallbackReason(expected)`
- `assertPermissionCompletesWithoutDeadlock()`

其中 `assertPermissionCompletesWithoutDeadlock()` 应明确检查：

- permission request 已发送
- 至少一条 workflow run 或 fallback resolution 事件已发生
- session 不会无限停留在 `waiting`
- 前端不会永久显示 `Workflow processing...`

### 13.6 Production Guardrails

除测试外，建议增加运行时 guard：

- server 启动 health check 中校验 fallback 是否存在且 active
- 若 fallback 不健康，启动日志打印 `fatal` 级告警
- debug / diagnostics 接口暴露当前 fallback 状态
- notification / telemetry 记录 fallback self-heal 次数

测试目标不是仅验证 “fallback 能跑”，而是验证下面这个系统不变量：

> 对任意 permission escalation，请求最终总能落到一条可执行路径；即使所有 override 都失效，system fallback 仍然可工作。

---

## 14. Rollout Plan

### Stage 1

- 后端引入 immutable fallback + resolver
- 保持 UI 兼容
- 必须同步落地 unit tests:
  - fallback ensure / self-heal
  - resolver resolution order
  - fallback immutability
- 必须同步落地 integration tests:
  - no override -> fallback
  - invalid override -> fallback
  - disabled override -> fallback

### Stage 2

- 前端切换到 override binding 模型
- 展示 resolution chain
- 必须同步落地 e2e:
  - fallback-only
  - global-override-preferred-over-fallback
  - project-override-preferred
  - invalid-project-override-falls-back

### Stage 3

- 收紧旧接口
- 禁止 permission template 的 toggle 行为
- 必须同步落地 regression tests:
  - template enable API 不再破坏 fallback
  - workflow CRUD 无法 disable / edit / delete fallback
  - 无 active workflow subscription 时 permission escalation 仍可完成

### Stage 4

- 引入 override runtime failure 接管
- 增加 production diagnostics / health guard
- 必须同步落地 integration + e2e:
  - runtime-failed-override-falls-back
  - fallback-self-healing-on-startup
  - permission request completes without deadlock

---

## 15. Implementation Plan

### 15.1 Phase A: System Fallback Foundation

目标：

- 为 workflow 增加 system fallback 标记
- server 启动时确保 fallback 存在、active、definition 正确
- 禁止普通 CRUD 修改 fallback

实现项：

1. 数据迁移
- `workflows.is_system`
- `workflows.system_key`

2. repository / service 能力
- `findSystemWorkflow(systemKey)`
- `ensureSystemPermissionFallback()`
- `repairSystemPermissionFallbackIfNeeded()`

3. route guard
- update / delete / disable fallback -> forbidden

4. 测试
- unit:
  - create missing fallback
  - revive disabled fallback
  - restore corrupted fallback definition
  - reject update/delete against fallback
- integration:
  - startup self-heal with missing fallback
  - startup self-heal with disabled fallback

Phase A 完成标准：

- 系统任何时刻都能从 DB 中解析出一条 healthy fallback
- 普通 API 无法破坏 fallback

### 15.2 Phase B: Resolver And Direct Trigger Path

目标：

- permission escalation 不再依赖 event listener 隐式订阅
- 运行时由 resolver 显式选出 workflow

实现项：

1. 新增 `PermissionWorkflowResolver`
- project override
- global override
- system fallback

2. 修改 `run-permissions.ts`
- escalation 时直接调用 resolver
- 直接 `triggerWorkflow(resolvedWorkflowId, ...)`
- 记录 resolved source / fallback reason

3. 增加新事件
- `permission_workflow_resolved`
- `permission_workflow_fallback_engaged`

4. 测试
- unit:
  - resolution order
  - override unavailable reasons
- integration:
  - no override -> fallback
  - project override -> preferred
  - global override -> preferred
  - invalid override -> fallback
- regression:
  - no listeners on `permission.escalated` still works

Phase B 完成标准：

- workflow resolution 行为完全可预测
- permission escalation 与 active workflow subscription 解耦

### 15.3 Phase C: Override Binding APIs And UI Model

目标：

- UI 不再通过 template toggle 管理 permission escalation
- 改为 binding 一个 override workflow

实现项：

1. 新增配置字段
- global `permission_workflow_override_id`
- project `permission_workflow_override_id`

2. 新增 API
- set / clear global override
- set / clear project override
- get current resolution chain

3. 前端设置页
- 展示 system fallback
- 展示 current override
- 展示 fallback chain

4. 测试
- integration:
  - bind valid project override
  - clear override
  - bind invalid workflow rejected or marked unhealthy
- e2e:
  - user enables project override
  - user enables global override
  - UI shows fallback chain correctly

Phase C 完成标准：

- 用户能清楚区分 fallback 和 override
- 不再通过 from-template toggle 管理 permission escalation

### 15.4 Phase D: Runtime Failure Takeover

目标：

- override workflow 在执行 early stage 失败时由 fallback 自动接管

实现项：

1. 定义可接管失败边界
- workflow start failed
- classify failed
- ai review failed before decision

2. 接管机制
- 保持同一 `requestId`
- 重新触发 fallback run
- 向前端广播 fallback engaged

3. 测试
- integration:
  - early-step failure -> fallback takes over
  - same requestId preserved
- e2e:
  - runtime-failed-override-falls-back
  - no deadlock in UI

Phase D 完成标准：

- override 的运行失败不会导致 permission escalation 中断或卡死

### 15.5 Phase E: Cleanup And Guardrails

目标：

- 清理旧语义
- 增加运行时健康检查

实现项：

1. 收紧旧接口
- permission template 禁止 `createFromTemplate()` toggle

2. diagnostics
- fallback health endpoint / debug API
- self-heal count logging

3. startup guard
- fallback unhealthy -> error log / diagnostics surface

4. 测试
- regression:
  - old template toggle no longer impacts fallback
  - diagnostics reflect current resolution state
- operational:
  - health check reports fallback status

Phase E 完成标准：

- 历史路径不会再破坏 fallback
- 运维上可观察 fallback 状态
---

## 16. Open Questions

1. global override 应绑定到任意 workflow，还是只能绑定特定标记的 permission-compatible workflow？
2. project override 是否必须归属于该 project，还是允许引用 global workflow？
3. override runtime failure 的 fallback 接管边界是否需要更细粒度定义？
4. 是否需要在 notification center 中显式提示 “override failed, system fallback engaged”？
5. 是否要支持导出 system fallback 的只读副本供用户参考？

---

## 17. Recommendation

推荐采用本设计，原因如下：

- 它把 permission escalation 从“普通 workflow 配置”提升为“系统安全能力”
- 它保留 global/project 级灵活性，但不会破坏系统兜底
- 它消除了当前实现中最危险的状态：关键 workflow 被误关后系统无感失效
- 它比“每个 project 自动复制一条默认 workflow”更稳定、更易迁移、更易升级

最终原则应固定为：

- 系统永远有一条不可失效的 permission escalation fallback
- 用户只能覆盖，不能破坏基线
- 任意 override 出问题时，系统自动回退到底线能力
