import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CreateScheduledTaskDialog } from '../CreateScheduledTaskDialog';
import { useScheduledTaskStore } from '../../../stores/scheduledTaskStore';

describe('CreateScheduledTaskDialog', () => {
  it('renders dialog with form fields', () => {
    useScheduledTaskStore.setState({
      create: vi.fn(),
    } as any);
    const { getByText, getByPlaceholderText } = render(
      <CreateScheduledTaskDialog projectId="p1" onClose={() => {}} />
    );
    expect(getByText('New Scheduled Task')).toBeTruthy();
    expect(getByPlaceholderText('e.g., Daily Code Review')).toBeTruthy();
  });
});
