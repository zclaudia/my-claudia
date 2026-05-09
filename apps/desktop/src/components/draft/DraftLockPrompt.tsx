import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useAndroidBack } from '../../hooks/useAndroidBack';

export function DraftLockPrompt() {
  const {
    showLockPrompt,
    activeSessionId,
    lockedByDevice,
    dismissLockPrompt,
    forceOpen,
    openReadOnly,
  } = useDraftEditorStore();

  useAndroidBack(() => {
    if (showLockPrompt) dismissLockPrompt();
  }, showLockPrompt, 35);

  if (!showLockPrompt || !activeSessionId) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={dismissLockPrompt} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-base font-semibold">Draft Locked</h3>
          </div>
          <div className="px-4 py-4 text-sm text-muted-foreground">
            <p>This draft is being edited by another device{lockedByDevice ? ` (${lockedByDevice.slice(0, 8)})` : ''}.</p>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              onClick={dismissLockPrompt}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => openReadOnly(activeSessionId)}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
            >
              Read Only
            </button>
            <button
              onClick={() => forceOpen(activeSessionId)}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Force Edit
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
