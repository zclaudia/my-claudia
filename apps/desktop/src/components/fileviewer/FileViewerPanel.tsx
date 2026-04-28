import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { Highlight, themes as prismThemes, type PrismTheme, type Token } from 'prism-react-renderer';
import { List, useListRef, type RowComponentProps, type ListImperativeAPI } from 'react-window';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';
import { FileSearchInput } from './FileSearchInput';
import { MarkdownFileContent } from './MarkdownFileContent';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', py: 'python', rs: 'rust',
  go: 'go', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'toml',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', svg: 'xml',
  sql: 'sql', graphql: 'graphql',
  rb: 'ruby', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', m: 'objectivec',
  lua: 'lua', r: 'r', pl: 'perl',
  dockerfile: 'docker', makefile: 'makefile',
};

function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  if (fileName === 'dockerfile') return 'docker';
  if (fileName === 'makefile') return 'makefile';
  const ext = fileName.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'text';
}

interface FileViewerPanelProps {
  projectRoot: string;
}

/** Row height (px) — must match lineHeight below so virtualization aligns rows. */
const ROW_HEIGHT_PX = 20;

type CodeRowExtraProps = {
  tokens: Token[][];
  getLineProps: (input: { line: Token[] }) => { style?: CSSProperties; className?: string };
  getTokenProps: (input: { token: Token }) => {
    style?: CSSProperties;
    className?: string;
    children?: React.ReactNode;
  };
  highlightStart: number | null;
  highlightEnd: number | null;
  lineNumberWidth: string;
};

function CodeRow({
  index,
  style,
  tokens,
  getLineProps,
  getTokenProps,
  highlightStart,
  highlightEnd,
  lineNumberWidth,
}: RowComponentProps<CodeRowExtraProps>) {
  const line = tokens[index];
  if (!line) return null;
  const lineNumber = index + 1;
  const inRange =
    highlightStart != null && highlightEnd != null
      && lineNumber >= highlightStart && lineNumber <= highlightEnd;
  const lineProps = getLineProps({ line });
  const themeBg = (lineProps.style?.backgroundColor as string | undefined) ?? undefined;
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        whiteSpace: 'pre',
        backgroundColor: inRange ? 'rgba(250, 204, 21, 0.2)' : themeBg,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: lineNumberWidth,
          paddingLeft: '0.5rem',
          paddingRight: '0.75rem',
          textAlign: 'right',
          userSelect: 'none',
          opacity: 0.5,
          flexShrink: 0,
        }}
      >
        {lineNumber}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {line.map((token, key) => {
          const tokenProps = getTokenProps({ token });
          return (
            <span key={key} style={tokenProps.style} className={tokenProps.className}>
              {token.content}
            </span>
          );
        })}
      </span>
    </div>
  );
}

interface VirtualizedCodeViewProps {
  content: string;
  language: string;
  theme: PrismTheme;
  highlightStart: number | null;
  highlightEnd: number | null;
  listRef: React.RefObject<ListImperativeAPI>;
}

/**
 * Tokenizes once via Prism and renders only the visible rows via react-window.
 * Bounds main-thread work so even 10k-line files don't block the UI on render
 * (Prism tokenization itself is still synchronous but the DOM cost is constant).
 */
function VirtualizedCodeView({
  content,
  language,
  theme,
  highlightStart,
  highlightEnd,
  listRef,
}: VirtualizedCodeViewProps) {
  const lineCount = useMemo(() => content.split(/\r?\n/).length, [content]);
  const lineNumberWidth = `${Math.max(2, String(lineCount).length) + 2}ch`;

  return (
    <Highlight code={content} language={language} theme={theme}>
      {({ tokens, getLineProps, getTokenProps, style: themeStyle }) => (
        <List<CodeRowExtraProps>
          rowCount={tokens.length}
          rowHeight={ROW_HEIGHT_PX}
          rowComponent={CodeRow}
          rowProps={{
            tokens,
            getLineProps,
            getTokenProps,
            highlightStart,
            highlightEnd,
            lineNumberWidth,
          }}
          listRef={listRef}
          style={{
            ...themeStyle,
            height: '100%',
            width: '100%',
            margin: 0,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            fontSize: '0.75rem',
            lineHeight: `${ROW_HEIGHT_PX}px`,
          }}
          data-testid="code-viewer"
        />
      )}
    </Highlight>
  );
}

function resolveProjectBackendId(projectRoot: string): string | null {
  const projects = useProjectStore.getState().projects;
  const matchingProject = projects.find((project) => project.rootPath === projectRoot);
  if (!matchingProject) return null;
  return useOwnershipStore.getState().getProjectBackendId(matchingProject.id);
}

