// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { activatePanel, deactivatePanel, usePanelIsActive } from '../openPanel';
import { usePluginStore } from '../../stores/pluginStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';

function registerPanel(id: string, defaultPlacement?: 'bottom' | 'right', visible = true) {
  usePluginStore.getState().registerPanel({
    id,
    pluginId: `com.test.${id}`,
    type: 'panel',
    label: id,
    defaultPlacement,
    visible,
    order: 0,
  });
}

describe('openPanel utility', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useBottomPanelStore.setState({ activeTab: '' });
    useRightSidebarStore.setState({ activeTab: null, widthPx: 380 });
  });

  describe('activatePanel', () => {
    it('routes bottom-placed panels to bottomPanelStore', () => {
      registerPanel('foo', 'bottom');
      activatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('foo');
      expect(useRightSidebarStore.getState().activeTab).toBeNull();
    });

    it('routes right-placed panels to rightSidebarStore', () => {
      registerPanel('foo', 'right');
      activatePanel('foo');
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('uses user override over defaultPlacement', () => {
      registerPanel('foo', 'bottom');
      usePluginStore.setState({ panelPlacements: { foo: 'right' } });
      activatePanel('foo');
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
    });

    it('defaults to bottom when no defaultPlacement is set', () => {
      registerPanel('foo');
      activatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('foo');
    });
  });

  describe('deactivatePanel', () => {
    it('clears bottomPanelStore activeTab when matching', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'foo' });
      deactivatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('does not clear bottomPanelStore activeTab when different', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'bar' });
      deactivatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('bar');
    });

    it('preserves rightSidebar activeTab even when deactivating', () => {
      registerPanel('foo', 'right');
      useRightSidebarStore.setState({ activeTab: 'foo' });
      deactivatePanel('foo');
      // rightSidebar collapses naturally via panel visibility, activeTab preserved
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
    });
  });

  describe('usePanelIsActive', () => {
    it('returns false when panel is not registered', () => {
      const { result } = renderHook(() => usePanelIsActive('missing'));
      expect(result.current).toBe(false);
    });

    it('returns true when bottom-placed panel is visible AND active tab', () => {
      registerPanel('foo', 'bottom', true);
      useBottomPanelStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(true);
    });

    it('returns false when bottom panel is visible but not active tab', () => {
      registerPanel('foo', 'bottom', true);
      useBottomPanelStore.setState({ activeTab: 'bar' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });

    it('returns false when bottom panel is active but not visible', () => {
      registerPanel('foo', 'bottom', false);
      useBottomPanelStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });

    it('returns true when right-placed panel is visible AND active in sidebar', () => {
      registerPanel('foo', 'right', true);
      useRightSidebarStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(true);
    });

    it('returns false when right panel is hidden', () => {
      registerPanel('foo', 'right', false);
      useRightSidebarStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });
  });
});
