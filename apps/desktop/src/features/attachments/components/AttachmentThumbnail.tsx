import type { ReactNode } from 'react';
import { File, FileText, Film, Music, X, Download } from 'lucide-react';
import type { Attachment } from '@my-claudia/shared';
import { useAttachmentSrc } from '../hooks/useAttachmentSrc';
import { formatFileSize } from '../utils';

interface AttachmentThumbnailProps {
  attachment: Attachment;
  onRemove?: (id: string) => void;
  onDownload?: (attachment: Attachment) => void;
  onClick?: (attachment: Attachment) => void;
  /** Disable image/video preview fetching (use generic icon instead). */
  preview?: boolean;
  /** Optional content rendered in the top-left corner — used by the sortable
   *  wrapper to inject a drag handle without coupling the thumbnail to dnd-kit. */
  slotTopLeft?: ReactNode;
}

const KIND_ICONS = {
  image: File,
  video: Film,
  audio: Music,
  document: FileText,
  file: File,
} as const;

export function AttachmentThumbnail({
  attachment,
  onRemove,
  onDownload,
  onClick,
  preview = true,
  slotTopLeft,
}: AttachmentThumbnailProps) {
  const isImage = attachment.kind === 'image';
  const enablePreview = preview && isImage;
  const { src, isLoading } = useAttachmentSrc(attachment.id, enablePreview);
  const Icon = KIND_ICONS[attachment.kind] ?? File;

  const handleClick = () => onClick?.(attachment);
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(attachment);
    }
  };

  return (
    <div
      className="group relative w-24 flex flex-col gap-1"
      data-testid="attachment-thumbnail"
      data-attachment-id={attachment.id}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKey}
        className="relative h-24 w-24 cursor-pointer overflow-hidden rounded border border-border bg-secondary flex items-center justify-center hover:border-primary transition-colors"
        title={attachment.name}
        aria-label={`Open ${attachment.name}`}
      >
        {enablePreview && src ? (
          <img
            src={src}
            alt={attachment.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : enablePreview && isLoading ? (
          <div className="text-[10px] text-muted-foreground">Loading…</div>
        ) : (
          <Icon className="h-8 w-8 text-muted-foreground" />
        )}

        {slotTopLeft && (
          <div className="absolute top-1 left-1">{slotTopLeft}</div>
        )}

        {(onRemove || onDownload) && (
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onDownload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(attachment);
                }}
                className="p-1 rounded bg-background/90 text-muted-foreground hover:text-foreground"
                aria-label={`Download ${attachment.name}`}
              >
                <Download className="w-3 h-3" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(attachment.id);
                }}
                className="p-1 rounded bg-background/90 text-muted-foreground hover:text-red-500"
                aria-label={`Remove ${attachment.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-0.5 leading-tight">
        <div className="text-[11px] truncate" title={attachment.name}>
          {attachment.name}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatFileSize(attachment.size)}
        </div>
      </div>
    </div>
  );
}
