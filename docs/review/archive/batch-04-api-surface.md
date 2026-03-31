# Batch 4: Server — API Surface Review

日期：2026-03-29
状态：✅ 已完成 review 与主要修复落地

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | `server/src/{router,routes,repositories}` |
| 代码量 | ~24k 行（含测试） |
| 最大路由文件 | `sessions.ts` (756 行), `files.ts` (705 行), `import.ts` (571 行), `plugins.ts` (548 行), `providers.ts` (353 行) |
| repository 在 HTTP routes 中的直接使用 | 仅 `sessionDrafts.ts` 1 处 |

## 实施结果

Batch 4 已不只是 review，核心修复已经落地到代码：

- `projects/providers/sessions` 的 partial update 语义已统一：
  缺失字段 = 不修改，`null` = 显式清空。
- `providers/projects/sessions` 主 CRUD 已收敛到 repository。
- REST error builder 已落地到 `response.ts`，并统一到 `sessionDrafts/workspace/plugin-tools` 等路径。
- `import.ts` / `import-opencode.ts` 已提炼出 `ImportService`。
- `files.ts` 已拆成 `FileBrowseService` + `FileTransferService`。
- `sessions.ts` 已拆出：
  `SessionLifecycleService`、`SessionExportService`、`SessionQueryService`。
- `mcp-servers.ts` 已拆出 `McpServerService`。
- `plugins.ts` 已拆出：
  `PluginManagementService`、`PluginFrontendService`。
- `router/` 与 HTTP `routes/` 的职责说明已补齐。

## 发现

### 🔴 高优先级

#### 1. 部分更新语义在多个 API 中已经失真（HIGH）
- **当前状态**: 已修复
- **影响文件**:
  - `server/src/routes/projects.ts:169-190`
  - `server/src/routes/providers.ts:182-199`
  - `server/src/routes/sessions.ts:387-395`
- **问题**:
  - `projects.ts` 的 `PUT /:id` 直接把 `provider_id/root_path/system_prompt/permission_policy/...` 设为 `?`，而传参又把“字段缺失”折叠成 `null`。结果是客户端只想改一个字段时，未传字段也可能被清空。
  - `providers.ts` 的 `PUT /:id` 同样存在字段缺失即清空的问题，`cli_path` 和 `env` 最明显。
  - `sessions.ts` 的 `PUT /:id` 则是反方向问题：使用 `COALESCE(?, column)` 且把空值转成 `null`，导致 `providerId`、`sdkSessionId` 无法显式清空。
- **影响**:
  - 前端无法稳定预测“未传字段”“传 null”“传空字符串”三者的区别。
  - 同一套 REST API 内部的 patch 语义不一致，容易造成配置被意外抹掉或根本无法重置。
- **修复建议**:
  - 明确统一语义：缺失字段 = 不修改，`null` = 显式清空。
  - 复用 repository 的动态 `updateQuery()` 风格，避免 route 手写 `COALESCE` / `?` 混搭。

### 🟠 中优先级

#### 2. repository 抽象没有成为 API Surface 的稳定入口（MEDIUM）
- **当前状态**: 核心资源已修复，剩余少量非核心 route 仍可继续收敛
- **影响文件**:
  - `server/src/routes/projects.ts`
  - `server/src/routes/providers.ts`
  - `server/src/routes/sessions.ts`
  - `server/src/routes/sessionDrafts.ts:8`
  - `server/src/repositories/project.ts:77-132`
  - `server/src/repositories/provider.ts:65-98`
- **问题**:
  - `routes/` 大量直接 `db.prepare(...)`，而 `repositories/` 已经维护了独立的映射和动态更新逻辑。
  - 当前 HTTP 路由里只有 `sessionDrafts.ts` 直接实例化 repository，项目/会话/provider 这些核心资源都绕过了 repository。
  - 结果是 route 与 repository 出现双份写法，并且行为已经分叉，例如 `ProjectRepository.updateQuery()` 的 partial-update 语义和 `projects.ts` 的 REST 更新语义并不一致。
- **影响**:
  - repository 无法承担稳定抽象层角色，导致 SQL、字段映射、默认值策略分散在路由文件里。
  - 后续改 schema 或字段语义时，容易出现“domain/service 修了，HTTP route 没修”的 API 漂移。
- **修复建议**:
  - 先从 `projects/providers/sessions` 三个核心 REST 资源开始，把读写逻辑收敛到 repository 或 service。
  - route 层只保留参数校验、鉴权、HTTP 状态码映射。

#### 3. route 层承担了过多 domain / infra 侧效果，是典型“胖 route”（MEDIUM）
- **当前状态**: 主要路径已拆分，剩余 route 体量风险已显著下降
- **影响文件**:
  - `server/src/routes/sessions.ts:305-418`
  - `server/src/routes/files.ts:192-520`
  - `server/src/routes/import.ts`
