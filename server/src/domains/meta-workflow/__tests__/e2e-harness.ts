// server/src/domains/meta-workflow/__tests__/e2e-harness.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowService, type WorktreeAllocator } from '../service.js';
import type { AiRunPort, AiRunPortStartArgs } from '../run-entities/subagent-run-entity.js';

export interface AiRecorded {
  input: string;
  workingDirectory?: string;
  providerId?: string;
}

export interface AiResponder {
  /** content fragments to emit via `onMessage({ kind: 'assistant', content })` */
  fragments: string[];
  /** terminal kind to emit last — defaults to 'run_completed' */
  terminalKind?: string;
}

export interface HarnessOptions {
  /** Response queue for `aiRunPort.startVirtualRun`. Each call shifts one entry. */
  aiResponses?: AiResponder[];
  /** Default response when the queue is empty. Defaults to a `run_completed` with empty content. */
  fallbackResponse?: AiResponder;
}

export interface Harness {
  db: Database.Database;
  service: MetaWorkflowService;
  /** Absolute path to the real git repo on disk. */
  gitRepo: string;
  /** All AI calls in invocation order. */
  aiCalls: AiRecorded[];
  /** Resolves any pending acquire() then explicitly releases the worktree slot. */
  cleanup: () => void;
}

export function buildHarness(opts: HarnessOptions = {}): Harness {
  // 1. SQLite + projects table + migration.
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');

  // 2. Real on-disk git repo so execFile('git', …) calls inside evaluateImpact
  //    succeed in this cwd.
  const gitRepo = mkdtempSync(join(tmpdir(), 'meta-wf-e2e-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: gitRepo });
  execFileSync('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: gitRepo });
  execFileSync('git', ['config', 'user.name', 'E2E Bot'], { cwd: gitRepo });
  writeFileSync(join(gitRepo, 'README.md'), '# e2e seed\n');
  execFileSync('git', ['add', '.'], { cwd: gitRepo });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: gitRepo });

  // 3. Worktree allocator that returns the same repo path for every phase.
  const allocator: WorktreeAllocator = {
    acquire: async () => gitRepo,
    release: async () => undefined,
    releaseRun: async () => undefined,
  };

  // 4. Recording + queued mock AI port.
  const aiCalls: AiRecorded[] = [];
  const queue: AiResponder[] = opts.aiResponses ? [...opts.aiResponses] : [];
  const fallback = opts.fallbackResponse ?? { fragments: [], terminalKind: 'run_completed' };
  const aiRunPort: AiRunPort = {
    async startVirtualRun(args: AiRunPortStartArgs): Promise<void> {
      aiCalls.push({
        input: args.input,
        workingDirectory: args.workingDirectory,
        providerId: args.providerId,
      });
      const responder = queue.shift() ?? fallback;
      for (const frag of responder.fragments) {
        args.onMessage?.({ kind: 'assistant', content: frag });
      }
      args.onMessage?.({ kind: responder.terminalKind ?? 'run_completed' });
    },
  };

  // 5. Run entities — both succeed; phase artifacts are produced by the executor.
  const runEntityForWorkflow = async () => ({ exitOk: true });
  const runEntityForSubagent = async () => ({ exitOk: true });

  const service = new MetaWorkflowService({
    db,
    runEntityForWorkflow,
    runEntityForSubagent,
    worktreeAllocator: allocator,
    aiRunPort,
  });

  return {
    db,
    service,
    gitRepo,
    aiCalls,
    cleanup() {
      db.close();
      try { rmSync(gitRepo, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/** Helper: minimal phases.json with N sequential phases A,B,C,… each depending on the prior. */
export function buildLinearPhasesJson(count: number): string {
  if (count < 1 || count > 26) throw new Error('count must be 1..26');
  const letters = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  return JSON.stringify({
    version: '1',
    phases: letters.map((id, idx) => ({
      id,
      name: id,
      description: `Phase ${id}`,
      phaseType: 'code-implement',
      dependsOn: idx === 0 ? [] : [letters[idx - 1]],
      inputs: [],
      outputs: [{ kind: 'commit', description: `${id} commit` }],
      acceptanceGates: [{
        id: 'g',
        description: 'always pass',
        command: 'true',
        expect: { exitCode: 0 },
      }],
    })),
    smokePath: letters,
    metadata: { generatedAt: 0, requirementsPath: 'design/requirements.md' },
  });
}
