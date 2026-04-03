#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const nodeVersionFile = path.join(repoRoot, '.node-version');

function normalize(version) {
  return version.trim().replace(/^v/, '');
}

function readExpectedVersion() {
  return normalize(fs.readFileSync(nodeVersionFile, 'utf8'));
}

function isCompatible(current, expected) {
  return current === expected;
}

const expected = readExpectedVersion();
const current = normalize(process.version);

if (!isCompatible(current, expected)) {
  const message = [
    `Node version mismatch: expected ${expected}, current ${current}.`,
    'Use the project runtime before installing dependencies or running tests.',
    `Suggested fix: eval "$(fnm env)" && fnm use ${expected}`,
    `Or run one-off: fnm exec --using ${expected} pnpm test`,
  ].join('\n');

  console.error(message);
  process.exit(1);
}
