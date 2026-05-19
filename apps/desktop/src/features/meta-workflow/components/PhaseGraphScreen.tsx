// apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function PhaseGraphScreen(_props: Props): React.ReactElement {
  return <div>PhaseGraphScreen (stub — Task 9)</div>;
}
