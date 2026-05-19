// apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function RequirementsScreen(_props: Props): React.ReactElement {
  return <div>RequirementsScreen (stub — Task 7)</div>;
}
