import { useEffect, useState } from 'react';
import { fetchAttachmentBlobUrl } from '../api';

export interface UseAttachmentSrcResult {
  src: string | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolve an attachment's bytes into a blob URL suitable for `<img>` /
 * `<video>` / `<audio>` consumption. We can't use the raw endpoint directly
 * because gateway-mode requests need an Authorization header and `<img>`
 * doesn't carry one.
 */
export function useAttachmentSrc(
  id: string | null | undefined,
  enabled: boolean = true,
): UseAttachmentSrcResult {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !id) {
      setSrc(null);
      return;
    }

    let revoked = false;
    let url: string | null = null;
    setIsLoading(true);
    setError(null);

    fetchAttachmentBlobUrl(id)
      .then((blobUrl) => {
        if (revoked) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        url = blobUrl;
        setSrc(blobUrl);
      })
      .catch((err) => {
        if (revoked) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!revoked) setIsLoading(false);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, enabled]);

  return { src, isLoading, error };
}
