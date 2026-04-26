// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useMobileViewport } from '../useMobileViewport';

function HookHarness({ isMobile = true }: { isMobile?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useMobileViewport(ref, isMobile);
  return <div ref={ref} data-testid="chat-root" />;
}

function createVisualViewport({
  height,
  width = 390,
  offsetTop = 0,
  offsetLeft = 0,
}: {
  height: number;
  width?: number;
  offsetTop?: number;
  offsetLeft?: number;
}) {
  return {
    height,
    width,
    offsetTop,
    offsetLeft,
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

  it('leaves layout alone when the native viewport already resized', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = createVisualViewport({ height: 760 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

    const { getByTestId } = render(<HookHarness />);
    const root = getByTestId('chat-root') as HTMLDivElement;

    expect(root.style.position).toBe('');
    expect(root.style.height).toBe('');
    expect(viewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(viewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('pins chat root to visual viewport when the keyboard overlays the webview', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = createVisualViewport({ height: 500, width: 390 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

    const { getByTestId } = render(<HookHarness />);
    const root = getByTestId('chat-root') as HTMLDivElement;

    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('0px');
    expect(root.style.left).toBe('0px');
    expect(root.style.right).toBe('0px');
    expect(root.style.width).toBe('390px');
    expect(root.style.height).toBe('500px');
    expect(viewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(viewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('updates pinning when visual viewport resize fires', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = createVisualViewport({ height: 790, width: 390 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

    const { getByTestId } = render(<HookHarness />);
    const root = getByTestId('chat-root') as HTMLDivElement;
    const resizeHandler = vi.mocked(viewport.addEventListener).mock.calls.find(([event]) => event === 'resize')?.[1] as () => void;

    expect(root.style.position).toBe('');

    viewport.height = 480;
    resizeHandler();

    expect(root.style.position).toBe('fixed');
    expect(root.style.height).toBe('480px');
  });
});
