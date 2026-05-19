// apps/desktop/src/features/meta-workflow/__tests__/NewRunDropdown.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewRunDropdown } from '../components/NewRunDropdown.js';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

describe('NewRunDropdown', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders the "New ▾" trigger', () => {
    render(
      <NewRunDropdown
        projectId="p1"
        socket={{ send: vi.fn() }}
        onNewClassicChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^New\s*▾$/ })).toBeInTheDocument();
  });

  it('clicking "New Classic Change" invokes the callback and closes', async () => {
    const onNewClassic = vi.fn();
    const user = userEvent.setup();
    render(
      <NewRunDropdown
        projectId="p1"
        socket={{ send: vi.fn() }}
        onNewClassicChange={onNewClassic}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^New\s*▾$/ }));
    await user.click(screen.getByRole('button', { name: /New Classic Change/i }));
    expect(onNewClassic).toHaveBeenCalledOnce();
    // Menu closes — "New Classic Change" no longer present.
    expect(screen.queryByRole('button', { name: /New Classic Change/i })).not.toBeInTheDocument();
  });

  it('submitting the meta form marks pending select and sends create_run', async () => {
    const sendCreateRunSpy = vi.spyOn(api, 'sendCreateRun').mockImplementation(() => {});
    const user = userEvent.setup();
    const socket = { send: vi.fn() };
    render(
      <NewRunDropdown
        projectId="p1"
        socket={socket}
        onNewClassicChange={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^New\s*▾$/ }));
    await user.click(screen.getByRole('button', { name: /New Meta Workflow Run/i }));
    await user.type(screen.getByPlaceholderText('Title'), 'My new run');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(sendCreateRunSpy).toHaveBeenCalledWith(socket, { projectId: 'p1', title: 'My new run' });
    expect(useMetaWorkflowStore.getState().pendingSelectByProject['p1']).toBe(true);
  });

  it('Create button is a no-op when title is empty/whitespace', async () => {
    const sendCreateRunSpy = vi.spyOn(api, 'sendCreateRun').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <NewRunDropdown
        projectId="p1"
        socket={{ send: vi.fn() }}
        onNewClassicChange={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^New\s*▾$/ }));
    await user.click(screen.getByRole('button', { name: /New Meta Workflow Run/i }));
    await user.type(screen.getByPlaceholderText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(sendCreateRunSpy).not.toHaveBeenCalled();
    // Pending flag must NOT be set on no-op.
    expect(useMetaWorkflowStore.getState().pendingSelectByProject['p1']).toBeUndefined();
  });
});
