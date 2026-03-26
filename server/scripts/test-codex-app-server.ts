/**
 * Test script to verify Codex App Server protocol produces streaming
 * item/agentMessage/delta events.
 *
 * Run: cd server && pnpm exec tsx scripts/test-codex-app-server.ts
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const CODEX_BIN = process.env.CODEX_PATH ||
  '/Users/haozhang/SourceCode/zhvala/my-claudia/node_modules/.pnpm/@openai+codex@0.116.0-darwin-arm64/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex';

let requestId = 0;

function nextId(): number {
  return ++requestId;
}

async function main() {
  const prompt = process.argv[2] || 'Write a short 3-sentence story about a cat.';

  console.log('=== Starting Codex App Server ===');
  console.log(`Binary: ${CODEX_BIN}`);
  console.log(`Prompt: ${prompt}\n`);

  // Spawn codex app-server on stdio
  const proc = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://', '--session-source', 'custom'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stderr?.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[stderr] ${text}`);
  });

  // JSON-RPC line reader
  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  // Pending request resolvers
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // Aggregated delta text for verification
  let deltaAccumulated = '';
  let deltaCount = 0;
  let completedText = '';

  function send(msg: Record<string, unknown>) {
    const line = JSON.stringify(msg);
    // console.log(`[→ send] ${line}`);
    proc.stdin!.write(line + '\n');
  }

  function sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = nextId();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  }

  // Process incoming lines
  const done = new Promise<void>((resolveDone) => {
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        console.warn(`[parse error] ${line.slice(0, 200)}`);
        return;
      }

      const ts = new Date().toISOString().slice(11, 23);

      // Response to our request
      if ('id' in msg && !('method' in msg)) {
        const id = msg.id as number;
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          if ('error' in msg) {
            p.reject(new Error(JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
        return;
      }

      // Server request (needs response from us)
      if ('id' in msg && 'method' in msg) {
        const method = msg.method as string;
        const id = msg.id as number;
        console.log(`[${ts}] SERVER REQUEST: ${method}`);
        console.log(`  params: ${JSON.stringify(msg.params).slice(0, 300)}`);

        // Auto-approve everything for testing
        if (method.includes('Approval') || method.includes('approval')) {
          console.log(`  → auto-approving`);
          send({ id, result: { approved: true } });
        } else {
          // Unknown request, respond with empty result
          send({ id, result: {} });
        }
        return;
      }

      // Notification (no id)
      const method = msg.method as string;
      const params = msg.params as Record<string, unknown> || {};

      switch (method) {
        case 'item/agentMessage/delta': {
          const delta = params.delta as string;
          deltaAccumulated += delta;
          deltaCount++;
          if (deltaCount <= 5 || deltaCount % 20 === 0) {
            console.log(`[${ts}] item/agentMessage/delta #${deltaCount}: ${JSON.stringify(delta).slice(0, 80)}`);
          }
          break;
        }

        case 'item/started': {
          const item = params.item as Record<string, unknown>;
          console.log(`[${ts}] item/started — type: ${item?.type}, id: ${item?.id || 'N/A'}`);
          break;
        }

        case 'item/completed': {
          const item = params.item as Record<string, unknown>;
          console.log(`[${ts}] item/completed — type: ${item?.type}, id: ${item?.id || 'N/A'}`);
          if (item?.type === 'message' || item?.type === 'agent_message') {
            completedText = (item.text as string) || '';
            console.log(`  text (${completedText.length} chars): ${JSON.stringify(completedText.slice(0, 200))}...`);
          }
          break;
        }

        case 'turn/started':
          console.log(`[${ts}] turn/started — turnId: ${params.turnId}`);
          break;

        case 'turn/completed': {
          console.log(`[${ts}] turn/completed — usage: ${JSON.stringify(params.usage)}`);
          console.log(`\n=== STREAMING SUMMARY ===`);
          console.log(`Delta events received: ${deltaCount}`);
          console.log(`Accumulated delta text (${deltaAccumulated.length} chars): ${JSON.stringify(deltaAccumulated.slice(0, 300))}...`);
          console.log(`Completed text (${completedText.length} chars): ${JSON.stringify(completedText.slice(0, 300))}...`);
          console.log(`Match: ${deltaAccumulated === completedText ? 'EXACT MATCH ✓' : 'DIFFERS ✗'}`);
          console.log(`Streaming: ${deltaCount > 1 ? 'YES ✓' : 'NO ✗ (single batch)'}`);
          resolveDone();
          break;
        }

        case 'item/reasoning/textDelta':
        case 'item/reasoning/summaryTextDelta':
          console.log(`[${ts}] ${method}: ${JSON.stringify((params.delta || params.text || '').toString().slice(0, 80))}`);
          break;

        case 'item/commandExecution/outputDelta':
          console.log(`[${ts}] ${method}: ${JSON.stringify((params.delta || '').toString().slice(0, 80))}`);
          break;

        default:
          if (!method.startsWith('thread/status') && !method.startsWith('account/')) {
            console.log(`[${ts}] ${method}: ${JSON.stringify(params).slice(0, 200)}`);
          }
          break;
      }
    });

    rl.on('close', () => {
      console.log('\n[process closed]');
      resolveDone();
    });
  });

  // === Protocol flow ===

  // 1. Initialize
  console.log('[→] initialize');
  const initResult = await sendRequest('initialize', {
    clientInfo: { name: 'my-claudia-test', version: '0.0.1' },
  });
  console.log(`[←] initialize result: ${JSON.stringify(initResult).slice(0, 200)}\n`);

  // 2. Start thread
  console.log('[→] thread/start');
  const threadResult = await sendRequest('thread/start', {
    cwd: process.cwd(),
  }) as Record<string, unknown>;
  console.log(`[←] thread/start result: ${JSON.stringify(threadResult).slice(0, 300)}`);
  // threadId may be at result.threadId, result.thread.id, or result.id
  const threadId = (threadResult?.threadId as string)
    || (threadResult?.thread as Record<string, unknown>)?.id as string
    || (threadResult?.id as string);
  console.log(`[←] threadId: ${threadId}\n`);

  // 3. Start turn with user input
  console.log('[→] turn/start');
  sendRequest('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt }],
  }).catch((err) => {
    console.error(`[turn/start error] ${err.message}`);
  });

  // Wait for turn/completed
  await done;

  // Cleanup
  proc.kill('SIGTERM');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
