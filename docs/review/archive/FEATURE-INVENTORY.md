# MyClaudia 功能清单

日期：2026-03-28

---

## 总览

| 指标 | 值 |
|------|-----|
| 功能模块 | 9 大类 |
| 功能项 | 53 |
| ✅ 完整 | **56** (98.2%) |
| 🟡 部分完成 | **1** (1.8%) |
| ❌ 缺失 | **0** |

---

## A. 核心对话能力

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 多 Provider 对话 | ✅ | ✅ | ✅ | 5 个 Provider（Claude/OpenCode/Codex/Cursor/Kimi），统一 adapter 模式 |
| 会话管理 | ✅ | ✅ | ✅ | 创建/切换/重命名/归档/恢复/删除，完整 CRUD |
| 消息流式输出 | ✅ | ✅ | ✅ | Delta 流式、工具调用内联展示、代码高亮、thinking blocks |
| 权限系统 | ✅ | ✅ | ✅ | 6 种分类策略、AI Review、自动审批、凭据加密 |
| 文件上传 & 附件 | ✅ | ✅ | ✅ | 图片/文件拖拽上传，Provider 特定附件模式 |
| 模式 & 模型切换 | ✅ | ✅ | ✅ | PCP 协商，动态隐藏不支持的模式，运行中可切换 |
| 草稿编辑器 | ✅ | ✅ | ✅ | Debounce 持久化、多设备锁、弹窗编辑器 |
| 斜杠命令 | ✅ | ✅ | ✅ | 内置 + Provider + 自定义(.md) + 插件，自动补全 |

**完成度: 8/8 (100%)**

---

## B. 项目管理

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 项目 CRUD | ✅ | ✅ | ✅ | 创建/编辑/删除，Dashboard + Settings Modal |
| Provider 绑定 | ✅ | ✅ | ✅ | 每项目绑定默认 Provider，下拉选择 |
| System Prompt | ✅ | ✅ | ✅ | 每项目独立 prompt，Textarea 编辑，传递给 Provider |
| 工作目录 | ✅ | ✅ | ✅ | rootPath 管理 + Git Worktree API（创建/列表） |
| 文件浏览器 | ✅ | ✅ | ✅ | Cmd+P 搜索、Prism 高亮（30+ 语言）、Markdown 渲染、新窗口 |

**完成度: 5/5 (100%)**

---

## C. 多端连接

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 嵌入式 Server (Tauri) | ✅ | ✅ | ✅ | 自动启动 Node.js sidecar，随机端口，Dev/Prod 数据隔离 |
| 远程 Server 直连 | ✅ | ✅ | ✅ | URL 配置，local/remote 双认证，连接状态指示 |
| Gateway 中继 | ✅ | ✅ | ✅ | 发现后端、消息转发、Gateway 认证 |
| 多 Server 切换 | ✅ | ✅ | ✅ | 侧边栏 Server 列表，状态指示灯，默认选择 |
| 连接状态管理 | ✅ | ✅ | ✅ | 指数退避重连、BackendFacade 统一抽象、错误恢复 |

**完成度: 5/5 (100%)**

---

## D. Supervision 监督执行系统

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| Agent 初始化 | ✅ | ✅ | ✅ | 阶段管理 (setup→planning→executing)，Agent 配置 |
| 任务管理 | ✅ | ✅ | ✅ | 完整状态机 (pending→queued→running→completed)，依赖管理 |
| AI 代码审查 | ✅ | ✅ | ✅ | 虚拟 session 审查，verdict 解析，notes 提取 |
| Checkpoint & 回滚 | ✅ | ✅ | ✅ | 事件触发 + 定时 + 手动，任务发现 |
| Worktree 并行任务 | ✅ | N/A | ✅ | 槽池管理 + Mutex 合并锁 |
| 状态恢复 | ✅ | N/A | ✅ | 中断 run / stuck task / 孤儿 worktree 恢复 |
| Dashboard UI | ✅ | ✅ | ✅ | TaskBoard + AgentStatusBar + CheckpointFeed + ContextBrowser |

