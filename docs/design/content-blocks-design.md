# 消息分段渲染 — Content Blocks

## Context

当前所有 assistant 文字通过 `appendToLastMessage` 拼接成一个 string，tool calls 作为独立数组附加。渲染时 tool calls 全部显示在文字上方，文字作为一个完整 markdown 块。

官方客户端和 VSCode 插件将中间解释性文字（"让我读一下..."、"现在来修改..."）折叠/隐藏，只突出最后的总结。我们要实现类似效果。

**方案 B**：在 streaming 阶段追踪 text 和 tool_use 的交替顺序，持久化到 metadata，渲染时按顺序展示——中间文字折叠，最后一段突出。

## 渲染目标

```
┌─ "让我先看..." (折叠一行) ──────────────────────────┐
├─ ✓ Read file.ts ────────────────────────────────────┤
├─ "好的，修改..." (折叠一行) ────────────────────────┤
├─ ✓ Edit config.ts ──────────────────────────────────┤
└─────────────────────────────────────────────────────┘
┌─ Final response ────────────────────────────────────┐
│ 修改完成，总结如下...                                 │
│ (完整 markdown 渲染)                                  │
└─────────────────────────────────────────────────────┘
```

## 数据结构

```typescript
// shared/src/index.ts — 新增
export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolUseId: string };

// MessageMetadata — 扩展
export interface MessageMetadata {
  toolCalls?: ToolCall[];
  contentBlocks?: ContentBlock[];  // 新增：有序 text-tool 交替序列
  usage?: UsageInfo;
  filePush?: FilePushMetadata;
}

// ToolCall — 添加 toolUseId
export interface ToolCall {
  toolUseId?: string;  // 新增：用于 contentBlocks 交叉引用（optional 向后兼容）
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}
```

---

## 实现步骤

### Step 1: Shared types

**文件**: `shared/src/index.ts`

1. 新增 `ContentBlock` type
2. `MessageMetadata` 添加 `contentBlocks?: ContentBlock[]`
3. `ToolCall` 添加 `toolUseId?: string`
4. 构建 shared：`pnpm -C shared build`

### Step 2: Server — 追踪 content blocks

**文件**: `server/src/server.ts`

1. `ActiveRun` interface (line ~204) 添加 `contentBlocks: ContentBlock[]`

2. 初始化 (line ~1204): `contentBlocks: []`

3. `assistant` event handler (line ~1509):
   ```typescript
   // 追加到 fullContent（不变）
   activeRun.fullContent += msg.content;
   // 构建 content blocks
   const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
   if (lastBlock && lastBlock.type === 'text') {
     lastBlock.content += msg.content;
   } else {
     activeRun.contentBlocks.push({ type: 'text', content: msg.content });
   }
   ```

4. `tool_use` event handler (line ~1521):
   ```typescript
   activeRun.contentBlocks.push({ type: 'tool_use', toolUseId: msg.toolUseId || '' });
   ```

5. `result` event handler (line ~1578) — 非流式 provider 的 fallback:
   ```typescript
   if (msg.content && !activeRun.fullContent) {
     activeRun.contentBlocks.push({ type: 'text', content: msg.content });
   }
   ```

6. `upsertAssistantMessage` (line ~949):
   - `toolCalls` mapping 添加 `toolUseId`
   - 添加 `contentBlocks` 到 metadata

### Step 3: Client — chatStore 扩展

**文件**: `apps/desktop/src/stores/chatStore.ts`

1. `MessageWithToolCalls` 添加 `contentBlocks?: ContentBlock[]`

2. State 添加 `runContentBlocks: Record<string, ContentBlock[]>`

3. 新增 actions:
   - `appendTextBlock(runId, content)` — 追加到最后一个 text block 或创建新的
   - `addToolUseBlock(runId, toolUseId)` — 添加 tool_use block
   - `finalizeContentBlocksToMessage(runId)` — 附加到最后一条 assistant message

4. `startRun` 初始化 `runContentBlocks[runId] = []`
5. `endRun` 清理 `runContentBlocks[runId]`

### Step 4: Client — WebSocket handler

**文件**: `apps/desktop/src/hooks/useMultiServerSocket.ts`

