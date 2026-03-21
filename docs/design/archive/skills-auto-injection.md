# Skills 跨 Provider 自动注入方案

## Context

我们已经实现了 MCP 工具的自动注入机制（通过 MCP bridge），但 workspace skills 目前未被使用（`server.ts:2423` 硬编码 `skills: []`）。需要让 Claudia 的 workspace skills 对所有 provider 可用。

此外，外部工具（如 DevHelper）也提供了 skills 目录（`SKILL.md` + `references/`），需要一并支持。

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

### Skill 来源

#### 1. Workspace Skills（内置）

- **存储**：`~/.my-claudia/workspace/skills/{skillId}/SKILL.md`
- **Service**：`server/src/services/workspace.ts` — `listSkills()`, `loadSkill()`, `assembleSystemPrompt()`
- **API**：`server/src/routes/workspace.ts` — CRUD 接口
- **问题**：`server.ts:2423` 硬编码 `skills: []`，未被实际使用

#### 2. 外部 Skill 目录（如 DevHelper）

- **示例**：`/Applications/DevHelper.app/Contents/Resources/skills/`
- **结构**：`{skillDir}/{skillId}/SKILL.md` + 可选 `references/` 子目录
- **SKILL.md 格式**：YAML frontmatter（name, description, version）+ Markdown 正文
- **配置方式**：通过 DB 存储额外 skill 目录（类似 plugin 的 `extraDirs`）

## 方案设计

### 推荐方案：通过 MCP Bridge 暴露 Skills 为工具

复用已有的 MCP bridge 模式，将 workspace skills + 外部 skills 统一注册为 MCP 工具：

```
Skill 来源（workspace / 外部目录）
        ↓ discover + 解析 SKILL.md frontmatter
toolRegistry 注册 skill 工具（name + description 从 frontmatter 提取）
        ↓
MCP bridge 暴露给 provider
        ↓
AI 按需调用 → handler 返回 SKILL.md 完整内容 + references/
```

**优势：**
1. **惰性加载**：与 Claude 原生 Skill 工具行为一致，内容仅在调用时加载到上下文
2. **统一机制**：全部 5 个 provider 均已有 MCP bridge，零额外适配
3. **上下文高效**：MCP 工具只有 name+description 出现在工具列表，零上下文开销
4. **可发现**：工具列表自动包含 skill 信息，AI 知道可用的 skills
5. **多来源**：workspace + 外部目录统一处理，同一套注册/发现逻辑

**与其他方案对比：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **MCP 工具（推荐）** | 惰性加载、全 provider 通用、复用基础设施 | 无明显缺点 |
| System Prompt 全量注入 | 实现简单 | 上下文浪费大（N × skill 大小）、无法惰性加载 |
| Claude 原生 + 其他 fallback | Claude 体验最优 | 双套逻辑、污染 `~/.claude/commands/` |

## 实现步骤

### Step 1: `server/src/plugins/tool-registry.ts` — 添加 `'skill'` 到 ToolSource

在 `ToolSource` 类型中新增 `'skill'` 值。添加 `removeBySource(source)` 方法用于批量清除。

### Step 2: `server/src/plugins/skill-tools.ts` — 新建 Skill 工具注册模块

```typescript
// 伪代码
import { toolRegistry } from './tool-registry.js';
import { workspaceService } from '../services/workspace.js';

// SKILL.md frontmatter 解析
interface SkillMeta {
  id: string;          // 目录名
  name: string;        // frontmatter.name
  description: string; // frontmatter.description
  source: string;      // 'workspace' | 目录路径
}

/**
 * 从 SKILL.md 的 YAML frontmatter 提取 name + description。
 * 格式：--- \n name: xxx \n description: xxx \n ---
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } { ... }

/**
 * 扫描一个 skill 目录，返回所有 skill 元信息。
 * 支持嵌套：如果子目录没有 SKILL.md，则递归进入。
 */
function discoverSkillsInDir(dir: string): SkillMeta[] { ... }

/**
 * 加载 skill 完整内容：SKILL.md + references/ 下所有文件拼接。
 */
function loadSkillContent(skillPath: string): string { ... }

export async function registerSkillTools(): Promise<void> {
  const skills: SkillMeta[] = [];

  // 1. Workspace skills
  const workspaceSkills = await workspaceService.listSkills();
  for (const skill of workspaceSkills) {
    skills.push({ id: skill.id, name: skill.name, description: skill.description, source: 'workspace' });
  }

  // 2. 外部 skill 目录（从 DB 读取配置）
  for (const dir of getExternalSkillDirs()) {
    skills.push(...discoverSkillsInDir(dir));
  }

  for (const skill of skills) {
    toolRegistry.register({
      id: `skill__${skill.id}`,
      definition: {
        type: 'function',
        function: {
          name: `skill__${skill.id}`,
          description: `[Skill] ${skill.name}: ${skill.description}`,
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What you want to accomplish with this skill (optional context for the skill)',
              },
            },
          },
        },
      },
      source: 'skill',
      handler: async (args) => {
        // 返回完整 SKILL.md 内容 + references
        const content = skill.source === 'workspace'
          ? await workspaceService.loadSkill(skill.id)
          : loadSkillContent(skillPathFor(skill));
        return content || `Skill "${skill.id}" not found`;
      },
    });
  }
}

export async function refreshSkillTools(): Promise<void> {
  toolRegistry.removeBySource('skill');
  await registerSkillTools();
}
```

**关键设计决策：**

