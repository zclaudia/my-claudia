import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { AIReviewCliJobResult } from '../src/providers/cli-jobs/types.js';
import { runAIReviewCliJob, supportsAIReviewCliJob } from '../src/providers/cli-jobs/review-job.js';

const AI_REVIEW_SYSTEM_PROMPT = [
  'You are a machine-only security review helper for a coding assistant.',
  'Follow the user prompt exactly.',
  'Do not add markdown, commentary, prose, or code fences.',
  'Return only the JSON object requested by the prompt.',
].join(' ');

const DEFAULT_PROVIDER_PATHS: Record<string, string> = {
  claude: '/opt/homebrew/bin/claude',
  codex: '/opt/homebrew/bin/codex',
  cursor: '/Users/zhvala/.local/bin/cursor-agent',
  kimi: '/Users/zhvala/.local/bin/kimi',
  opencode: '/Users/zhvala/.opencode/bin/opencode',
};

function getDataDbPath(): string {
  const dataDir = process.env.MY_CLAUDIA_DATA_DIR
    ? resolve(process.env.MY_CLAUDIA_DATA_DIR)
    : resolve(process.env.HOME || '', '.my-claudia');
  return resolve(dataDir, 'data.db');
}

function loadConfiguredCliPaths(): Record<string, string> {
  const dbPath = getDataDbPath();
  if (!existsSync(dbPath)) return {};

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT type, cli_path as cliPath FROM providers WHERE cli_path IS NOT NULL AND cli_path != ''").all() as Array<{
      type: string;
      cliPath: string;
    }>;
    return Object.fromEntries(rows.map((row) => [row.type, row.cliPath]));
  } finally {
    db.close();
  }
}

function summarize(text: string | undefined, maxLength = 600): string {
  if (!text) return '(empty)';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function buildReviewPrompt(command: string): string {
  return `You are a security analyzer for a coding assistant. Analyze whether this tool call should be automatically approved, denied, or left uncertain.

<tool_call>
<tool_name>Bash</tool_name>
<detail>${command}</detail>
<input>{
  "command": ${JSON.stringify(command)}
}</input>
</tool_call>

Reply with ONLY one JSON object:
{"type":"final","decision":"approve"|"deny"|"uncertain","reasoning":"one sentence explanation","confidence":0.0}`;
}

async function main(): Promise<void> {
  const dbPath = getDataDbPath();
  const configuredPaths = loadConfiguredCliPaths();
  const requestedProviders = process.argv.slice(2);
  const providerTypes = (requestedProviders.length > 0
    ? requestedProviders
    : ['kimi', 'claude', 'cursor', 'opencode', 'codex']
  ).filter((providerType) => supportsAIReviewCliJob(providerType));

  const cwd = process.cwd();
  const command = process.env.MY_CLAUDIA_REVIEW_TEST_COMMAND || 'adb install app.apk';

  console.log(`Testing cli-review jobs in ${cwd}`);
  console.log(`Command under review: ${command}`);
  console.log(`Provider DB: ${dbPath}`);

  let failures = 0;

  for (const providerType of providerTypes) {
    const envOverride = process.env[`MY_CLAUDIA_${providerType.toUpperCase()}_CLI_PATH`];
    const configuredPath = configuredPaths[providerType];
    const defaultPath = DEFAULT_PROVIDER_PATHS[providerType];
    const cliPath = envOverride || configuredPath || defaultPath;
    const cliPathSource = envOverride ? 'env' : configuredPath ? 'db' : 'default';
    const startedAt = Date.now();

    if (!cliPath || !existsSync(cliPath)) {
      failures += 1;
      console.log(`\n[${providerType}] SKIP`);
      console.log(`  cliPath: ${cliPath || '(missing)'}`);
      console.log(`  cliPathSource: ${cliPathSource}`);
      console.log('  reason: CLI binary not found');
      continue;
    }

    try {
      const result = await runAIReviewCliJob(providerType, {
        prompt: buildReviewPrompt(command),
        cwd,
        cliPath,
        systemPrompt: AI_REVIEW_SYSTEM_PROMPT,
        timeoutMs: 120000,
      }) as AIReviewCliJobResult;
      const elapsedMs = Date.now() - startedAt;
      console.log(`\n[${providerType}] OK`);
      console.log(`  cliPath: ${cliPath}`);
      console.log(`  cliPathSource: ${cliPathSource}`);
      console.log(`  decision: ${result.decision}`);
      console.log(`  confidence: ${result.confidence}`);
      console.log(`  reasoning: ${result.reasoning}`);
      console.log(`  elapsedMs: ${elapsedMs}`);
      console.log(`  stdoutSummary: ${summarize(result.rawStdout)}`);
      console.log(`  stderrSummary: ${summarize(result.rawStderr)}`);
    } catch (error) {
      failures += 1;
      const elapsedMs = Date.now() - startedAt;
      console.log(`\n[${providerType}] FAIL`);
      console.log(`  cliPath: ${cliPath}`);
      console.log(`  cliPathSource: ${cliPathSource}`);
      console.log(`  elapsedMs: ${elapsedMs}`);
      console.log(`  error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
