import { describe, expect, it } from 'vitest';
import { resolveStandaloneWindowRoute } from './windowRoutes';

function routeId(query: string): string | null {
  return resolveStandaloneWindowRoute(new URLSearchParams(query))?.id ?? null;
}

describe('resolveStandaloneWindowRoute', () => {
  it('matches file viewer only when file path and project root are present', () => {
    expect(routeId('fileViewer=/tmp/a.ts&projectRoot=/tmp')).toBe('file-viewer');
    expect(routeId('fileViewer=/tmp/a.ts')).toBeNull();
  });

  it('matches standalone window route params in priority order', () => {
    expect(routeId('automationWindow=1')).toBe('automation');
    expect(routeId('projectDashboard=project-1')).toBe('project-dashboard');
    expect(routeId('workflowEditor=project-1')).toBe('workflow-editor');
    expect(routeId('aiReviewLogs=run-1')).toBe('ai-review-logs');
    expect(routeId('sessionWindow=session-1')).toBe('session-chat');
    expect(routeId('draftWindow=session-1')).toBe('draft');
    expect(routeId('terminalWindow=terminal-1')).toBe('terminal');
    expect(routeId('claudiaBall=1')).toBe('claudia-ball');
    expect(routeId('notchWindow=1')).toBe('notch');
    expect(routeId('claudiaChat=1')).toBe('claudia-chat');
    expect(routeId('windowManager=1')).toBe('window-manager');
    expect(routeId('pluginWindow=plugin-1')).toBe('plugin');
  });
});
