import { useState, useEffect } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';
import { getBaseUrl, getAuthHeaders } from '../../services/api';
import { FileSearchInput } from './FileSearchInput';

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

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

async function openFileInNewWindow(filePath: string, projectRoot: string) {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `file-viewer-${Date.now()}`;
  const fileName = filePath.split('/').pop() || filePath;

  // Pass the server URL so the new window can fetch without ConnectionProvider
  let serverUrl = '';
  try { serverUrl = getBaseUrl(); } catch { /* no server */ }
  const authHeaders = getAuthHeaders();
  const authToken = (authHeaders as Record<string, string>)['Authorization'] || '';

  const params = new URLSearchParams({ fileViewer: filePath, projectRoot, serverUrl });
  if (authToken) params.set('authToken', authToken);
  const url = `${window.location.origin}${window.location.pathname}?${params}`;
  new WebviewWindow(label, {
    url,
    title: fileName,
    width: 800,
    height: 600,
    center: true,
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
    if (isDesktopTauri && projectRoot) {
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
          title={isDesktopTauri ? 'Open in new window' : 'Fullscreen'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isDesktopTauri ? (
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
    openFile, setContent, setError, setSearchOpen,
  } = useFileViewerStore();

  const { resolvedTheme } = useTheme();

  // Fetch file content when filePath changes (skip if already cached)
  useEffect(() => {
    if (!filePath || !projectRoot) return;
    // openFile() already populated content from cache — skip fetch
    if (useFileViewerStore.getState().content) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await api.getFileContent({ projectRoot, relativePath: filePath });
        if (!cancelled) setContent(result.content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, projectRoot, setContent, setError]);

  const handleSearchSelect = (relativePath: string) => {
    openFile(projectRoot, relativePath);
  };

  const lang = filePath ? detectLanguage(filePath) : 'text';
  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

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
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto">
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
          <SyntaxHighlighter
            style={codeStyle}
            language={lang}
            showLineNumbers
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: '0.5rem 0',
              fontSize: '0.75rem',
              lineHeight: '1.25rem',
            }}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              textAlign: 'right',
              userSelect: 'none',
              opacity: 0.5,
            }}
          >
            {content}
          </SyntaxHighlighter>
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
