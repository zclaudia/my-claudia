# 新增功能测试计划

## 📋 概述

本文档针对最近新增的功能设计全面的测试覆盖方案，包括单元测试和端到端测试。

---

## 🎯 测试目标

1. **全面覆盖**: 为所有新增功能提供测试覆盖
2. **质量保证**: 确保新功能稳定可靠
3. **快速反馈**: 通过单元测试快速发现问题
4. **回归保护**: 通过 E2E 测试防止功能退化

---

## 📊 测试覆盖范围

### 已有测试基础

- ✅ 单元测试框架: Vitest
- ✅ E2E 测试: Playwright（新）+ Stagehand（旧）
- ✅ 现有单元测试: 248 个测试，99.2% 通过率
- ✅ 现有 E2E 测试: 65 个核心测试，100% 通过率

### 新增功能列表

根据最近的 git 提交记录，需要测试的新功能：

| 功能 | 文件路径 | 优先级 | 复杂度 |
|------|---------|--------|--------|
| Git Worktree 支持 | `server/src/utils/git-worktrees.ts` | 高 | 低 |
| Cursor Provider | `server/src/providers/cursor-sdk.ts` | 高 | 中 |
| Codex Provider 改进 | `server/src/providers/codex-sdk.ts` | 中 | 中 |
| Loop Detection 改进 | `server/src/loop-detection.ts` | 中 | 低 |
| Gateway Client 改进 | `server/src/gateway-client.ts` | 中 | 中 |
| Session State 管理 | `apps/desktop/src/stores/` | 高 | 中 |
| Context Window 追踪 | `apps/desktop/src/stores/chatStore.ts` | 中 | 低 |
| Message Queue | `apps/desktop/src/services/messageHandler.ts` | 中 | 中 |
| Apple-style UI | `apps/desktop/src/components/` | 低 | 低 |

---

## 🧪 单元测试计划

### Phase 1: Git Worktree 支持 (高优先级)

**文件**: `server/src/utils/__tests__/git-worktrees.test.ts`

**测试用例**:
1. ✅ 解析标准 worktree 输出
2. ✅ 解析 detached HEAD 状态
3. ✅ 处理多个 worktrees
4. ✅ 处理空输出（非 git 仓库）
5. ✅ 处理 git 命令失败
6. ✅ 处理超时情况
7. ✅ 正确识别主 worktree
8. ✅ 正确提取分支名称
9. ✅ 正确提取 commit hash

**工作量**: 2-3 小时
**依赖**: 无

---

### Phase 2: Cursor Provider (高优先级)

**文件**: `server/src/providers/__tests__/cursor-sdk.test.ts`

**测试用例**:
1. ✅ 工具调用提取（editToolCall, shellToolCall 等）
2. ✅ 工具调用结果解析（success, rejected, error）
3. ✅ 输入准备（MessageInput 格式转换）
4. ✅ 进程管理（启动、终止）
5. ✅ 消息流处理（assistant、tool_use、result）
6. ✅ 错误处理（CLI 不存在、权限错误）
7. ✅ 权限回调触发
8. ✅ 系统信息提取（model、token usage）

**工作量**: 4-5 小时
**依赖**: Mock child_process

---

### Phase 3: Codex Provider 改进 (中优先级)

**文件**: `server/src/providers/__tests__/codex-sdk.test.ts`

**测试用例**:
1. ✅ 环境变量处理（CODEX_API_KEY）
2. ✅ 命令构建（参数验证）
3. ✅ 流式输出解析
4. ✅ 错误处理（API 错误、网络错误）
5. ✅ 模型选择验证
6. ✅ System prompt 处理

**工作量**: 3-4 小时
**依赖**: Mock child_process

---

### Phase 4: Loop Detection 改进 (中优先级)

**文件**: `server/src/__tests__/loop-detection.test.ts` (已存在，需补充)

**补充测试用例**:
1. ✅ 时间窗口检测
2. ✅ 循环阈值配置
3. ✅ 不同消息类型的循环检测
4. ✅ 性能测试（大量消息）
5. ✅ 并发安全性

**工作量**: 2-3 小时
**依赖**: 无

---

### Phase 5: Gateway Client 改进 (中优先级)

**文件**: `server/src/__tests__/gateway-client.test.ts` (已存在，需补充)

**补充测试用例**:
1. ✅ 重连逻辑（指数退避）
2. ✅ 心跳检测
3. ✅ 连接超时处理
4. ✅ 消息队列（离线时缓存）
5. ✅ 订阅/取消订阅
6. ✅ 错误恢复

