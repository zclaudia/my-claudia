import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Attachment } from '@my-claudia/shared';
import { useAttachmentSrc } from '../hooks/useAttachmentSrc';

interface ImageLightboxProps {
  attachment: Attachment;
  onClose: () => void;
}

export function ImageLightbox({ attachment, onClose }: ImageLightboxProps) {
  const { src, isLoading, error } = useAttachmentSrc(attachment.id, true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={`Preview ${attachment.name}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute top-4 right-4 p-2 rounded-full bg-background/20 text-white hover:bg-background/40"
        onClick={onClose}
        aria-label="Close preview"
      >
        <X className="w-5 h-5" />
      </button>

      <div
        className="max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {src ? (
          <img
            src={src}
            alt={attachment.name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : isLoading ? (
          <div className="text-white">Loading…</div>
        ) : error ? (
          <div className="text-red-400">Failed to load image</div>
        ) : null}
      </div>
    </div>
  );
}