async function openFileInNewWindow(filePath: string, projectRoot: string) {
  const fileName = filePath.split('/').pop() || filePath;
  const projectName = projectRoot.split('/').pop() || projectRoot;
  const backendId = resolveProjectBackendId(projectRoot);
  const conn = getConnectionParams({ backendId });
  await openPopoutWindow({
    type: 'file-viewer',
    params: { fileViewer: filePath, projectRoot },
    title: buildWindowTitle(fileName, conn.serverName, projectName),
    width: 800,
    height: 600,
    dragDropEnabled: true,
    connectionTarget: { backendId },
  });
}

/** File viewer toolbar actions (search, copy, open in new window / fullscreen) rendered in the shared BottomPanel header */
export function FileViewerActions() {
  const isMobile = useIsMobile();
  const { searchOpen, setSearchOpen, content, filePath, projectRoot, setFullscreen } = useFileViewerStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpand = () => {
    if (!filePath) return;
    if (isDesktopTauri() && projectRoot) {
      openFileInNewWindow(filePath, projectRoot);
    } else {
      setFullscreen(true);
    }
  };

  return (
    <>
      <button
        onClick={() => setSearchOpen(!searchOpen)}
        className={`p-1 rounded hover:bg-secondary flex-shrink-0 ${
          searchOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
        title="Search files (Cmd+P)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      {content && (
        <button
          onClick={handleCopy}
          className={`p-1 rounded flex-shrink-0 ${
            copied ? 'text-green-500' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={copied ? 'Copied!' : 'Copy file content'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {copied ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            )}
          </svg>
        </button>
      )}
      {filePath && !isMobile && (
        <button
          onClick={handleExpand}
          className="p-1 rounded text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
          title={isDesktopTauri() ? 'Open in new window' : 'Fullscreen'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isDesktopTauri() ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}

/** File viewer content (renders inside the shared BottomPanel) */
export function FileViewerPanel({ projectRoot }: FileViewerPanelProps) {
  const {
    filePath, content, loading, error, searchOpen,
    targetLine, targetEndLine, targetNonce,
    openFile, setContent, setError, setSearchOpen,
  } = useFileViewerStore();
  const fileBackendId = resolveProjectBackendId(projectRoot);
  const listRef = useListRef(null);

  const { resolvedTheme } = useTheme();

  // Fetch file content when filePath changes (skip if already cached)
  useEffect(() => {
    if (!filePath || !projectRoot) return;
    // openFile() already populated content from cache — skip fetch
    if (useFileViewerStore.getState().content) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await api.getFileContent({ projectRoot, relativePath: filePath, backendId: fileBackendId });
        if (!cancelled) setContent(result.content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      }
    })();

    return () => { cancelled = true; };
  }, [fileBackendId, filePath, projectRoot, setContent, setError]);

  const handleSearchSelect = (relativePath: string) => {
    openFile(projectRoot, relativePath);
  };

  const lang = filePath ? detectLanguage(filePath) : 'text';
  const codeTheme = isDarkTheme(resolvedTheme) ? prismThemes.oneDark : prismThemes.oneLight;
  const isMarkdown = lang === 'markdown';
  const highlightStart = targetLine ?? null;
  const highlightEnd = targetEndLine ?? targetLine ?? null;

  // Scroll the virtualized list to the target line when one is set / changed.
  useEffect(() => {
    if (!highlightStart || isMarkdown) return;
    if (loading || !content) return;
    // Defer one tick so Highlight has already produced tokens by the time
    // the list responds to scrollToRow.
    const id = window.setTimeout(() => {
      try {
        listRef.current?.scrollToRow({
          index: Math.max(0, highlightStart - 1),
          align: 'center',
          behavior: 'auto',
        });
      } catch {
        // Out-of-range can happen during transitions; ignore safely.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [highlightStart, content, loading, isMarkdown, targetNonce, listRef]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* File path indicator */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border flex-shrink-0 min-w-0">
        <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-mono text-muted-foreground truncate" title={filePath || ''}>
          {filePath || 'No file selected'}
        </span>
      </div>

      {/* Search input */}
      {searchOpen && (
        <FileSearchInput
          projectRoot={projectRoot}
          backendId={fileBackendId}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-destructive text-sm px-4 text-center">
            {error}
          </div>
        )}
        {content && !loading && (
          isMarkdown ? (
            <div className="h-full overflow-auto">
              <MarkdownFileContent content={content} />
            </div>
          ) : (
            <VirtualizedCodeView
              content={content}
              language={lang}
              theme={codeTheme}
              highlightStart={highlightStart}
              highlightEnd={highlightEnd}
              listRef={listRef}
            />
          )
        )}
        {!filePath && !loading && !searchOpen && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
            <span>Click a <span className="font-mono text-primary">@file</span> reference to view</span>
            <span className="text-xs">or press the search button to find files</span>
          </div>
        )}
      </div>
    </div>
  );
}
