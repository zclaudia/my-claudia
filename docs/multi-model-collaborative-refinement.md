# Multi-Model Collaborative Refinement（多模型协作校准）

## Overview

利用 Cursor 的多模型特性，让多个顶级模型（GPT-Codex、Gemini、Claude Opus 等）进行"协作校准"来生成更高质量的复杂计划。

### 核心价值

- **交叉验证**：不同模型有不同的优势和视角，可以互相补充
- **减少盲点**：一个模型的错误可能被另一个模型发现
- **质量提升**：经过多轮优化，计划更加完善

---

## 使用场景

| 场景 | 描述 |
|------|------|
| 架构设计 | 复杂项目的技术方案设计 |
| 重构计划 | 大规模代码重构的策略规划 |

---

## 流程设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Multi-Model Collaborative Refinement              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  用户输入: "设计一个微服务架构..."                                    │
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ Model A  │───▶│ Model B  │───▶│ Model C  │───▶│ Model A  │──┐   │
│  │ (GPT)    │    │ (Gemini) │    │ (Claude) │    │ (GPT)    │  │   │
│  │ 生成 v1  │    │ 优化 v2  │    │ 优化 v3  │    │ 审核 v4  │  │   │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │   │
│       ▲                                              │          │   │
│       │              模型自判: "足够好?"             │          │   │
│       └──────────────────────────────────────────────┘          │   │
│                          │                                       │   │
│                          ▼ "是"                                  │   │
│                   ┌──────────┐                                   │   │
│                   │ 最终输出  │                                   │   │
│                   │ (v4)     │                                   │   │
│                   └──────────┘                                   │   │
│                                                                   │   │
└─────────────────────────────────────────────────────────────────────┘
```

### 链式传递模式

每个模型只看到上一个模型的输出，形成"传话筒"式的协作：

1. **Model A (GPT-Codex)**: 生成初始版本 v1
2. **Model B (Gemini)**: 审查 v1，输出优化版本 v2
3. **Model C (Claude Opus)**: 审查 v2，输出优化版本 v3
4. **Model A (GPT-Codex)**: 再次审核 v3，输出 v4
5. **循环判断**: 模型决定是否继续优化

### 停止条件：模型自判

每个模型在输出时需要回答：
- 这个计划是否已经足够好？
- 是否还有明显可以改进的地方？

如果模型认为"足够好"，则停止循环，输出最终版本。

---

## 设计决策

| 维度 | 决策 | 说明 |
|------|------|------|
| 使用场景 | 架构设计、重构计划 | 复杂、高风险的规划任务 |
| 触发方式 | 手动触发 | 用户明确选择使用此模式 |
| 模型配置 | 用户自定义 | 可以选择模型和顺序 |
| 信息传递 | 链式传递 | 每个模型只看上一个输出 |
| 停止条件 | 模型自判 | 模型认为足够好时停止 |
| 输出展示 | 仅最终版 | 简洁，只显示最终结果 |

---

## 用户配置

### 模型配置示例

```json
{
  "name": "我的多模型协作流程",
  "models": [
    { "provider": "codex", "model": "o3", "role": "generator" },
    { "provider": "gemini", "model": "gemini-2.0-flash", "role": "reviewer" },
    { "provider": "claude", "model": "claude-opus-4-6", "role": "reviewer" }
  ],
  "maxRounds": 3,
  "stopCondition": "model-self-judge"
}
```

### 角色定义

| 角色 | 描述 | Prompt 偏好 |
|------|------|-------------|
| generator | 初始生成者 | 创造性、开放性 |
| reviewer | 审查优化者 | 批判性、严谨性 |

---

## Prompt 设计

### Generator Prompt (第一个模型)

```
你是一个资深软件架构师。请根据用户的需求，设计一个详细的技术方案。

用户需求：
{user_input}

请输出：
1. 问题分析
2. 设计目标
3. 技术方案
4. 实施步骤
5. 风险评估

在输出最后，请评估：
- 这个方案的完整性如何？(1-10)
- 是否有明显的遗漏或风险？
- 建议下一步优化的方向
```

### Reviewer Prompt (后续模型)

```
你是一个资深软件架构师，负责审查和优化技术方案。

原始需求：
{user_input}

上一版本方案（由 {previous_model} 生成）：
{previous_output}

请审查这个方案：
1. 指出存在的问题和不足
2. 提出改进建议
3. 输出优化后的版本

