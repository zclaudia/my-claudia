# Batch 13: Desktop UI Shell — Chat & Core UI Review

日期：2026-03-28
状态：✅ Review 完成（修复延迟至 UI 重构迭代）

## 概览

| 指标 | 值 |
|------|-----|
| 范围 | ~8k+ 行 |
| 关键模块 | components/chat/ (7732行), hooks/chat/, hooks/useMultiServerSocket, hooks/useGatewayConnection, services/messageHandler, services/sessionSync |

## 发现

### 🔴 高优先级

#### 1. ChatInputArea 移动端事件监听器泄漏（HIGH）
- **文件**: `ChatInputArea.tsx:102-115`
- **问题**: mobileToolsOpen 状态变化时清理函数可能与 React 批量更新竞态
- **修复**: 使用稳定 ref 或添加 handler 依赖

#### 2. SessionChatWindow 无错误恢复（HIGH）
- **文件**: `SessionChatWindow.tsx:158-190`
- **问题**: `Promise.all` 中任一请求失败则整体失败，无重试机制
- **修复**: 分别处理错误，添加指数退避重试

#### 3. useSendMessage Ref 变更竞态（HIGH）
- **文件**: `useSendMessage.ts:175-178`
- **问题**: `queuedMessageRef.current` 在 isLoading 快速翻转时可能被 stale closure 捕获
- **修复**: 使用 useCallback + useEffect，替换 `setTimeout(…, 0)` 为 flushSync

#### 4. useCommandHandler setTimeout 滥用（MED-HIGH）
- **文件**: `useCommandHandler.ts` 多处
- **问题**: 16+ 处 `setTimeout(() => scrollToBottom(), 100)`，无清理，100ms 时间不可靠
- **修复**: 用 `requestAnimationFrame()` 替代

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | Worktree change 乐观更新闪烁 | useCommandHandler.ts:221-227 | 先更新后 API，服务端返回不同值时 UI 闪 |
| 6 | MessageList 虚拟化参数不精确 | MessageList.tsx:174-177 | overscan 900px，估计高度 120px 但大代码块 500px+ |
| 7 | useMessagePagination 未清理 timer | useMessagePagination.ts:101 | 2500ms highlight timer 无 cleanup |
| 8 | ChatInputArea JSX 中直接 getState() | ChatInputArea.tsx:265,369 | 不触发重渲染，逻辑 bug |
| 9 | Provider commands fetch 无用户反馈 | useProviderCapabilities.ts:48-55 | AbortError 被吞，加载失败无提示 |
| 10 | useSendMessage stale closure | useSendMessage.ts:27-38 | onDecision 未通过 ref 调用 |
| 11 | 附件上传错误不区分类型 | useSendMessage.ts:121-138 | fetch 失败与网络错误同一处理 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 12 | Draft 持久化 debounce 300ms | 关闭浏览器可能丢失最后输入 |
| 13 | Session rename 失败无反馈 | useSessionActions.ts:31-41 |
| 14 | Document.body 临时 DOM 节点 | useSessionActions.ts:51-53 |
| 15 | ConnectionProvider 无显式 cleanup | ConnectionContext.tsx:196-200 |

### 🏗️ 架构问题

| # | 问题 | 说明 |
|---|------|------|
| 16 | ChatInterface 23+ state 订阅 | 应拆分为 ChatHeader + ChatContent + ChatActions |
| 17 | 三层状态管理（gateway + facade + socket） | useGatewayConnection / useBackendFacade / useMultiServerSocket 职责重叠 |
| 18 | ToolCallItem 无虚拟化 | 50+ tool calls 时全量渲染 |

### ✅ 做得好的

1. **消息虚拟化已有基础** — VIRTUALIZE_THRESHOLD = 80
2. **Draft 持久化设计合理** — debounce + server sync
3. **连接状态管理层次清晰** — 虽然复杂但分工明确
4. **Mobile 适配有考虑** — 条件渲染 + 专用布局

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 4 |
| MEDIUM | 7 |
| LOW | 4 |
| 架构 | 3 |
| **总计** | **18** |
