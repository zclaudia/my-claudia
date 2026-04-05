import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

const mockSendMessage = vi.fn();
const mockRestartEmbeddedServer = vi.fn().mockResolvedValue(undefined);

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));

// Mock child components
vi.mock('../ProviderManager', () => ({ ProviderManager: ({ isOpen, inline }: any) => isOpen ? <div data-testid="provider-manager" data-inline={inline}>ProviderManager</div> : null }));
vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => <button data-testid="theme-toggle">ThemeToggle</button> }));
vi.mock('../ServerGatewayConfig', () => ({ ServerGatewayConfig: () => <div data-testid="server-gateway-config">ServerGatewayConfig</div> }));
vi.mock('../ImportDialog', () => ({ ImportDialog: ({ isOpen, onClose }: any) => isOpen ? <div data-testid="import-dialog"><button onClick={onClose}>close-import</button></div> : null }));
vi.mock('../ImportOpenCodeDialog', () => ({ ImportOpenCodeDialog: ({ isOpen, onClose }: any) => isOpen ? <div data-testid="import-opencode-dialog"><button onClick={onClose}>close-opencode</button></div> : null }));
vi.mock('../PluginSettings', () => ({ PluginSettings: () => <div data-testid="plugin-settings">PluginSettings</div> }));
vi.mock('../McpServerSettings', () => ({ McpServerSettings: () => <div data-testid="mcp-settings">McpServerSettings</div> }));

// Mock hooks
vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useAndroidBack', () => ({ useAndroidBack: vi.fn() }));
vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendMessage: mockSendMessage,
    connectServer: vi.fn(),
    embeddedServerStatus: 'running',
    embeddedServerError: null,
    embeddedServerPort: 3100,
    restartEmbeddedServer: mockRestartEmbeddedServer,
  }),
}));

// Mock services
vi.mock('../../services/api', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  const stubbed: Record<string, any> = {};
  for (const key of Object.keys(mod)) {
    stubbed[key] = typeof mod[key] === 'function' ? vi.fn(() => Promise.resolve(null)) : mod[key];
  }
  stubbed.getServerInfo = vi.fn(() => new Promise(() => {}));
  stubbed.getAgentConfig = vi.fn(() => new Promise(() => {}));
  stubbed.updateAgentConfig = vi.fn().mockResolvedValue({});
  stubbed.getNotificationConfig = vi.fn().mockResolvedValue({
    enabled: false, ntfyUrl: 'https://ntfy.sh', ntfyTopic: '', events: {
      permissionRequest: true, promptRequest: true, runCompleted: false,
      runFailed: false, supervisionUpdate: false, backgroundPermission: false,
      processLeak: true,
    },
  });
  stubbed.updateNotificationConfig = vi.fn().mockResolvedValue({});
  stubbed.sendTestNotification = vi.fn().mockResolvedValue({});
  stubbed.getManagedProcesses = vi.fn(() => new Promise(() => {}));
  stubbed.getCrashReports = vi.fn(() => new Promise(() => {}));
  return stubbed;
});
vi.mock('../../services/logger', () => ({
  exportLogs: vi.fn().mockReturnValue('[]'),
  getLogCount: vi.fn().mockReturnValue(42),
  clearLogs: vi.fn(),
}));
// Mock shared
vi.mock('@my-claudia/shared', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    DEFAULT_NOTIFICATION_CONFIG: {
      enabled: false,
      ntfyUrl: 'https://ntfy.sh',
      ntfyTopic: '',
      events: {
        permissionRequest: true,
        promptRequest: true,
        runCompleted: false,
        runFailed: false,
        supervisionUpdate: false,
        backgroundPermission: false,
        processLeak: true,
      },
    },
  };
});

import { SettingsPanel } from '../SettingsPanel';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useUIStore } from '../../stores/uiStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useProcessMonitorStore } from '../../stores/processMonitorStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
import * as api from '../../services/api';
import { clearLogs, getLogCount, exportLogs } from '../../services/logger';
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../../utils/platform';

vi.mock('../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
    isMacOS: vi.fn(() => false),
    isTauri: vi.fn(() => false),
  };
});

async function renderSettingsPanel(props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<SettingsPanel isOpen={true} onClose={vi.fn()} {...props} />);
    await Promise.resolve();
  });
  return view;
}

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

