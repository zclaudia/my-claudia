import { useFilePushStore, type FilePushItem } from '../../stores/filePushStore';
import { downloadPushedFile, formatFileSize, openFile, openFileAndroid, openFolder, isAndroid } from '../../services/fileDownload';

/** Icon based on MIME type */
function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType === 'application/vnd.android.package-archive') {
    // Android APK icon
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    );
  }
  // Default file icon
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

export function FilePushCard({ item }: { item: FilePushItem }) {
  const handleDownload = () => {
    if (item.status === 'downloading') return;
    downloadPushedFile(item.fileId);
  };

  const handleDismiss = () => {
    useFilePushStore.getState().removeItem(item.fileId);
  };

  const isAutoCompleted = item.autoDownload && item.status === 'completed';

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* File icon */}
        <div className="flex-shrink-0 text-muted-foreground">
          <FileIcon mimeType={item.mimeType} />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{item.fileName}</div>
          <div className="text-xs text-muted-foreground">
            {formatFileSize(item.fileSize)}
            {item.description && <> &middot; {item.description}</>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.status === 'pending' && (
            <button
              onClick={handleDownload}
              className="px-3 py-1 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded transition-colors"
            >
              Download
            </button>
          )}

          {item.status === 'downloading' && (
            <span className="text-xs text-muted-foreground">
              {item.downloadProgress}%
            </span>
          )}

          {item.status === 'completed' && (
            <div className="flex items-center gap-1.5">
              {item.savedPath ? (
                <>
                  {/* Open file with default app */}
                  <button
                    onClick={() => isAndroid()
                      ? openFileAndroid(item.savedPath!, item.mimeType)
                      : openFile(item.savedPath!)}
                    className="px-2 py-0.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    title="Open file"
                  >
                    Open
                  </button>
                  {/* Show in Finder/Explorer (desktop only) */}
                  {!isAndroid() && (
                    <button
                      onClick={() => openFolder(item.savedPath!)}
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      title="Show in folder"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {isAutoCompleted ? 'Saved' : 'Downloaded'}
                </div>
              )}
            </div>
          )}

          {item.status === 'error' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">{item.error || 'Failed'}</span>
              <button
                onClick={handleDownload}
                className="px-2 py-0.5 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Dismiss button */}
          {(item.status === 'completed' || item.status === 'error') && (
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (shown during download) */}
      {item.status === 'downloading' && (
        <div className="h-1 bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${item.downloadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface FilePushNotificationListProps {
  sessionId: string;
}

export function FilePushNotificationList({ sessionId }: FilePushNotificationListProps) {
  const items = useFilePushStore((state) =>
    state.items.filter((i) => i.sessionId === sessionId)
  );

  if (items.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 max-w-full md:max-w-3xl">
      {items.map((item) => (
        <FilePushCard key={item.fileId} item={item} />
      ))}
    </div>
  );
}
