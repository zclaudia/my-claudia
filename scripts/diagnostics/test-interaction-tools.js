#!/usr/bin/env node

/**
 * Interaction Tools Verification Script
 *
 * Tests whether each provider correctly calls interaction tools
 * (update_todo_list, ask_user_form, request_approval, push_file).
 *
 * Usage:
 *   # Start server first (or let script start one):
 *   node scripts/diagnostics/test-interaction-tools.js [--port 3100] [--provider claude]
 *
 * The script will:
 *   1. Connect to the server via WebSocket
 *   2. List available providers from DB
 *   3. For each provider (or specified one), run test prompts
 *   4. Observe whether interaction events are emitted
 *   5. Auto-respond to transactional interactions
 *   6. Output a capability matrix
 */

import { randomUUID } from 'crypto';
// Uses Node.js 22+ built-in WebSocket (no external deps)

// ─── Config ────────────────────────────────────────────────
const args = process.argv.slice(2);
const PORT = getArg('--port') || '3100';
const ONLY_PROVIDER = getArg('--provider') || null;
const TIMEOUT_MS = parseInt(getArg('--timeout') || '120000', 10);
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

// ─── Colors ────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// ─── Test Scenarios ────────────────────────────────────────

const TEST_SCENARIOS = [
  {
    id: 'todo_list',
    name: 'update_todo_list',
    prompt: '请帮我规划以下任务并用 todo list 跟踪：1. 检查代码风格 2. 运行测试 3. 构建项目。只需要创建 todo list，不需要真的执行这些任务。',
    expectEvent: 'interaction_todo_update',
    // No response needed (fire-and-forget)
    transactional: false,
  },
  {
    id: 'ask_form',
    name: 'ask_user_form',
    prompt: '我想配置一个新的部署环境，请用表单询问我以下信息：环境名称（dev/staging/prod）、目标服务器地址、是否启用 HTTPS。请使用 ask_user_form 工具。',
    expectEvent: 'interaction_ask_user_form',
    transactional: true,
    autoResponse: (msg) => {
      // Build response based on fields
      const response = {};
      for (const field of msg.fields || []) {
        if (field.type === 'select' && field.options?.length) {
          response[field.id] = field.options[0].value;
        } else if (field.type === 'confirm') {
          response[field.id] = true;
        } else {
          response[field.id] = `test-value-${field.id}`;
        }
      }
      return response;
    },
  },
  {
    id: 'approval',
    name: 'request_approval',
    prompt: '我现在要执行一个危险操作：删除所有临时文件。请先用 request_approval 工具请求我的批准，不要直接执行。',
    expectEvent: 'interaction_approval',
    transactional: true,
    autoResponse: () => ({ approved: true }),
  },
];

// ─── API Helpers ───────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

async function getProviders() {
  const res = await apiFetch('/api/providers');
  return res.data || [];
}

async function createTestProject(providerId) {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `test-interaction-${Date.now()}`,
      providerId,
      rootPath: process.cwd(),
    }),
  });
  if (!res.success || !res.data?.id) {
    console.error('  Project creation failed:', JSON.stringify(res));
    return null;
  }
  return res.data.id;
}

async function createTestSession(projectId, providerId) {
  const res = await apiFetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      name: `Test Session ${Date.now()}`,
      providerId,
    }),
  });
  if (!res.success || !res.data?.id) {
    console.error('  Session creation failed:', JSON.stringify(res));
    return null;
  }
  return res.data.id;
}

async function cleanupTestData() {
  // Clean up test projects/sessions via direct DB is not ideal,
  // but projects with test- prefix will be cleaned by e2e setup
  console.log(`${c.dim}(Test data with test-interaction-* prefix left in DB)${c.reset}`);
}

// ─── WebSocket Client (Node.js native WebSocket wrapper) ───

/**
 * Wraps native WebSocket to provide EventEmitter-like API.
 * Native WS uses addEventListener/onmessage, we need on/removeListener.
 */
