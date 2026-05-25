// apps/desktop/src/features/openspec/components/LegacyBadge.tsx
//
// Small amber pill marking Classic ProjectChange / MetaWorkflowRun records
// that were created before OpenSpec integration (i.e., no executor_instances
// row points at them via underlyingId). New work should go through OpenSpec.

import React from 'react';

export function LegacyBadge(): React.ReactElement {
  return (
    <span
      className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-600 font-medium"
      title="Created before Spec integration — new work should go through Spec"
    >
      Legacy
    </span>
  );
}
