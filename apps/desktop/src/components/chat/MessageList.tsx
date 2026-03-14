import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Brain, ChevronRight, Image, Copy, Check, Terminal } from 'lucide-react';
import { ToolCallList } from './ToolCallItem';
import { FilePushCard } from './FilePushNotification';
import { FilePreviewModal } from './FilePreviewModal';
import type { MessageWithToolCalls, ToolCallState } from '../../stores/chatStore';
import { ToolCallItem } from './ToolCallItem';
import type { ContentBlock } from '@my-claudia/shared';
import { useFilePushStore, type FilePushItem } from '../../stores/filePushStore';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { downloadFile } from '../../services/fileUpload';
import type { MessageInput, MessageAttachment } from '@my-claudia/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';
import { TextWithFileRefs, MarkdownChildrenWithFileRefs } from './FileReference';

/**
 * Extract <think>...</think> blocks from message content.
 * Also tolerates partially persisted content such as a dangling `<think>`
 * prefix saved mid-stream before the closing tag arrives.
 */
export function extractThinking(text: string): { thinking: string; content: string } {
  const thinkSections: string[] = [];
  const contentSections: string[] = [];
  const tagRegex = /<\/?think>/gi;

  let cursor = 0;
  let inThinkBlock = false;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const chunk = text.slice(cursor, match.index);
    if (chunk) {
      if (inThinkBlock) {
        thinkSections.push(chunk);
      } else {
        contentSections.push(chunk);
      }
    }

    inThinkBlock = match[0].toLowerCase() === '<think>';
    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) {
    if (inThinkBlock) {
      thinkSections.push(tail);
    } else {
      contentSections.push(tail);
    }
  }

  const thinking = thinkSections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');

  const content = contentSections
    .join('')
    .replace(/<\/?think>/gi, '')
    .trim();

  return { thinking, content };
}

export function normalizeMarkdownForRender(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const fenceCount = (normalized.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
}

function hasLikelyGfmTable(content: string): boolean {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const separator = lines[i + 1].trim();
    if (!header.includes('|')) continue;
    if (/^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(separator)) {
      return true;
    }
  }
  return false;
}

function logSuspiciousMarkdownRender(original: string, normalized: string): void {
  const unbalancedFence = original !== normalized;
  const tableSyntax = hasLikelyGfmTable(original);
  if (!unbalancedFence && !tableSyntax) return;

  const tail = original.slice(-400);
  console.info('[MarkdownRender]', {
    unbalancedFence,
    tableSyntax,
    originalLength: original.length,
    normalizedLength: normalized.length,
    tailPreview: tail,
  });
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
        <Brain size={14} strokeWidth={1.5} className="flex-shrink-0" />
        <ChevronRight size={12} strokeWidth={2} className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
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
  streamingContentBlocks?: ContentBlock[];
  streamingToolCalls?: ToolCallState[];
  scrollTop?: number;
  viewportHeight?: number;
  resendTargetMessageId?: string;
  onResendTarget?: () => void;
  resendDisabled?: boolean;
}

const VIRTUALIZE_THRESHOLD = 80;
const VIRTUAL_ESTIMATED_HEIGHT = 120;
const VIRTUAL_OVERSCAN_PX = 900;

