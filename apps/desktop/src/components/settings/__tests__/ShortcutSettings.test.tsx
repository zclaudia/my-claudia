import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortcutSettings } from '../ShortcutSettings';
import { useShortcutStore } from '../../../stores/shortcutStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

describe('ShortcutSettings', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...globalThis.navigator,
        platform: 'MacIntel',
      },
      configurable: true,
    });

    useShortcutStore.setState({
      shortcut: 'CmdOrCtrl+Shift+.',
      enabled: true,
      isLoading: false,
      error: null,
    });
  });

  it('shows a disabled hint and locks controls when Claudia is disabled', () => {
    const { container } = render(<ShortcutSettings disabled />);

    expect(screen.getByText('Claudia 关闭时，桌面悬浮球和全局快捷键都会一起停用。')).toBeTruthy();

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('keeps shortcut controls interactive when Claudia is enabled', () => {
    const { container } = render(<ShortcutSettings disabled={false} />);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button).not.toBeDisabled();
    });
    expect(screen.queryByText('Claudia 关闭时，桌面悬浮球和全局快捷键都会一起停用。')).toBeNull();

    fireEvent.click(screen.getByText('⌘ ⇧ .'));
    expect(container.querySelectorAll('button').length).toBeGreaterThan(2);
  });
});
