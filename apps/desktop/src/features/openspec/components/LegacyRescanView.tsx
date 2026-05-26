// apps/desktop/src/features/openspec/components/LegacyRescanView.tsx
//
// Placeholder — real implementation lands in Task 30. The legacy single-phase
// rescan UI (approve/reject pending review_items) will be moved here from the
// pre-refactor InitializeSpecsDialog.

import React from 'react';

export function LegacyRescanView({
  scanId: _scanId,
  onClose: _onClose,
}: {
  scanId: string;
  onClose: () => void;
}): React.ReactElement {
  return <div className="text-sm">TODO: LegacyRescanView</div>;
}
