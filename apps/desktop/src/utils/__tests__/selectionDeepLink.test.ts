import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  clearSelectionDeepLinkFromCurrentUrl,
  consumeSelectionDeepLinkFromWindow,
  parseSelectionDeepLink,
  parseSelectionDeepLinkUrl,
} from '../selectionDeepLink';

describe('selectionDeepLink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).__MY_CLAUDIA_PENDING_SELECTION_TARGET__;
    delete (window as any).AndroidNotifications;
  });

  it('parses backend, project, and session ids from search params', () => {
    expect(parseSelectionDeepLink('?backendId=b1&projectId=p1&sessionId=s1')).toEqual({
      backendId: 'b1',
      projectId: 'p1',
      sessionId: 's1',
    });
  });

  it('removes only selection params from the current url', () => {
    // Skip in non-browser environments (node test runner without jsdom)
    if (typeof window === 'undefined' || !window.history?.replaceState) {
      return;
    }
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const original = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.pushState({}, '', '/?backendId=b1&sessionId=s1&foo=bar#hash');

    clearSelectionDeepLinkFromCurrentUrl();

    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/?foo=bar#hash');
    window.history.pushState({}, '', original || '/');
  });

  it('parses selection target from a full click url', () => {
    expect(parseSelectionDeepLinkUrl('myclaudia://open?backendId=b1&projectId=p1&sessionId=s1')).toEqual({
      backendId: 'b1',
      projectId: 'p1',
      sessionId: 's1',
    });
  });

  it('consumes pending native selection target from window global first', () => {
    (window as any).__MY_CLAUDIA_PENDING_SELECTION_TARGET__ = 'myclaudia://open?backendId=b1&sessionId=s1';
    (window as any).AndroidNotifications = {
      consumeSelectionTarget: vi.fn(() => 'myclaudia://open?backendId=ignored&sessionId=ignored'),
    };

    expect(consumeSelectionDeepLinkFromWindow()).toEqual({
      backendId: 'b1',
      projectId: null,
      sessionId: 's1',
    });
    expect((window as any).__MY_CLAUDIA_PENDING_SELECTION_TARGET__).toBeUndefined();
    expect((window as any).AndroidNotifications.consumeSelectionTarget).not.toHaveBeenCalled();
  });

  it('consumes pending native selection target from Android bridge when global is empty', () => {
    (window as any).AndroidNotifications = {
      consumeSelectionTarget: vi.fn(() => 'myclaudia://open?backendId=b2&projectId=p2'),
    };

    expect(consumeSelectionDeepLinkFromWindow()).toEqual({
      backendId: 'b2',
      projectId: 'p2',
      sessionId: null,
    });
    expect((window as any).AndroidNotifications.consumeSelectionTarget).toHaveBeenCalledTimes(1);
  });
});
