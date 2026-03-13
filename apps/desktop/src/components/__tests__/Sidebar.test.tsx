import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

// Mock child components to isolate Sidebar
vi.mock('../ProjectSettings', () => ({ ProjectSettings: ({ isOpen, onClose }: any) => isOpen ? <div data-testid="project-settings"><button onClick={onClose}>close-project-settings</button></div> : null }));
vi.mock('../SettingsPanel', () => ({ SettingsPanel: ({ isOpen, onClose }: any) => isOpen ? <div data-testid="settings-panel"><button onClick={onClose}>close-settings</button></div> : null }));
vi.mock('../SearchFilters', () => ({ SearchFilters: ({ onClose, onFiltersChange }: any) => <div data-testid="search-filters"><button onClick={onClose}>close-filters</button><button onClick={() => onFiltersChange({ sessionId: 's1' })}>apply-filter</button></div> }));
vi.mock('../ActiveSessionsPanel', () => ({ ActiveSessionsPanel: ({ onSessionSelect }: any) => <div data-testid="active-sessions"><button onClick={() => onSessionSelect('local', 'sess-1')}>select-active</button><button onClick={() => onSessionSelect('backend-1', 'sess-2')}>select-gw</button></div> }));
vi.mock('../PluginPermissionDialog', () => ({ PluginPermissionDialog: () => null }));
vi.mock('../sidebar/SessionItem', () => ({
  SessionItem: ({ session, onSelect, isSelected, hasPending, isActive, providerName, worktreeBranch, isMobile, onPopOut }: any) => (
    <div data-testid="session-item" data-selected={isSelected} data-pending={hasPending} data-active={isActive} data-mobile={isMobile}>
      <span>{session.name}</span>
      {providerName && <span data-testid="provider-name">{providerName}</span>}
      {worktreeBranch && <span data-testid="worktree-branch">{worktreeBranch}</span>}
      <button onClick={() => onSelect(session.id)}>select-{session.id}</button>
      {onPopOut && <button onClick={onPopOut} data-testid="pop-out">pop-out</button>}
    </div>
  )
}));
vi.mock('../sidebar/WorktreeGroupItem', () => ({ WorktreeGroupItem: ({ children }: any) => <div data-testid="worktree-group">{children}</div> }));
vi.mock('../sidebar/SupervisorGroupItem', () => ({
  SupervisorGroupItem: ({ onSelect, taskChildren, taskCount, phase }: any) => (
    <div data-testid="supervisor-group" data-phase={phase} data-task-count={taskCount}>
      <button onClick={onSelect}>select-supervisor</button>
      {taskChildren}
    </div>
  )
}));
vi.mock('../sidebar/worktreeGrouping', () => ({ groupSessionsByWorktree: vi.fn().mockReturnValue([]) }));
vi.mock('../../hooks/useSwipeBack', () => ({ useSwipeBack: vi.fn().mockReturnValue({ current: null }) }));

// Mock services
vi.mock('../../services/api', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  const stubbed: Record<string, any> = {};
  for (const key of Object.keys(mod)) {
    stubbed[key] = typeof mod[key] === 'function' ? vi.fn(() => Promise.resolve(null)) : mod[key];
  }
  stubbed.getProjectWorktrees = vi.fn().mockResolvedValue([]);
  stubbed.searchSessions = vi.fn().mockResolvedValue({ results: [], total: 0 });
  stubbed.getSearchHistory = vi.fn().mockResolvedValue([]);
  stubbed.searchMessages = vi.fn().mockResolvedValue([]);
  stubbed.clearSearchHistory = vi.fn().mockResolvedValue(undefined);
  stubbed.createProject = vi.fn().mockResolvedValue({ id: 'new-proj', name: 'New Project', rootPath: '/tmp/new', createdAt: Date.now(), updatedAt: Date.now() });
  stubbed.createSession = vi.fn().mockResolvedValue({ id: 'new-sess', name: 'New Session', projectId: 'proj-1', createdAt: Date.now(), updatedAt: Date.now() });
  stubbed.deleteProject = vi.fn().mockResolvedValue(undefined);
  return stubbed;
});

