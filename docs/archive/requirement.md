# My Claudia
需求文档（PRD）
项目名称（暂定）

My Claudia

一个以 本地 Code CLI（Claude / Cursor / Codex / Gemini） 为后端的
跨桌面 / 移动端的聊天 + 项目管理 UI

1. 项目背景与目标
1.1 背景

Claude 官方 Desktop / Web 客户端：

UI/交互偏通用用户

对工程师不友好

不支持跨设备、项目级管理

Claude Code / Cursor / Codex 等 Code CLI：

能力强

但仅提供终端交互

不适合长时间、多会话、多项目使用

现有第三方 GUI（Opcode 等）：

维护困难

深度耦合 CLI 内部行为

生命周期不可控

1.2 项目目标

构建一个 稳定、可维护、可扩展 的 UI 层：

以 Code CLI 为“黑盒执行引擎”，
自己掌控会话 / 项目 / 权限 / UI 体验

1.3 非目标（明确不做）

❌ 不做 Claude API / OAuth / 私有协议模拟

❌ 不做完整 IDE / 重度代码编辑器

❌ 不做无人值守 Agent / 自动调度系统

❌ 不试图复刻 Claude 官方 VS Code 插件的 IDE 协议

2. 产品定位
2.1 核心定位

Code CLI 后端的聊天 + 项目管理 UI

Code CLI = 执行引擎

UI = 人类交互、资产管理、权限控制

2.2 目标用户

使用 Claude Code / Cursor / Codex 的工程师

希望：

有更好的聊天体验

项目/会话可管理

多设备访问（桌面 + 手机）

不想把代码和 token 交给第三方云服务

3. 系统形态与部署模型
3.1 桌面端
[Tauri Desktop UI]
        ↓ WebSocket/HTTP
[Local Bridge Daemon]
        ↓ spawn / pipe
[Code CLI Binary]


支持平台：

macOS

Linux

Windows

3.2 移动端（Android）
[Tauri Android App]
        ↓ TLS/WebSocket
[Remote Bridge Daemon]
        ↓ spawn / pipe
[Code CLI Binary]


说明：

Daemon 运行在用户自己的 Mac/Linux/Windows 上

Android 端作为 远程控制与查看界面

iOS 暂不支持（技术与分发成本过高）

4. 功能需求
4.1 Project（项目）管理
4.1.1 创建 Project

Project 名称

Project 类型（可选）：

Chat-only

Code（绑定目录）

绑定 Code CLI Provider（Claude / Cursor / Codex / Gemini）

Project Root Path（可选）

权限策略（默认最严格）

4.1.2 Project 配置

默认 system prompt

允许访问的目录白名单

允许的 tools（默认关闭）

Provider 参数（model / flags）

4.2 Session（会话）管理
4.2.1 创建 Session

归属 Project

指定 Provider（继承 Project，可覆盖）

生成唯一 sessionId（UI 内部）

4.2.2 Session 能力

消息历史持久化

会话重命名

会话删除 / 导出

会话 summary（后续可选）

⚠️ Session 由 UI 管理，不依赖 CLI 自带 session

4.3 Chat 核心功能
4.3.1 输入

多行文本输入

Markdown 支持

快捷键发送（Cmd/Ctrl + Enter）

中断当前生成

4.3.2 输出

流式展示（token/delta）

Markdown 渲染

代码块复制

错误提示（CLI 级别）

4.3.3 Streaming

基于 WebSocket

内部事件模型（见 §6）

4.4 权限审批（Approve）
4.4.1 权限类型

文件读取

文件写入

Shell 命令

网络访问（默认禁用）

4.4.2 审批策略

自动允许（白名单）

自动拒绝

需要人工确认

4.4.3 UI 行为

弹窗展示请求详情

Allow / Deny

可记住本次 Project 的决策

4.4.4 审计

所有权限决策写入 DB

可回溯

4.5 Provider 支持（Code CLI Adapter）

⚠️ 详细的接口定义见 technical-spec.md §4

4.5.1 Provider 抽象接口

每个 Provider（Claude / Cursor / Codex / Gemini）需实现以下接口：

```
interface Provider {
    Name() -> string
    Capabilities() -> ProviderCapabilities
    StartRun(sessionId, input, config) -> runId
    Stream(runId) -> event stream
    Cancel(runId) -> void
    SendPermissionDecision(reqId, allow) -> void
}
```

**接口说明**：
- `Name()`：返回 Provider 名称
- `Capabilities()`：返回能力集（支持的工具、模型列表）
- `StartRun()`：启动一次 run，返回 runId
- `Stream()`：订阅 run 的事件流（delta、completed、failed、permission_request）
- `Cancel()`：取消正在运行的 run
- `SendPermissionDecision()`：发送权限决策给 CLI