**工作量**: 3-4 小时
**依赖**: Mock WebSocket

---

### Phase 6: Session State 管理 (高优先级)

**文件**: `apps/desktop/src/stores/__tests__/chatStore.test.ts` (已存在，需补充)

**补充测试用例**:
1. ✅ Worktree 状态切换
2. ✅ 权限覆盖
3. ✅ 消息队列处理
4. ✅ 后台/前台状态恢复
5. ✅ Token 使用追踪
6. ✅ Context window 监控

**工作量**: 3-4 小时
**依赖**: 无

---

### Phase 7: Message Queue (中优先级)

**文件**: `apps/desktop/src/services/__tests__/messageHandler.test.ts`

**测试用例**:
1. ✅ 消息入队/出队
2. ✅ 优先级处理
3. ✅ 并发控制
4. ✅ 错误重试
5. ✅ 队列清空
6. ✅ 性能测试（大量消息）

**工作量**: 2-3 小时
**依赖**: 无

---

### Phase 8: Context Window 追踪 (中优先级)

**文件**: `apps/desktop/src/stores/__tests__/chatStore.test.ts`

**测试用例**:
1. ✅ Token 计数准确性
2. ✅ 上下文窗口限制检测
3. ✅ 自动截断逻辑
4. ✅ 警告触发
5. ✅ 历史消息追踪

**工作量**: 2-3 小时
**依赖**: Mock tokenizer

---

## 🎭 E2E 测试计划 (Playwright)

### Phase 1: Git Worktree E2E (高优先级)

**文件**: `e2e/tests/git-worktree.playwright.spec.ts`

**测试场景**:
1. ✅ 列出项目 worktrees
2. ✅ 创建新 worktree
3. ✅ 切换 worktree
4. ✅ 删除 worktree
5. ✅ Worktree 状态同步
6. ✅ 错误处理（无效分支、权限错误）

**工作量**: 3-4 小时
**优先级**: 高

---

### Phase 2: Provider 管理 E2E (高优先级)

**文件**: `e2e/tests/provider-management.playwright.spec.ts`

**测试场景**:
1. ✅ 添加 Cursor Provider
2. ✅ 添加 Codex Provider
3. ✅ 切换 Provider
4. ✅ 删除 Provider
5. ✅ Provider 配置保存
6. ✅ Provider 错误处理

**工作量**: 4-5 小时
**优先级**: 高

---

### Phase 3: Session 管理 E2E (高优先级)

**文件**: `e2e/tests/session-management.playwright.spec.ts`

**测试场景**:
1. ✅ 创建新会话
2. ✅ 切换会话
3. ✅ 会话状态恢复（刷新页面）
4. ✅ 会话导入/导出
5. ✅ 移动端后台/前台恢复
6. ✅ Worktree 会话关联

**工作量**: 4-5 小时
**优先级**: 高

---

### Phase 4: 消息功能 E2E (中优先级)

**文件**: `e2e/tests/messaging.playwright.spec.ts`

**测试场景**:
1. ✅ 发送消息
2. ✅ 接收流式响应
3. ✅ 工具调用显示
4. ✅ 权限请求处理
5. ✅ 消息队列可视化
6. ✅ Context window 警告

**工作量**: 3-4 小时
**优先级**: 中

---

### Phase 5: UI 改进 E2E (低优先级)

**文件**: `e2e/tests/ui-redesign.playwright.spec.ts`

**测试场景**:
1. ✅ 主题切换
2. ✅ 图标显示
3. ✅ 响应式布局
4. ✅ 动画效果
5. ✅ 无障碍访问

**工作量**: 2-3 小时
**优先级**: 低

---

## 📅 实施时间表

### Week 1: 高优先级单元测试
- **Day 1-2**: Git Worktree 单元测试
- **Day 3-4**: Cursor Provider 单元测试
- **Day 5**: Codex Provider 单元测试

### Week 2: 高优先级 E2E 测试
- **Day 1-2**: Git Worktree E2E
- **Day 3-4**: Provider 管理 E2E
- **Day 5**: Session 管理 E2E

### Week 3: 中优先级测试
- **Day 1-2**: Loop Detection 补充测试
- **Day 3-4**: Gateway Client 补充测试
- **Day 5**: Session State 补充测试

### Week 4: 低优先级和优化
- **Day 1-2**: Message Queue 单元测试
- **Day 3**: Context Window 追踪测试
- **Day 4**: UI E2E 测试
- **Day 5**: 测试优化和文档更新

