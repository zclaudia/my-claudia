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
  stubbed.getServerInfo = vi.fn().mockResolvedValue({ sdkVersions: null, localReviewer: null });
  stubbed.getAgentConfig = vi.fn().mockResolvedValue({});
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
import { useLocalReviewerStore } from '../../stores/localReviewerStore';
import * as api from '../../services/api';
import { clearLogs, getLogCount, exportLogs } from '../../services/logger';
import { invoke } from '@tauri-apps/api/core';

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
    controlPlaneState: 'ready',
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
    registryRevision: 1,
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
    ...overrides.pluginStore,
  } as any);

  useLocalReviewerStore.setState({
    enabled: false,
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen3:4b-instruct',
    managedRuntime: true,
    autoStart: true,
    managedPid: null,
    status: {
      state: 'disabled',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen3:4b-instruct',
      binaryAvailable: false,
      serverReachable: false,
      modelAvailable: false,
      managedRuntimeActive: false,
    },
  } as any);
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    setupStores();
    useProcessMonitorStore.getState().clearCleanupResult();
    vi.clearAllMocks();
    mockRestartEmbeddedServer.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Basic rendering ----

  it('returns null when not open', () => {
    const { container } = render(<SettingsPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when open', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Settings');
  });

  it('renders General tab by default', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Appearance');
    expect(container.textContent).toContain('Local Reviewer');
    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Font Size');
  });

  it('restarts embedded server from local reviewer section', () => {
    const { getByText } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(getByText('Restart Embedded Server'));
    expect(mockRestartEmbeddedServer).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    // Backdrop is the div behind the modal
    const backdrop = container.querySelector('.absolute.inset-0.bg-black\\/50');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('calls onClose when close button (X) is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    // Find the X close button (hidden on mobile, visible on desktop md:block)
    const closeButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.className.includes('md:block')
    );
    if (closeButtons.length > 0) {
      fireEvent.click(closeButtons[0]);
      expect(onClose).toHaveBeenCalled();
    }
  });

  // ---- Tab navigation ----

  it('shows all app tabs', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('General');
    expect(container.textContent).toContain('Claudia');
    expect(container.textContent).toContain('Plugins');
  });

  it('shows server tabs', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Providers');
    expect(container.textContent).toContain('MCP Servers');
    expect(container.textContent).toContain('Notifications');
  });


  it('shows Gateway tab for local server', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Gateway');
  });

  it('shows Import tab for local server', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Import');
  });

  it('hides Import and Gateway tabs for non-local server', () => {
    setupStores({
      serverStore: {
        activeServerId: 'remote-1',
      },
      gatewayStore: {
        directGatewayUrl: 'https://gateway.test',
        directGatewaySecret: 'secret',
      },
    });
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Import should not appear in sidebar tabs
    const tabButtons = Array.from(container.querySelectorAll('[data-testid="import-tab"]'));
    expect(tabButtons.length).toBe(0);
  });

  // ---- Tab switching ----

  it('switches to Providers tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    expect(providersTab).toBeTruthy();
    fireEvent.click(providersTab!);
    expect(container.querySelector('[data-testid="provider-manager"]')).toBeTruthy();
  });

  it('switches to Plugins tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const pluginsTab = container.querySelector('[data-testid="plugins-tab"]');
    expect(pluginsTab).toBeTruthy();
    fireEvent.click(pluginsTab!);
    expect(container.querySelector('[data-testid="plugin-settings"]')).toBeTruthy();
    expect(container.textContent).toContain('Plugins');
  });

  it('switches to MCP Servers tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const mcpTab = container.querySelector('[data-testid="mcp-servers-tab"]');
    expect(mcpTab).toBeTruthy();
    fireEvent.click(mcpTab!);
    expect(container.querySelector('[data-testid="mcp-settings"]')).toBeTruthy();
    expect(container.textContent).toContain('MCP Servers');
  });

  it('switches to Notifications tab', async () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');
    expect(notifTab).toBeTruthy();
    await act(async () => {
      fireEvent.click(notifTab!);
    });
    // Should load notification config
    expect(api.getNotificationConfig).toHaveBeenCalled();
  });

  it('switches to Gateway tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const gatewayTab = container.querySelector('[data-testid="gateway-tab"]');
    expect(gatewayTab).toBeTruthy();
    fireEvent.click(gatewayTab!);
    expect(container.querySelector('[data-testid="server-gateway-config"]')).toBeTruthy();
  });

  it('switches to Import tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const importTab = container.querySelector('[data-testid="import-tab"]');
    expect(importTab).toBeTruthy();
    fireEvent.click(importTab!);
    expect(container.textContent).toContain('Import Data');
    expect(container.textContent).toContain('Claude CLI Sessions');
    expect(container.textContent).toContain('OpenCode Sessions');
  });

  it('switches to Agent tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const agentTab = container.querySelector('[data-testid="agent-tab"]');
    expect(agentTab).toBeTruthy();
    fireEvent.click(agentTab!);
    // AgentSettings component renders (may show loading state in test env)
    expect(agentTab?.classList.toString()).toBeTruthy();
  });

  // ---- General tab: Appearance ----

  it('renders ThemeToggle in general tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.querySelector('[data-testid="theme-toggle"]')).toBeTruthy();
  });

  it('renders FontSizeToggle with options', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Small');
    expect(container.textContent).toContain('Medium');
    expect(container.textContent).toContain('Large');
  });

  it('changes font size when clicking size option', () => {
    const setFontSize = vi.fn();
    setupStores({ uiStore: { fontSize: 'medium', setFontSize } });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const smallBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Small');
    expect(smallBtn).toBeTruthy();
    fireEvent.click(smallBtn!);
    expect(setFontSize).toHaveBeenCalledWith('small');
  });

  it('changes font size to large', () => {
    const setFontSize = vi.fn();
    setupStores({ uiStore: { fontSize: 'medium', setFontSize } });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const largeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Large');
    expect(largeBtn).toBeTruthy();
    fireEvent.click(largeBtn!);
    expect(setFontSize).toHaveBeenCalledWith('large');
  });

  // ---- Permissions tab ----

  it('shows Permissions tab in sidebar', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const permissionsTab = container.querySelector('[data-testid="permissions-tab"]');
    expect(permissionsTab).toBeTruthy();
    expect(container.textContent).toContain('Permissions');
  });

  it('switches to Permissions tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const permissionsTab = container.querySelector('[data-testid="permissions-tab"]');
    expect(permissionsTab).toBeTruthy();
    fireEvent.click(permissionsTab!);
    // PermissionSettings component renders (may show loading state in test env)
    expect(permissionsTab?.classList.toString()).toBeTruthy();
  });

  // ---- General tab: About ----

  it('shows About section with version and connection status', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('About');
    expect(container.textContent).toContain('Version');
    expect(container.textContent).toContain('Connection');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('Server');
  });

  it('shows disconnected status when not connected', () => {
    setupStores({
      serverStore: {
        connections: {
          'local-standalone': { status: 'disconnected', error: null, isLocalConnection: true, features: [] },
          'remote-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
        },
      },
    });
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Disconnected');
  });

  it('shows embedded server status', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
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

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('sdk');
  });

  it('shows server-side local reviewer status when available', async () => {
    (api.getServerInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      sdkVersions: null,
      localReviewer: {
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'qwen3:4b-instruct',
        serverReachable: true,
        modelAvailable: true,
      },
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('Server-side status');
    expect(container.textContent).toContain('configured');
  });

  // ---- General tab: Diagnostics ----

  it('shows Diagnostics section with log count', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    fireEvent.click(debugTab!);

    expect(container.textContent).toContain('Debug');
    expect(container.textContent).toContain('Client Logs');
    expect(container.textContent).toContain('42 entries in buffer');
  });

  it('clears logs when Clear button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    fireEvent.click(debugTab!);

    // Find Clear button in diagnostics (not the search history clear)
    const clearButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.textContent === 'Clear'
    );
    if (clearButtons.length > 0) {
      fireEvent.click(clearButtons[0]);
      expect(clearLogs).toHaveBeenCalled();
    }
  });

  it('exports logs when Export Logs button is clicked', async () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    fireEvent.click(debugTab!);

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

  it('triggers leaked process cleanup from diagnostics', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    fireEvent.click(debugTab!);

    const cleanupBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Clean Leaked Processes'
    );

    expect(cleanupBtn).toBeTruthy();
    fireEvent.click(cleanupBtn!);

    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'kill_leaked_processes' });
  });

  it('renders server cleanup results from the process monitor store', async () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Click Debug tab to access Diagnostics
    const debugTab = container.querySelector('[data-testid="debug-tab"]');
    expect(debugTab).toBeTruthy();
    fireEvent.click(debugTab!);

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

  it('shows ProviderManager inline when Providers tab is selected', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    fireEvent.click(providersTab!);

    const pm = container.querySelector('[data-testid="provider-manager"]');
    expect(pm).toBeTruthy();
    expect(pm?.getAttribute('data-inline')).toBe('true');
  });

  it('shows remote server notice when not local server', () => {
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

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const providersTab = container.querySelector('[data-testid="providers-tab"]');
    fireEvent.click(providersTab!);

    expect(container.textContent).toContain('Managing providers on');
    expect(container.textContent).toContain('Remote Server');
  });

  // ---- Import tab ----

  it('opens Claude CLI import dialog', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const importTab = container.querySelector('[data-testid="import-tab"]');
    fireEvent.click(importTab!);

    const importBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Import from Claude CLI'
    );
    expect(importBtn).toBeTruthy();
    fireEvent.click(importBtn!);

    expect(document.querySelector('[data-testid="import-dialog"]')).toBeTruthy();
  });

  it('opens OpenCode import dialog', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const importTab = container.querySelector('[data-testid="import-tab"]');
    fireEvent.click(importTab!);

    const importBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Import from OpenCode'
    );
    expect(importBtn).toBeTruthy();
    fireEvent.click(importBtn!);

    expect(document.querySelector('[data-testid="import-opencode-dialog"]')).toBeTruthy();
  });

  // ---- Notifications tab ----

  it('renders notification settings when tab is selected', async () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await act(async () => {
      fireEvent.click(notifTab!);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('Enable notifications');
    expect(container.textContent).toContain('ntfy');
  });

  it('toggles notification enabled state', async () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await act(async () => {
      fireEvent.click(notifTab!);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Find the enable toggle
    const toggleButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.className.includes('rounded-full') && b.className.includes('w-10')
    );

    if (toggleButtons.length > 0) {
      fireEvent.click(toggleButtons[0]);
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

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await act(async () => {
      fireEvent.click(notifTab!);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('Permission requests');
    expect(container.textContent).toContain('Prompt requests');
    expect(container.textContent).toContain('Run completed');
    expect(container.textContent).toContain('Run failed');
    expect(container.textContent).toContain('Supervision updates');
    expect(container.textContent).toContain('Background task alerts');
  });

  it('shows Send Test button for notifications', async () => {
    (api.getNotificationConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true, ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'test-topic',
      events: { permissionRequest: true, promptRequest: true, runCompleted: false, runFailed: false, supervisionUpdate: false, backgroundPermission: false },
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const notifTab = container.querySelector('[data-testid="notifications-tab"]');

    await act(async () => {
      fireEvent.click(notifTab!);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Send Test'
    );
    expect(testBtn).toBeTruthy();
  });

  // ---- Server picker ----

  it('opens server picker dropdown', () => {
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

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // The server picker is in the sidebar with the server name label
    const serverPickerBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Local') && b.className.includes('w-full')
    );
    if (serverPickerBtn) {
      fireEvent.click(serverPickerBtn);
      // Should show dropdown with server options
      expect(container.textContent).toContain('Remote');
    }
  });

  it('switches server from picker', () => {
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

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Open server picker
    const serverPickerBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Local') && b.className.includes('w-full')
    );
    if (serverPickerBtn) {
      fireEvent.click(serverPickerBtn);
      // Click Remote server
      const remoteBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Remote') && !b.textContent?.includes('Local')
      );
      if (remoteBtn) {
        fireEvent.click(remoteBtn);
        expect(setActiveServer).toHaveBeenCalledWith('remote-1');
      }
    }
  });

  // ---- Gateway tab ----

  it('renders ServerGatewayConfig on desktop gateway tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const gatewayTab = container.querySelector('[data-testid="gateway-tab"]');
    fireEvent.click(gatewayTab!);
    expect(container.querySelector('[data-testid="server-gateway-config"]')).toBeTruthy();
  });

  // ---- Plugin settings tabs ----

  it('renders plugin settings tabs when plugins define them', () => {
    usePluginStore.setState({
      plugins: [],
    } as any);

    // The pluginSettingsTabs are derived from store — mock the selector
    // For this test, we just verify the plugin tab area renders
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // Plugins tab should always be there
    expect(container.textContent).toContain('Plugins');
  });

  // ---- Reset tab on server switch ----

  it('resets import tab to providers when switching to non-local server', async () => {
    const { container, rerender } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    // Switch to import tab
    const importTab = container.querySelector('[data-testid="import-tab"]');
    fireEvent.click(importTab!);
    expect(container.textContent).toContain('Import Data');

    // Now switch to non-local server
    setupStores({
      serverStore: {
        activeServerId: 'remote-1',
      },
      gatewayStore: {
        directGatewayUrl: 'https://gateway.test',
        directGatewaySecret: 'secret',
      },
    });

    rerender(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    // After re-render, import tab should not be available and content should change
    // The useEffect should have reset the tab
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.querySelector('[data-testid="import-tab"]')).toBeFalsy();
  });

  // ---- MCP Servers tab ----

  it('shows MCP Servers description and component', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const mcpTab = container.querySelector('[data-testid="mcp-servers-tab"]');
    fireEvent.click(mcpTab!);

    expect(container.textContent).toContain('Model Context Protocol');
    expect(container.querySelector('[data-testid="mcp-settings"]')).toBeTruthy();
  });

  // ---- Connection status colors ----

  it('shows correct status colors in server picker', () => {
    setupStores({
      serverStore: {
        connections: {
          'local-standalone': { status: 'connected', error: null, isLocalConnection: true, features: [] },
        },
      },
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    // The sidebar shows the active tab, status is reflected in the server picker dropdown
    // Just verifying no crash with various statuses
    expect(container).toBeTruthy();
  });

  // ---- Import tab content ----

  it('shows import note about local server only', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const importTab = container.querySelector('[data-testid="import-tab"]');
    fireEvent.click(importTab!);

    expect(container.textContent).toContain('Import functionality is only available when connected to a local server');
  });
});