class WsClient {
  constructor(url) {
    this._ws = new WebSocket(url);
    this._listeners = new Map(); // event -> Set<handler>
    this._ws.addEventListener('message', (ev) => {
      for (const handler of this._getHandlers('message')) {
        handler(ev.data);
      }
    });
  }

  _getHandlers(event) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    return this._listeners.get(event);
  }

  on(event, handler) {
    if (event === 'open') {
      this._ws.addEventListener('open', handler);
    } else if (event === 'error') {
      this._ws.addEventListener('error', handler);
    } else {
      this._getHandlers(event).add(handler);
    }
  }

  removeListener(event, handler) {
    this._getHandlers(event).delete(handler);
  }

  send(data) {
    this._ws.send(data);
  }

  close() {
    this._ws.close();
  }
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function authenticate(ws) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'auth_result') {
        ws.removeListener('message', handler);
        if (msg.success) resolve(msg);
        else reject(new Error(`Auth failed: ${msg.error}`));
      }
    };
    ws.on('message', handler);
    send(ws, { type: 'auth' });
    setTimeout(() => reject(new Error('Auth timeout')), 5000);
  });
}

// ─── Single Test Runner ────────────────────────────────────

async function runScenario(ws, sessionId, scenario, providerId) {
  const clientRequestId = randomUUID();
  const tag = `[${providerId}/${scenario.id}]`;

  return new Promise((resolve) => {
    const result = {
      scenario: scenario.id,
      toolName: scenario.name,
      eventReceived: false,
      eventType: null,
      eventData: null,
      toolUseCalled: false,
      toolUseName: null,
      responseSubmitted: false,
      runCompleted: false,
      runFailed: false,
      error: null,
      durationMs: 0,
      textContent: '',
    };

    const startTime = Date.now();
    let runId = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      result.durationMs = Date.now() - startTime;
      ws.removeListener('message', handler);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        result.error = 'timeout';
        finish();
      }
    }, TIMEOUT_MS);

    const handler = (data) => {
      const msg = JSON.parse(data);

      // Track run
      if (msg.type === 'run_started' && msg.clientRequestId === clientRequestId) {
        runId = msg.runId;
        console.log(`  ${c.dim}${tag} run started: ${runId}${c.reset}`);
      }

      // Only process messages for our run
      if (runId && msg.runId && msg.runId !== runId) return;

      // Collect text content
      if (msg.type === 'delta') {
        result.textContent += msg.content || '';
      }

      // Track tool_use events (MCP bridge tools)
      if (msg.type === 'tool_use') {
        const tn = msg.toolName || '';
        if (tn.startsWith('mcp__claudia-plugins__') || tn === scenario.name) {
          result.toolUseCalled = true;
          result.toolUseName = tn;
          console.log(`  ${c.cyan}${tag} tool_use: ${tn}${c.reset}`);
        }
      }

      // Track interaction events
      if (msg.type === scenario.expectEvent && msg.sessionId === sessionId) {
        result.eventReceived = true;
        result.eventType = msg.type;
        result.eventData = msg;
        console.log(`  ${c.green}${tag} ✓ ${msg.type} received${c.reset}`);

        // Auto-respond to transactional interactions
        if (scenario.transactional && scenario.autoResponse) {
          const response = scenario.autoResponse(msg);
          send(ws, {
            type: 'interaction_response',
            interactionId: msg.interactionId,
            sessionId,
            response,
          });
          result.responseSubmitted = true;
          console.log(`  ${c.dim}${tag} auto-responded${c.reset}`);
        }
      }

      // Handle permission requests (auto-allow)
      if (msg.type === 'permission_request' && msg.sessionId === sessionId) {
        console.log(`  ${c.yellow}${tag} permission: ${msg.toolName} - auto-allowing${c.reset}`);
        send(ws, {
          type: 'permission_decision',
          requestId: msg.requestId,
          allow: true,
        });
      }

      // Handle prompt_request (native prompt routing, auto-answer)
      if (msg.type === 'prompt_request' && msg.sessionId === sessionId) {
        console.log(`  ${c.yellow}${tag} prompt_request - auto-answering${c.reset}`);
        send(ws, {
          type: 'prompt_answer',
          requestId: msg.requestId,
          formattedAnswer: 'Continue with defaults',
        });
      }

      // Run ended
      if (msg.type === 'run_completed' && msg.runId === runId) {
        result.runCompleted = true;
        console.log(`  ${c.dim}${tag} run completed${c.reset}`);
        clearTimeout(timeout);
        // Give a small delay for any trailing interaction events
        setTimeout(finish, 2000);
      }

      if (msg.type === 'run_failed' && msg.runId === runId) {
        result.runFailed = true;
        result.error = msg.error;
        console.log(`  ${c.red}${tag} run failed: ${msg.error}${c.reset}`);
        clearTimeout(timeout);
        finish();
      }
    };

    ws.on('message', handler);

    // Start the run
    send(ws, {
      type: 'run_start',
      clientRequestId,
      sessionId,
      input: scenario.prompt,
      permissionMode: 'bypassPermissions',
    });

    console.log(`  ${c.dim}${tag} prompt sent, waiting...${c.reset}`);
  });
}

