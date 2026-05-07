import { useCallback, useState, type DragEvent, type ReactNode } from 'react';

interface AttachmentDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  /** Optional ARIA label for the drop region. */
  label?: string;
}

/**
 * Wraps any children with drag-and-drop file handling. Visual highlight when
 * files are being dragged over. Does NOT intercept clipboard paste events —
 * those should be wired on the textarea/input that owns text input focus.
 */
export function AttachmentDropZone({
  onFiles,
  disabled,
  className,
  children,
  label,
}: AttachmentDropZoneProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Only react to genuine file drags.
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Only clear when leaving the wrapper, not when crossing inner children.
      if (e.currentTarget === e.target) {
        setIsOver(false);
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      setIsOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return (
    <div
      role="region"
      aria-label={label ?? 'Drop files here'}
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-primary ring-offset-2' : ''}`.trim()}
      data-attachment-dropzone-active={isOver ? 'true' : 'false'}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}
