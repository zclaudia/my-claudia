# Skills 跨 Provider 自动注入方案

## Context

我们已经实现了 MCP 工具的自动注入机制（通过 MCP bridge），但 workspace skills 目前未被使用（`server.ts:2423` 硬编码 `skills: []`）。需要让 Claudia 的 workspace skills 对所有 provider 可用。

## 问题分析

### 各 Provider 对 Skills 的原生支持

| Provider | 原生 Skills | MCP 支持 | System Prompt |
|----------|------------|----------|---------------|
| **Claude** | 有（插件/`~/.claude/commands/`，SDK 有 `skills` 字段、`Skill` 工具、`supportedCommands()` API） | 有（`sdkOptions.mcpServers`） | 有（preset append） |
| **OpenCode** | 无 | 有（`server.client.mcp.add()` API） | 有（首条消息前置） |
| **Kimi** | 无 | 有（`--mcp-config-file`） | 有（前置） |
| **Cursor** | 无 | 有（`.cursor/mcp.json`） | 有（前置） |
| **Codex** | 无 | 有（SDK `config.mcp_servers`，见 `codex-sdk.ts:284-298`） | 有（前置） |

### Claude Code Skills 的特殊优化

Claude Code 对 skills 有深度集成：

1. **惰性加载**：skill 内容不在 system prompt 中，只在 AI 调用 `Skill` 工具时才展开为完整 prompt
2. **system-reminder 机制**：可用 skills 列表通过 `<system-reminder>` 标签注入，包含 name + description + 触发条件
3. **触发匹配**：AI 根据 skill 的描述判断是否调用，调用后 skill 内容展开为 `<command-name>` 标签包裹的完整指令
4. **来源**：
   - 插件提供的 skills（通过 `plugins` 选项加载）
   - `~/.claude/commands/` 目录下的自定义 commands
   - `AgentDefinition.skills` 预加载到 subagent 上下文

### 当前 MCP Bridge 架构（已验证可用）

所有 5 个 provider 都已实现 MCP bridge 注入：

```
┌─────────────┐    MCP stdio    ┌──────────────┐    HTTP    ┌──────────────┐
│  AI Provider │ ──────────────→ │  mcp-bridge  │ ────────→ │ Claudia Server│
│  (Claude/..) │ ←────────────── │  (stdio MCP) │ ←──────── │  (tool API)  │
└─────────────┘                  └──────────────┘           └──────────────┘
```

Bridge 工具过滤条件（`source === 'plugin' || 'interaction'`）出现在：
- `claude-sdk.ts:328` — `toolRegistry.getAll().filter(...)`
- `opencode-sdk.ts` — 同
- `kimi-sdk.ts` — 同
- `cursor-sdk.ts` — 同
- `codex-sdk.ts:287` — `buildMcpBridgeConfig()` 中同逻辑

### Workspace Skills 现状

- **存储**：`~/.my-claudia/workspace/skills/{skillId}/SKILL.md`
- **Service**：`server/src/services/workspace.ts` — `listSkills()`, `loadSkill()`, `assembleSystemPrompt()`
- **API**：`server/src/routes/workspace.ts` — CRUD 接口
- **问题**：`server.ts:2423` 硬编码 `skills: []`，未被实际使用

## 方案设计

### 推荐方案：通过 MCP Bridge 暴露 Skills 为工具

复用已有的 MCP bridge 模式，将 workspace skills 注册为 MCP 工具：

```
用户创建 Skill → toolRegistry 注册 skill 工具 → MCP bridge 暴露给 provider → AI 按需调用
```

**优势：**
1. **惰性加载**：与 Claude 原生 Skill 工具行为一致，内容仅在调用时加载到上下文
2. **统一机制**：全部 5 个 provider 均已有 MCP bridge，零额外适配
3. **上下文高效**：10 个 skills × 2KB = 零上下文开销（MCP 工具只有 name+description 出现在工具列表）
4. **可发现**：工具列表自动包含 skill 信息，AI 知道可用的 skills

**与其他方案对比：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **MCP 工具（推荐）** | 惰性加载、全 provider 通用、复用基础设施 | 无明显缺点 |
| System Prompt 全量注入 | 实现简单 | 上下文浪费大（N × skill 大小）、无法惰性加载 |
| Claude 原生 + 其他 fallback | Claude 体验最优 | 双套逻辑、污染 `~/.claude/commands/` |

