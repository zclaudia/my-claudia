// apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function PhaseBoardScreen(_props: Props): React.ReactElement {
  return <div>PhaseBoardScreen (stub — Task 8)</div>;
}
