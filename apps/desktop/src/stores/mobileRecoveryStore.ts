import { create } from 'zustand';

export type MobileRecoveryPhase = 'idle' | 'recovering' | 'ready' | 'error' | 'background';
export type MobileRecoveryStep = 'transport' | 'backend' | 'session' | null;
export type MobileRecoveryJobStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type MobileRecoveryReason = 'resume' | 'network' | 'manual_retry' | 'backend_reconnect';

export interface MobileRecoveryJobState {
  jobId: number | null;
  status: MobileRecoveryJobStatus;
  reason: MobileRecoveryReason | null;
  startedAt: number | null;
  finishedAt: number | null;
}

interface MobileRecoveryState {
  phase: MobileRecoveryPhase;
  step: MobileRecoveryStep;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  currentJob: MobileRecoveryJobState;
  lastError: string | null;

  setSelection: (activeBackendId: string | null, selectedSessionId: string | null) => void;
  startJob: (jobId: number, reason: MobileRecoveryReason) => void;
  setStep: (step: MobileRecoveryStep) => void;
  completeJob: (jobId: number) => void;
  failJob: (jobId: number, error: string) => void;
  cancelJob: (jobId: number, reason?: 'background' | 'selection_change' | 'manual') => void;
  reset: () => void;
}

function initialJob(): MobileRecoveryJobState {
  return {
    jobId: null,
    status: 'idle',
    reason: null,
    startedAt: null,
    finishedAt: null,
  };
}

export const useMobileRecoveryStore = create<MobileRecoveryState>()((set) => ({
  phase: 'idle',
  step: null,
  activeBackendId: null,
  selectedSessionId: null,
  currentJob: initialJob(),
  lastError: null,

  setSelection: (activeBackendId, selectedSessionId) => set((state) => {
    if (
      state.activeBackendId === activeBackendId
      && state.selectedSessionId === selectedSessionId
    ) {
      return state;
    }
    return { activeBackendId, selectedSessionId };
  }),

  startJob: (jobId, reason) => set({
    phase: 'recovering',
    step: 'transport',
    lastError: null,
    currentJob: {
      jobId,
      status: 'running',
      reason,
      startedAt: Date.now(),
      finishedAt: null,
    },
  }),

  setStep: (step) => set((state) => {
    if (state.step === step) return state;
    return { step };
  }),

  completeJob: (jobId) => set((state) => {
    if (state.currentJob.jobId !== jobId) return state;
    return {
      phase: 'ready',
      step: null,
      currentJob: {
        ...state.currentJob,
        status: 'succeeded',
        finishedAt: Date.now(),
      },
    };
  }),

  failJob: (jobId, error) => set((state) => {
    if (state.currentJob.jobId !== jobId) return state;
    return {
      phase: 'error',
      step: null,
      lastError: error,
      currentJob: {
        ...state.currentJob,
        status: 'failed',
        finishedAt: Date.now(),
      },
    };
  }),

  cancelJob: (jobId, reason) => set((state) => {
    if (state.currentJob.jobId !== jobId) return state;
    return {
      phase: reason === 'background' ? 'background' : 'idle',
      step: null,
      currentJob: {
        ...state.currentJob,
        status: 'cancelled',
        finishedAt: Date.now(),
      },
    };
  }),

  reset: () => set({
    phase: 'idle',
    step: null,
    currentJob: initialJob(),
    lastError: null,
  }),
}));
