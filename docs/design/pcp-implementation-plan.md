# PCP v1 Implementation Plan

## Overview

基于 `provider-capability-protocol.md` 设计文档，在现有代码上增量实现 PCP v1。

**原则**：不重写任何现有架构，全部增量叠加。现有 `ProviderAdapter` 接口保留，PCP 作为上层包装。

---

## Capability Taxonomy (v1 Final)

6 大类 15 个 capability：

### Generation
| ID | 说明 |
|---|---|
| `chat.generate` | 非流式生成（plugin API `call()` 需要） |
| `chat.stream` | 流式生成（所有 provider 的 `run()` 方法） |

### Tooling
| ID | 说明 |
|---|---|
| `tool.call` | provider 能发起结构化工具调用（emit tool_use 事件） |
| `tool.inject` | provider 接受外部工具注入（MCP bridge） |

### Structured Interaction
| ID | 说明 |
|---|---|
| `interaction.form` | 结构化问答（ask_user_form） |
| `interaction.approval` | 审批确认（request_approval） |
| `interaction.todo` | todo 更新（update_todo_list） |

### Input
| ID | 说明 |
|---|---|
| `input.image` | 图片附件 |
| `input.text_file` | 文本文件附件 |
| `input.binary_file` | 二进制文件引用 |

### Permission
| ID | 说明 |
|---|---|
| `permission.mode` | 统一权限模式支持 |

### Session
| ID | 说明 |
|---|---|
| `session.abort` | 中止当前 run |
| `session.background_task` | 后台任务执行和监控 |

---

## Phase 1: PCP 基础类型定义

**目标**：在 shared/ 中定义 PCP 类型系统，不改任何运行逻辑。

### 1.1 新建 `shared/src/core/pcp.ts`

```ts
// === Capability IDs ===

export type PCPCapabilityId =
  | 'chat.generate'
  | 'chat.stream'
  | 'tool.call'
  | 'tool.inject'
  | 'interaction.form'
  | 'interaction.approval'
  | 'interaction.todo'
  | 'input.image'
  | 'input.text_file'
  | 'input.binary_file'
  | 'permission.mode'
  | 'session.abort'
  | 'session.background_task';

// === Capability Metadata ===

export type CapabilityMode = 'native' | 'bridged' | 'emulated';
export type ReliabilityTier = 'strict' | 'best_effort' | 'display_only';
export type DegradationPolicy = 'reject' | 'fallback_to_text' | 'fallback_to_notice' | 'server_emulation';

// === Image Attachment Modes ===

export type ImageAttachmentMode = 'data_uri' | 'file_path' | 'temp_file';

// === Unified Permission Modes ===

export type PCPPermissionMode = 'supervised' | 'auto_edit' | 'autonomous' | 'plan_only';

// === Capability Descriptor ===

export interface PCPCapabilityDescriptor {
  id: PCPCapabilityId;
  supported: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  degradation?: DegradationPolicy;
  limits?: Record<string, string | number | boolean>;
  notes?: string;
}

// === Input Capability Extensions ===

export interface ImageCapabilityDescriptor extends PCPCapabilityDescriptor {
  id: 'input.image';
  /** Supported image attachment modes, ordered by preference */
  attachmentModes?: ImageAttachmentMode[];
}

// === Permission Capability Extensions ===

export interface PermissionCapabilityDescriptor extends PCPCapabilityDescriptor {
  id: 'permission.mode';
  /** Which PCP permission modes this provider supports */
  supportedModes?: PCPPermissionMode[];
}

// === Provider Manifest ===

export type ProviderRuntimeKind = 'cli' | 'sdk' | 'http' | 'bridge';

export interface PCPProviderManifest {
  id: string;                       // e.g. 'claude', 'opencode'
  name: string;                     // display name
  version: string;                  // provider plugin version
  apiVersion: 'pcp/v1';

  providerType: string;             // logical type
  runtime: ProviderRuntimeKind;

  capabilities: PCPCapabilityDescriptor[];

  /** Permission mode mapping: PCP standard mode → provider native mode string */
  permissionModeMap?: Partial<Record<PCPPermissionMode, string>>;
}

// === Effective Provider Profile ===

export interface PCPEffectiveCapability {
  id: PCPCapabilityId;
  enabled: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  degradation?: DegradationPolicy;
  reason?: string;  // why disabled or degraded
}

export interface PCPEffectiveProfile {
  providerId: string;
  providerType: string;
  sessionId?: string;
  model?: string;

  capabilities: PCPEffectiveCapability[];
  negotiatedAt: number;
}
```

### 1.2 修改 `shared/src/index.ts`

新增导出：

```ts
export * from './core/pcp';
```

### 1.3 不修改任何现有类型

