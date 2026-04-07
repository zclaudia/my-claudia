// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useMobileViewport } from '../useMobileViewport';
import { isAndroid } from '../../../utils/platform';

vi.mock('../../../utils/platform', () => ({
  isAndroid: vi.fn(() => false),
}));

function HookHarness({ isMobile = true }: { isMobile?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useMobileViewport(ref, isMobile);
  return <div ref={ref} data-testid="chat-root" />;
}

function createVisualViewport(height: number) {
  return {
    height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe('useMobileViewport', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as Window & { visualViewport?: VisualViewport }).visualViewport;
  });

  it('skips manual viewport pinning on Android', () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = createVisualViewport(500);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

    const { getByTestId } = render(<HookHarness />);
    const root = getByTestId('chat-root') as HTMLDivElement;

    expect(root.style.position).toBe('');
    expect(root.style.height).toBe('');
    expect(viewport.addEventListener).not.toHaveBeenCalled();
  });

  it('pins chat root to visual viewport on non-Android mobile', () => {
    vi.mocked(isAndroid).mockReturnValue(false);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = createVisualViewport(500);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

    const { getByTestId } = render(<HookHarness />);
    const root = getByTestId('chat-root') as HTMLDivElement;

    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('0px');
    expect(root.style.left).toBe('0px');
    expect(root.style.right).toBe('0px');
    expect(root.style.height).toBe('500px');
    expect(viewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(viewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
