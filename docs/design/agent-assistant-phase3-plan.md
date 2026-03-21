# Agent Assistant v3 — Phase 3 Implementation Plan

## Overview

Phase 3 目标：增强 Skills 系统（trigger 匹配 + requires 检查 + Context Engine 主动注入），新增 Context Engine 模板，新增高级工具。

**当前 Skills 系统已有**：discovery + lazy-load + MCP bridge 注入 + REST API。
**缺少**：frontmatter 的 `triggers`/`requires`/`priority` 解析和使用，条件注入逻辑，内置 skill 包。

---

## 依赖关系

```
Step 1 (Frontmatter 解析增强)
    │
    ├──→ Step 2 (Skill Selector + Context Engine active-skills slot)
    │
    └──→ Step 3 (内置 Skill 包)

Step 4 (Context Engine 新模板: review / debug) — 可并行

Step 5 (browser 工具) — 可独立
```

---

## Step 1: Frontmatter 解析增强

**文件**: `server/src/plugins/skill-tools.ts`

当前只解析 `name` 和 `description`，需要增加：

```ts
interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  path: string;
  // Phase 3 新增
  triggers?: {
    keywords?: string[];
    projectType?: string[];   // 'code', 'docs', 'data', etc.
  };
  requires?: {
    os?: string[];            // 'darwin', 'linux', 'win32'
    binaries?: string[];      // 'git', 'docker', 'npm'
    env?: string[];           // 'GITHUB_TOKEN', 'OPENAI_API_KEY'
  };
  priority?: number;          // 排序权重，越小越优先（默认 100）
}
```

**改动范围**：
- 扩展 `parseSkillFrontmatter()` 提取新字段
- `SkillMeta` 类型增加新字段
- `buildSkillDirectoryHint()` 按 priority 排序输出

---

## Step 2: Skill Selector + Context Engine active-skills slot

**目标**：根据上下文自动选择要注入 system prompt 的 skill。

### 2.1 Skill Selector

**新建** `server/src/plugins/skill-selector.ts`

```ts
interface SkillSelectorContext {
  userInput?: string;          // 当前用户输入（匹配 keywords）
  projectType?: string;        // 项目类型
  os?: string;                 // 当前 OS
  availableBinaries?: string[];// 已安装的命令行工具
  envVars?: string[];          // 已设置的环境变量
}

function selectSkills(
  allSkills: SkillMeta[],
  context: SkillSelectorContext,
  maxCount?: number,
): SkillMeta[]
```

选择逻辑：
1. **requires 检查**：过滤掉当前环境不满足的 skill（OS 不匹配、二进制缺失）
2. **trigger 匹配**：检查 `userInput` 是否包含 keywords，或 projectType 匹配
3. **priority 排序**：匹配的 skill 按 priority 排序
4. **数量限制**：最多注入 N 个（默认 5）

### 2.2 Context Engine 集成

在 `AssemblyInput` 新增 `activeSkillsContent?: string`。

Skill Selector 的输出（选中的 skill 内容）通过 `activeSkillsContent` 传给 Context Engine。

Agent 模板的 `active-skills` slot：

```ts
function assembleAgentTemplate(input: AssemblyInput): string {
  return [
    AGENT_SYSTEM_PROMPT,
    input.workspacePrompt,
    input.skillDirectoryHint,     // 所有 skill 的列表（按需调用）
    input.activeSkillsContent,    // 匹配的 skill 内容（主动注入）
    input.memoryContext,
    input.filePushContext,
    input.interactionToolPrompt,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}
```

### 2.3 run-handler 集成

在构建 `AssemblyInput` 时调用 Skill Selector：

```ts
// agent session 模式下，主动注入匹配的 skill
let activeSkillsContent: string | undefined;
if (sessionType === 'agent') {
  const matched = selectSkills(allSkills, {
    userInput: message.input,
    os: process.platform,
  });
  if (matched.length > 0) {
    activeSkillsContent = matched.map(s => loadSkillContent(s.id)).join('\n\n---\n\n');
  }
}
```

---

## Step 3: 内置 Skill 包

在 `server/src/plugins/builtin-skills/` 创建几个内置 skill，安装到 workspace：

| Skill | 文件 | Triggers | Requires |
|---|---|---|---|
| code-review | `code-review/SKILL.md` | keywords: ["review", "PR", "code quality"] | binaries: ["git"] |
| git-workflow | `git-workflow/SKILL.md` | keywords: ["branch", "merge", "commit"] | binaries: ["git"] |
| debugging | `debugging/SKILL.md` | keywords: ["bug", "error", "debug", "fix"] | — |
| api-design | `api-design/SKILL.md` | keywords: ["API", "endpoint", "REST"] | — |

内置 skill 通过 `skill-tools.ts` 的 discovery 自动发现（加一个内置 skill 目录路径）。

---

## Step 4: Context Engine 新模板

新增 `review` 和 `debug` 模板。

**`review` 模板**：

```ts
const REVIEW_SYSTEM_PROMPT = `You are a Code Review Agent...`;

function assembleReviewTemplate(input: AssemblyInput): string {
  return [
    REVIEW_SYSTEM_PROMPT,
    input.workspacePrompt,
    input.activeSkillsContent,  // 自动注入 code-review skill
    input.memoryContext,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}
```

`ContextTemplate` 类型扩展为 `'coding' | 'agent' | 'supervision' | 'review' | 'debug'`。

---

## Step 5: Browser 工具（Playwright）

**新建** `server/src/agent-tools/browser.ts`

Phase 3 只做最小可用版：

```ts
{
  name: 'agent_browser',
  description: 'Open a URL and get its text content (no JavaScript rendering)',
  parameters: {
    url: { type: 'string' },
  },
}
```

Phase 3 先用 `fetch` + HTML-to-text 提取，不引入 Playwright 依赖。
Playwright 版本留到 Phase 4（需要评估二进制依赖和移动端兼容性）。

---

## 实施顺序

| Step | 内容 | 依赖 | 预估 |
|---|---|---|---|
| 1 | Frontmatter 解析增强 | 无 | 0.5 天 |
| 2 | Skill Selector + Context Engine 集成 | Step 1 | 1-2 天 |
| 3 | 内置 Skill 包 | Step 1 | 0.5 天 |
| 4 | Context Engine review/debug 模板 | 无 | 0.5 天 |
| 5 | Browser 工具（轻量版） | 无 | 0.5 天 |

**总计约 3-4 天**。Step 3-5 可并行。

---

## 验证标准

1. YAML frontmatter 中 `triggers`/`requires`/`priority` 正确解析
2. `selectSkills()` 根据 keywords 匹配返回相关 skill
3. `requires` 检查过滤掉环境不满足的 skill
4. Agent session 的 system prompt 中包含匹配的 skill 内容
5. Coding session 不受影响（只有 skill 目录提示，无主动注入）
6. 内置 skill 能被发现和加载
7. Context Engine 支持 review/debug 模板
8. browser 工具能获取网页文本内容
9. 现有所有测试通过