`ProviderAdapter`、`ProviderConfig`、`PermissionMode` 全部保留，PCP 类型是独立新增。

---

## Phase 2: Provider Manifest 静态声明

**目标**：为每个内建 provider 创建静态 manifest，在 registry 中关联。

### 2.1 新建 `server/src/providers/manifests.ts`

为 5 个 provider 定义 manifest：

```ts
import type { PCPProviderManifest } from '@my-claudia/shared';

export const CLAUDE_MANIFEST: PCPProviderManifest = {
  id: 'claude',
  name: 'Claude',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'claude',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false, notes: 'Not implemented in v1, planned' },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict',
      limits: { attachmentModes: 'temp_file,file_path' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: true, mode: 'native', reliability: 'best_effort' },
  ],
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'acceptEdits',
    autonomous: 'bypassPermissions',
    plan_only: 'plan',
  },
};

// OpenCode, Codex, Cursor, Kimi 类似，根据实际能力填写
// 具体差异参见设计文档 Section 6 Provider Support Snapshot
```

每个 provider 的 manifest 要点：

| Provider | tool.inject | interaction.* reliability | session.background_task | permission modes |
|---|---|---|---|---|
| Claude | native/strict | bridged/strict | native/best_effort | 4 种全支持 |
| OpenCode | native/strict | bridged/best_effort | 不支持 | supervised, autonomous, plan_only |
| Codex | native/strict | bridged/best_effort | 不支持 | 4 种全支持（映射不同） |
| Cursor | bridged/best_effort | bridged/best_effort | 不支持 | supervised, plan_only |
| Kimi | bridged/best_effort | bridged/best_effort | 不支持 | supervised, autonomous, plan_only |

### 2.2 扩展 `ProviderAdapter` 接口

在 `server/src/providers/types.ts` 新增可选字段：

```ts
export interface ProviderAdapter {
  readonly type: string;
  /** PCP manifest — static capability declaration */
  readonly manifest?: PCPProviderManifest;
  // ... existing methods unchanged
}
```

### 2.3 扩展 `ProviderRegistry`

在 `server/src/providers/registry.ts` 新增 manifest 查询方法：

```ts
getManifest(providerType: string): PCPProviderManifest | undefined {
  return this.get(providerType)?.manifest;
}

getAllManifests(): PCPProviderManifest[] {
  return Array.from(this.adapters.values())
    .map(a => a.manifest)
    .filter((m): m is PCPProviderManifest => !!m);
}
```

### 2.4 每个 adapter 构造函数关联 manifest

```ts
// claude-adapter.ts
export class ClaudeAdapter implements ProviderAdapter {
  readonly type = 'claude';
  readonly manifest = CLAUDE_MANIFEST;
  // ...
}
```

---

## Phase 3: 运行期 Profile 协商

**目标**：run 启动时计算 EffectiveProfile，为后续 capability 路由提供依据。

### 3.1 新建 `server/src/providers/pcp-negotiator.ts`

```ts
export function negotiateProfile(
  manifest: PCPProviderManifest,
  context: {
    model?: string;
    mode?: string;
    hasMcpBridge?: boolean;
    serverPort?: number;
  }
): PCPEffectiveProfile
```

协商逻辑：

1. 从 manifest.capabilities 复制基础声明
2. 检查 MCP bridge 是否可用 → 影响 `tool.inject` 和 `interaction.*`
3. 检查 mode → `plan_only` 模式下某些 capability 可能被禁用
4. 生成 `negotiatedAt` 时间戳

### 3.2 在 `run-handler.ts` 的 handleRunStart 中插入协商

在现有 provider 选择逻辑之后、`provider.run()` 调用之前：

```ts
// 现有逻辑：选择 provider
const provider = registry.getOrDefault(providerId);

// 新增：PCP 协商
let effectiveProfile: PCPEffectiveProfile | undefined;
if (provider.manifest) {
  effectiveProfile = negotiateProfile(provider.manifest, {
    model: message.model,
    mode: modeValue,
    hasMcpBridge: true, // 当前所有 provider 都有 MCP bridge
    serverPort: ctx?.serverPort ?? null,
  });
}

// 将 profile 存入 activeRun，供后续使用
activeRun.effectiveProfile = effectiveProfile;
```

### 3.3 扩展 ActiveRun 类型

```ts
interface ActiveRun {
  // ... existing fields
  effectiveProfile?: PCPEffectiveProfile;
}
```

### 3.4 暴露 profile 给前端

新增 WebSocket 消息类型，在 run 启动时发送：

```ts
// run 启动后发送给前端
sendToClient(client, {
  type: 'run_profile',
  sessionId,
  profile: effectiveProfile,
});
```

---

## Phase 4: 权限模式统一层

