import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const { mockLoadTriggerSources, mockWorkflowStoreState } = vi.hoisted(() => {
  const mockLoadTriggerSources = vi.fn();
  const mockWorkflowStoreState = {
    triggerSources: [],
    loadTriggerSources: mockLoadTriggerSources,
  };
  return { mockLoadTriggerSources, mockWorkflowStoreState };
});

vi.mock('../../store', () => ({
  useWorkflowStore: vi.fn(() => mockWorkflowStoreState),
}));

import { TriggerConfigForm } from '../TriggerConfigForm';

describe('TriggerConfigForm', () => {
  it('renders empty state with add button', () => {
    const { getByText } = render(
      <TriggerConfigForm triggers={[]} onChange={() => {}} />
    );
    expect(getByText('Add Trigger')).toBeTruthy();
    expect(mockLoadTriggerSources).toHaveBeenCalledTimes(1);
  });

  it('renders existing triggers', () => {
    const triggers = [{ type: 'cron' as const, cron: '0 * * * *' }];
    const { getByText } = render(
      <TriggerConfigForm triggers={triggers} onChange={() => {}} />
    );
    expect(getByText('Cron Schedule')).toBeTruthy();
  });
});
