import { beforeEach, describe, expect, it } from 'vitest';
import { useChangesPanelStore } from '../changesPanelStore';

describe('changesPanelStore', () => {
  beforeEach(() => {
    useChangesPanelStore.setState({ pickedSinceBySession: {} });
  });

  it('starts with no picks', () => {
    expect(useChangesPanelStore.getState().pickedSinceBySession).toEqual({});
  });

  it('records a since pick per session', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-3');
    expect(useChangesPanelStore.getState().pickedSinceBySession).toEqual({
      'sess-1': 'msg-3',
    });
  });

  it('stores null explicitly for "Entire session"', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', null);
    const state = useChangesPanelStore.getState().pickedSinceBySession;
    expect('sess-1' in state).toBe(true);
    expect(state['sess-1']).toBeNull();
  });

  it('does not affect other sessions', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-a');
    useChangesPanelStore.getState().setPickedSince('sess-2', 'msg-b');
    expect(useChangesPanelStore.getState().pickedSinceBySession).toEqual({
      'sess-1': 'msg-a',
      'sess-2': 'msg-b',
    });
  });

  it('overwrites previous pick for same session', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-a');
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-b');
    expect(useChangesPanelStore.getState().pickedSinceBySession['sess-1']).toBe('msg-b');
  });

  it('clearPickedSince removes the entry (lets consumer fall back to latest)', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-a');
    useChangesPanelStore.getState().clearPickedSince('sess-1');
    expect('sess-1' in useChangesPanelStore.getState().pickedSinceBySession).toBe(false);
  });

  it('clearPickedSince on missing session is a no-op', () => {
    const before = useChangesPanelStore.getState().pickedSinceBySession;
    useChangesPanelStore.getState().clearPickedSince('never-existed');
    expect(useChangesPanelStore.getState().pickedSinceBySession).toBe(before);
  });

  it('setPickedSince with same value is a no-op (preserves object identity)', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-a');
    const before = useChangesPanelStore.getState().pickedSinceBySession;
    useChangesPanelStore.getState().setPickedSince('sess-1', 'msg-a');
    expect(useChangesPanelStore.getState().pickedSinceBySession).toBe(before);
  });

  it('setPickedSince null then null again is a no-op', () => {
    useChangesPanelStore.getState().setPickedSince('sess-1', null);
    const before = useChangesPanelStore.getState().pickedSinceBySession;
    useChangesPanelStore.getState().setPickedSince('sess-1', null);
    expect(useChangesPanelStore.getState().pickedSinceBySession).toBe(before);
  });
});
