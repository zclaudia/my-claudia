import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../server/src/domains/openspec/spec-validator.js';

const RUN_E2E = process.env.RUN_E2E_AI === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe.runIf(RUN_E2E)('Spec init E2E (real AI)', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'sample-init-project');

  it.todo('produces valid spec.md files for each detected capability');

  it('validates any existing spec.md fixtures with our validator', () => {
    const specsDir = path.join(fixturePath, 'openspec', 'specs');
    if (!fs.existsSync(specsDir)) return; // no prior run
    for (const cap of fs.readdirSync(specsDir)) {
      const md = fs.readFileSync(path.join(specsDir, cap, 'spec.md'), 'utf-8');
      const result = validateSpec(md);
      expect(result.valid, `cap ${cap}: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });
});