4.5.2 初期支持

Claude Code CLI（优先）

Cursor CLI（次优先）

Codex / Gemini（可选）

4.5.3 CLI 使用原则

非交互模式

结构化输出（如 stream-json）

CLI 作为 一次性 worker 或短生命周期进程

4.6 其他 CLI 交互（高级）

Raw CLI Console（透传终端）

CLI 状态查看

Debug 日志查看

该部分 不作为 MVP 必需

5. 技术方案（约束级）
5.1 UI 层

Tauri

桌面 + Android 复用

React/Vue/Svelte 均可（不强制）

5.2 Bridge Daemon

优先：Go

备选：Python

长期运行

SQLite 存储

5.3 通信协议

WebSocket（主）

SSE（可选 fallback）

6. 内部事件协议（草案）

⚠️ 详细的协议定义见 technical-spec.md §2

6.1 客户端 → 服务端
- `run_start`：发起新的 run
- `run_cancel`：取消当前 run
- `permission_decision`：用户权限决策
- `ping`：心跳

6.2 服务端 → 客户端
- `run_started`：run 已启动
- `delta`：流式输出（token）
- `run_completed`：run 成功完成
- `run_failed`：run 失败（含错误信息）
- `permission_request`：请求用户授权
- `pong`：心跳响应

6.3 示例

```json
// 流式输出
{ "type": "delta", "runId": "...", "content": "hi" }

// 完成
{ "type": "run_completed", "runId": "...", "usage": {...} }

// 错误
{ "type": "run_failed", "runId": "...", "error": {...} }

// 权限请求
{ "type": "permission_request",
  "reqId": "...",
  "tool": "Bash",
  "detail": {...} }

// 权限决策
{ "type": "permission_decision",
  "reqId": "...",
  "allow": true }
```

7. 数据存储

⚠️ 详细的表结构定义见 technical-spec.md §1

7.1 数据库选型

**本地（桌面端）**：SQLite

**远端（移动端场景）**：SQLite / Postgres

7.2 核心数据表

- `projects` - 项目信息（名称、类型、Provider、路径、配置）
- `sessions` - 会话记录（归属项目、名称、创建时间）
- `messages` - 消息历史（角色、内容、元数据）
- `permission_logs` - 权限审计（工具、详情、决策）
- `provider_runs` - Provider 执行记录（状态、输入、输出、usage）

7.3 数据管理

- 自动清理过期会话（默认 30 天）
- 支持导出/导入（JSON 格式）
- 支持备份与迁移

8. 安全要求
8.1 本地

仅监听 localhost

不暴露公网端口

8.2 远端访问

TLS

设备配对码

JWT / 短期 token

明确标识“个人自托管”

9. MVP 范围定义

⚠️ 详细的实施计划见 technical-spec.md §8

9.1 阶段 0：技术验证（1-2 周）

**目标**：
- Tauri 桌面应用可启动
- Bridge Daemon 可启动并响应 API
- WebSocket 连接成功
- 能执行简单的 Claude CLI 命令

9.2 阶段 1：桌面端 MVP（4-6 周）

**必须包含**：
- 桌面端 UI（macOS/Windows/Linux）
- Claude Code Provider
- Project + Session 管理
- Chat 流式展示
- 本地 bridge daemon
- SQLite 存储
- 基础权限审批

**不包含**：
- Android 端
- 多 Provider 支持
- 文件树 / Git 集成
- 高级功能（语音输入、离线草稿等）

**验收标准**：
- 能完整完成对话流程
- 所有数据持久化
- 应用重启后状态恢复
- 权限请求正常处理

9.3 阶段 2：Android 端（3-4 周）

**目标**：
- Android App 可启动
- 远程连接 Bridge Daemon
- 移动端 UI 优化（触摸友好）
- TLS 和设备配对

9.4 阶段 3：多 Provider 支持（2-3 周）

**目标**：
- 支持 Cursor CLI
- 支持 Codex CLI
- Provider 切换 UI

10. 风险与对策
风险	对策
CLI 升级破坏	Adapter 层隔离 + 版本锁
项目复杂化	严控 MVP 范围
类 Opcode 命运	只做 Chat + 管理
安全误用	默认最小权限
11. 成功标准（阶段性）

能连续使用 1–2 周替代官方 Desktop

CLI 升级不会立即导致系统不可用

新增 Provider 不影响现有 UI

移动端能稳定远程查看/聊天

12. 后续演进（非承诺）

Android App

Provider Marketplace

Session Summary

本地加密存储

插件系统



