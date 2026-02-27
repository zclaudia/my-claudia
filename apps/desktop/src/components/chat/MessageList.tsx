import { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ToolCallList } from './ToolCallItem';
import { FilePushCard } from './FilePushNotification';
import type { MessageWithToolCalls } from '../../stores/chatStore';
import type { FilePushItem } from '../../stores/filePushStore';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { downloadFile } from '../../services/fileUpload';
import type { MessageInput, MessageAttachment } from '@my-claudia/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';

/**
 * Extract <think>...</think> blocks from message content.
 * Returns { thinking, content } where thinking is the extracted text
 * and content is the remaining message without think tags.
 */
function extractThinking(text: string): { thinking: string; content: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const parts: string[] = [];
  let match;
  while ((match = thinkRegex.exec(text)) !== null) {
    parts.push(match[1].trim());
  }
  const content = text.replace(thinkRegex, '').trim();
  return { thinking: parts.join('\n\n'), content };
}

/** Number of preview lines shown when collapsed */
const THINKING_PREVIEW_LINES = 2;

/** Collapsible thinking block with purple accent and content preview */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const lineCount = nonEmptyLines.length;

  // Build preview: first N non-empty lines
  const previewLines = nonEmptyLines.slice(0, THINKING_PREVIEW_LINES);
  const previewText = previewLines.join('\n');
  const hasMore = lineCount > THINKING_PREVIEW_LINES;

  return (
    <div className="mb-2 rounded-lg border border-thinking/30 bg-thinking/5 text-xs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-thinking hover:text-foreground transition-colors"
      >
        {/* Brain icon */}
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 18v-3m0-3v.01M8.5 8A3.5 3.5 0 0 1 12 4.5 3.5 3.5 0 0 1 15.5 8c0 1.5-.8 2.5-2 3.2-.5.3-1 .7-1.2 1.3m-6.2-.6A4.5 4.5 0 0 1 4 8a4 4 0 0 1 2.5-3.7M18 11.9A4.5 4.5 0 0 0 20 8a4 4 0 0 0-2.5-3.7"
          />
        </svg>
        {/* Chevron */}
        <svg
          className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Thinking</span>
        {/* Line count */}
        <span className="text-thinking/50 ml-auto text-[10px]">
          {lineCount} line{lineCount !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Preview (when collapsed) */}
      {!expanded && previewText && (
        <div className="px-3 pb-2 text-muted-foreground italic leading-relaxed line-clamp-2 opacity-70">
          {previewText}
          {hasMore && <span className="text-thinking/40"> ...</span>}
        </div>
      )}

      {/* Full content (when expanded) */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-thinking/10">
          <div className="pt-2 text-muted-foreground whitespace-pre-wrap leading-relaxed italic">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  messages: MessageWithToolCalls[];
  filePushItems?: FilePushItem[];
}

type TimelineEntry =
  | { kind: 'message'; data: MessageWithToolCalls }
  | { kind: 'file_push'; data: FilePushItem };

export function MessageList({ messages, filePushItems }: MessageListProps) {
  if ((!messages || messages.length === 0) && (!filePushItems || filePushItems.length === 0)) {
    return null;
  }

  // Filter out empty user messages (likely permission approvals or empty inputs)
  const filteredMessages = (messages || []).filter((message) => {
    // Keep all non-user messages (assistant, system, etc.)
    if (message.role !== 'user') {
      return true;
    }

    // For user messages, check if content is empty
    let textContent = message.content;
    let hasAttachments = false;

    // Try to parse as MessageInput JSON
    try {
      const parsed: MessageInput = JSON.parse(message.content);
      if (typeof parsed === 'object' && 'text' in parsed) {
        textContent = parsed.text || '';
        hasAttachments = (parsed.attachments?.length || 0) > 0;
      }
    } catch {
      // Not JSON, use as plain text
      textContent = message.content;
    }

    // Keep message if it has text content or attachments
    return textContent.trim().length > 0 || hasAttachments;
  });

  // Build merged timeline sorted by createdAt
  const timeline: TimelineEntry[] = [
    ...filteredMessages.map((m): TimelineEntry => ({ kind: 'message', data: m })),
    ...(filePushItems || []).map((f): TimelineEntry => ({ kind: 'file_push', data: f })),
  ].sort((a, b) => {
    const tA = a.kind === 'message' ? a.data.createdAt : a.data.createdAt;
    const tB = b.kind === 'message' ? b.data.createdAt : b.data.createdAt;
    return tA - tB;
  });

  return (
    <div className="space-y-4">
      {timeline.map((entry) =>
        entry.kind === 'message' ? (
          <MessageItem key={entry.data.id} message={entry.data} />
        ) : (
          <div key={entry.data.fileId} className="max-w-full md:max-w-3xl">
            <FilePushCard item={entry.data} />
          </div>
        )
      )}
    </div>
  );
}

const SHELL_LANGUAGES = new Set(['bash', 'shell', 'sh', 'zsh']);

function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const { sendMessage } = useConnection();
  const isShell = SHELL_LANGUAGES.has(language.toLowerCase());
  const hasTerminal = isShell && useServerStore.getState().activeServerSupports('remoteTerminal');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunInTerminal = async () => {
    const { selectedSessionId, sessions } = useProjectStore.getState();
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session?.projectId) return;

    const store = useTerminalStore.getState();
    if (!store.terminals[session.projectId]) {
      store.openTerminal(session.projectId);
    }
    store.setDrawerOpen(session.projectId, true);

    const terminalId = useTerminalStore.getState().terminals[session.projectId];
    if (terminalId) {
      await useTerminalStore.getState().waitForReady(terminalId);
      sendMessage({ type: 'terminal_input', terminalId, data: children });
    }
  };

  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      {/* Header bar - like GPT style */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
        <div className="flex items-center gap-3">
          {isShell && hasTerminal && (
            <button
              onClick={handleRunInTerminal}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Run in terminal
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`
              flex items-center gap-1.5 text-xs transition-colors
              ${copied
                ? 'text-success'
                : 'text-muted-foreground hover:text-foreground'
              }
            `}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy code
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code content */}
      <SyntaxHighlighter
        style={codeStyle}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          padding: '0.75rem',
          fontSize: 'var(--chat-font-code, 0.8125rem)',
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

// Attachment display component — lazy load: only download on click
function AttachmentDisplay({ attachment }: { attachment: MessageAttachment }) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImage = useCallback(() => {
    if (loading || imageData) return;
    setLoading(true);
    setError(null);
    downloadFile(attachment.fileId)
      .then(result => {
        setImageData(`data:${result.mimeType};base64,${result.data}`);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load image:', err);
        setError('Failed to load image');
        setLoading(false);
      });
  }, [attachment.fileId, loading, imageData]);

  if (attachment.type === 'image') {
    if (imageData) {
      return (
        <div className="rounded overflow-hidden bg-black/20 inline-block max-w-full">
          <img
            src={imageData}
            alt={attachment.name}
            className="block max-w-full h-auto"
            style={{ maxHeight: '300px' }}
          />
          <div className="px-2 py-1 bg-black/20 text-xs text-primary-foreground/70">
            {attachment.name}
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="border border-border rounded p-4 bg-secondary/50 text-center text-sm text-muted-foreground">
          Loading image...
        </div>
      );
    }

    // Default: show clickable placeholder
    return (
      <div
        className="border border-border rounded overflow-hidden bg-secondary/30 cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={loadImage}
      >
        <div className="flex items-center justify-center h-24 text-muted-foreground">
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto mb-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="text-xs">{error ? 'Load failed — click to retry' : 'Click to load image'}</div>
          </div>
        </div>
        <div className="px-2 py-1 bg-secondary text-xs text-muted-foreground border-t border-border">
          {attachment.name}
        </div>
      </div>
    );
  }

  // Fallback for other file types
  return (
    <div className="px-2 py-1 bg-secondary text-xs rounded inline-block">
      {attachment.name}
    </div>
  );
}

