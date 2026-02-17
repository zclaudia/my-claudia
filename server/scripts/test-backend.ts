#!/usr/bin/env npx tsx
/**
 * CLI tool to test backend WebSocket/REST communication.
 *
 * Usage:
 *   pnpm --filter @my-claudia/server exec tsx scripts/test-backend.ts [options]
 *
 * Options:
 *   --url <base-url>     Base URL (default: http://localhost:3100)
 *   --session <id>       Session ID to chat with
 *   --message <text>     Message to send (default: "say hi in one word")
 *   --list-sessions      List all sessions then exit
 *   --list-providers     List all providers then exit
 *   --timeout <ms>       Timeout in ms (default: 60000)
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const args = process.argv.slice(2);
function getArg(name: string, defaultVal?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return defaultVal;
  return args[i + 1] || defaultVal;
}
function hasFlag(name: string): boolean {
  return args.indexOf(`--${name}`) !== -1;
}

const baseUrl = getArg('url', 'http://localhost:3100')!;
const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
const sessionId = getArg('session');
const message = getArg('message', 'say hi in one word')!;
const timeout = parseInt(getArg('timeout', '60000')!, 10);
const listSessions = hasFlag('list-sessions');
const listProviders = hasFlag('list-providers');

if (!listSessions && !listProviders && !sessionId) {
  console.log(`Usage:
  pnpm --filter @my-claudia/server exec tsx scripts/test-backend.ts --list-sessions [--url http://host:3100]
  pnpm --filter @my-claudia/server exec tsx scripts/test-backend.ts --list-providers [--url http://host:3100]
  pnpm --filter @my-claudia/server exec tsx scripts/test-backend.ts --session <id> [--message "text"] [--url http://host:3100]
`);
  process.exit(1);
}

// --- REST helpers ---

async function fetchJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function doListSessions() {
  const data = await fetchJson('/api/sessions');
  const sessions = data.data || data;
  console.log('Sessions:');
  for (const s of sessions) {
    const provider = s.providerId ? ` [provider: ${s.providerId}]` : '';
    console.log(`  ${s.id}  ${s.name || '(unnamed)'}${provider}`);
  }
  console.log(`\nTotal: ${sessions.length}`);
}

async function doListProviders() {
  const data = await fetchJson('/api/providers');
  const providers = data.data || data;
  console.log('Providers:');
  for (const p of providers) {
    console.log(`  ${p.id}  ${p.name} (${p.type}) ${p.isDefault ? '[default]' : ''}`);
  }
  console.log(`\nTotal: ${providers.length}`);
}

// --- Handle list commands via REST ---

if (listSessions || listProviders) {
  (async () => {
    try {
      if (listSessions) await doListSessions();
      if (listProviders) await doListProviders();
    } catch (e: any) {
      console.error('Error:', e.message);
      process.exit(1);
    }
  })();
} else {
  // --- Chat via WebSocket ---
  startChat();
}

function startChat() {
  console.log(`Connecting to ${wsUrl} ...`);
  const ws = new WebSocket(wsUrl);
  let done = false;

  function finish(code = 0) {
    done = true;
    ws.close();
    setTimeout(() => process.exit(code), 200);
  }

  ws.on('open', () => {
    console.log('Connected. Authenticating...');
    ws.send(JSON.stringify({ type: 'auth' }));
  });

  ws.on('error', (e) => {
    console.error('WebSocket error:', e.message);
    process.exit(1);
  });

  ws.on('close', () => {
    if (!done) {
      console.log('\nConnection closed unexpectedly.');
      process.exit(1);
    }
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'auth_result':
        if (!msg.success) {
          console.error('Auth failed');
          finish(1);
          return;
        }
        console.log('Authenticated.\n');
        sendChat();
        break;

      case 'run_started':
        console.log(`Run started: ${msg.runId}\n---`);
        break;

      case 'assistant':
        process.stdout.write(msg.content || '');
        break;

      case 'tool_use':
        console.log(`\n[tool_use] ${msg.toolName}: ${JSON.stringify(msg.toolInput).slice(0, 200)}`);
        break;

      case 'tool_result':
        console.log(`[tool_result] ${(msg.content || '').slice(0, 200)}`);
        break;

      case 'permission_request':
        console.log(`\n[permission_request] ${msg.toolName}: ${msg.detail}`);
        console.log('  Auto-approving for test...');
        ws.send(JSON.stringify({
          type: 'permission_decision',
          requestId: msg.requestId,
          allow: true,
        }));
        break;

      case 'run_completed':
        console.log('\n---\nRun completed.');
        finish(0);
        break;

      case 'run_failed':
        console.error('\n---\nRun failed:', msg.error);
        finish(1);
        break;

      case 'error':
        console.error(`[error] ${msg.code}: ${msg.message}`);
        finish(1);
        break;

      case 'pong':
        break;

      default:
        console.log(`[${msg.type}]`, JSON.stringify(msg).slice(0, 300));
    }
  });

  function sendChat() {
    const requestId = randomUUID();
    console.log(`Sending to session ${sessionId}: "${message}"\n`);
    ws.send(JSON.stringify({
      type: 'run_start',
      clientRequestId: requestId,
      sessionId,
      input: message,
      permissionMode: 'bypassPermissions',
    }));
  }

  setTimeout(() => {
    if (!done) {
      console.error('\n[timeout] No response within ' + timeout + 'ms');
      finish(1);
    }
  }, timeout);
}
