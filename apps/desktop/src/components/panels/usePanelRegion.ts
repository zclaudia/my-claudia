import {
  selectPluginPanels,
  usePluginStore,
  type UIExtension,
} from '../../stores/pluginStore';

type PanelRegion = 'bottom' | 'right';

interface UsePanelRegionOptions {
  region: PanelRegion;
  activeTab: string | null;
  isMobile: boolean;
  fallbackToActiveTabWhenEmpty?: boolean;
}

interface PanelRegionState {
  visiblePanels: UIExtension[];
  mountedPanels: UIExtension[];
  isOpen: boolean;
  hasAlwaysMount: boolean;
  effectiveTab: string | null;
  activePanel: UIExtension | undefined;
  showTabs: boolean;
}

export function usePanelRegion({
  region,
  activeTab,
  isMobile,
  fallbackToActiveTabWhenEmpty = false,
}: UsePanelRegionOptions): PanelRegionState {
  const allPanels = usePluginStore(selectPluginPanels);
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const panelPlacements = usePluginStore((s) => s.panelPlacements);
  const platform = isMobile ? 'mobile' : 'desktop';

  const regionPanels = allPanels.filter((panel) => {
    if (!(panel.platforms ?? ['desktop']).includes(platform)) return false;
    if (disabledBuiltinPanels.includes(panel.id)) return false;

    // Mobile renders panels through BottomPanel overlay regardless of desktop placement.
    if (isMobile) return region === 'bottom';

    const placement = panelPlacements[panel.id] ?? panel.defaultPlacement ?? 'bottom';
    return region === 'right' ? placement === 'right' : placement !== 'right';
  });

  const visiblePanels = regionPanels.filter((panel) => panel.visible !== false);
  const mountedPanels = regionPanels.filter((panel) => panel.alwaysMount || panel.visible !== false);
  const isOpen = visiblePanels.length > 0;
  const hasAlwaysMount = mountedPanels.some((panel) => panel.alwaysMount);

  const effectiveTab = (() => {
    if (activeTab && visiblePanels.some((panel) => panel.id === activeTab)) return activeTab;
    if (visiblePanels.length > 0) return visiblePanels[0].id;
    return fallbackToActiveTabWhenEmpty ? activeTab : null;
  })();

  return {
    visiblePanels,
    mountedPanels,
    isOpen,
    hasAlwaysMount,
    effectiveTab,
    activePanel: visiblePanels.find((panel) => panel.id === effectiveTab),
    showTabs: visiblePanels.length > 1,
  };
}
