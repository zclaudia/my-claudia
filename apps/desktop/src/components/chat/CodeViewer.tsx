import { useState, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../../contexts/ThemeContext';

interface CodeViewerProps {
  content: string;
  filePath?: string;
  language?: string;
  maxLines?: number;
  showLineNumbers?: boolean;
}

const DEFAULT_MAX_LINES = 20;

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

function detectLanguage(filePath?: string): string {
  if (!filePath) return 'text';
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  // Handle special filenames (Dockerfile, Makefile, etc.)
  if (fileName === 'dockerfile') return 'docker';
  if (fileName === 'makefile') return 'makefile';
  const ext = fileName.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'text';
}

export function CodeViewer({
  content,
  filePath,
  language,
  maxLines = DEFAULT_MAX_LINES,
  showLineNumbers = true,
}: CodeViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();

  const lang = language || detectLanguage(filePath);
  const codeStyle = resolvedTheme === 'dark' ? oneDark : oneLight;

  const lines = useMemo(() => content.split('\n'), [content]);
  const totalLines = lines.length;
  const needsCollapse = totalLines > maxLines;

  const displayContent = needsCollapse && !isExpanded
    ? lines.slice(0, maxLines).join('\n')
    : content;

  const fileName = filePath ? filePath.split('/').pop() : undefined;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {fileName && (
            <span className="text-xs font-mono text-muted-foreground truncate">
              {fileName}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
            {totalLines} line{totalLines !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 text-xs transition-colors flex-shrink-0 ${
            copied
              ? 'text-success'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Copied</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <SyntaxHighlighter
        style={codeStyle}
        language={lang}
        showLineNumbers={showLineNumbers}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          padding: '0.5rem 0',
          fontSize: '0.75rem',
          lineHeight: '1.25rem',
        }}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          textAlign: 'right',
          userSelect: 'none',
          opacity: 0.5,
        }}
      >
        {displayContent}
      </SyntaxHighlighter>

      {/* Expand/collapse button */}
      {needsCollapse && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground bg-secondary hover:bg-muted active:bg-muted/80 transition-colors text-center border-t border-border"
        >
          {isExpanded
            ? 'Collapse'
            : `Show all ${totalLines} lines`}
        </button>
      )}
    </div>
  );
}
