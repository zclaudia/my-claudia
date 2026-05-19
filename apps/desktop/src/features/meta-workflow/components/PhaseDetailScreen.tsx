// apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  phaseId?: string;
  socket: { send: (msg: string) => void };
}

export function PhaseDetailScreen(_props: Props): React.ReactElement {
  return <div>PhaseDetailScreen (stub — Task 10)</div>;
}
