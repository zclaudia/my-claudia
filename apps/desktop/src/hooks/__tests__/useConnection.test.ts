// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

// Undo the global mock from setup.ts so we test the real implementation
vi.unmock('@/contexts/ConnectionContext');

import { useConnection } from '../useConnection';
import { ConnectionContext } from '../../contexts/ConnectionContext';

describe('useConnection', () => {
  it('throws when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventWindowError = (event: Event) => event.preventDefault();
    window.addEventListener('error', preventWindowError);

    expect(() => {
      renderHook(() => useConnection(), {
        onCaughtError: () => {},
      });
    }).toThrow('useConnection must be used within ConnectionProvider');

    window.removeEventListener('error', preventWindowError);
    consoleSpy.mockRestore();
  });

  it('returns context value when inside provider', () => {
    const mockContext = {
      sendMessage: () => {},
      connectServer: () => {},
      embeddedServerStatus: 'ready' as const,
      embeddedServerError: null,
      embeddedServerPort: 3100,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ConnectionContext.Provider, { value: mockContext as any }, children);

    const { result } = renderHook(() => useConnection(), { wrapper });
    expect(result.current).toBe(mockContext);
  });
});
