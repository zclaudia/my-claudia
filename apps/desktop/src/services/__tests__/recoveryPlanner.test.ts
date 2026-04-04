import { describe, expect, it } from 'vitest';
import { planRecoveryStep, type RecoveryPlanContext } from '../recoveryPlanner';

function createContext(overrides: Partial<RecoveryPlanContext> = {}): RecoveryPlanContext {
  return {
    coordinator: 'recovering',
    transportStatus: 'connected',
    activeBackendId: 'b1',
    selectedSessionId: null,
    backendId: 'b1',
    backendSnapshot: {
      backendId: 'b1',
      online: true,
      runtimeState: 'ready',
      openState: 'open',
      name: 'B1',
    } as any,
    backendState: {
      backendId: 'b1',
      status: 'ready',
      subscribed: true,
      dataReady: true,
      retryCount: 0,
      lastError: null,
      lastCloseReason: null,
      statusEnteredAt: Date.now(),
    },
    dataSyncState: {
      backendId: 'b1',
      status: 'ready',
      ownershipVersion: 3,
      retryCount: 0,
      lastError: null,
      lastSyncAt: Date.now(),
      statusEnteredAt: Date.now(),
    },
    ownerBackendId: null,
    ownerBackendSnapshot: null,
    ownerBackendState: null,
    ownerDataSyncState: null,
    ownershipVersion: null,
    streamState: null,
    ...overrides,
  };
}

describe('recoveryPlanner', () => {
  it('returns a transport-timeout effect while transport is reconnecting', () => {
    const plan = planRecoveryStep(createContext({ transportStatus: 'reconnecting' }));

    expect(plan.state).toBe('await_transport');
    expect(plan.effect).toEqual({
      type: 'ensure_transport_timeout',
      transportStatus: 'reconnecting',
    });
  });

  it('returns an owner-backend open effect when the selected session lives on another backend', () => {
    const plan = planRecoveryStep(createContext({
      selectedSessionId: 's1',
      ownerBackendId: 'b2',
      ownerBackendSnapshot: {
        backendId: 'b2',
        online: true,
        runtimeState: 'visible',
        openState: 'closed',
        name: 'B2',
      } as any,
      ownerBackendState: {
        backendId: 'b2',
        status: 'visible',
        subscribed: false,
        dataReady: false,
        retryCount: 0,
        lastError: null,
        lastCloseReason: null,
        statusEnteredAt: Date.now(),
      } as any,
    }));

    expect(plan.state).toBe('open_backend');
    expect(plan.effect).toEqual({
      type: 'open_backend',
      backendId: 'b2',
      sessionId: 's1',
    });
  });

  it('returns a data-sync effect that keeps the active session waiting for owner data', () => {
    const plan = planRecoveryStep(createContext({
      selectedSessionId: 's1',
      ownerBackendId: 'b2',
      ownerBackendSnapshot: {
        backendId: 'b2',
        online: true,
        runtimeState: 'ready',
        openState: 'open',
        name: 'B2',
      } as any,
      ownerBackendState: {
        backendId: 'b2',
        status: 'ready',
        subscribed: true,
        dataReady: false,
        retryCount: 0,
        lastError: null,
        lastCloseReason: null,
        statusEnteredAt: Date.now(),
      } as any,
      ownerDataSyncState: {
        backendId: 'b2',
        status: 'stale',
        ownershipVersion: 0,
        retryCount: 0,
        lastError: null,
        lastSyncAt: null,
        statusEnteredAt: Date.now(),
      } as any,
    }));

    expect(plan.state).toBe('sync_data');
    expect(plan.effect).toEqual({
      type: 'sync_data',
      backendId: 'b2',
      sessionId: 's1',
    });
  });

  it('returns a session-tail recovery effect once stream is open and owner is verified', () => {
    const plan = planRecoveryStep(createContext({
      selectedSessionId: 's1',
      ownerBackendId: 'b1',
      ownerBackendSnapshot: {
        backendId: 'b1',
        online: true,
        runtimeState: 'ready',
        openState: 'open',
        name: 'B1',
      } as any,
      ownerBackendState: {
        backendId: 'b1',
        status: 'ready',
        subscribed: true,
        dataReady: true,
        retryCount: 0,
        lastError: null,
        lastCloseReason: null,
        statusEnteredAt: Date.now(),
      } as any,
      ownerDataSyncState: {
        backendId: 'b1',
        status: 'ready',
        ownershipVersion: 5,
        retryCount: 0,
        lastError: null,
        lastSyncAt: Date.now(),
        statusEnteredAt: Date.now(),
      } as any,
      ownershipVersion: 5,
      streamState: 'open',
    }));

    expect(plan.state).toBe('recover_session_tail');
    expect(plan.effect).toEqual({
      type: 'recover_session_tail',
      backendId: 'b1',
      sessionId: 's1',
    });
  });
});
