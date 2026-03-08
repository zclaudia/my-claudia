# MyClaudia 文档索引

## 目录结构

```
docs/
├── README.md           # 本文件
├── design/             # 设计文档 (待实现/进行中)
├── features            # 功能设计 (待实现)
├── impl/               # 实现细节
├── testing/            # 测试相关
├── archive/            # 已实现 (归档)
└── plugin-sdk.d.ts     # 插件 SDK 类型定义
```

## 文档分类

### 📐 设计文档 (design/)

| 文件 | 状态 |
|------|------|
| [requirement.md](./design/requirement.md) | 需求文档 (PRD) |
| [universal-plugin-platform.md](./design/universal-plugin-platform.md) | 通用插件平台设计 |
| [agent-assistant-plugin-platform.md](./design/agent-assistant-plugin-platform.md) | Agent Assistant 插件平台 |
| [multi-model-collaborative-refinement.md](./design/multi-model-collaborative-refinement.md) | 多模型协作校准 |
| [claudia-ui-review.md](./design/claudia-ui-review.md) | UI 设计评审 |

### ⚡ 功能设计 (features/) — 未实现

| 文件 | 状态 |
|------|------|
| [KIMI_INTEGRATION_PLAN.md](./features/KIMI_INTEGRATION_PLAN.md) | Kimi Code Provider 集成方案 |
| [remove-ws-relay.md](./features/remove-ws-relay.md) | 移除 WebSocket 中继 |
| [remote-devtools.md](./features/remote-devtools.md) | 远程浏览器 DevTools |

### 📝 实现细节 (impl/)

| 文件 | 描述 |
|------|------|
| [phase1-data-model-and-context.md](./impl/phase1-data-model-and-context.md) | Phase 1: 数据模型与上下文 |
| [phase2-review-engine.md](./impl/phase2-review-engine.md) | Phase 2: 审查引擎 |
| [phase3-parallel-execution.md](./impl/phase3-parallel-execution.md) | Phase 3: 并行执行 |
| [phase4-resilience-and-advanced.md](./impl/phase4-resilience-and-advanced.md) | Phase 4: 韧性与高级特性 |

### 🧪 测试相关 (testing/)

| 文件 | 描述 |
|------|------|
| [test-coverage-plan.md](./testing/test-coverage-plan.md) | 测试覆盖率提升计划 (80%) |
| [TEST-PLAN-NEW-FEATURES.md](./testing/TEST-PLAN-NEW-FEATURES.md) | 新增功能测试计划 |
| [test-discovered-issues.md](./testing/test-discovered-issues.md) | 测试发现的问题 |

### 📦 已归档 (archive/) — 已实现

| 文件 | 描述 |
|------|------|
| [supervision-v2-design.md](./archive/supervision-v2-design.md) | Supervision v2 设计 |
| [content-blocks-design.md](./archive/content-blocks-design.md) | 消息分段渲染设计 |
| [server-deployment.md](./archive/server-deployment.md) | Server 独立部署指南 |
| [gateway-connection-guide.md](./archive/gateway-connection-guide.md) | Gateway 连接指南 |
| [server-gateway-ui-guide.md](./archive/server-gateway-ui-guide.md) | Server Gateway UI 配置 |
| [websocket-messages-analysis.md](./archive/websocket-messages-analysis.md) | WebSocket 消息清单与分析 |

---

> 最后更新: 2026-03-08
