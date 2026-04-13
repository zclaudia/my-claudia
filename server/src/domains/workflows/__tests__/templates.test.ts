import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOW_TEMPLATES, PERMISSION_WORKFLOW_TEMPLATE_ID } from '../templates.js';

describe('workflow templates', () => {
  it('does not auto-approve ExitPlanMode in the default permission workflow', () => {
    const template = BUILTIN_WORKFLOW_TEMPLATES.find((item) => item.id === PERMISSION_WORKFLOW_TEMPLATE_ID);

    expect(template).toBeDefined();
    expect(template?.definition.nodes.some((node) => node.id === 'check_exit_plan_mode')).toBe(false);
    expect(template?.definition.nodes.some((node) => node.id === 'wait_exit_plan')).toBe(false);
    expect(template?.definition.nodes.some((node) => node.id === 'decide_approve_exit_plan')).toBe(false);
    expect(template?.definition.edges.some((edge) => edge.source === 'check_escalate' && edge.type === 'condition_true')).toBe(false);
  });
});
