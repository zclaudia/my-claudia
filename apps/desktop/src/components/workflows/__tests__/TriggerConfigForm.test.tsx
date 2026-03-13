import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TriggerConfigForm } from '../TriggerConfigForm';

describe('TriggerConfigForm', () => {
  it('renders empty state with add button', () => {
    const { getByText } = render(
      <TriggerConfigForm triggers={[]} onChange={() => {}} />
    );
    expect(getByText('Add Trigger')).toBeTruthy();
  });

  it('renders existing triggers', () => {
    const triggers = [{ type: 'cron' as const, cron: '0 * * * *' }];
    const { getByText } = render(
      <TriggerConfigForm triggers={triggers} onChange={() => {}} />
    );
    expect(getByText('Cron Schedule')).toBeTruthy();
  });
});