1. `delta` case: 添加 `appendTextBlock(message.runId, message.content)`
2. `tool_use` case: 添加 `addToolUseBlock(message.runId, message.toolUseId)`
3. `run_completed` case: 添加 `finalizeContentBlocksToMessage(message.runId)`
4. `run_failed` case: 同上

### Step 5: Client — 历史消息恢复

**文件**: `apps/desktop/src/components/chat/ChatInterface.tsx`

更新 `restoreToolCalls`（重命名为 `restoreMessageBlocks`）:
- 现有 toolCalls 恢复逻辑不变
- 新增：如果 `metadata.contentBlocks` 存在，附加到 message
- tool call ID 改用 `tc.toolUseId || \`persisted-${msg.id}-${i}\``

**文件**: `apps/desktop/src/components/agent/AgentPanel.tsx`

同上更新 `restoreToolCalls`。

### Step 6: Client — 分段渲染

**文件**: `apps/desktop/src/components/chat/MessageList.tsx`

1. **新组件 `CollapsedTextBlock`**:
   - 默认折叠，显示第一行预览 + 展开箭头
   - 点击展开显示完整 markdown
   - 样式：`bg-muted/30 border-border/50`，低调

2. **新组件 `SegmentedContent`**:
   - Props: `contentBlocks: ContentBlock[]`, `toolCalls: ToolCallState[]`
   - 构建 `toolUseId → ToolCallState` lookup map
   - 找到最后一个 text block 的 index
   - 按顺序渲染:
     - text block（非最后一个）→ `CollapsedTextBlock`
     - tool_use block → `ToolCallItem`（复用现有组件）
     - text block（最后一个）→ 完整 `AssistantContent` + `ThinkingBlock`

3. **更新 `MessageItem`**:
   - 如果 `contentBlocks` 存在且有 tool calls → 使用 `SegmentedContent`
   - 否则 → 现有渲染逻辑（向后兼容旧消息）

### Step 7: Streaming 体验

**策略**：streaming 期间保持当前行为（文字流式 + tool calls 独立显示），run 完成后切换为分段渲染。

原因：streaming 期间频繁折叠文字体验不好，且 `finalizeContentBlocksToMessage` 在 `run_completed` 时才将 contentBlocks 附加到 message，之前 message 上没有 contentBlocks，自然 fall back 到当前渲染。

无需额外代码——`MessageItem` 的条件分支自动处理：
- streaming 中: `message.contentBlocks` 为 undefined → 走现有路径
- 完成后: `message.contentBlocks` 被附加 → 走 `SegmentedContent` 路径

---

## 向后兼容

| 场景 | 行为 |
|------|------|
| 旧消息（无 contentBlocks） | `MessageItem` fall back 到现有渲染 |
| 旧 server | Client 从 event stream 构建 contentBlocks（不依赖 server） |
| 旧 client | 忽略 metadata.contentBlocks，正常使用 content + toolCalls |
| 纯文字消息（无 tool calls） | contentBlocks 只有一个 text block，渲染同当前 |

## 边界情况

1. **只有文字没有 tool calls**: contentBlocks 有一个 text block，`hasContentBlocks && hasToolCalls` 为 false → 走现有渲染
2. **只有 tool calls 没有文字**: contentBlocks 只有 tool_use blocks → 每个渲染为 ToolCallItem
3. **Streaming 中断/cancel**: `run_failed` 同样调用 `finalizeContentBlocksToMessage`，部分内容也能分段显示
4. **非流式 provider**: `result` event handler 中补充 text block

---

## 验证

1. `/start-app` 重启（rebuild shared + server）
2. 发送一条需要多个 tool call 的消息（例如 "读取 package.json 然后改一下 version"）
3. **Streaming 期间**: 确认行为和现在一致（文字流式 + tool calls 独立）
4. **完成后**: 确认消息切换为分段渲染——中间文字折叠，最后文字突出
5. 点击折叠的中间文字，确认可以展开
6. 切换到另一个 session 再切回，确认分段渲染从 metadata 恢复
7. 查看旧消息（无 contentBlocks），确认仍正常渲染
8. 运行测试: `cd apps/desktop && pnpm test`