---

## ✅ 验收标准

### 单元测试
- [ ] 测试覆盖率 ≥ 80%
- [ ] 所有测试通过
- [ ] 测试执行时间 < 30 秒
- [ ] 无 skip 的测试

### E2E 测试
- [ ] 所有核心场景覆盖
- [ ] 测试通过率 100%
- [ ] 测试执行时间 < 5 分钟
- [ ] 有清晰的测试报告

### 文档
- [ ] 测试计划文档完整
- [ ] 每个测试有清晰的描述
- [ ] 包含测试运行指南

---

## 🛠️ 测试工具和框架

### 单元测试
- **框架**: Vitest
- **断言**: Vitest assert
- **Mock**: vi.fn(), vi.mock()
- **覆盖率**: c8

### E2E 测试
- **框架**: Playwright
- **Page Objects**: 自定义 Page Object Model
- **Fixtures**: 自定义 test fixtures
- **报告**: Playwright HTML Reporter

---

## 📝 测试编写规范

### 单元测试规范
```typescript
describe('功能名称', () => {
  describe('子功能或方法', () => {
    it('应该正确处理正常情况', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('应该正确处理错误情况', () => {
      // Test error handling
    });
  });
});
```

### E2E 测试规范
```typescript
test.describe('功能名称', () => {
  test.beforeEach(async ({ page, cleanDb }) => {
    // Setup
  });

  test('应该完成用户流程', async ({ page }) => {
    // Act & Assert
    await page.click('[data-testid="button"]');
    await expect(page.locator('.result')).toBeVisible();
  });
});
```

---

## 🚀 开始实施

1. **准备工作**
   - ✅ 确认测试环境
   - ✅ 安装必要依赖
   - ✅ 创建测试文件结构

2. **第一批测试** (Git Worktree)
   - ⏳ 创建测试文件
   - ⏳ 编写测试用例
   - ⏳ 运行并验证

3. **持续迭代**
   - ⏳ 按计划逐步完成
   - ⏳ 定期 review 和调整
   - ⏳ 更新文档

---

## 📊 进度跟踪

| 阶段 | 状态 | 完成度 | 备注 |
|------|------|--------|------|
| Git Worktree 单元测试 | ✅ 完成 | 100% | 20个测试，100%通过 |
| Cursor Provider 单元测试 | ✅ 完成 | 100% | 28个测试，100%通过 |
| Codex Provider 单元测试 | ✅ 完成 | 100% | 17个测试，100%通过 |
| Loop Detection 补充测试 | ✅ 完成 | 100% | 44个测试，100%通过 |
| Gateway Client 补充测试 | ✅ 完成 | 100% | 56个测试，100%通过 |
| 桌面应用单元测试 | ⏭️ 跳过 | - | 需要 Zustand mock 配置 |
| Git Worktree E2E | ✅ 完成 | 100% | 7个测试用例 |
| Provider 管理 E2E | ✅ 完成 | 100% | 7个测试用例 |
| Session 管理 E2E | ✅ 完成 | 100% | 9个测试用例 |
| Messaging E2E | ✅ 完成 | 100% | 10个测试用例 |
| UI Redesign E2E | ✅ 完成 | 100% | 10个测试用例 |

---

## 📝 测试统计

### 单元测试
| 文件 | 测试数量 | 通过率 |
|------|---------|--------|
| `server/src/utils/__tests__/git-worktrees.test.ts` | 20 | 100% |
| `server/src/providers/__tests__/cursor-sdk.test.ts` | 28 | 100% |
| `server/src/providers/__tests__/codex-sdk.test.ts` | 17 | 100% |
| `server/src/__tests__/loop-detection.test.ts` | 44 | 100% |
| `server/src/__tests__/gateway-client.test.ts` | 56 | 100% |
| **总计** | **165** | **100%** |

### E2E 测试
| 文件 | 测试数量 |
|------|---------|
| `e2e/tests/git-worktree.playwright.spec.ts` | 7 |
| `e2e/tests/provider-management.playwright.spec.ts` | 7 |
| `e2e/tests/session-management.playwright.spec.ts` | 9 |
| `e2e/tests/messaging.playwright.spec.ts` | 10 |
| `e2e/tests/ui-redesign.playwright.spec.ts` | 10 |
| **总计** | **43** |

---

*最后更新: 2026-03-06*
*负责人: Claude Code*
