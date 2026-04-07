# MyClaudia 领域分类

日期：2026-04-07
状态：Active

## 目的

给现有模块一个统一的分类口径，避免把所有目录都称为“领域”。

## 分类原则

### Bounded Context

满足以下大部分条件：

- 有明确业务语言
- 有相对稳定的职责边界
- 有独立生命周期或核心规则
- 可以独立测试和演进

### Application Layer

满足以下特点：

- 负责协调多个上下文
- 更关注流程、入口、装配、分发
- 不拥有核心业务语言
- 常依赖多个服务和适配器

### Infrastructure / Integration

满足以下特点：

- 提供技术能力而非业务规则
- 与网络、存储、外部系统、SDK 适配有关
- 可被替换实现

## 当前分类结果

| 模块 | 分类 | 说明 |
|---|---|---|
| `workflows` | Core Domain | 当前最完整的业务编排上下文 |
| `supervision` | Core Domain | 监督、审查、检查点、worktree 生命周期 |
| `notification-feed` | Supporting Domain | ✅ 已从 `notification` 重命名 |
| `local-pr` | Supporting Domain | 本地 PR 和审查相关流程 |
| `projects` | Foundational Domain | 项目基础配置域 |
| `sessions` | Foundational Domain | 会话基础配置域 |
| `providers` | Foundational Domain | provider 元数据与能力基础域 |
| `conversation` | Application Context | 实时交互和运行时入口，不应再当成单领域 |
| `orchestration` | Process Manager | 任务协调层，非平级领域 |
| `plugins` | Application / Extension Layer | 插件扩展层 |
| `gateway` | Integration Context | 远程连接、同步、代理适配 |
| `routes` | Interface Layer | HTTP 暴露层 |
| `router` | Interface Layer | WebSocket 协议分发层 |
| `storage` | Infrastructure | DB、文件持久化 |
| `services` | Mixed | 需继续拆分，部分是应用服务，部分是基础设施 |
| `repositories` | Persistence Layer | 持久化访问层，不应承载跨域业务规则 |

## 明确不再使用的说法

以下说法后续应避免：

- “`gateway` 是业务域”
- “`orchestration` 是和 `workflows` 平级的领域”
- “`conversation` 是单一领域”
- “`shared` 可以无限增长，因为只是共享类型”

## 迁移规则

### 可以继续留在 `domains/`

- 拥有独立业务概念和生命周期的模块
- 依赖主要指向自身仓储、服务、规则对象的模块

### 应迁出 `domains/`

- 以流程拼装、跨域协调为主的模块
- 以适配外部系统为主的模块
- 主要承载接口、协议、序列化、广播逻辑的模块

## 已完成迁移项

1. ✅ `orchestration` → `application/orchestration`
2. ✅ `gateway` → `infrastructure/gateway`
3. ✅ `notification-service` → `infrastructure/push`
4. ✅ `conversation` → `application/conversation`
5. ✅ `plugins` → `application/plugins`
6. ✅ `notification` → `notification-feed`（重命名）

## 验收标准

- ✅ 新模块进入仓库时，能先回答其分类再决定目录位置
- ✅ `domains/` 目录下只保留真正的业务上下文
- ✅ application / infrastructure 的语义不再伪装成 domain
