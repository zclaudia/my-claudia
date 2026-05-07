import { useState } from 'react';
import type { Attachment, AttachmentOwnerKind } from '@my-claudia/shared';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { SortableAttachmentThumbnail } from './SortableAttachmentThumbnail';
import { ImageLightbox } from './ImageLightbox';
import { downloadAttachment } from '../api';
import { useAttachmentsStore } from '../store';

interface AttachmentListProps {
  items: Attachment[];
  onRemove?: (id: string) => void;
  /** Disable inline image previews (use icon-only thumbnails). */
  preview?: boolean;
  emptyText?: string;
  className?: string;
  /**
   * Enable drag-to-reorder. Requires `ownerKind` and `ownerId` so the new
   * order can be persisted. Items that don't belong to the same owner are
   * filtered defensively but should not happen in practice.
   */
  sortable?: boolean;
  ownerKind?: AttachmentOwnerKind;
  ownerId?: string;
}

export function AttachmentList({
  items,
  onRemove,
  preview = true,
  emptyText,
  className,
  sortable = false,
  ownerKind,
  ownerId,
}: AttachmentListProps) {
  const [previewItem, setPreviewItem] = useState<Attachment | null>(null);
  const reorder = useAttachmentsStore((s) => s.reorderAttachments);

  // PointerSensor with a small distance threshold lets click-to-open still
  // work; only horizontal/vertical movement of >= 5px starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (items.length === 0) {
    if (!emptyText) return null;
    return (
      <div className="text-xs text-muted-foreground italic">{emptyText}</div>
    );
  }

  const handleClick = (att: Attachment) => {
    if (att.kind === 'image') {
      setPreviewItem(att);
    } else {
      void downloadAttachment(att.id, att.name);
    }
  };

  const handleDownload = (att: Attachment) => {
    void downloadAttachment(att.id, att.name);
  };

  const canSort = sortable && !!ownerKind && !!ownerId;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const ordered = arrayMove(ids, oldIndex, newIndex);
    if (canSort) {
      void reorder(ownerKind, ownerId, ordered);
    }
  };

  const containerProps = {
    className: `flex flex-wrap gap-3 ${className ?? ''}`.trim(),
    'data-testid': 'attachment-list',
  };

  const renderStatic = () => (
    <div {...containerProps}>
      {items.map((att) => (
        <AttachmentThumbnail
          key={att.id}
          attachment={att}
          preview={preview}
          onClick={handleClick}
          onDownload={handleDownload}
          onRemove={onRemove}
        />
      ))}
    </div>
  );

  const renderSortable = () => (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div {...containerProps}>
          {items.map((att) => (
            <SortableAttachmentThumbnail
              key={att.id}
              attachment={att}
              preview={preview}
              onClick={handleClick}
              onDownload={handleDownload}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  return (
    <>
      {canSort ? renderSortable() : renderStatic()}

      {previewItem && (
        <ImageLightbox attachment={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </>
  );
}
