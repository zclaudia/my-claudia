import React from 'react';
import type { BootstrapScan } from '../../api.js';

interface Props {
  scan: BootstrapScan;
}

export function DiscoveringStep({ scan }: Props): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">🔍 Scanning project…</div>
      <div className="text-xs text-muted-foreground">
        AI is reading your codebase to identify capabilities. This usually takes 30 seconds to 2 minutes.
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-2">scan {scan.id.slice(0, 8)}</div>
    </div>
  );
}
