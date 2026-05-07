import { useCallback, useRef, type ReactNode } from 'react';
import { Paperclip } from 'lucide-react';

interface AttachmentPickerProps {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
}

/**
 * Hidden `<input type=file>` wrapper with a visible trigger. By default the
 * trigger is a small paperclip button; pass `children` to render a custom
 * trigger (which still benefits from the click-to-open behavior).
 */
export function AttachmentPicker({
  onFiles,
  multiple = true,
  accept,
  disabled,
  className,
  children,
  ariaLabel,
}: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // Reset so picking the same file again still triggers `change`.
      e.target.value = '';
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={handleChange}
        data-testid="attachment-picker-input"
      />
      {children ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className={className}
          aria-label={ariaLabel ?? 'Attach files'}
        >
          {children}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className={
            className ??
            'inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50'
          }
          aria-label={ariaLabel ?? 'Attach files'}
          title="Attach files"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>Attach</span>
        </button>
      )}
    </>
  );
}