function MessageItem({ message }: { message: MessageWithToolCalls }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  // Parse message content (supports both plain text and structured MessageInput)
  let textContent = message.content;
  let attachments: MessageAttachment[] = [];

  try {
    const parsed: MessageInput = JSON.parse(message.content);
    if (typeof parsed === 'object' && 'text' in parsed) {
      textContent = parsed.text || '';
      attachments = parsed.attachments || [];
    }
  } catch {
    // Not JSON or not MessageInput, use as plain text
    textContent = message.content;
  }

  // Extract thinking blocks for assistant messages (rendered outside bubble for consistent width)
  const { thinking, content: mainContent } = useMemo(
    () => (!isUser && !isSystem ? extractThinking(message.content) : { thinking: '', content: message.content }),
    [message.content, isUser, isSystem]
  );

  return (
    <div
      data-role={message.role}
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${
        isSystem ? 'opacity-60' : ''
      }`}
    >
      {/* Tool calls section (shown before the message content for assistant) */}
      {!isUser && hasToolCalls && (
        <div className="w-full max-w-full md:max-w-3xl mb-2">
          <ToolCallList toolCalls={message.toolCalls!} defaultCollapsed={true} />
        </div>
      )}

      {/* Thinking block (same level as tool calls for consistent width) */}
      {!isUser && thinking && (
        <div className="w-full max-w-full md:max-w-3xl mb-2">
          <ThinkingBlock content={thinking} />
        </div>
      )}

      <div
        className={`rounded-lg px-3 md:px-4 py-2 ${
          isUser
            ? 'max-w-[85%] md:max-w-3xl bg-primary text-primary-foreground'
            : isSystem
            ? 'max-w-[85%] md:max-w-3xl bg-muted text-muted-foreground text-sm'
            : 'w-full max-w-full md:max-w-3xl bg-card text-card-foreground'
        }`}
      >
        {isUser ? (
          <div className="text-sm">
            {/* Display attachments */}
            {attachments.length > 0 && (
              <div className="space-y-2 mb-2">
                {attachments.map((att) => (
                  <AttachmentDisplay key={att.fileId} attachment={att} />
                ))}
              </div>
            )}
            {/* Display text */}
            <p className="whitespace-pre-wrap leading-relaxed">{textContent}</p>
          </div>
        ) : (
          <AssistantContent content={mainContent} />
        )}
        <div className="mt-1 text-xs opacity-50">
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

/** Renders assistant message markdown (thinking blocks already extracted at MessageItem level) */
function AssistantContent({ content }: { content: string }) {
  return (
    <>
      <div className="prose dark:prose-invert prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !String(children).includes('\n');

              if (isInline) {
                return (
                  <code
                    className="bg-secondary px-1.5 py-0.5 rounded text-sm text-primary"
                    {...props}
                  >
                    {children}
                  </code>
                );
              }

              const language = match ? match[1] : 'text';
              const codeString = String(children).replace(/\n$/, '');

              return <CodeBlock language={language}>{codeString}</CodeBlock>;
            },
            pre({ children }) {
              return <>{children}</>;
            },
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 underline"
                >
                  {children}
                </a>
              );
            },
            table({ children }) {
              return (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse border border-border">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border border-border px-3 py-2 bg-secondary text-left">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="border border-border px-3 py-2">
                  {children}
                </td>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}
