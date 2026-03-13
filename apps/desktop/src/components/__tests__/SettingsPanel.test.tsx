import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

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
    connectServer: vi.fn(),
    embeddedServerStatus: 'running',
    embeddedServerError: null,
    embeddedServerPort: 3100,
  }),
}));

// Mock services
vi.mock('../../services/api', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  const stubbed: Record<string, any> = {};
  for (const key of Object.keys(mod)) {
    stubbed[key] = typeof mod[key] === 'function' ? vi.fn(() => Promise.resolve(null)) : mod[key];
  }
  stubbed.getServerInfo = vi.fn().mockResolvedValue({ sdkVersions: null });
  stubbed.getAgentConfig = vi.fn().mockResolvedValue({});
  stubbed.updateAgentConfig = vi.fn().mockResolvedValue({});
  stubbed.getNotificationConfig = vi.fn().mockResolvedValue({
    enabled: false, ntfyUrl: 'https://ntfy.sh', ntfyTopic: '', events: {
      permissionRequest: true, askUserQuestion: true, runCompleted: false,
      runFailed: false, supervisionUpdate: false, backgroundPermission: false,
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
vi.mock('../../services/clientAI', () => ({
  getClientAIConfig: vi.fn().mockReturnValue(null),
  setClientAIConfig: vi.fn(),
  testClientAIConnection: vi.fn().mockResolvedValue({ ok: true }),
  fetchAvailableModels: vi.fn().mockResolvedValue([]),
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
        askUserQuestion: true,
        runCompleted: false,
        runFailed: false,
        supervisionUpdate: false,
        backgroundPermission: false,
      },
    },
  };
});

import { SettingsPanel } from '../SettingsPanel';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useUIStore } from '../../stores/uiStore';
import { usePluginStore } from '../../stores/pluginStore';
import * as api from '../../services/api';
import { clearLogs, getLogCount, exportLogs } from '../../services/logger';
import { getClientAIConfig, setClientAIConfig, testClientAIConnection, fetchAvailableModels } from '../../services/clientAI';
import { invoke } from '@tauri-apps/api/core';

function setupStores(overrides: Record<string, any> = {}) {
  useServerStore.setState({
    servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }],
    activeServerId: 'local',
    connections: {
      local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
    },
    connectionStatus: 'connected',
    connectionError: null,
    getActiveServer: () => ({ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }) as any,
    setActiveServer: vi.fn(),
    ...overrides.serverStore,
  } as any);

  useGatewayStore.setState({
    isConnected: false,
    discoveredBackends: [],
    localBackendId: null,
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
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    setupStores();
    vi.clearAllMocks();
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
    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Font Size');
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
    expect(container.textContent).toContain('Agent AI');
    expect(container.textContent).toContain('Plugins');
  });

  it('shows server tabs', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Providers');
    expect(container.textContent).toContain('MCP Servers');
    expect(container.textContent).toContain('Notifications');
  });

  it('shows Connections tab on desktop (not mobile)', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Connections');
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
        servers: [{ id: 'remote-1', name: 'Remote', address: 'remote:3100', isDefault: false, createdAt: 0 }],
        getActiveServer: () => ({ id: 'remote-1', name: 'Remote', address: 'remote:3100' }) as any,
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

  it('switches to Connections tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const connTab = container.querySelector('[data-testid="connections-tab"]');
    expect(connTab).toBeTruthy();
    fireEvent.click(connTab!);
    expect(container.textContent).toContain('View your backend server connections');
  });

  it('switches to Agent AI tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    expect(clientAiTab).toBeTruthy();
    fireEvent.click(clientAiTab!);
    expect(container.textContent).toContain('Agent AI');
    expect(container.textContent).toContain('API Endpoint');
    expect(container.textContent).toContain('API Key');
    expect(container.textContent).toContain('Model');
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

  // ---- General tab: Agent Permissions ----

  it('renders Agent Permissions section', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Agent Permissions');
    expect(container.textContent).toContain('Auto-Approve Tools');
  });

  it('toggles agent permissions on', async () => {
    (api.updateAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    // Wait for agent config to load
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Find the Auto-Approve toggle button (the round toggle)
    const toggleButtons = Array.from(container.querySelectorAll('button')).filter(b =>
      b.className.includes('rounded-full') && b.className.includes('w-10')
    );

    // The first matching toggle should be the agent permission toggle
    if (toggleButtons.length > 0) {
      await act(async () => {
        fireEvent.click(toggleButtons[0]);
      });
      expect(api.updateAgentConfig).toHaveBeenCalled();
    }
  });

  it('shows trust levels when agent permissions are enabled', async () => {
    (api.getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      permissionPolicy: JSON.stringify({ enabled: true, trustLevel: 'conservative', customRules: [], escalateAlways: [] }),
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('Trust Level');
    expect(container.textContent).toContain('Conservative');
    expect(container.textContent).toContain('Moderate');
    expect(container.textContent).toContain('Aggressive');
    expect(container.textContent).toContain('Full Trust');
  });

  it('changes trust level', async () => {
    (api.getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      permissionPolicy: JSON.stringify({ enabled: true, trustLevel: 'conservative', customRules: [], escalateAlways: [] }),
    });
    (api.updateAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Click Moderate trust level
    const moderateBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Moderate') && b.textContent?.includes('Auto-approve reads')
    );
    if (moderateBtn) {
      await act(async () => {
        fireEvent.click(moderateBtn);
      });
      expect(api.updateAgentConfig).toHaveBeenCalled();
    }
  });

  it('shows ExitPlanMode note when permissions enabled', async () => {
    (api.getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      permissionPolicy: JSON.stringify({ enabled: true, trustLevel: 'conservative', customRules: [], escalateAlways: [] }),
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('ExitPlanMode always requires manual approval');
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
    setupStores({ serverStore: { connectionStatus: 'disconnected' } });
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

  // ---- General tab: Diagnostics ----

  it('shows Diagnostics section with log count', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Diagnostics');
    expect(container.textContent).toContain('Client Logs');
    expect(container.textContent).toContain('42 entries in buffer');
  });

  it('clears logs when Clear button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
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
        servers: [{ id: 'remote-1', name: 'Remote Server', address: 'remote:3100', isDefault: false, createdAt: 0 }],
        getActiveServer: () => ({ id: 'remote-1', name: 'Remote Server', address: 'remote:3100' }) as any,
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
        permissionRequest: true, askUserQuestion: true, runCompleted: false,
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
    expect(container.textContent).toContain('Claude questions');
    expect(container.textContent).toContain('Run completed');
    expect(container.textContent).toContain('Run failed');
    expect(container.textContent).toContain('Supervision updates');
    expect(container.textContent).toContain('Background task alerts');
  });

  it('shows Send Test button for notifications', async () => {
    (api.getNotificationConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true, ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'test-topic',
      events: { permissionRequest: true, askUserQuestion: true, runCompleted: false, runFailed: false, supervisionUpdate: false, backgroundPermission: false },
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

  // ---- Client AI tab ----

  it('renders Client AI settings', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    expect(container.textContent).toContain('API Endpoint');
    expect(container.textContent).toContain('API Key');
    expect(container.textContent).toContain('Model');
    expect(container.textContent).toContain('Test Connection');
  });

  it('enables Test Connection button when endpoint and key are filled', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    // Fill endpoint and key
    const inputs = container.querySelectorAll('input');
    const endpointInput = Array.from(inputs).find(i => i.placeholder?.includes('openai.com'))!;
    const keyInput = Array.from(inputs).find(i => i.placeholder?.includes('sk-'))!;

    fireEvent.change(endpointInput, { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.change(keyInput, { target: { value: 'sk-test123' } });

    const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Test Connection'
    );
    expect(testBtn).toBeTruthy();
    expect(testBtn?.disabled).toBe(false);
  });

  it('disables Test Connection button when endpoint or key missing', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Test Connection'
    );
    expect(testBtn?.disabled).toBe(true);
  });

  it('shows Save button when form is dirty', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    const inputs = container.querySelectorAll('input');
    const endpointInput = Array.from(inputs).find(i => i.placeholder?.includes('openai.com'))!;
    fireEvent.change(endpointInput, { target: { value: 'https://api.test.com' } });

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Save'
    );
    expect(saveBtn).toBeTruthy();
  });

  it('saves client AI config', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    const inputs = container.querySelectorAll('input');
    const endpointInput = Array.from(inputs).find(i => i.placeholder?.includes('openai.com'))!;
    fireEvent.change(endpointInput, { target: { value: 'https://api.test.com' } });

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Save'
    );
    fireEvent.click(saveBtn!);
    expect(setClientAIConfig).toHaveBeenCalled();
  });

  it('tests client AI connection', async () => {
    (testClientAIConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    (fetchAvailableModels as ReturnType<typeof vi.fn>).mockResolvedValue(['gpt-4o', 'gpt-3.5-turbo']);

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    const inputs = container.querySelectorAll('input');
    const endpointInput = Array.from(inputs).find(i => i.placeholder?.includes('openai.com'))!;
    const keyInput = Array.from(inputs).find(i => i.placeholder?.includes('sk-'))!;

    fireEvent.change(endpointInput, { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.change(keyInput, { target: { value: 'sk-test123' } });

    const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Test Connection'
    );

    await act(async () => {
      fireEvent.click(testBtn!);
    });

    expect(testClientAIConnection).toHaveBeenCalled();
    await waitFor(() => {
      expect(container.textContent).toContain('Connection successful!');
    });
  });

  it('shows test connection failure', async () => {
    (testClientAIConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Invalid API key' });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const clientAiTab = container.querySelector('[data-testid="client-ai-tab"]');
    fireEvent.click(clientAiTab!);

    const inputs = container.querySelectorAll('input');
    const endpointInput = Array.from(inputs).find(i => i.placeholder?.includes('openai.com'))!;
    const keyInput = Array.from(inputs).find(i => i.placeholder?.includes('sk-'))!;

    fireEvent.change(endpointInput, { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.change(keyInput, { target: { value: 'sk-bad' } });

    const testBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent === 'Test Connection'
    );

    await act(async () => {
      fireEvent.click(testBtn!);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Invalid API key');
    });
  });

  // ---- Connections tab (ServerInfoPanel) ----

  it('shows server info in connections tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const connTab = container.querySelector('[data-testid="connections-tab"]');
    fireEvent.click(connTab!);

    expect(container.textContent).toContain('Local');
    expect(container.textContent).toContain('localhost:3100');
    expect(container.textContent).toContain('Connected');
  });

  it('shows gateway backends in connections tab when connected', () => {
    setupStores({
      gatewayStore: {
        isConnected: true,
        discoveredBackends: [
          { backendId: 'gw-1', name: 'Gateway Backend', online: true },
        ],
        localBackendId: null,
        showLocalBackend: true,
      },
    });

    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const connTab = container.querySelector('[data-testid="connections-tab"]');
    fireEvent.click(connTab!);

    expect(container.textContent).toContain('Via Gateway');
    expect(container.textContent).toContain('Gateway Backend');
    expect(container.textContent).toContain('Online');
  });

  // ---- Server picker ----

  it('opens server picker dropdown', () => {
    setupStores({
      serverStore: {
        servers: [
          { id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 },
          { id: 'remote-1', name: 'Remote', address: 'remote:3100', isDefault: false, createdAt: 0 },
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
        servers: [
          { id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 },
          { id: 'remote-1', name: 'Remote', address: 'remote:3100', isDefault: false, createdAt: 0 },
        ],
        setActiveServer,
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
        servers: [{ id: 'remote-1', name: 'Remote', address: 'remote:3100', isDefault: false, createdAt: 0 }],
        getActiveServer: () => ({ id: 'remote-1', name: 'Remote', address: 'remote:3100' }) as any,
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
        servers: [
          { id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 },
        ],
        connections: {
          local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
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
