import { beforeEach, describe, expect, it } from 'vitest';
import { usePromptRequestStore, type PromptRoute } from '../promptRequestStore';

describe('promptRequestStore', () => {
  const createRoute = (overrides: Partial<PromptRoute> = {}): PromptRoute => ({
    requestId: 'req-1',
    sessionId: 'session-1',
    serverId: 'gw:backend-1',
    ...overrides,
  });

  beforeEach(() => {
    usePromptRequestStore.setState({ pendingRequests: [], pendingRequest: null });
  });

  it('stores routes keyed by request id', () => {
    const route = createRoute();
    usePromptRequestStore.getState().setPendingRequest(route);

    expect(usePromptRequestStore.getState().pendingRequest).toEqual(route);
    expect(usePromptRequestStore.getState().pendingRequests).toEqual([route]);
  });

  it('deduplicates repeated request ids', () => {
    const route = createRoute();
    usePromptRequestStore.getState().setPendingRequest(route);
    usePromptRequestStore.getState().setPendingRequest(route);

    expect(usePromptRequestStore.getState().pendingRequests).toHaveLength(1);
  });

  it('removes a route by id', () => {
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-1' }));
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-2' }));

    usePromptRequestStore.getState().clearRequestById('req-1');

    expect(usePromptRequestStore.getState().pendingRequest?.requestId).toBe('req-2');
    expect(usePromptRequestStore.getState().pendingRequests.map((item) => item.requestId)).toEqual(['req-2']);
  });

  it('clears stale routes for a server', () => {
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-1', serverId: 'gw:backend-1' }));
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-2', serverId: 'gw:backend-2' }));

    usePromptRequestStore.getState().clearStaleRequests('gw:backend-1', new Set<string>());

    expect(usePromptRequestStore.getState().pendingRequests).toEqual([
      expect.objectContaining({ requestId: 'req-2', serverId: 'gw:backend-2' }),
    ]);
  });

  it('clears routes by session', () => {
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-1', sessionId: 'session-1' }));
    usePromptRequestStore.getState().setPendingRequest(createRoute({ requestId: 'req-2', sessionId: 'session-2' }));

    usePromptRequestStore.getState().clearRequestsForSession('session-1');

    expect(usePromptRequestStore.getState().pendingRequests.map((item) => item.requestId)).toEqual(['req-2']);
  });
});