在输出最后，请评估：
- 这个方案现在是否足够完善？(1-10)
- 是否还需要继续优化？(是/否)
- 如果需要，建议下一步优化方向
```

---

## UI 设计

### 触发入口

在 Agent Assistant 或主聊天界面中：
- 添加 "多模型协作" 按钮
- 或使用特殊命令 `/collaborate`

### 配置界面

```
┌─────────────────────────────────────────────────────────────┐
│ 多模型协作校准                                    [配置] [开始] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 模型顺序:                                                   │
│ ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│ │ 1. GPT  │──▶│ 2. Gemini│──▶│ 3. Claude│──▶ [循环]        │
│ │ o3      │   │ 2.0 Flash│   │ Opus 4  │                   │
│ └─────────┘   └─────────┘   └─────────┘                   │
│                                                             │
│ 最大轮数: [3]                                               │
│ 停止条件: 模型自判                                          │
│                                                             │
│ [添加模型] [移除] [上移] [下移]                              │
│                                                             │
└─────────────────────────────────────���───────────────────────┘
```

### 执行界面

```
┌─────────────────────────────────────────────────────────────┐
│ 多模型协作进行中...                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ████████████████████░░░░░░░░░░  60% (第 2 轮)              │
│                                                             │
│ ✓ GPT o3 (生成 v1) - 完成                                   │
│ ● Gemini 2.0 Flash (优化 v2) - 进行中...                    │
│ ○ Claude Opus 4 (优化 v3) - 等待                            │
│ ○ GPT o3 (审核 v4) - 等待                                   │
│                                                             │
│ [查看中间结果] [取消]                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 结果界面

```
┌─────────────────────────────────────────────────────────────┐
│ 多模型协作完成                                 [查看历史] [复制] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 经过 3 个模型，2 轮协作优化，最终方案如下：                   │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ ## 技术方案：微服务架构设计                                   │
│                                                             │
│ ### 1. 问题分析                                             │
│ ...                                                         │
│                                                             │
│ ### 2. 设计目标                                             │
│ ...                                                         │
│                                                             │
│ ### 3. 技术方案                                             │
│ ...                                                         │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ [开始实施] [保存为文档] [重新生成]                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现方案

### 集成到 Agent Assistant 插件平台

这个功能可以作为 Agent Assistant 插件平台的一个**内置插件**：

```
server/src/plugins/builtin/
└── multi-model-collab/
    ├── index.ts          # 插件入口
    ├── config.json       # 默认配置
    └── prompts/
        ├── generator.ts  # 生成者 prompt
        └── reviewer.ts   # 审查者 prompt
```

### 工具定义

```typescript
{
  name: 'collaborative_plan',
  description: '使用多个 AI 模型协作生成和优化计划',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: '任务描述' },
      models: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            role: { type: 'string', enum: ['generator', 'reviewer'] }
          }
        },
        description: '模型配置列表'
      },
      maxRounds: { type: 'number', default: 3 }
    },
    required: ['task']
  }
}
```

### 核心流程

```typescript
async function collaborativePlan(args: CollaborativePlanArgs, ctx: PluginContext) {
  const { task, models, maxRounds = 3 } = args;

  let currentVersion = '';
  let round = 0;
  let isComplete = false;

  while (!isComplete && round < maxRounds) {
    for (const modelConfig of models) {
      const prompt = round === 0 && modelConfig.role === 'generator'
        ? buildGeneratorPrompt(task)
        : buildReviewerPrompt(task, currentVersion, modelConfig);

      // 调用对应 provider 的模型
      const response = await ctx.session.callModel({
        provider: modelConfig.provider,
        model: modelConfig.model,
        messages: [{ role: 'user', content: prompt }]
      });

      currentVersion = response.content;

      // 检查模型是否认为足够好
      if (response.metadata?.isComplete) {
        isComplete = true;
        break;
      }
    }
    round++;
  }

  ctx.reportResult({ type: 'text', content: currentVersion });
}
```

---

## 后续扩展

### Phase 1: MVP
- [ ] 实现基础的链式传递
- [ ] 支持 3 个模型配置
- [ ] 模型自判停止

### Phase 2: 增强
- [ ] 支持查看中间结果
- [ ] 支持用户手动干预
- [ ] 支持保存配置模板

### Phase 3: 高级
- [ ] 并行评审模式（多个模型同时审查）
- [ ] 投票机制（多个模型投票决定最佳方案）
- [ ] 专家模型（特定领域使用特定模型）

---

## 插件实现方案

### 设计决策

| 维度 | 决策 | 说明 |
|------|------|------|
| AI 调用方式 | 底层 SDK 访问 | 插件直接调用 Provider SDK |
| Provider 配置 | 复用现有 Provider | 使用用户已配置的 Provider |
| UI 展示 | 独立面板 | 有自己的界面 |
| 执行环境 | 前后端分离 | 服务端执行逻辑，前端渲染 UI |

### App 需要提供的 API

```typescript
// ========== App 需要新增的插件 API ==========