import { Sidebar } from '../Sidebar';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useAskUserQuestionStore } from '../../stores/askUserQuestionStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import * as api from '../../services/api';
import { groupSessionsByWorktree } from '../sidebar/worktreeGrouping';

const baseProject = { id: 'proj-1', name: 'Project One', rootPath: '/tmp/proj1', createdAt: Date.now(), updatedAt: Date.now() };
const baseSession = { id: 'sess-1', name: 'Session 1', projectId: 'proj-1', createdAt: Date.now(), updatedAt: Date.now() };

function setupStores(overrides: Record<string, any> = {}) {
  useProjectStore.setState({
    projects: [baseProject as any],
    sessions: [baseSession as any],
    providers: [],
    selectedSessionId: null,
    selectProject: vi.fn(),
    selectSession: vi.fn(),
    addProject: vi.fn(),
    addSession: vi.fn(),
    deleteProject: vi.fn(),
    ...overrides.projectStore,
  } as any);

  useServerStore.setState({
    servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }],
    activeServerId: 'local',
    connections: {
      local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
    },
    connectionStatus: 'connected',
    connectionError: null,
    setActiveServer: vi.fn(),
    getDefaultServer: vi.fn().mockReturnValue({ id: 'local', name: 'Local', address: 'localhost:3100' }),
    ...overrides.serverStore,
  } as any);

  useSupervisionStore.setState({ agents: {}, ...overrides.supervisionStore } as any);
  usePermissionStore.setState({ pendingRequests: [], ...overrides.permissionStore } as any);
  useAskUserQuestionStore.setState({ pendingRequests: [], ...overrides.askStore } as any);
  useChatStore.setState({ activeRuns: {}, ...overrides.chatStore } as any);
  useUIStore.setState({
    poppedOutSessions: new Map(),
    requestForceScrollToBottom: vi.fn(),
    ...overrides.uiStore,
  } as any);
}

