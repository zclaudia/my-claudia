import { describe, it, expect, beforeEach } from 'vitest';
import { useUpdateStore } from '../updateStore';

describe('updateStore', () => {
  beforeEach(() => {
    useUpdateStore.getState().reset();
  });

  it('starts with idle status', () => {
    const state = useUpdateStore.getState();
    expect(state.status).toBe('idle');
    expect(state.currentVersion).toBe('');
    expect(state.availableVersion).toBeNull();
    expect(state.releaseNotes).toBeNull();
    expect(state.downloadProgress).toBe(0);
    expect(state.error).toBeNull();
    expect(state.dismissed).toBe(false);
    expect(state.manual).toBe(false);
    expect(state.androidApkUrl).toBeNull();
  });

  it('setStatus updates status and clears error', () => {
    useUpdateStore.getState().setError('something broke');
    expect(useUpdateStore.getState().error).toBe('something broke');

    useUpdateStore.getState().setStatus('checking');
    expect(useUpdateStore.getState().status).toBe('checking');
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it('setAvailableUpdate sets version, notes, and downloading status', () => {
    useUpdateStore.getState().setAvailableUpdate('2.0.0', 'Bug fixes');
    const state = useUpdateStore.getState();
    expect(state.availableVersion).toBe('2.0.0');
    expect(state.releaseNotes).toBe('Bug fixes');
    expect(state.status).toBe('downloading');
  });

  it('setAvailableUpdate with null notes', () => {
    useUpdateStore.getState().setAvailableUpdate('2.0.0', null);
    expect(useUpdateStore.getState().releaseNotes).toBeNull();
  });

  it('setDownloadProgress updates progress', () => {
    useUpdateStore.getState().setDownloadProgress(50);
    expect(useUpdateStore.getState().downloadProgress).toBe(50);

    useUpdateStore.getState().setDownloadProgress(100);
    expect(useUpdateStore.getState().downloadProgress).toBe(100);
  });

  it('setError sets error status and message', () => {
    useUpdateStore.getState().setError('Network error');
    const state = useUpdateStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Network error');
  });

  it('dismiss sets dismissed flag', () => {
    useUpdateStore.getState().dismiss();
    expect(useUpdateStore.getState().dismissed).toBe(true);
  });

  it('reset restores all defaults', () => {
    // Set various state
    useUpdateStore.getState().setAvailableUpdate('2.0.0', 'Notes');
    useUpdateStore.getState().setDownloadProgress(75);
    useUpdateStore.getState().dismiss();

    // Reset
    useUpdateStore.getState().reset();
    const state = useUpdateStore.getState();
    expect(state.status).toBe('idle');
    expect(state.availableVersion).toBeNull();
    expect(state.releaseNotes).toBeNull();
    expect(state.downloadProgress).toBe(0);
    expect(state.error).toBeNull();
    expect(state.dismissed).toBe(false);
    expect(state.manual).toBe(false);
    expect(state.androidApkUrl).toBeNull();
  });
});