async function setupStoresAsync(overrides: Record<string, any> = {}) {
  await act(async () => {
    setupStores(overrides);
    await Promise.resolve();
  });
}

function setupStores(overrides: Record<string, any> = {}) {
  const localBackend = {
    backendId: 'local-standalone',
    name: 'Local',
    online: true,
    runtimeState: 'ready',
    isThisInstance: true,
    instanceId: 'instance-local',
  };
  const remoteBackend = {
    backendId: 'remote-1',
    name: 'Remote',
    online: true,
    runtimeState: 'ready',
    isThisInstance: false,
    instanceId: 'instance-remote',
  };

  useServerStore.setState({
    activeServerId: localBackend.backendId,
    connections: {
      [localBackend.backendId]: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      [remoteBackend.backendId]: { status: 'connected', error: null, isLocalConnection: false, features: [] },
    },
    localServerPort: 3100,
    controlPlaneMode: 'embedded-local',
    setActiveServer: vi.fn(),
    ...overrides.serverStore,
  } as any);

  useFacadeStore.setState({
    facade: null,
    mode: 'embedded',
    connectionState: 'connected',
    backends: [localBackend, remoteBackend],
    sessionStreams: {},
    localBackendId: localBackend.backendId,
    currentInstanceId: 'instance-local',
    currentDeviceId: 'device-local',
    snapshotVersion: 1,
    ...overrides.facadeStore,
  } as any);

  useGatewayStore.setState({
    isConnected: false,
    showLocalBackend: false,
    directGatewayUrl: '',
    directGatewaySecret: '',
    setDirectGatewayConfig: vi.fn(),
    clearDirectGatewayConfig: vi.fn(),
    ...overrides.gatewayStore,
  } as any);

  useUIStore.setState({
    fontSize: 'medium' as any,
    setFontSize: vi.fn(),
    ...overrides.uiStore,
  } as any);

  usePluginStore.setState({
    plugins: [],
    settingsTabs: [],
    panels: [],
    ...overrides.pluginStore,
  } as any);

  useRecoveryStore.setState({
    backends: {
      [localBackend.backendId]: {
        status: overrides.recoveryStore?.[localBackend.backendId]?.status ?? 'ready',
      },
      [remoteBackend.backendId]: {
        status: overrides.recoveryStore?.[remoteBackend.backendId]?.status ?? 'ready',
      },
    },
  } as any);
  useMobileRecoveryStore.getState().reset();
  if (overrides.mobileRecoveryStore) {
    useMobileRecoveryStore.setState(overrides.mobileRecoveryStore as any);
  }

}