**完成度: 7/7 (100%)**

---

## E. 自动化引擎

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| Workflow 可视化编辑器 | ✅ | ✅ | ✅ | React Flow 图编辑器，独立窗口，节点拖拽 |
| Workflow 执行引擎 | ✅ | ✅ | ✅ | DAG 执行、条件分支、审批门、AI 步骤、重试、变量插值 |
| Workflow AI 生成器 | ✅ | ✅ | ✅ | 自然语言→工作流、精化会话（30 分钟 TTL）、模板生成 |
| 定时任务 (Cron) | ✅ | ✅ | ✅ | ⚠️ 已废弃，被 Workflow 取代。功能完整但标记 @deprecated |
| 事件触发器 | ✅ | 🟡 | ✅ | ⚠️ 已废弃，被 Workflow 取代。Glob pattern 事件匹配 |
| Claudia 元 Agent | ✅ | ✅ | ✅ | 自然语言→任务拆解→执行，最多 3 并行 agent task，Feed + 通知 |
| 系统任务 | ✅ | ✅ | ✅ | 5 类任务 (scheduling/sync/maintenance/supervision/plugin)，只读展示 |

**完成度: 7/7 (100%)** （含 2 个已废弃但功能完整的模块）

---

## F. 插件系统

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 插件发现 & 加载 | ✅ | ✅ | ✅ | 递归目录扫描、多格式 manifest、API 触发发现 |
| 激活 / 停用 | ✅ | ✅ | ✅ | 完整生命周期（兼容性检查→依赖→权限→注册→加载） |
| Worker 沙箱 | ✅ | N/A | ✅ | worker_threads 隔离，128MB 堆限制，14+ RPC 方法 |
| 插件权限 | ✅ | ✅ | ✅ | 4 级风险等级，持久化存储，请求/授权 UI |
| Skill Tools | ✅ | ✅ | ✅ | Workspace + 外部目录，YAML frontmatter，懒加载 |
| MCP Bridge | 🟡 | N/A | 🟡 | stdio framing 完成，深度 tool/resource 转发未完成 |
| 插件 UI | ✅ | ✅ | ✅ | 设置面板（搜索/启禁）、Panel 渲染、权限对话框 |
| Workflow 步骤注册 | ✅ | ✅ | ✅ | 插件级步骤、config schema、懒权限检查 |

**完成度: 7.5/8 (94%)**  — MCP Bridge 部分完成

---

## G. Local PR 系统

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 创建 Local PR | ✅ | ✅ | ✅ | 自动提交未暂存变更、前置条件检查、Eligibility 预检 |
| AI 代码审查 | ✅ | ✅ | ✅ | 可选 Provider、verdict 解析、重试支持、session 归档 |
| 合并 & 冲突解决 | ✅ | ✅ | ✅ | Mutex 并发保护、AI 冲突分析、自动重试合并 |
| PR 列表 UI | ✅ | ✅ | ✅ | 8 种状态分组、Diff 查看器、实时 WS 更新、批量操作 |

**完成度: 4/4 (100%)**

---

## H. 通知与交互

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| 通知动态流 | ✅ | ✅ | ✅ | 已读/未读追踪、Badge 计数、分页、WS 实时推送 |
| 权限策略配置 | ✅ | ✅ | ✅ | 6 类权限 + AI Review + Global Guards，PermissionSettings.tsx 完整实现 |
| 用户交互表单 | ✅ | ✅ | ✅ | AskUserQuestion 支持 5 种字段类型，阻塞式交互 |
| File Push | ✅ | ✅ | ✅ | 推送文件到客户端，小文件自动下载，大文件下载通知 |
| 远程终端 | ✅ | ✅ | ✅ | node-pty + xterm.js，Resize、多 session、scrollback buffer |
| 外部通知 (ntfy) | ✅ | ✅ | ✅ | Server URL + Topic 配置、7 种事件开关、Test 按钮，NotificationSettings.tsx 完整 |

