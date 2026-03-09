import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validatePlanMarkdownContent,
  validatePlanFile,
} from '../plan-validator.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs and path modules
vi.mock('fs');
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

describe('plan-validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validatePlanMarkdownContent', () => {
    it('returns ready=true when all required sections are present', () => {
      const validPlan = `
# Goal
This is the goal.

# Scope
This is the scope.

# Steps
1. Step one
2. Step two

# Verification
- Check 1
- Check 2
`;

      const result = validatePlanMarkdownContent(validPlan, '/path/to/plan.md');

      expect(result.exists).toBe(true);
      expect(result.ready).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns missing sections list when sections are absent', () => {
      const incompletePlan = `
# Goal
Missing other sections.
`;

      const result = validatePlanMarkdownContent(incompletePlan, '/path/to/plan.md');

      expect(result.exists).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.missing).toContain('scope');
      expect(result.missing).toContain('steps');
      expect(result.missing).toContain('verification');
    });

    it('calculates score based on required sections', () => {
      const partialPlan = `
# Goal
This is the goal.

# Scope
This is the scope.
`;

      const result = validatePlanMarkdownContent(partialPlan, '/path/to/plan.md');

      // 2/4 required sections = 40/80 points
      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.score).toBeLessThan(80);
    });

    it('adds points for optional sections', () => {
      const planWithOptional = `
# Goal
This is a detailed goal description that provides clear direction for the implementation work.

# Scope
The scope defines the boundaries of the work, including what is in scope and out of scope.

# Steps
1. First step with detailed explanation
2. Second step with implementation details
3. Third step with verification approach

# Verification
- Verify the implementation works correctly
- Check all edge cases are handled

# Risks
Potential risks that could impact the implementation timeline or quality of deliverables.

# Assumptions
Key assumptions made during planning that should be validated during implementation.
`;

      const result = validatePlanMarkdownContent(planWithOptional, '/path/to/plan.md');

      // All required (80) + all optional (15) + content length (5) = 100
      expect(result.score).toBe(100);
    });

    it('adds 5 points for content length >= 250', () => {
      const longPlan = `
# Goal
${'A'.repeat(100)}

# Scope
${'B'.repeat(100)}

# Steps
${'C'.repeat(100)}

# Verification
${'D'.repeat(100)}
`;

      const result = validatePlanMarkdownContent(longPlan, '/path/to/plan.md');

      // All required (80) + content length (5) = 85
      expect(result.score).toBe(85);
    });

    it('caps score at 100', () => {
      const veryLongPlan = `
# Goal
${'A'.repeat(500)}

# Scope
${'B'.repeat(500)}

# Steps
${'C'.repeat(500)}

# Verification
${'D'.repeat(500)}

# Risks
${'E'.repeat(500)}

# Assumptions
${'F'.repeat(500)}
`;

      const result = validatePlanMarkdownContent(veryLongPlan, '/path/to/plan.md');

      expect(result.score).toBe(100);
    });

    it('handles h1, h2, h3 headings', () => {
      const planWithMixedHeadings = `
# Goal
Goal here.

## Scope
Scope here.

### Steps
Steps here.

# Verification
Verification here.
`;

      const result = validatePlanMarkdownContent(planWithMixedHeadings, '/path/to/plan.md');

      expect(result.ready).toBe(true);
    });

    it('handles Chinese colons in headings', () => {
      const planWithChineseColons = `
# Goal：目标
This is the goal.

# Scope：范围
This is the scope.

# Steps：步骤
1. Step one

# Verification：验证
- Check 1
`;

      const result = validatePlanMarkdownContent(planWithChineseColons, '/path/to/plan.md');

      expect(result.ready).toBe(true);
    });

    it('handles empty content', () => {
      const result = validatePlanMarkdownContent('', '/path/to/plan.md');

      expect(result.exists).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.missing).toContain('goal');
    });

    it('handles content without headings', () => {
      const result = validatePlanMarkdownContent(
        'Just some text without any headings.',
        '/path/to/plan.md'
      );

      expect(result.ready).toBe(false);
      expect(result.missing.length).toBe(4);
    });
  });

  describe('validatePlanFile', () => {
    it('returns exists=false for non-existent file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = validatePlanFile('/project/root', 'task-123');

      expect(result.exists).toBe(false);
      expect(result.ready).toBe(false);
      expect(result.score).toBe(0);
      expect(result.missing).toContain('plan_file');
    });

    it('reads and validates existing file', () => {
      const validPlan = `
# Goal
Goal here.

# Scope
Scope here.

# Steps
Steps here.

# Verification
Verification here.
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(validPlan);

      const result = validatePlanFile('/project/root', 'task-123');

      expect(result.exists).toBe(true);
      expect(result.ready).toBe(true);
    });

    it('constructs correct path to plan file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      validatePlanFile('/project/root', 'task-123');

      expect(path.join).toHaveBeenCalledWith(
        '/project/root',
        '.supervision',
        'plans',
        'task-task-123.plan.md'
      );
    });
  });
});