// 1. Provider 调用 API
interface ProviderAPI {
  // 列出可用的 providers
  listProviders(): Promise<Provider[]>;

  // 调用指定 provider 进行 AI 对话
  callProvider(options: {
    providerId: string;
    modelOverride?: string;
    messages: ChatMessage[];
    stream?: boolean;
  }): Promise<ChatResponse | AsyncGenerator<ChatStreamChunk>>;
}

// 2. UI 扩展 API
interface UIAPI {
  // 注册独立面板
  registerPanel(panel: {
    id: string;
    title: string;
    icon?: string;
    component: React.ComponentType;
    position?: 'sidebar' | 'main';
  }): void;

  // 打开/关闭面板
  openPanel(panelId: string): void;
  closePanel(panelId: string): void;
}

// 3. 存储 API
interface StorageAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<Record<string, any>>;
}
```

### 插件结构

```
multi-model-collab/
├── manifest.json              # 插件元数据
├── index.ts                   # 入口：activate() 函数
├── components/
│   ├── MultiModelPanel.tsx    # 主面板组件
│   ├── CollabConfigForm.tsx   # 配置表单
│   ├── ProgressBar.tsx        # 进度条
│   └── ResultDisplay.tsx      # 结果展示
├── lib/
│   ├── collaboration.ts       # 协作逻辑
│   └── prompts.ts             # Prompt 模板
└── styles.css                 # 样式（可选）
```

### manifest.json

```json
{
  "id": "com.myclaudia.multi-model-collab",
  "name": "Multi-Model Collaborative Refinement",
  "version": "1.0.0",
  "description": "使用多个 AI 模型协作生成和优化计划",
  "permissions": ["provider.call", "storage", "ui.panel"],
  "executionMode": "frontend",

  "contributes": {
    "commands": [
      {
        "id": "multiModel.start",
        "title": "Start Multi-Model Collaboration",
        "category": "AI"
      }
    ],
    "uiExtensions": [
      {
        "id": "multiModel.panel",
        "location": "sidebar",
        "title": "Multi-Model Collab",
        "icon": "git-merge"
      }
    ],
    "menus": [
      {
        "location": "command-palette",
        "commandId": "multiModel.start"
      }
    ],
    "keybindings": [
      {
        "command": "multiModel.start",
        "key": "cmd+shift+m"
      }
    ]
  }
}
```

### index.ts

```typescript
import { MultiModelPanel } from './components/MultiModelPanel';

export async function activate(ctx: PluginContext) {
  // 注册命令
  ctx.registerCommand({
    id: 'multiModel.start',
    handler: () => ctx.ui.openPanel('multiModel.panel'),
  });

  // 注册 UI 面板
  ctx.ui.registerPanel({
    id: 'multiModel.panel',
    title: 'Multi-Model Collaboration',
    icon: 'git-merge',
    component: MultiModelPanel,
    position: 'sidebar',
  });
}
```

### App 改造清单

| 改造项 | 文件 | 改造内容 |
|--------|------|----------|
| **Provider API** | `server/src/services/plugin-provider-api.ts` | 新增：封装 provider 调用，暴露给插件 |
| **UI 扩展点** | `apps/desktop/src/components/PluginPanelHost.tsx` | 新增：动态加载插件面板组件 |
| **插件 API 前端** | `apps/desktop/src/services/plugin-context.ts` | 新增：前端插件上下文，提供 UI/Provider API |
| **插件 API 后端** | `server/src/services/plugin-context.ts` | 新增：后端插件上下文，提供 Storage/Event API |
| **面板注册表** | `apps/desktop/src/stores/pluginStore.ts` | 新增：管理已注册的面板 |

---

## Open Questions

1. **Token 成本**：多轮多模型调用成本较高，是否需要限制？
2. **超时处理**：如果某个模型响应过慢，如何处理？
3. **错误恢复**：如果某个模型调用失败，是否重试或跳过？
4. **版本管理**：是否需要保存每个版本的完整历史？
