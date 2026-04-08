# MyClaudia 边界落位约定

日期：2026-04-08
状态：Active

## 目的

把当前已经完成的结构收敛成一组可执行规则，避免新代码重新回到“名字分层了，但职责还是混着放”的状态。

这份文档不讨论完整 DDD，只回答两个问题：

- 新代码应该放到哪里
- 哪些依赖方向应该避免

## 服务端约定

### `application/`

用于组合、装配、跨上下文编排。

适合放在这里的内容：

- composition root
- port 定义与 adapter 组装
- 跨多个 domain 的流程协作
- 与 transport、gateway、plugin、tool registry 相关的应用层入口

当前例子：

- [`server/src/application/domain-bootstrap.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/application/domain-bootstrap.ts)
- [`server/src/application/bootstrap/feature-domains.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/application/bootstrap/feature-domains.ts)
- [`server/src/application/bootstrap/domain-ports.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/application/bootstrap/domain-ports.ts)
- [`server/src/application/bootstrap/platform-routes.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/application/bootstrap/platform-routes.ts)

不要放在这里的内容：

- 直接承载单个 domain 的核心持久化规则
- 只服务于单个 domain 的局部业务对象
- 只是某个 HTTP 路由的请求解析

### `domains/<name>/routes.ts`

只负责 HTTP 层职责。

应该保留的内容：

- 请求参数读取
- 基本请求校验
- domain/service 调用
- 错误到 HTTP 响应码的映射
- 成功响应序列化

不应该继续新增的内容：

- 原始 SQL
- 大段 git / fs / path 副作用
- 跨 backend / 跨 domain 编排

当前例子：

- [`server/src/domains/projects/routes.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/domains/projects/routes.ts)

### `domains/<name>/repository.ts`

负责该 domain 的持久化访问规则。

适合放在这里的内容：

- 查询
- 写入
- 事务
- 不涉及跨对象编排的存储规则

当前例子：

- [`server/src/domains/projects/repository.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/domains/projects/repository.ts)

约束：

- repository 不负责 HTTP 错误码
- repository 不直接做跨 domain 协调

### `domains/<name>/*-service.ts`

用于承接单个 domain 内、但又不适合塞进 route 或 repository 的业务副作用。

适合放在这里的内容：

- git worktree
- 文件系统 best-effort 维护
- 单个 domain 的局部规则推导

当前例子：

- [`server/src/domains/projects/worktree-service.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/domains/projects/worktree-service.ts)

优先级：

1. 纯存储规则，放 `repository`
2. 单 domain 业务副作用，放 `service`
3. 跨 domain 协调，放 `application`

## 前端约定

### `stores/`

一个 store 只拥有一种主责。

当前主责划分：

- [`apps/desktop/src/stores/projectStore.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/stores/projectStore.ts): 项目与会话数据
- [`apps/desktop/src/stores/selectionStore.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/stores/selectionStore.ts): 当前选中状态与 dashboard view
- [`apps/desktop/src/stores/providerMetaStore.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/stores/providerMetaStore.ts): provider 元数据与能力

新增状态时优先判断：

1. 这是数据本身，还是 UI 选择状态
2. 这是 provider 元数据，还是 project/session 数据
3. 这是长期主数据，还是兼容镜像

约束：

- 不要把新的 provider 元数据继续写回 `projectStore`
- 不要把新的 selection 状态继续塞进 `projectStore`

### `services/`

用于前端跨 store、跨 backend 的编排逻辑。

当前例子：

- [`apps/desktop/src/services/selectionCoordinator.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/services/selectionCoordinator.ts)
- [`apps/desktop/src/services/messageHandler.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/services/messageHandler.ts)

适合放在这里的内容：

- backend 切换
- 多 store 协作
- transport / message 分发
- 需要延迟重试或重选的流程

不适合放在 store 的内容：

- 主动切 backend
- 从远端 session 反查 owner backend
- 消息总分发

### `features/`

用于 feature 边界内的 UI 和消息处理收口。

当前例子：

- [`apps/desktop/src/features/message-dispatcher.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/features/message-dispatcher.ts)

约束：

- 新 feature 的消息处理优先注册到 dispatcher，而不是直接扩展全局 `messageHandler` import 面

## 落位判断顺序

新增代码时，按下面顺序判断：

1. 它是不是跨 domain / 跨 backend 编排？
2. 如果不是，它是不是纯持久化规则？
3. 如果不是，它是不是单个 domain 的局部副作用？
4. 如果都不是，再看它是否只是 HTTP / UI 接线代码。

对应落点：

1. `application/` 或前端 `services/`
2. `repository.ts`
3. `*-service.ts`
4. `routes.ts` / component / hook

## 明确禁止的回退

- 不要在 `routes.ts` 里重新引入原始 SQL
- 不要在前端 `projectStore` 里继续长出 provider metadata 或 backend 切换编排
- 不要把新的跨 domain 组合逻辑重新塞回 `domain-bootstrap.ts`
- 不要让 `messageHandler.ts` 再直接感知具体 feature handler 列表

## 当前状态

- 服务端 `domains/*/routes.ts` 的原始 SQL 守卫已是零豁免状态
- 新增 domain route 如果重新写 `db.prepare(...)` 或 `db.transaction(...)`，`check:architecture` 会直接失败

## 本轮重构后的基线

当前可以作为参考的边界基线：

- 服务端装配入口：[`server/src/application/domain-bootstrap.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/application/domain-bootstrap.ts)
- 服务端 `projects` domain：[`server/src/domains/projects/routes.ts`](/Users/zhvala/SourceCode/my-claudia/server/src/domains/projects/routes.ts)
- 前端 selection 编排：[`apps/desktop/src/services/selectionCoordinator.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/services/selectionCoordinator.ts)
- 前端消息分发：[`apps/desktop/src/features/message-dispatcher.ts`](/Users/zhvala/SourceCode/my-claudia/apps/desktop/src/features/message-dispatcher.ts)

后续新增代码如果明显偏离这些模式，默认先停下来判断落位，而不是先写进去再补救。
