import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StepConfigForm } from '../StepConfigForm';
import { useWorkflowStore } from '../../../stores/workflowStore';
import type { WorkflowNodeDef } from '@my-claudia/shared';

vi.mock('../../../stores/workflowStore', () => ({
  useWorkflowStore: Object.assign(vi.fn(() => ({ stepTypes: [] })), {
    getState: vi.fn(() => ({ stepTypes: [] })),
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}));

vi.mock('../JsonSchemaConfigForm', () => ({
  JsonSchemaConfigForm: (props: any) => <div data-testid="json-schema-form" />,
}));

function makeStep(overrides: Partial<WorkflowNodeDef> = {}): WorkflowNodeDef {
  return {
    id: 'step_1',
    type: 'shell',
    name: 'My Step',
    config: {},
    ...overrides,
  } as WorkflowNodeDef;
}

describe('StepConfigForm', () => {
  const onChange = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    onDelete.mockReset();
  });

  it('renders the header and delete button', () => {
    const step = makeStep();
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Node Configuration');
    expect(container.textContent).toContain('Delete Node');
  });

  it('renders name and id inputs with step values', () => {
    const step = makeStep({ name: 'Test Step', id: 'node_42' });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    const inputs = container.querySelectorAll('input[type="text"]');
    const nameInput = Array.from(inputs).find(
      (el) => (el as HTMLInputElement).value === 'Test Step',
    );
    const idInput = Array.from(inputs).find(
      (el) => (el as HTMLInputElement).value === 'node_42',
    );
    expect(nameInput).toBeTruthy();
    expect(idInput).toBeTruthy();
  });

  it('calls onChange when name is updated', () => {
    const step = makeStep({ name: 'Old' });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    const inputs = container.querySelectorAll('input[type="text"]');
    const nameInput = Array.from(inputs).find(
      (el) => (el as HTMLInputElement).value === 'Old',
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
  });

  it('calls onDelete when delete button clicked', () => {
    const step = makeStep();
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    const deleteBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete Node',
    );
    fireEvent.click(deleteBtn!);
    expect(onDelete).toHaveBeenCalled();
  });

  it('displays step type label for shell', () => {
    const step = makeStep({ type: 'shell' });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Shell Command');
  });

  it('renders command textarea for shell type', () => {
    const step = makeStep({ type: 'shell', config: { command: 'echo hi' } });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe('echo hi');
  });

  it('renders prompt textarea for ai_prompt type', () => {
    const step = makeStep({ type: 'ai_prompt', config: { prompt: 'review code' } });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe('review code');
  });

  it('renders on-error options', () => {
    const step = makeStep();
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('abort');
    expect(container.textContent).toContain('skip');
    expect(container.textContent).toContain('retry');
    expect(container.textContent).toContain('route');
  });

  it('shows error route message when onError is route', () => {
    const step = makeStep({ onError: 'route' });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Connect the red Error handle');
  });

  it('shows retry count input when onError is retry', () => {
    const step = makeStep({ onError: 'retry', retryCount: 3 });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Max Retries');
    const numberInput = container.querySelector('input[type="number"][min="1"]') as HTMLInputElement;
    expect(numberInput).toBeTruthy();
    expect(numberInput.value).toBe('3');
  });

  it('renders timeout input', () => {
    const step = makeStep({ timeoutMs: 120000 });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Timeout (seconds)');
    const numberInput = container.querySelector('input[type="number"][min="5"]') as HTMLInputElement;
    expect(numberInput).toBeTruthy();
    expect(numberInput.value).toBe('120');
  });

  it('renders webhook config with url and method select', () => {
    const step = makeStep({ type: 'webhook', config: { url: 'https://example.com', method: 'POST' } });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('URL');
    expect(container.textContent).toContain('Method');
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
  });

  it('renders condition expression input', () => {
    const step = makeStep({ type: 'condition', config: {}, condition: { expression: 'x == 1' } });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Expression');
    const inputs = container.querySelectorAll('input[type="text"]');
    const exprInput = Array.from(inputs).find(
      (el) => (el as HTMLInputElement).value === 'x == 1',
    );
    expect(exprInput).toBeTruthy();
  });

  it('renders wait type selector', () => {
    const step = makeStep({ type: 'wait', config: { type: 'approval' } });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('Wait Type');
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
  });

  it('shows no configuration message for unknown type without schema', () => {
    const step = makeStep({ type: 'unknown_plugin_step' as any, config: {} });
    const { container } = render(
      <StepConfigForm step={step} onChange={onChange} onDelete={onDelete} />,
    );
    expect(container.textContent).toContain('No configuration available');
  });
});
