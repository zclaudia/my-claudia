# Batch 1: Shared Types & Protocol Review

日期：2026-03-28
状态：✅ Completed

## 概览

| 指标 | 值 |
|------|-----|
| 文件数 | 45 (.ts) |
| 总行数 | ~8,048 |
| `any` 使用 | 4（全部在 correlation.ts 的 type guard 中，合理） |
| 重复类型名 | 0 |
| 废弃导出 | 2（agent-triggers.ts, delegation.ts） |

## 结构

```
shared/src/
├── core/          (7 files) — 核心实体: server, provider, session, message, project, api, mcp, pcp
├── facade/        (7 files + 4 tests) — BackendFacade 运行时: registry, stream, snapshot
├── features/      (9 files) — 功能特性类型
├── interaction/   (3 files) — 权限、表单、通知
├── protocol/      (4 files + 10 message files) — WebSocket 消息协议
├── files.ts       — 文件浏览器类型
├── plugin-types.ts — 插件类型
└── index.ts       — 统一导出
```

## 发现

### ✅ 做得好的

1. **类型命名一致性好** — 清晰的后缀约定：`*Message`, `*UpdateMessage`, `*ListMessage`, `*State`, `*Config`
2. **消息协议分类合理** — 10 个文件按 domain 拆分（core, run, crud, terminal, permissions, supervision, claudia, workflow, notification-feed, plugins）
3. **`any` 控制严格** — 仅 4 处且全部是 type guard 的入参，完全合理
4. **导出策略清晰** — 所有消费者可从 `@my-claudia/shared` 统一导入
5. **协议版本化** — Gateway sync protocol v2，权限策略 v1→v2→v3 演进有迹可循

### ⚠️ 需要关注

| # | 问题 | 严重程度 | 建议 |
|---|------|---------|------|
| 1 | 废弃类型仍导出 | 低 | `agent-triggers.ts` 和 `delegation.ts` 标记 @deprecated 但仍在 index.ts 中导出。建议加 `@deprecated` JSDoc 或移到 `legacy/` 目录 |
| 2 | Facade 内部类型暴露 | 低 | `BackendRuntimeRecord`, `DesiredSessionStream`, `SessionStreamRuntime` 是内部实现类型，但通过 facade/index.ts 导出。建议拆分为 `facade/internal.ts` 导出面 |
| 3 | 核心实体字段无冗余 | ✅ | Session, Message, Project 字段设计精简，无重复 |
| 4 | `ClientMessage` 29 类型 / `ServerMessage` 48 类型 | 信息 | 联合类型规模较大，但按 domain 拆分后可维护 |

### 📊 消息协议统计

| 方向 | 消息类型数 |
|------|-----------|
| Client → Server | 29 |
| Server → Client | 48 |
| 双向 | 部分类型（如 core, crud） |

## 结论

Shared 层质量很高，类型安全、命名统一、无 `any` 逃逸。仅有两个低优先级改进点（废弃类型清理、内部类型导出控制）。作为基石层，足够稳固。

## 修复记录（2026-03-31）

| # | 问题 | 修复 |
|---|------|------|
| 1 | 废弃类型仍导出 | 在 `index.ts` 导出处添加 `@deprecated` JSDoc 注释，明确告知消费者迁移方向。类型本身仍被 server 7 个文件使用，暂不移除。 |
| 2 | Facade 内部类型暴露 | 从 `facade/index.ts` 移除 `BackendRuntimeRecord`、`DesiredSessionStream`、`SessionStreamRuntime` 的公开导出。在 `types.ts` 中添加 `@internal` 标记。无外部消费者，构建验证通过。 |
