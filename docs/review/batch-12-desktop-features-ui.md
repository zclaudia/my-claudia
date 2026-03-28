# Batch 12: Desktop — Features & UI Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~10k 行 |
| 模块数 | 13 |
| 关键大模块 | workflows (3085行), supervision (1620行), claudia (1537行), local-pr (1367行), automation (1174行) |

## 发现

### 🔴 高优先级

#### 1. WorkflowEditor DOM 私有方法反模式（HIGH）
- **文件**: `features/workflows/WorkflowEditor.tsx:111-136`
- **问题**: 通过 `(editorEl as any).__updateNodeData` 暴露私有方法，绕过 React 组合模式
- **修复**: 用 React Context + useImperativeHandle

#### 2. WorkflowGraphEditor setTimeout 批量更新（HIGH）
- **文件**: `features/workflows/WorkflowGraphEditor.tsx:110-126`
- **问题**: React 18+ 已自动批量更新，setTimeout 是多余的且引入竞态
- **修复**: 移除 setTimeout，信任 React 批量更新

#### 3. LocalPRsPanel 无限制 API 轮询（HIGH）
- **文件**: `features/local-pr/LocalPRsPanel.tsx:149-187`
- **问题**: 每次 worktree 列表变化就为所有 worktree 并行请求 eligibility，无去重/限流
- **修复**: 添加 300ms debounce + request cache

#### 4. ClaudiaChat Feed 无虚拟化（HIGH）
- **文件**: `components/claudia/ClaudiaChat.tsx:140-155`
- **问题**: 100+ task 时 200+ DOM 节点，无 windowing
- **修复**: 使用 react-window 或 react-virtual

#### 5. ScheduledTasks actionConfig 无类型（HIGH）
- **文件**: `features/scheduled-tasks/CreateScheduledTaskDialog.tsx:46`
- **问题**: `let actionConfig: any = {}` 无类型安全
- **修复**: 创建 discriminated union 类型 + Zod 验证

#### 6. AgentStatusBar Provider 加载竞态（HIGH）
- **文件**: `features/supervision/AgentStatusBar.tsx:51-64`
- **问题**: 打开表单时 fetch provider 列表，关闭时无取消，可能更新 unmounted 组件
- **修复**: 使用 AbortController

#### 7. App.tsx dynamic import 无缓存（HIGH - 性能）
- **文件**: `App.tsx:100`
- **问题**: 每次点击都 `import('./utils/pluginWindow')`
- **修复**: 顶层 import 或模块级缓存

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 8 | Workflow type converter `as any` 多处 | WorkflowGraphEditor.tsx:53-65 | 应加 schema validator |
| 9 | WorkflowEditor ref + state 双源 | WorkflowEditor.tsx:75-83 | nodesRef 和 currentNodes 状态不一致 |
| 10 | stepTypes 加载无 error 处理 | WorkflowEditor.tsx:56-57 | 静默失败 |
| 11 | 入口节点检测脆弱 | WorkflowEditor.tsx:164-167 | 不处理多连通分量/环 |
| 12 | LocalPR 乐观更新无 eligibility 预检 | LocalPRsPanel.tsx:107-111 | 先 create 后检查 |
| 13 | AutomationPanel dynamic import 无 catch | AutomationPanel.tsx:208 | import 失败无用户反馈 |
| 14 | SystemTasks polling 无 cleanup | AutomationPanel.tsx:74 | refresh 依赖变化时重复 fetch |
| 15 | Cron 表达式无验证 | CreateScheduledTaskDialog.tsx:69 | 任意字符串传给 API |
| 16 | AgentStatusBar init 无 error UI | AgentStatusBar.tsx:66-86 | 初始化失败只 console.error |
| 17 | ClaudiaChat 权限请求 type narrowing 不足 | ClaudiaChat.tsx:80-86 | sessionId 可能 undefined |
| 18 | FileViewerPanel setTimeout 无 cleanup | FileViewerPanel.tsx:75 | copy 反馈 timer 可能 fire after unmount |
| 19 | Terminal 初始化失败无 UI | TerminalPanel.tsx | WS 连接失败无提示 |
| 20 | Sidebar 40+ imports | Sidebar.tsx:1-62 | 循环依赖风险 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 21 | Workflow auth token 传递方式 | 未加密存储 |
| 22 | WorkflowEditor 无 mobile 适配 | 3 窗格布局在 <768px 不可用 |
| 23 | dashboardProjectId state 冗余 | App.tsx:142-178 |
| 24 | TaskRunHistory 未抽取独立组件 | AutomationPanel.tsx:165 |
| 25 | Syntax highlighter 全量 import | FileViewerPanel.tsx:3-4 |

### 🏗️ 跨模块架构问题

#### 无 Code Splitting
- **问题**: 所有 feature 模块打包在一起，用户不用 workflow/supervision 也要加载
- **修复**: `React.lazy()` + Suspense，按 tab 懒加载

#### 无 Error Boundary
- **问题**: 任一 feature 模块报错崩溃整个 app
- **修复**: 每个 feature 模块包裹 ErrorBoundary

#### Mobile 适配不足
- 6 个组件在移动端不可用：WorkflowEditor, ScheduledTasksPanel, LocalPRsPanel, AgentStatusBar 表单, 部分 settings

### ✅ 做得好的

1. **Feature 模块结构清晰** — 每个 feature 有 components/ + api/ + store/
2. **React Flow 集成完整** — Workflow 可视化编辑器功能丰富
3. **Permission UI 完整** — 支持多种审批模式
4. **Claudia 交互设计好** — task feed + 权限请求 + 恢复中断

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 7 |
| MEDIUM | 13 |
| LOW | 5 |
| 架构 | 3 |
| **总计** | **28** |

## 核心建议

1. **立即**: ClaudiaChat 虚拟化（用户体验影响最大）、LocalPR API 轮询修复（防止网络 DoS）、WorkflowEditor DOM 方法重构
2. **短期**: 添加 ErrorBoundary、实现 Code Splitting、修复 setTimeout 竞态
3. **中期**: Mobile 适配、类型安全加固