export const MessageList = memo(function MessageList({
  messages,
  streamingContentBlocks,
  streamingToolCalls,
  scrollTop = 0,
  viewportHeight = 0,
  resendTargetMessageId,
  onResendTarget,
  resendDisabled = false,
}: MessageListProps) {
  // Subscribe to filePushStore for download status updates
  const filePushItems = useFilePushStore((state) => state.items);
  const [previewItem, setPreviewItem] = useState<FilePushItem | null>(null);
  const [heightVersion, setHeightVersion] = useState(0);
  const itemHeightsRef = useRef<Map<number, number>>(new Map());
  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());

  // Filter out empty messages (permission approvals, empty inputs, placeholder assistant messages)
  const filteredMessages = useMemo(() => {
    return (messages || []).filter((message) => {
      // Filter out empty assistant messages (placeholders from run_started that never received content)
      if (message.role === 'assistant') {
        const hasContent = message.content.trim().length > 0;
        const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
        const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0;
        return hasContent || hasToolCalls || hasBlocks;
      }

      // Keep all other non-user messages (system, etc.)
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
  }, [messages]);

  const firstMessageId = filteredMessages[0]?.id || '';
  const prevFirstMessageIdRef = useRef(firstMessageId);
  useEffect(() => {
    // Reset measurements when the list head changes (session switch or prepending older history).
    if (prevFirstMessageIdRef.current !== firstMessageId) {
      for (const ro of observersRef.current.values()) {
        ro.disconnect();
      }
      observersRef.current.clear();
      itemHeightsRef.current.clear();
      setHeightVersion(v => v + 1);
      prevFirstMessageIdRef.current = firstMessageId;
    }
  }, [firstMessageId]);

  useEffect(() => {
    return () => {
      for (const ro of observersRef.current.values()) {
        ro.disconnect();
      }
      observersRef.current.clear();
    };
  }, []);

  const shouldVirtualize = filteredMessages.length >= VIRTUALIZE_THRESHOLD && viewportHeight > 0;

  const getHeight = useCallback((index: number) => {
    return itemHeightsRef.current.get(index) ?? VIRTUAL_ESTIMATED_HEIGHT;
  }, [itemHeightsRef]);

  const setMeasuredRef = useCallback((index: number, element: HTMLDivElement | null) => {
    const existing = observersRef.current.get(index);
    if (existing) {
      existing.disconnect();
      observersRef.current.delete(index);
    }

    if (!element) return;

    const updateHeight = (nextHeight: number) => {
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      const prev = itemHeightsRef.current.get(index);
      if (prev !== nextHeight) {
        itemHeightsRef.current.set(index, nextHeight);
        setHeightVersion(v => v + 1);
      }
    };

    updateHeight(Math.ceil(element.getBoundingClientRect().height));

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateHeight(Math.ceil(entry.contentRect.height));
      }
    });
    ro.observe(element);
    observersRef.current.set(index, ro);
  }, [itemHeightsRef, observersRef]);

  // Precompute the index of the last assistant message for streaming block assignment
  const lastAssistantIndex = useMemo(() => {
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
      if (filteredMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [filteredMessages]);

  const renderMessage = useCallback((message: MessageWithToolCalls, index: number) => {
    if (message.metadata?.filePush) {
      const fp = message.metadata.filePush;
      const storeItem = filePushItems.find(i => i.fileId === fp.fileId);
      const item: FilePushItem = {
        fileId: fp.fileId,
        fileName: fp.fileName,
        mimeType: fp.mimeType,
        fileSize: fp.fileSize,
        sessionId: message.sessionId,
        description: fp.description,
        autoDownload: fp.autoDownload,
        status: storeItem?.status ?? 'pending',
        downloadProgress: storeItem?.downloadProgress ?? 0,
        savedPath: storeItem?.savedPath,
        privatePath: storeItem?.privatePath,
        error: storeItem?.error,
        serverId: storeItem?.serverId,
        createdAt: message.createdAt,
      };
      return (
        <div key={message.id} className="max-w-full md:max-w-3xl">
          <FilePushCard item={item} onPreview={setPreviewItem} />
        </div>
      );
    }

    // Pass streaming blocks to the last assistant message (not necessarily the absolute
    // last message — system messages like task_notification can be appended after it).
    const isLastAssistant = Boolean(
      streamingContentBlocks &&
      index === lastAssistantIndex
    );

    return (
      <MessageItem
        key={message.id}
        message={message}
        streamingContentBlocks={isLastAssistant ? streamingContentBlocks : undefined}
        streamingToolCalls={isLastAssistant ? streamingToolCalls : undefined}
        showResend={message.id === resendTargetMessageId}
        onResend={message.id === resendTargetMessageId ? onResendTarget : undefined}
        resendDisabled={resendDisabled}
      />
    );
  }, [filePushItems, filteredMessages.length, lastAssistantIndex, streamingContentBlocks, streamingToolCalls, resendTargetMessageId, onResendTarget, resendDisabled]);

  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        start: 0,
        end: filteredMessages.length,
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    let totalHeight = 0;
    for (let i = 0; i < filteredMessages.length; i++) {
      totalHeight += getHeight(i);
    }
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    const safeScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);

    let start = 0;
    let y = 0;
    const startOffset = Math.max(0, safeScrollTop - VIRTUAL_OVERSCAN_PX);
    while (start < filteredMessages.length && y + getHeight(start) < startOffset) {
      y += getHeight(start);
      start++;
    }

    let end = start;
    let renderedBottom = y;
    const endOffset = safeScrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;
    while (end < filteredMessages.length && renderedBottom < endOffset) {
      renderedBottom += getHeight(end);
      end++;
    }

    return {
      start,
      end,
      topPadding: y,
      bottomPadding: Math.max(0, totalHeight - renderedBottom),
    };
  }, [filteredMessages.length, getHeight, heightVersion, scrollTop, shouldVirtualize, viewportHeight]);

  if (filteredMessages.length === 0) {
    return null;
  }

  const previewModal = previewItem && (
    <FilePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
  );

  if (!shouldVirtualize) {
    return (
      <>
        <div data-testid="message-list" className="space-y-5">
          {filteredMessages.map((message, index) => renderMessage(message, index))}
        </div>
        {previewModal}
      </>
    );
  }

  return (
    <>
      <div data-testid="message-list">
        {virtualWindow.topPadding > 0 && (
          <div style={{ height: virtualWindow.topPadding }} />
        )}
        {filteredMessages.slice(virtualWindow.start, virtualWindow.end).map((message, idx) => {
          const absoluteIndex = virtualWindow.start + idx;
          return (
            <div
              key={message.id}
              ref={(el) => setMeasuredRef(absoluteIndex, el)}
              className="mb-4"
            >
              {renderMessage(message, absoluteIndex)}
            </div>
          );
        })}
        {virtualWindow.bottomPadding > 0 && (
          <div style={{ height: virtualWindow.bottomPadding }} />
        )}
      </div>
      {previewModal}
    </>
  );
});

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
    store.setBottomPanelTab('terminal');

    const terminalId = useTerminalStore.getState().terminals[session.projectId];
    if (terminalId) {
      await useTerminalStore.getState().waitForReady(terminalId);
      sendMessage({ type: 'terminal_input', terminalId, data: children });
    }
  };

  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

  return (
    <div className="rounded-lg overflow-hidden border border-border max-w-full">
      {/* Header bar - like GPT style */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
        <div className="flex items-center gap-3">
          {isShell && hasTerminal && (
            <button
              onClick={handleRunInTerminal}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Terminal size={16} strokeWidth={1.75} />
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
                <Check size={16} strokeWidth={2} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} strokeWidth={1.75} />
                Copy code
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code content */}
      <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
        <SyntaxHighlighter
          style={codeStyle}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            padding: '0.75rem',
            fontSize: 'var(--chat-font-code, 0.8125rem)',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
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
            <Image size={32} strokeWidth={1.5} className="mx-auto mb-1 opacity-50" />
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

/** Collapsed intermediate text block — shows first line preview, expandable */
function CollapsedTextBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  // Strip thinking tags for preview
  const { content: cleanContent } = extractThinking(content);
  const firstLine = cleanContent.split('\n').find(l => l.trim().length > 0) || '';
  // Truncate to reasonable preview length
  const preview = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;

  return (
    <div className="mb-2 rounded-lg border border-border/50 bg-muted/30 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight size={12} strokeWidth={2} className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        <span className="truncate text-left">{preview || '...'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/30">
          <div className="pt-2">
            <AssistantContent content={cleanContent} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Segmented content renderer — interleaves collapsed text, tool calls, and final text */
const SegmentedContent = memo(function SegmentedContent({
  contentBlocks,
  toolCalls,
}: {
  contentBlocks: ContentBlock[];
  toolCalls: ToolCallState[];
}) {
  // Build toolUseId → ToolCallState lookup
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallState>();
    for (const tc of toolCalls) {
      map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  // Find last text block index
  const lastTextIndex = useMemo(() => {
    for (let i = contentBlocks.length - 1; i >= 0; i--) {
      if (contentBlocks[i].type === 'text') return i;
    }
    return -1;
  }, [contentBlocks]);

  return (
    <>
      {contentBlocks.map((block, i) => {
        if (block.type === 'tool_use') {
          const tc = toolCallMap.get(block.toolUseId);
          if (!tc) return null;
          return (
            <div key={`tool-${block.toolUseId}`} className="w-full max-w-full md:max-w-3xl">
              <ToolCallItem toolCall={tc} />
            </div>
          );
        }

        // Text block
        if (i === lastTextIndex) {
          // Last text block: render fully with thinking extraction
          const { thinking, content: mainContent } = extractThinking(block.content);
          return (
            <div key={`text-${i}`}>
              {thinking && (
                <div className="w-full max-w-full md:max-w-3xl mb-2">
                  <ThinkingBlock content={thinking} />
                </div>
              )}
              <div className="rounded-2xl px-3 md:px-4 py-2 w-full max-w-full md:max-w-3xl bg-card text-card-foreground">
                <AssistantContent content={mainContent} />
              </div>
            </div>
          );
        }

        // Intermediate text block: collapsed
        return (
          <div key={`text-${i}`} className="w-full max-w-full md:max-w-3xl">
            <CollapsedTextBlock content={block.content} />
          </div>
        );
      })}
    </>
  );
});

const MessageItem = memo(function MessageItem({ message, streamingContentBlocks, streamingToolCalls, showResend, onResend, resendDisabled }: {
  message: MessageWithToolCalls;
  streamingContentBlocks?: ContentBlock[];
  streamingToolCalls?: ToolCallState[];
  showResend?: boolean;
  onResend?: () => void;
  resendDisabled?: boolean;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  // Use segmented rendering: completed messages OR active streaming with blocks
  const hasStreamingBlocks = streamingContentBlocks && streamingContentBlocks.length > 0 && streamingToolCalls && streamingToolCalls.length > 0;
  const useSegmented = !isUser && !isSystem && ((hasContentBlocks && hasToolCalls) || hasStreamingBlocks);

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

  if (useSegmented) {
    // Segmented rendering: streaming blocks take priority over finalized blocks
    const blocks = streamingContentBlocks || message.contentBlocks!;
    const toolCalls = streamingToolCalls || message.toolCalls!;
    return (
      <div
        data-role={message.role}
        className="flex flex-col items-start"
      >
        <SegmentedContent
          contentBlocks={blocks}
          toolCalls={toolCalls}
        />
        <div className="mt-1 text-xs opacity-50 px-3">
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
    );
  }

  return (
    <div
      data-role={message.role}
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${
        isSystem ? 'opacity-60' : ''
      }`}
    >
      {/* Tool calls section (shown before the message content for assistant) — legacy rendering */}
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
        className={`rounded-2xl px-3 md:px-4 py-2 ${
          isUser
            ? 'max-w-[85%] md:max-w-3xl bg-primary text-primary-foreground shadow-apple-sm'
            : isSystem
            ? 'max-w-[85%] md:max-w-3xl bg-muted text-muted-foreground text-sm'
            : 'w-full max-w-full md:max-w-3xl bg-card text-card-foreground min-w-0'
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
            <p className="whitespace-pre-wrap leading-relaxed"><TextWithFileRefs text={textContent} variant="user" /></p>
          </div>
        ) : (
          <AssistantContent content={mainContent} />
        )}
        <div className="mt-1 text-xs opacity-50">
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
      {isUser && showResend && onResend && (
        <div className="mt-1">
          <button
            onClick={onResend}
            disabled={resendDisabled}
            className="text-xs px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed"
            title={resendDisabled ? 'This message cannot be resent as plain text' : 'Resend this message'}
          >
            Resend
          </button>
        </div>
      )}
    </div>
  );
});

/** Renders assistant message markdown (thinking blocks already extracted at MessageItem level) */
const AssistantContent = memo(function AssistantContent({ content }: { content: string }) {
  const normalizedContent = useMemo(() => normalizeMarkdownForRender(content), [content]);

  useEffect(() => {
    logSuspiciousMarkdownRender(content, normalizedContent);
  }, [content, normalizedContent]);

  return (
    <>
      <div className="prose dark:prose-invert prose-sm max-w-none min-w-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !String(children).includes('\n');

              if (isInline) {
                return (
                  <code
                    className="bg-secondary px-1.5 py-0.5 rounded text-sm text-primary break-all"
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
                  className="text-primary hover:text-primary/80 underline"
                >
                  {children}
                </a>
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
                <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-pre-wrap break-words">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="border border-border px-3 py-2 align-top whitespace-pre-wrap break-words">
                  {children}
                </td>
              );
            },
            p({ children }) {
              return <p><MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs></p>;
            },
            li({ children }) {
              return <li><MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs></li>;
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </>
  );
});
