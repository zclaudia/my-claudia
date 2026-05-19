// apps/desktop/src/features/meta-workflow/__tests__/ReusePoolScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReusePoolScreen } from '../components/ReusePoolScreen.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';

function makeItem(overrides: Partial<ReusablePoolItem> = {}): ReusablePoolItem {
  return {
    id: 'a',
    kind: 'workflow',
    entityId: 'w1',
    phaseType: 'code-implement',
    description: 'desc-a',
    tags: ['x', 'y'],
    sourceType: 'auto',
    metadata: { usageCount: 3 },
    createdAt: Date.now(),
    ...overrides,
  } as ReusablePoolItem;
}

describe('ReusePoolScreen', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: { p1: { screen: 'reuse-pool', poolFilters: {} } },
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders loading state then items', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([
      makeItem({ id: 'a', entityId: 'w1' }),
      makeItem({ id: 'b', entityId: 'w2', sourceType: 'user' }),
    ]);
    render(<ReusePoolScreen projectId="p1" />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/w1/)).toBeInTheDocument();
      expect(screen.getByText(/w2/)).toBeInTheDocument();
    });
  });

  it('changing phaseType filter triggers a new API call', async () => {
    const spy = vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'code-test-write');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][0]).toMatchObject({ phaseType: 'code-test-write' });
  });

  it('empty state when API returns no items', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/No items match/i)).toBeInTheDocument();
    });
  });

  it('shows API error', async () => {
    vi.spyOn(api, 'listReusePool').mockRejectedValue(new Error('boom'));
    render(<ReusePoolScreen projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
    });
  });

  it('Back to Board switches view', async () => {
    vi.spyOn(api, 'listReusePool').mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ReusePoolScreen projectId="p1" />);
    await user.click(screen.getByRole('button', { name: /Back to Board/i }));
    expect(useMetaWorkflowStore.getState().viewByProject['p1'].screen).toBe('phase-board');
  });
});
