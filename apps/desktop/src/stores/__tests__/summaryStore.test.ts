import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSummaryStore } from '../summaryStore';

vi.mock('../../services/api/turn-summaries', () => ({
  listTurnSummaries: vi.fn(),
  generateTurnSummary: vi.fn(),
}));

import * as api from '../../services/api/turn-summaries';

const mockedListTurnSummaries = vi.mocked(api.listTurnSummaries);
const mockedGenerateTurnSummary = vi.mocked(api.generateTurnSummary);

const sampleSummary = {
  sessionId: 'sess-1',
  userMessageId: 'u1',
  asOfMessageId: 'a3',
  goal: 'Add panel',
  solved: 'Added 5 files',
  openIssues: '—',
  model: 'claude-haiku',
  generatedAt: 1700000000000,
};

describe('summaryStore', () => {
  beforeEach(() => {
    useSummaryStore.setState({ entries: {}, hydratedSessions: new Set() });
    mockedListTurnSummaries.mockReset();
    mockedGenerateTurnSummary.mockReset();
  });

  it('starts empty', () => {
    expect(useSummaryStore.getState().entries).toEqual({});
    expect(useSummaryStore.getState().getEntry('sess-1', 'u1')).toBeUndefined();
  });

  it('hydrateSession loads cached summaries into entries', async () => {
    mockedListTurnSummaries.mockResolvedValueOnce([sampleSummary]);
    await useSummaryStore.getState().hydrateSession('sess-1');
    expect(useSummaryStore.getState().getEntry('sess-1', 'u1')).toEqual({
      status: 'ready',
      summary: sampleSummary,
    });
  });

  it('hydrateSession is idempotent — second call skips the API', async () => {
    mockedListTurnSummaries.mockResolvedValueOnce([]);
    await useSummaryStore.getState().hydrateSession('sess-1');
    await useSummaryStore.getState().hydrateSession('sess-1');
    expect(mockedListTurnSummaries).toHaveBeenCalledTimes(1);
  });

  it('hydrateSession failure does not throw and leaves entries empty', async () => {
    mockedListTurnSummaries.mockRejectedValueOnce(new Error('network'));
    await expect(useSummaryStore.getState().hydrateSession('sess-1')).resolves.toBeUndefined();
    expect(useSummaryStore.getState().entries).toEqual({});
  });

  it('generate transitions loading → ready and stores the summary', async () => {
    let resolveGen: (v: { summary: typeof sampleSummary; fromCache: boolean }) => void = () => {};
    mockedGenerateTurnSummary.mockReturnValueOnce(
      new Promise((res) => { resolveGen = res; }),
    );
    const promise = useSummaryStore.getState().generate('sess-1', 'u1');
    expect(useSummaryStore.getState().getEntry('sess-1', 'u1')?.status).toBe('loading');
    resolveGen({ summary: sampleSummary, fromCache: false });
    await promise;
    expect(useSummaryStore.getState().getEntry('sess-1', 'u1')).toEqual({
      status: 'ready',
      summary: sampleSummary,
    });
  });

  it('generate failure stores error state and preserves any prior summary', async () => {
    useSummaryStore.setState({
      entries: { 'sess-1:u1': { status: 'ready', summary: sampleSummary } },
      hydratedSessions: new Set(),
    });
    mockedGenerateTurnSummary.mockRejectedValueOnce(new Error('boom'));
    await useSummaryStore.getState().generate('sess-1', 'u1');
    const entry = useSummaryStore.getState().getEntry('sess-1', 'u1');
    expect(entry?.status).toBe('error');
    expect(entry?.error).toBe('boom');
    // previous summary is retained so the UI can keep showing it grayed-out
    expect(entry?.summary).toEqual(sampleSummary);
  });

  it('clearSession drops entries and hydration mark for that session only', async () => {
    mockedListTurnSummaries.mockResolvedValueOnce([sampleSummary]);
    await useSummaryStore.getState().hydrateSession('sess-1');
    useSummaryStore.setState((s) => ({
      entries: { ...s.entries, 'sess-2:u9': { status: 'ready', summary: { ...sampleSummary, sessionId: 'sess-2', userMessageId: 'u9' } } },
    }));
    useSummaryStore.getState().clearSession('sess-1');
    expect(useSummaryStore.getState().getEntry('sess-1', 'u1')).toBeUndefined();
    expect(useSummaryStore.getState().getEntry('sess-2', 'u9')).toBeDefined();
    expect(useSummaryStore.getState().hydratedSessions.has('sess-1')).toBe(false);
  });
});
