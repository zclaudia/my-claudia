import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Attachment } from '@my-claudia/shared';
import { AttachmentThumbnail } from './AttachmentThumbnail';

interface SortableAttachmentThumbnailProps {
  attachment: Attachment;
  onRemove?: (id: string) => void;
  onDownload?: (attachment: Attachment) => void;
  onClick?: (attachment: Attachment) => void;
  preview?: boolean;
}

/**
 * Wraps `AttachmentThumbnail` with `@dnd-kit/sortable` plumbing — only loaded
 * when the parent `AttachmentList` is in sortable mode. The drag handle is
 * injected via the thumbnail's `slotTopLeft` slot so the underlying
 * presentation component stays dnd-kit-agnostic.
 */
export function SortableAttachmentThumbnail({
  attachment,
  ...rest
}: SortableAttachmentThumbnailProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: attachment.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="p-1 rounded-md bg-background/90 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
      aria-label={`Reorder ${attachment.name}`}
      data-testid="attachment-drag-handle"
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical className="w-3 h-3" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <AttachmentThumbnail attachment={attachment} {...rest} slotTopLeft={handle} />
    </div>
  );
}
