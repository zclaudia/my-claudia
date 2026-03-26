/**
 * Test script to observe what Codex SDK actually sends in item.updated events.
 * Run: npx tsx scripts/test-codex-events.ts
 *
 * This will start a Codex thread with a simple prompt and log every event,
 * focusing on whether agent_message text is accumulated or incremental.
 */

import { Codex } from '@openai/codex-sdk';

async function main() {
  // Accept optional --old flag to use the 0.115 binary for comparison
  const useOld = process.argv.includes('--old');
  const oldBinaryPath = '/Users/haozhang/SourceCode/zhvala/my-claudia/node_modules/.pnpm/@openai+codex@0.115.0-darwin-arm64/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex';

  const codex = useOld
    ? new Codex({ codexPathOverride: oldBinaryPath })
    : new Codex();

  if (useOld) console.log('>>> Using OLD codex binary (0.115.0)\n');
  else console.log('>>> Using CURRENT codex binary\n');

  const thread = codex.startThread({
    model: undefined, // use default
  });

  const prompt = 'Write a 200-word essay about the history of computing. Include details about early pioneers like Ada Lovelace and Alan Turing.';

  console.log('=== Starting Codex thread ===');
  console.log(`Prompt: ${prompt}\n`);

  const { events } = await thread.runStreamed(prompt);

  // Track accumulated text per item to compare
  const accumulatedByItem = new Map<string, string>();

  for await (const event of events) {
    const ts = new Date().toISOString().slice(11, 23);

    switch (event.type) {
      case 'thread.started':
        console.log(`[${ts}] thread.started — id: ${event.thread_id}`);
        break;

      case 'turn.started':
        console.log(`[${ts}] turn.started`);
        break;

      case 'item.started': {
        const item = event.item;
        const id = 'id' in item ? item.id : 'N/A';
        console.log(`[${ts}] item.started — type: ${item.type}, id: ${id}`);
        if (item.type === 'agent_message' || item.type === 'reasoning') {
          console.log(`  text (${item.text.length} chars): ${JSON.stringify(item.text)}`);
          accumulatedByItem.set(id, item.text);
        }
        break;
      }

      case 'item.updated': {
        const item = event.item;
        const id = 'id' in item ? item.id : 'N/A';
        if (item.type === 'agent_message' || item.type === 'reasoning') {
          const prev = accumulatedByItem.get(id) || '';
          const text = item.text;
          const isAccumulated = text.startsWith(prev) && text.length >= prev.length;
          const isIncremental = !isAccumulated;

          console.log(`[${ts}] item.updated — type: ${item.type}, id: ${id}`);
          console.log(`  text (${text.length} chars): ${JSON.stringify(text.slice(0, 200))}${text.length > 200 ? '...' : ''}`);
          console.log(`  prev (${prev.length} chars): ${JSON.stringify(prev.slice(0, 100))}${prev.length > 100 ? '...' : ''}`);
          console.log(`  → MODE: ${isAccumulated ? 'ACCUMULATED (startsWith prev)' : 'INCREMENTAL (delta)'}`);

          if (isAccumulated) {
            const delta = text.slice(prev.length);
            console.log(`  → delta: ${JSON.stringify(delta)}`);
            accumulatedByItem.set(id, text);
          } else {
            console.log(`  → delta (pass-through): ${JSON.stringify(text)}`);
            accumulatedByItem.set(id, prev + text);
          }
        } else {
          console.log(`[${ts}] item.updated — type: ${item.type}`);
        }
        break;
      }

      case 'item.completed': {
        const item = event.item;
        const id = 'id' in item ? item.id : 'N/A';
        console.log(`[${ts}] item.completed — type: ${item.type}, id: ${id}`);
        if (item.type === 'agent_message' || item.type === 'reasoning') {
          const prev = accumulatedByItem.get(id) || '';
          console.log(`  text (${item.text.length} chars): ${JSON.stringify(item.text.slice(0, 200))}`);
          console.log(`  prev accumulated (${prev.length} chars): ${JSON.stringify(prev.slice(0, 200))}`);
          console.log(`  → match: ${item.text === prev ? 'EXACT MATCH' : 'DIFFERS'}`);
          accumulatedByItem.delete(id);
        }
        break;
      }

      case 'turn.completed':
        console.log(`[${ts}] turn.completed — usage: ${JSON.stringify(event.usage)}`);
        break;

      case 'turn.failed':
        console.log(`[${ts}] turn.failed — error: ${event.error.message}`);
        break;

      case 'error':
        console.log(`[${ts}] error — ${event.message}`);
        break;

      default:
        console.log(`[${ts}] ${(event as { type: string }).type}`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
