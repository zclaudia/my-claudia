// server/src/domains/issue-orchestration/anonymous-issue-service.ts
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { IssueLifecycle } from './issue-lifecycle.js';

export interface CreateAnonymousInput {
  projectId: string;
  title: string;
}

export class AnonymousIssueService {
  constructor(private lifecycle: IssueLifecycle) {}

  /** Create an anonymous sub-issue (X2 quick path). */
  createAnonymous(input: CreateAnonymousInput): { issue: LocalIssue; specChange: SpecChange } {
    return this.lifecycle.createSubIssue({
      projectId: input.projectId,
      type: 'implement',
      title: input.title,
      isAnonymous: true,
    });
  }
}
