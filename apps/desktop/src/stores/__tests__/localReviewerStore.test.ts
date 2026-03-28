import { beforeEach, describe, expect, it } from 'vitest';
import { useLocalReviewerStore } from '../localReviewerStore';

describe('localReviewerStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useLocalReviewerStore.setState({
      enabled: false,
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen3:4b-instruct',
      managedRuntime: true,
      autoStart: true,
      managedPid: null,
      status: {
        state: 'disabled',
        endpoint: 'http://127.0.0.1:11434',
        model: 'qwen3:4b-instruct',
        binaryAvailable: false,
        serverReachable: false,
        modelAvailable: false,
        managedRuntimeActive: false,
      },
    });
  });

  it('starts disabled by default', () => {
    const state = useLocalReviewerStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.status.state).toBe('disabled');
    expect(state.endpoint).toBe('http://127.0.0.1:11434');
    expect(state.model).toBe('qwen3:4b-instruct');
  });

  it('updates config and mirrors endpoint/model into status', () => {
    useLocalReviewerStore.getState().setConfig({
      enabled: true,
      endpoint: 'http://127.0.0.1:22434',
      model: 'gemma-3:4b',
    });

    const state = useLocalReviewerStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.endpoint).toBe('http://127.0.0.1:22434');
    expect(state.model).toBe('gemma-3:4b');
    expect(state.status.endpoint).toBe('http://127.0.0.1:22434');
    expect(state.status.model).toBe('gemma-3:4b');
  });

  it('setStatus only changes runtime fields', () => {
    useLocalReviewerStore.getState().setStatus({
      state: 'ready',
      binaryAvailable: true,
      serverReachable: true,
      modelAvailable: true,
      managedRuntimeActive: true,
    });

    const state = useLocalReviewerStore.getState();
    expect(state.status.state).toBe('ready');
    expect(state.status.binaryAvailable).toBe(true);
    expect(state.status.managedRuntimeActive).toBe(true);
    expect(state.enabled).toBe(false);
  });

  it('disabling clears runtime pid and marks status disabled', () => {
    useLocalReviewerStore.setState({
      enabled: true,
      managedPid: 1234,
      status: {
        state: 'ready',
        endpoint: 'http://127.0.0.1:11434',
        model: 'qwen3:4b-instruct',
        binaryAvailable: true,
        serverReachable: true,
        modelAvailable: true,
        managedRuntimeActive: true,
      },
    });

    useLocalReviewerStore.getState().setConfig({ enabled: false });

    const state = useLocalReviewerStore.getState();
    expect(state.managedPid).toBeNull();
    expect(state.status.state).toBe('disabled');
    expect(state.status.serverReachable).toBe(false);
    expect(state.status.managedRuntimeActive).toBe(false);
  });
});
