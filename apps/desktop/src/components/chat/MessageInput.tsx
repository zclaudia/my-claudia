import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent, ChangeEvent, useCallback, useMemo } from 'react';
import type { SlashCommand, FileEntry } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';

export interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string; // base64 data URL
  mimeType: string;
}

interface MessageInputProps {
  onSend: (message: string, attachments?: Attachment[]) => void;
  onCancel?: () => void;
  onCommand?: (command: string, args: string) => void;
  commands?: SlashCommand[];  // Commands from provider
  projectRoot?: string;       // Project root for @ file mentions
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  initialValue?: string;      // Initial value to set (e.g., for restoring after cancel)
  initialAttachments?: Attachment[]; // Initial attachments to restore
  advancedMode?: boolean;     // Advanced input: larger textarea, Enter=newline on desktop
}

// State for @ mention feature
interface MentionState {
  isActive: boolean;
  triggerIndex: number;
  query: string;
  currentPath: string;
  entries: FileEntry[];
  selectedIndex: number;
  isLoading: boolean;
}

const initialMentionState: MentionState = {
  isActive: false,
  triggerIndex: -1,
  query: '',
  currentPath: '',
  entries: [],
  selectedIndex: 0,
  isLoading: false,
};

// File type icons
const getFileIcon = (entry: FileEntry): string => {
  if (entry.type === 'directory') {
    return '\uD83D\uDCC1'; // 📁
  }

  const ext = entry.extension?.toLowerCase();
  const iconMap: Record<string, string> = {
    '.ts': '\uD83D\uDD37',    // 🔷
    '.tsx': '\u269B\uFE0F',   // ⚛️
    '.js': '\uD83D\uDFE8',    // 🟨
    '.jsx': '\u269B\uFE0F',   // ⚛️
    '.json': '\uD83D\uDCCB',  // 📋
    '.md': '\uD83D\uDCDD',    // 📝
    '.css': '\uD83C\uDFA8',   // 🎨
    '.scss': '\uD83C\uDFA8',  // 🎨
    '.html': '\uD83C\uDF10',  // 🌐
    '.py': '\uD83D\uDC0D',    // 🐍
    '.rs': '\uD83E\uDD80',    // 🦀
    '.go': '\uD83D\uDC39',    // 🐹
    '.java': '\u2615',        // ☕
    '.yaml': '\uD83D\uDCC4',  // 📄
    '.yml': '\uD83D\uDCC4',   // 📄
    '.toml': '\uD83D\uDCC4',  // 📄
    '.env': '\uD83D\uDD10',   // 🔐
    '.gitignore': '\uD83D\uDEAB', // 🚫
    '.png': '\uD83D\uDDBC\uFE0F', // 🖼️
    '.jpg': '\uD83D\uDDBC\uFE0F', // 🖼️
    '.jpeg': '\uD83D\uDDBC\uFE0F', // 🖼️
    '.svg': '\uD83C\uDFA8',   // 🎨
    '.gif': '\uD83D\uDDBC\uFE0F', // 🖼️
  };

  return iconMap[ext || ''] || '\uD83D\uDCC4'; // 📄
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

// Simple debounce function
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function MessageInput({
  onSend,
  onCancel,
  onCommand,
  commands = [],
  projectRoot,
  disabled = false,
  isLoading = false,
  placeholder = 'Type a message... (Enter to send)',
  initialValue,
  initialAttachments,
  advancedMode = false,
}: MessageInputProps) {
  const isMobile = useIsMobile();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [mentionState, setMentionState] = useState<MentionState>(initialMentionState);
  const [isComposing, setIsComposing] = useState(false); // Track IME composition state

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const compositionTimeoutRef = useRef<number | null>(null); // Timer for composition end delay

  // Update value when initialValue changes (e.g., after cancel to restore previous message)
  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue);
      // Focus textarea after setting value
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [initialValue]);

  // Update attachments when initialAttachments changes
  useEffect(() => {
    if (initialAttachments !== undefined) {
      setAttachments(initialAttachments);
    }
  }, [initialAttachments]);

  // Cleanup composition timeout on unmount
  useEffect(() => {
    return () => {
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
      }
    };
  }, []);

  // Filter commands based on input
  const filteredCommands = value.startsWith('/')
    ? commands.filter((cmd) =>
        cmd.command.toLowerCase().startsWith(value.toLowerCase())
      )
    : [];

  // Detect @ mention in text
  const detectMention = useCallback((text: string, cursorPos: number): { triggerIndex: number; query: string } | null => {
    // Find the last @ before cursor that's not preceded by a non-space character
    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = text[i];
      if (char === '@') {
        // Check if @ is at start or preceded by whitespace
        if (i === 0 || /\s/.test(text[i - 1])) {
          return {
            triggerIndex: i,
            query: text.substring(i + 1, cursorPos)
          };
        }
        break;
      }
      // Stop if we hit whitespace (except within the path)
      if (char === ' ' || char === '\n' || char === '\t') {
        break;
      }
    }
    return null;
  }, []);

  // Parse query into path components
  const parseQuery = useCallback((query: string) => {
    const pathParts = query.split('/');
    const currentPath = pathParts.slice(0, -1).join('/');
    const searchQuery = pathParts[pathParts.length - 1];
    return { currentPath, searchQuery };
  }, []);

  // Fetch directory entries with debouncing
  const fetchEntries = useCallback(async (projectRootPath: string, relativePath: string, query: string) => {
    if (!projectRootPath) return;

    setMentionState(prev => ({ ...prev, isLoading: true }));

    try {
      const result = await api.listDirectory({
        projectRoot: projectRootPath,
        relativePath,
        query,
        maxResults: 20
      });

      setMentionState(prev => ({
        ...prev,
        entries: result.entries,
        isLoading: false,
        selectedIndex: 0
      }));
    } catch (error) {
      console.error('Failed to fetch directory listing:', error);
      setMentionState(prev => ({ ...prev, entries: [], isLoading: false }));
    }
  }, []);

  // Debounced fetch
  const debouncedFetchEntries = useMemo(
    () => debounce(fetchEntries, 150),
    [fetchEntries]
  );

  // Auto-resize textarea (only in normal mode; advanced mode uses CSS min/max-height)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && !advancedMode) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value, advancedMode]);

  // Show/hide command suggestions
  useEffect(() => {
    if (value.startsWith('/') && filteredCommands.length > 0 && !value.includes(' ')) {
      setShowCommands(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [value, filteredCommands.length]);

  // Scroll selected command into view
  useEffect(() => {
    if (showCommands && commandListRef.current) {
      const selectedElement = commandListRef.current.children[selectedCommandIndex] as HTMLElement;
      if (selectedElement?.scrollIntoView) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedCommandIndex, showCommands]);

  // Scroll selected mention into view
  useEffect(() => {
    if (mentionState.isActive && mentionListRef.current) {
      const selectedElement = mentionListRef.current.querySelector(`[data-index="${mentionState.selectedIndex}"]`) as HTMLElement;
      if (selectedElement?.scrollIntoView) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [mentionState.selectedIndex, mentionState.isActive]);

  // Handle input change with @ detection
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    setValue(newValue);

    // Check for @ mention
    if (projectRoot) {
      const mention = detectMention(newValue, cursorPos);

      if (mention) {
        const { currentPath, searchQuery } = parseQuery(mention.query);

        setMentionState(prev => ({
          ...prev,
          isActive: true,
          triggerIndex: mention.triggerIndex,
          query: mention.query,
          currentPath
        }));

        debouncedFetchEntries(projectRoot, currentPath, searchQuery);
      } else if (mentionState.isActive) {
        setMentionState(initialMentionState);
      }
    }
  };

  // Select a file/directory entry
  const selectMentionEntry = useCallback((entry: FileEntry) => {
    if (entry.type === 'directory') {
      // Navigate into directory
      const newPath = entry.path;
      const before = value.substring(0, mentionState.triggerIndex);
      const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
      const newValue = `${before}@${newPath}/${after}`;

      setValue(newValue);

      const newCursorPos = before.length + newPath.length + 2; // +2 for @ and /

      setMentionState(prev => ({
        ...prev,
        query: newPath + '/',
        currentPath: newPath,
        selectedIndex: 0
      }));

      // Fetch new directory contents
      if (projectRoot) {
        fetchEntries(projectRoot, newPath, '');
      }

      // Set cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
        }
      }, 0);
    } else {
      // Insert file reference
      const before = value.substring(0, mentionState.triggerIndex);
      const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
      const newValue = `${before}@${entry.path} ${after}`;

      setValue(newValue);
      setMentionState(initialMentionState);

      // Move cursor after the inserted path
      const newCursorPos = before.length + entry.path.length + 2; // +2 for @ and space
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
        }
      }, 0);
    }
  }, [value, mentionState, projectRoot, fetchEntries]);

  // Navigate to a specific path (for breadcrumb navigation)
  const navigateToPath = useCallback((path: string) => {
    const before = value.substring(0, mentionState.triggerIndex);
    const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
    const newQuery = path ? `${path}/` : '';
    const newValue = `${before}@${newQuery}${after}`;

    setValue(newValue);

    setMentionState(prev => ({
      ...prev,
      query: newQuery,
      currentPath: path,
      selectedIndex: 0
    }));

    if (projectRoot) {
      fetchEntries(projectRoot, path, '');
    }

    const newCursorPos = before.length + newQuery.length + 1;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPos;
        textareaRef.current.selectionEnd = newCursorPos;
        textareaRef.current.focus();
      }
    }, 0);
  }, [value, mentionState, projectRoot, fetchEntries]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle @ mention selection
    if (mentionState.isActive && mentionState.entries.length > 0) {
      if (e.key === 'ArrowDown' || ((e.ctrlKey || e.metaKey) && e.key === 'n')) {
        e.preventDefault();
        setMentionState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex < prev.entries.length - 1
            ? prev.selectedIndex + 1
            : 0
        }));
        return;
      }
      if (e.key === 'ArrowUp' || ((e.ctrlKey || e.metaKey) && e.key === 'p')) {
        e.preventDefault();
        setMentionState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex > 0
            ? prev.selectedIndex - 1
            : prev.entries.length - 1
        }));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selectedEntry = mentionState.entries[mentionState.selectedIndex];
        if (selectedEntry) {
          selectMentionEntry(selectedEntry);
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        const selectedEntry = mentionState.entries[mentionState.selectedIndex];
        if (selectedEntry?.type === 'directory') {
          e.preventDefault();
          selectMentionEntry(selectedEntry);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(initialMentionState);
        return;
      }
    }

    // Handle command selection
    if (showCommands) {
      // ArrowDown or Ctrl+N/Cmd+N to move down
      if (e.key === 'ArrowDown' || ((e.ctrlKey || e.metaKey) && e.key === 'n')) {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      // ArrowUp or Ctrl+P/Cmd+P to move up
      if (e.key === 'ArrowUp' || ((e.ctrlKey || e.metaKey) && e.key === 'p')) {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selectedCommand = filteredCommands[selectedCommandIndex];
        if (selectedCommand) {
          setValue(selectedCommand.command + ' ');
          setShowCommands(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

    // Enter key behavior (guarded by IME composition state)
    if (e.key === 'Enter' && !isComposing && !e.nativeEvent.isComposing) {
      if (advancedMode && !isMobile) {
        // Advanced + desktop: Cmd/Ctrl+Enter sends, plain Enter is newline
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          handleSend();
          return;
        }
        // Plain Enter: don't preventDefault — let textarea insert newline
      } else {
        // Normal mode: Enter sends, Shift+Enter is newline
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
          return;
        }
      }
    }

    // Tab to insert spaces (advanced mode only, when no dropdown is open)
    if (e.key === 'Tab' && advancedMode && !showCommands && !mentionState.isActive) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setValue(newValue);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
      return;
    }

    // Escape to cancel loading
    if (e.key === 'Escape' && isLoading && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }

    // Cmd+V is handled by onPaste
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await addFileAsAttachment(file);
        }
        return;
      }
    }
  };

  const addFileAsAttachment = async (file: File): Promise<void> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          type: file.type.startsWith('image/') ? 'image' : 'file',
          name: file.name,
          data: reader.result as string,
          mimeType: file.type,
        };
        setAttachments((prev) => [...prev, attachment]);
        resolve();
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      await addFileAsAttachment(file);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = () => {
    if (disabled) return;

    const trimmedValue = value.trim();

    // Handle slash commands
    if (trimmedValue.startsWith('/')) {
      const spaceIndex = trimmedValue.indexOf(' ');
      const command = spaceIndex > 0 ? trimmedValue.substring(0, spaceIndex) : trimmedValue;
      const args = spaceIndex > 0 ? trimmedValue.substring(spaceIndex + 1).trim() : '';

      if (onCommand) {
        onCommand(command, args);
        setValue('');
        return;
      }
    }

    // Send message with attachments
    if (trimmedValue || attachments.length > 0) {
      onSend(trimmedValue, attachments.length > 0 ? attachments : undefined);
      setValue('');
      setAttachments([]);
    }
  };

  const selectCommand = (command: string) => {
    setValue(command + ' ');
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative">
      {/* Command suggestions dropdown */}
      {showCommands && (
        <div
          ref={commandListRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-y-auto max-h-64 z-10"
        >
          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.command}
              onClick={() => selectCommand(cmd.command)}
              className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-muted ${
                index === selectedCommandIndex ? 'bg-muted' : ''
              }`}
            >
              <span className="font-mono text-primary">{cmd.command}</span>
              <span className="text-muted-foreground text-sm">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* @ Mention suggestions dropdown */}
      {mentionState.isActive && (mentionState.entries.length > 0 || mentionState.isLoading) && (
        <div
          ref={mentionListRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-y-auto max-h-64 z-10"
        >
          {/* Breadcrumb navigation */}
          {mentionState.currentPath && (
            <div className="px-4 py-2 border-b border-border text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
              <button
                onClick={() => navigateToPath('')}
                className="hover:text-foreground"
              >
                root
              </button>
              {mentionState.currentPath.split('/').map((part, idx, arr) => (
                <span key={idx} className="flex items-center gap-1">
                  <span className="text-muted-foreground/50">/</span>
                  <button
                    onClick={() => navigateToPath(arr.slice(0, idx + 1).join('/'))}
                    className="hover:text-foreground"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </div>
          )}

          {mentionState.isLoading ? (
            <div className="px-4 py-3 text-muted-foreground text-sm">Loading...</div>
          ) : mentionState.entries.length === 0 ? (
            <div className="px-4 py-3 text-muted-foreground text-sm">No files found</div>
          ) : (
            mentionState.entries.map((entry, index) => (
              <button
                key={entry.path}
                data-index={index}
                onClick={() => selectMentionEntry(entry)}
                className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-muted ${
                  index === mentionState.selectedIndex ? 'bg-muted' : ''
                }`}
              >
                <span className="text-lg">{getFileIcon(entry)}</span>
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.type === 'directory' && (
                  <span className="text-muted-foreground">→</span>
                )}
                {entry.size !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(entry.size)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted rounded-lg">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative group bg-secondary rounded-lg overflow-hidden"
            >
              {attachment.type === 'image' ? (
                <img
                  src={attachment.data}
                  alt={attachment.name}
                  className="h-20 w-auto max-w-32 object-cover"
                />
              ) : (
                <div className="h-20 w-32 flex items-center justify-center p-2">
                  <div className="text-center">
                    <svg
                      className="w-8 h-8 mx-auto text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-xs text-muted-foreground truncate block mt-1">
                      {attachment.name}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="absolute top-1 right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2">
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Add attachment (images, files)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.csv"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => {
              // Clear any pending timeout and immediately mark as composing
              if (compositionTimeoutRef.current) {
                clearTimeout(compositionTimeoutRef.current);
                compositionTimeoutRef.current = null;
              }
              setIsComposing(true);
            }}
            onCompositionEnd={() => {
              // Use 50ms delay to handle browser timing differences
              // Firefox fires compositionEnd before Enter keydown
              // Safari fires them in opposite order
              compositionTimeoutRef.current = setTimeout(() => {
                setIsComposing(false);
                compositionTimeoutRef.current = null;
              }, 50);
            }}
            disabled={disabled}
            placeholder={placeholder}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            rows={1}
            className={`w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ${
              advancedMode ? 'resize-y min-h-[160px] max-h-[40vh]' : 'resize-none'
            }`}
            style={{
              fontSize: 'var(--chat-font-input, 0.875rem)',
              ...(advancedMode ? {} : undefined),
            }}
          />
        </div>

        {/* Send/Cancel button */}
        {isLoading && onCancel ? (
          <button
            onClick={onCancel}
            className="p-2.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors"
            title="Cancel (Esc)"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="p-2.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-lg transition-colors"
            title={advancedMode && !isMobile ? `Send message (${isMac ? 'Cmd' : 'Ctrl'}+Enter)` : 'Send message (Enter)'}
            data-testid="send-button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Hint text — hidden on mobile to save space */}
      {!isMobile && (
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Type / for commands{projectRoot ? ', @ to reference files' : ''}</span>
          <span>
            {advancedMode
              ? `${isMac ? 'Cmd' : 'Ctrl'}+Enter to send, Tab to indent`
              : `Paste images with ${isMac ? 'Cmd' : 'Ctrl'}+V`
            }
          </span>
        </div>
      )}
    </div>
  );
}
