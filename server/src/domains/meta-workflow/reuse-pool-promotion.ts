// server/src/domains/meta-workflow/reuse-pool-promotion.ts
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import type { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';

export interface PromoteInput {
  /** Final tag set after promotion. Auto-* tags will be stripped by the service. */
  newTags: string[];
  newName?: string;
  newDescription?: string;
}

const AUTO_TAG_PREFIXES = ['auto-generated', 'run-', 'phase-'];

function stripAutoTags(tags: string[]): string[] {
  return tags.filter((t) => !AUTO_TAG_PREFIXES.some((p) => t === p || t.startsWith(p)));
}

export class ReusePoolPromotionService {
  constructor(
    private poolRepo: MetaWorkflowReusePoolRepository,
    private subagentRepo: MetaSubagentTemplateRepository,
  ) {}

  promote(itemId: string, input: PromoteInput): ReusablePoolItem {
    const item = this.poolRepo.findById(itemId);
    if (!item) throw new Error(`Reuse pool item not found: ${itemId}`);

    const mergedTags = Array.from(new Set([
      ...stripAutoTags(item.tags),
      ...stripAutoTags(input.newTags),
    ]));

    const updated = this.poolRepo.update(itemId, {
      sourceType: 'user',
      tags: mergedTags,
      description: input.newDescription ?? item.description ?? null,
    });

    if (item.kind === 'subagent') {
      const tmpl = this.subagentRepo.findById(item.entityId);
      if (!tmpl) {
        throw new Error(`Linked subagent template not found: ${item.entityId}`);
      }
      this.subagentRepo.update(item.entityId, {
        sourceType: 'user',
        name: input.newName ?? tmpl.name ?? null,
        updatedAt: Date.now(),
      });
    }

    return updated;
  }
}