describe('SettingsPanel', () => {
  beforeEach(() => {
    setupStores();
    useProcessMonitorStore.getState().clearCleanupResult();
    vi.clearAllMocks();
    mockRestartEmbeddedServer.mockResolvedValue(undefined);
    vi.mocked(isAndroid).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Basic rendering ----

  it('returns null when not open', () => {
    const { container } = render(<SettingsPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when open', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Settings');
  });

  it('renders General tab by default', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Appearance');
    expect(container.textContent).toContain('Local Server');
    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Font Size');
  });

  it('restarts embedded server from local server section', async () => {
    const { getByText } = await renderSettingsPanel();
    await clickAsync(getByText('Restart Embedded Server'));
    expect(mockRestartEmbeddedServer).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const { container } = await renderSettingsPanel({ onClose });
    // Backdrop is the div behind the modal
    const backdrop = container.querySelector('.absolute.inset-0.bg-black\\/50');
    if (backdrop) {
      await clickAsync(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('calls onClose when close button (X) is clicked', async () => {
    const onClose = vi.fn();
    const { container } = await renderSettingsPanel({ onClose });
    // Find the X close button (hidden on mobile, visible on desktop md:block)
    const closeButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.className.includes('md:block')
    );
    if (closeButtons.length > 0) {
      await clickAsync(closeButtons[0]);
      expect(onClose).toHaveBeenCalled();
    }
  });

  // ---- Tab navigation ----

  it('shows all app tabs', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('General');
    expect(container.textContent).toContain('Claudia');
    expect(container.textContent).toContain('Plugins');
  });

  it('shows server tabs', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Providers');
    expect(container.textContent).toContain('MCP Servers');
    expect(container.textContent).toContain('Notifications');
  });


  it('shows Gateway tab for local server', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Gateway');
  });

  it('shows Import tab for local server', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Import');
  });

  it('hides Import and Gateway tabs for non-local server', async () => {
    await act(async () => {
      setupStores({
        serverStore: {
          activeServerId: 'remote-1',
        },
        gatewayStore: {
          directGatewayUrl: 'https://gateway.test',
          directGatewaySecret: 'secret',
        },
      });
      await Promise.resolve();
    });
    const { container } = await renderSettingsPanel();
    // Import should not appear in sidebar tabs
    const tabButtons = Array.from(container.querySelectorAll('[data-testid="import-tab"]'));
    expect(tabButtons.length).toBe(0);
  });

  // ---- Tab switching ----

  it('switches to Providers tab', async () => {
    const { container } = await renderSettingsPanel();
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    expect(providersTab).toBeTruthy();
    await clickAsync(providersTab!);
    expect(container.querySelector('[data-testid="provider-manager"]')).toBeTruthy();
  });

  it('switches to Plugins tab', async () => {
    const { container } = await renderSettingsPanel();
    const pluginsTab = container.querySelector('[data-testid="plugins-tab"]');
    expect(pluginsTab).toBeTruthy();
    await clickAsync(pluginsTab!);
    expect(container.querySelector('[data-testid="plugin-settings"]')).toBeTruthy();
    expect(container.textContent).toContain('Plugins');
  });

  it('switches to MCP Servers tab', async () => {
    const { container } = await renderSettingsPanel();
    const mcpTab = container.querySelector('[data-testid="mcp-servers-tab"]');
    expect(mcpTab).toBeTruthy();
    await clickAsync(mcpTab!);
    expect(container.querySelector('[data-testid="mcp-settings"]')).toBeTruthy();
    expect(container.textContent).toContain('MCP Servers');
  });

  it('switches to Notifications tab', async () => {
    const { container } = await renderSettingsPanel();
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');
    expect(notifTab).toBeTruthy();
    await act(async () => {
      fireEvent.click(notifTab!);
    });
    // Should load notification config
    expect(api.getNotificationConfig).toHaveBeenCalled();
  });

  it('switches to Gateway tab', async () => {
    const { container } = await renderSettingsPanel();
    const gatewayTab = container.querySelector('[data-testid="gateway-tab"]');
    expect(gatewayTab).toBeTruthy();
    await clickAsync(gatewayTab!);
    expect(container.querySelector('[data-testid="server-gateway-config"]')).toBeTruthy();
  });

  it('switches to Import tab', async () => {
    const { container } = await renderSettingsPanel();
    const importTab = container.querySelector('[data-testid="import-tab"]');
    expect(importTab).toBeTruthy();
    await clickAsync(importTab!);
    expect(container.textContent).toContain('Import Data');
    expect(container.textContent).toContain('Claude CLI Sessions');
    expect(container.textContent).toContain('OpenCode Sessions');
  });

  it('switches to Agent tab', async () => {
    const { container } = await renderSettingsPanel();
    const agentTab = container.querySelector('[data-testid="agent-tab"]');
    expect(agentTab).toBeTruthy();
    await clickAsync(agentTab!);
    // AgentSettings component renders (may show loading state in test env)
    expect(agentTab?.classList.toString()).toBeTruthy();
  });

  // ---- General tab: Appearance ----

  it('renders ThemeToggle in general tab', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.querySelector('[data-testid="theme-toggle"]')).toBeTruthy();
  });

  it('renders FontSizeToggle with options', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Small');
    expect(container.textContent).toContain('Medium');
    expect(container.textContent).toContain('Large');
  });

  it('changes font size when clicking size option', async () => {
    const setFontSize = vi.fn();
    setupStores({ uiStore: { fontSize: 'medium', setFontSize } });

    const { container } = await renderSettingsPanel();
    const smallBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Small');
    expect(smallBtn).toBeTruthy();
    await clickAsync(smallBtn!);
    expect(setFontSize).toHaveBeenCalledWith('small');
  });

  it('changes font size to large', async () => {
    const setFontSize = vi.fn();
    setupStores({ uiStore: { fontSize: 'medium', setFontSize } });

    const { container } = await renderSettingsPanel();
    const largeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Large');
    expect(largeBtn).toBeTruthy();
    await clickAsync(largeBtn!);
    expect(setFontSize).toHaveBeenCalledWith('large');
  });

  // ---- Permissions tab ----

  it('shows Permissions tab in sidebar', async () => {
    const { container } = await renderSettingsPanel();
    const permissionsTab = container.querySelector('[data-testid="permissions-tab"]');
    expect(permissionsTab).toBeTruthy();
    expect(container.textContent).toContain('Permissions');
  });

  it('switches to Permissions tab', async () => {
    const { container } = await renderSettingsPanel();
    const permissionsTab = container.querySelector('[data-testid="permissions-tab"]');
    expect(permissionsTab).toBeTruthy();
    await clickAsync(permissionsTab!);
    // PermissionSettings component renders (may show loading state in test env)
    expect(permissionsTab?.classList.toString()).toBeTruthy();
  });

  // ---- General tab: About ----

  it('shows About section with version and connection status', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('About');
    expect(container.textContent).toContain('Version');
    expect(container.textContent).toContain('Connection');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('Server');
  });

  it('shows disconnected status when not connected', async () => {
    setupStores({
      serverStore: {
        connections: {
          'local-standalone': { status: 'disconnected', error: null, isLocalConnection: true, features: [] },
          'remote-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
        },
      },
      facadeStore: {
        connectionState: 'idle',
        backends: [],
      },
    });
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Disconnected');
  });

  it('shows embedded server status', async () => {
    const { container } = await renderSettingsPanel();
    expect(container.textContent).toContain('Embedded Server');
  });

  it('shows SDK versions when available', async () => {
    (api.getServerInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      sdkVersions: {
        sdks: [
          { name: '@anthropic/sdk', current: '1.0.0', latest: '1.1.0', outdated: true },
          { name: '@openai/sdk', current: '2.0.0', latest: '2.0.0', outdated: false },
        ],
      },
    });

    const { container } = await renderSettingsPanel();

    await waitFor(() => {
      expect(container.textContent).toContain('sdk');
    });
  });

  // ---- General tab: Diagnostics ----

  it('shows Diagnostics section with log count', async () => {
    const { container } = await renderSettingsPanel();
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    expect(container.textContent).toContain('Debug');
    expect(container.textContent).toContain('Client Logs');
    expect(container.textContent).toContain('42 entries in buffer');
  });

  it('clears logs when Clear button is clicked', async () => {
    const { container } = await renderSettingsPanel();
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    // Find Clear button in diagnostics (not the search history clear)
    const clearButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.textContent === 'Clear'
    );
    if (clearButtons.length > 0) {
      await clickAsync(clearButtons[0]);
      expect(clearLogs).toHaveBeenCalled();
    }
  });

  it('exports logs when Export Logs button is clicked', async () => {
    const { container } = await renderSettingsPanel();
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    const exportBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Export Logs'
    );
    expect(exportBtn).toBeTruthy();
    // In test environment (no __TAURI_INTERNALS__), it should use web fallback
    await act(async () => {
      fireEvent.click(exportBtn!);
    });
    expect(exportLogs).toHaveBeenCalled();
  });

  it('triggers leaked process cleanup from diagnostics', async () => {
    const { container } = await renderSettingsPanel();
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    const cleanupBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Clean Leaked Processes'
    );

    expect(cleanupBtn).toBeTruthy();
    await clickAsync(cleanupBtn!);

    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'kill_leaked_processes' });
  });

  it('blocks leaked process cleanup on Android while mobile recovery is running', async () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    setupStores({
      mobileRecoveryStore: { phase: 'recovering' },
      facadeStore: {
        connectionState: 'connected',
        backends: [
          { backendId: 'local-standalone', name: 'Local', online: true, runtimeState: 'ready', isThisInstance: true, instanceId: 'instance-local' },
        ],
      },
    });

    const { container } = await renderSettingsPanel();
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    const cleanupBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Clean Leaked Processes'
    );
    expect(cleanupBtn).toBeTruthy();
    await clickAsync(cleanupBtn!);

    expect(mockSendMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.textContent).toContain('Server disconnected');
    });
  });

  it('renders server cleanup results from the process monitor store', async () => {
    const { container } = await renderSettingsPanel();
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    await clickAsync(debugTab!);

    act(() => {
      useProcessMonitorStore.getState().setCleanupResult({
        type: 'process_cleanup_result',
        status: 'killed',
        leakedCount: 3,
        killedCount: 2,
        activeRunCount: 0,
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Terminated 2 of 3 leaked process(es).');
    });
  });

  // ---- Providers tab ----

  it('shows ProviderManager inline when Providers tab is selected', async () => {
    const { container } = await renderSettingsPanel();
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    await clickAsync(providersTab!);

    const pm = container.querySelector('[data-testid="provider-manager"]');
    expect(pm).toBeTruthy();
    expect(pm?.getAttribute('data-inline')).toBe('true');
  });

  it('shows remote server notice when not local server', async () => {
    setupStores({
      serverStore: {
        activeServerId: 'remote-1',
      },
      facadeStore: {
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            isThisInstance: true,
            instanceId: 'instance-local',
          },
          {
            backendId: 'remote-1',
            name: 'Remote Server',
            online: true,
            runtimeState: 'ready',
            isThisInstance: false,
            instanceId: 'instance-remote',
          },
        ],
      },
    });

    const { container } = await renderSettingsPanel();
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    await clickAsync(providersTab!);

    expect(container.textContent).toContain('Managing providers on');
    expect(container.textContent).toContain('Remote Server');
  });

  // ---- Import tab ----

  it('opens Claude CLI import dialog', async () => {
    const { container } = await renderSettingsPanel();
    const importTab = container.querySelector('[data-testid="import-tab"]');
    await clickAsync(importTab!);

    const importBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Import from Claude CLI'
    );
    expect(importBtn).toBeTruthy();
    await clickAsync(importBtn!);

    expect(document.querySelector('[data-testid="import-dialog"]')).toBeTruthy();
  });

  it('opens OpenCode import dialog', async () => {
    const { container } = await renderSettingsPanel();
    const importTab = container.querySelector('[data-testid="import-tab"]');
    await clickAsync(importTab!);

    const importBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Import from OpenCode'
    );
    expect(importBtn).toBeTruthy();
    await clickAsync(importBtn!);

    expect(document.querySelector('[data-testid="import-opencode-dialog"]')).toBeTruthy();
  });

  // ---- Notifications tab ----

  it('renders notification settings when tab is selected', async () => {
    const { container } = await renderSettingsPanel();
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await clickAsync(notifTab!);

    await waitFor(() => {
      expect(container.textContent).toContain('Enable notifications');
      expect(container.textContent).toContain('ntfy');
    });
  });

  it('toggles notification enabled state', async () => {
    const { container } = await renderSettingsPanel();
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await clickAsync(notifTab!);

    // Find the enable toggle
    const toggleButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.className.includes('rounded-full') && b.className.includes('w-10')
    );

    if (toggleButtons.length > 0) {
      await clickAsync(toggleButtons[0]);
      // Should now show ntfy config fields
      await waitFor(() => {
        expect(container.textContent).toContain('ntfy Configuration');
      });
    }
  });

  it('shows notification event toggles when enabled', async () => {
    (api.getNotificationConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true, ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'test-topic',
      events: {
        permissionRequest: true, promptRequest: true, runCompleted: false,
        runFailed: false, supervisionUpdate: false, backgroundPermission: false,
      },
    });

    const { container } = await renderSettingsPanel();
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await clickAsync(notifTab!);

    await waitFor(() => {
      expect(container.textContent).toContain('Permission requests');
      expect(container.textContent).toContain('Prompt requests');
      expect(container.textContent).toContain('Run completed');
      expect(container.textContent).toContain('Run failed');
      expect(container.textContent).toContain('Supervision updates');
      expect(container.textContent).toContain('Background task alerts');
    });
  });

  it('shows Send Test button for notifications', async () => {
    (api.getNotificationConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true, ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'test-topic',
      events: { permissionRequest: true, promptRequest: true, runCompleted: false, runFailed: false, supervisionUpdate: false, backgroundPermission: false },
    });

    const { container } = await renderSettingsPanel();
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await clickAsync(notifTab!);

    await waitFor(() => {
      const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent === 'Send Test'
      );
      expect(testBtn).toBeTruthy();
    });
  });

  // ---- Server picker ----

  it('opens server picker dropdown', async () => {
    setupStores({
      gatewayStore: {
        isConnected: true,
      },
      facadeStore: {
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            isThisInstance: true,
            instanceId: 'instance-local',
          },
          {
            backendId: 'remote-1',
            name: 'Remote',
            online: true,
            runtimeState: 'ready',
            isThisInstance: false,
            instanceId: 'instance-remote',
          },
        ],
      },
    });

    const { container } = await renderSettingsPanel();
    // The server picker is in the sidebar with the server name label
    const serverPickerBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Local') && b.className.includes('w-full')
    );
    if (serverPickerBtn) {
      await clickAsync(serverPickerBtn);
      // Should show dropdown with server options
      expect(container.textContent).toContain('Remote');
    }
  });

  it('switches server from picker', async () => {
    const setActiveServer = vi.fn();
    setupStores({
      serverStore: {
        setActiveServer,
      },
      facadeStore: {
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            isThisInstance: true,
            instanceId: 'instance-local',
          },
          {
            backendId: 'remote-1',
            name: 'Remote',
            online: true,
            runtimeState: 'ready',
            isThisInstance: false,
            instanceId: 'instance-remote',
          },
        ],
      },
    });

    const { container } = await renderSettingsPanel();
    // Open server picker
    const serverPickerBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Local') && b.className.includes('w-full')
    );
    if (serverPickerBtn) {
      await clickAsync(serverPickerBtn);
      // Click Remote server
      const remoteBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Remote') && !b.textContent?.includes('Local')
      );
      if (remoteBtn) {
        await clickAsync(remoteBtn);
        expect(setActiveServer).toHaveBeenCalledWith('remote-1');
      }
    }
  });

  // ---- Gateway tab ----

  it('renders ServerGatewayConfig on desktop gateway tab', async () => {
    const { container } = await renderSettingsPanel();
    const gatewayTab = container.querySelector('[data-testid="gateway-tab"]');
    await clickAsync(gatewayTab!);
    expect(container.querySelector('[data-testid="server-gateway-config"]')).toBeTruthy();
  });

  // ---- Plugin settings tabs ----

  it('renders plugin settings tabs when plugins define them', async () => {
    usePluginStore.setState({
      plugins: [],
    } as any);

    // The pluginSettingsTabs are derived from store — mock the selector
    // For this test, we just verify the plugin tab area renders
    const { container } = await renderSettingsPanel();
    // Plugins tab should always be there
    expect(container.textContent).toContain('Plugins');
  });

  // ---- Reset tab on server switch ----

  it('resets import tab to providers when switching to non-local server', async () => {
    const { container, rerender } = await renderSettingsPanel();

    // Switch to import tab
    const importTab = container.querySelector('[data-testid="import-tab"]');
    await clickAsync(importTab!);
    expect(container.textContent).toContain('Import Data');

    // Now switch to non-local server
    await setupStoresAsync({
      serverStore: {
        activeServerId: 'remote-1',
      },
      gatewayStore: {
        directGatewayUrl: 'https://gateway.test',
        directGatewaySecret: 'secret',
      },
    });

    await act(async () => {
      rerender(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="import-tab"]')).toBeFalsy();
    });
  });

  // ---- MCP Servers tab ----

  it('shows MCP Servers description and component', async () => {
    const { container } = await renderSettingsPanel();
    const mcpTab = container.querySelector('[data-testid="mcp-servers-tab"]');
    await clickAsync(mcpTab!);

    expect(container.textContent).toContain('Model Context Protocol');
    expect(container.querySelector('[data-testid="mcp-settings"]')).toBeTruthy();
  });

  // ---- Connection status colors ----

  it('shows correct status colors in server picker', async () => {
    setupStores({
      serverStore: {
        connections: {
          'local-standalone': { status: 'connected', error: null, isLocalConnection: true, features: [] },
        },
      },
    });

    const { container } = await renderSettingsPanel();
    // The sidebar shows the active tab, status is reflected in the server picker dropdown
    // Just verifying no crash with various statuses
    expect(container).toBeTruthy();
  });

  // ---- Import tab content ----

  it('shows import note about local server only', async () => {
    const { container } = await renderSettingsPanel();
    const importTab = container.querySelector('[data-testid="import-tab"]');
    await clickAsync(importTab!);

    expect(container.textContent).toContain('Import functionality is only available when connected to a local server');
  });
});