- **问题**:
  - `sessions.ts` 同时负责参数校验、DB 写入、排序策略、active run 派生状态、gateway catalog 广播、plugin event 广播。
  - `files.ts` 同时负责上传、临时文件清理、目录遍历、二进制探测、下载流、会话消息广播。
  - `import.ts` 直接承载扫描 Claude CLI 目录、解析 JSONL、冲突处理、DB 写入。
- **影响**:
  - 路由文件既是控制器又是应用服务，导致单文件不断膨胀，单测也被迫围绕 HTTP 外壳编写。
  - 这些行为难以被 WebSocket、计划任务、CLI 或其他入口复用。
- **修复建议**:
  - 提取 `SessionAppService` / `FileBrowseService` / `ImportService` 这类用例层。
  - route 只做 request/response 适配，复杂流程下沉。

#### 4. API 错误响应格式已经分裂（MEDIUM）
- **当前状态**: 主要 REST 路径已统一，剩余问题已不是 Batch 4 主风险
- **影响文件**:
  - `server/src/routes/sessionDrafts.ts:55,79-81,109,132,145,150,163,168`
- **问题**:
  - `sessionDrafts.ts` 有的接口返回 `{ success: false, error: { code, message } }`，有的直接返回字符串 `error: String(error)`，还有的直接返回 `error: 'No draft found'`。
  - 同一个 route 文件里已经出现至少三种 error shape。
- **影响**:
  - 前端需要做分支兼容，或者在错误展示时退化成 `[object Object]` / 原始字符串。
  - API surface 失去可预测性，削弱 shared `ApiResponse` 的价值。
- **修复建议**:
  - 为 REST 路由统一 error builder，强制所有路径输出 `{ code, message }`。
  - 把 repository/service 抛出的领域错误映射成稳定的 API 错误码。

#### 5. `router/` 与 `routes/` 的职责命名已经混淆（MEDIUM）
- **当前状态**: 已补文档与注释说明，命名仍可后续再做物理重命名
- **影响文件**:
  - `server/src/router/index.ts`
  - `server/src/server.ts:209-211`
  - `server/src/server-setup.ts:208-316`
- **问题**:
  - `router/index.ts` 实际是 WebSocket message router + middleware 组合器，不是 Express API router。
  - 但当前 Batch 4 的实际 HTTP surface 在 `server-setup.ts` 里通过 `app.use('/api/...')` 装配，`server.ts` 注释又写着 “CRUD routes migrated to HTTP REST”，让 `router` 与 `routes` 的边界更难理解。
- **影响**:
  - 新人很容易把 `router/` 误认为 REST 路由总入口。
  - review 和后续重构时，会把 WS message routing 与 HTTP API surface 混在一起。
- **修复建议**:
  - 将 `server/src/router/` 明确重命名为 `message-router/` 或在目录级 README / 注释中声明其仅服务于 WS 路径。
  - HTTP 路由装配入口统一锚定在 `server-setup.ts`。

## ✅ 做得好的

1. `server-setup.ts` 已经把大多数 HTTP 路由挂载集中到一个地方，入口位置是可追踪的。
2. `sessionDrafts.ts` 证明 repository 驱动的 route 写法是可行的，说明架构并非完全缺位，只是没有推广。
3. 路由测试覆盖面广，`sessions/providers/files/import` 都已经有较完整的回归测试。

## 建议修复顺序

### Phase 1: 先修语义错误
- [x] 统一 `projects/providers/sessions` 的部分更新语义
- [x] 补“字段缺失不修改 / null 显式清空”的回归测试

### Phase 2: 收敛抽象边界
- [x] 让 `projects/providers/sessions` 三个 REST 资源复用 repository / service
- [x] 为 route 层补统一 error builder

### Phase 3: 降低 route 膨胀
- [x] 从 `sessions.ts`、`files.ts`、`import.ts` 提炼应用服务
- [x] 明确 `router/` 与 HTTP `routes/` 的命名与职责说明

### 已落实
- 已在 `server/src/router/README.md`、`server/src/server.ts`、`server/src/server-setup.ts` 明确标注：
  `server/src/router/` 是 WebSocket message router，不是 REST router；
  HTTP API surface 的装配入口以 `server-setup.ts` 为准。
- 已在 `server/src/services/` 落地的 Batch 4 相关服务包括：
  `ImportService`、`FileBrowseService`、`FileTransferService`、
  `SessionLifecycleService`、`SessionExportService`、`SessionQueryService`、
  `McpServerService`、`PluginManagementService`、`PluginFrontendService`。
- `sessions.ts`、`files.ts`、`import.ts`、`plugins.ts`、`mcp-servers.ts`
  的核心业务逻辑都已从 route/controller 层下沉。
