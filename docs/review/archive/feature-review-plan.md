# MyClaudia 功能盘点计划

日期：2026-03-28
目标：梳理项目已实现的全部功能，评估完成度和可用性

---

## 盘点维度

每个功能模块按以下维度评估：

| 维度 | 说明 |
|------|------|
| 功能完整度 | 核心流程是否闭环（✅ 完整 / 🟡 部分 / ❌ 缺失） |
| UI 可用性 | 有无前端入口、交互是否完整 |
| 测试覆盖 | 有无对应测试 |
| 文档状态 | 有无使用文档或注释 |
| 实际可用 | 用户能否端到端使用该功能 |

---

## 盘点批次

### Batch A: 核心对话能力
- 多 Provider 对话（Claude / OpenCode / Codex / Cursor / Kimi）
- 会话管理（创建、切换、归档、恢复）
- 消息流式输出
- 工具调用（tool use）展示
- 权限请求 / 审批
- 文件附件 / 图片上传
- 模式切换（plan / code / architect 等）
- 模型切换
- 草稿编辑器

### Batch B: 项目管理
- 项目创建 / 配置
- Provider 绑定与切换
- System Prompt 管理
- 工作目录管理
- 文件浏览器

### Batch C: 多端连接
- 本地嵌入式 Server（Tauri + Node.js）
- 远程 Server 直连
- Gateway 中继连接
- 多 Server 切换
- 连接状态管理

### Batch D: Supervision 系统
- Agent 初始化与阶段管理
- 任务创建 / 审批 / 拒绝
- 代码审查引擎（AI review）
- Checkpoint / 回滚
- Git Worktree 并行任务
- 状态恢复
- Supervision Dashboard UI

### Batch E: 自动化引擎
- Workflow 可视化编辑器（React Flow）
- Workflow 执行引擎（DAG）
- Workflow AI 生成器
- 定时任务（Cron）
- 事件触发器（Agent Triggers）
- Claudia 元 Agent（任务编排器）
- 系统任务

### Batch F: 插件系统
- 插件发现 / 加载 / 激活
- Worker 沙箱隔离
- 插件权限管理
- Skill Tools（内置 + 外部 + workspace）
- MCP Bridge
- 工具注册
- Workflow Step 注册
- 插件定时器
- 插件面板 UI

### Batch G: Local PR 系统
- 本地 PR 创建
- AI 代码审查
- 合并 / 冲突解决
- PR 列表 UI

### Batch H: 通知与交互
- 通知动态流（Notification Feed）
- 权限策略（Auto-approve / AI Review / Category-based）
- 用户交互表单（AskUserQuestion）
- 文件推送（File Push）
- 远程终端

### Batch I: 部署与运维
- macOS 构建 + 代码签名 + 自动更新
- Android 构建
- Linux 构建
- Gateway Docker 部署
- Server systemd 部署
- 版本管理

---

## 产出

`docs/review/FEATURE-INVENTORY.md` — 全功能清单 + 完成度矩阵