**目标**：PCP 标准模式 → provider 原生模式的映射。

### 4.1 新建 `server/src/providers/pcp-permission.ts`

```ts
export function mapPermissionMode(
  manifest: PCPProviderManifest,
  pcpMode: PCPPermissionMode,
): string {
  // 从 manifest.permissionModeMap 查映射
  // 如果不支持该模式，降级到最接近的模式
  const mapped = manifest.permissionModeMap?.[pcpMode];
  if (mapped) return mapped;

  // 降级策略
  // autonomous → supervised（安全降级）
  // auto_edit → supervised（安全降级）
  return manifest.permissionModeMap?.supervised ?? 'default';
}
```

### 4.2 在 run-handler.ts 中使用映射

现有代码直接把 `message.permissionMode` 透传给 provider。改为：

```ts
// 如果前端发来的是 PCP 标准模式，映射到 provider 原生模式
const nativeMode = provider.manifest
  ? mapPermissionMode(provider.manifest, modeValue as PCPPermissionMode)
  : modeValue;
```

### 4.3 前端发送 PCP 标准模式

`PermissionSelector` 组件改为发送 PCP 标准模式名（supervised/auto_edit/autonomous/plan_only），而非 provider 原生模式名。

当前 `ProviderCapabilities.modes` 已经为每个 provider 定义了可用模式列表，可以直接映射。

---

## Phase 5: Capability 感知的交互工具注入

**目标**：根据 provider 的 capability profile 决定是否注入交互工具。

### 5.1 修改 `interaction-tools.ts` 注册逻辑

当前所有交互工具全局注册，对所有 provider 无差别注入。改为：

```ts
export function shouldInjectInteractionTool(
  toolId: string,
  profile?: PCPEffectiveProfile,
): boolean {
  if (!profile) return true; // 无 profile 时默认注入（兼容）

  const capabilityMap: Record<string, PCPCapabilityId> = {
    'ask_user_form': 'interaction.form',
    'request_approval': 'interaction.approval',
    'update_todo_list': 'interaction.todo',
    'push_file': 'tool.inject',  // push_file 依赖 tool.inject 能力
  };

  const capId = capabilityMap[toolId];
  if (!capId) return true;

  const cap = profile.capabilities.find(c => c.id === capId);
  return cap?.enabled ?? false;
}
```

### 5.2 交互工具的 reliability 标注

在 `InteractionBase` 中新增可选字段：

```ts
export interface InteractionBase {
  // ... existing fields
  reliability?: ReliabilityTier;  // 来自 provider profile
}
```

前端可以根据 `reliability` 决定：
- `strict` → 正常渲染，等待用户操作
- `best_effort` → 渲染但加提示"结果可能不可靠"
- `display_only` → 只展示，不提供交互按钮

---

## Phase 6: 前端 Capability 感知

**目标**：前端根据 EffectiveProfile 调整 UI。

### 6.1 处理 `run_profile` 消息

在 `messageHandler.ts` 中新增：

```ts
case 'run_profile':
  // 存入 session store 或独立 store
  useSessionStore.getState().setActiveProfile(msg.sessionId, msg.profile);
  break;
```

### 6.2 UI 适配（最小改动）

- 权限选择器：只显示当前 provider 支持的 PCP 模式
- 交互组件：根据 reliability 显示不同样式
- 附件按钮：根据 `input.image` capability 显示/隐藏

这些是渐进式改动，不需要第一版全部做完。

---

## 实施顺序和依赖关系

```
Phase 1 (类型) ──→ Phase 2 (Manifest) ──→ Phase 3 (协商)
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                               Phase 4    Phase 5    Phase 6
                              (权限映射) (工具注入) (前端适配)
```

Phase 1-3 是串行依赖，Phase 4-6 可以并行。

---

## 验证标准

每个 Phase 完成后的验证：

| Phase | 验证方式 |
|---|---|
| 1 | `pnpm build` 通过，类型导出正确 |
| 2 | 每个 provider 有 manifest，registry 可查询 |
| 3 | run 启动时 console 输出 effectiveProfile |
| 4 | 切换权限模式时，不同 provider 收到正确的原生模式 |
| 5 | 不支持 interaction 的 provider 不会收到交互工具注入 |
| 6 | 前端根据 profile 调整 UI 元素可见性 |

---

## 风险和缓解

| 风险 | 缓解 |
|---|---|
| manifest 声明与实际行为不一致 | Phase 2 后跑一轮手动验证 |
| 协商层引入性能开销 | negotiateProfile 是纯同步计算，<1ms |
| 权限映射错误导致安全问题 | 降级策略始终往"更严格"方向降 |
| 前端改动影响现有交互 | Phase 6 用 `profile?.` 可选链，无 profile 时保持原行为 |
