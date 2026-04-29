import { useState, useEffect, useRef, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { getBaseUrl, getAuthHeaders } from '../../services/api';
import { openFile, openFileAndroid, isAndroid } from '../../services/fileDownload';
import type { FilePushItem } from '../../stores/filePushStore';
import { useAndroidBack } from '../../hooks/useAndroidBack';

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

type PreviewType = 'image' | 'video' | 'audio' | 'text' | 'markdown' | 'unsupported';

/** Text-like MIME types that can be syntax-highlighted */
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];

const TEXT_EXTENSIONS = new Set([
  ...Object.keys(EXT_TO_LANG),
  'txt', 'log', 'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc',
]);

function getFileExtension(fileName: string): string {
  const name = fileName.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

function detectLanguage(fileName: string): string {
  const name = fileName.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return 'docker';
  if (name === 'makefile') return 'makefile';
  const ext = getFileExtension(name);
  return EXT_TO_LANG[ext] || 'text';
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);

export function getPreviewType(mimeType: string, fileName: string): PreviewType {
  const ext = getFileExtension(fileName);

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';

  // Markdown
  if (mimeType === 'text/markdown' || ext === 'md') return 'markdown';

  // Text / code files
  if (TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return 'text';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  return 'unsupported';
}

export function isPreviewable(mimeType: string, fileName: string): boolean {
  return getPreviewType(mimeType, fileName) !== 'unsupported';
}

interface FilePreviewModalProps {
  item: FilePushItem;
  onClose: () => void;
}

export function FilePreviewModal({ item, onClose }: FilePreviewModalProps) {
  const { resolvedTheme } = useTheme();
  const dark = isDarkTheme(resolvedTheme);
  const previewType = getPreviewType(item.mimeType, item.fileName);

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Android back gesture: close preview (high priority)
  useAndroidBack(onClose, true, 35);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Load file content
  useEffect(() => {
    let cancelled = false;

    async function loadContent() {
      setLoading(true);
      setError(null);

      try {
        const baseUrl = getBaseUrl();
        const authHeaders = getAuthHeaders();
        const resp = await fetch(`${baseUrl}/api/files/${item.fileId}/download`, {
          headers: authHeaders,
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (cancelled) return;

        if (previewType === 'text' || previewType === 'markdown') {
          const text = await resp.text();
          if (!cancelled) setTextContent(text);
        } else {
          // image / video / audio → blob URL
          const blob = await resp.blob();
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            setDataUrl(url);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load file');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadContent();
    return () => {
      cancelled = true;
      if (dataUrl) URL.revokeObjectURL(dataUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.fileId, previewType]);

  const handleOpenExternal = useCallback(() => {
    const path = item.privatePath || item.savedPath;
    if (!path) return;
    if (isAndroid()) {
      openFileAndroid(path, item.mimeType);
    } else {
      openFile(path);
    }
  }, [item]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Always-visible close button for mobile safe area / notch devices */}
      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-20 p-2 rounded-full bg-black/65 text-white border border-white/20 hover:bg-black/80 transition-colors"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        aria-label="Close preview"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 bg-black/60 text-white flex-shrink-0 pr-16"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium truncate">{item.fileName}</span>
        </div>

        <div className="flex items-center gap-2">
          {(item.privatePath || item.savedPath) && (
            <button
              onClick={handleOpenExternal}
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded transition-colors"
            >
              External App
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <div
        className="flex-1 overflow-auto flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && (
          <div className="text-white/60 text-sm">Loading...</div>
        )}

        {error && (
          <div className="text-center text-white/80 p-8">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={handleOpenExternal}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded transition-colors text-sm"
            >
              Open with external app
            </button>
          </div>
        )}

        {!loading && !error && previewType === 'image' && dataUrl && (
          <ImagePreview src={dataUrl} alt={item.fileName} />
        )}

        {!loading && !error && previewType === 'video' && dataUrl && (
          <video
            src={dataUrl}
            controls
            autoPlay={false}
            className="max-w-full max-h-full"
            style={{ outline: 'none' }}
          />
        )}

        {!loading && !error && previewType === 'audio' && dataUrl && (
          <div className="w-full max-w-md px-8">
            <div className="text-center text-white/60 mb-4">
              <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <span className="text-sm">{item.fileName}</span>
            </div>
            <audio src={dataUrl} controls className="w-full" />
          </div>
        )}

        {!loading && !error && previewType === 'text' && textContent !== null && (
          <div className="w-full h-full overflow-auto">
            <SyntaxHighlighter
              language={detectLanguage(item.fileName)}
              style={dark ? oneDark : oneLight}
              showLineNumbers
              customStyle={{
                margin: 0,
                borderRadius: 0,
                minHeight: '100%',
                fontSize: '13px',
              }}
            >
              {textContent}
            </SyntaxHighlighter>
          </div>
        )}

        {!loading && !error && previewType === 'markdown' && textContent !== null && (
          <div className="w-full h-full overflow-auto p-6 max-w-3xl mx-auto">
            <div className={`prose ${dark ? 'prose-invert' : ''} max-w-none`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }) {
                    return (
                      <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                        <pre>{children}</pre>
                      </div>
                    );
                  },
                  table({ children }) {
                    return (
                      <div className="w-full overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                        <table className="w-max min-w-full border-collapse border border-border">
                          {children}
                        </table>
                      </div>
                    );
                  },
                  th({ children }) {
                    return (
                      <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-nowrap">
                        {children}
                      </th>
                    );
                  },
                  td({ children }) {
                    return (
                      <td className="border border-border px-3 py-2 align-top whitespace-nowrap">
                        {children}
                      </td>
                    );
                  },
                }}
              >
                {textContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Zoomable image preview with pinch-to-zoom and drag */
function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.min(Math.max(s * delta, 0.1), 10));
  }, []);

  const handleDoubleClick = useCallback(() => {
    setScale(s => s === 1 ? 2 : 1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPosition(p => ({ x: p.x + dx, y: p.y + dy }));
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain select-none"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
        }}
        draggable={false}
      />
    </div>
  );
}