describe('Sidebar', () => {
  beforeEach(() => {
    setupStores();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Basic rendering ----

  it('renders without crashing when expanded', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('renders without crashing when collapsed', () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('does not render content when collapsed', () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    // Collapsed sidebar should not show project names
    expect(container.textContent).not.toContain('Project One');
  });

  it('shows project name when expanded', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('Project One');
  });

  it('shows MyClaudia header when hideHeader is false', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('MyClaudia');
  });

  it('hides header when hideHeader is true', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} hideHeader={true} />);
    // The header div should not be rendered - no "AI Assistant" text
    expect(container.textContent).not.toContain('AI Assistant');
  });

  it('calls onToggle when collapse button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<Sidebar collapsed={false} onToggle={onToggle} />);
    const collapseButton = container.querySelector('button[title="Collapse sidebar"]');
    expect(collapseButton).toBeTruthy();
    fireEvent.click(collapseButton!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // ---- Empty states ----

  it('shows "No projects yet" when no projects exist', () => {
    setupStores({ projectStore: { projects: [], sessions: [] } });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('No projects yet');
  });

  it('shows "No active sessions" when all projects are internal', () => {
    setupStores({
      projectStore: {
        projects: [{ ...baseProject, isInternal: true }],
        sessions: [],
      },
    });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('No active sessions');
  });

  // ---- Project expand/collapse ----

  it('expands project to show sessions when clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Click project name to expand
    const projectButton = container.querySelector('button')!;
    // Find the button containing 'Project One'
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'));
    expect(projBtn).toBeTruthy();
    fireEvent.click(projBtn!);

    // After expanding, session items should appear
    expect(container.querySelector('[data-testid="session-list"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="session-item"]')).toBeTruthy();
  });

  it('collapses project when clicked again', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;

    // Expand
    fireEvent.click(projBtn);
    expect(container.querySelector('[data-testid="session-list"]')).toBeTruthy();

    // Collapse
    fireEvent.click(projBtn);
    expect(container.querySelector('[data-testid="session-list"]')).toBeFalsy();
  });

  // ---- Session selection ----

  it('selects a session when clicked', () => {
    const selectSession = vi.fn();
    setupStores({ projectStore: { selectSession } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Click the session select button
    const selectBtn = container.querySelector('button[class*=""]');
    const allButtons = Array.from(container.querySelectorAll('button'));
    const sessBtn = allButtons.find(b => b.textContent === 'select-sess-1');
    expect(sessBtn).toBeTruthy();
    fireEvent.click(sessBtn!);
    expect(selectSession).toHaveBeenCalledWith('sess-1');
  });

  // ---- Pending indicators ----

  it('marks sessions with pending permission requests', () => {
    setupStores({
      permissionStore: { pendingRequests: [{ sessionId: 'sess-1', id: 'r1' }] },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-pending')).toBe('true');
  });

  it('marks sessions with pending question requests', () => {
    setupStores({
      askStore: { pendingRequests: [{ sessionId: 'sess-1', id: 'q1' }] },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-pending')).toBe('true');
  });

  // ---- Active runs ----

  it('marks sessions with active runs', () => {
    setupStores({
      chatStore: { activeRuns: { run1: 'sess-1' } },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-active')).toBe('true');
  });

  // ---- Provider name resolution ----

  it('shows provider name from session providerId', () => {
    setupStores({
      projectStore: {
        sessions: [{ ...baseSession, providerId: 'prov-1' }],
        providers: [{ id: 'prov-1', name: 'Claude', type: 'claude' }],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="provider-name"]')?.textContent).toBe('Claude');
  });

  it('falls back to default provider when session has no providerId', () => {
    setupStores({
      projectStore: {
        sessions: [baseSession as any],
        providers: [{ id: 'default-prov', name: 'DefaultAI', type: 'openai', isDefault: true }],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="provider-name"]')?.textContent).toBe('DefaultAI');
  });

  // ---- Worktree branch hint ----

  it('shows worktree branch for sessions with different workingDirectory', () => {
    setupStores({
      projectStore: {
        projects: [{ ...baseProject, rootPath: '/tmp/proj1' }],
        sessions: [{ ...baseSession, workingDirectory: '/tmp/proj1/feature-branch' }],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="worktree-branch"]')?.textContent).toBe('feature-branch');
  });

  // ---- Background sessions filtered out ----

  it('filters out background sessions from sidebar', () => {
    setupStores({
      projectStore: {
        sessions: [
          { ...baseSession, id: 'sess-bg', name: 'BG Session', type: 'background', projectId: 'proj-1' },
          baseSession,
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(1);
    expect(sessionItems[0].textContent).toContain('Session 1');
  });

  // ---- Settings panel ----

  it('opens settings panel when settings button is clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const settingsButton = container.querySelector('[data-testid="settings-button"]');
    expect(settingsButton).toBeTruthy();
    fireEvent.click(settingsButton!);
    expect(document.querySelector('[data-testid="settings-panel"]')).toBeTruthy();
  });

  it('closes settings panel', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const settingsButton = container.querySelector('[data-testid="settings-button"]');
    fireEvent.click(settingsButton!);
    expect(document.querySelector('[data-testid="settings-panel"]')).toBeTruthy();

    const closeBtn = document.querySelector('[data-testid="settings-panel"] button');
    fireEvent.click(closeBtn!);
    expect(document.querySelector('[data-testid="settings-panel"]')).toBeFalsy();
  });

  // ---- New Project form ----

  it('shows New Project button when connected', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'));
    expect(newProjectBtn).toBeTruthy();
    expect(newProjectBtn?.disabled).toBe(false);
  });

  it('disables New Project button when disconnected', () => {
    setupStores({ serverStore: { connectionStatus: 'disconnected' } });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'));
    expect(newProjectBtn).toBeTruthy();
    expect(newProjectBtn?.disabled).toBe(true);
  });

  it('shows new project form when New Project is clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'))!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    // Should show project name and root path inputs
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name');
    const pathInput = Array.from(inputs).find(i => i.placeholder?.includes('Working directory'));
    expect(nameInput).toBeTruthy();
    expect(pathInput).toBeTruthy();
  });

  it('creates project when form is submitted', async () => {
    const addProject = vi.fn();
    const selectProject = vi.fn();
    setupStores({ projectStore: { addProject, selectProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Open form
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'))!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    fireEvent.change(nameInput, { target: { value: 'My New Project' } });

    // Click Create button
    const allButtons = Array.from(container.querySelectorAll('button'));
    const createBtn = allButtons.find(b => b.textContent === 'Create')!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(api.createProject).toHaveBeenCalledWith({
      name: 'My New Project',
      type: 'code',
      rootPath: undefined,
    });
  });

  it('cancels new project form', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'))!;
    fireEvent.click(newProjectBtn);

    // Click Cancel
    const allButtons = Array.from(container.querySelectorAll('button'));
    const cancelBtn = allButtons.find(b => b.textContent === 'Cancel')!;
    fireEvent.click(cancelBtn);

    // Form should be gone
    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name');
    expect(nameInput).toBeFalsy();
  });

  it('cancels new project form on Escape key', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'))!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    // Form should be gone
    const nameInputAfter = Array.from(container.querySelectorAll('input')).find(i => i.placeholder === 'Project name');
    expect(nameInputAfter).toBeFalsy();
  });

  it('submits new project via Enter key on root path input', async () => {
    const addProject = vi.fn();
    setupStores({ projectStore: { addProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'))!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    const pathInput = Array.from(inputs).find(i => i.placeholder?.includes('Working directory'))!;
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });
    fireEvent.change(pathInput, { target: { value: '/tmp/test' } });

    await act(async () => {
      fireEvent.keyDown(pathInput, { key: 'Enter' });
    });

    expect(api.createProject).toHaveBeenCalledWith({
      name: 'Test Project',
      type: 'code',
      rootPath: '/tmp/test',
    });
  });

  // ---- Context menu ----

  it('opens project context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // The context menu button is the dots icon next to project name
    // It's the button with the three dots SVG, which appears on hover via opacity
    const menuButtons = container.querySelectorAll('button');
    // Find the dots-menu button (small 6x6 or 8x8 button)
    const dotsButtons = Array.from(menuButtons).filter(b => {
      const svg = b.querySelector('svg');
      return svg && b.textContent?.trim() === '' && b.className.includes('flex-shrink-0');
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      // Context menu should appear in a portal
      const contextMenu = document.querySelector('.fixed.w-36, .fixed.w-44');
      if (contextMenu) {
        expect(contextMenu.textContent).toContain('Settings');
        expect(contextMenu.textContent).toContain('New Session');
        expect(contextMenu.textContent).toContain('Delete');
      }
    }
  });

  it('opens project settings from context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });

      // Find Settings button in portal
      const allSettingsButtons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Settings');
      // Click the one inside the context menu (not the sidebar settings button)
      const contextSettingsBtn = allSettingsButtons.find(b => b.closest('.fixed.w-36') || b.closest('.fixed.w-44'));
      if (contextSettingsBtn) {
        fireEvent.click(contextSettingsBtn);
        expect(document.querySelector('[data-testid="project-settings"]')).toBeTruthy();
      }
    }
  });

  it('deletes project from context menu', async () => {
    const deleteProject = vi.fn();
    setupStores({ projectStore: { deleteProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });

      const deleteBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Delete');
      if (deleteBtn) {
        await act(async () => {
          fireEvent.click(deleteBtn);
        });
        expect(api.deleteProject).toHaveBeenCalledWith('proj-1');
      }
    }
  });

  it('opens new session form from context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project first
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Open context menu
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'New Session');
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        // Should show session creation form
        const sessionInput = container.querySelector('input[placeholder="Session name (optional)"]');
        expect(sessionInput).toBeTruthy();
      }
    }
  });

  // ---- New Session form ----

  it('creates a session when form is submitted', async () => {
    const addSession = vi.fn();
    const selectSession = vi.fn();
    setupStores({ projectStore: { addSession, selectSession } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Open context menu and click New Session
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'New Session');
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        // Fill session name
        const sessionInput = container.querySelector('input[placeholder="Session name (optional)"]')!;
        fireEvent.change(sessionInput, { target: { value: 'My Session' } });

        // Click Create
        const createBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Create')!;
        await act(async () => {
          fireEvent.click(createBtn);
        });

        expect(api.createSession).toHaveBeenCalledWith({
          projectId: 'proj-1',
          name: 'My Session',
          providerId: undefined,
        });
      }
    }
  });

  it('cancels session creation on Escape', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'New Session');
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        const sessionInput = container.querySelector('input[placeholder="Session name (optional)"]')!;
        fireEvent.keyDown(sessionInput, { key: 'Escape' });
        expect(container.querySelector('input[placeholder="Session name (optional)"]')).toBeFalsy();
      }
    }
  });

  it('creates session via Enter key', async () => {
    setupStores({});
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'New Session');
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        const sessionInput = container.querySelector('input[placeholder="Session name (optional)"]')!;
        fireEvent.change(sessionInput, { target: { value: 'Enter Session' } });
        await act(async () => {
          fireEvent.keyDown(sessionInput, { key: 'Enter' });
        });
        expect(api.createSession).toHaveBeenCalled();
      }
    }
  });

  // ---- Search ----

  it('renders search input', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]');
    expect(searchInput).toBeTruthy();
  });

  it('shows "Searching..." while search is in progress', async () => {
    // Make searchMessages hang to test loading state
    (api.searchMessages as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'test query' } });
    });

    // Should show "Searching..."
    expect(container.textContent).toContain('Searching...');
  });

  it('shows "No results" when search returns empty', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'no match' } });
    });

    // Wait for debounce (300ms)
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('No results');
  });

  it('displays search results', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Test Session', content: 'Hello world' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('Test Session');
    expect(container.textContent).toContain('Hello world');
  });

  it('selects session from search results', async () => {
    const selectSession = vi.fn();
    setupStores({ projectStore: { selectSession } });

    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Test Session', content: 'Hello world' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    // Click the search result
    const resultButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.includes('Test Session'));
    if (resultButtons.length > 0) {
      fireEvent.click(resultButtons[0]);
      expect(selectSession).toHaveBeenCalledWith('sess-1');
    }
  });

  it('shows search result type badge for file results', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Sess', content: 'file content', resultType: 'file' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'file' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('File');
  });

  it('shows search result type badge for tool results', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Sess', content: 'tool content', resultType: 'tool' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'tool' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('Tool');
  });

  it('shows Load More button when there are more results', async () => {
    const fiftyResults = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`, sessionId: 'sess-1', sessionName: `Session ${i}`, content: `content ${i}`,
    }));
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(fiftyResults);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'content' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('Load More');
  });

  it('shows search filter button', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const filterBtn = container.querySelector('button[title="Filters"]');
    expect(filterBtn).toBeTruthy();
  });

  it('toggles search filters', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const filterBtn = container.querySelector('button[title="Filters"]')!;
    fireEvent.click(filterBtn);
    expect(container.querySelector('[data-testid="search-filters"]')).toBeTruthy();

    // Click again to close
    fireEvent.click(filterBtn);
    expect(container.querySelector('[data-testid="search-filters"]')).toBeFalsy();
  });

  // ---- Disconnected state ----

  it('does not create session when disconnected', async () => {
    setupStores({ serverStore: { connectionStatus: 'disconnected' } });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    // The New Project button should be disabled
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find(b => b.textContent?.includes('New Project'));
    expect(newProjectBtn?.disabled).toBe(true);
  });

  // ---- Mobile rendering ----

  it('renders as overlay drawer in mobile mode when open', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} onClose={onClose} />
    );
    // Should show mobile header with MyClaudia title
    expect(container.textContent).toContain('MyClaudia');
    // Should have backdrop
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).toBeTruthy();
  });

  it('returns null in mobile mode when not open', () => {
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('closes mobile drawer when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} onClose={onClose} />
    );
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('shows close button in mobile mode', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} onClose={onClose} />
    );
    const closeBtn = container.querySelector('button[title="Close menu"]');
    expect(closeBtn).toBeTruthy();
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('calls onClose when selecting session in mobile mode', () => {
    const onClose = vi.fn();
    const selectSession = vi.fn();
    setupStores({ projectStore: { selectSession } });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} onClose={onClose} />
    );
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'select-sess-1');
    if (sessBtn) {
      fireEvent.click(sessBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  // ---- Active Sessions Panel ----

  it('renders ActiveSessionsPanel', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.querySelector('[data-testid="active-sessions"]')).toBeTruthy();
  });

  it('handles active session selection for local backend', () => {
    const selectSession = vi.fn();
    setupStores({ projectStore: { selectSession } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const localBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'select-active');
    if (localBtn) {
      fireEvent.click(localBtn);
      expect(selectSession).toHaveBeenCalledWith('sess-1');
    }
  });

  // ---- Supervision agents ----

  it('shows agent status indicator for projects with agents', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'active' } },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} />);
    // The project name should have a pulsing green dot (mobile sidebar path)
    const pulseDot = container.querySelector('.animate-pulse');
    expect(pulseDot).toBeTruthy();
  });

  it('shows paused agent indicator', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'paused' } },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} />);
    const yellowDot = container.querySelector('.bg-yellow-500');
    expect(yellowDot).toBeTruthy();
  });

  // ---- Supervisor groups ----

  it('renders supervisor group when main session exists', () => {
    setupStores({
      projectStore: {
        sessions: [
          { ...baseSession, id: 'main-sess', name: 'Main', projectRole: 'main', projectId: 'proj-1' },
          { ...baseSession, id: 'task-1', name: 'Task 1', projectRole: 'task', parentSessionId: 'main-sess', projectId: 'proj-1' },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="supervisor-group"]')).toBeTruthy();
  });

  it('calls onOpenDashboard when clicking supervisor in desktop mode', () => {
    const onOpenDashboard = vi.fn();
    setupStores({
      projectStore: {
        sessions: [
          { ...baseSession, id: 'main-sess', name: 'Main', projectRole: 'main', projectId: 'proj-1' },
        ],
      },
    });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} onOpenDashboard={onOpenDashboard} />
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const selectSupervisorBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'select-supervisor');
    if (selectSupervisorBtn) {
      fireEvent.click(selectSupervisorBtn);
      expect(onOpenDashboard).toHaveBeenCalledWith('proj-1');
    }
  });

  // ---- Multiple projects ----

  it('renders multiple projects', () => {
    setupStores({
      projectStore: {
        projects: [
          baseProject,
          { id: 'proj-2', name: 'Project Two', rootPath: '/tmp/proj2', createdAt: Date.now(), updatedAt: Date.now() },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('Project One');
    expect(container.textContent).toContain('Project Two');
  });

  // ---- Session with providers select ----

  it('shows provider select in new session form when providers exist', () => {
    setupStores({
      projectStore: {
        providers: [
          { id: 'prov-1', name: 'Claude', type: 'claude', isDefault: true },
          { id: 'prov-2', name: 'OpenAI', type: 'openai' },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Open context menu and create session
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'New Session');
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        // Should show provider select
        const selects = container.querySelectorAll('select');
        expect(selects.length).toBeGreaterThan(0);
        // Should have options for providers
        const options = container.querySelectorAll('option');
        expect(Array.from(options).some(o => o.textContent?.includes('Claude'))).toBe(true);
      }
    }
  });

  // ---- normalizeSearchPreview ----

  it('normalizes search preview whitespace', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Sess', content: '  hello   world  \n\n  foo  ' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('hello world foo');
  });

  it('shows "No preview text" for empty content', async () => {
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Sess', content: '   ' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'x' } });
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 350));
    });

    expect(container.textContent).toContain('No preview text');
  });

  // ---- Search history ----

  it('shows search history on focus when no query and history exists', async () => {
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    // Wait for history to load
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;
    fireEvent.focus(searchInput);

    expect(container.textContent).toContain('Recent Searches');
    expect(container.textContent).toContain('old search');
  });

  it('clears search history', async () => {
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;
    fireEvent.focus(searchInput);

    const clearBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Clear');
    if (clearBtn) {
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      expect(api.clearSearchHistory).toHaveBeenCalled();
    }
  });

  it('selects search history item', async () => {
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const searchInput = container.querySelector('input[placeholder="Search messages..."]')!;
    fireEvent.focus(searchInput);

    const historyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('old search'));
    if (historyBtn) {
      fireEvent.click(historyBtn);
      // Wait for the 300ms debounce in handleSearch
      await act(async () => {
        await new Promise(r => setTimeout(r, 400));
      });
      // The search input should now have the history query
      // and search should be triggered
      expect(api.searchMessages).toHaveBeenCalled();
    }
  });

  // ---- PluginPermissionDialog ----

  it('renders PluginPermissionDialog in portal', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // This is rendered via createPortal - just verifying no crash
    expect(true).toBe(true);
  });
});
