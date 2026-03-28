# Batch 13: E2E Tests & Scripts Review

日期：2026-03-28
状态：✅ 完成

## 概览

| 指标 | 值 |
|------|-----|
| E2E 测试文件 | 48 active |
| 脚本文件 | 15+ |
| CI 工作流 | 3 |

## 发现

### 🔴 高优先级

#### 1. 测试重复严重（HIGH）
- **问题**: 13 个 `.playwright.spec.ts` 文件与 8+ 个 `.spec.ts` 重复覆盖相同功能
- **影响**: 维护成本翻倍，修改需改两处
- **修复**: 整合为单一测试运行器（推荐 Vitest）

#### ~~2. CI Secrets 泄漏风险~~ → 🟢 LOW（校验修订）
- **文件**: `.github/workflows/release-macos.yml:59`
- **原始判定**: HIGH
- **校验结果**: GitHub Actions **自动遮蔽**所有 `secrets.*` 值（日志中显示 `***`）。即使开启 `set -x`，密钥也不会明文出现在日志中。脚本无 `set -x`。实际风险极低。

#### 3. 测试 Flakiness — 619 个硬编码超时（HIGH）
- **问题**: `waitForTimeout`, `setTimeout`, `sleep` 共 619 处，时间值任意
- **影响**: CI 中随机失败
- **修复**: 替换为基于元素的等待 (`waitFor`, `waitForFunction`)

#### ~~4. macOS 构建脚本缺少错误处理~~ → ✅ 无问题（校验修订）
- **文件**: `scripts/build/macos.sh:205-206`
- **原始判定**: HIGH
- **校验结果**: **误报**。脚本第 5 行有 `set -euo pipefail`，任何命令失败都会立即退出。`pnpm run build` 失败不会被静默忽略。

### 🟠 中优先级

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | Playwright config 硬编码 zsh | playwright.config.ts:71 | bash 环境中 CI 失败 |
| 6 | Server deploy 无 health check | scripts/deploy/server.sh | 重启后不验证服务是否正常 |
| 7 | Gateway deploy 无 build timeout | scripts/deploy/gateway.sh:73 | docker build 可能无限 hang |
| 8 | Vitest config 加载未使用的 AI utils | e2e/vitest.config.e2e.ts | 死配置 |
| 9 | Android versionCode 溢出风险 | scripts/release/version-bump.sh:89 | 大版本号可超 int32 |
| 10 | Deploy 脚本无回滚能力 | server.sh, gateway.sh | 失败后需手动恢复 |
| 11 | 测试临时密码未清理 | macOS build | shell 变量中残留签名密码 |
| 12 | Playwright CI 无 test run before release | CI workflow | 可能发布未测试代码 |

### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 13 | 7 个 legacy wrapper 脚本 | 仅转发调用，增加困惑 |
| 14 | BrowserAdapter `as any` | e2e/helpers/browser-adapter.ts:84 |
| 15 | 诊断脚本无清理 | diagnose-kimi.js 22KB 疑似废弃 |
| 16 | Deploy .env 未验证格式 | 畸形 .env 静默接受 |
| 17 | 部署日志截断 20 行 | 可能遗漏真实错误 |
| 18 | 测试 `set +x` / `.only` 风险 | 可能意外提交聚焦测试 |

### ✅ 做得好的

1. **macOS 构建脚本整体优秀** — keychain 清理 trap、代码签名 fallback、版本管理
2. **Dev 脚本质量高** — start-app.sh 有多重 trap handler + 端口等待
3. **Gateway deploy 有 health check** — 12 次重试 60s
4. **Setup-server.sh 完善** — 预检查 + systemd 配置 + 用户引导
5. **E2E 测试场景覆盖广** — 48 个测试文件覆盖核心功能

## 脚本质量评分

| 脚本 | 错误处理 | 评分 |
|------|---------|------|
| scripts/build/macos.sh | `set -euo`, cleanup traps | A |
| scripts/deploy/server.sh | `set -euo`, 但缺 health check | B+ |
| scripts/deploy/gateway.sh | `set -euo`, 但缺 build timeout | B+ |
| scripts/dev/start-app.sh | 多重 trap, 端口等待 | A |
| scripts/dev/run-server.sh | 进程状态跟踪, readiness check | A |
| scripts/deploy/setup-server.sh | 预检查, 详细引导 | A |

## 发现汇总

| 严重程度 | 数量 |
|---------|------|
| HIGH | 4 |
| MEDIUM | 8 |
| LOW | 6 |
| **总计** | **18** |

## 核心建议

1. **立即**: 修复 CI secrets 泄漏、macOS build 错误处理
2. **本周**: 整合重复测试（选择 Vitest 或 Playwright，不要两个都用）
3. **本迭代**: 替换 619 个硬编码超时、添加 deploy health check
4. **下迭代**: 添加回滚能力、CI 发布前运行测试