// ─── Provider Test Runner ──────────────────────────────────

async function testProvider(provider) {
  const providerTag = `${c.bold}[${provider.name} (${provider.type})]${c.reset}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${providerTag} Starting tests`);
  console.log(`${'─'.repeat(60)}`);

  let ws;
  try {
    ws = await connectWs();
    await authenticate(ws);
  } catch (err) {
    console.error(`${c.red}Failed to connect: ${err.message}${c.reset}`);
    return TEST_SCENARIOS.map((s) => ({
      scenario: s.id,
      toolName: s.name,
      eventReceived: false,
      error: `connection_failed: ${err.message}`,
    }));
  }

  const projectId = await createTestProject(provider.id);
  if (!projectId) {
    console.error(`${c.red}Failed to create project${c.reset}`);
    ws.close();
    return TEST_SCENARIOS.map((s) => ({
      scenario: s.id,
      toolName: s.name,
      eventReceived: false,
      error: 'project_creation_failed',
    }));
  }

  const sessionId = await createTestSession(projectId, provider.id);

  if (!sessionId) {
    console.error(`${c.red}Failed to create session${c.reset}`);
    ws.close();
    return TEST_SCENARIOS.map((s) => ({
      scenario: s.id,
      toolName: s.name,
      eventReceived: false,
      error: 'session_creation_failed',
    }));
  }

  console.log(`  Project: ${projectId}`);
  console.log(`  Session: ${sessionId}`);

  const results = [];
  for (const scenario of TEST_SCENARIOS) {
    console.log(`\n  ${c.bold}Testing: ${scenario.name}${c.reset}`);
    // Use a fresh session for each scenario to avoid context bleed
    const scenarioSessionId = await createTestSession(projectId, provider.id);
    const result = await runScenario(ws, scenarioSessionId || sessionId, scenario, provider.type);
    results.push(result);
  }

  ws.close();
  return results;
}

// ─── Matrix Output ─────────────────────────────────────────

