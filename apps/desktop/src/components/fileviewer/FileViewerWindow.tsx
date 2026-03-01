import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import * as api from '../../services/api';

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

interface FileViewerWindowProps {
  filePath: string;
  projectRoot: string;
  onClose?: () => void;  // When provided, shows a back/close button (e.g. mobile fullscreen overlay)
  /** When rendered in a standalone window, pass the server URL to fetch directly */
  serverUrl?: string;
  authToken?: string;
}

/** Standalone file viewer rendered in a separate Tauri window or fullscreen overlay */
export function FileViewerWindow({ filePath, projectRoot, onClose, serverUrl, authToken }: FileViewerWindowProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let fileContent: string;
        if (serverUrl) {
          // Direct fetch for standalone windows (no ConnectionProvider available)
          const qp = new URLSearchParams({ projectRoot, relativePath: filePath });
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (authToken) headers['Authorization'] = authToken;
          const resp = await fetch(`${serverUrl}/api/files/content?${qp}`, { headers });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const json = await resp.json();
          if (!json.success) throw new Error(json.error?.message || 'Failed to load');
          fileContent = json.data.content;
        } else {
          const result = await api.getFileContent({ projectRoot, relativePath: filePath });
          fileContent = result.content;
        }
        if (!cancelled) {
          setContent(fileContent);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, projectRoot, serverUrl, authToken]);

  const lang = detectLanguage(filePath);
  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* File path header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border flex-shrink-0 bg-card" data-tauri-drag-region>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 -ml-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-mono text-muted-foreground truncate" title={filePath}>
          {filePath}
        </span>
      </div>

      {/* Content */}
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
              fontSize: '0.8rem',
              lineHeight: '1.4rem',
            }}
            lineNumberStyle={{
              minWidth: '3.5em',
              paddingRight: '1em',
              textAlign: 'right',
              userSelect: 'none',
              opacity: 0.5,
            }}
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
