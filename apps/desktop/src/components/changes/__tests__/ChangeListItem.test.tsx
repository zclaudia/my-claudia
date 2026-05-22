import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChangeListItem } from '../ChangeListItem';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { useBottomPanelStore } from '../../../stores/bottomPanelStore';
import type { ModifiedEntry } from '../useSessionChanges';

const mockOpenFile = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: (selector: any) => selector({ openFile: mockOpenFile }),
}));

const entry: ModifiedEntry = {
  path: 'src/index.ts',
  absolutePath: '/repo/src/index.ts',
  toolCounts: { Edit: 1 },
  groups: [{
    sinceUserMessageId: 'u1',
    sinceUserMessagePreview: 'change file',
    sinceUserMessageTimestamp: 100,
    fragments: [],
  }],
  lastTimestamp: 110,
};

describe('ChangeListItem', () => {
  beforeEach(() => {
    mockOpenFile.mockClear();
    usePluginStore.setState({
      panels: [{
        id: 'file-viewer',
        pluginId: 'com.claudia.file-viewer',
        type: 'panel',
        label: 'File',
        component: () => null,
        visible: true,
      }],
      panelPlacements: { 'file-viewer': 'right' },
    });
    useRightSidebarStore.setState({ activeTab: 'session-changes' });
    useBottomPanelStore.setState({ activeTab: '' });
  });

  it('opens the file and activates the file viewer panel', () => {
    render(
      <ChangeListItem
        entry={entry}
        projectRoot="/repo"
        expanded={false}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Open in File Viewer'));

    expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/index.ts');
    expect(useRightSidebarStore.getState().activeTab).toBe('file-viewer');
  });
});
