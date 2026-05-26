// apps/desktop/src/features/openspec/components/init/CapabilityPicker.tsx
//
// Placeholder — real implementation lands in Task 27.

import React from 'react';
import type { BootstrapScan } from '../../api.js';

export function CapabilityPicker({
  scan: _scan,
  onClose: _onClose,
}: {
  scan: BootstrapScan;
  onClose: () => void;
}): React.ReactElement {
  return <div className="text-sm">TODO: CapabilityPicker</div>;
}
