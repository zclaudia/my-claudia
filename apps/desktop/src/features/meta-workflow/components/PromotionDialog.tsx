// apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  poolItemId?: string;
  socket: { send: (msg: string) => void };
}

export function PromotionDialog(_props: Props): React.ReactElement {
  return <div>PromotionDialog (stub — Task 11)</div>;
}
