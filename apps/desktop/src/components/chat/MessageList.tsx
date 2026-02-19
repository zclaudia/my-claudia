import { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ToolCallList } from './ToolCallItem';
import type { MessageWithToolCalls } from '../../stores/chatStore';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { downloadFile } from '../../services/fileUpload';
import type { MessageInput, MessageAttachment } from '@my-claudia/shared';

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

/** Collapsible thinking block */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2 rounded-lg border border-border/50 bg-secondary/30 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Thinking</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  messages: MessageWithToolCalls[];
}

export function MessageList({ messages }: MessageListProps) {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Filter out empty user messages (likely permission approvals or empty inputs)
  const filteredMessages = messages.filter((message) => {
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

  return (
    <div className="space-y-4">
      {filteredMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
}

function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      {/* Header bar - like GPT style */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
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
        <div className="border border-border rounded overflow-hidden">
          <img
            src={imageData}
            alt={attachment.name}
            className="max-w-full h-auto"
            style={{ maxHeight: '300px', objectFit: 'contain' }}
          />
          <div className="px-2 py-1 bg-secondary text-xs text-muted-foreground">
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
          <AssistantContent content={message.content} />
        )}
        <div className="mt-1 text-xs opacity-50">
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

/** Renders assistant message with thinking block extraction and markdown */
function AssistantContent({ content }: { content: string }) {
  const { thinking, content: mainContent } = useMemo(() => extractThinking(content), [content]);

  return (
    <>
      {thinking && <ThinkingBlock content={thinking} />}
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
          {mainContent}
        </ReactMarkdown>
      </div>
    </>
  );
}
