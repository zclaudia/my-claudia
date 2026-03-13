import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useAgentStore } from '../../../stores/agentStore';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

// Mock AgentPanel (heavy child)
vi.mock('../AgentPanel', () => ({
  AgentPanel: ({ isMobile, showHeader }: any) => (
    <div data-testid="agent-panel" data-mobile={isMobile} data-show-header={showHeader}>
      AgentPanel mock
    </div>
  ),
}));

// Mock services
vi.mock('../../../services/clientAI', () => ({
  getClientAIConfig: () => ({ model: 'test-model' }),
}));

import { AgentSidePanel } from '../AgentSidePanel';

describe('AgentSidePanel', () => {
  const mockSetExpanded = vi.fn();
  const mockRequestClear = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAgentStore.setState({
      setExpanded: mockSetExpanded,
      requestClear: mockRequestClear,
    } as any);
  });

  it('renders without crashing', () => {
    const { container } = render(<AgentSidePanel />);
    expect(container).toBeTruthy();
  });

  it('renders the header with Agent label', () => {
    const { container } = render(<AgentSidePanel />);
    expect(container.textContent).toContain('Agent');
  });

  it('renders AgentPanel with showHeader=false', () => {
    const { container } = render(<AgentSidePanel />);
    const panel = container.querySelector('[data-testid="agent-panel"]');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-show-header')).toBe('false');
  });

  it('has default width of 400px', () => {
    const { container } = render(<AgentSidePanel />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.width).toBe('400px');
  });

  it('restores saved width from localStorage', () => {
    localStorage.setItem('agent-panel-width', '500');
    const { container } = render(<AgentSidePanel />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.width).toBe('500px');
  });

  it('respects minimum width of 300px', () => {
    localStorage.setItem('agent-panel-width', '100');
    const { container } = render(<AgentSidePanel />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.width).toBe('300px');
  });

  it('calls requestClear when clear button is clicked', () => {
    const { container } = render(<AgentSidePanel />);
    const clearBtn = container.querySelector('button[title="Clear conversation"]');
    if (clearBtn) fireEvent.click(clearBtn);
    expect(mockRequestClear).toHaveBeenCalled();
  });

  it('calls setExpanded(false) when close button is clicked', () => {
    const { container } = render(<AgentSidePanel />);
    const closeBtn = container.querySelector('button[title="Close Agent Panel"]');
    if (closeBtn) fireEvent.click(closeBtn);
    expect(mockSetExpanded).toHaveBeenCalledWith(false);
  });

  it('renders model name in header', () => {
    const { container } = render(<AgentSidePanel />);
    expect(container.textContent).toContain('test-model');
  });

  it('has drag handle', () => {
    const { container } = render(<AgentSidePanel />);
    const dragHandle = container.querySelector('.cursor-col-resize');
    expect(dragHandle).toBeInTheDocument();
  });

  it('has border styling', () => {
    const { container } = render(<AgentSidePanel />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('border-l');
  });
});
