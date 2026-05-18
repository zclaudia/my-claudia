// server/src/domains/meta-workflow/reuse-pool-search.ts
import type {
  PhaseDef,
  ReusablePoolItem,
  ExecuteEntity,
} from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import { getPhaseTemplate } from './phase-templates/index.js';

export interface ReuseSearchResult {
  item: ReusablePoolItem;
  score: number;
}

function tokenize(s: string | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const tok of a) if (b.has(tok)) n += 1;
  return n;
}

export class ReusePoolSearchService {
  constructor(
    private repo: MetaWorkflowReusePoolRepository,
    private limit = 5,
  ) {}

  search(phase: PhaseDef): ReuseSearchResult[] {
    const template = getPhaseTemplate(phase.phaseType);
    const expectedKind: ExecuteEntity = phase.executeEntity ?? template.defaultExecuteEntity;

    const candidates = this.repo
      .findByPhaseType(phase.phaseType)
      .filter((c) => c.kind === expectedKind);

    const queryTokens = tokenize(`${phase.name} ${phase.description}`);
    const scored = candidates.map((item) => ({
      item,
      score: tokenOverlap(queryTokens, tokenize(item.description)),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aIsUser = a.item.sourceType === 'user' ? 1 : 0;
      const bIsUser = b.item.sourceType === 'user' ? 1 : 0;
      if (aIsUser !== bIsUser) return bIsUser - aIsUser;
      const aUsage = a.item.metadata?.usageCount ?? 0;
      const bUsage = b.item.metadata?.usageCount ?? 0;
      if (bUsage !== aUsage) return bUsage - aUsage;
      return b.item.createdAt - a.item.createdAt;
    });

    return scored.slice(0, this.limit);
  }
}
