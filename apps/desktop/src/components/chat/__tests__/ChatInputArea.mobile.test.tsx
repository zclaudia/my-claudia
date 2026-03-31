// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInputArea } from '../ChatInputArea';
import type { ProviderCapabilities } from '@my-claudia/shared';
import type { ReactNode } from 'react';

vi.mock('../MessageInput', () => ({
  MessageInput: ({ mobileToolbarSlot }: { mobileToolbarSlot?: ReactNode }) => (
    <div data-testid="message-input">{mobileToolbarSlot}</div>
  ),
}));

vi.mock('../PermissionSelector', () => ({
  PermissionSelector: () => <div data-testid="permission-selector" />,
}));

vi.mock('../WorktreeSelector', () => ({
  WorktreeSelector: () => <div data-testid="worktree-selector" />,
}));

vi.mock('../TokenUsageDisplay', () => ({
  TokenUsageDisplay: () => <div data-testid="token-usage" />,
}));

vi.mock('../SystemInfoButton', () => ({
  SystemInfoButton: () => <div data-testid="system-info" />,
}));

vi.mock('../../../services/api', () => ({
  unlockSession: vi.fn(),
}));

const serverStoreState = {
  activeServerSupports: vi.fn(() => false),
};

vi.mock('../../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    vi.fn(() => serverStoreState),
    {
      getState: () => serverStoreState,
    },
  ),
}));

const terminalStoreState = {
  drawerOpen: {} as Record<string, boolean>,
  terminals: {} as Record<string, string>,
  setDrawerOpen: vi.fn(),
  openTerminal: vi.fn(() => 'term-1'),
  isDrawerOpen: vi.fn((projectId: string) => Boolean(terminalStoreState.drawerOpen[projectId])),
  getTerminalId: vi.fn((projectId: string) => terminalStoreState.terminals[projectId]),
};

vi.mock('../../../stores/terminalStore', () => ({
  useTerminalStore: Object.assign(
    vi.fn((selector?: (state: typeof terminalStoreState) => unknown) =>
      selector ? selector(terminalStoreState) : terminalStoreState),
    {
      getState: () => terminalStoreState,
    },
  ),
}));

const bottomPanelState = {
  activeTab: '',
  setActiveTab: vi.fn(),
};

vi.mock('../../../stores/bottomPanelStore', () => ({
  useBottomPanelStore: vi.fn(() => bottomPanelState),
}));

const fileViewerState = {
  isOpen: false,
  close: vi.fn(),
  togglePanel: vi.fn(),
  setSearchOpen: vi.fn(),
};

vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: Object.assign(
    vi.fn(() => fileViewerState),
    {
      getState: () => fileViewerState,
    },
  ),
}));

const pluginStoreState = {
  disabledBuiltinPanels: [] as string[],
};

vi.mock('../../../stores/pluginStore', () => ({
  usePluginStore: Object.assign(
    vi.fn((selector?: (state: typeof pluginStoreState) => unknown) =>
      selector ? selector(pluginStoreState) : pluginStoreState),
    {
      getState: () => pluginStoreState,
    },
  ),
}));

const draftEditorState = {
  openEditor: vi.fn(),
  setSendCallback: vi.fn(),
  draftExists: { 'sess-1': false } as Record<string, boolean>,
  closeEditor: vi.fn(),
};

vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: Object.assign(
    vi.fn((selector?: (state: typeof draftEditorState) => unknown) =>
      selector ? selector(draftEditorState) : draftEditorState),
    {
      getState: () => draftEditorState,
    },
  ),
}));

vi.mock('../../../stores/uiStore', () => ({
  useUIStore: vi.fn(() => ({
    setAdvancedInput: vi.fn(),
  })),
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      updateSession: vi.fn(),
    }),
  },
}));

const capabilities: ProviderCapabilities = {
  models: [
    { id: 'sonnet', label: 'Claude Sonnet' },
  ],
  modes: [
    { id: 'default', label: 'Agent', description: 'Default agent mode' },
  ],
  tools: [],
};

const baseProps = {
  sessionId: 'sess-1',
  currentSession: {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Test Session',
    isReadOnly: false,
    type: 'regular',
    workingDirectory: '/repo',
  } as any,
  currentProject: {
    id: 'proj-1',
    rootPath: '/repo',
  } as any,
  isMobile: true,
  isLoading: false,
  isConnected: true,
  isForcedPlanSession: false,
  mode: 'default',
  modelOverride: 'sonnet',
  permissionOverride: null,
  capabilities,
  commands: [],
  fileReferenceRoot: '/repo',
  sessionRunId: null,
  currentUsage: {
    inputTokens: 0,
    outputTokens: 0,
  },
  currentSystemInfo: null,
  advancedInput: false,
  restoreMessage: null,
  initialDraft: { content: '', attachments: [] },
  queuedMessage: null,
  draftExists: false,
  onSetMode: vi.fn(),
  onSetModelOverride: vi.fn(),
  onSetPermissionOverride: vi.fn(),
  onWorktreeChange: vi.fn(async () => {}),
  onSendMessage: vi.fn(),
  onCancelRun: vi.fn(),
  onCommand: vi.fn(async () => {}),
};

describe('ChatInputArea mobile selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginStoreState.disabledBuiltinPanels = [];
    terminalStoreState.drawerOpen = {};
    terminalStoreState.terminals = {};
    bottomPanelState.activeTab = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('shows mode/model selectors and terminal tool on mobile when capabilities and remote terminal are available', () => {
    serverStoreState.activeServerSupports.mockImplementation((feature: string) => feature === 'remoteTerminal');

    render(<ChatInputArea {...baseProps} />);

    expect(screen.getByLabelText('Mode: Agent')).toBeTruthy();
    expect(screen.getByTitle('Claude Sonnet')).toBeTruthy();

    fireEvent.click(screen.getByTitle('More tools'));
    expect(screen.getByText('Terminal')).toBeTruthy();
  });

  it('hides selectors and terminal tool when capabilities/features are unavailable', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);
    pluginStoreState.disabledBuiltinPanels = ['draft', 'file-viewer'];

    render(<ChatInputArea {...baseProps} capabilities={null} modelOverride={null} />);

    expect(screen.queryByLabelText('Mode: Agent')).toBeNull();
    expect(screen.queryByTitle('Claude Sonnet')).toBeNull();
    expect(screen.queryByTitle('More tools')).toBeNull();
  });
});
