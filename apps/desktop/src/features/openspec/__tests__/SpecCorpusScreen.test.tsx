// apps/desktop/src/features/openspec/__tests__/SpecCorpusScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpecCorpusScreen } from '../components/SpecCorpusScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('SpecCorpusScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('shows Initialize Specs CTA when corpus empty', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No specs yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Initialize Specs/ })).toBeInTheDocument();
  });

  it('lists capabilities with counts', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([
      { capability: 'auth', requirementCount: 3, scenarioCount: 5, lastUpdatedAt: Date.now() },
      { capability: 'billing', requirementCount: 1, scenarioCount: 2, lastUpdatedAt: Date.now() },
    ]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText('auth')).toBeInTheDocument());
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText(/3 requirements · 5 scenarios/)).toBeInTheDocument();
  });

  it('Re-scan button when corpus non-empty', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([
      { capability: 'auth', requirementCount: 1, scenarioCount: 1, lastUpdatedAt: 0 },
    ]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Re-scan/ })).toBeInTheDocument(),
    );
  });

  it('clicking Initialize Specs sets showInitializeSpecs=true', async () => {
    vi.spyOn(api, 'listCorpus').mockResolvedValue([]);
    render(<SpecCorpusScreen projectId="p1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Initialize Specs/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Initialize Specs/ }));
    expect(useOpenSpecStore.getState().viewByProject.p1.showInitializeSpecs).toBe(true);
  });
});