**完成度: 6/6 (100%)**

---

## I. 部署与运维

| 功能 | 后端 | 前端 | E2E | 说明 |
|------|------|------|-----|------|
| macOS 构建 | ✅ | N/A | ✅ | DMG + 代码签名 + Updater 签名 + GitHub Release |
| Android 构建 | ✅ | N/A | ✅ | APK + Keystore 签名 + Dev variant |
| Linux 构建 | ✅ | N/A | ✅ | deb + rpm + GitHub Release |
| Gateway Docker 部署 | ✅ | N/A | ✅ | 多阶段构建 + Health check + 多实例 |
| Server Systemd 部署 | ✅ | N/A | ✅ | 服务文件 + 自动重启 + Setup 脚本 |
| 版本管理 | ✅ | N/A | ✅ | 语义版本 + Git tag 派生 |
| 自动更新 | ✅ | ✅ | ✅ | Tauri updater + Android APK 下载 + 4 小时检查间隔 |

**完成度: 7/7 (100%)**

---

## 完成度矩阵

| 模块 | 功能数 | ✅ | 🟡 | ⚠️ | 完成率 |
|------|--------|-----|-----|-----|--------|
| A. 核心对话 | 8 | 8 | 0 | 0 | 100% |
| B. 项目管理 | 5 | 5 | 0 | 0 | 100% |
| C. 多端连接 | 5 | 5 | 0 | 0 | 100% |
| D. Supervision | 7 | 7 | 0 | 0 | 100% |
| E. 自动化引擎 | 7 | 7 | 0 | 0 | 100% |
| F. 插件系统 | 8 | 7 | 1 | 0 | 94% |
| G. Local PR | 4 | 4 | 0 | 0 | 100% |
| H. 通知与交互 | 6 | 6 | 0 | 0 | 100% |
| I. 部署与运维 | 7 | 7 | 0 | 0 | 100% |
| **总计** | **57** | **56** | **1** | **0** | **98.2%** |

---

## 未完成项清单

> ⚠️ 校验修订：原始盘点中权限策略 UI 和 ntfy 配置 UI 被误标为缺失，实际 `PermissionSettings.tsx` 和 `NotificationSettings.tsx` 均已完整实现。

| # | 功能 | 模块 | 缺失内容 | 优先级 |
|---|------|------|---------|--------|
| 1 | MCP Bridge 深度集成 | F. 插件 | stdio framing + `listServers`/`listTools`/`callTool` 低层 API 完成，但 MCP tools **未自动注入为 agent tool**（需手动调用）。`provider-api.ts:147` 有 TODO 标注 | 中 |

---

## 废弃模块

| 模块 | 替代方案 | 状态 |
|------|---------|------|
| Scheduled Tasks (Cron) | Workflow 引擎 | 功能完整但标记 @deprecated |
| Agent Triggers | Workflow 事件触发 | 功能完整但标记 @deprecated |

---

## 产品能力总结

MyClaudia 是一个**功能完整度极高的 AI 编程助手跨平台客户端**，核心能力包括：

1. **多 AI Provider 统一接入** — 5 个 Provider 通过 PCP 协议统一适配
2. **跨平台多端** — macOS/Linux/Android + 本地嵌入/远程直连/Gateway 中继三种连接模式
3. **Supervision 监督执行** — AI Agent 自主执行 + 人工监督审批 + Worktree 并行
4. **Workflow 自动化** — 可视化编辑 + DAG 执行 + AI 生成 + 审批门
5. **插件生态** — Worker 沙箱 + Skill Tools + 权限管理 + 面板系统
6. **Local PR** — 本地代码审查 + AI Review + 冲突解决的完整 Git 工作流
7. **Claudia 元 Agent** — 自然语言任务编排 + 多 Agent 协作

**98.2% 的功能完整度**，仅 MCP 深度集成（tool 自动注入）一项需补全。
