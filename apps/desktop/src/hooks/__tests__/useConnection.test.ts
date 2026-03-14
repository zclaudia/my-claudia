import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useConnection } from '../useConnection';
import { ConnectionContext } from '../../contexts/ConnectionContext';

describe('useConnection', () => {
  it('throws when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useConnection());
    }).toThrow('useConnection must be used within ConnectionProvider');

    consoleSpy.mockRestore();
  });

  it('returns context value when inside provider', () => {
    const mockContext = {
      send: () => {},
      connectionStatus: 'connected' as const,
      serverVersion: '1.0.0',
    };

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ConnectionContext.Provider, { value: mockContext as any }, children);

    const { result } = renderHook(() => useConnection(), { wrapper });
    expect(result.current).toBe(mockContext);
  });
});
