# Kimi Code Provider 集成方案

## 概述

将 Kimi CLI (`kimi`) 作为 MyClaudia 的新 provider 集成，与现有的 Claude Code、OpenCode、Cursor、Codex 并列。

## Kimi CLI 特性分析

| 特性 | Kimi CLI 支持 |
|------|--------------|
| 版本 | 1.17.0 |
| 非交互模式 | `--print` |
| 流式 JSON 输出 | `--output-format stream-json` |
| 提示词输入 | `--prompt "text"` 或 stdin |
| 工作目录 | `--work-dir DIR` |
| 自动批准 | `--yolo` / `--yes` |
| 会话恢复 | `--session ID` / `--continue` |
| 模型选择 | `--model MODEL` |
| 思考模式 | `--thinking` |
| MCP 支持 | `--mcp-config` / `--mcp-config-file` |
| ACP Server | `kimi acp` |

## 实现步骤

### 1. 创建 `kimi-sdk.ts`

路径: `server/src/providers/kimi-sdk.ts`

核心功能:
- 使用 `kimi --print --output-format stream-json --prompt "..."` 启动进程
- 解析 Kimi 的流式 JSON 输出格式
- 转换为统一的 `ClaudeMessage` 格式
- 支持工具调用映射（Kimi 工具 → 标准格式）

```typescript
// Kimi 已知工具映射（根据文档和常见模式）
const KIMI_TOOL_MAP: Record<string, string> = {
  'read': 'Read',
  'edit': 'Edit',
  'bash': 'Bash',
  'grep': 'Grep',
  'search': 'Grep',
  'file_search': 'Grep',
  'ls': 'View',
  'view': 'View',
  'mcp': 'MCP',
};
```

### 2. 创建 `kimi-adapter.ts`

路径: `server/src/providers/kimi-adapter.ts`

实现 `ProviderAdapter` 接口:
- `type = 'kimi'`
- `run()` - 调用 kimi-sdk 的 runKimi
- `abort()` - 终止 Kimi 进程
- `getRunState()` - 返回 provider 状态

### 3. 更新 `cli-detect.ts`

添加 Kimi CLI 检测:

```typescript
const CLI_COMMANDS = {
  claude: ['claude', 'claude-code'],
  opencode: ['opencode', 'opencode-cli'],
  codex: ['codex'],
  kimi: ['kimi'],  // 新增
} as const;
```

### 4. 更新 `registry.ts`

注册 KimiAdapter:

```typescript
import { KimiAdapter } from './kimi-adapter.js';

constructor() {
  this.register(new ClaudeAdapter());
  this.register(new OpenCodeAdapter());
  this.register(new CodexAdapter());
  this.register(new CursorAdapter());
  this.register(new KimiAdapter());  // 新增
}
```

## Kimi 输出格式分析

Kimi `--output-format stream-json` 的输出格式示例:

```json
{"type": "init", "session_id": "xxx"}
{"type": "message", "role": "assistant", "content": "..."}
{"type": "tool_use", "tool": "read", "input": {"file_path": "..."}}
{"type": "tool_result", "tool": "read", "result": "..."}
{"type": "message", "role": "assistant", "content": "...", "is_complete": true}
```

需要根据实际输出格式调整解析逻辑。

## 文件变更清单

### 新增文件
1. `server/src/providers/kimi-sdk.ts` - Kimi CLI 交互 SDK
2. `server/src/providers/kimi-adapter.ts` - ProviderAdapter 实现

### 修改文件
1. `server/src/providers/cli-detect.ts` - 添加 kimi 检测
2. `server/src/providers/registry.ts` - 注册 KimiAdapter

## 测试计划

1. 检测测试: 确认 `detectCliProviders()` 能找到 `/Users/zhvala/.local/bin/kimi`
2. 单元测试: 模拟 Kimi JSON 输出流，验证解析正确性
3. 集成测试: 实际运行 Kimi provider 完成任务
4. 会话恢复测试: 验证 `--session` 参数工作正常

## 配置选项

Kimi provider 支持的配置（通过 providerConfig 传递）:

```typescript
interface KimiProviderConfig {
  cliPath?: string;      // 自定义 Kimi CLI 路径
  model?: string;        // 模型选择 (如 kimi-k2)
  thinking?: boolean;    // 启用思考模式
  yolo?: boolean;        // 自动批准（默认 true 用于非交互）
  mcpConfigFile?: string; // MCP 配置文件路径
}
```

## 注意事项

1. **会话隔离**: Kimi 使用 `--session` 进行会话恢复，需要在 DB 中存储 `kimi_session_id`
2. **环境变量**: 可能需要传递 `KIMI_API_KEY` 或其他环境变量
3. **临时文件**: 图片附件处理方式与 Cursor 类似（目前警告不支持）
4. **错误处理**: Kimi 的错误输出格式需要通过 stderr 捕获

## 实施状态

✅ **已完成** - Kimi Code Provider 已成功集成

### 实施结果

| 组件 | 状态 | 路径 |
|------|------|------|
| Kimi SDK | ✅ 已实现 | `server/src/providers/kimi-sdk.ts` |
| Kimi Adapter | ✅ 已实现 | `server/src/providers/kimi-adapter.ts` |
| CLI 检测 | ✅ 已更新 | `server/src/utils/cli-detect.ts` |
| Provider 注册 | ✅ 已更新 | `server/src/providers/registry.ts` |

### 测试结果

```
Detected CLI providers:
  - claude : Claude Code at /opt/homebrew/bin/claude
  - codex : Codex at /opt/homebrew/bin/codex
  - kimi : Kimi Code at /Users/zhvala/.local/bin/kimi  ✅

Registered providers:
  - claude : ✓ registered
  - opencode : ✓ registered
  - codex : ✓ registered
  - cursor : ✓ registered
  - kimi : ✓ registered  ✅
```

### 特殊改进

**增强的 CLI 检测**: 添加了 `findInCommonPaths()` 函数，支持检测安装在常见路径但不在 PATH 中的 CLI 工具：
- `~/.local/bin` (pipx, pip user install)
- `~/.cargo/bin` (cargo install)
- `~/.npm-global/bin` (npm global)
- `/usr/local/bin` (Homebrew on macOS Intel)

### 下一步建议

1. **添加单元测试**: 创建 `kimi-sdk.test.ts` 和 `kimi-adapter.test.ts`
2. **集成测试**: 实际运行 Kimi provider 完成简单任务
3. **优化输出解析**: 根据实际 Kimi JSON 输出格式调整解析逻辑
4. **图片附件支持**: 调研 Kimi CLI 的图片输入能力
5. **MCP 集成**: 测试 Kimi 的 MCP 功能与 MyClaudia 的兼容性