## 实现步骤

### Step 1: `server/src/plugins/tool-registry.ts` — 添加 `'skill'` 到 ToolSource

在 `ToolSource` 类型中新增 `'skill'` 值。

### Step 2: `server/src/plugins/skill-tools.ts` — 新建 Skill 工具注册模块

```typescript
// 伪代码
export async function registerSkillTools(): Promise<void> {
  const skills = await workspaceService.listSkills();
  for (const skill of skills) {
    toolRegistry.register({
      id: `skill__${skill.id}`,
      name: `skill__${skill.id}`,
      description: `[Skill] ${skill.name}: ${skill.description}`,
      parameters: {},  // 无参数，调用即返回内容
      source: 'skill',
      handler: async () => {
        const content = await workspaceService.loadSkill(skill.id);
        return content || `Skill "${skill.id}" not found`;
      },
    });
  }
}

export async function refreshSkillTools(): Promise<void> {
  // 清除旧 skill 工具，重新注册
  toolRegistry.removeBySource('skill');
  await registerSkillTools();
}
```

### Step 3: 更新所有 provider SDK 的 bridge 工具过滤

在 5 个文件中修改过滤条件：

```typescript
// 改前
t.source === 'plugin' || t.source === 'interaction'
// 改后
t.source === 'plugin' || t.source === 'interaction' || t.source === 'skill'
```

涉及：
- `server/src/providers/claude-sdk.ts:328`
- `server/src/providers/opencode-sdk.ts`（对应行）
- `server/src/providers/kimi-sdk.ts`（对应行）
- `server/src/providers/cursor-sdk.ts`（对应行）
- `server/src/providers/codex-sdk.ts:287`（`buildMcpBridgeConfig`）

### Step 4: `server/src/server.ts` — 启动时注册 skill 工具 + 修复 skills 硬编码

1. 在 server 启动流程中调用 `registerSkillTools()`（在 `initWorkspace()` 之后）
2. 修复 `server.ts:2423` 的 `skills: []` 硬编码（不再需要通过 system prompt 注入全量 skill 内容）
3. 可选：在 system prompt 中添加轻量 skill 目录提示，帮助 AI 理解有哪些 skill 工具可用

### Step 5: `server/src/routes/workspace.ts` — CRUD 后刷新工具注册

在 skill 的 POST/PUT/DELETE 路由 handler 中调用 `refreshSkillTools()`，确保工具列表实时更新。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/src/plugins/skill-tools.ts` | **新建** | Skill → MCP 工具注册与刷新 |
| `server/src/plugins/tool-registry.ts` | 修改 | `ToolSource` 类型加 `'skill'`；可能需加 `removeBySource()` |
| `server/src/providers/claude-sdk.ts` | 修改 | bridge 过滤加 `'skill'` |
| `server/src/providers/opencode-sdk.ts` | 修改 | 同上 |
| `server/src/providers/kimi-sdk.ts` | 修改 | 同上 |
| `server/src/providers/cursor-sdk.ts` | 修改 | 同上 |
| `server/src/providers/codex-sdk.ts` | 修改 | 同上 |
| `server/src/server.ts` | 修改 | 启动注册 + 修复 `skills: []` |
| `server/src/routes/workspace.ts` | 修改 | CRUD 后刷新 skill 工具 |

## 验证方式

1. 创建测试 skill：`~/.my-claudia/workspace/skills/test-skill/SKILL.md`
2. 启动 server，确认 `/api/plugins/tools` 返回包含 `skill__test-skill`
3. 对 Claude provider 启动会话，确认 init 消息的工具列表包含 skill 工具
4. 在对话中触发 skill 调用，确认返回完整 SKILL.md 内容
5. 通过 API 删除 skill 后重新检查工具列表，确认已移除
6. 运行 `pnpm test` 确认无回归

## 注意事项

1. **工具名前缀**：使用 `skill__` 前缀避免与 plugin 工具名冲突
2. **大文件保护**：workspace.ts 已有 MAX_FILE_SIZE (100KB) 限制，可考虑对 MCP 工具返回值加更严格限制（如 10KB）
3. **时序**：`registerSkillTools()` 必须在 MCP bridge 启动前完成，确保首次 `tools/list` 包含所有 skill 工具
4. **热更新限制**：MCP bridge 在 session 初始化时调用 `tools/list`，session 中途新增的 skill 不会自动出现，需新 session 生效
