import { create } from 'zustand';
import type { TurnSummary } from '@my-claudia/shared';
import {
  listTurnSummaries,
  generateTurnSummary,
} from '../services/api/turn-summaries';

type TurnKey = `${string}:${string}`;
const turnKey = (sessionId: string, userMessageId: string): TurnKey =>
  `${sessionId}:${userMessageId}`;

interface SummaryEntry {
  status: 'loading' | 'ready' | 'error';
  summary?: TurnSummary;
  error?: string;
}

interface SummaryState {
  entries: Record<TurnKey, SummaryEntry>;
  /** Sessions for which the cached list has been fetched already. */
  hydratedSessions: Set<string>;

  /** Read the current cached entry (if any) without subscribing. */
  getEntry: (sessionId: string, userMessageId: string) => SummaryEntry | undefined;

  /** Fetch all cached summaries for a session and populate entries. Idempotent. */
  hydrateSession: (sessionId: string) => Promise<void>;

  /** Trigger generation. While running, the entry is in 'loading' status. */
  generate: (sessionId: string, userMessageId: string, opts?: { force?: boolean; model?: string }) => Promise<void>;

  /** Clear all entries belonging to a session — used when the user deletes it. */
  clearSession: (sessionId: string) => void;
}

export const useSummaryStore = create<SummaryState>((set, get) => ({
  entries: {},
  hydratedSessions: new Set(),

  getEntry: (sessionId, userMessageId) => get().entries[turnKey(sessionId, userMessageId)],

  hydrateSession: async (sessionId) => {
    if (get().hydratedSessions.has(sessionId)) return;
    try {
      const summaries = await listTurnSummaries(sessionId);
      set((state) => {
        const nextEntries = { ...state.entries };
        for (const s of summaries) {
          nextEntries[turnKey(s.sessionId, s.userMessageId)] = { status: 'ready', summary: s };
        }
        const hydrated = new Set(state.hydratedSessions);
        hydrated.add(sessionId);
        return { entries: nextEntries, hydratedSessions: hydrated };
      });
    } catch (err) {
      // Hydration failure is non-fatal — generate-on-demand still works.
      console.warn(`[summaryStore] failed to hydrate session ${sessionId}:`, err);
    }
  },

  generate: async (sessionId, userMessageId, opts = {}) => {
    const key = turnKey(sessionId, userMessageId);
    set((state) => ({
      entries: { ...state.entries, [key]: { status: 'loading', summary: state.entries[key]?.summary } },
    }));
    try {
      const { summary } = await generateTurnSummary(sessionId, userMessageId, opts);
      set((state) => ({
        entries: { ...state.entries, [key]: { status: 'ready', summary } },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate summary';
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: { status: 'error', summary: state.entries[key]?.summary, error: message },
        },
      }));
    }
  },

  clearSession: (sessionId) => {
    set((state) => {
      const nextEntries: Record<TurnKey, SummaryEntry> = {};
      for (const [k, v] of Object.entries(state.entries) as [TurnKey, SummaryEntry][]) {
        if (!k.startsWith(`${sessionId}:`)) nextEntries[k] = v;
      }
      const hydrated = new Set(state.hydratedSessions);
      hydrated.delete(sessionId);
      return { entries: nextEntries, hydratedSessions: hydrated };
    });
  },
}));
