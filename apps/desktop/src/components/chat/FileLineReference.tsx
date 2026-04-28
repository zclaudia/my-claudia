import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useToastStore } from '../../stores/toastStore';
import * as api from '../../services/api';

/**
 * Matches inline-code content of the form `path/to/file.ext:N` or
 * `name.ext:N-M` (the entire string must match — no extra text).
 */
export const FILE_LINE_REF_REGEX = /^([\w\-./]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?$/;

/**
 * Matches inline-code content that looks like a concrete file reference:
 * `path/to/file.ext`, `path/to/file.ext:N`, or `name.ext:N-M`.
 */
export const INLINE_FILE_REF_REGEX = /^([\w\-./]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$/;

export interface ParsedFileLineRef {
  pathOrName: string;
  start: number;
  end?: number;
}

interface ParsedInlineFileRef {
  pathOrName: string;
  start?: number;
  end?: number;
}

function parseInlineFileRef(text: string): ParsedInlineFileRef | null {
  const match = INLINE_FILE_REF_REGEX.exec(text.trim());
  if (!match) return null;
  const [, pathOrName, startStr, endStr] = match;
  const start = startStr ? parseInt(startStr, 10) : undefined;
  const end = endStr ? parseInt(endStr, 10) : undefined;
  if ((start !== undefined && !Number.isFinite(start)) || (end !== undefined && !Number.isFinite(end))) {
    return null;
  }
  return { pathOrName, start, end };
}

export function parseFileLineRef(text: string): ParsedFileLineRef | null {
  const parsed = parseInlineFileRef(text);
  if (!parsed || parsed.start === undefined) return null;
  return { pathOrName: parsed.pathOrName, start: parsed.start, end: parsed.end };
}

interface Props {
  text: string;
  projectRoot?: string;
  backendId?: string | null;
}

/**
 * Renders an inline file/line reference badge — clicking it opens the file in
 * the bottom file-viewer panel and scrolls to the referenced line.
 *
 * Path resolution:
 *  - if `pathOrName` contains "/", treat as project-relative path
 *  - otherwise use listDirectory's fuzzy search and pick the best basename match
 */
export function FileLineReference({ text, projectRoot, backendId }: Props) {
  const openFile = useFileViewerStore((s) => s.openFile);

  const handleClick = async () => {
    const parsed = parseInlineFileRef(text);
    if (!parsed) return;
    if (!projectRoot) {
      useToastStore.getState().add({
        title: 'No project selected',
        message: 'Cannot resolve file reference without an active project.',
        type: 'info',
        icon: 'system',
      });
      return;
    }

    const { pathOrName, start, end } = parsed;
    const openResolved = (relativePath: string) => {
      openFile(projectRoot, relativePath, start, end);
      useBottomPanelStore.getState().setActiveTab('file-viewer');
    };

    if (pathOrName.includes('/')) {
      openResolved(pathOrName);
      return;
    }

    try {
      const result = await api.listDirectory({
        projectRoot,
        backendId: backendId ?? undefined,
        query: pathOrName,
        maxResults: 10,
      });
      const fileEntries = result.entries.filter((e) => e.type === 'file');
      const exact = fileEntries.find((e) => e.name === pathOrName);
      const chosen = exact ?? fileEntries[0];
      if (!chosen) {
        useToastStore.getState().add({
          title: 'File not found',
          message: `Could not find "${pathOrName}" in this project.`,
          type: 'info',
          icon: 'system',
        });
        return;
      }
      openResolved(chosen.path);
    } catch (err) {
      useToastStore.getState().add({
        title: 'Failed to resolve file',
        message: err instanceof Error ? err.message : String(err),
        type: 'error',
        icon: 'error',
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="bg-secondary px-1.5 py-0.5 rounded text-sm text-primary break-all font-mono cursor-pointer hover:bg-secondary/70 hover:underline"
      title={`Open ${text}`}
    >
      {text}
    </button>
  );
}