- **`query` 参数**：可选参数，让 AI 告诉 skill 它想做什么。handler 可将 query 和 SKILL.md 内容一起返回，AI 拿到后再决定具体操作。
- **references 合并**：`loadSkillContent()` 将 `SKILL.md` 和 `references/` 下的文件合并返回，提供完整上下文。
- **嵌套目录**：`discoverSkillsInDir()` 递归扫描，支持 `skills/category/skill-name/SKILL.md` 结构。
- **大小限制**：单个 skill 返回内容限制 50KB（workspace 已有 100KB 限制，此处更严格以保护上下文）。

### Step 3: 外部 Skill 目录配置

复用 plugin 的 `app_config` 表模式：

```sql
-- key: 'skill_extra_dirs', value: JSON array of paths
-- 示例: '["/Applications/DevHelper.app/Contents/Resources/skills"]'
```

在 `skill-tools.ts` 中：
```typescript
function getExternalSkillDirs(): string[] {
  // 从 DB app_config 表读取 'skill_extra_dirs'
}
```

在 `workspace.ts` 路由中添加 API：
- `GET /api/workspace/skill-dirs` — 获取外部 skill 目录列表
- `PUT /api/workspace/skill-dirs` — 更新外部 skill 目录列表（更新后调用 `refreshSkillTools()`）

### Step 4: 更新所有 provider SDK 的 bridge 工具过滤

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

### Step 5: `server/src/server.ts` — 启动时注册 skill 工具

1. 在 server 启动流程中调用 `registerSkillTools()`（在 `initWorkspace()` 之后）
2. **保留 Claude 原生 skills 通道**：`skills: []` 硬编码保持不变或传入 `~/.claude/commands/` — MCP bridge 只负责 workspace + 外部 skills，Claude 原生 skills（`~/.claude/commands/`）走原生通道，两者不冲突

### Step 6: `server/src/routes/workspace.ts` — CRUD 后刷新工具注册

在 skill 的 POST/PUT/DELETE 路由 handler 中调用 `refreshSkillTools()`，确保工具列表实时更新。

### Step 7: System Prompt 目录提示（可选但推荐）

在 system prompt append 中添加轻量 skill 目录，帮助 AI 知道何时调用 skill 工具：

```
Available skills (call the corresponding skill__xxx tool to load full instructions):
- skill__helper-gitlab: GitLab MR operations, code review, merge requests
- skill__helper-jira: Jira issue management, search, transitions
```

这与 Claude 原生 `<system-reminder>` 中的 skill 列表逻辑一致，确保 AI 有足够信息判断何时触发。

实现方式：在 `assembleSystemPrompt()` 中追加 skill 目录段落（只列 name + description，不含内容）。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/src/plugins/skill-tools.ts` | **新建** | Skill 发现、注册、刷新；支持 workspace + 外部目录 |
| `server/src/plugins/tool-registry.ts` | 修改 | `ToolSource` 类型加 `'skill'`；新增 `removeBySource()` |
| `server/src/providers/claude-sdk.ts` | 修改 | bridge 过滤加 `'skill'` |
| `server/src/providers/opencode-sdk.ts` | 修改 | 同上 |
| `server/src/providers/kimi-sdk.ts` | 修改 | 同上 |
| `server/src/providers/cursor-sdk.ts` | 修改 | 同上 |
| `server/src/providers/codex-sdk.ts` | 修改 | 同上 |
| `server/src/server.ts` | 修改 | 启动时调用 `registerSkillTools()` |
| `server/src/routes/workspace.ts` | 修改 | Skill CRUD 后调用 `refreshSkillTools()`；新增 skill-dirs API |
| `server/src/services/workspace.ts` | 修改 | `assembleSystemPrompt()` 追加 skill 目录提示 |

## 验证方式

1. 创建 workspace skill：`~/.my-claudia/workspace/skills/test-skill/SKILL.md`
2. 配置外部 skill 目录：`PUT /api/workspace/skill-dirs` 添加 DevHelper skills 路径
3. 启动 server，确认 `/api/plugins/tools` 返回包含 `skill__test-skill` 和 `skill__helper-gitlab` 等
4. 对 Claude provider 启动会话，确认 init 消息的工具列表包含 skill 工具
5. 在对话中触发 skill 调用（如「帮我看一下这个 MR」），确认 AI 调用 `skill__helper-gitlab` 并返回完整 SKILL.md + references 内容
6. 通过 API 删除 skill 后重新检查工具列表，确认已移除
7. 运行 `pnpm test` 确认无回归

## 注意事项

1. **工具名前缀**：使用 `skill__` 前缀避免与 plugin 工具名冲突
2. **大小限制**：单个 skill 返回内容限制 50KB，防止大文件撑爆上下文
3. **时序**：`registerSkillTools()` 必须在 MCP bridge 启动前完成，确保首次 `tools/list` 包含所有 skill 工具
4. **热更新限制**：MCP bridge 的 `tools/list` 是动态查询 toolRegistry 的，理论上新增 skill 后如果 provider 重新请求 `tools/list` 可以生效。但大部分 provider 在 session 初始化时只调用一次，所以实际上需要新 session 或 reset session 生效
5. **Claude 原生通道保留**：不修改 `skills: []` 硬编码，Claude 的 `~/.claude/commands/` 走原生 Skill 工具，workspace + 外部 skills 走 MCP bridge，两者共存互不干扰
6. **嵌套目录**：外部 skill 目录支持嵌套扫描（与 plugin loader 的嵌套目录扫描逻辑一致）
