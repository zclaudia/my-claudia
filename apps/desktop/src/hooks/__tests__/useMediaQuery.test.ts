import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsMobile, useIsTablet, useIsDesktop } from '../useMediaQuery.js';

describe('hooks/useMediaQuery', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let listeners: Map<string, Set<(e: MediaQueryListEvent) => void>>;

  beforeEach(() => {
    listeners = new Map();

    matchMediaMock = vi.fn((query: string) => {
      const mediaQueryList = {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_event: string, callback: (e: MediaQueryListEvent) => void) => {
          if (!listeners.has(query)) {
            listeners.set(query, new Set());
          }
          listeners.get(query)!.add(callback);
        }),
        removeEventListener: vi.fn((_event: string, callback: (e: MediaQueryListEvent) => void) => {
          listeners.get(query)?.delete(callback);
        }),
        dispatchEvent: vi.fn(),
      };
      return mediaQueryList;
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to simulate media query change
  const simulateMediaChange = (query: string, matches: boolean) => {
    const queryListeners = listeners.get(query);
    if (queryListeners) {
      const event = { matches, media: query } as MediaQueryListEvent;
      queryListeners.forEach((callback) => callback(event));
    }
  };

  describe('useMediaQuery', () => {
    it('returns initial match state', () => {
      // Need to mockReturnValue for ALL calls (useState initializer + useEffect)
      matchMediaMock.mockReturnValue({
        matches: true,
        media: '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      });

      const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));

      expect(result.current).toBe(true);
    });

    it('returns false when query does not match', () => {
      const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));

      expect(result.current).toBe(false);
    });

    it('updates when media query changes', () => {
      const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));

      expect(result.current).toBe(false);

      act(() => {
        simulateMediaChange('(max-width: 767px)', true);
      });

      expect(result.current).toBe(true);
    });

    it('adds event listener on mount', () => {
      renderHook(() => useMediaQuery('(max-width: 767px)'));

      expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 767px)');
    });

    it('removes event listener on unmount', () => {
      const { unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));

      // The hook calls matchMedia twice: once in useState, once in useEffect
      // The event listener is added to the second call's result (in useEffect)
      const mql = matchMediaMock.mock.results[1].value;
      expect(mql.addEventListener).toHaveBeenCalled();

      // Unmount and verify removeEventListener was called
      unmount();
      expect(mql.removeEventListener).toHaveBeenCalled();
    });

    it('re-subscribes when query changes', () => {
      const { rerender } = renderHook(
        ({ query }) => useMediaQuery(query),
        { initialProps: { query: '(max-width: 767px)' } }
      );

      expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 767px)');

      rerender({ query: '(min-width: 1024px)' });

      expect(matchMediaMock).toHaveBeenCalledWith('(min-width: 1024px)');
    });
  });

  describe('useIsMobile', () => {
    it('uses correct mobile query', () => {
      renderHook(() => useIsMobile());

      expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 767px)');
    });

    it('returns true when mobile query matches', () => {
      // Need mockReturnValue (not Once) since hook calls matchMedia twice
      matchMediaMock.mockReturnValue({
        matches: true,
        media: '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      });

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(true);
    });
  });

  describe('useIsTablet', () => {
    it('uses correct tablet query', () => {
      renderHook(() => useIsTablet());

      expect(matchMediaMock).toHaveBeenCalledWith('(min-width: 768px) and (max-width: 1023px)');
    });

    it('returns true when tablet query matches', () => {
      // Need mockReturnValue (not Once) since hook calls matchMedia twice
      matchMediaMock.mockReturnValue({
        matches: true,
        media: '(min-width: 768px) and (max-width: 1023px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      });

      const { result } = renderHook(() => useIsTablet());

      expect(result.current).toBe(true);
    });
  });

  describe('useIsDesktop', () => {
    it('uses correct desktop query', () => {
      renderHook(() => useIsDesktop());

      expect(matchMediaMock).toHaveBeenCalledWith('(min-width: 1024px)');
    });

    it('returns true when desktop query matches', () => {
      // Need mockReturnValue (not Once) since hook calls matchMedia twice
      matchMediaMock.mockReturnValue({
        matches: true,
        media: '(min-width: 1024px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      });

      const { result } = renderHook(() => useIsDesktop());

      expect(result.current).toBe(true);
    });
  });
});
