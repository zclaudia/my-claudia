import { describe, expect, it, vi } from 'vitest';
import { PermissionBridge } from '../permission-bridge.js';
import type { PermissionEscalationContext } from '../../../../domains/workflows/ports/step-executor.js';

function createContext(overrides: Partial<PermissionEscalationContext> = {}): PermissionEscalationContext {
  return {
    requestId: 'req-1',
    runId: 'run-1',
    sessionId: 'session-1',
    toolName: 'Bash',
    toolInput: { command: 'pnpm test' },
    detail: 'pnpm test',
    cwd: '/workspace',
    category: 'shellSafe',
    isEscalateAlways: false,
    sessionType: 'regular',
    ...overrides,
  };
}

describe('PermissionBridge', () => {
  it('notifies workflow resolution before releasing the provider permission promise', () => {
    const calls: string[] = [];
    const onWorkflowResolved = vi.fn(() => {
      calls.push('notify-ui');
    });
    const resolve = vi.fn((decision) => {
      calls.push(`resolve-provider:${decision.behavior}`);
    });

    const bridge = new PermissionBridge({ onWorkflowResolved });
    const context = createContext();
    bridge.register('req-1', resolve, context);

    const resolved = bridge.resolvePermission('req-1', 'allow', 'AI review approved');

    expect(resolved).toBe(true);
    expect(calls).toEqual(['notify-ui', 'resolve-provider:allow']);
    expect(onWorkflowResolved).toHaveBeenCalledWith({
      requestId: 'req-1',
      decision: 'allow',
      reason: 'AI review approved',
      context,
    });
    expect(resolve).toHaveBeenCalledWith({
      behavior: 'allow',
      message: undefined,
      updatedInput: context.toolInput,
    });
  });

  it('still resolves the provider permission when the notification hook throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolve = vi.fn();
    const bridge = new PermissionBridge({
      onWorkflowResolved: () => {
        throw new Error('broadcast failed');
      },
    });
    bridge.register('req-1', resolve, createContext());

    expect(bridge.resolvePermission('req-1', 'deny')).toBe(true);
    expect(resolve).toHaveBeenCalledWith({
      behavior: 'deny',
      message: 'Denied by permission workflow',
      updatedInput: undefined,
    });

    errorSpy.mockRestore();
  });
});
