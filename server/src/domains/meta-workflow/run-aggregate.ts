// server/src/domains/meta-workflow/run-aggregate.ts
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
import { assertRunTransition, assertRunStatusIn } from './status-machine.js';

export interface CreateRunInput {
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

export class MetaWorkflowRunAggregate {
  constructor(private repo: MetaWorkflowRunRepository) {}

  create(input: CreateRunInput): MetaWorkflowRun {
    const now = Date.now();
    return this.repo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: 'requirement_draft',
      rejectCount: 0,
      defaultProviderId: input.defaultProviderId,
      createdAt: now,
      updatedAt: now,
    });
  }

  submitRequirements(runId: string, requirementsPath: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_draft'], 'submit requirements for');
    assertRunTransition(run.status, 'requirement_review');
    return this.repo.update(runId, {
      status: 'requirement_review',
      requirementsPath,
      updatedAt: Date.now(),
    });
  }

  approveRequirements(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_review'], 'approve requirements for');
    assertRunTransition(run.status, 'splitting');
    return this.repo.update(runId, { status: 'splitting', updatedAt: Date.now() });
  }

  rejectRequirements(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['requirement_review'], 'reject requirements for');
    assertRunTransition(run.status, 'requirement_draft');
    return this.repo.update(runId, {
      status: 'requirement_draft',
      rejectCount: run.rejectCount + 1,
      updatedAt: Date.now(),
    });
  }

  setPhasesJson(runId: string, phasesJson: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['splitting'], 'set phases.json for');
    assertRunTransition(run.status, 'executing');
    return this.repo.update(runId, {
      status: 'executing',
      phasesJson,
      updatedAt: Date.now(),
    });
  }

  enterReviewing(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['executing'], 'enter review for');
    assertRunTransition(run.status, 'reviewing');
    return this.repo.update(runId, { status: 'reviewing', updatedAt: Date.now() });
  }

  complete(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    assertRunStatusIn(run.status, ['reviewing'], 'complete');
    assertRunTransition(run.status, 'completed');
    const now = Date.now();
    return this.repo.update(runId, { status: 'completed', completedAt: now, updatedAt: now });
  }

  cancel(runId: string): MetaWorkflowRun {
    const run = this.requireRun(runId);
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error(`Cannot cancel run in terminal status '${run.status}'`);
    }
    assertRunTransition(run.status, 'cancelled');
    const now = Date.now();
    return this.repo.update(runId, { status: 'cancelled', completedAt: now, updatedAt: now });
  }

  private requireRun(runId: string): MetaWorkflowRun {
    const run = this.repo.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }
}
