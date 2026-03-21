import { describe, expect, it } from 'vitest';
import { parseSkillFile } from '../skill-tools.js';

describe('plugins/skill-tools', () => {
  describe('parseSkillFile', () => {
    it('parses frontmatter with CRLF newlines and typed nested fields', () => {
      const content = [
        '---',
        'name: review-helper',
        'description: Review pull requests',
        'priority: -1',
        'triggers:',
        '  keywords:',
        '    - review',
        '    - pr',
        '  projectType:',
        '    - code',
        'requires:',
        '  binaries:',
        '    - git',
        '  env:',
        '    - GITHUB_TOKEN',
        'metadata:',
        '  short-description: ignored',
        '---',
        '',
        '# Review Helper',
        '',
        '> Uses review workflow',
      ].join('\r\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter).toEqual({
        name: 'review-helper',
        description: 'Review pull requests',
        priority: -1,
        triggers: {
          keywords: ['review', 'pr'],
          projectType: ['code'],
        },
        requires: {
          binaries: ['git'],
          env: ['GITHUB_TOKEN'],
        },
      });
      expect(parsed.body).toContain('# Review Helper');
      expect(parsed.body).toContain('> Uses review workflow');
    });

    it('does not confuse body separators with frontmatter boundaries', () => {
      const content = [
        '---',
        'name: separator-safe',
        'description: Keeps body separators intact',
        '---',
        '',
        '# Heading',
        '',
        '---',
        '',
        'Body content',
      ].join('\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter.name).toBe('separator-safe');
      expect(parsed.body).toContain('\n---\n');
      expect(parsed.body).toContain('Body content');
    });

    it('falls back gracefully when frontmatter YAML is invalid', () => {
      const content = [
        '---',
        'name: [oops',
        'description: broken yaml',
        '---',
        '',
        '# Fallback Name',
      ].join('\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter).toEqual({});
      expect(parsed.body).toBe(content);
    });
  });
});
