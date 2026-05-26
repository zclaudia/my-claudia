// apps/desktop/src/features/openspec/components/init/ReviewStep.tsx
//
// Placeholder — real implementation lands in Task 29.

import React from 'react';
import type { BootstrapScan } from '../../api.js';

export function ReviewStep({
  scan: _scan,
  onClose: _onClose,
}: {
  scan: BootstrapScan;
  onClose: () => void;
}): React.ReactElement {
  return <div className="text-sm">TODO: ReviewStep</div>;
}