function printMatrix(matrix) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${c.bold}  INTERACTION TOOLS CAPABILITY MATRIX${c.reset}`);
  console.log(`${'═'.repeat(80)}\n`);

  // Header
  const tools = TEST_SCENARIOS.map((s) => s.name);
  const colWidth = 20;
  const providerWidth = 16;

  let header = 'Provider'.padEnd(providerWidth);
  for (const tool of tools) {
    header += tool.padEnd(colWidth);
  }
  console.log(header);
  console.log('─'.repeat(providerWidth + tools.length * colWidth));

  // Rows
  for (const [providerName, results] of Object.entries(matrix)) {
    let row = providerName.padEnd(providerWidth);
    for (const tool of tools) {
      const r = results.find((x) => x.toolName === tool);
      if (!r) {
        row += `${c.dim}N/A${c.reset}`.padEnd(colWidth + c.dim.length + c.reset.length);
      } else if (r.error === 'timeout') {
        row += `${c.yellow}⏱ timeout${c.reset}`.padEnd(colWidth + c.yellow.length + c.reset.length);
      } else if (r.error) {
        row += `${c.red}✗ error${c.reset}`.padEnd(colWidth + c.red.length + c.reset.length);
      } else if (r.eventReceived) {
        row += `${c.green}✓ works${c.reset}`.padEnd(colWidth + c.green.length + c.reset.length);
      } else if (r.toolUseCalled) {
        row += `${c.yellow}◐ called${c.reset}`.padEnd(colWidth + c.yellow.length + c.reset.length);
      } else if (r.runCompleted) {
        row += `${c.red}✗ not called${c.reset}`.padEnd(colWidth + c.red.length + c.reset.length);
      } else {
        row += `${c.red}✗ failed${c.reset}`.padEnd(colWidth + c.red.length + c.reset.length);
      }
    }
    console.log(row);
  }

  console.log(`\n${c.dim}Legend: ✓ works = interaction event received | ◐ called = tool_use seen but no interaction event | ✗ = not called or failed${c.reset}`);
}

function printDetailedResults(matrix) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${c.bold}  DETAILED RESULTS${c.reset}`);
  console.log(`${'═'.repeat(80)}`);

  for (const [providerName, results] of Object.entries(matrix)) {
    console.log(`\n${c.bold}${providerName}:${c.reset}`);
    for (const r of results) {
      const status = r.eventReceived
        ? `${c.green}✓${c.reset}`
        : r.error
          ? `${c.red}✗${c.reset}`
          : `${c.yellow}?${c.reset}`;
      console.log(`  ${status} ${r.toolName}`);
      if (r.error) console.log(`    ${c.red}Error: ${r.error}${c.reset}`);
      if (r.toolUseCalled) console.log(`    Tool called: ${r.toolUseName}`);
      if (r.eventType) console.log(`    Event: ${r.eventType}`);
      if (r.responseSubmitted) console.log(`    Response submitted: yes`);
      console.log(`    Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
      if (!r.eventReceived && r.textContent) {
        const preview = r.textContent.slice(0, 200).replace(/\n/g, ' ');
        console.log(`    ${c.dim}Text preview: ${preview}...${c.reset}`);
      }
    }
  }
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log(`${c.bold}Interaction Tools Verification${c.reset}`);
  console.log(`Server: ${BASE_URL}`);
  console.log(`Timeout per scenario: ${TIMEOUT_MS / 1000}s`);
  if (ONLY_PROVIDER) console.log(`Provider filter: ${ONLY_PROVIDER}`);
  console.log();

  // Check server is alive
  try {
    await fetch(`${BASE_URL}/api/server/health`);
  } catch {
    console.error(`${c.red}Server not reachable at ${BASE_URL}. Start it first.${c.reset}`);
    process.exit(1);
  }

  // Get providers
  let providers = await getProviders();
  if (providers.length === 0) {
    console.error(`${c.red}No providers configured in DB.${c.reset}`);
    process.exit(1);
  }

  if (ONLY_PROVIDER) {
    providers = providers.filter(
      (p) => p.type === ONLY_PROVIDER || p.name.toLowerCase().includes(ONLY_PROVIDER.toLowerCase())
    );
    if (providers.length === 0) {
      console.error(`${c.red}No provider matching "${ONLY_PROVIDER}" found.${c.reset}`);
      process.exit(1);
    }
  }

  console.log(`Providers to test: ${providers.map((p) => `${p.name} (${p.type})`).join(', ')}`);

  // Run tests
  const matrix = {};
  for (const provider of providers) {
    const results = await testProvider(provider);
    matrix[`${provider.name} (${provider.type})`] = results;
  }

  // Output
  printMatrix(matrix);
  printDetailedResults(matrix);

  await cleanupTestData();

  // Exit code based on results
  const allResults = Object.values(matrix).flat();
  const failures = allResults.filter((r) => !r.eventReceived && !r.error?.includes('timeout'));
  if (failures.length > 0) {
    console.log(`\n${c.yellow}${failures.length} scenario(s) did not produce expected interaction events.${c.reset}`);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal: ${err.message}${c.reset}`);
  process.exit(1);
});
